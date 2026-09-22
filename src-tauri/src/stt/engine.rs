// src-tauri/src/stt/engine.rs
// Manages local Whisper model inference with transcribe-cpp, lazy load, cancel token, and idle unloading.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use transcribe_cpp::{
    Backend, CancelToken, Model, ModelOptions, RunExtension, RunOptions, Session, Task,
    WhisperRunOptions,
};

pub const DEFAULT_IDLE_UNLOAD_SECS: u64 = 60;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct TranscribeOptions {
    pub language: Option<String>,
    pub translate_to_english: bool,
    pub custom_words: Vec<String>,
}

/// Builds transcribe-cpp [`RunOptions`] from high-level speech configuration.
///
/// Maps:
/// - `language`: `None` or `"auto"` -> `None` (autodetect); otherwise `Some(code)`
/// - `translate_to_english`: sets `task = Task::Translate` and `target_language = Some("en")`
/// - `custom_words`: formats into `WhisperRunOptions.initial_prompt` decode bias
pub fn build_run_options(opts: &TranscribeOptions) -> RunOptions {
    let language = opts.language.as_deref().and_then(|l| {
        let trimmed = l.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("auto") {
            None
        } else {
            Some(trimmed.to_lowercase())
        }
    });

    let joined_words = opts.custom_words.join(", ");
    let family = if joined_words.trim().is_empty() {
        None
    } else {
        Some(RunExtension::Whisper(WhisperRunOptions {
            initial_prompt: Some(joined_words),
            ..Default::default()
        }))
    };

    RunOptions {
        language,
        task: if opts.translate_to_english {
            Task::Translate
        } else {
            Task::Transcribe
        },
        target_language: opts.translate_to_english.then(|| "en".to_string()),
        family,
        ..Default::default()
    }
}

pub struct EngineManager {
    inner: Mutex<EngineState>,
}
pub type WhisperEngine = EngineManager;

struct EngineState {
    loaded_model_path: Option<PathBuf>,
    accelerator: String,
    gpu_device: Option<String>,
    model: Option<Arc<Model>>,
    session: Option<Session>,
    last_used: Instant,
    active_cancel: Option<CancelToken>,
}

impl Default for EngineManager {
    fn default() -> Self {
        Self::new()
    }
}

impl EngineManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(EngineState {
                loaded_model_path: None,
                accelerator: "auto".to_string(),
                gpu_device: None,
                model: None,
                session: None,
                last_used: Instant::now(),
                active_cancel: None,
            }),
        }
    }

    /// Configures the compute accelerator and GPU device preference.
    /// If the configuration changed, unloads any previously loaded model so
    /// the new backend applies to the next transcript.
    pub async fn configure(&self, accelerator: &str, gpu_device: Option<&str>) {
        let mut state = self.inner.lock().await;
        let new_accel = if accelerator.trim().is_empty() {
            "auto"
        } else {
            accelerator.trim()
        };
        let new_gpu = gpu_device.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

        let changed = state.accelerator != new_accel || state.gpu_device != new_gpu;
        if changed {
            state.accelerator = new_accel.to_string();
            state.gpu_device = new_gpu;
            state.session = None;
            state.model = None;
            state.loaded_model_path = None;
        }
    }

    /// Releases any loaded model session to keep idle CPU/RAM footprint minimal (R46).
    pub async fn unload(&self) {
        let mut state = self.inner.lock().await;
        state.session = None;
        state.model = None;
        state.loaded_model_path = None;
    }

    /// Transcribes 16 kHz mono f32 samples using the provided model path and RunOptions.
    /// Reuses existing loaded session if model path matches.
    pub async fn transcribe_samples(
        &self,
        model_path: PathBuf,
        pcm: &[f32],
        options: &RunOptions,
    ) -> Result<String, String> {
        let (cancel_token, session) = {
            let mut state = self.inner.lock().await;

            // Check if model path changed or needs load
            let need_reload = match &state.loaded_model_path {
                Some(p) => p != &model_path,
                None => true,
            };

            if need_reload {
                state.session = None;
                state.model = None;

                let path_str = model_path
                    .to_str()
                    .ok_or_else(|| "Invalid model path characters".to_string())?;

                let (backend, device) = match state.accelerator.to_ascii_lowercase().as_str() {
                    "cpu" => (Backend::Cpu, None),
                    "gpu" => {
                        let dev = crate::stt::accel::resolve_gpu_device(state.gpu_device.as_deref());
                        (Backend::Auto, dev)
                    }
                    _ => (Backend::Auto, None),
                };

                let model_options = ModelOptions { backend, device };
                let model = Model::load_with(path_str, &model_options)
                    .map_err(|e| format!("Failed to load Whisper model: {e}"))?;
                let arc_model = Arc::new(model);
                let session = arc_model
                    .session()
                    .map_err(|e| format!("Failed to create Whisper session: {e}"))?;

                state.model = Some(arc_model);
                state.session = Some(session);
                state.loaded_model_path = Some(model_path.clone());
            }

            state.last_used = Instant::now();
            let cancel = CancelToken::new();
            state.active_cancel = Some(cancel.clone());

            // Take session out temporarily for run
            let session = state.session.take().ok_or_else(|| "Session missing".to_string())?;
            (cancel, session)
        };

        let pcm_vec = pcm.to_vec();
        let cancel_clone = cancel_token.clone();
        let run_options = options.clone();

        // Run transcription on blocking thread pool
        let run_res = tokio::task::spawn_blocking(move || {
            let mut sess = session;
            sess.set_cancel_token(&cancel_clone);
            let result = sess.run(&pcm_vec, &run_options);
            (sess, result)
        })
        .await
        .map_err(|e| format!("Transcription task panicked: {e}"))?;

        let (returned_session, result) = run_res;

        // Restore session
        {
            let mut state = self.inner.lock().await;
            state.session = Some(returned_session);
            state.active_cancel = None;
            state.last_used = Instant::now();
        }

        match result {
            Ok(transcript) => Ok(transcript.text.trim().to_string()),
            Err(e) => {
                if cancel_token.is_cancelled() {
                    Err("cancelled".to_string())
                } else {
                    Err(format!("Transcription failed: {e}"))
                }
            }
        }
    }

    /// Convenience wrapper using default [`RunOptions`].
    pub async fn transcribe_samples_default(
        &self,
        model_path: PathBuf,
        pcm: &[f32],
    ) -> Result<String, String> {
        self.transcribe_samples(model_path, pcm, &RunOptions::default()).await
    }

    /// Cancels currently running transcription if any.
    pub async fn cancel_current(&self) {
        let state = self.inner.lock().await;
        if let Some(cancel) = &state.active_cancel {
            cancel.cancel();
        }
    }

    /// Returns true if a model is currently loaded in memory.
    pub async fn is_loaded(&self) -> bool {
        let state = self.inner.lock().await;
        state.loaded_model_path.is_some() || state.session.is_some() || state.model.is_some()
    }

    /// Background janitor check: if idle for > unload_secs, unloads the model.
    /// If unload_secs == 0, model is never unloaded on idle.
    pub async fn check_idle_timeout(&self, unload_secs: u64) {
        let mut state = self.inner.lock().await;
        let is_loaded = state.loaded_model_path.is_some()
            || state.session.is_some()
            || state.model.is_some();
        let is_active = state.active_cancel.is_some();
        if should_unload_on_idle(
            is_loaded,
            is_active,
            state.last_used,
            Instant::now(),
            unload_secs,
        ) {
            state.session = None;
            state.model = None;
            state.loaded_model_path = None;
        }
    }
}

/// Returns true if the engine should unload the model given its idle state and timeout setting.
pub fn should_unload_on_idle(
    is_loaded: bool,
    is_active: bool,
    last_used: Instant,
    now: Instant,
    unload_secs: u64,
) -> bool {
    if unload_secs == 0 || !is_loaded || is_active {
        return false;
    }
    now.saturating_duration_since(last_used) > Duration::from_secs(unload_secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_run_options_language_mapping() {
        // None -> autodetect
        let ro = build_run_options(&TranscribeOptions::default());
        assert_eq!(ro.language, None);
        assert_eq!(ro.target_language, None);
        assert_eq!(ro.task, Task::Transcribe);

        // "auto" -> None
        let ro_auto = build_run_options(&TranscribeOptions {
            language: Some("auto".to_string()),
            translate_to_english: false,
            custom_words: Vec::new(),
        });
        assert_eq!(ro_auto.language, None);

        // "ru" -> Some("ru")
        let ro_ru = build_run_options(&TranscribeOptions {
            language: Some("ru".to_string()),
            translate_to_english: false,
            custom_words: Vec::new(),
        });
        assert_eq!(ro_ru.language, Some("ru".to_string()));
        assert_eq!(ro_ru.task, Task::Transcribe);
    }

    #[test]
    fn test_build_run_options_translate_to_english() {
        let ro = build_run_options(&TranscribeOptions {
            language: Some("de".to_string()),
            translate_to_english: true,
            custom_words: Vec::new(),
        });
        assert_eq!(ro.language, Some("de".to_string()));
        assert_eq!(ro.task, Task::Translate);
        assert_eq!(ro.target_language, Some("en".to_string()));
    }

    #[test]
    fn test_build_run_options_custom_words_initial_prompt() {
        let words = vec!["Tempo".to_string(), "Alarmer".to_string(), "Whisper".to_string()];
        let ro = build_run_options(&TranscribeOptions {
            language: None,
            translate_to_english: false,
            custom_words: words,
        });

        match ro.family {
            Some(RunExtension::Whisper(w)) => {
                assert_eq!(w.initial_prompt, Some("Tempo, Alarmer, Whisper".to_string()));
            }
            _ => panic!("Expected WhisperRunOptions extension"),
        }
    }

    impl EngineManager {
        async fn set_test_idle_state(&self, loaded: bool, active: bool, last_used: Instant) {
            let mut state = self.inner.lock().await;
            state.loaded_model_path = if loaded {
                Some(PathBuf::from("dummy.bin"))
            } else {
                None
            };
            state.active_cancel = if active {
                Some(CancelToken::new())
            } else {
                None
            };
            state.last_used = last_used;
        }
    }

    #[test]
    fn test_should_unload_on_idle_decision() {
        let now = Instant::now();
        let t_recent = now - Duration::from_secs(10);
        let t_old = now - Duration::from_secs(100);

        // 1. Not loaded -> false
        assert!(!should_unload_on_idle(false, false, t_old, now, 60));

        // 2. Active cancel -> false
        assert!(!should_unload_on_idle(true, true, t_old, now, 60));

        // 3. unload_secs == 0 -> false
        assert!(!should_unload_on_idle(true, false, t_old, now, 0));

        // 4. Elapsed < unload_secs -> false
        assert!(!should_unload_on_idle(true, false, t_recent, now, 60));

        // 5. Elapsed == unload_secs -> false
        let t_exact = now - Duration::from_secs(60);
        assert!(!should_unload_on_idle(true, false, t_exact, now, 60));

        // 6. Elapsed > unload_secs -> true
        assert!(should_unload_on_idle(true, false, t_old, now, 60));
    }

    #[tokio::test]
    async fn test_check_idle_timeout_unloads_when_expired() {
        let engine = EngineManager::new();
        let t0 = Instant::now() - Duration::from_secs(100);
        engine.set_test_idle_state(true, false, t0).await;
        assert!(engine.is_loaded().await);

        // unload_secs = 60; elapsed = 100s -> should unload
        engine.check_idle_timeout(60).await;
        assert!(!engine.is_loaded().await);
    }

    #[tokio::test]
    async fn test_check_idle_timeout_retains_when_not_expired() {
        let engine = EngineManager::new();
        let t0 = Instant::now() - Duration::from_secs(30);
        engine.set_test_idle_state(true, false, t0).await;
        assert!(engine.is_loaded().await);

        // unload_secs = 60; elapsed = 30s -> should NOT unload
        engine.check_idle_timeout(60).await;
        assert!(engine.is_loaded().await);
    }

    #[tokio::test]
    async fn test_check_idle_timeout_retains_when_zero_secs() {
        let engine = EngineManager::new();
        let t0 = Instant::now() - Duration::from_secs(1000);
        engine.set_test_idle_state(true, false, t0).await;
        assert!(engine.is_loaded().await);

        // unload_secs = 0 (never unload) -> should NOT unload
        engine.check_idle_timeout(0).await;
        assert!(engine.is_loaded().await);
    }

    #[tokio::test]
    async fn test_check_idle_timeout_retains_when_active() {
        let engine = EngineManager::new();
        let t0 = Instant::now() - Duration::from_secs(100);
        engine.set_test_idle_state(true, true, t0).await;
        assert!(engine.is_loaded().await);

        // active transcription in flight -> should NOT unload
        engine.check_idle_timeout(60).await;
        assert!(engine.is_loaded().await);
    }
}
