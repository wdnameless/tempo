//! Alarm audio that does not depend on a visible window.
//!
//! When the window is hidden or minimised, WebView2 suspends the page and its
//! WebAudio graph with it, so an alarm raised in the webview is silent exactly
//! when it matters most. The backend therefore synthesises the signal itself and
//! plays it through the OS audio device.
//!
//! The signal shapes mirror the frontend profiles with pleasant musical acoustics
//! (warm harmonics, proper attack/decay envelopes, click-free edges) and support
//! custom audio files with safe fallback to built-in cues.

use rodio::{buffer::SamplesBuffer, OutputStream, OutputStreamHandle};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How long the signal takes to reach full volume.
const RAMP: Duration = Duration::from_secs(30);
/// The floor volume, so the first ring is audible but not startling.
const MIN_VOLUME: f32 = 0.05;
/// Silence inserted after each pass of the signal.
const TAIL_SECS: f32 = 1.5;
const RATE: u32 = 44_100;

/// Which alarm is currently audible. Every `start` and `stop` moves it on, and
/// the playing thread exits as soon as it sees a generation it does not own.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Identity of the alarm the current generation belongs to.
static CURRENT_ID: Mutex<Option<String>> = Mutex::new(None);

/// Preferences for alarm audio playback.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlarmAudioPrefs {
    pub enabled: bool,
    pub volume: f32,
    pub profile: String,
    pub custom_path: Option<String>,
}

impl Default for AlarmAudioPrefs {
    fn default() -> Self {
        Self {
            enabled: true,
            volume: 0.8,
            profile: "gentle".to_string(),
            custom_path: None,
        }
    }
}

static AUDIO_PREFS: Mutex<AlarmAudioPrefs> = Mutex::new(AlarmAudioPrefs {
    enabled: true,
    volume: 0.8,
    profile: String::new(),
    custom_path: None,
});

/// Harmonic overtone for natural timbre synthesis.
#[derive(Debug, Clone, Copy)]
pub struct Harmonic {
    pub ratio: f32,
    pub weight: f32,
    pub decay_mult: f32,
}

/// Description of one musical note within a motif.
#[derive(Debug, Clone, Copy)]
pub struct NoteSpec {
    pub freq: f32,
    pub start_secs: f32,
    pub duration_secs: f32,
    pub harmonics: &'static [Harmonic],
}

/// One alarm signal shape: musical notes plus repeat cadence.
#[derive(Debug, Clone, Copy)]
pub struct Profile {
    pub id: &'static str,
    pub label: &'static str,
    pub notes: &'static [NoteSpec],
    /// Seconds between the starts of consecutive motifs.
    pub cadence: f32,
}

/// Metadata exposed to the UI for profile selection.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AlarmSoundProfileDesc {
    pub id: String,
    pub label: String,
}

const WARM_CHIME_HARMONICS: &[Harmonic] = &[
    Harmonic { ratio: 1.0, weight: 0.65, decay_mult: 1.0 },
    Harmonic { ratio: 2.0, weight: 0.25, decay_mult: 1.6 },
    Harmonic { ratio: 3.0, weight: 0.10, decay_mult: 2.2 },
];

const BELL_HARMONICS: &[Harmonic] = &[
    Harmonic { ratio: 1.0, weight: 0.50, decay_mult: 0.9 },
    Harmonic { ratio: 1.5, weight: 0.22, decay_mult: 1.4 },
    Harmonic { ratio: 2.0, weight: 0.18, decay_mult: 1.8 },
    Harmonic { ratio: 2.76, weight: 0.10, decay_mult: 2.5 },
];

const GENTLE_HARMONICS: &[Harmonic] = &[
    Harmonic { ratio: 1.0, weight: 0.75, decay_mult: 1.0 },
    Harmonic { ratio: 2.0, weight: 0.20, decay_mult: 1.8 },
    Harmonic { ratio: 3.0, weight: 0.05, decay_mult: 2.5 },
];

const PULSE_HARMONICS: &[Harmonic] = &[
    Harmonic { ratio: 1.0, weight: 0.85, decay_mult: 1.0 },
    Harmonic { ratio: 2.0, weight: 0.15, decay_mult: 2.0 },
];

const GENTLE_NOTES: &[NoteSpec] = &[
    NoteSpec { freq: 587.33, start_secs: 0.0, duration_secs: 0.9, harmonics: WARM_CHIME_HARMONICS },
    NoteSpec { freq: 880.00, start_secs: 0.35, duration_secs: 1.1, harmonics: WARM_CHIME_HARMONICS },
];

const CHIME_NOTES: &[NoteSpec] = &[
    NoteSpec { freq: 659.25, start_secs: 0.0, duration_secs: 0.8, harmonics: BELL_HARMONICS },
    NoteSpec { freq: 830.61, start_secs: 0.22, duration_secs: 0.8, harmonics: BELL_HARMONICS },
    NoteSpec { freq: 987.77, start_secs: 0.44, duration_secs: 1.2, harmonics: BELL_HARMONICS },
];

const ARPEGGIO_NOTES: &[NoteSpec] = &[
    NoteSpec { freq: 523.25, start_secs: 0.0, duration_secs: 0.6, harmonics: GENTLE_HARMONICS },
    NoteSpec { freq: 659.25, start_secs: 0.16, duration_secs: 0.6, harmonics: GENTLE_HARMONICS },
    NoteSpec { freq: 783.99, start_secs: 0.32, duration_secs: 0.6, harmonics: GENTLE_HARMONICS },
    NoteSpec { freq: 987.77, start_secs: 0.48, duration_secs: 0.7, harmonics: GENTLE_HARMONICS },
    NoteSpec { freq: 1046.50, start_secs: 0.64, duration_secs: 1.1, harmonics: GENTLE_HARMONICS },
];

const BELL_NOTES: &[NoteSpec] = &[
    NoteSpec { freq: 523.25, start_secs: 0.0, duration_secs: 1.6, harmonics: BELL_HARMONICS },
    NoteSpec { freq: 783.99, start_secs: 0.4, duration_secs: 2.0, harmonics: BELL_HARMONICS },
];

const RADAR_NOTES: &[NoteSpec] = &[
    NoteSpec { freq: 520.0, start_secs: 0.0, duration_secs: 0.35, harmonics: PULSE_HARMONICS },
    NoteSpec { freq: 700.0, start_secs: 0.18, duration_secs: 0.35, harmonics: PULSE_HARMONICS },
    NoteSpec { freq: 520.0, start_secs: 0.36, duration_secs: 0.5, harmonics: PULSE_HARMONICS },
];

const ENERGETIC_NOTES: &[NoteSpec] = &[
    NoteSpec { freq: 880.0, start_secs: 0.0, duration_secs: 0.25, harmonics: WARM_CHIME_HARMONICS },
    NoteSpec { freq: 1100.0, start_secs: 0.15, duration_secs: 0.25, harmonics: WARM_CHIME_HARMONICS },
    NoteSpec { freq: 1320.0, start_secs: 0.30, duration_secs: 0.25, harmonics: WARM_CHIME_HARMONICS },
    NoteSpec { freq: 1760.0, start_secs: 0.45, duration_secs: 0.5, harmonics: WARM_CHIME_HARMONICS },
];

const BEEP_NOTES: &[NoteSpec] = &[
    NoteSpec { freq: 1000.0, start_secs: 0.0, duration_secs: 0.2, harmonics: PULSE_HARMONICS },
    NoteSpec { freq: 1000.0, start_secs: 0.28, duration_secs: 0.2, harmonics: PULSE_HARMONICS },
    NoteSpec { freq: 1000.0, start_secs: 0.56, duration_secs: 0.25, harmonics: PULSE_HARMONICS },
];

pub static BUILTIN_PROFILES: &[Profile] = &[
    Profile {
        id: "gentle",
        label: "Gentle Chime",
        notes: GENTLE_NOTES,
        cadence: 3.5,
    },
    Profile {
        id: "chime",
        label: "Soft Bell",
        notes: CHIME_NOTES,
        cadence: 3.2,
    },
    Profile {
        id: "arpeggio",
        label: "Rising Arpeggio",
        notes: ARPEGGIO_NOTES,
        cadence: 3.0,
    },
    Profile {
        id: "bell",
        label: "Singing Bell",
        notes: BELL_NOTES,
        cadence: 3.8,
    },
    Profile {
        id: "radar",
        label: "Radar",
        notes: RADAR_NOTES,
        cadence: 2.5,
    },
    Profile {
        id: "energetic",
        label: "Energetic",
        notes: ENERGETIC_NOTES,
        cadence: 2.2,
    },
    Profile {
        id: "beep",
        label: "Clean Beep",
        notes: BEEP_NOTES,
        cadence: 3.0,
    },
];

/// Returns the list of built-in sound profile descriptions for UI display.
pub fn list_profiles() -> Vec<AlarmSoundProfileDesc> {
    BUILTIN_PROFILES
        .iter()
        .map(|p| AlarmSoundProfileDesc {
            id: p.id.to_string(),
            label: p.label.to_string(),
        })
        .collect()
}

/// Finds a profile by ID, falling back to "gentle" if unknown.
pub fn profile_for(name: &str) -> Profile {
    BUILTIN_PROFILES
        .iter()
        .find(|p| p.id.eq_ignore_ascii_case(name))
        .copied()
        .unwrap_or(BUILTIN_PROFILES[0])
}

/// Renders one motif as mono PCM with smooth attack/decay and harmonic richness.
pub fn render_motif(profile: &Profile, volume: f32) -> SamplesBuffer<f32> {
    let mut max_end_secs = 0.0f32;
    for note in profile.notes {
        max_end_secs = max_end_secs.max(note.start_secs + note.duration_secs);
    }
    let total_secs = max_end_secs + TAIL_SECS;
    let total_samples = (RATE as f32 * total_secs).ceil() as usize;

    let mut samples = vec![0.0f32; total_samples];
    const ATTACK_SECS: f32 = 0.015;
    const RELEASE_SECS: f32 = 0.020;

    for note in profile.notes {
        let note_start_sample = (note.start_secs * RATE as f32) as usize;
        let note_len_samples = (note.duration_secs * RATE as f32) as usize;
        let note_end_sample = (note_start_sample + note_len_samples).min(total_samples);

        for (sample_offset, sample) in samples[note_start_sample..note_end_sample].iter_mut().enumerate() {
            let u = sample_offset as f32 / RATE as f32;

            let attack = if u < ATTACK_SECS {
                0.5 * (1.0 - (std::f32::consts::PI * u / ATTACK_SECS).cos())
            } else {
                1.0
            };

            let time_from_end = note.duration_secs - u;
            let release = if (0.0..RELEASE_SECS).contains(&time_from_end) {
                0.5 * (1.0 - (std::f32::consts::PI * (1.0 - time_from_end / RELEASE_SECS)).cos())
            } else {
                1.0
            };

            let env = attack * release;

            let mut note_val = 0.0f32;
            for h in note.harmonics {
                let freq = note.freq * h.ratio;
                let phase = 2.0 * std::f32::consts::PI * freq * u;
                let decay = (-u * 2.8 * h.decay_mult).exp();
                note_val += phase.sin() * h.weight * decay;
            }

            *sample += note_val * env * 0.35 * volume;
        }
    }

    for s in &mut samples {
        if s.abs() > 0.95 {
            *s = s.signum() * (0.95 + 0.05 * ((*s).abs() - 0.95).tanh());
        }
    }

    SamplesBuffer::new(1, RATE, samples)
}

/// Plays one motif at the given volume.
pub fn play_motif(handle: &OutputStreamHandle, profile: &Profile, volume: f32) {
    let _ = handle.play_raw(render_motif(profile, volume));
}

/// Current resolved audio source: either a validated custom file or a built-in profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SoundSource {
    Custom(PathBuf),
    Builtin(String),
}

/// Opens and returns a rodio decoder for the audio file at `path`.
pub fn open_decoder(path: &Path) -> Result<rodio::Decoder<BufReader<File>>, String> {
    if !path.exists() {
        return Err(format!("sound file does not exist: '{}'", path.display()));
    }
    let file = File::open(path)
        .map_err(|e| format!("cannot open sound file '{}': {e}", path.display()))?;
    let meta = file
        .metadata()
        .map_err(|e| format!("cannot read metadata for '{}': {e}", path.display()))?;
    if meta.len() == 0 {
        return Err(format!("sound file is empty (0 bytes): '{}'", path.display()));
    }
    let reader = BufReader::new(file);
    rodio::Decoder::new(reader)
        .map_err(|e| format!("undecodable audio format in '{}': {e}", path.display()))
}

/// Verifies that an audio file exists, is non-empty, and can be decoded by rodio.
pub fn validate_sound_file(path: &Path) -> Result<(), String> {
    open_decoder(path).map(|_| ())
}

/// Resolves sound source, logging a warning and falling back to built-in if the custom path is invalid.
pub fn resolve_sound_source(
    custom_path: Option<&str>,
    fallback_profile: &str,
) -> (SoundSource, Option<String>) {
    if let Some(raw_path) = custom_path {
        let trimmed = raw_path.trim();
        if !trimmed.is_empty() {
            let path = PathBuf::from(trimmed);
            match validate_sound_file(&path) {
                Ok(()) => return (SoundSource::Custom(path), None),
                Err(err) => {
                    let warn = format!(
                        "custom alarm sound file '{}' invalid ({err}); falling back to profile '{fallback_profile}'",
                        trimmed
                    );
                    eprintln!("{warn}");
                    return (SoundSource::Builtin(fallback_profile.to_string()), Some(warn));
                }
            }
        }
    }
    (SoundSource::Builtin(fallback_profile.to_string()), None)
}

/// Reads the in-memory preferences snapshot.
pub fn get_prefs_snapshot() -> AlarmAudioPrefs {
    let guard = AUDIO_PREFS.lock().unwrap_or_else(|e| e.into_inner());
    let mut p = guard.clone();
    if p.profile.is_empty() {
        p.profile = "gentle".to_string();
    }
    p
}


/// Retrieves audio preferences, syncing from SQLite storage if an AppHandle is available.
pub fn get_prefs(app: Option<&tauri::AppHandle>) -> AlarmAudioPrefs {
    if let Some(app) = app {
        if let Ok(prefs) = crate::storage::with_db(app, |conn| {
            let enabled = crate::storage::repo::pref_get(conn, "tempo_alarm_enabled")?
                .or_else(|| crate::storage::repo::pref_get(conn, "alarmer_alarm_enabled").ok().flatten())
                .and_then(|v| serde_json::from_str::<bool>(&v).ok())
                .unwrap_or(true);

            let volume = crate::storage::repo::pref_get(conn, "tempo_alarm_volume")?
                .or_else(|| crate::storage::repo::pref_get(conn, "alarmer_alarm_volume").ok().flatten())
                .and_then(|v| serde_json::from_str::<f32>(&v).ok())
                .unwrap_or(0.8);

            let profile = crate::storage::repo::pref_get(conn, "tempo_alarm_sound_profile")?
                .or_else(|| crate::storage::repo::pref_get(conn, "tempo_sound_profile").ok().flatten())
                .or_else(|| crate::storage::repo::pref_get(conn, "alarmer_sound_profile").ok().flatten())
                .map(|v| v.trim_matches('"').to_string())
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| "gentle".to_string());

            let custom_path = crate::storage::repo::pref_get(conn, "tempo_custom_alarm_sound")?
                .or_else(|| crate::storage::repo::pref_get(conn, "alarmer_custom_alarm_sound").ok().flatten())
                .map(|v| v.trim_matches('"').to_string())
                .filter(|v| !v.trim().is_empty());

            Ok(AlarmAudioPrefs {
                enabled,
                volume,
                profile,
                custom_path,
            })
        }) {
            let mut guard = AUDIO_PREFS.lock().unwrap_or_else(|e| e.into_inner());
            *guard = prefs.clone();
            return prefs;
        }
    }

    get_prefs_snapshot()
}

/// Updates alarm audio preferences and persists them to SQLite storage.
pub fn set_prefs_and_persist(
    app: &tauri::AppHandle,
    volume: Option<f32>,
    enabled: Option<bool>,
    profile: Option<String>,
    custom_path: Option<String>,
) -> Result<(), String> {
    let mut current = get_prefs(Some(app));
    if let Some(v) = volume {
        current.volume = v.clamp(0.0, 1.0);
    }
    if let Some(e) = enabled {
        current.enabled = e;
    }
    if let Some(p) = profile {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            current.profile = trimmed.to_string();
        }
    }
    if let Some(c) = custom_path {
        let trimmed = c.trim();
        if trimmed.is_empty() {
            current.custom_path = None;
        } else {
            current.custom_path = Some(trimmed.to_string());
        }
    }

    {
        let mut guard = AUDIO_PREFS.lock().unwrap_or_else(|e| e.into_inner());
        *guard = current.clone();
    }

    crate::storage::with_db(app, |conn| {
        crate::storage::repo::pref_set(conn, "tempo_alarm_enabled", &current.enabled.to_string())?;
        crate::storage::repo::pref_set(conn, "tempo_alarm_volume", &current.volume.to_string())?;
        crate::storage::repo::pref_set(
            conn,
            "tempo_alarm_sound_profile",
            &format!("\"{}\"", current.profile),
        )?;
        let custom_val = current.custom_path.as_deref().unwrap_or("");
        crate::storage::repo::pref_set(
            conn,
            "tempo_custom_alarm_sound",
            &format!("\"{custom_val}\""),
        )?;
        Ok(())
    })?;

    Ok(())
}

fn ramped_volume(started: Instant, target_volume: f32) -> f32 {
    let progress = (started.elapsed().as_secs_f32() / RAMP.as_secs_f32()).min(1.0);
    MIN_VOLUME.max(target_volume * progress)
}

fn play_builtin_loop(
    handle: &OutputStreamHandle,
    shape: &Profile,
    target_volume: f32,
    started: Instant,
    generation: u64,
) {
    let cadence = Duration::from_secs_f32(shape.cadence);
    loop {
        if GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }

        let volume = ramped_volume(started, target_volume);

        if GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        play_motif(handle, shape, volume);

        let deadline = Instant::now() + cadence;
        while Instant::now() < deadline {
            if GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

fn play_custom_loop(
    handle: &OutputStreamHandle,
    path: &Path,
    target_volume: f32,
    started: Instant,
    generation: u64,
    fallback_profile: &str,
) {
    loop {
        if GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }

        let decoder = match open_decoder(path) {
            Ok(d) => d,
            Err(e) => {
                eprintln!(
                    "cannot decode custom alarm sound '{}': {e}, falling back to built-in '{fallback_profile}'",
                    path.display()
                );
                let shape = profile_for(fallback_profile);
                play_builtin_loop(handle, &shape, target_volume, started, generation);
                return;
            }
        };

        let sink = match rodio::Sink::try_new(handle) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("failed to create audio sink: {e}");
                return;
            }
        };

        let initial_volume = ramped_volume(started, target_volume);
        sink.set_volume(initial_volume);
        sink.append(decoder);

        while !sink.empty() {
            if GENERATION.load(Ordering::SeqCst) != generation {
                sink.stop();
                return;
            }

            let volume = ramped_volume(started, target_volume);
            sink.set_volume(volume);

            std::thread::sleep(Duration::from_millis(100));
        }

        let gap_end = Instant::now() + Duration::from_millis(1500);
        while Instant::now() < gap_end {
            if GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

/// Starts ringing `id` with the named signal profile or configured custom sound at `target_volume`.
pub fn start(id: &str, profile: &str, target_volume: f32) -> Result<(), String> {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    *CURRENT_ID.lock().unwrap_or_else(|e| e.into_inner()) = Some(id.to_string());

    let prefs = get_prefs_snapshot();
    let effective_profile = if profile.is_empty() {
        prefs.profile.as_str()
    } else {
        profile
    };

    let (sound_source, _warn) = resolve_sound_source(prefs.custom_path.as_deref(), effective_profile);
    let fallback_name = effective_profile.to_string();

    std::thread::spawn(move || {
        let Ok((_stream, handle)) = OutputStream::try_default() else {
            eprintln!("alarm audio: no output device");
            return;
        };

        let started = Instant::now();
        match sound_source {
            SoundSource::Custom(path) => {
                play_custom_loop(&handle, &path, target_volume, started, generation, &fallback_name);
            }
            SoundSource::Builtin(prof_name) => {
                let shape = profile_for(&prof_name);
                play_builtin_loop(&handle, &shape, target_volume, started, generation);
            }
        }
    });

    Ok(())
}

/// Previews an alarm sound (built-in profile or custom sound file) at `volume`.
pub fn preview(
    profile: Option<&str>,
    custom_path: Option<&str>,
    volume: Option<f32>,
) -> Result<(), String> {
    stop();
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    let prefs = get_prefs_snapshot();
    let target_volume = volume.unwrap_or(prefs.volume).clamp(0.0, 1.0);
    let requested_profile = profile.unwrap_or(prefs.profile.as_str());
    let requested_custom = custom_path.or(prefs.custom_path.as_deref());

    let (sound_source, _warn) = resolve_sound_source(requested_custom, requested_profile);
    let fallback_name = requested_profile.to_string();

    std::thread::spawn(move || {
        let Ok((_stream, handle)) = OutputStream::try_default() else {
            eprintln!("preview audio: no output device");
            return;
        };

        match sound_source {
            SoundSource::Custom(path) => {
                let decoder = match open_decoder(&path) {
                    Ok(d) => d,
                    Err(e) => {
                        eprintln!("cannot decode preview custom sound '{}': {e}", path.display());
                        let shape = profile_for(&fallback_name);
                        play_preview_motif(&handle, &shape, target_volume, generation);
                        return;
                    }
                };
                let Ok(sink) = rodio::Sink::try_new(&handle) else {
                    return;
                };
                sink.set_volume(target_volume);
                sink.append(decoder);

                let deadline = Instant::now() + Duration::from_secs(10);
                while !sink.empty() && Instant::now() < deadline {
                    if GENERATION.load(Ordering::SeqCst) != generation {
                        sink.stop();
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                sink.stop();
            }
            SoundSource::Builtin(prof_name) => {
                let shape = profile_for(&prof_name);
                play_preview_motif(&handle, &shape, target_volume, generation);
            }
        }
    });

    Ok(())
}

fn play_preview_motif(
    handle: &OutputStreamHandle,
    shape: &Profile,
    volume: f32,
    generation: u64,
) {
    if GENERATION.load(Ordering::SeqCst) != generation {
        return;
    }
    play_motif(handle, shape, volume);
    let duration = Duration::from_secs_f32(shape.cadence.min(4.0));
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        if GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Silences whatever is ringing.
pub fn stop() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    *CURRENT_ID.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// Id of the alarm currently ringing, if any.
pub fn ringing_id() -> Option<String> {
    CURRENT_ID.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[test]
    fn every_frontend_profile_has_a_shape() {
        for name in ["gentle", "chime", "radar", "energetic", "beep"] {
            let shape = profile_for(name);
            assert!(!shape.notes.is_empty(), "{name} must have at least one note");
            assert!(shape.cadence > 0.0, "{name} must have a positive cadence");
        }
    }

    #[test]
    fn an_unknown_profile_falls_back_instead_of_silence() {
        assert!(!profile_for("not-a-profile").notes.is_empty());
    }

    #[test]
    fn a_rendered_motif_is_audible_and_bounded() {
        let samples: Vec<f32> = render_motif(&profile_for("gentle"), 0.5).collect();

        assert!(!samples.is_empty());
        let peak = samples.iter().fold(0.0f32, |acc, s| acc.max(s.abs()));
        assert!(peak > 0.0, "the motif must produce sound");
        assert!(peak <= 1.0, "peak {peak} exceeds full scale");
    }

    #[test]
    fn volume_scales_the_rendered_signal() {
        let peak = |s: Vec<f32>| s.iter().fold(0.0f32, |acc, v| acc.max(v.abs()));
        let quiet = peak(render_motif(&profile_for("gentle"), 0.1).collect());
        let loud = peak(render_motif(&profile_for("gentle"), 1.0).collect());

        assert!(loud > quiet, "a louder request must render louder");
    }

    #[test]
    fn stopping_clears_the_ringing_flag_and_advances_the_generation() {
        let before = GENERATION.load(Ordering::SeqCst);
        stop();

        assert!(ringing_id().is_none());
        assert_ne!(
            GENERATION.load(Ordering::SeqCst),
            before,
            "a stop must invalidate the playing generation"
        );
    }

    #[test]
    fn builtin_profiles_list_is_stable() {
        let profiles = list_profiles();
        let expected_ids = [
            "gentle",
            "chime",
            "arpeggio",
            "bell",
            "radar",
            "energetic",
            "beep",
        ];

        let actual_ids: Vec<&str> = profiles.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(actual_ids, expected_ids, "profile IDs and order must remain stable");
    }

    #[test]
    fn custom_sound_fallback_when_path_missing() {
        let missing_path = "non_existent_audio_path_tempo_test.mp3";
        let (source, warn) = resolve_sound_source(Some(missing_path), "chime");

        assert_eq!(
            source,
            SoundSource::Builtin("chime".to_string()),
            "missing file must fall back to specified profile"
        );
        assert!(warn.is_some(), "warning message must be produced when fallback occurs");
        let warn_text = warn.unwrap();
        assert!(warn_text.contains("invalid") || warn_text.contains("does not exist"));
    }

    #[test]
    fn custom_sound_fallback_when_file_empty() {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_str().unwrap();

        let (source, warn) = resolve_sound_source(Some(path), "gentle");
        assert_eq!(
            source,
            SoundSource::Builtin("gentle".to_string()),
            "empty file must fall back to specified profile"
        );
        assert!(warn.is_some());
    }

    #[test]
    fn custom_sound_fallback_when_file_corrupt() {
        use std::io::Write;
        let mut tmp = NamedTempFile::new().unwrap();
        write!(tmp, "not valid audio bytes at all!").unwrap();
        let path = tmp.path().to_str().unwrap();

        let (source, warn) = resolve_sound_source(Some(path), "arpeggio");
        assert_eq!(
            source,
            SoundSource::Builtin("arpeggio".to_string()),
            "corrupted file must fall back to specified profile"
        );
        assert!(warn.is_some());
    }

    #[test]
    fn click_free_and_envelope_properties() {
        for profile in BUILTIN_PROFILES {
            let samples: Vec<f32> = render_motif(profile, 0.8).collect();
            assert!(!samples.is_empty());

            // First sample starts smooth at 0 (no click on attack)
            assert!(
                samples[0].abs() < 1e-4,
                "profile {} has click at attack: sample[0] = {}",
                profile.id,
                samples[0]
            );

            // Tail finishes smooth at 0 (no click at end)
            let last = *samples.last().unwrap();
            assert!(
                last.abs() < 1e-4,
                "profile {} has click at release: last = {}",
                profile.id,
                last
            );

            // Stays inside [-1.0, 1.0]
            for (idx, &s) in samples.iter().enumerate() {
                assert!(
                    s.abs() <= 1.0,
                    "profile {} sample[{idx}] = {s} clipped!",
                    profile.id
                );
            }
        }
    }
}
