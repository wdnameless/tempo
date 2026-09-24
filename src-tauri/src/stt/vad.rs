//! Voice Activity Detection (VAD) layer for speech capture.
//!
//! Ported from Handy's audio toolkit. Provides a unified [`VoiceActivityDetector`]
//! trait with two backends:
//! 1. [`EnergyVad`] - lightweight RMS energy thresholding over 30 ms frames.
//! 2. [`EarshotVad`] - pure-Rust neural VAD via the `earshot` crate over 16 ms (256 sample) frames.
//!
//! Both backends are wrapped by [`SmoothedVad`], which implements Handy's temporal policy:
//! - Pre-roll buffer (prefill 450 ms): retains leading audio prior to speech onset so first syllables are never clipped.
//! - Onset confirmation (60 ms): requires sustained voicing before declaring speech, preventing keyclicks/knocks from triggering.
//! - Hangover tail (450 ms): holds the speech gate open after voicing pauses, capturing soft trailing word endings.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use serde::{Deserialize, Serialize};
/// Available VAD detection backends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VadBackend {
    #[default]
    Energy,
    Earshot,
    Silero,
}

/// Configuration for speech detection and temporal smoothing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VadConfig {
    pub backend: VadBackend,
    pub energy_threshold: f32,
    pub prefill_ms: u32,
    pub onset_ms: u32,
    pub hangover_ms: u32,
    pub sample_rate: u32,
    #[serde(default)]
    pub silero_model_path: Option<PathBuf>,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            backend: VadBackend::Energy,
            energy_threshold: 0.015,
            prefill_ms: 450,
            onset_ms: 60,
            hangover_ms: 450,
            sample_rate: 16_000,
            silero_model_path: None,
        }
    }
}

/// Classification outcome for an audio frame.
#[derive(Debug, PartialEq)]
pub enum VadFrame<'a> {
    /// Speech audio. When transitioning from silence to speech, this may aggregate
    /// the prefill buffer together with the triggering frame.
    Speech(&'a [f32]),
    /// Non-speech audio (silence, noise).
    Noise(&'a [f32]),
}

impl<'a> VadFrame<'a> {
    #[inline]
    pub fn is_speech(&self) -> bool {
        matches!(self, VadFrame::Speech(_))
    }

    #[inline]
    pub fn is_noise(&self) -> bool {
        matches!(self, VadFrame::Noise(_))
    }

    #[inline]
    pub fn samples(&self) -> &'a [f32] {
        match self {
            VadFrame::Speech(s) | VadFrame::Noise(s) => s,
        }
    }
}

/// Core interface for streaming voice activity detectors.
pub trait VoiceActivityDetector: Send {
    /// Feed one backend-sized frame of mono audio and receive a keep/drop decision.
    fn push_frame<'a>(&'a mut self, frame: &'a [f32]) -> VadFrame<'a>;

    /// Required number of mono samples per prediction frame.
    fn frame_samples(&self) -> usize;

    /// Reset internal state between recording sessions.
    fn reset(&mut self);
}

/// Converts a duration in milliseconds to whole detector frames, rounding up so an
/// alternate backend never shortens onset, pre-roll, or hangover tail.
pub const fn frames_for_duration_ms(duration_ms: u32, frame_samples: usize, sample_rate: u32) -> usize {
    assert!(frame_samples > 0, "VAD frame size must be non-zero");
    let numerator = duration_ms as u64 * sample_rate as u64;
    let denominator = frame_samples as u64 * 1000;
    numerator.div_ceil(denominator) as usize
}

// ---------------------------------------------------------------------------
// Energy VAD Backend
// ---------------------------------------------------------------------------

/// Energy-based VAD using RMS thresholding over ~30 ms frames.
pub struct EnergyVad {
    threshold: f32,
    frame_samples: usize,
}

impl EnergyVad {
    pub fn new(threshold: f32, sample_rate: u32) -> Self {
        // 30 ms frame duration at sample_rate
        let frame_samples = ((sample_rate as f64 * 0.030).round() as usize).max(1);
        Self {
            threshold,
            frame_samples,
        }
    }
}

impl VoiceActivityDetector for EnergyVad {
    fn push_frame<'a>(&'a mut self, frame: &'a [f32]) -> VadFrame<'a> {
        let mut sum_sq = 0.0f32;
        for &sample in frame {
            sum_sq += sample * sample;
        }
        let rms = (sum_sq / frame.len().max(1) as f32).sqrt();
        if rms >= self.threshold {
            VadFrame::Speech(frame)
        } else {
            VadFrame::Noise(frame)
        }
    }

    fn frame_samples(&self) -> usize {
        self.frame_samples
    }

    fn reset(&mut self) {}
}

// ---------------------------------------------------------------------------
// Earshot Neural VAD Backend
// ---------------------------------------------------------------------------

/// Expected frame size for Earshot: 16 ms at 16 kHz = 256 samples.
pub const EARSHOT_FRAME_SAMPLES: usize = 256;

/// Neural network VAD adapter powered by the `earshot` crate.
///
/// Operates on 256 mono 16 kHz samples per prediction. Threshold defaults to 0.5.
pub struct EarshotVad {
    engine: Box<earshot::Detector>,
    threshold: f32,
    clamped_frame: [f32; EARSHOT_FRAME_SAMPLES],
}

impl EarshotVad {
    pub fn new(threshold: f32) -> Result<Self, String> {
        if !(0.0..=1.0).contains(&threshold) {
            return Err("Earshot threshold must be between 0.0 and 1.0".to_string());
        }
        Ok(Self {
            engine: earshot::Detector::default_boxed(),
            threshold,
            clamped_frame: [0.0; EARSHOT_FRAME_SAMPLES],
        })
    }
}

impl Default for EarshotVad {
    fn default() -> Self {
        Self::new(0.5).expect("default earshot threshold 0.5 is valid")
    }
}

impl VoiceActivityDetector for EarshotVad {
    fn push_frame<'a>(&'a mut self, frame: &'a [f32]) -> VadFrame<'a> {
        if frame.len() != EARSHOT_FRAME_SAMPLES {
            return VadFrame::Noise(frame);
        }
        if frame.iter().any(|sample| !sample.is_finite()) {
            return VadFrame::Noise(frame);
        }

        // cpal produces normalized f32 samples, but resampling a full-scale
        // signal can ring slightly outside [-1, 1]. Earshot documents that
        // range as a precondition and asserts it in debug builds, so clamp only
        // the prediction input while preserving the original audio on output.
        let score = if frame.iter().all(|sample| (-1.0..=1.0).contains(sample)) {
            self.engine.predict_f32(frame)
        } else {
            for (clamped, sample) in self.clamped_frame.iter_mut().zip(frame) {
                *clamped = sample.clamp(-1.0, 1.0);
            }
            self.engine.predict_f32(&self.clamped_frame)
        };

        if score >= self.threshold {
            VadFrame::Speech(frame)
        } else {
            VadFrame::Noise(frame)
        }
    }

    fn frame_samples(&self) -> usize {
        EARSHOT_FRAME_SAMPLES
    }

    fn reset(&mut self) {
        self.engine.reset();
    }
}

// ---------------------------------------------------------------------------
// Silero Neural VAD Backend
// ---------------------------------------------------------------------------

/// Expected frame size for Silero: 30 ms at 16 kHz = 480 samples.
pub const SILERO_FRAME_SAMPLES: usize = 480;

/// Frame-size adapter that buffers audio of arbitrary chunk sizes and invokes
/// a closure on every complete `target_samples` (480-sample) chunk.
#[derive(Debug, Default)]
pub struct FrameAdapter {
    buffer: Vec<f32>,
    target_samples: usize,
}

impl FrameAdapter {
    pub fn new(target_samples: usize) -> Self {
        Self {
            buffer: Vec::with_capacity(target_samples * 2),
            target_samples,
        }
    }

    pub fn push_samples<F>(&mut self, samples: &[f32], mut process_frame: F)
    where
        F: FnMut(&[f32]),
    {
        self.buffer.extend_from_slice(samples);
        while self.buffer.len() >= self.target_samples {
            let frame: Vec<f32> = self.buffer.drain(..self.target_samples).collect();
            process_frame(&frame);
        }
    }

    pub fn buffered_samples(&self) -> usize {
        self.buffer.len()
    }

    pub fn reset(&mut self) {
        self.buffer.clear();
    }
}

static LAST_FALLBACK_REASON: RwLock<Option<String>> = RwLock::new(None);

pub fn last_fallback_reason() -> Option<String> {
    LAST_FALLBACK_REASON.read().ok().and_then(|guard| guard.clone())
}

pub fn set_last_fallback_reason(reason: Option<String>) {
    if let Ok(mut guard) = LAST_FALLBACK_REASON.write() {
        *guard = reason;
    }
}

pub fn resolve_default_silero_model_path() -> Option<PathBuf> {
    resolve_silero_model_path(None)
}

pub fn resolve_silero_model_path(models_dir: Option<&Path>) -> Option<PathBuf> {
    let candidate_names = ["silero_vad.onnx", "silero_vad_v4.onnx"];
    if let Some(dir) = models_dir {
        for name in &candidate_names {
            let p = dir.join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    let mut candidate_dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidate_dirs.push(parent.join("data").join("models"));
            candidate_dirs.push(parent.join("models"));
        }
    }
    for (var, subdir) in [("LOCALAPPDATA", "tempo"), ("LOCALAPPDATA", "Alarmer"), ("APPDATA", "tempo"), ("APPDATA", "Alarmer")] {
        if let Ok(base) = std::env::var(var) {
            candidate_dirs.push(PathBuf::from(base).join(subdir).join("models"));
        }
    }
    candidate_dirs.push(PathBuf::from("data").join("models"));
    candidate_dirs.push(PathBuf::from("models"));
    candidate_dirs.push(PathBuf::from("."));

    for dir in candidate_dirs {
        for name in &candidate_names {
            let p = dir.join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

pub struct SileroVad {
    engine: transcribe_rs::vad::SileroVad,
    threshold: f32,
    adapter: FrameAdapter,
    last_prob: f32,
}

impl SileroVad {
    pub fn new(model_path: impl AsRef<Path>, threshold: f32) -> Result<Self, String> {
        let path = model_path.as_ref();
        if !path.is_file() {
            return Err(format!("Silero model not found at {}", path.display()));
        }
        let engine = transcribe_rs::vad::SileroVad::new(path, threshold)
            .map_err(|e| format!("Failed to initialize Silero VAD from {}: {e}", path.display()))?;
        Ok(Self {
            engine,
            threshold,
            adapter: FrameAdapter::new(SILERO_FRAME_SAMPLES),
            last_prob: 0.0,
        })
    }

    pub fn from_config(cfg: &VadConfig) -> Result<Self, String> {
        let model_path = match &cfg.silero_model_path {
            Some(p) if p.is_file() => p.clone(),
            Some(p) => return Err(format!("Silero model file does not exist at {}", p.display())),
            None => {
                resolve_default_silero_model_path()
                    .ok_or_else(|| "Silero VAD model is not installed. Please download 'silero-vad' in models settings.".to_string())?
            }
        };
        Self::new(model_path, 0.5)
    }
}

impl VoiceActivityDetector for SileroVad {
    fn push_frame<'a>(&'a mut self, frame: &'a [f32]) -> VadFrame<'a> {
        if frame.len() == SILERO_FRAME_SAMPLES {
            let prob = self.engine.speech_probability(frame).unwrap_or(0.0);
            self.last_prob = prob;
        } else {
            let engine = &mut self.engine;
            let last_prob = &mut self.last_prob;
            self.adapter.push_samples(frame, |chunk| {
                if let Ok(prob) = engine.speech_probability(chunk) {
                    *last_prob = prob;
                }
            });
        }

        if self.last_prob >= self.threshold {
            VadFrame::Speech(frame)
        } else {
            VadFrame::Noise(frame)
        }
    }

    fn frame_samples(&self) -> usize {
        SILERO_FRAME_SAMPLES
    }

    fn reset(&mut self) {
        use transcribe_rs::vad::Vad;
        self.engine.reset();
        self.adapter.reset();
        self.last_prob = 0.0;
    }
}

// ---------------------------------------------------------------------------
// Temporal Smoothing Wrapper (SmoothedVad)
// ---------------------------------------------------------------------------

struct BufferedFrame {
    samples: Vec<f32>,
    emitted: bool,
    voiced: bool,
}

/// End-of-recording snapshot of a smoothing detector's state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VadTailReport {
    pub withheld_frames: usize,
    pub withheld_voiced_frames: usize,
    pub in_speech: bool,
    pub onset_counter: usize,
    pub hangover_counter: usize,
}

/// Wraps any [`VoiceActivityDetector`] with temporal smoothing:
/// - Pre-roll buffering so speech onsets don't clip leading plosives/fricatives.
/// - Onset confirmation so transient spikes (mouse clicks, typing) don't trigger recording.
/// - Post-speech hangover tail so trailing soft syllables are retained.
pub struct SmoothedVad {
    inner_vad: Box<dyn VoiceActivityDetector + Send>,
    prefill_frames: usize,
    hangover_frames: usize,
    onset_frames: usize,

    frame_buffer: VecDeque<BufferedFrame>,
    hangover_counter: usize,
    onset_counter: usize,
    in_speech: bool,

    temp_out: Vec<f32>,
}

impl SmoothedVad {
    pub fn new(
        inner_vad: Box<dyn VoiceActivityDetector + Send>,
        prefill_frames: usize,
        hangover_frames: usize,
        onset_frames: usize,
    ) -> Self {
        Self {
            inner_vad,
            prefill_frames,
            hangover_frames,
            onset_frames: onset_frames.max(1),
            frame_buffer: VecDeque::new(),
            hangover_counter: 0,
            onset_counter: 0,
            in_speech: false,
            temp_out: Vec::new(),
        }
    }

    fn mark_last_emitted(&mut self) {
        if let Some(frame) = self.frame_buffer.back_mut() {
            frame.emitted = true;
        }
    }

    pub fn set_hangover_frames(&mut self, frames: usize) {
        self.hangover_frames = frames;
    }

    /// Diagnostic snapshot of withheld trailing frames.
    pub fn tail_report(&self) -> Option<VadTailReport> {
        let mut withheld_frames = 0;
        let mut withheld_voiced_frames = 0;
        for frame in self
            .frame_buffer
            .iter()
            .rev()
            .take_while(|f| !f.emitted)
        {
            withheld_frames += 1;
            if frame.voiced {
                withheld_voiced_frames += 1;
            }
        }

        Some(VadTailReport {
            withheld_frames,
            withheld_voiced_frames,
            in_speech: self.in_speech,
            onset_counter: self.onset_counter,
            hangover_counter: self.hangover_counter,
        })
    }
}

impl VoiceActivityDetector for SmoothedVad {
    fn push_frame<'a>(&'a mut self, frame: &'a [f32]) -> VadFrame<'a> {
        // 1. Buffer incoming frame for pre-roll
        self.frame_buffer.push_back(BufferedFrame {
            samples: frame.to_vec(),
            emitted: false,
            voiced: false,
        });
        while self.frame_buffer.len() > self.prefill_frames + 1 {
            self.frame_buffer.pop_front();
        }

        // 2. Delegate to underlying detector
        let is_voice = self.inner_vad.push_frame(frame).is_speech();
        if let Some(last) = self.frame_buffer.back_mut() {
            last.voiced = is_voice;
        }

        match (self.in_speech, is_voice) {
            // Potential onset of speech: accumulate confirmed voiced frames
            (false, true) => {
                self.onset_counter += 1;
                if self.onset_counter >= self.onset_frames {
                    // Sustained voicing confirmed: enter speech state and emit prefill + current
                    self.in_speech = true;
                    self.hangover_counter = self.hangover_frames;
                    self.onset_counter = 0;

                    self.temp_out.clear();
                    for buffered in self.frame_buffer.iter_mut() {
                        self.temp_out.extend(buffered.samples.iter());
                        buffered.emitted = true;
                    }
                    VadFrame::Speech(&self.temp_out)
                } else {
                    // Not confirmed yet: treat as noise/candidate
                    VadFrame::Noise(frame)
                }
            }

            // Ongoing sustained speech
            (true, true) => {
                self.hangover_counter = self.hangover_frames;
                self.mark_last_emitted();
                VadFrame::Speech(frame)
            }

            // Voicing stopped: hold hangover tail before dropping out of speech
            (true, false) => {
                if self.hangover_counter > 0 {
                    self.hangover_counter -= 1;
                    self.mark_last_emitted();
                    VadFrame::Speech(frame)
                } else {
                    self.in_speech = false;
                    VadFrame::Noise(frame)
                }
            }

            // Continuous silence or broken onset sequence
            (false, false) => {
                self.onset_counter = 0;
                VadFrame::Noise(frame)
            }
        }
    }

    fn frame_samples(&self) -> usize {
        self.inner_vad.frame_samples()
    }

    fn reset(&mut self) {
        self.inner_vad.reset();
        self.frame_buffer.clear();
        self.hangover_counter = 0;
        self.onset_counter = 0;
        self.in_speech = false;
        self.temp_out.clear();
    }
}

/// Builds a fully configured, smoothed [`VoiceActivityDetector`] based on `cfg`.
pub fn build_with_reason(cfg: &VadConfig) -> (Box<dyn VoiceActivityDetector + Send>, Option<String>) {
    let (inner, fallback_reason): (Box<dyn VoiceActivityDetector + Send>, Option<String>) = match cfg.backend {
        VadBackend::Energy => {
            set_last_fallback_reason(None);
            (Box::new(EnergyVad::new(cfg.energy_threshold, cfg.sample_rate)), None)
        }
        VadBackend::Earshot => match EarshotVad::new(0.5) {
            Ok(vad) => {
                set_last_fallback_reason(None);
                (Box::new(vad), None)
            }
            Err(err) => {
                let reason = format!("STT EarshotVad initialization failed ({err}), falling back to EnergyVad");
                eprintln!("{reason}");
                set_last_fallback_reason(Some(reason.clone()));
                (Box::new(EnergyVad::new(cfg.energy_threshold, cfg.sample_rate)), Some(reason))
            }
        },
        VadBackend::Silero => match SileroVad::from_config(cfg) {
            Ok(vad) => {
                set_last_fallback_reason(None);
                (Box::new(vad), None)
            }
            Err(err) => {
                let reason = format!("STT SileroVad initialization failed ({err}), falling back to EnergyVad");
                eprintln!("{reason}");
                set_last_fallback_reason(Some(reason.clone()));
                (Box::new(EnergyVad::new(cfg.energy_threshold, cfg.sample_rate)), Some(reason))
            }
        },
    };

    let frame_samples = inner.frame_samples();
    let prefill_frames = frames_for_duration_ms(cfg.prefill_ms, frame_samples, cfg.sample_rate);
    let hangover_frames = frames_for_duration_ms(cfg.hangover_ms, frame_samples, cfg.sample_rate);
    let onset_frames = frames_for_duration_ms(cfg.onset_ms, frame_samples, cfg.sample_rate);

    let smoothed = Box::new(SmoothedVad::new(
        inner,
        prefill_frames,
        hangover_frames,
        onset_frames,
    ));
    (smoothed, fallback_reason)
}

/// Builds a fully configured, smoothed [`VoiceActivityDetector`] based on `cfg`.
pub fn build(cfg: &VadConfig) -> Box<dyn VoiceActivityDetector + Send> {
    build_with_reason(cfg).0
}

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timing_constants_match_handy_durations() {
        // 480 samples = 30 ms at 16 kHz (Energy backend)
        assert_eq!(frames_for_duration_ms(450, 480, 16000), 15);
        assert_eq!(frames_for_duration_ms(60, 480, 16000), 2);
        assert_eq!(frames_for_duration_ms(1650, 480, 16000), 55);

        // 256 samples = 16 ms at 16 kHz (Earshot backend)
        assert_eq!(frames_for_duration_ms(450, 256, 16000), 29);
        assert_eq!(frames_for_duration_ms(60, 256, 16000), 4);
        assert_eq!(frames_for_duration_ms(1650, 256, 16000), 104);
    }

    #[test]
    fn energy_vad_detects_speech_above_threshold() {
        let mut vad = EnergyVad::new(0.015, 16000);
        let silence = vec![0.0f32; 480];
        assert_eq!(vad.push_frame(&silence), VadFrame::Noise(&silence));

        let tone: Vec<f32> = (0..480)
            .map(|i| (i as f32 * 0.1).sin() * 0.05)
            .collect();
        assert!(vad.push_frame(&tone).is_speech());
    }

    #[test]
    fn earshot_vad_rejects_invalid_inputs() {
        assert!(EarshotVad::new(-0.1).is_err());
        assert!(EarshotVad::new(1.1).is_err());

        let mut vad = EarshotVad::new(0.5).unwrap();
        let wrong_size = vec![0.0f32; 100];
        assert!(vad.push_frame(&wrong_size).is_noise());

        let non_finite = vec![f32::NAN; EARSHOT_FRAME_SAMPLES];
        assert!(vad.push_frame(&non_finite).is_noise());
    }

    /// Mock detector scripted with a sequence of voice/silence boolean outcomes.
    struct ScriptedVad {
        script: VecDeque<bool>,
        frame_size: usize,
    }

    impl VoiceActivityDetector for ScriptedVad {
        fn push_frame<'a>(&'a mut self, frame: &'a [f32]) -> VadFrame<'a> {
            if self.script.pop_front().unwrap_or(false) {
                VadFrame::Speech(frame)
            } else {
                VadFrame::Noise(frame)
            }
        }

        fn frame_samples(&self) -> usize {
            self.frame_size
        }

        fn reset(&mut self) {
            self.script.clear();
        }
    }

    #[test]
    fn smoothed_vad_protects_against_single_click() {
        // Script: silence, 1 loud click (voice), then silence.
        // Onset requires 2 frames. The click must be suppressed.
        let script = vec![false, true, false, false];
        let inner = Box::new(ScriptedVad {
            script: script.into(),
            frame_size: 4,
        });
        let mut smoothed = SmoothedVad::new(inner, 3, 2, 2);

        let dummy = [0.0f32; 4];
        // Frame 0: silence -> noise
        assert!(smoothed.push_frame(&dummy).is_noise());
        // Frame 1: click (1st voice frame, onset requires 2) -> noise!
        assert!(smoothed.push_frame(&dummy).is_noise());
        // Frame 2: silence -> resets onset counter -> noise!
        assert!(smoothed.push_frame(&dummy).is_noise());
        // Frame 3: silence -> noise!
        assert!(smoothed.push_frame(&dummy).is_noise());

        let report = smoothed.tail_report().unwrap();
        assert!(!report.in_speech);
        assert_eq!(report.onset_counter, 0);
    }

    #[test]
    fn smoothed_vad_triggers_speech_and_preserves_prefill_and_hangover() {
        // Script:
        // Frame 0: silence
        // Frame 1: silence
        // Frame 2: voice (onset 1)
        // Frame 3: voice (onset 2 -> trigger! emits prefill + current)
        // Frame 4: voice (ongoing speech)
        // Frame 5: silence (hangover 1)
        // Frame 6: silence (hangover 2)
        // Frame 7: silence (hangover expired -> noise)
        let script = vec![false, false, true, true, true, false, false, false];
        let inner = Box::new(ScriptedVad {
            script: script.into(),
            frame_size: 4,
        });
        // prefill: 2 frames, hangover: 2 frames, onset: 2 frames
        let mut smoothed = SmoothedVad::new(inner, 2, 2, 2);

        let f0 = [0.1f32; 4];
        let f1 = [0.2f32; 4];
        let f2 = [0.3f32; 4];
        let f3 = [0.4f32; 4];
        let f4 = [0.5f32; 4];
        let f5 = [0.6f32; 4];
        let f6 = [0.7f32; 4];
        let f7 = [0.8f32; 4];

        assert!(smoothed.push_frame(&f0).is_noise());
        assert!(smoothed.push_frame(&f1).is_noise());
        assert!(smoothed.push_frame(&f2).is_noise()); // onset 1/2

        // Frame 3 confirms onset: should emit aggregated prefill (f1, f2, f3) = 12 samples
        let out3 = smoothed.push_frame(&f3);
        assert!(out3.is_speech());
        assert_eq!(out3.samples().len(), 12); // prefill + current

        // Frame 4: ongoing speech
        let out4 = smoothed.push_frame(&f4);
        assert!(out4.is_speech());
        assert_eq!(out4.samples().len(), 4);

        // Frame 5: silence, held by hangover 1
        let out5 = smoothed.push_frame(&f5);
        assert!(out5.is_speech());

        // Frame 6: silence, held by hangover 2
        let out6 = smoothed.push_frame(&f6);
        assert!(out6.is_speech());

        // Frame 7: silence, hangover expired -> Noise
        let out7 = smoothed.push_frame(&f7);
        assert!(out7.is_noise());
    }

    #[test]
    fn smoothed_vad_reset_clears_state() {
        let script = vec![true, true, true];
        let inner = Box::new(ScriptedVad {
            script: script.into(),
            frame_size: 4,
        });
        let mut smoothed = SmoothedVad::new(inner, 2, 2, 1);
        let dummy = [0.0f32; 4];

        let out = smoothed.push_frame(&dummy);
        assert!(out.is_speech());

        smoothed.reset();
        let report = smoothed.tail_report().unwrap();
        assert!(!report.in_speech);
        assert_eq!(report.withheld_frames, 0);
    }

    #[test]
    fn test_vad_backend_setting_round_trips_silero() {
        let backend = VadBackend::Silero;
        let json = serde_json::to_string(&backend).expect("serialize silero");
        assert_eq!(json, "\"silero\"");
        let parsed: VadBackend = serde_json::from_str(&json).expect("deserialize silero");
        assert_eq!(parsed, VadBackend::Silero);
    }

    #[test]
    fn test_silero_vad_fallback_on_missing_model_with_reason() {
        let cfg = VadConfig {
            backend: VadBackend::Silero,
            silero_model_path: Some(PathBuf::from("nonexistent_silero_path_12345.onnx")),
            energy_threshold: 0.02,
            prefill_ms: 300,
            onset_ms: 60,
            hangover_ms: 300,
            sample_rate: 16000,
        };

        let mut detector = build(&cfg);
        // Fallback to EnergyVad frame size (30ms at 16kHz = 480)
        assert_eq!(detector.frame_samples(), 480);

        let reason = last_fallback_reason();
        assert!(reason.is_some(), "Fallback reason must be set on missing model");
        let reason_str = reason.unwrap();
        assert!(
            reason_str.contains("Silero") && reason_str.contains("EnergyVad"),
            "Reason was: {reason_str}"
        );

        // The fallback detector must actually work. It sits behind the same
        // smoothing the app uses, so one loud frame is still onset: speech is
        // declared once the onset window (60 ms = two 30 ms frames) is filled.
        let quiet = vec![0.0f32; 480];
        let loud = vec![0.5f32; 480];
        assert!(detector.push_frame(&quiet).is_noise());
        let declared_speech = (0..4).any(|_| detector.push_frame(&loud).is_speech());
        assert!(declared_speech, "the energy fallback must still find speech");
    }

    #[test]
    fn test_silero_frame_size_adapter() {
        let mut adapter = FrameAdapter::new(480);
        let mut processed_frames = Vec::new();

        // Push 3 chunks of 200 samples each = 600 samples
        let chunk1 = vec![1.0f32; 200];
        adapter.push_samples(&chunk1, |frame| processed_frames.push(frame.to_vec()));
        assert_eq!(processed_frames.len(), 0);
        assert_eq!(adapter.buffered_samples(), 200);

        let chunk2 = vec![2.0f32; 200];
        adapter.push_samples(&chunk2, |frame| processed_frames.push(frame.to_vec()));
        assert_eq!(processed_frames.len(), 0);
        assert_eq!(adapter.buffered_samples(), 400);

        let chunk3 = vec![3.0f32; 200];
        adapter.push_samples(&chunk3, |frame| processed_frames.push(frame.to_vec()));
        // 400 + 200 = 600 -> 1 frame of 480 drained, 120 remain
        assert_eq!(processed_frames.len(), 1);
        assert_eq!(processed_frames[0].len(), 480);
        assert_eq!(adapter.buffered_samples(), 120);

        // Push remaining 360 samples -> 120 + 360 = 480 -> 2nd frame
        let chunk4 = vec![4.0f32; 360];
        adapter.push_samples(&chunk4, |frame| processed_frames.push(frame.to_vec()));
        assert_eq!(processed_frames.len(), 2);
        assert_eq!(adapter.buffered_samples(), 0);
    }

    #[test]
    fn test_silero_synthetic_speech_and_silence() {
        let model_path = resolve_default_silero_model_path();
        let path = match model_path {
            Some(p) if p.is_file() => p,
            _ => {
                eprintln!("[INFO] Silero model not present locally; skipping live inference test");
                return;
            }
        };

        let mut silero = SileroVad::new(&path, 0.5).expect("SileroVad initialization");
        assert_eq!(silero.frame_samples(), 480);

        // Silence must never be reported as speech, over a run of frames.
        let silence = vec![0.0f32; 480];
        let silence_as_speech = (0..10).filter(|_| silero.push_frame(&silence).is_speech()).count();
        assert_eq!(silence_as_speech, 0, "silence must not be classified as speech");

        // Speech is fed as a run of frames, the way the detector is driven in
        // production: the model carries recurrent state, so a single 30 ms frame
        // is not enough context for a decision.
        let mut declared = 0;
        for _ in 0..15 {
            let mut speech = vec![0.0f32; 480];
            for (i, sample) in speech.iter_mut().enumerate() {
                let t = i as f32 / 16000.0;
                *sample = 0.5 * (2.0 * std::f32::consts::PI * 300.0 * t).sin()
                    + 0.3 * (2.0 * std::f32::consts::PI * 800.0 * t).sin()
                    + 0.2 * (2.0 * std::f32::consts::PI * 2500.0 * t).sin();
            }
            if silero.push_frame(&speech).is_speech() {
                declared += 1;
            }
        }
        assert!(declared > 0, "a run of speech frames must be detected as speech");
    }

    #[test]
    fn test_silero_model_path_resolves_in_custom_portable_dir() {
        let temp_dir = tempfile::tempdir().unwrap();
        let models_dir = temp_dir.path().join("models");
        std::fs::create_dir_all(&models_dir).unwrap();

        let dummy_model = models_dir.join("silero_vad.onnx");
        std::fs::write(&dummy_model, b"fake-silero-weights").unwrap();

        // ModelManager resolves it in custom portable directory
        let mgr = crate::stt::models::ModelManager::new(models_dir.clone());
        let resolved_by_mgr = mgr.installed_path(crate::stt::models::SILERO_VAD_MODEL_ID);
        assert_eq!(resolved_by_mgr, Some(dummy_model.clone()));

        // vad::resolve_silero_model_path resolves it
        let resolved = resolve_silero_model_path(Some(&models_dir));
        assert_eq!(resolved, Some(dummy_model));
    }

    #[test]
    fn test_silero_vad_fallback_reports_reason_when_initialization_fails() {
        let temp_dir = tempfile::tempdir().unwrap();
        let invalid_model = temp_dir.path().join("corrupted_silero.onnx");
        std::fs::write(&invalid_model, b"not-a-valid-onnx-model").unwrap();

        let cfg = VadConfig {
            backend: VadBackend::Silero,
            silero_model_path: Some(invalid_model.clone()),
            sample_rate: 16000,
            energy_threshold: 0.005,
            prefill_ms: 100,
            hangover_ms: 300,
            onset_ms: 60,
        };

        let (_detector, reason) = build_with_reason(&cfg);
        assert!(reason.is_some(), "Fallback reason must be reported when Silero init fails");
        let r = reason.unwrap();
        assert!(
            r.contains("SileroVad initialization failed"),
            "Reported reason was: {r}"
        );
        assert_eq!(last_fallback_reason(), Some(r));
    }
}
