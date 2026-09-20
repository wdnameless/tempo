//! Audio capture with cpal and energy VAD.
//! Utterance starts after level exceeds energy threshold, ends after pause.
//! Leading/trailing silence is trimmed. Pure silence returns NoSpeech.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

/// 16 kHz sample rate as required by Whisper.
pub const SAMPLE_RATE: u32 = 16_000;

/// Default energy threshold for VAD (RMS value).
pub const DEFAULT_ENERGY_THRESHOLD: f32 = 0.015;

/// Pause duration (silence) to consider speech ended (e.g. 700ms).
pub const DEFAULT_PAUSE_DURATION: Duration = Duration::from_millis(700);

/// Minimum utterance duration to not be rejected as spurious noise (e.g. 200ms).
pub const MIN_UTTERANCE_DURATION: Duration = Duration::from_millis(200);

/// Padding kept before/after speech in trimmed output (e.g. 150ms).
pub const PADDING_DURATION: Duration = Duration::from_millis(150);

/// Capture error condition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureError {
    NoMicrophone,
    NoSpeech,
    DeviceBusy(String),
    RecordingFailed(String),
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoMicrophone => write!(f, "no_microphone"),
            Self::NoSpeech => write!(f, "no_speech"),
            Self::DeviceBusy(msg) => write!(f, "device busy: {msg}"),
            Self::RecordingFailed(msg) => write!(f, "recording failed: {msg}"),
        }
    }
}

impl std::error::Error for CaptureError {}

/// State of an ongoing audio capture session.
#[derive(Clone)]
pub struct AudioCaptureState {
    stop_signal: Arc<AtomicBool>,
    current_level: Arc<Mutex<f32>>,
    _captured_samples: Arc<Mutex<Vec<f32>>>,
    is_active: Arc<AtomicBool>,
}

pub type CaptureState = AudioCaptureState;

impl AudioCaptureState {
    pub fn new() -> Self {
        Self {
            stop_signal: Arc::new(AtomicBool::new(false)),
            current_level: Arc::new(Mutex::new(0.0)),
            _captured_samples: Arc::new(Mutex::new(Vec::new())),
            is_active: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn is_recording(&self) -> bool {
        self.is_active.load(Ordering::SeqCst)
    }

    pub fn level(&self) -> f32 {
        *self.current_level.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn request_stop(&self) {
        self.stop_signal.store(true, Ordering::SeqCst);
    }
}

impl Default for AudioCaptureState {
    fn default() -> Self {
        Self::new()
    }
}

/// Handle to a running capture thread.
pub struct AudioCaptureHandle {
    stop_tx: Sender<()>,
    join_handle: Option<JoinHandle<Result<Vec<f32>, CaptureError>>>,
    pub state: AudioCaptureState,
}

impl AudioCaptureHandle {
    pub fn stop(mut self) -> Result<Vec<f32>, CaptureError> {
        let _ = self.stop_tx.send(());
        self.state.request_stop();
        if let Some(h) = self.join_handle.take() {
            h.join().unwrap_or(Err(CaptureError::RecordingFailed("thread panic".into())))
        } else {
            Err(CaptureError::RecordingFailed("no thread".into()))
        }
    }
    pub fn cancel(mut self) {
        let _ = self.stop_tx.send(());
        self.state.request_stop();
        if let Some(h) = self.join_handle.take() {
            let _ = h.join();
        }
    }
}

/// Spawns a background thread that records from cpal and collects 16kHz mono f32 samples.
pub fn start_audio_capture(
    device_name: Option<String>,
    energy_threshold: f32,
    state: AudioCaptureState,
) -> Result<AudioCaptureHandle, CaptureError> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let (stop_tx, stop_rx) = channel::<()>();
    let state_clone = state.clone();

    // Verify host and device availability before spawning thread
    let host = cpal::default_host();
    let device = if let Some(ref name) = device_name {
        host.input_devices()
            .map_err(|e| CaptureError::RecordingFailed(e.to_string()))?
            .find(|d| d.name().map(|n| n == *name).unwrap_or(false))
            .ok_or(CaptureError::NoMicrophone)?
    } else {
        host.default_input_device().ok_or(CaptureError::NoMicrophone)?
    };

    let config = device
        .default_input_config()
        .map_err(|e| CaptureError::RecordingFailed(e.to_string()))?;

    let thread_handle = std::thread::spawn(move || {
        let sample_rate = config.sample_rate().0;
        let channels = config.channels();

        let raw_samples = Arc::new(Mutex::new(Vec::<f32>::new()));
        let raw_samples_cb = Arc::clone(&raw_samples);
        let level_cb = Arc::clone(&state_clone.current_level);

        let err_fn = |err| eprintln!("STT CPAL stream error: {err}");

        let stream_res = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config.into(),
                move |data: &[f32], _: &_| {
                    process_input_chunk_f32(data, channels, &raw_samples_cb, &level_cb);
                },
                err_fn,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config.into(),
                move |data: &[i16], _: &_| {
                    let f32_data: Vec<f32> = data
                        .iter()
                        .map(|&s| s as f32 / if s < 0 { 32768.0 } else { 32767.0 })
                        .collect();
                    process_input_chunk_f32(&f32_data, channels, &raw_samples_cb, &level_cb);
                },
                err_fn,
                None,
            ),
            cpal::SampleFormat::U16 => device.build_input_stream(
                &config.into(),
                move |data: &[u16], _: &_| {
                    let f32_data: Vec<f32> = data
                        .iter()
                        .map(|&s| (s as f32 - 32768.0) / 32768.0)
                        .collect();
                    process_input_chunk_f32(&f32_data, channels, &raw_samples_cb, &level_cb);
                },
                err_fn,
                None,
            ),
            _ => return Err(CaptureError::RecordingFailed("Unsupported sample format".into())),
        };

        let stream = match stream_res {
            Ok(s) => s,
            Err(e) => return Err(CaptureError::RecordingFailed(e.to_string())),
        };

        if let Err(e) = stream.play() {
            return Err(CaptureError::RecordingFailed(e.to_string()));
        }

        state_clone.is_active.store(true, Ordering::SeqCst);

        // Wait loop checking for stop_rx or stop_signal
        while !state_clone.stop_signal.load(Ordering::SeqCst) {
            if stop_rx.try_recv().is_ok() {
                break;
            }
            std::thread::sleep(Duration::from_millis(30));
        }

        drop(stream);
        state_clone.is_active.store(false, Ordering::SeqCst);
        *state_clone.current_level.lock().unwrap_or_else(|e| e.into_inner()) = 0.0;

        let gathered = raw_samples.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if gathered.is_empty() {
            return Err(CaptureError::NoSpeech);
        }

        // Resample from device sample_rate to 16 kHz
        let pcm_16k = resample_linear(&gathered, sample_rate, SAMPLE_RATE);

        // Trim silence with VAD
        let trimmed = vad_trim_silence(&pcm_16k, SAMPLE_RATE, energy_threshold)?;
        Ok(trimmed)
    });

    Ok(AudioCaptureHandle {
        stop_tx,
        join_handle: Some(thread_handle),
        state,
    })
}

fn process_input_chunk_f32(
    data: &[f32],
    channels: u16,
    buffer: &Arc<Mutex<Vec<f32>>>,
    level: &Arc<Mutex<f32>>,
) {
    if data.is_empty() {
        return;
    }
    // Convert to mono
    let mono: Vec<f32> = if channels <= 1 {
        data.to_vec()
    } else {
        data.chunks(channels as usize)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    };

    // Calculate RMS level
    let mut sum_sq = 0.0;
    for &sample in &mono {
        sum_sq += sample * sample;
    }
    let rms = (sum_sq / mono.len() as f32).sqrt();

    if let Ok(mut lvl) = level.lock() {
        *lvl = rms;
    }
    if let Ok(mut buf) = buffer.lock() {
        buf.extend_from_slice(&mono);
    }
}

/// Linear resampling mono PCM from src_rate to dst_rate.
pub fn resample_linear(input: &[f32], src_rate: u32, dst_rate: u32) -> Vec<f32> {
    if src_rate == dst_rate || input.is_empty() {
        return input.to_vec();
    }
    let ratio = src_rate as f64 / dst_rate as f64;
    let dst_len = ((input.len() as f64) / ratio).round() as usize;
    let mut output = Vec::with_capacity(dst_len);

    for i in 0..dst_len {
        let src_idx = i as f64 * ratio;
        let idx0 = src_idx.floor() as usize;
        let frac = (src_idx - idx0 as f64) as f32;
        let s0 = if idx0 < input.len() { input[idx0] } else { 0.0 };
        let s1 = if idx0 + 1 < input.len() { input[idx0 + 1] } else { s0 };
        output.push(s0 + frac * (s1 - s0));
    }
    output
}

/// A single loud frame is not speech.
///
/// A click, a keypress or a door closing exceeds the threshold for one 30 ms
/// frame, and handing that to Whisper makes it invent a phrase — "Thank you." is
/// the classic one. Silently dictating an invented sentence into someone's
/// document is worse than asking them to speak again, so an utterance must last:
/// at least this many frames above the threshold, and one run of at least half
/// that, which is what separates a voice from a knock.
pub const MIN_SPEECH_FRAMES: usize = 10; // ~300 ms in total
pub const MIN_SPEECH_RUN_FRAMES: usize = 5; // ~150 ms without a gap

/// Pure VAD silence trimming and detection.
/// Divides audio into 30ms frames, calculates RMS energy, finds first and last frame
/// above energy_threshold, applies padding, and returns trimmed PCM.
/// If the audio does not contain a sustained utterance, returns CaptureError::NoSpeech.
pub fn vad_trim_silence(
    pcm: &[f32],
    sample_rate: u32,
    threshold: f32,
) -> Result<Vec<f32>, CaptureError> {
    if pcm.is_empty() {
        return Err(CaptureError::NoSpeech);
    }

    let frame_size = (sample_rate as f32 * 0.030) as usize; // 30ms frames
    if frame_size == 0 {
        return Err(CaptureError::NoSpeech);
    }

    let mut speech_start_frame = None;
    let mut speech_end_frame = None;
    let mut speech_frames = 0usize;
    let mut run = 0usize;
    let mut longest_run = 0usize;

    let num_frames = pcm.len() / frame_size;
    for f in 0..num_frames {
        let frame = &pcm[f * frame_size..(f + 1) * frame_size];
        let mut sum_sq = 0.0f32;
        for &s in frame {
            sum_sq += s * s;
        }
        let rms = (sum_sq / frame.len() as f32).sqrt();
        if rms >= threshold {
            if speech_start_frame.is_none() {
                speech_start_frame = Some(f);
            }
            speech_end_frame = Some(f);
            speech_frames += 1;
            run += 1;
            longest_run = longest_run.max(run);
        } else {
            run = 0;
        }
    }

    if speech_frames < MIN_SPEECH_FRAMES || longest_run < MIN_SPEECH_RUN_FRAMES {
        return Err(CaptureError::NoSpeech);
    }

    let (start_f, end_f) = match (speech_start_frame, speech_end_frame) {
        (Some(s), Some(e)) => (s, e),
        _ => return Err(CaptureError::NoSpeech),
    };

    let pad_frames = ((sample_rate as f32 * 0.150) / frame_size as f32).ceil() as usize; // 150ms padding
    let first_frame = start_f.saturating_sub(pad_frames);
    let last_frame = (end_f + pad_frames + 1).min(num_frames);

    let start_sample = first_frame * frame_size;
    let end_sample = (last_frame * frame_size).min(pcm.len());

    let trimmed = pcm[start_sample..end_sample].to_vec();
    if trimmed.is_empty() {
        return Err(CaptureError::NoSpeech);
    }

    Ok(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pure_silence_returns_no_speech() {
        let silence = vec![0.0f32; 16000 * 2]; // 2 seconds of 0
        let result = vad_trim_silence(&silence, 16000, 0.015);
        assert_eq!(result, Err(CaptureError::NoSpeech));
    }

    #[test]
    fn trims_leading_and_trailing_silence() {
        let rate = 16000;
        let mut audio = vec![0.0f32; rate]; // 1s silence
        let speech = vec![0.2f32; rate]; // 1s tone/speech
        let trailing = vec![0.0f32; rate]; // 1s silence

        audio.extend_from_slice(&speech);
        audio.extend_from_slice(&trailing);

        let trimmed = vad_trim_silence(&audio, rate as u32, 0.015).expect("speech found");
        assert!(trimmed.len() < audio.len());
        assert!(trimmed.len() >= rate); // contains at least the 1s speech plus padding
    }

    #[test]
    fn linear_resample_preserves_length_proportion() {
        let input = vec![0.5f32; 48000]; // 1 sec at 48k
        let resampled = resample_linear(&input, 48000, 16000);
        assert_eq!(resampled.len(), 16000);
    }
    /// A knock, a keypress or a door is not speech, and handing one to Whisper
    /// makes it invent a sentence. This is the defect the live check found: a
    /// single loud frame produced "Thank you." out of near silence.
    #[test]
    fn a_single_loud_frame_is_not_speech() {
        let rate = 16000usize;
        let mut audio = vec![0.0f32; rate * 2];
        // One 30 ms frame of a loud transient in the middle of silence.
        for s in audio.iter_mut().skip(rate).take(rate / 33) {
            *s = 0.5;
        }
        assert_eq!(
            vad_trim_silence(&audio, rate as u32, 0.015),
            Err(CaptureError::NoSpeech)
        );
    }

    /// Speech shorter than a syllable is not an utterance either.
    #[test]
    fn a_brief_burst_is_not_speech() {
        let rate = 16000usize;
        let mut audio = vec![0.0f32; rate * 2];
        // ~100 ms of tone: below MIN_SPEECH_FRAMES and below the longest run.
        for s in audio.iter_mut().skip(rate).take(rate / 10) {
            *s = 0.3;
        }
        assert_eq!(
            vad_trim_silence(&audio, rate as u32, 0.015),
            Err(CaptureError::NoSpeech)
        );
    }
}
