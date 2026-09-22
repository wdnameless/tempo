use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub mod audio;
pub mod screen;

/// Devices available for audio recording (matches interfaces.md §19)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Devices {
    pub inputs: Vec<DeviceInfo>,
    pub loopback: Vec<DeviceInfo>,
}

/// Device info for audio sources
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

/// Screen / Window capture source info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceInfo {
    pub id: String,
    pub name: String,
    pub kind: String, // "monitor" | "window"
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

/// Start options from JS/TS UI (matches interfaces.md §19)
#[derive(Debug, Clone, Deserialize)]
pub struct StartOptions {
    pub kind: String, // "audio" | "screen"
    pub mic: Option<String>,
    pub system: Option<bool>,
    pub source_id: Option<String>,
    pub fps: Option<u32>,
}

/// Start result returned by recording_start: { path, kind }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartResult {
    pub path: String,
    pub kind: String,
}

/// Stop result returned by recording_stop: { path, duration_sec, bytes }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StopResult {
    pub path: String,
    pub duration_sec: f64,
    pub bytes: u64,
}

/// Status of the recording manager: { kind, paused, path, started_at }
/// kind is None ("null" in json) when idle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingState {
    pub kind: Option<String>,
    pub paused: bool,
    pub path: Option<String>,
    pub started_at: Option<u64>,
}

/// Real-time audio meter level
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct RecordingLevel {
    pub peak: f32,
    pub rms: f32,
}

/// Strongly-typed error enum as required by R45 and interfaces.md §19.
/// Serialized as unit string: "NoDevice", "AccessDenied", "DeviceBusy", "Unsupported", "AlreadyRecording", "NotRecording"
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RecordingError {
    NoDevice(String),
    AccessDenied(String),
    DeviceBusy(String),
    Unsupported(String),
    AlreadyRecording,
    NotRecording,
}

impl fmt::Display for RecordingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RecordingError::NoDevice(msg) => write!(f, "NoDevice: {msg}"),
            RecordingError::AccessDenied(msg) => write!(f, "AccessDenied: {msg}"),
            RecordingError::DeviceBusy(msg) => write!(f, "DeviceBusy: {msg}"),
            RecordingError::Unsupported(msg) => write!(f, "Unsupported: {msg}"),
            RecordingError::AlreadyRecording => write!(f, "AlreadyRecording"),
            RecordingError::NotRecording => write!(f, "NotRecording"),
        }
    }
}

impl std::error::Error for RecordingError {}

impl From<RecordingError> for String {
    fn from(err: RecordingError) -> Self {
        match err {
            RecordingError::NoDevice(_) => "NoDevice".to_string(),
            RecordingError::AccessDenied(_) => "AccessDenied".to_string(),
            RecordingError::DeviceBusy(_) => "DeviceBusy".to_string(),
            RecordingError::Unsupported(_) => "Unsupported".to_string(),
            RecordingError::AlreadyRecording => "AlreadyRecording".to_string(),
            RecordingError::NotRecording => "NotRecording".to_string(),
        }
    }
}

enum ActiveSession {
    Audio(audio::AudioRecordingSession),
    Screen(screen::ScreenRecordingSession),
}

struct SessionRecord {
    kind: String,
    path: PathBuf,
    started_at: u64,
    session: ActiveSession,
}

/// Global managed state for recording
pub struct RecordingManager {
    inner: Mutex<Option<SessionRecord>>,
}

impl RecordingManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    pub fn start(&self, options: StartOptions, assets_dir: &Path) -> Result<StartResult, RecordingError> {
        let mut guard = self.inner.lock().unwrap();
        if guard.is_some() {
            return Err(RecordingError::AlreadyRecording);
        }

        let kind = options.kind.as_str();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        match kind {
            "audio" => {
                let file_path = choose_media_path(assets_dir, "audio", "wav")?;
                let mic_id = options.mic;
                let sys_enabled = options.system.unwrap_or(false);
                let sys_id = if sys_enabled {
                    Some("default".to_string())
                } else {
                    None
                };

                let session = match audio::AudioRecordingSession::start(file_path.clone(), mic_id, sys_id) {
                    Ok(s) => s,
                    Err(e) => {
                        if file_path.exists() {
                            let _ = fs::remove_file(&file_path);
                        }
                        return Err(e);
                    }
                };

                *guard = Some(SessionRecord {
                    kind: "audio".to_string(),
                    path: file_path.clone(),
                    started_at: now,
                    session: ActiveSession::Audio(session),
                });

                Ok(StartResult {
                    path: file_path.to_string_lossy().to_string(),
                    kind: "audio".to_string(),
                })
            }
            "screen" => {
                let file_path = choose_media_path(assets_dir, "screen", "mp4")?;
                let source_id = options.source_id.unwrap_or_else(|| "monitor:primary".to_string());

                let session = match screen::ScreenRecordingSession::start(file_path.clone(), &source_id) {
                    Ok(s) => s,
                    Err(e) => {
                        if file_path.exists() {
                            let _ = fs::remove_file(&file_path);
                        }
                        return Err(e);
                    }
                };

                *guard = Some(SessionRecord {
                    kind: "screen".to_string(),
                    path: file_path.clone(),
                    started_at: now,
                    session: ActiveSession::Screen(session),
                });

                Ok(StartResult {
                    path: file_path.to_string_lossy().to_string(),
                    kind: "screen".to_string(),
                })
            }
            _ => Err(RecordingError::Unsupported(format!("Unknown recording kind: {kind}"))),
        }
    }

    pub fn pause(&self) -> Result<(), RecordingError> {
        let guard = self.inner.lock().unwrap();
        match guard.as_ref() {
            Some(record) => {
                match &record.session {
                    ActiveSession::Audio(s) => s.pause(),
                    ActiveSession::Screen(s) => s.pause(),
                }
                Ok(())
            }
            None => Err(RecordingError::NotRecording),
        }
    }

    pub fn resume(&self) -> Result<(), RecordingError> {
        let guard = self.inner.lock().unwrap();
        match guard.as_ref() {
            Some(record) => {
                match &record.session {
                    ActiveSession::Audio(s) => s.resume(),
                    ActiveSession::Screen(s) => s.resume(),
                }
                Ok(())
            }
            None => Err(RecordingError::NotRecording),
        }
    }

    pub fn stop(&self) -> Result<StopResult, RecordingError> {
        let mut guard = self.inner.lock().unwrap();
        let record = guard.take().ok_or(RecordingError::NotRecording)?;

        let (path, duration_sec) = match record.session {
            ActiveSession::Audio(s) => s.stop()?,
            ActiveSession::Screen(s) => s.stop()?,
        };

        let bytes = if path.exists() {
            fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };

        Ok(StopResult {
            path: path.to_string_lossy().to_string(),
            duration_sec,
            bytes,
        })
    }

    pub fn cancel(&self) -> Result<(), RecordingError> {
        let mut guard = self.inner.lock().unwrap();
        let record = guard.take().ok_or(RecordingError::NotRecording)?;

        match record.session {
            ActiveSession::Audio(s) => s.cancel()?,
            ActiveSession::Screen(s) => s.cancel()?,
        };

        Ok(())
    }

    pub fn state(&self) -> RecordingState {
        let guard = self.inner.lock().unwrap();
        match guard.as_ref() {
            Some(record) => {
                let paused = match &record.session {
                    ActiveSession::Audio(s) => s.is_paused(),
                    ActiveSession::Screen(s) => s.is_paused(),
                };
                RecordingState {
                    kind: Some(record.kind.clone()),
                    paused,
                    path: Some(record.path.to_string_lossy().to_string()),
                    started_at: Some(record.started_at),
                }
            }
            None => RecordingState {
                kind: None,
                paused: false,
                path: None,
                started_at: None,
            },
        }
    }

    pub fn level(&self) -> RecordingLevel {
        let guard = self.inner.lock().unwrap();
        match guard.as_ref() {
            Some(record) => match &record.session {
                ActiveSession::Audio(s) => s.level(),
                ActiveSession::Screen(_) => RecordingLevel { peak: 0.0, rms: 0.0 },
            },
            None => RecordingLevel { peak: 0.0, rms: 0.0 },
        }
    }
}

impl Default for RecordingManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Chooses media file path inside `<assets_dir>/<kind>/<uuid>.<ext>`
/// Rust decides this path, JS never passes one.
/// Verifies that kind and ext are safe and cannot escape assets directory.
pub fn choose_media_path(assets_dir: &Path, kind: &str, ext: &str) -> Result<PathBuf, RecordingError> {
    let clean_kind: String = kind
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let clean_ext: String = ext
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect();

    if clean_kind.is_empty() {
        return Err(RecordingError::Unsupported("Invalid asset kind".to_string()));
    }

    let target_dir = assets_dir.join(&clean_kind);
    if let Err(e) = fs::create_dir_all(&target_dir) {
        return Err(RecordingError::DeviceBusy(format!("Failed to create asset directory: {e}")));
    }

    let id = Uuid::new_v4().to_string();
    let filename = format!("{id}.{clean_ext}");
    let full_path = target_dir.join(filename);

    Ok(full_path)
}

fn get_assets_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::storage::assets_path(app)
}

// ----------------------------------------------------------------------------
// Tauri Command Handlers
// ----------------------------------------------------------------------------

#[tauri::command]
pub fn recording_devices() -> Result<Devices, String> {
    let inputs = audio::list_microphones().map_err(String::from)?;
    let loopback = audio::list_loopback_devices().map_err(String::from)?;
    Ok(Devices { inputs, loopback })
}

#[tauri::command]
pub fn recording_sources() -> Result<Vec<SourceInfo>, String> {
    screen::list_screen_sources().map_err(String::from)
}

#[tauri::command]
pub fn recording_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecordingManager>,
    options: StartOptions,
) -> Result<StartResult, String> {
    let dir = get_assets_dir(&app)?;
    state.start(options, &dir).map_err(String::from)
}

#[tauri::command]
pub fn recording_pause(state: tauri::State<'_, RecordingManager>) -> Result<(), String> {
    state.pause().map_err(String::from)
}

#[tauri::command]
pub fn recording_resume(state: tauri::State<'_, RecordingManager>) -> Result<(), String> {
    state.resume().map_err(String::from)
}

#[tauri::command]
pub fn recording_stop(
    state: tauri::State<'_, RecordingManager>,
) -> Result<StopResult, String> {
    state.stop().map_err(String::from)
}

#[tauri::command]
pub fn recording_cancel(state: tauri::State<'_, RecordingManager>) -> Result<(), String> {
    state.cancel().map_err(String::from)
}

#[tauri::command]
pub fn recording_state(state: tauri::State<'_, RecordingManager>) -> RecordingState {
    state.state()
}

#[tauri::command]
pub fn recording_level(state: tauri::State<'_, RecordingManager>) -> RecordingLevel {
    state.level()
}

#[tauri::command]
pub fn preview_path_in(assets_dir: &Path) -> PathBuf {
    assets_dir.join("screen").join("preview.png")
}

#[tauri::command]
pub fn recording_preview(
    app: tauri::AppHandle,
    source_id: String,
) -> Result<String, String> {
    let dir = get_assets_dir(&app)?;
    let target_path = preview_path_in(&dir);
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create preview dir: {e}"))?;
    }
    let out = screen::capture_preview_frame(&source_id, &target_path).map_err(String::from)?;
    Ok(out.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_choose_media_path_structure_and_traversal_guard() {
        let temp_dir = std::env::temp_dir().join(format!("tempo_test_{}", Uuid::new_v4()));
        let assets_dir = &temp_dir;

        let path = choose_media_path(assets_dir, "audio", "wav").unwrap();
        assert!(path.starts_with(assets_dir.join("audio")));
        assert!(path.to_string_lossy().ends_with(".wav"));

        // Malicious traversal attempts should be sanitized or caught
        let bad_path = choose_media_path(assets_dir, "../../../evil", "wav/../exe").unwrap();
        assert!(bad_path.starts_with(assets_dir.join("evil")));
        assert!(!bad_path.to_string_lossy().contains(".."));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_preview_path_reuses_single_file() {
        let temp_dir = std::env::temp_dir().join(format!("tempo_test_{}", Uuid::new_v4()));
        let p1 = preview_path_in(&temp_dir);
        let p2 = preview_path_in(&temp_dir);
        assert_eq!(p1, p2);
        assert_eq!(p1, temp_dir.join("screen").join("preview.png"));
    }

    #[test]
    fn test_recording_manager_state_machine_errors() {
        let manager = RecordingManager::new();

        // Stop or pause when not recording returns NotRecording
        assert_eq!(manager.stop().unwrap_err(), RecordingError::NotRecording);
        assert_eq!(manager.pause().unwrap_err(), RecordingError::NotRecording);
        assert_eq!(manager.resume().unwrap_err(), RecordingError::NotRecording);
        assert_eq!(manager.cancel().unwrap_err(), RecordingError::NotRecording);

        // Initial state is idle: kind: null, paused: false
        let st = manager.state();
        assert!(st.kind.is_none());
        assert!(!st.paused);
        assert!(st.path.is_none());
    }

    #[test]
    fn test_wire_format_exact_key_sets() {
        // 1. Devices key set: { inputs, loopback }
        let devices = Devices {
            inputs: vec![DeviceInfo {
                id: "mic1".into(),
                name: "Microphone".into(),
                is_default: true,
            }],
            loopback: vec![],
        };
        let dev_val = serde_json::to_value(&devices).unwrap();
        let dev_obj = dev_val.as_object().unwrap();
        let mut dev_keys: Vec<_> = dev_obj.keys().cloned().collect();
        dev_keys.sort();
        assert_eq!(dev_keys, vec!["inputs", "loopback"]);

        // 2. DeviceInfo key set: { id, is_default, name }
        let info_val = serde_json::to_value(&devices.inputs[0]).unwrap();
        let info_obj = info_val.as_object().unwrap();
        let mut info_keys: Vec<_> = info_obj.keys().cloned().collect();
        info_keys.sort();
        assert_eq!(info_keys, vec!["id", "is_default", "name"]);

        // 3. SourceInfo key set: { height, id, is_primary, kind, name, width }
        let source = SourceInfo {
            id: "src1".into(),
            name: "Display 1".into(),
            kind: "monitor".into(),
            width: 1920,
            height: 1080,
            is_primary: true,
        };
        let src_val = serde_json::to_value(&source).unwrap();
        let src_obj = src_val.as_object().unwrap();
        let mut src_keys: Vec<_> = src_obj.keys().cloned().collect();
        src_keys.sort();
        assert_eq!(src_keys, vec!["height", "id", "is_primary", "kind", "name", "width"]);

        // 4. StartResult key set: { kind, path }
        let start_res = StartResult {
            path: "C:/assets/audio/1.wav".into(),
            kind: "audio".into(),
        };
        let start_val = serde_json::to_value(&start_res).unwrap();
        let start_obj = start_val.as_object().unwrap();
        let mut start_keys: Vec<_> = start_obj.keys().cloned().collect();
        start_keys.sort();
        assert_eq!(start_keys, vec!["kind", "path"]);

        // 5. StopResult key set: { bytes, duration_sec, path }
        let stop_res = StopResult {
            path: "C:/assets/audio/1.wav".into(),
            duration_sec: 12.5,
            bytes: 1024,
        };
        let stop_val = serde_json::to_value(&stop_res).unwrap();
        let stop_obj = stop_val.as_object().unwrap();
        let mut stop_keys: Vec<_> = stop_obj.keys().cloned().collect();
        stop_keys.sort();
        assert_eq!(stop_keys, vec!["bytes", "duration_sec", "path"]);

        // 6. RecordingState key set: { kind, paused, path, started_at }
        let state = RecordingState {
            kind: None,
            paused: false,
            path: None,
            started_at: None,
        };
        let st_val = serde_json::to_value(&state).unwrap();
        let st_obj = st_val.as_object().unwrap();
        let mut st_keys: Vec<_> = st_obj.keys().cloned().collect();
        st_keys.sort();
        assert_eq!(st_keys, vec!["kind", "path", "paused", "started_at"]);

        // 7. StartOptions deserialization
        let raw_opts = serde_json::json!({
            "kind": "screen",
            "mic": "device_1",
            "system": true,
            "source_id": "monitor:1",
            "fps": 30
        });
        let parsed: StartOptions = serde_json::from_value(raw_opts).unwrap();
        assert_eq!(parsed.kind, "screen");
        assert_eq!(parsed.mic.as_deref(), Some("device_1"));
        assert_eq!(parsed.system, Some(true));
        assert_eq!(parsed.source_id.as_deref(), Some("monitor:1"));
        assert_eq!(parsed.fps, Some(30));
    }
}
