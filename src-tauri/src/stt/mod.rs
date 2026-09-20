//! High-level STT orchestration, state management, and Tauri command bindings.

pub mod capture;
pub mod cloud;
pub mod dictation;
pub mod engine;
pub mod models;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::stt::capture::{AudioCaptureHandle, CaptureError, CaptureState};
use crate::stt::cloud::{transcribe_audio_cloud, CloudTranscriptionParams};
use crate::stt::dictation::{
    execute_dictation_injection, DictationMode, InjectionOutcome,
};
use crate::stt::engine::EngineManager;
use crate::stt::models::{DownloadManager, DownloadProgress, ModelInfo};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineInfo {
    pub engine: String,
    pub model_id: Option<String>,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DictationState {
    pub recording: bool,
    pub level: f32,
    pub since: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
pub struct TranscribeFileResult {
    pub text: String,
    pub language: String,
}

pub struct SttState {
    pub download_tracker: Arc<DownloadManager>,
    pub engine: Arc<EngineManager>,
    pub capture_state: Arc<CaptureState>,
    pub current_capture: Mutex<Option<AudioCaptureHandle>>,
    pub dictation_mode: Mutex<DictationMode>,
    pub active_tokens: Mutex<HashMap<String, transcribe_cpp::CancelToken>>,
    pub engine_kind: Mutex<String>,
    pub selected_model: Mutex<Option<String>>,
    pub recording_started_at: Mutex<Option<Instant>>,
}

impl SttState {
    pub fn new(data_dir: PathBuf) -> Self {
        let models_dir = data_dir.join("models");
        Self {
            download_tracker: Arc::new(DownloadManager::new(models_dir)),
            engine: Arc::new(EngineManager::new()),
            capture_state: Arc::new(CaptureState::new()),
            current_capture: Mutex::new(None),
            dictation_mode: Mutex::new(DictationMode::Toggle),
            active_tokens: Mutex::new(HashMap::new()),
            engine_kind: Mutex::new("local".to_string()),
            selected_model: Mutex::new(None),
            recording_started_at: Mutex::new(None),
        }
    }
}
// ----------------------------------------------------------------------------
// Tauri Commands - Contract exact names (§22 and SttServices)
// ----------------------------------------------------------------------------

#[tauri::command]
pub async fn stt_catalog(state: State<'_, SttState>) -> Result<Vec<ModelInfo>, String> {
    Ok(state.download_tracker.list_catalog())
}

#[tauri::command]
pub async fn stt_download(
    state: State<'_, SttState>,
    model_id: String,
    mirror: Option<String>,
) -> Result<(), String> {
    state.download_tracker.start_download(&model_id, mirror).await
}

#[tauri::command]
pub async fn stt_download_cancel(state: State<'_, SttState>) -> Result<(), String> {
    state.download_tracker.cancel().await;
    Ok(())
}

#[tauri::command]
pub async fn stt_model_delete(
    state: State<'_, SttState>,
    model_id: String,
) -> Result<(), String> {
    state.download_tracker.delete_model(&model_id)
}

#[tauri::command]
pub async fn stt_download_progress(
    state: State<'_, SttState>,
    model_id: Option<String>,
) -> Result<DownloadProgress, String> {
    let _ = model_id;
    Ok(state.download_tracker.snapshot().await)
}

#[tauri::command]
pub async fn stt_engine(state: State<'_, SttState>) -> Result<EngineInfo, String> {
    let kind = state.engine_kind.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let model_id = state.selected_model.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let installed = state.download_tracker.list_catalog().into_iter().any(|m| m.installed);
    let available = if kind == "local" {
        installed
    } else {
        crate::credentials::has()
    };
    Ok(EngineInfo {
        engine: kind,
        model_id,
        available,
    })
}

#[tauri::command]
pub async fn stt_set_engine(
    state: State<'_, SttState>,
    engine: String,
    model_id: Option<String>,
) -> Result<(), String> {
    {
        let mut ek = state.engine_kind.lock().unwrap_or_else(|e| e.into_inner());
        *ek = engine;
    }
    {
        let mut sm = state.selected_model.lock().unwrap_or_else(|e| e.into_inner());
        *sm = model_id;
    }
    Ok(())
}

#[tauri::command]
pub async fn stt_start_dictation(
    state: State<'_, SttState>,
    mode: Option<String>,
) -> Result<(), String> {
    let mut cur = state.current_capture.lock().unwrap_or_else(|e| e.into_inner());
    if cur.is_some() {
        return Ok(());
    }

    if let Some(m) = mode {
        let mut dm = state.dictation_mode.lock().unwrap_or_else(|e| e.into_inner());
        *dm = if m == "push_to_talk" {
            DictationMode::PushToTalk
        } else {
            DictationMode::Toggle
        };
    }

    let handle = crate::stt::capture::start_audio_capture(
        None,
        crate::stt::capture::DEFAULT_ENERGY_THRESHOLD,
        (*state.capture_state).clone(),
    )
    .map_err(|e| match e {
        CaptureError::NoMicrophone => "no_microphone".to_string(),
        other => other.to_string(),
    })?;

    *cur = Some(handle);
    let mut st = state.recording_started_at.lock().unwrap_or_else(|e| e.into_inner());
    *st = Some(Instant::now());
    Ok(())
}

#[tauri::command]
pub async fn stt_stop_dictation(
    _app: AppHandle,
    state: State<'_, SttState>,
) -> Result<TranscriptionResult, String> {
    let handle = {
        let mut cur = state.current_capture.lock().unwrap_or_else(|e| e.into_inner());
        cur.take().ok_or_else(|| "no_speech".to_string())?
    };
    {
        let mut st = state.recording_started_at.lock().unwrap_or_else(|e| e.into_inner());
        *st = None;
    }

    let start_time = Instant::now();
    let samples = match handle.stop() {
        Ok(s) => s,
        Err(CaptureError::NoSpeech) => return Err("no_speech".to_string()),
        Err(e) => return Err(e.to_string()),
    };

    let engine_setting = state.engine_kind.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let models_dir = state.download_tracker.models_dir().to_path_buf();
    let installed = state.download_tracker.list_catalog().into_iter().filter(|m| m.installed).collect::<Vec<_>>();

    let (text, engine_used) = if engine_setting == "cloud" {
        let res = transcribe_audio_cloud(
            &samples,
            crate::stt::capture::SAMPLE_RATE,
            CloudTranscriptionParams::default(),
        )
        .await
        .map_err(|e| if e.contains("cloud_refused") { "cloud_refused".to_string() } else { e })?;
        (res.0, "cloud".to_string())
    } else if let Some(target_model) = installed.first() {
        let model_path = models_dir.join(&target_model.filename);
        let transcribed = state
            .engine
            .transcribe_samples(model_path, &samples)
            .await
            .map_err(|e| e.to_string())?;
        (transcribed, format!("local:{}", target_model.id))
    } else {
        // Fallback to cloud if BYOK exists
        if crate::credentials::has() {
            match transcribe_audio_cloud(
                &samples,
                crate::stt::capture::SAMPLE_RATE,
                CloudTranscriptionParams::default(),
            )
            .await
            {
                Ok(res) => (res.0, "cloud".to_string()),
                Err(e) => return Err(format!("cloud_refused: {e}")),
            }
        } else {
            return Err("no_model".to_string());
        }
    };

    if text.trim().is_empty() {
        return Err("no_speech".to_string());
    }

    let (inserted, outcome) = execute_dictation_injection(&text);
    let duration_ms = start_time.elapsed().as_millis() as u64;

    let outcome_str = match outcome {
        InjectionOutcome::Inserted => "inserted",
        InjectionOutcome::Copied => "copied",
    };

    Ok(TranscriptionResult {
        text,
        duration_ms,
        engine: engine_used,
        outcome: Some(outcome_str.to_string()),
        inserted: Some(inserted),
    })
}

#[tauri::command]
pub async fn stt_cancel_dictation(state: State<'_, SttState>) -> Result<(), String> {
    let mut cur = state.current_capture.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(handle) = cur.take() {
        handle.cancel();
    }
    let mut st = state.recording_started_at.lock().unwrap_or_else(|e| e.into_inner());
    *st = None;
    Ok(())
}

#[tauri::command]
pub async fn stt_dictation_state(state: State<'_, SttState>) -> Result<DictationState, String> {
    let since = {
        let st = state.recording_started_at.lock().unwrap_or_else(|e| e.into_inner());
        st.map(|t| t.elapsed().as_millis() as u64)
    };
    Ok(DictationState {
        recording: state.capture_state.is_recording(),
        level: state.capture_state.level(),
        since,
    })
}

#[tauri::command]
pub async fn stt_transcribe_file(
    state: State<'_, SttState>,
    path: String,
    model_id: Option<String>,
) -> Result<TranscribeFileResult, String> {
    let pcm = read_wav_file_16k_mono(&PathBuf::from(&path))?;
    if pcm.is_empty() {
        return Err("no_speech".to_string());
    }

    let models_dir = state.download_tracker.models_dir().to_path_buf();
    let installed = state.download_tracker.list_catalog().into_iter().filter(|m| m.installed).collect::<Vec<_>>();
    let engine_setting = state.engine_kind.lock().unwrap_or_else(|e| e.into_inner()).clone();

    if engine_setting == "cloud" {
        let res = transcribe_audio_cloud(
            &pcm,
            crate::stt::capture::SAMPLE_RATE,
            CloudTranscriptionParams::default(),
        )
        .await
        .map_err(|e| if e.contains("cloud_refused") { "cloud_refused".to_string() } else { e })?;
        return Ok(TranscribeFileResult {
            text: res.0,
            language: res.1,
        });
    }

    let chosen = if let Some(ref mid) = model_id {
        installed.into_iter().find(|m| m.id == *mid)
    } else {
        installed.into_iter().next()
    };

    if let Some(m) = chosen {
        let model_path = models_dir.join(&m.filename);
        let token_key = path.clone();
        let cancel_token = transcribe_cpp::CancelToken::default();
        {
            let mut map = state.active_tokens.lock().unwrap_or_else(|e| e.into_inner());
            map.insert(token_key.clone(), cancel_token.clone());
        }

        let res = state
            .engine
            .transcribe_samples(model_path, &pcm)
            .await;

        {
            let mut map = state.active_tokens.lock().unwrap_or_else(|e| e.into_inner());
            map.remove(&token_key);
        }

        let text = res.map_err(|e| e.to_string())?;
        Ok(TranscribeFileResult {
            text,
            language: "auto".to_string(),
        })
    } else if crate::credentials::has() {
        let res = transcribe_audio_cloud(
            &pcm,
            crate::stt::capture::SAMPLE_RATE,
            CloudTranscriptionParams::default(),
        )
        .await
        .map_err(|e| if e.contains("cloud_refused") { "cloud_refused".to_string() } else { e })?;
        Ok(TranscribeFileResult {
            text: res.0,
            language: res.1,
        })
    } else {
        Err("no_model".to_string())
    }
}

#[tauri::command]
pub async fn stt_transcribe_cloud(
    path: String,
    base_url: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
) -> Result<TranscribeFileResult, String> {
    let pcm = read_wav_file_16k_mono(&PathBuf::from(&path))?;
    let res = transcribe_audio_cloud(
        &pcm,
        crate::stt::capture::SAMPLE_RATE,
        CloudTranscriptionParams {
            base_url,
            api_key,
            model,
        },
    )
    .await
    .map_err(|e| if e.contains("cloud_refused") { "cloud_refused".to_string() } else { e })?;

    Ok(TranscribeFileResult {
        text: res.0,
        language: res.1,
    })
}

#[tauri::command]
pub async fn stt_cancel_transcription(
    state: State<'_, SttState>,
    path: String,
) -> Result<(), String> {
    let mut tokens = state.active_tokens.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(token) = tokens.remove(&path) {
        token.cancel();
    }
    Ok(())
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

pub fn resolve_data_dir(app: &AppHandle) -> PathBuf {
    if crate::is_portable_running() {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                return dir.to_path_buf();
            }
        }
    }
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

pub fn read_wav_file_16k_mono(path: &Path) -> Result<Vec<f32>, String> {
    let reader = hound::WavReader::open(path).map_err(|e| format!("Cannot open WAV: {e}"))?;
    let spec = reader.spec();
    let channels = spec.channels;
    let sample_rate = spec.sample_rate;

    let samples_f32: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .into_samples::<f32>()
            .filter_map(|s| s.ok())
            .collect(),
        hound::SampleFormat::Int => {
            let bits = spec.bits_per_sample;
            if bits <= 16 {
                reader
                    .into_samples::<i16>()
                    .filter_map(|s| s.ok())
                    .map(|s| s as f32 / if s < 0 { 32768.0 } else { 32767.0 })
                    .collect()
            } else {
                reader
                    .into_samples::<i32>()
                    .filter_map(|s| s.ok())
                    .map(|s| s as f32 / 2147483648.0)
                    .collect()
            }
        }
    };

    let mono: Vec<f32> = if channels <= 1 {
        samples_f32
    } else {
        samples_f32
            .chunks(channels as usize)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    };

    Ok(crate::stt::capture::resample_linear(&mono, sample_rate, 16000))
}

