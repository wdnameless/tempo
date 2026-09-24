//! DSP noise suppression and RNNoise pipeline.
//!
//! Chain order:
//! 1. RNNoise neural noise suppression (via `nnnoiseless` at 48 kHz mono frames)
//! 2. High-pass filter (2nd-order Butterworth biquad, default 80 Hz)
//! 3. Noise gate (RMS thresholding keyed off `EnergyVad`, default -45 dB)
//! 4. AGC (Automatic Gain Control, lifts quiet signal towards target RMS, leaves gated frames alone)
//!
//! Output format invariant:
//! Same sample rate, same channel count, same frame count and duration.

use serde::{Deserialize, Serialize};


/// Configuration for the noise suppression chain.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DenoiseConfig {
    #[serde(
        rename = "denoise_highpass",
        alias = "denoiseHighpass",
        default = "default_highpass"
    )]
    pub denoise_highpass: bool,

    #[serde(
        rename = "denoise_highpass_hz",
        alias = "denoiseHighpassHz",
        default = "default_highpass_hz"
    )]
    pub denoise_highpass_hz: f32,

    #[serde(
        rename = "denoise_gate",
        alias = "denoiseGate",
        default = "default_gate"
    )]
    pub denoise_gate: bool,

    #[serde(
        rename = "denoise_gate_db",
        alias = "denoiseGateDb",
        default = "default_gate_db"
    )]
    pub denoise_gate_db: f32,

    #[serde(
        rename = "denoise_rnnoise",
        alias = "denoiseRnnoise",
        default = "default_rnnoise"
    )]
    pub denoise_rnnoise: bool,

    #[serde(
        rename = "denoise_agc",
        alias = "denoiseAgc",
        default = "default_agc"
    )]
    pub denoise_agc: bool,

    #[serde(
        rename = "denoise_agc_target_db",
        alias = "denoiseAgcTargetDb",
        default = "default_agc_target_db"
    )]
    pub denoise_agc_target_db: f32,
}

fn default_highpass() -> bool {
    true
}
fn default_highpass_hz() -> f32 {
    80.0
}
fn default_gate() -> bool {
    true
}
fn default_gate_db() -> f32 {
    -45.0
}
fn default_rnnoise() -> bool {
    false
}
fn default_agc() -> bool {
    false
}
fn default_agc_target_db() -> f32 {
    -20.0
}

impl Default for DenoiseConfig {
    fn default() -> Self {
        Self {
            denoise_highpass: true,
            denoise_highpass_hz: 80.0,
            denoise_gate: true,
            denoise_gate_db: -45.0,
            denoise_rnnoise: false,
            denoise_agc: false,
            denoise_agc_target_db: -20.0,
        }
    }
}

/// Reads denoise settings from SQLite database connection.
pub fn load_denoise_config_from_db(conn: &rusqlite::Connection) -> DenoiseConfig {
    use crate::stt::pref_read;
    DenoiseConfig {
        denoise_highpass: pref_read(conn, "tempo_speech_denoise_highpass", None, true),
        denoise_highpass_hz: pref_read(conn, "tempo_speech_denoise_highpass_hz", None, 80.0),
        denoise_gate: pref_read(conn, "tempo_speech_denoise_gate", None, true),
        denoise_gate_db: pref_read(conn, "tempo_speech_denoise_gate_db", None, -45.0),
        denoise_rnnoise: pref_read(conn, "tempo_speech_denoise_rnnoise", None, false),
        denoise_agc: pref_read(conn, "tempo_speech_denoise_agc", None, false),
        denoise_agc_target_db: pref_read(conn, "tempo_speech_denoise_agc_target_db", None, -20.0),
    }
}

/// Reads denoise settings using app handle.
pub fn read_denoise_preference(app: &tauri::AppHandle) -> DenoiseConfig {
    crate::storage::with_db(app, |conn| Ok(load_denoise_config_from_db(conn))).unwrap_or_default()
}

use crate::stt::capture::resample_linear;

// ---------------------------------------------------------------------------
// Block 1: RNNoise Neural Noise Suppression
// ---------------------------------------------------------------------------

/// State-holding processor for RNNoise.
/// Maintains continuity of RNN internal states across callback chunks.
pub struct RnnoiseProcessor {
    sample_rate: u32,
    channels: u16,
    states: Vec<Box<nnnoiseless::DenoiseState<'static>>>,
}

impl RnnoiseProcessor {
    pub fn new(sample_rate: u32, channels: u16) -> Self {
        let ch = channels.max(1) as usize;
        let mut states = Vec::with_capacity(ch);
        for _ in 0..ch {
            states.push(nnnoiseless::DenoiseState::new());
        }
        Self {
            sample_rate,
            channels,
            states,
        }
    }

    pub fn process_mono(&mut self, channel_samples: &mut [f32], channel_idx: usize) {
        if channel_samples.is_empty() || self.sample_rate == 0 {
            return;
        }
        let orig_len = channel_samples.len();
        let at_48k = if self.sample_rate == 48_000 {
            channel_samples.to_vec()
        } else {
            resample_linear(channel_samples, self.sample_rate, 48_000)
        };

        let frame_size = nnnoiseless::DenoiseState::FRAME_SIZE;
        let mut denoised_48k = Vec::with_capacity(at_48k.len() + frame_size);
        let mut in_buf = [0.0f32; nnnoiseless::DenoiseState::FRAME_SIZE];
        let mut out_buf = [0.0f32; nnnoiseless::DenoiseState::FRAME_SIZE];

        let state = if channel_idx < self.states.len() {
            &mut self.states[channel_idx]
        } else {
            &mut self.states[0]
        };

        for chunk in at_48k.chunks(frame_size) {
            in_buf.fill(0.0);
            for (i, &s) in chunk.iter().enumerate() {
                in_buf[i] = (s * 32767.0).clamp(-32768.0, 32767.0);
            }
            state.process_frame(&mut out_buf, &in_buf);
            for &s in &out_buf[..chunk.len()] {
                denoised_48k.push((s / 32767.0).clamp(-1.0, 1.0));
            }
        }

        if self.sample_rate == 48_000 {
            channel_samples.copy_from_slice(&denoised_48k[..orig_len]);
        } else {
            let mut back = resample_linear(&denoised_48k[..at_48k.len()], 48_000, self.sample_rate);
            back.resize(orig_len, 0.0);
            channel_samples.copy_from_slice(&back[..orig_len]);
        }
    }

    pub fn process(&mut self, samples: &mut [f32]) {
        if samples.is_empty() || self.channels == 0 || self.sample_rate == 0 {
            return;
        }
        let ch = self.channels as usize;
        if ch == 1 {
            self.process_mono(samples, 0);
        } else {
            let num_frames = samples.len() / ch;
            for c in 0..ch {
                let mut mono = Vec::with_capacity(num_frames);
                for f in 0..num_frames {
                    mono.push(samples[f * ch + c]);
                }
                self.process_mono(&mut mono, c);
                for f in 0..num_frames {
                    samples[f * ch + c] = mono[f];
                }
            }
        }
    }
}

/// Applies RNNoise neural noise suppression to interleaved audio in-place.
pub fn apply_rnnoise(samples: &mut [f32], sample_rate: u32, channels: u16) {
    let mut proc = RnnoiseProcessor::new(sample_rate, channels);
    proc.process(samples);
}

// ---------------------------------------------------------------------------
// Block 2: High-pass Filter (2nd-order Butterworth Biquad)
// ---------------------------------------------------------------------------

/// State-holding 2nd-order Butterworth high-pass filter.
/// Carries biquad filter history [x1, x2, y1, y2] across chunk callbacks.
pub struct HighPassFilter {
    nb0: f32,
    nb1: f32,
    nb2: f32,
    na1: f32,
    na2: f32,
    channels: usize,
    states: Vec<[f32; 4]>,
}

impl HighPassFilter {
    pub fn new(sample_rate: u32, cutoff_hz: f32, channels: u16) -> Self {
        let ch = channels.max(1) as usize;
        if sample_rate == 0 || cutoff_hz <= 0.0 {
            return Self {
                nb0: 1.0, nb1: 0.0, nb2: 0.0, na1: 0.0, na2: 0.0,
                channels: ch,
                states: vec![[0.0; 4]; ch],
            };
        }
        let nyquist = sample_rate as f32 * 0.5;
        let cutoff = cutoff_hz.clamp(1.0, nyquist * 0.99);
        let omega = 2.0 * std::f32::consts::PI * cutoff / sample_rate as f32;
        let cos_omega = omega.cos();
        let sin_omega = omega.sin();
        let q = 1.0 / std::f32::consts::SQRT_2;
        let alpha = sin_omega / (2.0 * q);

        let b0 = (1.0 + cos_omega) / 2.0;
        let b1 = -(1.0 + cos_omega);
        let b2 = (1.0 + cos_omega) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_omega;
        let a2 = 1.0 - alpha;

        Self {
            nb0: b0 / a0,
            nb1: b1 / a0,
            nb2: b2 / a0,
            na1: a1 / a0,
            na2: a2 / a0,
            channels: ch,
            states: vec![[0.0; 4]; ch],
        }
    }

    pub fn process(&mut self, samples: &mut [f32]) {
        if samples.is_empty() || self.channels == 0 {
            return;
        }
        let ch = self.channels;
        for frame in samples.chunks_exact_mut(ch) {
            for (c, sample) in frame.iter_mut().enumerate() {
                let x0 = *sample;
                let st = &mut self.states[c];
                let y0 = self.nb0 * x0 + self.nb1 * st[0] + self.nb2 * st[1] - self.na1 * st[2] - self.na2 * st[3];
                st[1] = st[0];
                st[0] = x0;
                st[3] = st[2];
                st[2] = y0;
                *sample = y0.clamp(-1.0, 1.0);
            }
        }
    }
}

/// Applies a 2nd-order Butterworth high-pass filter in-place.
pub fn apply_highpass(samples: &mut [f32], sample_rate: u32, cutoff_hz: f32, channels: u16) {
    let mut filter = HighPassFilter::new(sample_rate, cutoff_hz, channels);
    filter.process(samples);
}

// ---------------------------------------------------------------------------
// Block 3: Smoothed Noise Gate with Attack, Release, and Hangover
// ---------------------------------------------------------------------------

/// State-holding noise gate with VAD-discipline smoothing.
/// Hangover keeps soft consonants and word tails from being zeroed;
/// attack and release gain interpolation prevents boundary clicks.
pub struct SmoothedGate {
    threshold_linear: f32,
    sample_rate: u32,
    channels: usize,
    frame_samples: usize,
    in_speech: bool,
    hangover_frames: usize,
    hangover_counter: usize,
    current_gain: f32,
    target_gain: f32,
    initialized: bool,
}

impl SmoothedGate {
    pub const DEFAULT_HANGOVER_FRAMES: usize = 10; // ~300 ms at 30 ms frames

    pub fn new(sample_rate: u32, threshold_db: f32, channels: u16) -> Self {
        let threshold_linear = 10.0f32.powf(threshold_db / 20.0);
        let ch = channels.max(1) as usize;
        let frame_samples = ((sample_rate as f32 * 0.030).round() as usize).max(1);
        Self {
            threshold_linear,
            sample_rate,
            channels: ch,
            frame_samples,
            in_speech: false,
            hangover_frames: Self::DEFAULT_HANGOVER_FRAMES,
            hangover_counter: 0,
            current_gain: 0.0,
            target_gain: 0.0,
            initialized: false,
        }
    }

    pub fn process(&mut self, samples: &mut [f32]) {
        if samples.is_empty() || self.channels == 0 || self.sample_rate == 0 {
            return;
        }
        let ch = self.channels;
        let stride = self.frame_samples * ch;

        for chunk in samples.chunks_mut(stride) {
            let num_frames = chunk.len() / ch;
            if num_frames == 0 {
                continue;
            }

            // Compute average RMS across channels for this frame
            let mut sum_sq = 0.0f32;
            for f in 0..num_frames {
                let mut sum = 0.0f32;
                for c in 0..ch {
                    sum += chunk[f * ch + c];
                }
                let avg = sum / ch as f32;
                sum_sq += avg * avg;
            }
            let frame_rms = (sum_sq / num_frames as f32).sqrt();

            let is_speech = frame_rms >= self.threshold_linear;

            if !self.initialized {
                self.initialized = true;
                if is_speech {
                    self.in_speech = true;
                    self.hangover_counter = self.hangover_frames;
                    self.current_gain = 1.0;
                    self.target_gain = 1.0;
                } else {
                    self.in_speech = false;
                    self.hangover_counter = 0;
                    self.current_gain = 0.0;
                    self.target_gain = 0.0;
                }
            } else if is_speech {
                self.in_speech = true;
                self.hangover_counter = self.hangover_frames;
                self.target_gain = 1.0;
            } else if self.in_speech {
                // Speech frame was quiet: hangover preserves consonants and word endings
                if self.hangover_counter > 0 {
                    self.hangover_counter -= 1;
                    self.target_gain = 1.0;
                } else {
                    self.in_speech = false;
                    self.target_gain = 0.0;
                }
            } else {
                self.target_gain = 0.0;
            }

            let start_gain = self.current_gain;
            let end_gain = self.target_gain;
            let chunk_len = chunk.len();

            if (start_gain - end_gain).abs() < 1e-5 {
                if end_gain == 0.0 {
                    chunk.fill(0.0);
                } else if (end_gain - 1.0).abs() > 1e-5 {
                    for s in chunk.iter_mut() {
                        *s *= end_gain;
                    }
                }
                self.current_gain = end_gain;
            } else {
                // Smooth ramp (attack or release) avoiding boundary clicks
                for (i, s) in chunk.iter_mut().enumerate() {
                    let t = (i + 1) as f32 / chunk_len as f32;
                    let g = start_gain + (end_gain - start_gain) * t;
                    *s *= g;
                }
                self.current_gain = end_gain;
            }
        }
    }
}

/// Applies a noise gate keyed off VAD energy with attack, release, and hangover.
pub fn apply_gate(samples: &mut [f32], sample_rate: u32, threshold_db: f32, channels: u16) {
    let mut gate = SmoothedGate::new(sample_rate, threshold_db, channels);
    gate.process(samples);
}

// ---------------------------------------------------------------------------
// Block 4: AGC (Automatic Gain Control)
// ---------------------------------------------------------------------------

/// State-holding AGC processor.
/// Ignores room noise below floor (-45 dB), caps gain at MAX_AGC_GAIN (8.0x),
/// and smoothly ramps gain sample-by-sample to avoid zipper noise.
pub struct AgcProcessor {
    target_rms: f32,
    sample_rate: u32,
    channels: usize,
    frame_samples: usize,
    current_gain: f32,
    prev_sample_gain: f32,
    initialized: bool,
}

impl AgcProcessor {
    pub const AGC_FLOOR_DB: f32 = -45.0; // Room noise floor threshold
    pub const MAX_AGC_GAIN: f32 = 8.0;   // Hard ceiling (+18 dB max boost)
    pub const MIN_AGC_GAIN: f32 = 0.2;

    pub fn new(sample_rate: u32, target_db: f32, channels: u16) -> Self {
        let target_rms = 10.0f32.powf(target_db / 20.0);
        let ch = channels.max(1) as usize;
        let frame_samples = ((sample_rate as f32 * 0.030).round() as usize).max(1) * ch;
        Self {
            target_rms,
            sample_rate,
            channels: ch,
            frame_samples,
            current_gain: 1.0,
            prev_sample_gain: 1.0,
            initialized: false,
        }
    }

    pub fn process(&mut self, samples: &mut [f32]) {
        if samples.is_empty() || self.channels == 0 || self.sample_rate == 0 {
            return;
        }
        let floor_rms = 10.0f32.powf(Self::AGC_FLOOR_DB / 20.0);

        for chunk in samples.chunks_mut(self.frame_samples) {
            let mut sum_sq = 0.0f32;
            let mut peak = 0.0f32;
            for &s in chunk.iter() {
                sum_sq += s * s;
                let abs = s.abs();
                if abs > peak {
                    peak = abs;
                }
            }
            let frame_rms = (sum_sq / chunk.len() as f32).sqrt();

            // Floor check: room noise or gated frame below floor -> unity gain (no amplification of noise)
            let target_frame_gain = if frame_rms < floor_rms {
                1.0f32
            } else {
                let desired = (self.target_rms / frame_rms).clamp(Self::MIN_AGC_GAIN, Self::MAX_AGC_GAIN);
                let peak_cap = if peak > 0.0 { (0.95 / peak).min(Self::MAX_AGC_GAIN) } else { Self::MAX_AGC_GAIN };
                desired.min(peak_cap)
            };

            if !self.initialized {
                self.current_gain = target_frame_gain;
                self.prev_sample_gain = target_frame_gain;
                self.initialized = true;
            } else {
                self.current_gain = self.current_gain * 0.85 + target_frame_gain * 0.15;
            }

            let peak_limit = if peak > 0.0 { 0.99 / peak } else { Self::MAX_AGC_GAIN };
            let end_gain = self.current_gain.min(peak_limit);

            // Sample-by-sample linear ramping across the chunk (No zipper noise)
            let start_gain = self.prev_sample_gain;
            let chunk_len = chunk.len();
            for (i, s) in chunk.iter_mut().enumerate() {
                let t = (i + 1) as f32 / chunk_len as f32;
                let g = start_gain + (end_gain - start_gain) * t;
                *s = (*s * g).clamp(-1.0, 1.0);
            }
            self.prev_sample_gain = end_gain;
        }
    }
}

/// Applies Automatic Gain Control (AGC) in-place.
pub fn apply_agc(samples: &mut [f32], target_db: f32, sample_rate: u32, channels: u16) {
    let mut agc = AgcProcessor::new(sample_rate, target_db, channels);
    agc.process(samples);
}

// ---------------------------------------------------------------------------
// Full Denoise Pipeline
// ---------------------------------------------------------------------------

/// State-holding complete noise suppression pipeline.
/// Created once per stream to preserve RNNoise, biquad filter, gate, and AGC state across callbacks.
pub struct DenoisePipeline {
    config: DenoiseConfig,
    sample_rate: u32,
    channels: u16,
    rnnoise: Option<RnnoiseProcessor>,
    highpass: Option<HighPassFilter>,
    gate: Option<SmoothedGate>,
    agc: Option<AgcProcessor>,
}

impl DenoisePipeline {
    pub fn new(config: DenoiseConfig, sample_rate: u32, channels: u16) -> Self {
        let rnnoise = if config.denoise_rnnoise {
            Some(RnnoiseProcessor::new(sample_rate, channels))
        } else {
            None
        };
        let highpass = if config.denoise_highpass {
            Some(HighPassFilter::new(sample_rate, config.denoise_highpass_hz, channels))
        } else {
            None
        };
        let gate = if config.denoise_gate {
            Some(SmoothedGate::new(sample_rate, config.denoise_gate_db, channels))
        } else {
            None
        };
        let agc = if config.denoise_agc {
            Some(AgcProcessor::new(sample_rate, config.denoise_agc_target_db, channels))
        } else {
            None
        };

        Self {
            config,
            sample_rate,
            channels,
            rnnoise,
            highpass,
            gate,
            agc,
        }
    }

    pub fn config(&self) -> &DenoiseConfig {
        &self.config
    }

    pub fn process(&mut self, samples: &mut [f32]) {
        if samples.is_empty() || self.channels == 0 || self.sample_rate == 0 {
            return;
        }

        // 1. RNNoise (neural noise suppression)
        if let Some(rnnoise) = &mut self.rnnoise {
            rnnoise.process(samples);
        }

        // 2. High-pass filter
        if let Some(highpass) = &mut self.highpass {
            highpass.process(samples);
        }

        // 3. Noise gate
        if let Some(gate) = &mut self.gate {
            gate.process(samples);
        }

        // 4. AGC
        if let Some(agc) = &mut self.agc {
            agc.process(samples);
        }
    }
}

/// Applies the noise suppression chain in the frozen contract order:
/// RNNoise -> High-pass -> Gate -> AGC.
pub fn apply_denoise_chain(
    samples: &mut [f32],
    sample_rate: u32,
    channels: u16,
    config: &DenoiseConfig,
) {
    let mut pipeline = DenoisePipeline::new(config.clone(), sample_rate, channels);
    pipeline.process(samples);
}
#[cfg(test)]
mod tests {
    use super::*;

    fn generate_sine(freq_hz: f32, sample_rate: u32, duration_sec: f32, amplitude: f32) -> Vec<f32> {
        let total_samples = (sample_rate as f32 * duration_sec) as usize;
        (0..total_samples)
            .map(|i| {
                let t = i as f32 / sample_rate as f32;
                (2.0 * std::f32::consts::PI * freq_hz * t).sin() * amplitude
            })
            .collect()
    }

    fn calculate_rms(samples: &[f32]) -> f32 {
        if samples.is_empty() {
            return 0.0;
        }
        let sum_sq: f32 = samples.iter().map(|&s| s * s).sum();
        (sum_sq / samples.len() as f32).sqrt()
    }

    #[test]
    fn test_denoise_defaults_match_contract() {
        let config = DenoiseConfig::default();
        assert!(config.denoise_highpass);
        assert!((config.denoise_highpass_hz - 80.0).abs() < 1e-6);
        assert!(config.denoise_gate);
        assert!((config.denoise_gate_db - -45.0).abs() < 1e-6);
        assert!(!config.denoise_rnnoise);
        assert!(!config.denoise_agc);
        assert!((config.denoise_agc_target_db - -20.0).abs() < 1e-6);
    }

    #[test]
    fn test_highpass_attenuates_40hz_and_keeps_1khz() {
        let sample_rate = 48000;
        let cutoff_hz = 80.0;
        let duration = 0.5;

        let mut tone_40hz = generate_sine(40.0, sample_rate, duration, 0.5);
        let orig_rms_40 = calculate_rms(&tone_40hz);
        apply_highpass(&mut tone_40hz, sample_rate, cutoff_hz, 1);
        let filtered_rms_40 = calculate_rms(&tone_40hz);

        let mut tone_1khz = generate_sine(1000.0, sample_rate, duration, 0.5);
        let orig_rms_1k = calculate_rms(&tone_1khz);
        apply_highpass(&mut tone_1khz, sample_rate, cutoff_hz, 1);
        let filtered_rms_1k = calculate_rms(&tone_1khz);

        // 40 Hz is 1 octave below cutoff: 2nd-order Butterworth attenuates by > 10 dB (> 65% reduction)
        let ratio_40 = filtered_rms_40 / orig_rms_40;
        assert!(
            ratio_40 < 0.35,
            "40 Hz tone was not sufficiently attenuated: ratio was {ratio_40}"
        );

        // 1 kHz is far into the passband: kept (> 98% preserved)
        let ratio_1k = filtered_rms_1k / orig_rms_1k;
        assert!(
            ratio_1k > 0.95,
            "1 kHz tone was attenuated too much: ratio was {ratio_1k}"
        );
    }

    #[test]
    fn test_gate_silences_below_threshold_and_passes_speech() {
        let sample_rate = 48000;
        let threshold_db = -45.0; // linear ~0.0056

        // Below threshold: amplitude 0.001 (-60 dB)
        let mut quiet_frame = vec![0.001f32; 1440];
        apply_gate(&mut quiet_frame, sample_rate, threshold_db, 1);
        assert!(
            quiet_frame.iter().all(|&s| s == 0.0),
            "Gate did not silence below-threshold frame"
        );

        // Speech-level: amplitude 0.1 (-20 dB)
        let mut speech_frame = vec![0.1f32; 1440];
        apply_gate(&mut speech_frame, sample_rate, threshold_db, 1);
        assert!(
            speech_frame.iter().all(|&s| (s - 0.1).abs() < 1e-6),
            "Gate modified speech-level frame above threshold"
        );
    }

    #[test]
    fn test_rnnoise_preserves_frame_count_channel_count_and_duration() {
        for &sample_rate in &[16000, 44100, 48000] {
            for &channels in &[1u16, 2u16] {
                let duration_sec = 0.25;
                let num_frames = (sample_rate as f32 * duration_sec).round() as usize;
                let total_samples = num_frames * channels as usize;

                let mut audio = generate_sine(440.0, sample_rate, duration_sec, 0.2);
                if channels == 2 {
                    let mut stereo = Vec::with_capacity(total_samples);
                    for &s in &audio {
                        stereo.push(s);
                        stereo.push(s * 0.8);
                    }
                    audio = stereo;
                }

                assert_eq!(audio.len(), total_samples);
                apply_rnnoise(&mut audio, sample_rate, channels);

                // Frame count, channel count, and length/duration must be strictly preserved
                assert_eq!(
                    audio.len(),
                    total_samples,
                    "RNNoise altered length at sr={sample_rate}, ch={channels}"
                );
                let actual_frames = audio.len() / channels as usize;
                assert_eq!(actual_frames, num_frames);
                let actual_duration = actual_frames as f32 / sample_rate as f32;
                assert!((actual_duration - duration_sec).abs() < 1e-4);
            }
        }
    }

    #[test]
    fn test_agc_lifts_quiet_signal_without_clipping() {
        let sample_rate = 48000;
        let duration = 0.5;

        // Quiet 1 kHz tone at amplitude 0.01 (-40 dB, RMS ~0.007)
        let mut quiet_tone = generate_sine(1000.0, sample_rate, duration, 0.01);
        let orig_rms = calculate_rms(&quiet_tone);
        assert!(orig_rms < 0.015);

        // Include a gated/silent section at the end
        quiet_tone.extend(vec![0.0f32; 1440]);
        let silent_start = (sample_rate as f32 * duration) as usize;

        apply_agc(&mut quiet_tone, -20.0, sample_rate, 1);

        let active_rms = calculate_rms(&quiet_tone[..silent_start]);
        // Target -20 dB corresponds to RMS 0.1
        assert!(
            active_rms > 0.05,
            "AGC did not lift quiet signal: RMS was {active_rms}"
        );

        // No clipping: all samples must remain within [-1.0, 1.0]
        let max_val = quiet_tone.iter().fold(0.0f32, |acc, &s| acc.max(s.abs()));
        assert!(
            max_val <= 1.0,
            "AGC caused clipping: max sample was {max_val}"
        );

        // Gated section must be left alone (all zeros)
        assert!(
            quiet_tone[silent_start..].iter().all(|&s| s == 0.0),
            "AGC amplified gated frames"
        );
    }

    #[test]
    fn test_gate_does_not_chop_soft_speech_consonants_with_hangover() {
        let sample_rate = 48000;
        let threshold_db = -45.0; // linear ~0.0056
        let frame_size = 1440; // 30 ms

        // Frame 1: Voiced speech (0.1 = -20 dB, well above threshold)
        let frame1 = vec![0.1f32; frame_size];
        // Frame 2: Soft consonant / word tail (0.003 = -50 dB, below -45 dB threshold)
        let frame2 = vec![0.003f32; frame_size];
        // Frame 3: Resumed speech (0.1 = -20 dB)
        let frame3 = vec![0.1f32; frame_size];

        let mut speech_sequence = Vec::new();
        speech_sequence.extend_from_slice(&frame1);
        speech_sequence.extend_from_slice(&frame2);
        speech_sequence.extend_from_slice(&frame3);

        let mut gate = SmoothedGate::new(sample_rate, threshold_db, 1);
        gate.process(&mut speech_sequence);

        // Frame 2 is a soft consonant within an utterance: hangover must NOT zero it!
        let processed_frame2 = &speech_sequence[frame_size..2 * frame_size];
        let non_zero_count = processed_frame2.iter().filter(|&&s| s != 0.0).count();
        assert!(
            non_zero_count > 0,
            "Gate chopped soft consonant frame within speech utterance to all 0.0"
        );
        let frame2_rms = calculate_rms(processed_frame2);
        assert!(
            frame2_rms > 0.001,
            "Soft consonant frame was attenuated to near-zero: RMS was {frame2_rms}"
        );
    }

    #[test]
    fn test_continuous_denoise_pipeline_differs_from_reset_state() {
        let sample_rate = 48000;
        let config = DenoiseConfig {
            denoise_highpass: true,
            denoise_highpass_hz: 80.0,
            denoise_gate: true,
            denoise_gate_db: -45.0,
            denoise_rnnoise: false,
            denoise_agc: true,
            denoise_agc_target_db: -20.0,
        };

        let chunk1 = generate_sine(200.0, sample_rate, 0.03, 0.08);
        let chunk2 = generate_sine(300.0, sample_rate, 0.03, 0.06);

        // Continuous pipeline: retains biquad filter history and AGC gain across chunks
        let mut continuous_pipeline = DenoisePipeline::new(config.clone(), sample_rate, 1);
        let mut c1 = chunk1.clone();
        let mut c2 = chunk2.clone();
        continuous_pipeline.process(&mut c1);
        continuous_pipeline.process(&mut c2);

        // Reset pipeline: chunk2 processed through a newly constructed pipeline (simulating old CPAL callback bug)
        let mut reset_pipeline = DenoisePipeline::new(config, sample_rate, 1);
        let mut r2 = chunk2;
        reset_pipeline.process(&mut r2);

        // Because continuous pipeline retains state from chunk1, c2 MUST differ from r2!
        let max_diff = c2.iter().zip(r2.iter()).map(|(a, b)| (a - b).abs()).fold(0.0f32, f32::max);
        assert!(
            max_diff > 1e-4,
            "Continuous pipeline produced identical output to reset pipeline: state is not carried over! max_diff was {max_diff}"
        );
    }

    #[test]
    fn test_agc_ignores_room_noise_and_respects_ceiling() {
        let sample_rate = 48000;
        let duration = 0.3; // 10 frames of 30 ms

        // 1. Room noise: amplitude 0.002 (-54 dB, RMS ~0.0014)
        let mut room_noise = generate_sine(500.0, sample_rate, duration, 0.002);
        let orig_noise_rms = calculate_rms(&room_noise);

        let mut agc = AgcProcessor::new(sample_rate, -20.0, 1);
        agc.process(&mut room_noise);
        let post_noise_rms = calculate_rms(&room_noise);

        // Room noise must NOT be amplified 30x (gain ratio must be <= 1.5, not 30.0)
        let noise_gain = post_noise_rms / orig_noise_rms;
        assert!(
            noise_gain <= 1.5,
            "AGC pumped room noise: gain was {noise_gain}x (expected <= 1.5x)"
        );

        // 2. Quiet speech above floor: amplitude 0.015 (-36 dB, RMS ~0.0106)
        let mut speech = generate_sine(1000.0, sample_rate, duration, 0.015);
        let orig_speech_rms = calculate_rms(&speech);

        let mut agc_speech = AgcProcessor::new(sample_rate, -20.0, 1);
        agc_speech.process(&mut speech);
        let post_speech_rms = calculate_rms(&speech);

        let speech_gain = post_speech_rms / orig_speech_rms;
        // Gain must be lifted towards target but NEVER exceed MAX_AGC_GAIN (8.0x)
        assert!(
            speech_gain <= AgcProcessor::MAX_AGC_GAIN + 0.1,
            "AGC exceeded maximum gain ceiling: gain was {speech_gain}x"
        );
        assert!(
            speech_gain > 1.5,
            "AGC did not boost quiet speech above room noise floor: gain was {speech_gain}x"
        );
    }
}
