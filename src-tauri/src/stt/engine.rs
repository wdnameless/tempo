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
    loaded_engine: Option<String>,
    accelerator: String,
    gpu_device: Option<String>,
    model: Option<Arc<Model>>,
    session: Option<Session>,
    onnx_model: Option<Box<dyn transcribe_rs::SpeechModel + Send>>,
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
                loaded_engine: None,
                accelerator: "auto".to_string(),
                gpu_device: None,
                model: None,
                session: None,
                onnx_model: None,
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
            state.onnx_model = None;
            state.loaded_model_path = None;
            state.loaded_engine = None;
        }
    }

    /// Releases any loaded model session to keep idle CPU/RAM footprint minimal (R46).
    pub async fn unload(&self) {
        let mut state = self.inner.lock().await;
        state.session = None;
        state.model = None;
        state.onnx_model = None;
        state.loaded_model_path = None;
        state.loaded_engine = None;
    }

    /// Transcribes 16 kHz mono f32 samples using the specified engine and model path.
    pub async fn transcribe_samples(
        &self,
        engine: &str,
        model_path: PathBuf,
        pcm: &[f32],
        options: &RunOptions,
    ) -> Result<String, String> {
        let norm_engine = engine.trim().to_ascii_lowercase();
        if norm_engine == "whisper" {
            self.transcribe_whisper(model_path, pcm, options).await
        } else {
            self.transcribe_onnx(&norm_engine, model_path, pcm, options).await
        }
    }

    async fn transcribe_whisper(
        &self,
        model_path: PathBuf,
        pcm: &[f32],
        options: &RunOptions,
    ) -> Result<String, String> {
        let (cancel_token, session) = {
            let mut state = self.inner.lock().await;

            // Check if model path changed or needs load
            let need_reload = match (&state.loaded_model_path, &state.loaded_engine) {
                (Some(p), Some(e)) => p != &model_path || e != "whisper",
                _ => true,
            };

            if need_reload {
                state.session = None;
                state.model = None;
                state.onnx_model = None;

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
                state.loaded_engine = Some("whisper".to_string());
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

    async fn transcribe_onnx(
        &self,
        engine: &str,
        model_path: PathBuf,
        pcm: &[f32],
        options: &RunOptions,
    ) -> Result<String, String> {
        let onnx_model = {
            let mut state = self.inner.lock().await;

            let need_reload = match (&state.loaded_model_path, &state.loaded_engine) {
                (Some(p), Some(e)) => p != &model_path || e != engine,
                _ => true,
            };

            if need_reload {
                state.session = None;
                state.model = None;
                state.onnx_model = None;

                match state.accelerator.to_ascii_lowercase().as_str() {
                    "cpu" => transcribe_rs::set_ort_accelerator(transcribe_rs::OrtAccelerator::CpuOnly),
                    _ => transcribe_rs::set_ort_accelerator(transcribe_rs::OrtAccelerator::Auto),
                }

                let loaded: Box<dyn transcribe_rs::SpeechModel + Send> = match engine {
                    "gigaam" => {
                        let m = transcribe_rs::onnx::gigaam::GigaAMModel::load(
                            &model_path,
                            &transcribe_rs::onnx::Quantization::Int8,
                        )
                        .map_err(|e| format!("Failed to load GigaAM model: {e}"))?;
                        Box::new(m)
                    }
                    "parakeet" => {
                        let m = transcribe_rs::onnx::parakeet::ParakeetModel::load(
                            &model_path,
                            &transcribe_rs::onnx::Quantization::Int8,
                        )
                        .map_err(|e| format!("Failed to load Parakeet model: {e}"))?;
                        Box::new(m)
                    }
                    "canary" => {
                        let m = transcribe_rs::onnx::canary::CanaryModel::load(
                            &model_path,
                            &transcribe_rs::onnx::Quantization::Int8,
                        )
                        .map_err(|e| format!("Failed to load Canary model: {e}"))?;
                        Box::new(m)
                    }
                    "sensevoice" => {
                        let m = transcribe_rs::onnx::sense_voice::SenseVoiceModel::load(
                            &model_path,
                            &transcribe_rs::onnx::Quantization::Int8,
                        )
                        .map_err(|e| format!("Failed to load SenseVoice model: {e}"))?;
                        Box::new(m)
                    }
                    "cohere" => {
                        let m = transcribe_rs::onnx::cohere::CohereModel::load(
                            &model_path,
                            &transcribe_rs::onnx::Quantization::Int8,
                        )
                        .map_err(|e| format!("Failed to load Cohere model: {e}"))?;
                        Box::new(m)
                    }
                    "moonshine" => {
                        if model_path.join("streaming_config.json").is_file()
                            || model_path.to_string_lossy().contains("streaming")
                        {
                            let m = transcribe_rs::onnx::moonshine::StreamingModel::load(
                                &model_path,
                                4,
                                &transcribe_rs::onnx::Quantization::default(),
                            )
                            .map_err(|e| format!("Failed to load Moonshine Streaming model: {e}"))?;
                            Box::new(m)
                        } else {
                            let m = transcribe_rs::onnx::moonshine::MoonshineModel::load(
                                &model_path,
                                transcribe_rs::onnx::moonshine::MoonshineVariant::Base,
                                &transcribe_rs::onnx::Quantization::default(),
                            )
                            .map_err(|e| format!("Failed to load Moonshine model: {e}"))?;
                            Box::new(m)
                        }
                    }
                    _ => return Err(format!("unknown_engine: Unsupported engine '{engine}'")),
                };

                state.onnx_model = Some(loaded);
                state.loaded_model_path = Some(model_path.clone());
                state.loaded_engine = Some(engine.to_string());
            }

            state.last_used = Instant::now();
            state.onnx_model.take().ok_or_else(|| "ONNX model missing".to_string())?
        };

        let pcm_vec = pcm.to_vec();
        let tr_opts = transcribe_rs::TranscribeOptions {
            language: options.language.clone(),
            translate: options.task == Task::Translate,
            leading_silence_ms: None,
            trailing_silence_ms: None,
        };

        let (returned_model, result) = tokio::task::spawn_blocking(move || {
            let mut m = onnx_model;
            let res = m.transcribe(&pcm_vec, &tr_opts);
            (m, res)
        })
        .await
        .map_err(|e| format!("ONNX task panicked: {e}"))?;

        {
            let mut state = self.inner.lock().await;
            state.onnx_model = Some(returned_model);
            state.last_used = Instant::now();
        }

        match result {
            Ok(res) => Ok(res.text.trim().to_string()),
            Err(e) => Err(format!("ONNX transcription failed: {e}")),
        }
    }

    /// Convenience wrapper using default [`RunOptions`].
    pub async fn transcribe_samples_default(
        &self,
        engine: &str,
        model_path: PathBuf,
        pcm: &[f32],
    ) -> Result<String, String> {
        self.transcribe_samples(engine, model_path, pcm, &RunOptions::default()).await
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
        state.loaded_model_path.is_some() || state.session.is_some() || state.model.is_some() || state.onnx_model.is_some()
    }

    /// Background janitor check: if idle for > unload_secs, unloads the model.
    /// If unload_secs == 0, model is never unloaded on idle.
    pub async fn check_idle_timeout(&self, unload_secs: u64) {
        let mut state = self.inner.lock().await;
        let is_loaded = state.loaded_model_path.is_some()
            || state.session.is_some()
            || state.model.is_some()
            || state.onnx_model.is_some();
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
            state.onnx_model = None;
            state.loaded_model_path = None;
            state.loaded_engine = None;
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

    #[tokio::test]
    async fn test_engine_dispatch_routes_by_engine_name() {
        let engine = EngineManager::new();
        let samples = vec![0.0f32; 1600];
        let options = RunOptions::default();

        // Whisper dispatch: routes to WhisperModel loader
        let whisper_res = engine
            .transcribe_samples("whisper", PathBuf::from("nonexistent-whisper.bin"), &samples, &options)
            .await;
        assert!(whisper_res.is_err());
        let whisper_err = whisper_res.unwrap_err();
        assert!(
            whisper_err.contains("Whisper"),
            "Expected whisper loader error, got: {whisper_err}"
        );

        // GigaAM dispatch: routes to GigaAM loader
        let giga_res = engine
            .transcribe_samples("gigaam", PathBuf::from("nonexistent-gigaam-dir"), &samples, &options)
            .await;
        assert!(giga_res.is_err());
        let giga_err = giga_res.unwrap_err();
        assert!(
            giga_err.contains("GigaAM"),
            "Expected gigaam loader error, got: {giga_err}"
        );
    }

    #[tokio::test]
    async fn test_real_end_to_end_moonshine_load_and_transcribe() {
        use tempfile::tempdir;
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("moonshine-tiny-streaming-en.tar.gz");
        let model_dir = dir.path().join("moonshine-tiny-streaming-en");

        let client = reqwest::Client::new();
        let resp = client
            .get("https://blob.handy.computer/moonshine-tiny-streaming-en.tar.gz")
            .send()
            .await;
        let resp = match resp {
            Ok(r) if r.status().is_success() => r,
            _ => {
                eprintln!("Skipping end-to-end test: blob.handy.computer unavailable");
                return;
            }
        };

        let bytes = resp.bytes().await.expect("Failed to get model bytes");
        std::fs::write(&archive_path, &bytes).expect("Failed to write archive");

        crate::stt::models::extract_archive_safe(&archive_path, &model_dir)
            .expect("Extraction failed");
        crate::stt::models::verify_model_files(&model_dir, "moonshine")
            .expect("Model verification failed");
        std::fs::write(model_dir.join(".complete"), "ok").expect("Marker failed");

        // A voiced tone proves the engine loads and runs, but it is not speech:
        // the engine answers with an empty string, which is the honest result for
        // a signal with no words in it. Point TEMPO_TEST_WAV at a real recording
        // to check that the engine actually hears.
        let (pcm, expect_words) = match std::env::var("TEMPO_TEST_WAV") {
            Ok(path) if !path.is_empty() => {
                (read_wav_as_f32_mono(&std::path::PathBuf::from(&path)), true)
            }
            _ => {
                let sample_rate = 16000;
                let num_samples = (sample_rate as f64 * 1.5) as usize;
                let mut pcm = Vec::with_capacity(num_samples);
                for i in 0..num_samples {
                    let t = i as f64 / sample_rate as f64;
                    let pitch = 130.0;
                    let glottal = (2.0 * std::f64::consts::PI * pitch * t).sin();
                    let f1 = (2.0 * std::f64::consts::PI * 600.0 * t).sin() * 0.5;
                    let f2 = (2.0 * std::f64::consts::PI * 1700.0 * t).sin() * 0.3;
                    pcm.push((glottal * (f1 + f2) * 0.3) as f32);
                }
                (pcm, false)
            }
        };

        let engine = EngineManager::new();
        let res = engine
            .transcribe_samples("moonshine", model_dir, &pcm, &RunOptions::default())
            .await;
        assert!(res.is_ok(), "Transcription should succeed, got: {:?}", res);
        let text = res.unwrap();
        println!("Moonshine heard: {text:?}");
        if expect_words {
            assert!(
                !text.trim().is_empty(),
                "a real recording must produce words, not an empty string"
            );
        }
    }

    /// Reads a 16 kHz mono WAV into the f32 samples the engines take.
    fn read_wav_as_f32_mono(path: &std::path::Path) -> Vec<f32> {
        let mut reader = hound::WavReader::open(path).expect("test wav must open");
        let spec = reader.spec();
        assert_eq!(spec.channels, 1, "test wav must be mono");
        assert_eq!(spec.sample_rate, 16000, "test wav must be 16 kHz");
        let samples: Vec<f32> = match spec.sample_format {
            hound::SampleFormat::Int => reader
                .samples::<i16>()
                .map(|s| s.expect("sample") as f32 / i16::MAX as f32)
                .collect(),
            hound::SampleFormat::Float => reader.samples::<f32>().map(|s| s.expect("sample")).collect(),
        };
        samples
    }
}
