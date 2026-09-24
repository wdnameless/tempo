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

use crate::stt::vad::{EnergyVad, VoiceActivityDetector};

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

/// Processes a single mono stream through RNNoise.
/// RNNoise runs at 48 kHz in 480-sample frames. If the input rate is different,
/// audio is resampled to 48 kHz, denoised, and resampled back to the original length.
fn denoise_rnnoise_mono(channel_samples: &mut [f32], sample_rate: u32) {
    if channel_samples.is_empty() || sample_rate == 0 {
        return;
    }
    let orig_len = channel_samples.len();

    // 1. Resample to 48 kHz if needed
    let at_48k = if sample_rate == 48_000 {
        channel_samples.to_vec()
    } else {
        resample_linear(channel_samples, sample_rate, 48_000)
    };

    // 2. Process frames of 480 samples with nnnoiseless
    let frame_size = nnnoiseless::DenoiseState::FRAME_SIZE;
    let mut denoise_state = nnnoiseless::DenoiseState::new();
    let mut denoised_48k = Vec::with_capacity(at_48k.len() + frame_size);

    let mut in_buf = [0.0f32; nnnoiseless::DenoiseState::FRAME_SIZE];
    let mut out_buf = [0.0f32; nnnoiseless::DenoiseState::FRAME_SIZE];

    for chunk in at_48k.chunks(frame_size) {
        in_buf.fill(0.0);
        for (i, &s) in chunk.iter().enumerate() {
            // nnnoiseless expects float samples scaled to 16-bit range [-32768.0, 32767.0]
            in_buf[i] = (s * 32767.0).clamp(-32768.0, 32767.0);
        }
        denoise_state.process_frame(&mut out_buf, &in_buf);
        for &s in &out_buf[..chunk.len()] {
            denoised_48k.push((s / 32767.0).clamp(-1.0, 1.0));
        }
    }

    // 3. Resample back to original sample rate and exact length
    if sample_rate == 48_000 {
        channel_samples.copy_from_slice(&denoised_48k[..orig_len]);
    } else {
        let mut back = resample_linear(&denoised_48k[..at_48k.len()], 48_000, sample_rate);
        back.resize(orig_len, 0.0);
        channel_samples.copy_from_slice(&back[..orig_len]);
    }
}
/// Applies RNNoise neural noise suppression to interleaved audio in-place.
pub fn apply_rnnoise(samples: &mut [f32], sample_rate: u32, channels: u16) {
    if samples.is_empty() || channels == 0 || sample_rate == 0 {
        return;
    }
    let ch = channels as usize;
    if ch == 1 {
        denoise_rnnoise_mono(samples, sample_rate);
    } else {
        let num_frames = samples.len() / ch;
        for c in 0..ch {
            let mut mono = Vec::with_capacity(num_frames);
            for f in 0..num_frames {
                mono.push(samples[f * ch + c]);
            }
            denoise_rnnoise_mono(&mut mono, sample_rate);
            for f in 0..num_frames {
                samples[f * ch + c] = mono[f];
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Block 2: High-pass Filter (2nd-order Butterworth Biquad)
// ---------------------------------------------------------------------------

/// Applies a 2nd-order Butterworth high-pass filter in-place.
/// Attenuates frequencies below `cutoff_hz` (-12 dB/octave) and preserves frequencies above.
pub fn apply_highpass(samples: &mut [f32], sample_rate: u32, cutoff_hz: f32, channels: u16) {
    if samples.is_empty() || channels == 0 || cutoff_hz <= 0.0 || sample_rate == 0 {
        return;
    }

    let nyquist = sample_rate as f32 * 0.5;
    let cutoff = cutoff_hz.clamp(1.0, nyquist * 0.99);
    let omega = 2.0 * std::f32::consts::PI * cutoff / sample_rate as f32;
    let cos_omega = omega.cos();
    let sin_omega = omega.sin();
    let q = 1.0 / std::f32::consts::SQRT_2; // Butterworth Q = 0.7071
    let alpha = sin_omega / (2.0 * q);

    let b0 = (1.0 + cos_omega) / 2.0;
    let b1 = -(1.0 + cos_omega);
    let b2 = (1.0 + cos_omega) / 2.0;
    let a0 = 1.0 + alpha;
    let a1 = -2.0 * cos_omega;
    let a2 = 1.0 - alpha;

    let nb0 = b0 / a0;
    let nb1 = b1 / a0;
    let nb2 = b2 / a0;
    let na1 = a1 / a0;
    let na2 = a2 / a0;

    let ch = channels as usize;
    let mut states = vec![[0.0f32; 4]; ch]; // [x1, x2, y1, y2] per channel

    for frame in samples.chunks_exact_mut(ch) {
        for c in 0..ch {
            let x0 = frame[c];
            let st = &mut states[c];
            let y0 = nb0 * x0 + nb1 * st[0] + nb2 * st[1] - na1 * st[2] - na2 * st[3];
            st[1] = st[0];
            st[0] = x0;
            st[3] = st[2];
            st[2] = y0;
            frame[c] = y0.clamp(-1.0, 1.0);
        }
    }
}

// ---------------------------------------------------------------------------
// Block 3: Noise Gate (Keys off EnergyVad, zeros non-speech frames)
// ---------------------------------------------------------------------------

/// Applies a noise gate keyed off the existing `EnergyVad`.
/// Gated frames below `threshold_db` are zeroed in-place (not removed), preserving exact audio length.
pub fn apply_gate(samples: &mut [f32], sample_rate: u32, threshold_db: f32, channels: u16) {
    if samples.is_empty() || channels == 0 || sample_rate == 0 {
        return;
    }
    let threshold_linear = 10.0f32.powf(threshold_db / 20.0);
    let ch = channels as usize;
    // ~30 ms frames as defined by EnergyVad
    let frame_samples = ((sample_rate as f32 * 0.030).round() as usize).max(1);

    if ch == 1 {
        let mut vad = EnergyVad::new(threshold_linear, sample_rate);
        for chunk in samples.chunks_mut(frame_samples) {
            if vad.push_frame(chunk).is_noise() {
                chunk.fill(0.0);
            }
        }
    } else {
        let stride = frame_samples * ch;
        let mut vad = EnergyVad::new(threshold_linear, sample_rate);
        for chunk in samples.chunks_mut(stride) {
            let num_frames = chunk.len() / ch;
            let mut mono = Vec::with_capacity(num_frames);
            for f in 0..num_frames {
                let mut sum = 0.0f32;
                for c in 0..ch {
                    sum += chunk[f * ch + c];
                }
                mono.push(sum / ch as f32);
            }
            if vad.push_frame(&mono).is_noise() {
                chunk.fill(0.0);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Block 4: AGC (Automatic Gain Control)
// ---------------------------------------------------------------------------

/// Applies Automatic Gain Control (AGC) in-place.
/// Normalizes active speech RMS toward `target_db` and leaves gated frames (silent/zeroed) alone.
/// Clips nothing by limiting gain based on frame peak amplitude.
pub fn apply_agc(samples: &mut [f32], target_db: f32, sample_rate: u32, channels: u16) {
    if samples.is_empty() || channels == 0 || sample_rate == 0 {
        return;
    }
    let target_rms = 10.0f32.powf(target_db / 20.0);
    let ch = channels as usize;
    let frame_samples = ((sample_rate as f32 * 0.030).round() as usize).max(1) * ch;

    let mut current_gain = 1.0f32;
    let mut initialized = false;

    for chunk in samples.chunks_mut(frame_samples) {
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

        // Gated/silent frame: leave alone
        if frame_rms < 1e-4 {
            continue;
        }

        let desired_gain = (target_rms / frame_rms).clamp(0.05, 30.0);
        if !initialized {
            current_gain = desired_gain;
            initialized = true;
        } else {
            current_gain = current_gain * 0.6 + desired_gain * 0.4;
        }

        // Prevent clipping
        let max_gain = if peak > 0.0 { 0.99 / peak } else { 30.0 };
        let gain = current_gain.min(max_gain);

        for s in chunk.iter_mut() {
            *s = (*s * gain).clamp(-1.0, 1.0);
        }
    }
}

// ---------------------------------------------------------------------------
// Full Denoise Pipeline
// ---------------------------------------------------------------------------

/// Applies the noise suppression chain in the frozen contract order:
/// RNNoise -> High-pass -> Gate -> AGC.
pub fn apply_denoise_chain(
    samples: &mut [f32],
    sample_rate: u32,
    channels: u16,
    config: &DenoiseConfig,
) {
    if samples.is_empty() || channels == 0 || sample_rate == 0 {
        return;
    }

    // 1. RNNoise (neural noise suppression)
    if config.denoise_rnnoise {
        apply_rnnoise(samples, sample_rate, channels);
    }

    // 2. High-pass filter
    if config.denoise_highpass {
        apply_highpass(samples, sample_rate, config.denoise_highpass_hz, channels);
    }

    // 3. Noise gate
    if config.denoise_gate {
        apply_gate(samples, sample_rate, config.denoise_gate_db, channels);
    }

    // 4. AGC
    if config.denoise_agc {
        apply_agc(samples, config.denoise_agc_target_db, sample_rate, channels);
    }
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
}
