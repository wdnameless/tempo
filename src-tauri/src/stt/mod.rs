//! High-level STT orchestration, state management, and Tauri command bindings.

pub mod accel;
pub mod capture;
pub mod catalog;
pub mod cloud;
pub mod denoise;
pub mod dictation;
pub mod engine;
pub mod feedback;
pub mod history;
pub mod models;
pub mod postprocess;
pub mod ptt;
pub mod shortcuts;
pub mod vad;

use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

pub use accel::{accelerators, AcceleratorInfo};
pub use capture::{
    input_channels, input_devices, output_devices, AudioCaptureHandle, AudioCaptureState,
    AudioDeviceInfo, CaptureError, CaptureOptions,
};
pub use denoise::DenoiseConfig;
pub use dictation::{ClipboardBehavior, InjectionOutcome, PasteMethod, PasteOptions};
pub use engine::EngineManager;
pub use feedback::{SoundKind, SoundTheme};
pub use history::HistoryEntry;
pub use models::{DownloadOutcome, DownloadProgress, ModelInfo, ModelManager};
pub use ptt::{DictationDriver, Effect, ShortcutActivation, Stage, TranscriptionCoordinator};
pub use shortcuts::SpeechBindings;
pub use vad::{VadBackend, VadConfig};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub engine: String,
    pub model_id: Option<String>,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationState {
    pub recording: bool,
    pub level: f32,
    pub since: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub text: String,
    pub duration_ms: u64,
    pub engine: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inserted: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeFileResult {
    pub text: String,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpeechConfig {
    pub enabled: bool,
    pub activation: ShortcutActivation,
    pub hotkey: String,
    pub cancel_hotkey: String,
    pub hold_threshold_ms: u64,
    pub engine: String,
    pub model_id: Option<String>,
    pub device: Option<String>,
    pub channel: Option<u16>,
    pub vad_backend: String,
    pub vad_energy_threshold: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vad_fallback_reason: Option<String>,
    pub language: Option<String>,
    pub translate_to_english: bool,
    pub custom_words: Vec<String>,
    pub remove_filler_words: bool,
    pub paste_method: String,
    pub clipboard_behavior: String,
    pub paste_delay_ms: u64,
    pub paste_delay_after_ms: u64,
    pub append_space: bool,
    pub auto_submit: bool,
    pub feedback_enabled: bool,
    pub feedback_volume: f32,
    pub sound_theme: String,
    pub history_enabled: bool,
    pub history_limit: usize,
    pub retention_days: u32,
    pub postprocess_enabled: bool,
    pub postprocess_prompt: String,
    pub overlay_enabled: bool,
    pub onboarded: bool,
    pub accelerator: String,
    pub gpu_device: Option<String>,
    pub model_unload_secs: u64,
    #[serde(rename = "denoise_highpass", alias = "denoiseHighpass")]
    pub denoise_highpass: bool,
    #[serde(rename = "denoise_highpass_hz", alias = "denoiseHighpassHz")]
    pub denoise_highpass_hz: f32,
    #[serde(rename = "denoise_gate", alias = "denoiseGate")]
    pub denoise_gate: bool,
    #[serde(rename = "denoise_gate_db", alias = "denoiseGateDb")]
    pub denoise_gate_db: f32,
    #[serde(rename = "denoise_rnnoise", alias = "denoiseRnnoise")]
    pub denoise_rnnoise: bool,
    #[serde(rename = "denoise_agc", alias = "denoiseAgc")]
    pub denoise_agc: bool,
    #[serde(rename = "denoise_agc_target_db", alias = "denoiseAgcTargetDb")]
    pub denoise_agc_target_db: f32,
}
impl Default for SpeechConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            activation: ShortcutActivation::HoldOrToggle,
            hotkey: "Ctrl+S".to_string(),
            cancel_hotkey: "Escape".to_string(),
            hold_threshold_ms: 300,
            engine: "local".to_string(),
            model_id: None,
            device: None,
            channel: None,
            vad_backend: "earshot".to_string(),
            vad_energy_threshold: 0.015,
            vad_fallback_reason: None,
            language: None,
            translate_to_english: false,
            custom_words: Vec::new(),
            remove_filler_words: false,
            paste_method: "ctrl_v".to_string(),
            clipboard_behavior: "restore".to_string(),
            paste_delay_ms: 60,
            paste_delay_after_ms: 60,
            append_space: false,
            auto_submit: false,
            feedback_enabled: true,
            feedback_volume: 0.5,
            sound_theme: "default".to_string(),
            history_enabled: true,
            history_limit: 100,
            retention_days: 30,
            postprocess_enabled: false,
            postprocess_prompt: String::new(),
            overlay_enabled: true,
            onboarded: false,
            accelerator: "auto".to_string(),
            gpu_device: None,
            model_unload_secs: 60,
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


#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechConfigPatch {
    pub enabled: Option<bool>,
    pub activation: Option<ShortcutActivation>,
    pub hotkey: Option<String>,
    pub cancel_hotkey: Option<String>,
    pub hold_threshold_ms: Option<u64>,
    pub engine: Option<String>,
    pub model_id: Option<String>,
    pub device: Option<String>,
    pub channel: Option<u16>,
    pub vad_backend: Option<String>,
    pub vad_energy_threshold: Option<f32>,
    pub vad_fallback_reason: Option<String>,
    pub language: Option<String>,
    pub translate_to_english: Option<bool>,
    pub custom_words: Option<Vec<String>>,
    pub remove_filler_words: Option<bool>,
    pub paste_method: Option<String>,
    pub clipboard_behavior: Option<String>,
    pub paste_delay_ms: Option<u64>,
    pub paste_delay_after_ms: Option<u64>,
    pub append_space: Option<bool>,
    pub auto_submit: Option<bool>,
    pub feedback_enabled: Option<bool>,
    pub feedback_volume: Option<f32>,
    pub sound_theme: Option<String>,
    pub history_enabled: Option<bool>,
    pub history_limit: Option<usize>,
    pub retention_days: Option<u32>,
    pub postprocess_enabled: Option<bool>,
    pub postprocess_prompt: Option<String>,
    pub overlay_enabled: Option<bool>,
    pub onboarded: Option<bool>,
    pub accelerator: Option<String>,
    pub gpu_device: Option<String>,
    pub model_unload_secs: Option<u64>,
    #[serde(rename = "denoise_highpass", alias = "denoiseHighpass")]
    pub denoise_highpass: Option<bool>,
    #[serde(rename = "denoise_highpass_hz", alias = "denoiseHighpassHz")]
    pub denoise_highpass_hz: Option<f32>,
    #[serde(rename = "denoise_gate", alias = "denoiseGate")]
    pub denoise_gate: Option<bool>,
    #[serde(rename = "denoise_gate_db", alias = "denoiseGateDb")]
    pub denoise_gate_db: Option<f32>,
    #[serde(rename = "denoise_rnnoise", alias = "denoiseRnnoise")]
    pub denoise_rnnoise: Option<bool>,
    #[serde(rename = "denoise_agc", alias = "denoiseAgc")]
    pub denoise_agc: Option<bool>,
    #[serde(rename = "denoise_agc_target_db", alias = "denoiseAgcTargetDb")]
    pub denoise_agc_target_db: Option<f32>,
}

pub struct SttState {
    pub models: Arc<ModelManager>,
    pub engine: Arc<EngineManager>,
    pub capture_state: Arc<AudioCaptureState>,
    pub current_capture: Arc<Mutex<Option<AudioCaptureHandle>>>,
    pub recording_started_at: Arc<Mutex<Option<Instant>>>,
    pub level_stop: Arc<AtomicBool>,
    pub model_unload_secs: Arc<AtomicU64>,
    pub janitor_started: Arc<AtomicBool>,
}

impl SttState {
    pub fn new(data_dir: PathBuf) -> Self {
        let models_dir = data_dir.join("models");
        let engine = Arc::new(EngineManager::new());
        let capture_state = Arc::new(AudioCaptureState::new());
        let current_capture = Arc::new(Mutex::new(None));
        let recording_started_at = Arc::new(Mutex::new(None));
        let level_stop = Arc::new(AtomicBool::new(false));

        let initial_unload_secs = {
            let db_path = crate::storage::db_path_in(&data_dir);
            if let Ok(conn) = rusqlite::Connection::open_with_flags(
                &db_path,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                    | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
            ) {
                pref_read(&conn, "tempo_speech_model_unload_secs", None, 60u64)
            } else {
                60u64
            }
        };
        let model_unload_secs = Arc::new(AtomicU64::new(initial_unload_secs));
        let janitor_started = Arc::new(AtomicBool::new(false));

        let state = Self {
            models: Arc::new(ModelManager::new(models_dir)),
            engine,
            capture_state,
            current_capture,
            recording_started_at,
            level_stop,
            model_unload_secs,
            janitor_started,
        };

        state.spawn_idle_janitor();
        state
    }

    /// Spawns the background model idle timeout janitor if an async runtime is active.
    pub fn spawn_idle_janitor(&self) {
        if self.janitor_started.load(Ordering::SeqCst) {
            return;
        }
        if tokio::runtime::Handle::try_current().is_ok() {
            if self.janitor_started.swap(true, Ordering::SeqCst) {
                return;
            }
            let engine = Arc::clone(&self.engine);
            let unload_secs = Arc::clone(&self.model_unload_secs);
            tauri::async_runtime::spawn(async move {
                let mut ticker = tokio::time::interval(Duration::from_secs(5));
                loop {
                    ticker.tick().await;
                    let secs = unload_secs.load(Ordering::Relaxed);
                    engine.check_idle_timeout(secs).await;
                }
            });
        }
    }
}

pub fn resolve_data_dir(app: &AppHandle) -> PathBuf {
    crate::app_data_root(app).unwrap_or_else(|_| PathBuf::from("."))
}

pub fn resolve_silero_path_for_app(app: &AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    let data_dir = resolve_data_dir(app);
    app.try_state::<SttState>()
        .and_then(|state| state.models.installed_path(crate::stt::models::SILERO_VAD_MODEL_ID))
        .or_else(|| {
            let mgr = crate::stt::models::ModelManager::new(data_dir.join("models"));
            mgr.installed_path(crate::stt::models::SILERO_VAD_MODEL_ID)
        })
        .or_else(|| vad::resolve_silero_model_path(Some(&data_dir.join("models"))))
        .or_else(vad::resolve_default_silero_model_path)
}

// ----------------------------------------------------------------------------
// Preference helpers
// ----------------------------------------------------------------------------

fn pref_read_raw(conn: &rusqlite::Connection, key: &str, fallback_key: Option<&str>) -> Option<String> {
    if let Ok(Some(val)) = crate::storage::repo::pref_get(conn, key) {
        return Some(val);
    }
    if let Some(fb) = fallback_key {
        if let Ok(Some(val)) = crate::storage::repo::pref_get(conn, fb) {
            return Some(val);
        }
    }
    None
}

fn pref_read<T: serde::de::DeserializeOwned>(
    conn: &rusqlite::Connection,
    key: &str,
    fallback_key: Option<&str>,
    default: T,
) -> T {
    if let Some(raw) = pref_read_raw(conn, key, fallback_key) {
        if let Ok(val) = serde_json::from_str::<T>(&raw) {
            return val;
        }
    }
    default
}

fn pref_read_string(
    conn: &rusqlite::Connection,
    key: &str,
    fallback_key: Option<&str>,
    default: &str,
) -> String {
    if let Some(raw) = pref_read_raw(conn, key, fallback_key) {
        if let Ok(val) = serde_json::from_str::<String>(&raw) {
            return val;
        }
        let unquoted = raw.trim_matches('"').trim();
        if !unquoted.is_empty() {
            return unquoted.to_string();
        }
    }
    default.to_string()
}

fn pref_read_opt_string(
    conn: &rusqlite::Connection,
    key: &str,
    fallback_key: Option<&str>,
) -> Option<String> {
    let s = pref_read_string(conn, key, fallback_key, "");
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn pref_write<T: Serialize>(conn: &rusqlite::Connection, key: &str, val: &T) -> Result<(), String> {
    let json = serde_json::to_string(val).map_err(|e| e.to_string())?;
    crate::storage::repo::pref_set(conn, key, &json)
}

pub fn resolve_cancel_hotkey(s: &str) -> String {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        "Escape".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn pref_read_cancel_hotkey(conn: &rusqlite::Connection) -> String {
    let raw = pref_read_string(conn, "tempo_speech_cancel_hotkey", Some("alarmer_speech_cancel_hotkey"), "Escape");
    resolve_cancel_hotkey(&raw)
}

pub fn load_speech_config(app: &AppHandle) -> SpeechConfig {
    crate::storage::with_db(app, |conn| {
        let enabled: bool = pref_read(conn, "tempo_speech_enabled", Some("alarmer_speech_enabled"), true);
        let act_str = pref_read_string(conn, "tempo_speech_activation", Some("alarmer_speech_activation"), "hold_or_toggle");
        let activation = match act_str.to_ascii_lowercase().as_str() {
            "toggle" => ShortcutActivation::Toggle,
            "push_to_talk" | "pushtotalk" => ShortcutActivation::PushToTalk,
            _ => ShortcutActivation::HoldOrToggle,
        };

        let hotkey = pref_read_string(conn, "tempo_speech_hotkey", Some("alarmer_speech_hotkey"), "Ctrl+S");
        let cancel_hotkey = pref_read_cancel_hotkey(conn);
        let hold_threshold_ms: u64 = pref_read(conn, "tempo_speech_hold_threshold_ms", Some("alarmer_speech_hold_threshold_ms"), 300);
        let engine = pref_read_string(conn, "tempo_speech_engine", Some("alarmer_speech_engine"), "local");
        let model_id = pref_read_opt_string(conn, "tempo_speech_model_id", Some("alarmer_speech_model_id"));
        let device = pref_read_opt_string(conn, "tempo_speech_device", Some("alarmer_speech_device"));
        let channel: Option<u16> = pref_read(conn, "tempo_speech_channel", Some("alarmer_speech_channel"), None);
        let vad_backend = pref_read_string(conn, "tempo_speech_vad_backend", Some("alarmer_speech_vad_backend"), "earshot");
        let vad_energy_threshold: f32 = pref_read(conn, "tempo_speech_vad_energy_threshold", Some("alarmer_speech_vad_energy_threshold"), 0.015);
        let language = pref_read_opt_string(conn, "tempo_speech_language", Some("alarmer_speech_language"));
        let translate_to_english: bool = pref_read(conn, "tempo_speech_translate_to_english", Some("alarmer_speech_translate_to_english"), false);
        let custom_words: Vec<String> = pref_read(conn, "tempo_speech_custom_words", Some("alarmer_speech_custom_words"), Vec::new());
        let remove_filler_words: bool = pref_read(conn, "tempo_speech_remove_filler_words", Some("alarmer_speech_remove_filler_words"), false);
        let paste_method = pref_read_string(conn, "tempo_speech_paste_method", Some("alarmer_speech_paste_method"), "ctrl_v");
        let clipboard_behavior = pref_read_string(conn, "tempo_speech_clipboard_behavior", Some("alarmer_speech_clipboard_behavior"), "restore");
        let paste_delay_ms: u64 = pref_read(conn, "tempo_speech_paste_delay_ms", Some("alarmer_speech_paste_delay_ms"), 60);
        let paste_delay_after_ms: u64 = pref_read(conn, "tempo_speech_paste_delay_after_ms", Some("alarmer_speech_paste_delay_after_ms"), 60);
        let append_space: bool = pref_read(conn, "tempo_speech_append_space", Some("alarmer_speech_append_space"), false);
        let auto_submit: bool = pref_read(conn, "tempo_speech_auto_submit", Some("alarmer_speech_auto_submit"), false);
        let feedback_enabled: bool = pref_read(conn, "tempo_speech_feedback_enabled", Some("alarmer_speech_feedback_enabled"), true);
        let feedback_volume: f32 = pref_read(conn, "tempo_speech_feedback_volume", Some("alarmer_speech_feedback_volume"), 0.5);
        let sound_theme = pref_read_string(conn, "tempo_speech_sound_theme", Some("alarmer_speech_sound_theme"), "default");
        let history_enabled: bool = pref_read(conn, "tempo_speech_history_enabled", Some("alarmer_speech_history_enabled"), true);
        let history_limit: usize = pref_read(conn, "tempo_speech_history_limit", Some("alarmer_speech_history_limit"), 100);
        let retention_days: u32 = pref_read(conn, "tempo_speech_retention_days", Some("alarmer_speech_retention_days"), 30);
        let postprocess_enabled: bool = pref_read(conn, "tempo_speech_postprocess_enabled", Some("alarmer_speech_postprocess_enabled"), false);
        let postprocess_prompt = pref_read_string(conn, "tempo_speech_postprocess_prompt", Some("alarmer_speech_postprocess_prompt"), "");
        let overlay_enabled: bool = pref_read(conn, "tempo_speech_overlay_enabled", Some("alarmer_speech_overlay_enabled"), true);
        let onboarded: bool = pref_read(conn, "tempo_speech_onboarded", Some("alarmer_speech_onboarded"), false);
        let accelerator = pref_read_string(conn, "tempo_speech_accelerator", None, "auto");
        let gpu_device = pref_read_opt_string(conn, "tempo_speech_gpu_device", None);
        let model_unload_secs: u64 = pref_read(conn, "tempo_speech_model_unload_secs", None, 60);
        let denoise_highpass: bool = pref_read(conn, "tempo_speech_denoise_highpass", None, true);
        let denoise_highpass_hz: f32 = pref_read(conn, "tempo_speech_denoise_highpass_hz", None, 80.0);
        let denoise_gate: bool = pref_read(conn, "tempo_speech_denoise_gate", None, true);
        let denoise_gate_db: f32 = pref_read(conn, "tempo_speech_denoise_gate_db", None, -45.0);
        let denoise_rnnoise: bool = pref_read(conn, "tempo_speech_denoise_rnnoise", None, false);
        let denoise_agc: bool = pref_read(conn, "tempo_speech_denoise_agc", None, false);
        let denoise_agc_target_db: f32 = pref_read(conn, "tempo_speech_denoise_agc_target_db", None, -20.0);

        // Resolved before the struct literal: the reason is derived from the backend
        // value that the literal moves into the config.
        let silero_installed = resolve_silero_path_for_app(app);

        let vad_fallback_reason = if vad_backend.eq_ignore_ascii_case("silero") {
            if let Some(reason) = vad::last_fallback_reason() {
                Some(reason)
            } else if silero_installed.is_none() {
                Some("Silero VAD model is not installed. Download it in models settings.".to_string())
            } else {
                None
            }
        } else {
            None
        };

        Ok(SpeechConfig {
            enabled,
            activation,
            hotkey,
            cancel_hotkey,
            hold_threshold_ms,
            engine,
            model_id,
            device,
            channel,
            vad_backend,
            vad_energy_threshold,
            vad_fallback_reason,
            language,
            translate_to_english,
            custom_words,
            remove_filler_words,
            paste_method,
            clipboard_behavior,
            paste_delay_ms,
            paste_delay_after_ms,
            append_space,
            auto_submit,
            feedback_enabled,
            feedback_volume,
            sound_theme,
            history_enabled,
            history_limit,
            retention_days,
            postprocess_enabled,
            postprocess_prompt,
            overlay_enabled,
            onboarded,
            accelerator,
            gpu_device,
            model_unload_secs,
            denoise_highpass,
            denoise_highpass_hz,
            denoise_gate,
            denoise_gate_db,
            denoise_rnnoise,
            denoise_agc,
            denoise_agc_target_db,
        })
    })
    .unwrap_or_default()
}

// ----------------------------------------------------------------------------
// Dictation Driver implementation
// ----------------------------------------------------------------------------

pub struct TempoDictationDriver {
    pub app: AppHandle,
    pub models: Arc<ModelManager>,
    pub engine: Arc<EngineManager>,
    pub capture_state: Arc<AudioCaptureState>,
    pub current_capture: Arc<Mutex<Option<AudioCaptureHandle>>>,
    pub recording_started_at: Arc<Mutex<Option<Instant>>>,
    pub level_stop: Arc<AtomicBool>,
}
pub fn run_options_from_cfg(cfg: &SpeechConfig) -> transcribe_cpp::RunOptions {
    let opts = engine::TranscribeOptions {
        language: cfg.language.clone(),
        translate_to_english: cfg.translate_to_english,
        custom_words: cfg.custom_words.clone(),
    };
    engine::build_run_options(&opts)
}


impl DictationDriver for TempoDictationDriver {
    fn start(&self) -> bool {
        let cfg = load_speech_config(&self.app);
        if !cfg.enabled {
            return false;
        }

        if cfg.feedback_enabled {
            let theme = SoundTheme::from_str(&cfg.sound_theme).unwrap_or(SoundTheme::Default);
            feedback::play(SoundKind::Start, theme, cfg.feedback_volume);
        }

        let vad_mode = match cfg.vad_backend.to_ascii_lowercase().as_str() {
            "energy" => VadBackend::Energy,
            "silero" => VadBackend::Silero,
            _ => VadBackend::Earshot,
        };

        let silero_model_path = if vad_mode == VadBackend::Silero {
            resolve_silero_path_for_app(&self.app)
        } else {
            None
        };

        let vad_cfg = VadConfig {
            backend: vad_mode,
            energy_threshold: cfg.vad_energy_threshold,
            prefill_ms: 450,
            onset_ms: 60,
            hangover_ms: 450,
            sample_rate: 16000,
            silero_model_path,
        };

        let opts = CaptureOptions {
            device: cfg.device.clone(),
            channel: cfg.channel,
            vad: vad_cfg,
            denoise: DenoiseConfig {
                denoise_highpass: cfg.denoise_highpass,
                denoise_highpass_hz: cfg.denoise_highpass_hz,
                denoise_gate: cfg.denoise_gate,
                denoise_gate_db: cfg.denoise_gate_db,
                denoise_rnnoise: cfg.denoise_rnnoise,
                denoise_agc: cfg.denoise_agc,
                denoise_agc_target_db: cfg.denoise_agc_target_db,
            },
        };

        match capture::start_audio_capture(opts, (*self.capture_state).clone()) {
            Ok(handle) => {
                if let Ok(mut lock) = self.current_capture.try_lock() {
                    *lock = Some(handle);
                }
                if let Ok(mut lock) = self.recording_started_at.try_lock() {
                    *lock = Some(Instant::now());
                }
                if let Some(reason) = self.capture_state.fallback_reason() {
                    let _ = self.app.emit(
                        "stt://vad-fallback",
                        serde_json::json!({ "reason": reason, "backend": "energy" }),
                    );
                }

                let mode_str = match cfg.activation {
                    ShortcutActivation::Toggle => "toggle",
                    ShortcutActivation::PushToTalk => "push_to_talk",
                    ShortcutActivation::HoldOrToggle => "hold_or_toggle",
                };
                let _ = self.app.emit("stt://dictation-started", serde_json::json!({ "mode": mode_str }));

                // Start 20 Hz audio level meter loop
                self.level_stop.store(false, Ordering::SeqCst);
                let app_level = self.app.clone();
                let state_level = Arc::clone(&self.capture_state);
                let stop_flag = Arc::clone(&self.level_stop);

                std::thread::spawn(move || {
                    while !stop_flag.load(Ordering::SeqCst) && state_level.is_recording() {
                        let level = state_level.level();
                        let _ = app_level.emit("stt://dictation-level", serde_json::json!({ "level": level }));
                        std::thread::sleep(Duration::from_millis(50));
                    }
                });

                true
            }
            Err(e) => {
                let err_str = e.to_string();
                let code = match e {
                    CaptureError::NoMicrophone => "no_microphone",
                    CaptureError::NoSpeech => "no_speech",
                    _ => "unknown",
                };
                let _ = self.app.emit(
                    "stt://speech-error",
                    serde_json::json!({ "code": code, "message": err_str }),
                );

                if cfg.feedback_enabled {
                    let theme = SoundTheme::from_str(&cfg.sound_theme).unwrap_or(SoundTheme::Default);
                    feedback::play(SoundKind::Error, theme, cfg.feedback_volume);
                }
                false
            }
        }
    }

    fn stop(&self, cancel: bool) {
        self.level_stop.store(true, Ordering::SeqCst);
        let cfg = load_speech_config(&self.app);
        let theme = SoundTheme::from_str(&cfg.sound_theme).unwrap_or(SoundTheme::Default);

        let handle = {
            if let Ok(mut lock) = self.current_capture.try_lock() {
                lock.take()
            } else {
                None
            }
        };

        let started_at = {
            if let Ok(mut lock) = self.recording_started_at.try_lock() {
                lock.take()
            } else {
                None
            }
        };
        let duration_ms = started_at.map(|t| t.elapsed().as_millis() as u64).unwrap_or(0);

        let Some(handle) = handle else {
            if let Some(coord) = self.app.try_state::<TranscriptionCoordinator>() {
                coord.notify_processing_finished();
            }
            return;
        };

        if cancel {
            handle.cancel();
            if cfg.feedback_enabled {
                feedback::play(SoundKind::Cancel, theme, cfg.feedback_volume);
            }
            let _ = self.app.emit("stt://dictation-cancelled", serde_json::json!({}));
            if let Some(coord) = self.app.try_state::<TranscriptionCoordinator>() {
                coord.notify_processing_finished();
            }
            return;
        }

        if cfg.feedback_enabled {
            feedback::play(SoundKind::Stop, theme, cfg.feedback_volume);
        }

        let pcm_res = handle.stop();
        let samples = match pcm_res {
            Ok(s) => s,
            Err(CaptureError::NoSpeech) => {
                let _ = self.app.emit(
                    "stt://speech-error",
                    serde_json::json!({ "code": "no_speech", "message": "no_speech" }),
                );
                if cfg.feedback_enabled {
                    feedback::play(SoundKind::Error, theme, cfg.feedback_volume);
                }
                if let Some(coord) = self.app.try_state::<TranscriptionCoordinator>() {
                    coord.notify_processing_finished();
                }
                return;
            }
            Err(e) => {
                let _ = self.app.emit(
                    "stt://speech-error",
                    serde_json::json!({ "code": "unknown", "message": e.to_string() }),
                );
                if cfg.feedback_enabled {
                    feedback::play(SoundKind::Error, theme, cfg.feedback_volume);
                }
                if let Some(coord) = self.app.try_state::<TranscriptionCoordinator>() {
                    coord.notify_processing_finished();
                }
                return;
            }
        };

        let app_handle = self.app.clone();
        let engine = Arc::clone(&self.engine);
        let models = Arc::clone(&self.models);

        tokio::spawn(async move {
            let text_res = if cfg.engine == "cloud" {
                // Cloud transcription fallback
                Err("cloud_refused: Cloud transcription not configured".to_string())
            } else {
                let model_id = cfg.model_id.as_deref().unwrap_or("whisper-small");
                let (resolved_model_id, model_path) = match models.installed_path(model_id) {
                    Some(p) => (model_id.to_string(), p),
                    None => {
                        let list = models.list().await;
                        match list.into_iter().find(|m| m.installed && m.path.is_some()) {
                            Some(m) => (m.id.clone(), PathBuf::from(m.path.unwrap())),
                            None => {
                                let err = format!("no_model: Model '{model_id}' is not installed");
                                let _ = app_handle.emit(
                                    "stt://speech-error",
                                    serde_json::json!({ "code": "no_model", "message": err }),
                                );
                                if cfg.feedback_enabled {
                                    feedback::play(SoundKind::Error, theme, cfg.feedback_volume);
                                }
                                if let Some(coord) = app_handle.try_state::<TranscriptionCoordinator>() {
                                    coord.notify_processing_finished();
                                }
                                return;
                            }
                        }
                    }
                };

                match models.resolve_engine(&resolved_model_id).await {
                    Ok(engine_name) => {
                        let run_options = run_options_from_cfg(&cfg);
                        engine.transcribe_samples(&engine_name, model_path, &samples, &run_options).await
                    }
                    Err(err) => Err(err),
                }
            };

            let raw_text = match text_res {
                Ok(t) => t,
                Err(e) => {
                    let code = if e.contains("no_model") {
                        "no_model"
                    } else if e == "cancelled" {
                        "cancelled"
                    } else {
                        "unknown"
                    };
                    let _ = app_handle.emit(
                        "stt://speech-error",
                        serde_json::json!({ "code": code, "message": e }),
                    );
                    if cfg.feedback_enabled && code != "cancelled" {
                        feedback::play(SoundKind::Error, theme, cfg.feedback_volume);
                    }
                    if let Some(coord) = app_handle.try_state::<TranscriptionCoordinator>() {
                        coord.notify_processing_finished();
                    }
                    return;
                }
            };

            if raw_text.trim().is_empty() {
                let _ = app_handle.emit(
                    "stt://speech-error",
                    serde_json::json!({ "code": "no_speech", "message": "no_speech" }),
                );
                if let Some(coord) = app_handle.try_state::<TranscriptionCoordinator>() {
                    coord.notify_processing_finished();
                }
                return;
            }
            // 1. Verbal filler word removal
            let cleaned_text = if cfg.remove_filler_words {
                dictation::remove_filler_words(&raw_text)
            } else {
                raw_text
            };

            // 2. Post-processing with user's AI provider
            let final_text = if cfg.postprocess_enabled {
                let post_cfg = crate::storage::with_db(&app_handle, |conn| {
                    Ok(postprocess::resolve_config(conn, true, cfg.postprocess_prompt.clone()))
                })
                .unwrap_or_else(|_| postprocess::PostProcessConfig {
                    enabled: true,
                    prompt: cfg.postprocess_prompt.clone(),
                    base_url: "https://api.openai.com/v1".to_string(),
                    api_key: String::new(),
                    model: "gpt-4o-mini".to_string(),
                });
                let raw_clone = cleaned_text.clone();
                tokio::task::spawn_blocking(move || {
                    postprocess::polish(&raw_clone, &post_cfg).unwrap_or(raw_clone)
                })
                .await
                .unwrap_or(cleaned_text)
            } else {
                cleaned_text
            };

            // Text injection
            let method = match cfg.paste_method.to_ascii_lowercase().as_str() {
                "shift_insert" | "shiftinsert" => PasteMethod::ShiftInsert,
                "direct" => PasteMethod::Direct,
                _ => PasteMethod::CtrlV,
            };
            let behavior = match cfg.clipboard_behavior.to_ascii_lowercase().as_str() {
                "keep" => ClipboardBehavior::Keep,
                _ => ClipboardBehavior::Restore,
            };

            let paste_opts = PasteOptions {
                method,
                behavior,
                delay_before_ms: cfg.paste_delay_ms,
                delay_after_ms: cfg.paste_delay_after_ms,
                append_space: cfg.append_space,
                auto_submit: cfg.auto_submit,
            };

            let outcome = dictation::deliver_text(&final_text, &paste_opts);
            let inserted = outcome == InjectionOutcome::Inserted;

            // History recording
            if cfg.history_enabled {
                let data_dir = resolve_data_dir(&app_handle);
                let audio_dir = data_dir.join("stt-audio");
                let entry_id = uuid::Uuid::new_v4().to_string();
                let wav_file = audio_dir.join(format!("{entry_id}.wav"));
                let saved_path = if history::write_wav_file(&wav_file, &samples, 16000).is_ok() {
                    Some(wav_file.to_string_lossy().to_string())
                } else {
                    None
                };

                let entry = HistoryEntry {
                    id: entry_id,
                    text: final_text.clone(),
                    created_at: chrono::Utc::now().to_rfc3339(),
                    duration_ms,
                    model_id: cfg.model_id.clone(),
                    language: cfg.language.clone(),
                    audio_path: saved_path,
                    saved: false,
                    app_name: None,
                };
                let _ = history::insert(&app_handle, &entry);
                let _ = history::prune(&app_handle, cfg.history_limit, cfg.retention_days);
            }

            let result = TranscriptionResult {
                text: final_text,
                duration_ms,
                engine: cfg.engine.clone(),
                outcome: Some(format!("{:?}", outcome).to_lowercase()),
                inserted: Some(inserted),
            };

            let _ = app_handle.emit("stt://dictation-stopped", &result);

            if let Some(coord) = app_handle.try_state::<TranscriptionCoordinator>() {
                coord.notify_processing_finished();
            }
        });
    }
}

// ----------------------------------------------------------------------------
// Tauri Commands
// ----------------------------------------------------------------------------

#[tauri::command]
pub async fn stt_catalog(state: State<'_, SttState>) -> Result<Vec<ModelInfo>, String> {
    Ok(state.models.list().await)
}

#[tauri::command]
pub async fn stt_download(
    state: State<'_, SttState>,
    model_id: String,
    quant: Option<String>,
) -> Result<(), String> {
    state.models.start_download(&model_id, quant).await
}

#[tauri::command]
pub async fn stt_download_cancel(
    state: State<'_, SttState>,
    model_id: Option<String>,
) -> Result<(), String> {
    if let Some(id) = model_id {
        state.models.cancel_download(&id).await
    } else {
        let progs = state.models.progress().await;
        for p in progs {
            let _ = state.models.cancel_download(&p.model_id).await;
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn stt_model_delete(
    state: State<'_, SttState>,
    model_id: String,
) -> Result<(), String> {
    state.models.delete(&model_id)
}

#[tauri::command]
pub async fn stt_download_progress(
    state: State<'_, SttState>,
) -> Result<Vec<DownloadProgress>, String> {
    Ok(state.models.progress().await)
}

#[tauri::command]
pub async fn stt_engine(
    app: AppHandle,
    state: State<'_, SttState>,
) -> Result<EngineInfo, String> {
    let cfg = load_speech_config(&app);
    let available = if cfg.engine == "cloud" {
        true
    } else {
        let list = state.models.list().await;
        list.iter().any(|m| m.installed)
    };

    Ok(EngineInfo {
        engine: cfg.engine,
        model_id: cfg.model_id,
        available,
    })
}

#[tauri::command]
pub async fn stt_set_engine(
    app: AppHandle,
    engine: String,
) -> Result<(), String> {
    crate::storage::with_db(&app, |conn| {
        pref_write(conn, "tempo_speech_engine", &engine)?;
        pref_write(conn, "alarmer_speech_engine", &engine)?;
        Ok(())
    })
}

#[tauri::command]
pub async fn stt_start_dictation(app: AppHandle) -> Result<(), String> {
    if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
        coordinator.send_external(true);
        Ok(())
    } else {
        Err("TranscriptionCoordinator not initialized".to_string())
    }
}

#[tauri::command]
pub async fn stt_stop_dictation(app: AppHandle) -> Result<(), String> {
    if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
        coordinator.send_external(false);
        Ok(())
    } else {
        Err("TranscriptionCoordinator not initialized".to_string())
    }
}

#[tauri::command]
pub async fn stt_cancel_dictation(app: AppHandle) -> Result<(), String> {
    if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
        coordinator.notify_cancel();
        Ok(())
    } else {
        Err("TranscriptionCoordinator not initialized".to_string())
    }
}

#[tauri::command]
pub async fn stt_dictation_state(state: State<'_, SttState>) -> Result<DictationState, String> {
    let recording = state.capture_state.is_recording();
    let level = state.capture_state.level();
    let since = if let Ok(lock) = state.recording_started_at.try_lock() {
        lock.map(|t| t.elapsed().as_millis() as u64)
    } else {
        None
    };

    Ok(DictationState {
        recording,
        level,
        since,
    })
}

#[tauri::command]
pub async fn stt_transcribe_file(
    app: AppHandle,
    state: State<'_, SttState>,
    path: String,
) -> Result<TranscribeFileResult, String> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Err(format!("no_speech: File '{path}' not found"));
    }

    let cfg = load_speech_config(&app);
    let model_id = cfg.model_id.as_deref().unwrap_or("whisper-small");
    let model_path = state.models.installed_path(model_id)
        .ok_or_else(|| format!("no_model: Model '{model_id}' is not installed"))?;

    // Read wav samples using hound
    let mut reader = hound::WavReader::open(p)
        .map_err(|e| format!("Failed to open WAV: {e}"))?;
    let spec = reader.spec();

    let raw_samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().filter_map(|s| s.ok()).collect(),
        hound::SampleFormat::Int => {
            let max_val = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader.samples::<i32>().filter_map(|s| s.ok()).map(|s| s as f32 / max_val).collect()
        }
    };

    let mono: Vec<f32> = if spec.channels > 1 {
        raw_samples
            .chunks_exact(spec.channels as usize)
            .map(|chunk| chunk.iter().sum::<f32>() / chunk.len() as f32)
            .collect()
    } else {
        raw_samples
    };

    let pcm = capture::resample_linear(&mono, spec.sample_rate, 16000);
    let engine_name = state.models.resolve_engine(model_id).await?;
    let run_options = run_options_from_cfg(&cfg);
    let text = state.engine.transcribe_samples(&engine_name, model_path, &pcm, &run_options).await?;
    Ok(TranscribeFileResult {
        text,
        language: cfg.language.unwrap_or_else(|| "auto".to_string()),
    })
}

#[tauri::command]
pub async fn stt_transcribe_cloud(
    _app: AppHandle,
    _path: String,
) -> Result<TranscriptionResult, String> {
    Err("cloud_refused: Cloud transcription is not available".to_string())
}

#[tauri::command]
pub async fn stt_rescan_models(state: State<'_, SttState>) -> Result<Vec<ModelInfo>, String> {
    state.models.rescan().await
}

#[tauri::command]
pub async fn stt_import_model(
    state: State<'_, SttState>,
    path: String,
) -> Result<ModelInfo, String> {
    state.models.import_file(&path)
}

#[tauri::command]
pub async fn stt_models_dir(state: State<'_, SttState>) -> Result<String, String> {
    Ok(state.models.models_dir().to_string_lossy().to_string())
}

#[tauri::command]
pub async fn stt_open_models_dir(
    _app: AppHandle,
    state: State<'_, SttState>,
) -> Result<(), String> {
    let dir = state.models.models_dir();
    let _ = std::fs::create_dir_all(dir);
    let dir_str = dir.to_string_lossy().to_string();

    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer").arg(&dir_str).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = opener::open(&dir_str);
    }

    Ok(())
}

#[tauri::command]
pub async fn stt_free_disk_space(state: State<'_, SttState>) -> Result<u64, String> {
    models::check_disk_space(state.models.models_dir())
}

#[tauri::command]
pub async fn stt_speech_settings(app: AppHandle) -> Result<SpeechConfig, String> {
    Ok(load_speech_config(&app))
}

#[tauri::command]
pub async fn stt_apply_speech_settings(
    app: AppHandle,
    state: State<'_, SttState>,
    patch: SpeechConfigPatch,
) -> Result<SpeechConfig, String> {
    crate::storage::with_db(&app, |conn| {
        if let Some(v) = patch.enabled {
            pref_write(conn, "tempo_speech_enabled", &v)?;
            pref_write(conn, "alarmer_speech_enabled", &v)?;
        }
        if let Some(v) = patch.activation {
            let s = match v {
                ShortcutActivation::Toggle => "toggle",
                ShortcutActivation::PushToTalk => "push_to_talk",
                ShortcutActivation::HoldOrToggle => "hold_or_toggle",
            };
            pref_write(conn, "tempo_speech_activation", &s)?;
            pref_write(conn, "alarmer_speech_activation", &s)?;
        }
        if let Some(v) = &patch.hotkey {
            pref_write(conn, "tempo_speech_hotkey", v)?;
            pref_write(conn, "alarmer_speech_hotkey", v)?;
        }
        if let Some(v) = &patch.cancel_hotkey {
            let normalized = resolve_cancel_hotkey(v);
            pref_write(conn, "tempo_speech_cancel_hotkey", &normalized)?;
            pref_write(conn, "alarmer_speech_cancel_hotkey", &normalized)?;
        }
        if let Some(v) = patch.hold_threshold_ms {
            pref_write(conn, "tempo_speech_hold_threshold_ms", &v)?;
            pref_write(conn, "alarmer_speech_hold_threshold_ms", &v)?;
        }
        if let Some(v) = &patch.engine {
            pref_write(conn, "tempo_speech_engine", v)?;
            pref_write(conn, "alarmer_speech_engine", v)?;
        }
        if let Some(v) = &patch.model_id {
            pref_write(conn, "tempo_speech_model_id", v)?;
            pref_write(conn, "alarmer_speech_model_id", v)?;
        }
        if let Some(v) = &patch.device {
            pref_write(conn, "tempo_speech_device", v)?;
            pref_write(conn, "alarmer_speech_device", v)?;
        }
        if let Some(v) = patch.channel {
            pref_write(conn, "tempo_speech_channel", &v)?;
            pref_write(conn, "alarmer_speech_channel", &v)?;
        }
        if let Some(v) = &patch.vad_backend {
            pref_write(conn, "tempo_speech_vad_backend", v)?;
            pref_write(conn, "alarmer_speech_vad_backend", v)?;
        }
        if let Some(v) = patch.vad_energy_threshold {
            pref_write(conn, "tempo_speech_vad_energy_threshold", &v)?;
            pref_write(conn, "alarmer_speech_vad_energy_threshold", &v)?;
        }
        if let Some(v) = &patch.language {
            pref_write(conn, "tempo_speech_language", v)?;
            pref_write(conn, "alarmer_speech_language", v)?;
        }
        if let Some(v) = patch.translate_to_english {
            pref_write(conn, "tempo_speech_translate_to_english", &v)?;
            pref_write(conn, "alarmer_speech_translate_to_english", &v)?;
        }
        if let Some(v) = &patch.custom_words {
            pref_write(conn, "tempo_speech_custom_words", v)?;
            pref_write(conn, "alarmer_speech_custom_words", v)?;
        }
        if let Some(v) = patch.remove_filler_words {
            pref_write(conn, "tempo_speech_remove_filler_words", &v)?;
            pref_write(conn, "alarmer_speech_remove_filler_words", &v)?;
        }
        if let Some(v) = &patch.paste_method {
            pref_write(conn, "tempo_speech_paste_method", v)?;
            pref_write(conn, "alarmer_speech_paste_method", v)?;
        }
        if let Some(v) = &patch.clipboard_behavior {
            pref_write(conn, "tempo_speech_clipboard_behavior", v)?;
            pref_write(conn, "alarmer_speech_clipboard_behavior", v)?;
        }
        if let Some(v) = patch.paste_delay_ms {
            pref_write(conn, "tempo_speech_paste_delay_ms", &v)?;
            pref_write(conn, "alarmer_speech_paste_delay_ms", &v)?;
        }
        if let Some(v) = patch.paste_delay_after_ms {
            pref_write(conn, "tempo_speech_paste_delay_after_ms", &v)?;
            pref_write(conn, "alarmer_speech_paste_delay_after_ms", &v)?;
        }
        if let Some(v) = patch.append_space {
            pref_write(conn, "tempo_speech_append_space", &v)?;
            pref_write(conn, "alarmer_speech_append_space", &v)?;
        }
        if let Some(v) = patch.auto_submit {
            pref_write(conn, "tempo_speech_auto_submit", &v)?;
            pref_write(conn, "alarmer_speech_auto_submit", &v)?;
        }
        if let Some(v) = patch.feedback_enabled {
            pref_write(conn, "tempo_speech_feedback_enabled", &v)?;
            pref_write(conn, "alarmer_speech_feedback_enabled", &v)?;
        }
        if let Some(v) = patch.feedback_volume {
            pref_write(conn, "tempo_speech_feedback_volume", &v)?;
            pref_write(conn, "alarmer_speech_feedback_volume", &v)?;
        }
        if let Some(v) = &patch.sound_theme {
            pref_write(conn, "tempo_speech_sound_theme", v)?;
            pref_write(conn, "alarmer_speech_sound_theme", v)?;
        }
        if let Some(v) = patch.history_enabled {
            pref_write(conn, "tempo_speech_history_enabled", &v)?;
            pref_write(conn, "alarmer_speech_history_enabled", &v)?;
        }
        if let Some(v) = patch.history_limit {
            pref_write(conn, "tempo_speech_history_limit", &v)?;
            pref_write(conn, "alarmer_speech_history_limit", &v)?;
        }
        if let Some(v) = patch.retention_days {
            pref_write(conn, "tempo_speech_retention_days", &v)?;
            pref_write(conn, "alarmer_speech_retention_days", &v)?;
        }
        if let Some(v) = patch.postprocess_enabled {
            pref_write(conn, "tempo_speech_postprocess_enabled", &v)?;
            pref_write(conn, "alarmer_speech_postprocess_enabled", &v)?;
        }
        if let Some(v) = &patch.postprocess_prompt {
            pref_write(conn, "tempo_speech_postprocess_prompt", v)?;
            pref_write(conn, "alarmer_speech_postprocess_prompt", v)?;
        }
        if let Some(v) = patch.overlay_enabled {
            pref_write(conn, "tempo_speech_overlay_enabled", &v)?;
            pref_write(conn, "alarmer_speech_overlay_enabled", &v)?;
        }
        if let Some(v) = patch.onboarded {
            pref_write(conn, "tempo_speech_onboarded", &v)?;
            pref_write(conn, "alarmer_speech_onboarded", &v)?;
        }
        if let Some(v) = &patch.accelerator {
            pref_write(conn, "tempo_speech_accelerator", v)?;
        }
        if let Some(v) = &patch.gpu_device {
            pref_write(conn, "tempo_speech_gpu_device", v)?;
        }
        if let Some(v) = patch.model_unload_secs {
            pref_write(conn, "tempo_speech_model_unload_secs", &v)?;
        }
        if let Some(v) = patch.denoise_highpass {
            pref_write(conn, "tempo_speech_denoise_highpass", &v)?;
        }
        if let Some(v) = patch.denoise_highpass_hz {
            pref_write(conn, "tempo_speech_denoise_highpass_hz", &v)?;
        }
        if let Some(v) = patch.denoise_gate {
            pref_write(conn, "tempo_speech_denoise_gate", &v)?;
        }
        if let Some(v) = patch.denoise_gate_db {
            pref_write(conn, "tempo_speech_denoise_gate_db", &v)?;
        }
        if let Some(v) = patch.denoise_rnnoise {
            pref_write(conn, "tempo_speech_denoise_rnnoise", &v)?;
        }
        if let Some(v) = patch.denoise_agc {
            pref_write(conn, "tempo_speech_denoise_agc", &v)?;
        }
        if let Some(v) = patch.denoise_agc_target_db {
            pref_write(conn, "tempo_speech_denoise_agc_target_db", &v)?;
        }

        Ok(())
    })?;

    let updated = load_speech_config(&app);

    // Apply hotkey bindings: unregister all when disabled
    if updated.enabled {
        let bindings = SpeechBindings {
            transcribe: updated.hotkey.clone(),
            cancel: updated.cancel_hotkey.clone(),
        };
        // A global shortcut the OS refuses (another app owns it, or the
        // combination is reserved by the system) used to be discarded here, and
        // the user was left pressing a key that did nothing with no way to find
        // out why. Say it out loud: the reason goes to the log and to the UI.
        if let Err(e) = shortcuts::apply_bindings(&app, &bindings) {
            eprintln!("[stt] hotkey not registered: {e}");
            let _ = app.emit(
                "stt://hotkey-error",
                serde_json::json!({ "hotkey": bindings.transcribe, "message": e }),
            );
        }
    } else {
        shortcuts::unregister_all(&app);
    }

    // Update model unload seconds for background janitor
    state
        .model_unload_secs
        .store(updated.model_unload_secs, Ordering::Relaxed);
    state.spawn_idle_janitor();
    // Apply engine accelerator change & unload if changed
    if patch.accelerator.is_some() || patch.gpu_device.is_some() {
        state
            .engine
            .configure(&updated.accelerator, updated.gpu_device.as_deref())
            .await;
    }

    Ok(updated)
}

#[tauri::command]
pub async fn stt_validate_hotkey(app: AppHandle, accelerator: String) -> Result<(), String> {
    shortcuts::validate(&app, &accelerator).map_err(|e| {
        if e.contains("already taken") {
            format!("hotkey_taken: {e}")
        } else {
            format!("hotkey_invalid: {e}")
        }
    })
}

#[tauri::command]
pub async fn stt_suspend_shortcuts(app: AppHandle) -> Result<(), String> {
    shortcuts::suspend(&app);
    Ok(())
}

#[tauri::command]
pub async fn stt_resume_shortcuts(app: AppHandle) -> Result<(), String> {
    shortcuts::resume(&app);
    Ok(())
}

#[tauri::command]
pub async fn stt_input_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    capture::input_devices()
}

#[tauri::command]
pub async fn stt_input_channels(device: String) -> Result<u16, String> {
    capture::input_channels(&device)
}

#[tauri::command]
pub async fn stt_output_devices() -> Result<Vec<String>, String> {
    capture::output_devices()
}

#[tauri::command]
pub async fn stt_play_test_sound(app: AppHandle, kind: String) -> Result<(), String> {
    let cfg = load_speech_config(&app);
    let theme = SoundTheme::from_str(&cfg.sound_theme).unwrap_or(SoundTheme::Default);
    let sound_kind = SoundKind::from_str(&kind).unwrap_or(SoundKind::Start);
    feedback::play_test(sound_kind, theme, cfg.feedback_volume);
    Ok(())
}

pub fn resolve_mic_level(
    is_recording: bool,
    recording_level: f32,
    probe_fn: impl FnOnce() -> Result<f32, String>,
) -> Result<f32, String> {
    if is_recording {
        Ok(recording_level)
    } else {
        probe_fn()
    }
}

#[tauri::command]
pub async fn stt_mic_level(state: State<'_, SttState>, app: AppHandle) -> Result<f32, String> {
    let denoise = crate::stt::denoise::read_denoise_preference(&app);
    capture::set_probe_denoise_config(denoise);
    resolve_mic_level(
        state.capture_state.is_recording(),
        state.capture_state.level(),
        capture::mic_level,
    )
}

#[tauri::command]
pub async fn stt_history_list(
    app: AppHandle,
    limit: Option<usize>,
) -> Result<Vec<HistoryEntry>, String> {
    history::list(&app, limit.unwrap_or(100))
}

#[tauri::command]
pub async fn stt_history_delete(app: AppHandle, id: String) -> Result<(), String> {
    history::delete(&app, &id)
}

#[tauri::command]
pub async fn stt_history_set_saved(
    app: AppHandle,
    id: String,
    saved: bool,
) -> Result<(), String> {
    history::set_saved(&app, &id, saved)
}

#[tauri::command]
pub async fn stt_history_retry(
    app: AppHandle,
    state: State<'_, SttState>,
    id: String,
) -> Result<TranscriptionResult, String> {
    let entry = history::get(&app, &id)?
        .ok_or_else(|| format!("history entry '{id}' not found"))?;

    let audio_path = entry
        .audio_path
        .clone()
        .ok_or_else(|| "no_speech: No audio file attached to this history entry".to_string())?;

    let file_res = stt_transcribe_file(app.clone(), state, audio_path).await?;

    let mut updated_entry = entry;
    updated_entry.text = file_res.text.clone();
    history::insert(&app, &updated_entry)?;

    Ok(TranscriptionResult {
        text: file_res.text,
        duration_ms: updated_entry.duration_ms,
        engine: "local".to_string(),
        outcome: Some("retried".to_string()),
        inserted: Some(false),
    })
}

#[tauri::command]
pub async fn stt_history_clear(app: AppHandle) -> Result<(), String> {
    history::clear(&app)
}

#[tauri::command]
pub async fn stt_postprocess(app: AppHandle, text: String) -> Result<String, String> {
    let post_cfg = crate::storage::with_db(&app, |conn| {
        let cfg = load_speech_config(&app);
        Ok(postprocess::resolve_config(conn, true, cfg.postprocess_prompt))
    })?;

    tokio::task::spawn_blocking(move || {
        postprocess::polish(&text, &post_cfg)
    })
    .await
    .map_err(|e| format!("postprocess_failed: {e}"))?
}

#[tauri::command]
pub async fn stt_cancel_transcription(
    state: State<'_, SttState>,
    _path: String,
) -> Result<(), String> {
    state.engine.cancel_current().await;
    Ok(())
}

#[tauri::command]
pub async fn stt_accelerators() -> Result<Vec<AcceleratorInfo>, String> {
    Ok(accelerators())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_history_retry_persistence_updates_db_row() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::storage::migrations::migrate(&conn).expect("migration must succeed");

        let initial = history::HistoryEntry {
            id: "retry-db-test-1".to_string(),
            text: "Initial failed transcription".to_string(),
            created_at: "2026-09-22T10:00:00Z".to_string(),
            duration_ms: 2000,
            model_id: Some("whisper-tiny".to_string()),
            language: Some("en".to_string()),
            audio_path: Some("/tmp/test.wav".to_string()),
            saved: false,
            app_name: Some("Tempo".to_string()),
        };
        history::insert_conn(&conn, &initial).unwrap();

        // Verify initial entry
        let fetched = history::get_conn(&conn, "retry-db-test-1")
            .unwrap()
            .expect("must exist");
        assert_eq!(fetched.text, "Initial failed transcription");

        // Emulate stt_history_retry: update text and re-insert
        let mut retried = fetched;
        retried.text = "Retried and corrected transcription text".to_string();
        history::insert_conn(&conn, &retried).unwrap();

        // Verify entry is updated in DB
        let updated = history::get_conn(&conn, "retry-db-test-1")
            .unwrap()
            .expect("must exist");
        assert_eq!(
            updated.text,
            "Retried and corrected transcription text"
        );
        assert_eq!(updated.audio_path, Some("/tmp/test.wav".to_string()));
    }

    #[test]
    fn test_stt_state_janitor_spawn_and_unload_secs() {
        let state = SttState::new(PathBuf::from("."));
        assert_eq!(state.model_unload_secs.load(Ordering::Relaxed), 60);

        state.model_unload_secs.store(120, Ordering::Relaxed);
        assert_eq!(state.model_unload_secs.load(Ordering::Relaxed), 120);

        // Multiple calls to spawn_idle_janitor are idempotent and safe
        state.spawn_idle_janitor();
        state.spawn_idle_janitor();
    }

    #[test]
    fn test_resolve_mic_level_routing() {
        // Inside dictation: returns recording_level from capture_state
        let rec_level = resolve_mic_level(true, 0.75, || Ok(0.12)).unwrap();
        assert_eq!(rec_level, 0.75);

        // Outside dictation: calls probe_fn instead of capture_state
        let probe_called = std::sync::atomic::AtomicBool::new(false);
        let probe_res = resolve_mic_level(false, 0.0, || {
            probe_called.store(true, Ordering::SeqCst);
            Ok(0.42)
        })
        .unwrap();
        assert!(probe_called.load(Ordering::SeqCst));
        assert_eq!(probe_res, 0.42);
    }

    #[test]
    fn test_speech_config_denoise_defaults() {
        let cfg = SpeechConfig::default();
        // Contract: highpass: true, hz: 80, gate: true, gate_db: -45, rnnoise: false, agc: false, agc_target_db: -20
        assert!(cfg.denoise_highpass);
        assert_eq!(cfg.denoise_highpass_hz, 80.0);
        assert!(cfg.denoise_gate);
        assert_eq!(cfg.denoise_gate_db, -45.0);
        assert!(!cfg.denoise_rnnoise);
        assert!(!cfg.denoise_agc);
        assert_eq!(cfg.denoise_agc_target_db, -20.0);
    }

    #[test]
    fn test_speech_config_cancel_hotkey_defaults_to_escape() {
        let cfg = SpeechConfig::default();
        assert_eq!(cfg.cancel_hotkey, "Escape");
    }

    #[test]
    fn test_resolve_cancel_hotkey() {
        assert_eq!(resolve_cancel_hotkey(""), "Escape");
        assert_eq!(resolve_cancel_hotkey("   "), "Escape");
        assert_eq!(resolve_cancel_hotkey("Escape"), "Escape");
        assert_eq!(resolve_cancel_hotkey("F8"), "F8");
        assert_eq!(resolve_cancel_hotkey("  Ctrl+Shift+C  "), "Ctrl+Shift+C");
    }

    #[test]
    fn test_pref_read_cancel_hotkey() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::storage::migrations::migrate(&conn).expect("migration must succeed");

        // 1. Fresh database -> default cancel hotkey is Escape
        assert_eq!(pref_read_cancel_hotkey(&conn), "Escape");

        // 2. User has stored tempo_speech_cancel_hotkey = "" in DB -> resolves to Escape
        pref_write(&conn, "tempo_speech_cancel_hotkey", &"").unwrap();
        assert_eq!(pref_read_cancel_hotkey(&conn), "Escape");

        // 3. User has stored whitespace -> resolves to Escape
        pref_write(&conn, "tempo_speech_cancel_hotkey", &"   ").unwrap();
        assert_eq!(pref_read_cancel_hotkey(&conn), "Escape");

        // 4. User has explicit hotkey (e.g. F8) -> kept
        pref_write(&conn, "tempo_speech_cancel_hotkey", &"F8").unwrap();
        assert_eq!(pref_read_cancel_hotkey(&conn), "F8");

        // 5. Fallback alarmer_speech_cancel_hotkey when tempo is unset
        let conn_legacy = rusqlite::Connection::open_in_memory().unwrap();
        crate::storage::migrations::migrate(&conn_legacy).expect("migration must succeed");
        pref_write(&conn_legacy, "alarmer_speech_cancel_hotkey", &"").unwrap();
        assert_eq!(pref_read_cancel_hotkey(&conn_legacy), "Escape");

        pref_write(&conn_legacy, "alarmer_speech_cancel_hotkey", &"F8").unwrap();
        assert_eq!(pref_read_cancel_hotkey(&conn_legacy), "F8");
    }
}
