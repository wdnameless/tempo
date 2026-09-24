//! Audio capture with cpal, multi-device enumeration, channel selection, and smoothed VAD.
//!
//! Captures audio at the input device's native rate and format (F32/I16/U16/I32),
//! selects or averages channels, resamples to 16 kHz mono PCM using linear interpolation,
//! and trims leading/trailing silence using the configured [`VadConfig`] smoothing gate.
//!
//! Utterances require sustained voicing (onset confirmation, default 60 ms) to declare speech;
//! isolated spikes (clicks, keypresses) are suppressed so Whisper never hallucinates phrases
//! from background noise.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime};
use serde::{Deserialize, Serialize};

use crate::stt::vad::{self, VadConfig};

/// 16 kHz sample rate as required by Whisper.
pub const SAMPLE_RATE: u32 = 16_000;

/// Default energy threshold for VAD (RMS value).
pub const DEFAULT_ENERGY_THRESHOLD: f32 = 0.015;

/// Pause duration (silence) to consider speech ended (e.g. 700ms).
pub const DEFAULT_PAUSE_DURATION: Duration = Duration::from_millis(700);

/// Minimum utterance duration to not be rejected as spurious noise (200ms = 3200 samples @ 16kHz).
pub const MIN_UTTERANCE_DURATION: Duration = Duration::from_millis(200);

/// Padding kept before/after speech in trimmed output (150ms).
pub const PADDING_DURATION: Duration = Duration::from_millis(150);

/// Minimum speech frame thresholds for legacy detection.
pub const MIN_SPEECH_FRAMES: usize = 10;
pub const MIN_SPEECH_RUN_FRAMES: usize = 5;

// ---------------------------------------------------------------------------
// Device Enumeration & Types
// ---------------------------------------------------------------------------

/// Information about an enumerated audio input device.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
    pub channels: u16,
}

/// Lists all available audio input devices (microphones).
pub fn input_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let default_name = host.default_input_device().and_then(|d| d.name().ok());
    let mut out = Vec::new();

    let devices = host.input_devices().map_err(|e| format!("Failed to list input devices: {e}"))?;
    for device in devices {
        let name = device.name().unwrap_or_else(|_| "Unknown".into());
        let is_default = Some(&name) == default_name.as_ref();
        let channels = device
            .default_input_config()
            .map(|c| c.channels())
            .unwrap_or(1);
        out.push(AudioDeviceInfo {
            name,
            is_default,
            channels,
        });
    }
    Ok(out)
}

/// Lists names of all available audio output devices (playback).
pub fn output_devices() -> Result<Vec<String>, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let devices = host.output_devices().map_err(|e| format!("Failed to list output devices: {e}"))?;
    let mut out = Vec::new();
    for device in devices {
        if let Ok(name) = device.name() {
            out.push(name);
        }
    }
    Ok(out)
}

/// Queries the supported channel count for the named input device.
pub fn input_channels(device_name: &str) -> Result<u16, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let device = if device_name.is_empty() || device_name.eq_ignore_ascii_case("default") {
        host.default_input_device()
    } else {
        let mut devices = host.input_devices().map_err(|e| e.to_string())?;
        devices.find(|d| d.name().map(|n| n == device_name).unwrap_or(false))
    };
    let dev = device.ok_or_else(|| format!("Audio device not found: {device_name}"))?;
    let config = dev
        .default_input_config()
        .map_err(|e| format!("Failed to query device config: {e}"))?;
    Ok(config.channels())
}

// ---------------------------------------------------------------------------
// Capture Configuration & Error
// ---------------------------------------------------------------------------

/// Options for configuring an audio capture session.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureOptions {
    /// Optional specific input device name (None = system default).
    pub device: Option<String>,
    /// Optional channel index to record from (0-based; None = average all channels).
    pub channel: Option<u16>,
    /// VAD backend and smoothing parameters.
    pub vad: VadConfig,
    /// Noise suppression configuration.
    #[serde(default)]
    pub denoise: crate::stt::denoise::DenoiseConfig,
}

/// Capture error conditions mapped by frontend services.
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

// ---------------------------------------------------------------------------
// AudioCaptureState & Handle
// ---------------------------------------------------------------------------

/// Thread-safe state of an ongoing audio capture session.
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

/// Handle to a running background capture thread.
pub struct AudioCaptureHandle {
    stop_tx: Sender<()>,
    join_handle: Option<JoinHandle<Result<Vec<f32>, CaptureError>>>,
    pub state: AudioCaptureState,
}

impl AudioCaptureHandle {
    /// Stops capture, joins the worker thread, and returns 16 kHz trimmed mono PCM.
    pub fn stop(mut self) -> Result<Vec<f32>, CaptureError> {
        let _ = self.stop_tx.send(());
        self.state.request_stop();
        if let Some(h) = self.join_handle.take() {
            h.join().unwrap_or(Err(CaptureError::RecordingFailed("Capture thread panicked".into())))
        } else {
            Err(CaptureError::RecordingFailed("No active capture thread".into()))
        }
    }

    /// Cancels capture without processing speech.
    pub fn cancel(mut self) {
        let _ = self.stop_tx.send(());
        self.state.request_stop();
        if let Some(h) = self.join_handle.take() {
            let _ = h.join();
        }
    }
}

// ---------------------------------------------------------------------------
// Audio Resampling
// ---------------------------------------------------------------------------

/// Linear resampling of mono PCM from `src_rate` to `dst_rate`.
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

// ---------------------------------------------------------------------------
// VAD Stream Silence Trimming
// ---------------------------------------------------------------------------

/// Trims leading and trailing silence from 16 kHz mono PCM using the specified [`VadConfig`].
///
/// Feeds audio through the smoothed VAD pipeline. Leading frames prior to sustained voicing
/// are dropped (retaining the configured prefill buffer). Trailing frames past the hangover
/// are discarded. If no speech onset is confirmed, returns [`CaptureError::NoSpeech`].
pub fn vad_trim_with_config(pcm: &[f32], cfg: &VadConfig) -> Result<Vec<f32>, CaptureError> {
    if pcm.is_empty() {
        return Err(CaptureError::NoSpeech);
    }

    let mut detector = vad::build(cfg);
    let frame_size = detector.frame_samples();
    if frame_size == 0 {
        return Err(CaptureError::NoSpeech);
    }

    let mut speech_samples = Vec::new();
    let mut had_speech_onset = false;

    for chunk in pcm.chunks(frame_size) {
        if chunk.len() < frame_size {
            let mut padded = chunk.to_vec();
            padded.resize(frame_size, 0.0);
            let out = detector.push_frame(&padded);
            if let vad::VadFrame::Speech(s) = out {
                had_speech_onset = true;
                let take_len = chunk.len().min(s.len());
                speech_samples.extend_from_slice(&s[..take_len]);
            }
        } else {
            let out = detector.push_frame(chunk);
            if let vad::VadFrame::Speech(s) = out {
                had_speech_onset = true;
                speech_samples.extend_from_slice(s);
            }
        }
    }

    // Must have confirmed onset and meet minimum utterance duration (200 ms @ 16 kHz = 3200 samples)
    let min_samples = (SAMPLE_RATE as f32 * 0.200) as usize;
    if !had_speech_onset || speech_samples.len() < min_samples {
        return Err(CaptureError::NoSpeech);
    }

    Ok(speech_samples)
}

/// Trims silence using an energy threshold VAD with default temporal smoothing (450ms prefill/hangover, 60ms onset).
pub fn vad_trim_silence(
    pcm: &[f32],
    sample_rate: u32,
    threshold: f32,
) -> Result<Vec<f32>, CaptureError> {
    let cfg = VadConfig {
        backend: vad::VadBackend::Energy,
        energy_threshold: threshold,
        prefill_ms: 450,
        onset_ms: 60,
        hangover_ms: 450,
        sample_rate,
        silero_model_path: None,
    };
    vad_trim_with_config(pcm, &cfg)
}

// ---------------------------------------------------------------------------
// Audio Chunk Processing Helpers
// ---------------------------------------------------------------------------

fn resolve_channel_index(selected_channel: Option<u16>, channels: u16) -> Option<usize> {
    match selected_channel {
        Some(ch) if (ch as usize) < channels as usize => Some(ch as usize),
        Some(ch) if ch > 0 && (ch as usize - 1) < channels as usize => Some(ch as usize - 1),
        _ => None,
    }
}

fn calculate_channel_rms(data: &[f32], channels: u16, selected_channel: Option<u16>) -> f32 {
    if data.is_empty() || channels == 0 {
        return 0.0;
    }
    let ch = resolve_channel_index(selected_channel, channels);

    let mut sum_sq = 0.0f32;
    let mut count = 0usize;

    if channels == 1 {
        for &s in data {
            sum_sq += s * s;
        }
        count = data.len();
    } else if let Some(target_ch) = ch {
        for chunk in data.chunks_exact(channels as usize) {
            let s = chunk[target_ch];
            sum_sq += s * s;
            count += 1;
        }
    } else {
        for chunk in data.chunks_exact(channels as usize) {
            let avg: f32 = chunk.iter().sum::<f32>() / channels as f32;
            sum_sq += avg * avg;
            count += 1;
        }
    }

    if count == 0 {
        0.0
    } else {
        (sum_sq / count as f32).sqrt()
    }
}

fn process_input_chunk(
    data: &[f32],
    channels: u16,
    selected_channel: Option<u16>,
    buffer: &Arc<Mutex<Vec<f32>>>,
    level: &Arc<Mutex<f32>>,
) {
    if data.is_empty() || channels == 0 {
        return;
    }

    let ch = resolve_channel_index(selected_channel, channels);

    let mono: Vec<f32> = if channels == 1 {
        data.to_vec()
    } else if let Some(target_ch) = ch {
        data.chunks_exact(channels as usize)
            .map(|frame| frame[target_ch])
            .collect()
    } else {
        data.chunks_exact(channels as usize)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    };

    let mut sum_sq = 0.0f32;
    for &sample in &mono {
        sum_sq += sample * sample;
    }
    let rms = (sum_sq / mono.len().max(1) as f32).sqrt();

    if let Ok(mut lvl) = level.lock() {
        *lvl = rms;
    }
    if let Ok(mut buf) = buffer.lock() {
        buf.extend_from_slice(&mono);
    }
}

// ---------------------------------------------------------------------------
// Microphone Level Probe (Settings View Meter)
// ---------------------------------------------------------------------------

static PROBE_RUNNING: AtomicBool = AtomicBool::new(false);
static PROBE_STOP: AtomicBool = AtomicBool::new(false);
static PROBE_LEVEL: AtomicU32 = AtomicU32::new(0); // stores f32::to_bits()
static PROBE_LAST_PING: AtomicU64 = AtomicU64::new(0);

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Signals the mic probe stream to stop immediately.
pub fn stop_probe() {
    PROBE_STOP.store(true, Ordering::SeqCst);
}

fn spawn_probe_thread(device_name: Option<String>, selected_channel: Option<u16>) -> Result<(), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let host = cpal::default_host();
    let device = if let Some(ref name) = device_name {
        if name.is_empty() || name.eq_ignore_ascii_case("default") {
            host.default_input_device()
        } else {
            let mut devices = host.input_devices().map_err(|e| e.to_string())?;
            devices.find(|d| d.name().map(|n| n == *name).unwrap_or(false))
        }
    } else {
        host.default_input_device()
    }
    .ok_or_else(|| "No microphone device found".to_string())?;

    let config = device
        .default_input_config()
        .map_err(|e| format!("Failed to read device config: {e}"))?;
    let channels = config.channels();

    PROBE_RUNNING.store(true, Ordering::SeqCst);
    PROBE_STOP.store(false, Ordering::SeqCst);

    std::thread::spawn(move || {
        let err_fn = |err| eprintln!("STT probe stream error: {err}");

        let on_chunk = move |data: &[f32]| {
            let rms = calculate_channel_rms(data, channels, selected_channel);
            PROBE_LEVEL.store(rms.to_bits(), Ordering::SeqCst);
        };

        let stream_res = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config.into(),
                move |data: &[f32], _: &_| on_chunk(data),
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
                    on_chunk(&f32_data);
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
                    on_chunk(&f32_data);
                },
                err_fn,
                None,
            ),
            cpal::SampleFormat::I32 => device.build_input_stream(
                &config.into(),
                move |data: &[i32], _: &_| {
                    let f32_data: Vec<f32> = data
                        .iter()
                        .map(|&s| s as f32 / 2147483648.0)
                        .collect();
                    on_chunk(&f32_data);
                },
                err_fn,
                None,
            ),
            _ => {
                PROBE_RUNNING.store(false, Ordering::SeqCst);
                return;
            }
        };

        let stream = match stream_res {
            Ok(s) => s,
            Err(_) => {
                PROBE_RUNNING.store(false, Ordering::SeqCst);
                return;
            }
        };

        if stream.play().is_err() {
            PROBE_RUNNING.store(false, Ordering::SeqCst);
            return;
        }

        while !PROBE_STOP.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(50));
            let elapsed = now_millis().saturating_sub(PROBE_LAST_PING.load(Ordering::SeqCst));
            // Auto-stop probe after 1.5s of polling silence so hardware microphone releases promptly
            if elapsed > 1500 {
                break;
            }
        }

        drop(stream);
        PROBE_LEVEL.store(0, Ordering::SeqCst);
        PROBE_RUNNING.store(false, Ordering::SeqCst);
    });

    Ok(())
}

/// Reads the current RMS microphone level without starting a full dictation session.
///
/// Maintains a lightweight background stream while actively polled (~20-30 Hz) and
/// shuts down automatically after 1.5s of inactivity so the OS microphone icon turns off.
pub fn probe_level(device_name: Option<&str>, channel: Option<u16>) -> Result<f32, String> {
    PROBE_LAST_PING.store(now_millis(), Ordering::SeqCst);

    if !PROBE_RUNNING.load(Ordering::SeqCst) {
        let dev_opt = device_name.map(|s| s.to_string());
        spawn_probe_thread(dev_opt, channel)?;
        std::thread::sleep(Duration::from_millis(35));
    }

    let bits = PROBE_LEVEL.load(Ordering::SeqCst);
    Ok(f32::from_bits(bits))
}

/// Alias for [`probe_level`].
pub fn probe_mic_level(device_name: Option<&str>, channel: Option<u16>) -> Result<f32, String> {
    probe_level(device_name, channel)
}

/// Direct helper for the parameterless `stt_mic_level` command.
pub fn mic_level() -> Result<f32, String> {
    probe_level(None, None)
}

// ---------------------------------------------------------------------------
// start_audio_capture (Primary Entry Point)
// ---------------------------------------------------------------------------

/// Spawns a background thread that records from CPAL, applies channel selection and linear
/// resampling, and runs the smoothed VAD to yield 16 kHz mono f32 samples.
pub fn start_audio_capture(
    opts: CaptureOptions,
    state: AudioCaptureState,
) -> Result<AudioCaptureHandle, CaptureError> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    // Release any background settings probe so it doesn't contend for the device
    stop_probe();

    let (stop_tx, stop_rx) = channel::<()>();
    let state_clone = state.clone();

    let host = cpal::default_host();
    let device = if let Some(ref name) = opts.device {
        if name.is_empty() || name.eq_ignore_ascii_case("default") {
            host.default_input_device()
        } else {
            host.input_devices()
                .map_err(|e| CaptureError::RecordingFailed(e.to_string()))?
                .find(|d| d.name().map(|n| n == *name).unwrap_or(false))
        }
    } else {
        host.default_input_device()
    }
    .ok_or(CaptureError::NoMicrophone)?;

    let config = device
        .default_input_config()
        .map_err(|e| CaptureError::RecordingFailed(e.to_string()))?;

    let channel_opt = opts.channel;
    let vad_cfg = opts.vad;

    let denoise_cfg = opts.denoise;
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
                    process_input_chunk(data, channels, channel_opt, &raw_samples_cb, &level_cb);
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
                    process_input_chunk(&f32_data, channels, channel_opt, &raw_samples_cb, &level_cb);
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
                    process_input_chunk(&f32_data, channels, channel_opt, &raw_samples_cb, &level_cb);
                },
                err_fn,
                None,
            ),
            cpal::SampleFormat::I32 => device.build_input_stream(
                &config.into(),
                move |data: &[i32], _: &_| {
                    let f32_data: Vec<f32> = data
                        .iter()
                        .map(|&s| s as f32 / 2147483648.0)
                        .collect();
                    process_input_chunk(&f32_data, channels, channel_opt, &raw_samples_cb, &level_cb);
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
            std::thread::sleep(Duration::from_millis(20));
        }

        drop(stream);
        state_clone.is_active.store(false, Ordering::SeqCst);
        *state_clone.current_level.lock().unwrap_or_else(|e| e.into_inner()) = 0.0;

        let gathered = raw_samples.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if gathered.is_empty() {
            return Err(CaptureError::NoSpeech);
        }

        // Apply noise suppression chain before resampling and VAD
        let mut processed = gathered;
        crate::stt::denoise::apply_denoise_chain(
            &mut processed,
            sample_rate,
            1,
            &denoise_cfg,
        );

        // Resample from hardware sample_rate to 16 kHz
        let pcm_16k = resample_linear(&processed, sample_rate, SAMPLE_RATE);
        // Trim silence and isolated transient noise with smoothed VAD
        let trimmed = vad_trim_with_config(&pcm_16k, &vad_cfg)?;
        Ok(trimmed)
    });

    Ok(AudioCaptureHandle {
        stop_tx,
        join_handle: Some(thread_handle),
        state,
    })
}

/// Legacy entry point for callers passing (device_name, energy_threshold, state).
pub fn start_audio_capture_legacy(
    device_name: Option<String>,
    energy_threshold: f32,
    state: AudioCaptureState,
) -> Result<AudioCaptureHandle, CaptureError> {
    start_audio_capture(
        CaptureOptions {
            device: device_name,
            channel: None,
            vad: VadConfig {
                energy_threshold,
                ..Default::default()
            },
            denoise: crate::stt::denoise::DenoiseConfig::default(),
        },
        state,
    )
}

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resample_linear_identity() {
        let input = vec![0.1, 0.5, -0.3, 0.8];
        let resampled = resample_linear(&input, 16000, 16000);
        assert_eq!(input, resampled);
    }

    #[test]
    fn test_resample_linear_downsample() {
        let input: Vec<f32> = (0..48000).map(|i| (i as f32 * 0.01).sin()).collect();
        let resampled = resample_linear(&input, 48000, 16000);
        assert_eq!(resampled.len(), 16000);
    }

    #[test]
    fn test_pure_silence_returns_no_speech() {
        let silence = vec![0.0f32; 16000 * 2]; // 2 seconds of silence
        let result = vad_trim_silence(&silence, 16000, 0.015);
        assert_eq!(result, Err(CaptureError::NoSpeech));
    }

    #[test]
    #[allow(clippy::needless_range_loop)]
    fn test_isolated_click_is_rejected_as_no_speech() {
        // 1 second of audio: 30ms loud click surrounded by silence
        let mut audio = vec![0.0f32; 16000];
        let click_start = 16 * 480;
        let click_len = 480; // 30ms
        for i in click_start..(click_start + click_len) {
            audio[i] = 0.5f32;
        }

        let result = vad_trim_silence(&audio, 16000, 0.015);
        assert_eq!(result, Err(CaptureError::NoSpeech));
    }

    #[test]
    #[allow(clippy::needless_range_loop)]
    fn test_sustained_speech_is_preserved_and_trimmed() {
        // 3 seconds: 0.5s silence + 1.5s loud speech + 1.0s silence
        let mut audio = vec![0.0f32; 16000 * 3];
        let speech_start = 8000; // 0.5s
        let speech_end = 32000; // 2.0s
        for i in speech_start..speech_end {
            audio[i] = (i as f32 * 0.1).sin() * 0.3;
        }

        let result = vad_trim_silence(&audio, 16000, 0.015).expect("speech detected");
        assert!(result.len() < audio.len());
        // Must contain at least 1.5s speech + prefill/hangover
        assert!(result.len() >= 16000);
    }

    #[test]
    fn test_channel_selection_and_downmixing() {
        // Stereo interleaved samples: Left = 1.0, Right = 0.0
        let stereo = vec![1.0, 0.0, 1.0, 0.0, 1.0, 0.0];

        // Selecting channel 0 (Left) -> 1.0
        let rms_ch0 = calculate_channel_rms(&stereo, 2, Some(0));
        assert!((rms_ch0 - 1.0).abs() < 1e-4);

        // Selecting channel 1 (Right) -> 0.0
        let rms_ch1 = calculate_channel_rms(&stereo, 2, Some(1));
        assert!((rms_ch1 - 0.0).abs() < 1e-4);

        // Averaging both channels -> 0.5
        let rms_avg = calculate_channel_rms(&stereo, 2, None);
        assert!((rms_avg - 0.5).abs() < 1e-4);
    }
}
