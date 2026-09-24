use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::recording::{DeviceInfo, RecordingError, RecordingLevel};

pub const TARGET_SAMPLE_RATE: u32 = 44100;
pub const DEFAULT_RECORDING_CHANNELS: u16 = 2; // Stereo
pub const TARGET_CHANNELS: u16 = DEFAULT_RECORDING_CHANNELS;
pub const PREF_RECORDING_CHANNELS: &str = "tempo_recording_channels";

/// Normalizes an arbitrary channel count to 1 (mono) or 2 (stereo).
pub fn normalize_channels(channels: u16) -> u16 {
    if channels == 1 {
        1
    } else {
        2
    }
}

/// Parses a channel preference string (e.g. "1", "2", "\"1\"", "mono", "stereo").
/// Unknown, empty, or invalid values fall back to stereo (2).
pub fn parse_channel_preference(val: Option<&str>) -> u16 {
    match val {
        Some(s) => {
            let cleaned = s.trim().trim_matches('"').to_lowercase();
            match cleaned.as_str() {
                "1" | "mono" => 1,
                "2" | "stereo" => 2,
                _ => DEFAULT_RECORDING_CHANNELS,
            }
        }
        None => DEFAULT_RECORDING_CHANNELS,
    }
}
/// Helper to write WAV file using `hound`
pub fn create_wav_writer<P: AsRef<Path>>(
    path: P,
    sample_rate: u32,
    channels: u16,
) -> Result<hound::WavWriter<std::io::BufWriter<std::fs::File>>, RecordingError> {
    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    hound::WavWriter::create(path, spec)
        .map_err(|e| RecordingError::DeviceBusy(format!("Failed to create WAV file: {e}")))
}

/// Compute peak and RMS level on a slice of f32 samples (-1.0 to 1.0 range)
pub fn compute_level(samples: &[f32]) -> RecordingLevel {
    if samples.is_empty() {
        return RecordingLevel { peak: 0.0, rms: 0.0 };
    }

    let mut peak: f32 = 0.0;
    let mut sum_sq: f64 = 0.0;

    for &s in samples {
        let abs = s.abs();
        if abs > peak {
            peak = abs;
        }
        sum_sq += (s as f64) * (s as f64);
    }

    let rms = (sum_sq / samples.len() as f64).sqrt() as f32;
    RecordingLevel {
        peak: peak.clamp(0.0, 1.0),
        rms: rms.clamp(0.0, 1.0),
    }
}

/// Resolution strategy for microphone selection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MicChoice<'a> {
    /// `None` passed from UI: use default input device.
    DefaultDevice,
    /// Specific device named: look up by name, falling back to default device if missing.
    NamedDevice(&'a str),
    /// Explicitly requested no microphone capture ("none" sentinel for system-sound-only mode).
    Disabled,
}

/// Pure function mapping `Option<&str>` / `Option<String>` to `MicChoice`.
///
/// - `None` -> `DefaultDevice` (user didn't specify or device list hasn't loaded yet).
/// - `Some("none")` -> `Disabled` (documented sentinel for system sound only / loopback only).
/// - `Some(name)` -> `NamedDevice(name)` (explicit device selection).
pub fn resolve_mic_choice(mic_id: Option<&str>) -> MicChoice<'_> {
    match mic_id {
        None => MicChoice::DefaultDevice,
        Some("none") => MicChoice::Disabled,
        Some(name) => {
            let trimmed = name.trim();
            if trimmed.is_empty() || trimmed == "default" {
                MicChoice::DefaultDevice
            } else if trimmed == "none" {
                MicChoice::Disabled
            } else {
                MicChoice::NamedDevice(name)
            }
        }
    }
}

/// Linear resampler for interleaved float audio
pub fn resample_linear(
    input: &[f32],
    src_rate: u32,
    dst_rate: u32,
    channels: u16,
) -> Vec<f32> {
    if src_rate == dst_rate || input.is_empty() || channels == 0 {
        return input.to_vec();
    }

    let ch = channels as usize;
    let src_frames = input.len() / ch;
    if src_frames == 0 {
        return Vec::new();
    }

    let ratio = dst_rate as f64 / src_rate as f64;
    let dst_frames = ((src_frames as f64) * ratio).round() as usize;
    let mut output = Vec::with_capacity(dst_frames * ch);

    for i in 0..dst_frames {
        let src_idx_f = (i as f64) / ratio;
        let idx0 = src_idx_f.floor() as usize;
        let frac = (src_idx_f - idx0 as f64) as f32;
        let idx1 = (idx0 + 1).min(src_frames - 1);

        for c in 0..ch {
            let s0 = input[idx0 * ch + c];
            let s1 = input[idx1 * ch + c];
            let interp = s0 + frac * (s1 - s0);
            output.push(interp);
        }
    }

    output
}

/// Converts interleaved float audio from `src_channels` to `dst_channels`.
///
/// Supported conversions:
/// - Same channel count: clone / pass-through.
/// - Mono (1) to Stereo (2): duplicate mono sample to both channels: `[s, s]`.
/// - Stereo (2) to Mono (1): downmix L and R with averaging: `(L + R) * 0.5`.
/// - N channels to Mono (1): downmix by averaging all N channels.
/// - N channels to Stereo (2): take the first two channels.
pub fn convert_channels(input: &[f32], src_channels: u16, dst_channels: u16) -> Vec<f32> {
    if src_channels == dst_channels || input.is_empty() || src_channels == 0 || dst_channels == 0 {
        return input.to_vec();
    }

    let src_ch = src_channels as usize;
    let frames = input.len() / src_ch;
    if frames == 0 {
        return Vec::new();
    }

    match (src_channels, dst_channels) {
        (1, 2) => {
            let mut out = Vec::with_capacity(frames * 2);
            for &s in input.iter().take(frames) {
                out.push(s);
                out.push(s);
            }
            out
        }
        (2, 1) => {
            let mut out = Vec::with_capacity(frames);
            let (chunks, _) = input.as_chunks::<2>();
            for &[left, right] in chunks {
                out.push((left + right) * 0.5);
            }
            out
        }
        (_, 1) => {
            let mut out = Vec::with_capacity(frames);
            let inv = 1.0 / (src_ch as f32);
            for chunk in input.chunks_exact(src_ch) {
                let sum: f32 = chunk.iter().sum();
                out.push(sum * inv);
            }
            out
        }
        (_, 2) => {
            let mut out = Vec::with_capacity(frames * 2);
            for chunk in input.chunks_exact(src_ch) {
                out.push(chunk[0]);
                out.push(chunk[1]);
            }
            out
        }
        _ => input.to_vec(),
    }
}

/// Helper to write float samples to a WAV file with explicit channel conversion.
/// Converts `input` from `src_channels` to `dst_channels` and writes 16-bit PCM WAV.
/// Returns the number of frames written and the WAV spec.
pub fn write_wav_samples<P: AsRef<Path>>(
    path: P,
    input: &[f32],
    src_channels: u16,
    dst_channels: u16,
    sample_rate: u32,
) -> Result<(usize, hound::WavSpec), RecordingError> {
    let target_channels = normalize_channels(dst_channels);
    let converted = convert_channels(input, src_channels, target_channels);
    let mut writer = create_wav_writer(&path, sample_rate, target_channels)?;
    for &sample in &converted {
        let sample_i16 = (sample.clamp(-1.0, 1.0) * 32767.0) as i16;
        writer
            .write_sample(sample_i16)
            .map_err(|e| RecordingError::DeviceBusy(format!("Failed to write WAV sample: {e}")))?;
    }
    writer
        .flush()
        .map_err(|e| RecordingError::DeviceBusy(format!("Failed to flush WAV file: {e}")))?;
    let frames = converted.len() / (target_channels as usize);
    let spec = hound::WavSpec {
        channels: target_channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    Ok((frames, spec))
}

/// Helper converting cpal / Windows errors into RecordingError
pub fn map_audio_error(err_str: &str) -> RecordingError {
    let lower = err_str.to_lowercase();
    if lower.contains("denied") || lower.contains("0x80070005") || lower.contains("permission") || lower.contains("privacy") {
        RecordingError::AccessDenied(err_str.to_string())
    } else if lower.contains("busy") || lower.contains("in use") || lower.contains("sharing") || lower.contains("0x8889000a") {
        RecordingError::DeviceBusy(err_str.to_string())
    } else if lower.contains("not found") || lower.contains("no device") || lower.contains("invalid device") {
        RecordingError::NoDevice(err_str.to_string())
    } else {
        RecordingError::DeviceBusy(err_str.to_string())
    }
}

/// Enumerate available microphones using CPAL
pub fn list_microphones() -> Result<Vec<DeviceInfo>, RecordingError> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let default_dev = host.default_input_device();
    let default_id = default_dev.and_then(|d| d.name().ok());

    let mut devices = Vec::new();
    if let Ok(input_devices) = host.input_devices() {
        for d in input_devices {
            if let Ok(name) = d.name() {
                let is_default = default_id.as_ref().is_some_and(|did| did == &name);
                devices.push(DeviceInfo {
                    id: name.clone(),
                    name,
                    is_default,
                });
            }
        }
    }
    Ok(devices)
}

/// Enumerate available loopback devices using WASAPI on Windows
#[cfg(windows)]
pub fn list_loopback_devices() -> Result<Vec<DeviceInfo>, RecordingError> {
    let mut devices = Vec::new();
    let _ = wasapi::initialize_mta();

    if let Ok(enumerator) = wasapi::DeviceEnumerator::new() {
        if let Ok(collection) = enumerator.get_device_collection(&wasapi::Direction::Render) {
            if let Ok(count) = collection.get_nbr_devices() {
                let default_id = enumerator
                    .get_default_device(&wasapi::Direction::Render)
                    .and_then(|d| d.get_id())
                    .ok();

                for i in 0..count {
                    if let Ok(dev) = collection.get_device_at_index(i) {
                        if let (Ok(id), Ok(name)) = (dev.get_id(), dev.get_friendlyname()) {
                            let is_default = default_id.as_ref().is_some_and(|did| did == &id);
                            devices.push(DeviceInfo {
                                id,
                                name,
                                is_default,
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(devices)
}

#[cfg(not(windows))]
pub fn list_loopback_devices() -> Result<Vec<DeviceInfo>, RecordingError> {
    Ok(Vec::new())
}

/// Represents an active Audio recording session
pub struct AudioRecordingSession {
    output_path: PathBuf,
    is_paused: Arc<AtomicBool>,
    should_stop: Arc<AtomicBool>,
    level_peak: Arc<AtomicU32>,
    level_rms: Arc<AtomicU32>,
    recording_thread: Option<JoinHandle<Result<f64, String>>>,
    accumulated_active_duration: Arc<Mutex<Duration>>,
    pause_start: Arc<Mutex<Option<Instant>>>,
}

static DEFAULT_DENOISE_CONFIG: std::sync::RwLock<Option<crate::stt::denoise::DenoiseConfig>> =
    std::sync::RwLock::new(None);

/// Sets the default denoise configuration used when starting internal recording sessions.
pub fn set_default_denoise_config(cfg: crate::stt::denoise::DenoiseConfig) {
    if let Ok(mut guard) = DEFAULT_DENOISE_CONFIG.write() {
        *guard = Some(cfg);
    }
}

/// Returns the current default denoise configuration for internal recording sessions.
pub fn get_default_denoise_config() -> crate::stt::denoise::DenoiseConfig {
    DEFAULT_DENOISE_CONFIG
        .read()
        .ok()
        .and_then(|g| g.clone())
        .unwrap_or_default()
}

impl AudioRecordingSession {
    pub fn start(
        output_path: PathBuf,
        mic_device_id: Option<String>,
        sys_device_id: Option<String>,
        channels: u16,
    ) -> Result<Self, RecordingError> {
        Self::start_with_denoise(
            output_path,
            mic_device_id,
            sys_device_id,
            channels,
            get_default_denoise_config(),
        )
    }

    pub fn start_with_denoise(
        output_path: PathBuf,
        mic_device_id: Option<String>,
        sys_device_id: Option<String>,
        channels: u16,
        denoise_cfg: crate::stt::denoise::DenoiseConfig,
    ) -> Result<Self, RecordingError> {
        let is_paused = Arc::new(AtomicBool::new(false));
        let should_stop = Arc::new(AtomicBool::new(false));
        let level_peak = Arc::new(AtomicU32::new(0));
        let level_rms = Arc::new(AtomicU32::new(0));
        let accumulated_active_duration = Arc::new(Mutex::new(Duration::ZERO));
        let pause_start = Arc::new(Mutex::new(None));

        let out_clone = output_path.clone();
        let is_paused_clone = Arc::clone(&is_paused);
        let should_stop_clone = Arc::clone(&should_stop);
        let peak_clone = Arc::clone(&level_peak);
        let rms_clone = Arc::clone(&level_rms);
        let acc_clone = Arc::clone(&accumulated_active_duration);

        // Spawn audio capture & mixer thread
        let handle = thread::spawn(move || {
            run_audio_capture_loop(
                out_clone,
                mic_device_id,
                sys_device_id,
                channels,
                denoise_cfg,
                is_paused_clone,
                should_stop_clone,
                peak_clone,
                rms_clone,
                acc_clone,
            )
        });

        Ok(Self {
            output_path,
            is_paused,
            should_stop,
            level_peak,
            level_rms,
            recording_thread: Some(handle),
            accumulated_active_duration,
            pause_start,
        })
    }

    pub fn level(&self) -> RecordingLevel {
        let p_bits = self.level_peak.load(Ordering::Relaxed);
        let r_bits = self.level_rms.load(Ordering::Relaxed);
        RecordingLevel {
            peak: f32::from_bits(p_bits),
            rms: f32::from_bits(r_bits),
        }
    }

    pub fn pause(&self) {
        if !self.is_paused.swap(true, Ordering::SeqCst) {
            let mut p = self.pause_start.lock().unwrap();
            *p = Some(Instant::now());
        }
    }

    pub fn resume(&self) {
        if self.is_paused.swap(false, Ordering::SeqCst) {
            let mut p = self.pause_start.lock().unwrap();
            let _ = p.take();
        }
    }

    pub fn is_paused(&self) -> bool {
        self.is_paused.load(Ordering::SeqCst)
    }

    pub fn duration_sec(&self) -> f64 {
        let acc = *self.accumulated_active_duration.lock().unwrap();
        acc.as_secs_f64()
    }

    pub fn stop(mut self) -> Result<(PathBuf, f64), RecordingError> {
        self.should_stop.store(true, Ordering::SeqCst);
        let duration = if let Some(handle) = self.recording_thread.take() {
            handle
                .join()
                .map_err(|_| RecordingError::DeviceBusy("Audio thread panicked".to_string()))?
                .map_err(RecordingError::DeviceBusy)?
        } else {
            0.0
        };

        Ok((self.output_path, duration))
    }

    pub fn cancel(mut self) -> Result<(), RecordingError> {
        self.should_stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.recording_thread.take() {
            let _ = handle.join();
        }
        if self.output_path.exists() {
            let _ = std::fs::remove_file(&self.output_path);
        }
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
fn run_audio_capture_loop(
    output_path: PathBuf,
    mic_device_id: Option<String>,
    sys_device_id: Option<String>,
    target_channels: u16,
    denoise_cfg: crate::stt::denoise::DenoiseConfig,
    is_paused: Arc<AtomicBool>,
    should_stop: Arc<AtomicBool>,
    level_peak: Arc<AtomicU32>,
    level_rms: Arc<AtomicU32>,
    accumulated_duration: Arc<Mutex<Duration>>,
) -> Result<f64, String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let target_channels = normalize_channels(target_channels);
    let mut writer = create_wav_writer(&output_path, TARGET_SAMPLE_RATE, target_channels)
        .map_err(|e| format!("{e:?}"))?;

    // Microphone stream setup
    let mic_buffer = Arc::new(Mutex::new(VecDeque::<f32>::new()));
    let mic_choice = resolve_mic_choice(mic_device_id.as_deref());
    let _mic_stream = match mic_choice {
        MicChoice::Disabled => {
            // Explicitly requested no microphone ("none" sentinel for system-sound-only capture).
            None
        }
        MicChoice::DefaultDevice | MicChoice::NamedDevice(_) => {
            let host = cpal::default_host();
            let mut chosen = None;

            if let MicChoice::NamedDevice(mic_id) = mic_choice {
                if let Ok(devices) = host.input_devices() {
                    for d in devices {
                        if let Ok(name) = d.name() {
                            if name == mic_id {
                                chosen = Some(d);
                                break;
                            }
                        }
                    }
                }
            }

            // Fall back to the default input device if named device wasn't found or for DefaultDevice
            if chosen.is_none() {
                chosen = host.default_input_device();
            }

            if let Some(dev) = chosen {
                let config = dev
                    .default_input_config()
                    .map_err(|e| format!("Failed to get mic config: {e}"))?;
                let sample_rate = config.sample_rate().0;
                let channels = config.channels();

                let mic_buf_clone = Arc::clone(&mic_buffer);
                let err_fn = |err| eprintln!("CPAL stream error: {err}");
                let mut denoise_pipeline = crate::stt::denoise::DenoisePipeline::new(denoise_cfg, sample_rate, channels);
                let stream_res = dev.build_input_stream(
                    &config.into(),
                    move |data: &[f32], _: &_| {
                        let mut mic_data = data.to_vec();
                        denoise_pipeline.process(&mut mic_data);
                        let resampled = resample_linear(&mic_data, sample_rate, TARGET_SAMPLE_RATE, channels);
                        let converted = convert_channels(&resampled, channels, target_channels);
                        let mut buf = mic_buf_clone.lock().unwrap();
                        buf.extend(converted);
                    },
                    err_fn,
                    None,
                );

                match stream_res {
                    Ok(stream) => {
                        if stream.play().is_ok() {
                            Some(stream)
                        } else {
                            None
                        }
                    }
                    Err(e) => return Err(format!("Failed to build mic stream: {e}")),
                }
            } else {
                None
            }
        }
    };

    // System sound stream setup (WASAPI Loopback on Windows)
    #[cfg(windows)]
    let (sys_buffer, _sys_thread) = if let Some(sys_id) = &sys_device_id {
        if sys_id != "none" {
            let (buf, handle) = start_wasapi_loopback_capture(sys_id, Arc::clone(&should_stop))
                .map_err(|e| format!("{e:?}"))?;
            (Some(buf), Some(handle))
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    #[cfg(not(windows))]
    let sys_buffer: Option<Arc<Mutex<VecDeque<f32>>>> = None;

    let mut total_samples_written: u64 = 0;
    let block_size = (TARGET_SAMPLE_RATE / 10 * target_channels as u32) as usize; // ~100ms
    let mut last_tick = Instant::now();

    while !should_stop.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(50));
        let now = Instant::now();
        let elapsed = now.duration_since(last_tick);
        last_tick = now;

        if is_paused.load(Ordering::SeqCst) {
            // Drop samples when paused
            mic_buffer.lock().unwrap().clear();
            if let Some(ref sb) = sys_buffer {
                sb.lock().unwrap().clear();
            }
            level_peak.store(0, Ordering::Relaxed);
            level_rms.store(0, Ordering::Relaxed);
            continue;
        }

        {
            let mut acc = accumulated_duration.lock().unwrap();
            *acc += elapsed;
        }

        // Drain mic buffer
        let mic_samples: Vec<f32> = {
            let mut buf = mic_buffer.lock().unwrap();
            buf.drain(..).collect()
        };

        // Drain sys buffer
        let sys_samples: Vec<f32> = if let Some(ref sb) = sys_buffer {
            let mut buf = sb.lock().unwrap();
            let raw: Vec<f32> = buf.drain(..).collect();
            convert_channels(&raw, 2, target_channels)
        } else {
            Vec::new()
        };

        let max_len = mic_samples.len().max(sys_samples.len());
        if max_len == 0 {
            continue;
        }

        // Mix stereo samples into 16-bit PCM WAV
        let mut mixed = Vec::with_capacity(max_len);
        for i in 0..max_len {
            let s_mic = *mic_samples.get(i).unwrap_or(&0.0);
            let s_sys = *sys_samples.get(i).unwrap_or(&0.0);
            let combined = (s_mic + s_sys).clamp(-1.0, 1.0);
            mixed.push(combined);

            let sample_i16 = (combined * 32767.0) as i16;
            if let Err(e) = writer.write_sample(sample_i16) {
                eprintln!("Failed to write WAV sample: {e}");
            } else {
                total_samples_written += 1;
            }
        }

        // Calculate peak & rms for the latest chunk (last block_size)
        let chunk_start = mixed.len().saturating_sub(block_size);
        let latest_chunk = &mixed[chunk_start..];
        let lvl = compute_level(latest_chunk);
        level_peak.store(lvl.peak.to_bits(), Ordering::Relaxed);
        level_rms.store(lvl.rms.to_bits(), Ordering::Relaxed);
    }

    writer.flush().map_err(|e| format!("WAV flush error: {e}"))?;
    let duration_sec = (total_samples_written / target_channels as u64) as f64 / TARGET_SAMPLE_RATE as f64;
    Ok(duration_sec)
}

#[cfg(windows)]
type WasapiCaptureHandle = (Arc<Mutex<VecDeque<f32>>>, JoinHandle<()>);

#[cfg(windows)]
fn start_wasapi_loopback_capture(
    device_id: &str,
    should_stop: Arc<AtomicBool>,
) -> Result<WasapiCaptureHandle, RecordingError> {
    let wasapi_buffer = Arc::new(Mutex::new(VecDeque::new()));
    let buf_clone = Arc::clone(&wasapi_buffer);
    let dev_id_owned = device_id.to_string();

    let handle = thread::spawn(move || {
        let _ = wasapi::initialize_mta();
        let enumerator = match wasapi::DeviceEnumerator::new() {
            Ok(e) => e,
            Err(e) => {
                eprintln!("Failed to create DeviceEnumerator: {e}");
                return;
            }
        };

        let device = if dev_id_owned == "default" {
            enumerator.get_default_device(&wasapi::Direction::Render)
        } else {
            enumerator.get_device_collection(&wasapi::Direction::Render)
                .and_then(|col| {
                    col.get_device_at_index(0) // fallback
                })
        };

        let device = match device {
            Ok(d) => d,
            Err(e) => {
                eprintln!("Failed to get loopback device: {e}");
                return;
            }
        };

        let mut audio_client = match device.get_iaudioclient() {
            Ok(ac) => ac,
            Err(e) => {
                eprintln!("Failed to get audio client: {e}");
                return;
            }
        };

        let desired_format = wasapi::WaveFormat::new(32, 32, &wasapi::SampleType::Float, 44100, 2, None);
        let min_time = match audio_client.get_device_period() {
            Ok((_, m)) => m,
            Err(_) => 100000,
        };

        let mode = wasapi::StreamMode::EventsShared {
            autoconvert: true,
            buffer_duration_hns: min_time,
        };

        if let Err(e) = audio_client.initialize_client(&desired_format, &wasapi::Direction::Capture, &mode) {
            eprintln!("WASAPI initialize_client error: {e}");
            return;
        }

        let h_event = match audio_client.set_get_eventhandle() {
            Ok(h) => h,
            Err(e) => {
                eprintln!("WASAPI event handle error: {e}");
                return;
            }
        };

        let capture_client = match audio_client.get_audiocaptureclient() {
            Ok(cc) => cc,
            Err(e) => {
                eprintln!("WASAPI capture client error: {e}");
                return;
            }
        };

        if let Err(e) = audio_client.start_stream() {
            eprintln!("WASAPI start_stream error: {e}");
            return;
        }

        let mut deque_raw = VecDeque::new();
        while !should_stop.load(Ordering::SeqCst) {
            if h_event.wait_for_event(100).is_ok()
                && capture_client.read_from_device_to_deque(&mut deque_raw).is_ok()
            {
                while deque_raw.len() >= 8 {
                    let b0 = deque_raw.pop_front().unwrap_or(0);
                    let b1 = deque_raw.pop_front().unwrap_or(0);
                    let b2 = deque_raw.pop_front().unwrap_or(0);
                    let b3 = deque_raw.pop_front().unwrap_or(0);
                    let s_left = f32::from_le_bytes([b0, b1, b2, b3]);

                    let b4 = deque_raw.pop_front().unwrap_or(0);
                    let b5 = deque_raw.pop_front().unwrap_or(0);
                    let b6 = deque_raw.pop_front().unwrap_or(0);
                    let b7 = deque_raw.pop_front().unwrap_or(0);
                    let s_right = f32::from_le_bytes([b4, b5, b6, b7]);

                    if let Ok(mut buf) = buf_clone.lock() {
                        buf.push_back(s_left);
                        buf.push_back(s_right);
                    }
                }
            }
        }

        let _ = audio_client.stop_stream();
    });

    Ok((wasapi_buffer, handle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_level_silence_and_full() {
        let silence = vec![0.0; 100];
        let lvl = compute_level(&silence);
        assert_eq!(lvl.peak, 0.0);
        assert_eq!(lvl.rms, 0.0);

        let full = vec![1.0; 100];
        let lvl2 = compute_level(&full);
        assert!((lvl2.peak - 1.0).abs() < 1e-5);
        assert!((lvl2.rms - 1.0).abs() < 1e-5);

        let half = vec![0.5; 100];
        let lvl3 = compute_level(&half);
        assert!((lvl3.peak - 0.5).abs() < 1e-5);
        assert!((lvl3.rms - 0.5).abs() < 1e-5);
    }

    #[test]
    fn test_wav_writer_creates_readable_file() {
        let temp_dir = std::env::temp_dir().join(format!("audio_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let file_path = temp_dir.join("test.wav");

        {
            let mut writer = create_wav_writer(&file_path, 44100, 2).unwrap();
            writer.write_sample(1000i16).unwrap();
            writer.write_sample(-1000i16).unwrap();
            writer.flush().unwrap();
        }

        let mut reader = hound::WavReader::open(&file_path).unwrap();
        let spec = reader.spec();
        assert_eq!(spec.channels, 2);
        assert_eq!(spec.sample_rate, 44100);
        assert_eq!(spec.bits_per_sample, 16);
        let samples: Vec<i16> = reader.samples::<i16>().map(|s| s.unwrap()).collect();
        assert_eq!(samples, vec![1000, -1000]);

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_resample_linear() {
        let input = vec![0.0, 1.0, 0.0, 1.0]; // 2 stereo frames
        let resampled = resample_linear(&input, 44100, 44100, 2);
        assert_eq!(resampled, input);

        let resampled_up = resample_linear(&input, 22050, 44100, 2);
        assert_eq!(resampled_up.len(), 8); // 4 stereo frames
    }

    #[test]
    fn test_map_audio_error() {
        match map_audio_error("Permission denied HRESULT 0x80070005") {
            RecordingError::AccessDenied(_) => (),
            _ => panic!("Expected AccessDenied"),
        }
        match map_audio_error("Device in use / busy") {
            RecordingError::DeviceBusy(_) => (),
            _ => panic!("Expected DeviceBusy"),
        }
        match map_audio_error("No device was found") {
            RecordingError::NoDevice(_) => (),
            _ => panic!("Expected NoDevice"),
        }
    }

    #[test]
    fn test_resolve_mic_choice() {
        // None -> DefaultDevice (user didn't specify or device list hasn't loaded yet)
        assert_eq!(resolve_mic_choice(None), MicChoice::DefaultDevice);
        assert_eq!(resolve_mic_choice(Some("")), MicChoice::DefaultDevice);
        assert_eq!(resolve_mic_choice(Some("   ")), MicChoice::DefaultDevice);
        assert_eq!(resolve_mic_choice(Some("default")), MicChoice::DefaultDevice);

        // Sentinel "none" -> Disabled (explicit system sound only / loopback only)
        assert_eq!(resolve_mic_choice(Some("none")), MicChoice::Disabled);
        assert_eq!(resolve_mic_choice(Some(" none ")), MicChoice::Disabled);

        // Named device -> NamedDevice
        assert_eq!(
            resolve_mic_choice(Some("Microphone (Realtek Audio)")),
            MicChoice::NamedDevice("Microphone (Realtek Audio)")
        );
    }

    #[test]
    fn test_parse_channel_preference_unknown_fallback() {
        assert_eq!(parse_channel_preference(None), 2);
        assert_eq!(parse_channel_preference(Some("")), 2);
        assert_eq!(parse_channel_preference(Some("unknown")), 2);
        assert_eq!(parse_channel_preference(Some("0")), 2);
        assert_eq!(parse_channel_preference(Some("3")), 2);
        assert_eq!(parse_channel_preference(Some("invalid-json")), 2);
        assert_eq!(parse_channel_preference(Some("2")), 2);
        assert_eq!(parse_channel_preference(Some("\"2\"")), 2);
        assert_eq!(parse_channel_preference(Some("stereo")), 2);
        assert_eq!(parse_channel_preference(Some("\"stereo\"")), 2);
        assert_eq!(parse_channel_preference(Some("1")), 1);
        assert_eq!(parse_channel_preference(Some("\"1\"")), 1);
        assert_eq!(parse_channel_preference(Some("mono")), 1);
        assert_eq!(parse_channel_preference(Some("\"mono\"")), 1);
    }

    #[test]
    fn test_convert_channels_mono_and_stereo() {
        // Mono to Stereo: duplicates mono sample to both channels
        let mono = vec![0.1, 0.2, 0.3];
        let stereo = convert_channels(&mono, 1, 2);
        assert_eq!(stereo, vec![0.1, 0.1, 0.2, 0.2, 0.3, 0.3]);

        // Stereo to Mono: averages left and right channels
        let st_in = vec![0.2, 0.4, 0.6, 0.8];
        let mono_out = convert_channels(&st_in, 2, 1);
        assert_eq!(mono_out.len(), 2);
        assert!((mono_out[0] - 0.3).abs() < 1e-6);
        assert!((mono_out[1] - 0.7).abs() < 1e-6);

        // Same channel pass-through
        assert_eq!(convert_channels(&mono, 1, 1), mono);
        assert_eq!(convert_channels(&st_in, 2, 2), st_in);
    }

    #[test]
    fn test_write_wav_mono_and_stereo_expected_frame_count() {
        let temp_dir = std::env::temp_dir().join(format!("audio_test_frames_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        // 100 stereo frames (200 interleaved samples)
        let mut stereo_input = Vec::with_capacity(200);
        for i in 0..100 {
            stereo_input.push((i as f32) / 100.0);
            stereo_input.push(-((i as f32) / 100.0));
        }

        // Request 1: Mono request from stereo input -> writes 1-channel WAV with 100 frames
        let mono_path = temp_dir.join("mono.wav");
        let (mono_frames, mono_spec) = write_wav_samples(&mono_path, &stereo_input, 2, 1, 44100).unwrap();
        assert_eq!(mono_spec.channels, 1);
        assert_eq!(mono_frames, 100);

        let mut mono_reader = hound::WavReader::open(&mono_path).unwrap();
        assert_eq!(mono_reader.spec().channels, 1);
        assert_eq!(mono_reader.spec().sample_rate, 44100);
        let mono_samples_read: Vec<i16> = mono_reader.samples::<i16>().map(|s| s.unwrap()).collect();
        // In 1-channel WAV: 1 sample per frame = 100 samples
        assert_eq!(mono_samples_read.len(), 100);

        // Request 2: Stereo request from stereo input -> writes 2-channel WAV with 100 frames
        let stereo_path = temp_dir.join("stereo.wav");
        let (st_frames, st_spec) = write_wav_samples(&stereo_path, &stereo_input, 2, 2, 44100).unwrap();
        assert_eq!(st_spec.channels, 2);
        assert_eq!(st_frames, 100);

        let mut stereo_reader = hound::WavReader::open(&stereo_path).unwrap();
        assert_eq!(stereo_reader.spec().channels, 2);
        assert_eq!(stereo_reader.spec().sample_rate, 44100);
        let st_samples_read: Vec<i16> = stereo_reader.samples::<i16>().map(|s| s.unwrap()).collect();
        // In 2-channel WAV: 2 samples per frame = 200 samples
        assert_eq!(st_samples_read.len(), 200);

        let _ = std::fs::remove_dir_all(temp_dir);
    }
}
