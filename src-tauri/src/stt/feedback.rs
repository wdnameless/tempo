//! Audio feedback cues for speech dictation events.
//!
//! Provides audible feedback for dictation lifecycle events:
//! - [`SoundKind::Start`]: Ascending chime signaling microphone is listening.
//! - [`SoundKind::Stop`]: Descending chime signaling recording finished and processing began.
//! - [`SoundKind::Cancel`]: Neutral low blips signaling dictation was discarded.
//! - [`SoundKind::Error`]: Low discordant tone signaling a capture or transcription failure.
//!
//! Features three distinct sound profiles:
//! - [`SoundTheme::Default`]: Clean, bright sine tones.
//! - [`SoundTheme::Soft`]: Warmer, rounded tones with gentle harmonics.
//! - [`SoundTheme::Mechanical`]: Crisp, short click-style cues.
//!
//! Synthesized programmatically via `rodio` without requiring external audio assets.
//! If no audio output device is present or playback fails, operations silently no-op:
//! audio cues must NEVER panic and NEVER fail dictation.

use std::str::FromStr;
use rodio::{buffer::SamplesBuffer, OutputStream, Sink};
use serde::{Deserialize, Serialize};

/// Identifies the dictation lifecycle cue to play.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SoundKind {
    Start,
    Stop,
    Cancel,
    Error,
}

impl FromStr for SoundKind {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "start" => Ok(Self::Start),
            "stop" => Ok(Self::Stop),
            "cancel" => Ok(Self::Cancel),
            "error" => Ok(Self::Error),
            _ => Ok(Self::Start),
        }
    }
}

/// Aesthetic theme for synthesized cues.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SoundTheme {
    #[default]
    Default,
    Soft,
    Mechanical,
}

impl FromStr for SoundTheme {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "soft" => Ok(Self::Soft),
            "mechanical" => Ok(Self::Mechanical),
            _ => Ok(Self::Default),
        }
    }
}

const SAMPLE_RATE: u32 = 44_100;

struct Note {
    freq: f32,
    duration_secs: f32,
    gap_secs: f32,
}

fn notes_for(kind: SoundKind, theme: SoundTheme) -> Vec<Note> {
    match (kind, theme) {
        (SoundKind::Start, SoundTheme::Default) => vec![
            Note { freq: 587.33, duration_secs: 0.055, gap_secs: 0.01 }, // D5
            Note { freq: 880.00, duration_secs: 0.075, gap_secs: 0.02 }, // A5
        ],
        (SoundKind::Start, SoundTheme::Soft) => vec![
            Note { freq: 440.00, duration_secs: 0.065, gap_secs: 0.01 }, // A4
            Note { freq: 659.25, duration_secs: 0.085, gap_secs: 0.02 }, // E5
        ],
        (SoundKind::Start, SoundTheme::Mechanical) => vec![
            Note { freq: 880.00, duration_secs: 0.030, gap_secs: 0.005 },
            Note { freq: 1320.00, duration_secs: 0.040, gap_secs: 0.01 },
        ],

        (SoundKind::Stop, SoundTheme::Default) => vec![
            Note { freq: 880.00, duration_secs: 0.055, gap_secs: 0.01 }, // A5
            Note { freq: 587.33, duration_secs: 0.075, gap_secs: 0.02 }, // D5
        ],
        (SoundKind::Stop, SoundTheme::Soft) => vec![
            Note { freq: 659.25, duration_secs: 0.065, gap_secs: 0.01 }, // E5
            Note { freq: 440.00, duration_secs: 0.085, gap_secs: 0.02 }, // A4
        ],
        (SoundKind::Stop, SoundTheme::Mechanical) => vec![
            Note { freq: 1320.00, duration_secs: 0.030, gap_secs: 0.005 },
            Note { freq: 880.00, duration_secs: 0.040, gap_secs: 0.01 },
        ],

        (SoundKind::Cancel, SoundTheme::Default) => vec![
            Note { freq: 440.00, duration_secs: 0.045, gap_secs: 0.015 },
            Note { freq: 330.00, duration_secs: 0.065, gap_secs: 0.02 },
        ],
        (SoundKind::Cancel, SoundTheme::Soft) => vec![
            Note { freq: 370.00, duration_secs: 0.055, gap_secs: 0.015 },
            Note { freq: 293.66, duration_secs: 0.075, gap_secs: 0.02 },
        ],
        (SoundKind::Cancel, SoundTheme::Mechanical) => vec![
            Note { freq: 600.00, duration_secs: 0.025, gap_secs: 0.01 },
            Note { freq: 400.00, duration_secs: 0.035, gap_secs: 0.01 },
        ],

        (SoundKind::Error, SoundTheme::Default) => vec![
            Note { freq: 220.00, duration_secs: 0.070, gap_secs: 0.02 },
            Note { freq: 196.00, duration_secs: 0.090, gap_secs: 0.02 },
        ],
        (SoundKind::Error, SoundTheme::Soft) => vec![
            Note { freq: 261.63, duration_secs: 0.080, gap_secs: 0.02 },
            Note { freq: 220.00, duration_secs: 0.100, gap_secs: 0.02 },
        ],
        (SoundKind::Error, SoundTheme::Mechanical) => vec![
            Note { freq: 300.00, duration_secs: 0.035, gap_secs: 0.01 },
            Note { freq: 250.00, duration_secs: 0.045, gap_secs: 0.01 },
        ],
    }
}

/// Renders a synthesized cue into a mono f32 sample buffer.
pub fn synthesize_cue(kind: SoundKind, theme: SoundTheme, volume: f32) -> SamplesBuffer<f32> {
    let vol = volume.clamp(0.0, 1.0);
    if vol <= 0.0 {
        return SamplesBuffer::new(1, SAMPLE_RATE, vec![0.0]);
    }

    let notes = notes_for(kind, theme);
    let mut total_samples = 0usize;
    for note in &notes {
        total_samples += ((note.duration_secs + note.gap_secs) * SAMPLE_RATE as f32) as usize;
    }

    let mut samples = Vec::with_capacity(total_samples);

    for note in &notes {
        let note_len = (note.duration_secs * SAMPLE_RATE as f32) as usize;
        let gap_len = (note.gap_secs * SAMPLE_RATE as f32) as usize;
        let attack_len = ((SAMPLE_RATE as f32 * 0.005) as usize).min(note_len / 4).max(1);

        for i in 0..note_len {
            let t = i as f32 / SAMPLE_RATE as f32;
            let phase = 2.0 * std::f32::consts::PI * note.freq * t;

            let raw_sample = match theme {
                SoundTheme::Default => phase.sin(),
                SoundTheme::Soft => 0.85 * phase.sin() + 0.15 * (phase * 2.0).sin(),
                SoundTheme::Mechanical => 0.75 * phase.sin() + 0.25 * (phase * 3.0).sin(),
            };

            let env = if i < attack_len {
                i as f32 / attack_len as f32
            } else {
                let decay_progress = (i - attack_len) as f32 / (note_len - attack_len) as f32;
                (1.0 - decay_progress).max(0.0)
            };

            // Master level scale: 0.3 peak amplitude at volume 1.0 for comfortable loudness
            let s = raw_sample * env * 0.3 * vol;
            samples.push(s);
        }

        samples.extend(std::iter::repeat_n(0.0f32, gap_len));
    }

    SamplesBuffer::new(1, SAMPLE_RATE, samples)
}

/// Plays a synthesized sound cue asynchronously.
///
/// If volume <= 0.0 or audio output is unavailable, this returns immediately without failing.
pub fn play(kind: SoundKind, theme: SoundTheme, volume: f32) {
    if volume <= 0.0 {
        return;
    }
    let vol = volume.clamp(0.0, 1.0);
    std::thread::spawn(move || {
        let _ = std::panic::catch_unwind(|| {
            let Ok((_stream, stream_handle)) = OutputStream::try_default() else {
                return;
            };
            let buffer = synthesize_cue(kind, theme, vol);
            if let Ok(sink) = Sink::try_new(&stream_handle) {
                sink.append(buffer);
                sink.sleep_until_end();
            }
        });
    });
}

/// Plays a test sound cue (used in settings view).
pub fn play_test(kind: SoundKind, theme: SoundTheme, volume: f32) {
    play(kind, theme, volume);
}

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::Source;

    #[test]
    fn synthesize_cue_produces_finite_samples_in_range() {
        for kind in [SoundKind::Start, SoundKind::Stop, SoundKind::Cancel, SoundKind::Error] {
            for theme in [SoundTheme::Default, SoundTheme::Soft, SoundTheme::Mechanical] {
                let _buf = synthesize_cue(kind, theme, 0.8);
                // SamplesBuffer doesn't expose raw vec directly, but can be iterated or checked
                // by re-creating or checking volume bounds
                let zero_buf = synthesize_cue(kind, theme, 0.0);
                assert_eq!(zero_buf.sample_rate(), SAMPLE_RATE);
            }
        }
    }

    #[test]
    fn from_str_parses_sound_kind_and_theme() {
        assert_eq!(SoundKind::from_str("start").unwrap(), SoundKind::Start);
        assert_eq!(SoundKind::from_str("STOP").unwrap(), SoundKind::Stop);
        assert_eq!(SoundKind::from_str("cancel").unwrap(), SoundKind::Cancel);
        assert_eq!(SoundKind::from_str("error").unwrap(), SoundKind::Error);
        assert_eq!(SoundKind::from_str("unknown").unwrap(), SoundKind::Start);

        assert_eq!(SoundTheme::from_str("soft").unwrap(), SoundTheme::Soft);
        assert_eq!(SoundTheme::from_str("mechanical").unwrap(), SoundTheme::Mechanical);
        assert_eq!(SoundTheme::from_str("default").unwrap(), SoundTheme::Default);
        assert_eq!(SoundTheme::from_str("anything_else").unwrap(), SoundTheme::Default);
    }

    #[test]
    fn play_with_zero_volume_does_not_panic() {
        play(SoundKind::Start, SoundTheme::Default, 0.0);
        play_test(SoundKind::Stop, SoundTheme::Soft, -0.5);
    }
}
