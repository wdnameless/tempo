// src-tauri/src/stt/engine.rs
// Manages local Whisper model inference with transcribe-cpp, lazy load, cancel token, and idle unloading.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use transcribe_cpp::{CancelToken, Model, RunOptions, Session};

pub const IDLE_UNLOAD_TIMEOUT: Duration = Duration::from_secs(60);

pub struct EngineManager {
    inner: Mutex<EngineState>,
}
pub type WhisperEngine = EngineManager;


struct EngineState {
    loaded_model_path: Option<PathBuf>,
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
                model: None,
                session: None,
                last_used: Instant::now(),
                active_cancel: None,
            }),
        }
    }

    /// Releases any loaded model session to keep idle CPU/RAM footprint minimal (R46).
    pub async fn unload(&self) {
        let mut state = self.inner.lock().await;
        state.session = None;
        state.model = None;
        state.loaded_model_path = None;
    }

    /// Transcribes 16 kHz mono f32 samples using the provided model path.
    /// Reuses existing loaded session if model path matches.
    pub async fn transcribe_samples(
        &self,
        model_path: PathBuf,
        pcm: &[f32],
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

                let model = Model::load(path_str)
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

        // Run transcription on blocking thread pool
        let run_res = tokio::task::spawn_blocking(move || {
            let mut sess = session;
            sess.set_cancel_token(&cancel_clone);
            let options = RunOptions::default();
            let result = sess.run(&pcm_vec, &options);
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

    /// Cancels currently running transcription if any.
    pub async fn cancel_current(&self) {
        let state = self.inner.lock().await;
        if let Some(cancel) = &state.active_cancel {
            cancel.cancel();
        }
    }

    /// Background janitor check: if idle for > IDLE_UNLOAD_TIMEOUT, unloads the model (R46).
    pub async fn check_idle_timeout(&self) {
        let mut state = self.inner.lock().await;
        if state.session.is_some()
            && state.active_cancel.is_none()
            && state.last_used.elapsed() > IDLE_UNLOAD_TIMEOUT
        {
            state.session = None;
            state.model = None;
            state.loaded_model_path = None;
        }
    }
}
