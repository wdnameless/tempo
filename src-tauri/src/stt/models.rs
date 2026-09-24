//! Model management, download orchestration, disk verification, and catalog resolution.
//!
//! Provides resumable downloads with HTTP Range requests, multi-mirror fallback,
//! streaming sha256 verification in 64 KiB chunks, disk space safety checks,
//! and unified listing across catalog, disk-cached, and custom GGUF models.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::header::CONTENT_RANGE;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::stt::catalog::{self, QuantFile};

pub const DOWNLOAD_STALL_TIMEOUT: Duration = Duration::from_secs(60);
pub const HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
pub const PROGRESS_EMIT_THROTTLE: Duration = Duration::from_millis(100);

pub const SILERO_VAD_MODEL_ID: &str = "silero-vad";
pub const SILERO_VAD_FILENAME: &str = "silero_vad.onnx";
pub const SILERO_VAD_SIZE_BYTES: u64 = 1_807_522;
pub const SILERO_VAD_SHA256: &str = "a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28";
pub const SILERO_VAD_URLS: &[&str] = &[
    "https://raw.githubusercontent.com/snakers4/silero-vad/v4.0/files/silero_vad.onnx",
    "https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model.onnx",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub engine: String,
    pub description: String,
    pub filename: String,
    pub quant: String,
    pub quants: Vec<String>,
    pub bytes: u64,
    pub sha256: Option<String>,
    pub revision: Option<String>,
    pub languages: Vec<String>,
    pub language_count: u32,
    pub speed_score: f32,
    pub accuracy_score: f32,
    pub parameters: String,
    pub recommended: bool,
    pub supports_translation: bool,
    pub supports_language_detect: bool,
    pub installed: bool,
    pub path: Option<String>,
    pub is_downloading: bool,
    pub partial_bytes: u64,
    pub is_custom: bool,
    pub source: String, // "catalog" | "custom" | "detected"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub streaming: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub model_id: String,
    pub received: u64,
    pub total: u64,
    pub percentage: f64,
    pub speed_bps: f64,
    pub eta_secs: Option<u64>,
    pub phase: String, // "downloading" | "verifying" | "done" | "cancelled" | "error"
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownloadOutcome {
    Completed,
    Cancelled,
}

pub struct ActiveDownload {
    pub model_id: String,
    pub cancel: Arc<AtomicBool>,
    pub progress: Arc<Mutex<DownloadProgress>>,
}

pub struct ModelManager {
    models_dir: PathBuf,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
    active_downloads: Arc<Mutex<HashMap<String, Arc<ActiveDownload>>>>,
    extra_cache_dirs: Vec<PathBuf>,
}

impl ModelManager {
    pub fn new(models_dir: PathBuf) -> Self {
        Self::with_app(models_dir, None)
    }

    pub fn with_app(models_dir: PathBuf, app: Option<AppHandle>) -> Self {
        Self {
            models_dir,
            app_handle: Arc::new(Mutex::new(app)),
            active_downloads: Arc::new(Mutex::new(HashMap::new())),
            extra_cache_dirs: Vec::new(),
        }
    }

    pub fn with_extra_caches(mut self, extra_caches: Vec<PathBuf>) -> Self {
        self.extra_cache_dirs = extra_caches;
        self
    }

    pub fn add_extra_cache_dir(&mut self, dir: PathBuf) {
        self.extra_cache_dirs.push(dir);
    }

    pub fn set_app_handle(&self, app: AppHandle) {
        if let Ok(mut lock) = self.app_handle.try_lock() {
            *lock = Some(app);
        }
    }

    pub fn models_dir(&self) -> &Path {
        &self.models_dir
    }

    fn emit_event<S: Serialize + Clone>(&self, event: &str, payload: S) {
        if let Ok(guard) = self.app_handle.try_lock() {
            if let Some(app) = guard.as_ref() {
                let _ = app.emit(event, payload);
            }
        }
    }

    /// Unified list of catalog models, installed files, and custom local models.
    pub async fn list(&self) -> Vec<ModelInfo> {
        let _ = fs::create_dir_all(&self.models_dir);
        let mut results = Vec::new();
        let mut seen_filenames = HashMap::new();
        let mut seen_paths = HashSet::new();
        let active = self.active_downloads.lock().await;

        // 1. Process catalog models
        for cat in catalog::CATALOG.iter() {
            let def_file = catalog::default_file(cat);
            let quants: Vec<String> = cat.files.iter().map(|f| f.quant.clone()).collect();

            let mut installed_file: Option<&QuantFile> = None;
            let mut installed_path: Option<PathBuf> = None;

            // Check if default quant exists first
            if let Some(df) = def_file {
                let p = self.models_dir.join(&df.filename);
                if p.is_file() {
                    installed_file = Some(df);
                    installed_path = Some(p);
                }
            }

            // If not found, check other quants
            if installed_file.is_none() {
                for f in &cat.files {
                    let p = self.models_dir.join(&f.filename);
                    if p.is_file() {
                        installed_file = Some(f);
                        installed_path = Some(p);
                        break;
                    }
                }
            }

            // Track claimed filenames
            for f in &cat.files {
                seen_filenames.insert(f.filename.clone(), cat.id.clone());
            }

            let active_dl = active.get(&cat.id);
            let is_downloading = active_dl.is_some();

            let is_arch = cat.engine != "whisper" || cat.archive.is_some();
            let (chosen_file, installed, path_str) = if is_arch {
                let p = self.models_dir.join(&cat.filename);
                let is_inst = p.is_dir() && p.join(".complete").is_file();
                let p_str = if is_inst { Some(p.to_string_lossy().to_string()) } else { None };
                (def_file.unwrap_or(&cat.files[0]), is_inst, p_str)
            } else {
                match (installed_file, installed_path) {
                    (Some(f), Some(p)) => (f, true, Some(p.to_string_lossy().to_string())),
                    _ => (def_file.unwrap_or(&cat.files[0]), false, None),
                }
            };
            let partial_path = self.models_dir.join(format!("{}.part", chosen_file.filename));
            let partial_bytes = if is_downloading {
                if let Some(dl) = active_dl {
                    let prog = dl.progress.lock().await;
                    prog.received
                } else {
                    partial_path.metadata().map(|m| m.len()).unwrap_or(0)
                }
            } else if partial_path.is_file() {
                partial_path.metadata().map(|m| m.len()).unwrap_or(0)
            } else {
                0
            };

            let effective_downloading = is_downloading || (partial_bytes > 0 && !installed);
            let is_streaming = cat.id.to_lowercase().contains("streaming")
                || cat.name.to_lowercase().contains("streaming");

            if let Some(p_str) = &path_str {
                let p = PathBuf::from(p_str);
                seen_paths.insert(fs::canonicalize(&p).unwrap_or(p));
            }

            results.push(ModelInfo {
                id: cat.id.clone(),
                name: cat.name.clone(),
                engine: cat.engine.clone(),
                description: cat.description.clone(),
                filename: chosen_file.filename.clone(),
                quant: chosen_file.quant.clone(),
                quants,
                bytes: chosen_file.size_bytes,
                sha256: chosen_file.sha256.clone(),
                revision: Some(cat.revision.clone()),
                languages: cat.languages.clone(),
                language_count: cat.language_count,
                speed_score: cat.speed_score,
                accuracy_score: cat.accuracy_score,
                parameters: cat.parameters.clone(),
                recommended: cat.recommended,
                supports_translation: cat.supports_translation,
                supports_language_detect: cat.supports_language_detect,
                installed,
                path: path_str,
                is_downloading: effective_downloading,
                partial_bytes,
                is_custom: false,
                source: "catalog".to_string(),
                origin: Some("Tempo".to_string()),
                deletable: Some(true),
                streaming: Some(is_streaming),
            });
        }
        // Silero VAD catalog entry
        let silero_installed_path = self.installed_path(SILERO_VAD_MODEL_ID);
        let silero_installed = silero_installed_path.is_some();
        if let Some(p) = &silero_installed_path {
            seen_paths.insert(fs::canonicalize(p).unwrap_or_else(|_| p.clone()));
        }
        // `active` is the guard taken at the top of this function: taking the
        // same mutex again here deadlocks, because a tokio Mutex is not reentrant.
        let (silero_is_downloading, silero_partial_bytes) = {
            if let Some(dl) = active.get(SILERO_VAD_MODEL_ID) {
                let p = dl.progress.lock().await;
                (true, p.received)
            } else {
                let part = self.models_dir.join(format!("{}.part", SILERO_VAD_FILENAME));
                let partial = part.metadata().map(|m| m.len()).unwrap_or(0);
                (false, partial)
            }
        };

        results.push(ModelInfo {
            id: SILERO_VAD_MODEL_ID.to_string(),
            name: "Silero VAD".to_string(),
            engine: "onnx".to_string(),
            description: "Neural Voice Activity Detection (Silero v4 ONNX)".to_string(),
            filename: SILERO_VAD_FILENAME.to_string(),
            quant: "ONNX".to_string(),
            quants: vec!["ONNX".to_string()],
            bytes: SILERO_VAD_SIZE_BYTES,
            sha256: Some(SILERO_VAD_SHA256.to_string()),
            revision: Some("v4.0".to_string()),
            languages: Vec::new(),
            language_count: 0,
            speed_score: 0.99,
            accuracy_score: 0.95,
            parameters: "4.2M".to_string(),
            recommended: false,
            supports_translation: false,
            supports_language_detect: false,
            installed: silero_installed,
            path: silero_installed_path.map(|p| p.to_string_lossy().to_string()),
            is_downloading: silero_is_downloading,
            partial_bytes: silero_partial_bytes,
            is_custom: false,
            source: "catalog".to_string(),
            origin: Some("Tempo".to_string()),
            deletable: Some(true),
            streaming: Some(false),
        });
        // Both spellings the Silero file has shipped under; discovery must not
        // report them as custom models.
        seen_filenames.insert(SILERO_VAD_FILENAME.to_string(), SILERO_VAD_MODEL_ID.to_string());
        seen_filenames.insert("silero_vad_v4.onnx".to_string(), SILERO_VAD_MODEL_ID.to_string());


        // 2. Discover custom models in models_dir (*.gguf, *.bin not in catalog)
        if let Ok(entries) = fs::read_dir(&self.models_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }

                let filename = match path.file_name().and_then(|f| f.to_str()) {
                    Some(name) => name.to_string(),
                    None => continue,
                };

                // Skip partial download files and catalog files
                if filename.ends_with(".part") || seen_filenames.contains_key(&filename) {
                    continue;
                }

                let is_model_ext = filename.ends_with(".gguf") || filename.ends_with(".bin");
                if !is_model_ext {
                    continue;
                }

                let canonical = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
                if seen_paths.contains(&canonical) {
                    continue;
                }
                seen_paths.insert(canonical);
                let size = path.metadata().map(|m| m.len()).unwrap_or(0);
                let stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&filename);

                let id = stem.to_string();
                let name = clean_custom_name(stem);
                let quant = extract_quant(stem);
                let is_streaming = stem.to_lowercase().contains("streaming");

                results.push(ModelInfo {
                    id,
                    name,
                    engine: "whisper".to_string(),
                    description: "Custom local model".to_string(),
                    filename: filename.clone(),
                    quant: quant.clone(),
                    quants: vec![quant],
                    bytes: size,
                    sha256: None,
                    revision: None,
                    languages: vec!["multilingual".to_string()],
                    language_count: 0,
                    speed_score: 0.5,
                    accuracy_score: 0.5,
                    parameters: "Custom".to_string(),
                    recommended: false,
                    supports_translation: true,
                    supports_language_detect: true,
                    installed: true,
                    path: Some(path.to_string_lossy().to_string()),
                    is_downloading: false,
                    partial_bytes: 0,
                    is_custom: true,
                    source: "custom".to_string(),
                    origin: Some("Tempo".to_string()),
                    deletable: Some(true),
                    streaming: Some(is_streaming),
                });
            }
        }

        // 3. Scan external caches: HF cache in priority order, then Handy models dir
        self.scan_detected_models(&mut results, &mut seen_paths, &seen_filenames);

        results
    }

    fn scan_detected_models(
        &self,
        results: &mut Vec<ModelInfo>,
        seen_paths: &mut HashSet<PathBuf>,
        seen_filenames: &HashMap<String, String>,
    ) {
        let hf_caches = get_hf_cache_dirs(&self.extra_cache_dirs);
        for cache_dir in hf_caches {
            scan_hf_cache(&cache_dir, results, seen_paths, seen_filenames);
        }

        let handy_dirs = get_handy_models_dirs();
        for handy_dir in handy_dirs {
            scan_handy_dir(&handy_dir, results, seen_paths, seen_filenames);
        }
    }

    fn find_in_detected_caches(&self, target: &str) -> Option<PathBuf> {
        let trimmed = target.trim();
        if trimmed.is_empty() {
            return None;
        }

        let cat_opt = catalog::find(trimmed);

        // 1. Scan HF caches
        let hf_caches = get_hf_cache_dirs(&self.extra_cache_dirs);
        for cache_dir in hf_caches {
            if !cache_dir.is_dir() {
                continue;
            }
            let Ok(entries) = fs::read_dir(&cache_dir) else { continue; };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() { continue; }
                let folder_name = entry.file_name().to_string_lossy().to_string();
                let repo_id = if let Some(rest) = folder_name.strip_prefix("models--") {
                    rest.replace("--", "/")
                } else if path.join("snapshots").is_dir() {
                    folder_name.replace("--", "/")
                } else {
                    continue;
                };

                let snapshots_dir = path.join("snapshots");
                if !snapshots_dir.is_dir() { continue; }
                let Ok(snap_entries) = fs::read_dir(&snapshots_dir) else { continue; };
                for snap_entry in snap_entries.flatten() {
                    let rev_path = snap_entry.path();
                    if !rev_path.is_dir() { continue; }
                    let Ok(files) = fs::read_dir(&rev_path) else { continue; };
                    for file_entry in files.flatten() {
                        let file_path = file_entry.path();
                        if !file_path.is_file() { continue; }
                        let fname = file_entry.file_name().to_string_lossy().to_string();
                        if !fname.ends_with(".gguf") { continue; }

                        if matches_model_target(&file_path, &fname, Some(&repo_id), trimmed, cat_opt) {
                            return Some(file_path);
                        }
                    }
                }
            }
        }

        // 2. Scan Handy directory
        let handy_dirs = get_handy_models_dirs();
        for handy_dir in handy_dirs {
            if !handy_dir.is_dir() { continue; }
            let Ok(entries) = fs::read_dir(&handy_dir) else { continue; };
            for entry in entries.flatten() {
                let file_path = entry.path();
                if !file_path.is_file() { continue; }
                let fname = entry.file_name().to_string_lossy().to_string();

                if matches_model_target(&file_path, &fname, None, trimmed, cat_opt) {
                    return Some(file_path);
                }
            }
        }

        None
    }

    /// Resolves the on-disk file path for an installed model.
    pub fn installed_path(&self, model_id: &str) -> Option<PathBuf> {
        let trimmed = model_id.trim();
        if trimmed.is_empty() {
            return None;
        }

        if trimmed.eq_ignore_ascii_case(SILERO_VAD_MODEL_ID) || trimmed.eq_ignore_ascii_case("silero_vad") {
            let p1 = self.models_dir.join(SILERO_VAD_FILENAME);
            if p1.is_file() {
                return Some(p1);
            }
            let p2 = self.models_dir.join("silero_vad_v4.onnx");
            if p2.is_file() {
                return Some(p2);
            }
        }
        // 1. If catalog model, check its files or archive directory in priority order
        if let Some(cat) = catalog::find(trimmed) {
            if cat.engine != "whisper" || cat.archive.is_some() {
                let p = self.models_dir.join(&cat.filename);
                if p.is_dir() && p.join(".complete").is_file() {
                    return Some(p);
                }
            } else {
                if let Some(def_file) = catalog::default_file(cat) {
                    let p = self.models_dir.join(&def_file.filename);
                    if p.is_file() {
                        return Some(p);
                    }
                }
                for f in &cat.files {
                    let p = self.models_dir.join(&f.filename);
                    if p.is_file() {
                        return Some(p);
                    }
                }
            }
        }
        // 2. Direct path check in models_dir
        let candidates = [
            self.models_dir.join(trimmed),
            self.models_dir.join(format!("{trimmed}.gguf")),
            self.models_dir.join(format!("{trimmed}.bin")),
        ];
        let dir_cand = self.models_dir.join(trimmed);
        if dir_cand.is_dir() && dir_cand.join(".complete").is_file() {
            return Some(dir_cand);
        }

        for cand in candidates {
            if cand.is_file() {
                return Some(cand);
            }
        }

        // 3. Scan directory for matching stem
        if let Ok(entries) = fs::read_dir(&self.models_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        if stem.eq_ignore_ascii_case(trimmed) {
                            return Some(path);
                        }
                    }
                }
            }
        }
        // 4. Scan detected caches
        if let Some(p) = self.find_in_detected_caches(trimmed) {
            return Some(p);
        }

        None
    }

    /// Starts a resumable model download in the background.
    pub async fn start_download(
        &self,
        model_id: &str,
        quant: Option<String>,
    ) -> Result<(), String> {
        let (filename, size_bytes, sha256_val, urls, is_archive, engine_name) = if model_id.eq_ignore_ascii_case(SILERO_VAD_MODEL_ID) {
            (
                SILERO_VAD_FILENAME.to_string(),
                SILERO_VAD_SIZE_BYTES,
                Some(SILERO_VAD_SHA256.to_string()),
                SILERO_VAD_URLS.iter().map(|s| s.to_string()).collect(),
                false,
                "onnx".to_string(),
            )
        } else {
            let cat = catalog::find(model_id)
                .ok_or_else(|| format!("no_model: Model '{model_id}' not found in catalog"))?;

            let quant_file = if let Some(q) = quant {
                cat.files
                    .iter()
                    .find(|f| f.quant.eq_ignore_ascii_case(&q))
                    .ok_or_else(|| format!("no_model: Quant '{q}' not found for model '{model_id}'"))?
            } else {
                catalog::default_file(cat)
                    .ok_or_else(|| format!("no_model: No quant files available for model '{model_id}'"))?
            };
            (
                quant_file.filename.clone(),
                quant_file.size_bytes,
                quant_file.sha256.clone(),
                catalog::download_urls(cat, quant_file),
                cat.engine != "whisper" || cat.archive.is_some(),
                cat.engine.clone(),
            )
        };

        if self.installed_path(model_id).is_some() {
            return Ok(());
        }

        // Check available disk space
        let free_space = check_disk_space(&self.models_dir).unwrap_or(u64::MAX);
        if free_space < size_bytes {
            let err = format!(
                "disk_full: Not enough disk space. Required: {} MB, available: {} MB",
                size_bytes / (1024 * 1024),
                free_space / (1024 * 1024)
            );
            self.emit_event(
                "stt://model-failed",
                serde_json::json!({ "modelId": model_id, "error": err }),
            );
            return Err(err);
        }

        let cancel = Arc::new(AtomicBool::new(false));
        let progress = Arc::new(Mutex::new(DownloadProgress {
            model_id: model_id.to_string(),
            received: 0,
            total: size_bytes,
            percentage: 0.0,
            speed_bps: 0.0,
            eta_secs: None,
            phase: "downloading".to_string(),
            error: None,
        }));

        let active_dl = Arc::new(ActiveDownload {
            model_id: model_id.to_string(),
            cancel: Arc::clone(&cancel),
            progress: Arc::clone(&progress),
        });

        {
            let mut active = self.active_downloads.lock().await;
            active.insert(model_id.to_string(), Arc::clone(&active_dl));
        }

        let partial_path = self.models_dir.join(format!("{}.part", filename));
        let expected_size = size_bytes;
        let expected_sha256 = sha256_val;
        let model_id_owned = model_id.to_string();

        let app_handle_arc = Arc::clone(&self.app_handle);
        let active_downloads_arc = Arc::clone(&self.active_downloads);

        tokio::spawn(async move {
            let last_emit = std::sync::Mutex::new(Instant::now());
            let start_time = Instant::now();

            let progress_cb = Arc::clone(&progress);
            let app_cb = Arc::clone(&app_handle_arc);
            let model_id_cb = model_id_owned.clone();

            let on_progress = move |received: u64, total: u64| {
                let now = Instant::now();
                let elapsed = start_time.elapsed().as_secs_f64();
                let speed = if elapsed > 0.0 { (received as f64) / elapsed } else { 0.0 };
                let eta = if speed > 0.0 && total > received {
                    Some(((total - received) as f64 / speed) as u64)
                } else {
                    None
                };
                let pct = if total > 0 {
                    ((received as f64 / total as f64) * 100.0).clamp(0.0, 100.0)
                } else {
                    0.0
                };

                if let Ok(mut p) = progress_cb.try_lock() {
                    p.received = received;
                    p.total = total;
                    p.percentage = pct;
                    p.speed_bps = speed;
                    p.eta_secs = eta;
                    p.phase = "downloading".to_string();
                }

                if let Ok(mut last) = last_emit.try_lock() {
                    if last.elapsed() >= PROGRESS_EMIT_THROTTLE {
                        *last = now;
                        if let Ok(guard) = app_cb.try_lock() {
                            if let Some(app) = guard.as_ref() {
                                let _ = app.emit("stt://model-progress", serde_json::json!({
                                    "modelId": model_id_cb,
                                    "received": received,
                                    "total": total,
                                    "percentage": pct,
                                    "speedBps": speed,
                                    "etaSecs": eta,
                                }));
                            }
                        }
                    }
                }
            };

            let outcome = download_resumable(
                &urls,
                &partial_path,
                Some(expected_size),
                expected_sha256.as_deref(),
                &cancel,
                &on_progress,
            ).await;

            {
                let mut active = active_downloads_arc.lock().await;
                active.remove(&model_id_owned);
            }

            match outcome {
                Ok(DownloadOutcome::Completed) => {
                    let final_path = if is_archive {
                        let target_dir = partial_path.with_extension("");
                        if let Err(e) = extract_archive_safe(&partial_path, &target_dir) {
                            let err_msg = format!("extract_error: Failed to extract archive: {e}");
                            eprintln!("[stt/models] {err_msg}");
                            let _ = fs::remove_file(&partial_path);
                            if let Ok(guard) = app_handle_arc.try_lock() {
                                if let Some(app) = guard.as_ref() {
                                    let _ = app.emit("stt://model-failed", serde_json::json!({
                                        "modelId": model_id_owned,
                                        "error": err_msg,
                                    }));
                                }
                            }
                            return;
                        }
                        if let Err(e) = verify_model_files(&target_dir, &engine_name) {
                            let err_msg = format!("verify_error: Model verification failed: {e}");
                            eprintln!("[stt/models] {err_msg}");
                            let _ = fs::remove_dir_all(&target_dir);
                            let _ = fs::remove_file(&partial_path);
                            if let Ok(guard) = app_handle_arc.try_lock() {
                                if let Some(app) = guard.as_ref() {
                                    let _ = app.emit("stt://model-failed", serde_json::json!({
                                        "modelId": model_id_owned,
                                        "error": err_msg,
                                    }));
                                }
                            }
                            return;
                        }
                        if let Err(e) = fs::write(target_dir.join(".complete"), "ok") {
                            let err_msg = format!("fs_error: Failed to write marker: {e}");
                            eprintln!("[stt/models] {err_msg}");
                            if let Ok(guard) = app_handle_arc.try_lock() {
                                if let Some(app) = guard.as_ref() {
                                    let _ = app.emit("stt://model-failed", serde_json::json!({
                                        "modelId": model_id_owned,
                                        "error": err_msg,
                                    }));
                                }
                            }
                            return;
                        }
                        let _ = fs::remove_file(&partial_path);
                        target_dir
                    } else {
                        let final_file = partial_path.with_extension("");
                        if let Err(e) = fs::rename(&partial_path, &final_file) {
                            let err_msg = format!("fs_error: Failed to rename partial file: {e}");
                            eprintln!("[stt/models] {err_msg}");
                            if let Ok(guard) = app_handle_arc.try_lock() {
                                if let Some(app) = guard.as_ref() {
                                    let _ = app.emit("stt://model-failed", serde_json::json!({
                                        "modelId": model_id_owned,
                                        "error": err_msg,
                                    }));
                                }
                            }
                            return;
                        }
                        final_file
                    };
                    if let Ok(mut p) = progress.try_lock() {
                        p.percentage = 100.0;
                        p.phase = "done".to_string();
                    }
                    if let Ok(guard) = app_handle_arc.try_lock() {
                        if let Some(app) = guard.as_ref() {
                            let _ = app.emit("stt://model-ready", serde_json::json!({
                                "modelId": model_id_owned,
                                "path": final_path.to_string_lossy(),
                            }));
                        }
                    }
                }
                Ok(DownloadOutcome::Cancelled) => {
                    if let Ok(mut p) = progress.try_lock() {
                        p.phase = "cancelled".to_string();
                    }
                }
                Err(e) => {
                    if let Ok(mut p) = progress.try_lock() {
                        p.phase = "error".to_string();
                        p.error = Some(e.clone());
                    }
                    if let Ok(guard) = app_handle_arc.try_lock() {
                        if let Some(app) = guard.as_ref() {
                            let _ = app.emit("stt://model-failed", serde_json::json!({
                                "modelId": model_id_owned,
                                "error": e,
                            }));
                        }
                    }
                }
            }
        });

        Ok(())
    }

    /// Cancels an active download for the given model ID.
    pub async fn cancel_download(&self, model_id: &str) -> Result<(), String> {
        let active = self.active_downloads.lock().await;
        if let Some(dl) = active.get(model_id) {
            dl.cancel.store(true, Ordering::SeqCst);
            if let Ok(mut lock) = dl.progress.try_lock() {
                lock.phase = "cancelled".to_string();
            }
            Ok(())
        } else {
            Ok(())
        }
    }

    /// Deletes all installed files and partial downloads for a model.
    pub fn delete(&self, model_id: &str) -> Result<(), String> {
        let mut deleted = false;

        if model_id.eq_ignore_ascii_case(SILERO_VAD_MODEL_ID) {
            let p1 = self.models_dir.join(SILERO_VAD_FILENAME);
            if p1.is_file() {
                fs::remove_file(p1).map_err(|e| format!("delete_error: {e}"))?;
            }
            let p2 = self.models_dir.join(format!("{}.part", SILERO_VAD_FILENAME));
            if p2.is_file() {
                let _ = fs::remove_file(p2);
            }
            return Ok(());
        }

        // If catalog model, delete its quant files
        if let Some(cat) = catalog::find(model_id) {
            for f in &cat.files {
                let target = self.models_dir.join(&f.filename);
                let partial = self.models_dir.join(format!("{}.part", f.filename));
                if target.is_file() {
                    let _ = fs::remove_file(target);
                    deleted = true;
                }
                if partial.is_file() {
                    let _ = fs::remove_file(partial);
                    deleted = true;
                }
            }
        }

        // Also check direct match
        let direct_candidates = [
            self.models_dir.join(model_id),
            self.models_dir.join(format!("{model_id}.gguf")),
            self.models_dir.join(format!("{model_id}.bin")),
            self.models_dir.join(format!("{model_id}.part")),
        ];

        for cand in direct_candidates {
            if cand.is_file() {
                let _ = fs::remove_file(cand);
                deleted = true;
            }
        }

        if deleted {
            self.emit_event("stt://models-updated", serde_json::json!({}));
        }

        Ok(())
    }

    /// Rescans the models directory and emits models-updated event.
    pub async fn rescan(&self) -> Result<Vec<ModelInfo>, String> {
        let list = self.list().await;
        self.emit_event("stt://models-updated", serde_json::json!({}));
        Ok(list)
    }

    /// Imports a user-supplied `.gguf` or `.bin` model file into the models directory.
    pub fn import_file(&self, path_str: &str) -> Result<ModelInfo, String> {
        let src_path = Path::new(path_str);
        if !src_path.is_file() {
            return Err(format!("import_failed: Source file '{path_str}' not found"));
        }

        let filename = src_path
            .file_name()
            .and_then(|f| f.to_str())
            .ok_or_else(|| "import_failed: Invalid filename".to_string())?;

        let is_valid_ext = filename.ends_with(".gguf") || filename.ends_with(".bin");
        if !is_valid_ext {
            return Err("import_failed: Model file must have .gguf or .bin extension".to_string());
        }

        fs::create_dir_all(&self.models_dir)
            .map_err(|e| format!("import_failed: Failed to create models directory: {e}"))?;

        let dest_path = self.models_dir.join(filename);
        if src_path != dest_path {
            fs::copy(src_path, &dest_path)
                .map_err(|e| format!("import_failed: Failed to copy model file: {e}"))?;
        }

        let size = dest_path.metadata().map(|m| m.len()).unwrap_or(0);
        let stem = dest_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(filename);

        let id = stem.to_string();
        let name = clean_custom_name(stem);
        let quant = extract_quant(stem);

        let info = ModelInfo {
            id,
            name,
            engine: "whisper".to_string(),
            description: "Custom local model".to_string(),
            filename: filename.to_string(),
            quant: quant.clone(),
            quants: vec![quant],
            bytes: size,
            sha256: None,
            revision: None,
            languages: vec!["multilingual".to_string()],
            language_count: 0,
            speed_score: 0.5,
            accuracy_score: 0.5,
            parameters: "Custom".to_string(),
            recommended: false,
            supports_translation: true,
            supports_language_detect: true,
            installed: true,
            path: Some(dest_path.to_string_lossy().to_string()),
            is_downloading: false,
            partial_bytes: 0,
            is_custom: true,
            source: "custom".to_string(),
            origin: Some("Tempo".to_string()),
            deletable: Some(true),
            streaming: Some(stem.to_lowercase().contains("streaming")),
        };
        self.emit_event("stt://models-updated", serde_json::json!({}));
        Ok(info)
    }

    /// Snapshot of all currently active download progress.
    pub async fn progress(&self) -> Vec<DownloadProgress> {
        let active = self.active_downloads.lock().await;
        let mut list = Vec::with_capacity(active.len());
        for dl in active.values() {
            list.push(dl.progress.lock().await.clone());
        }
        list
    }
}

// ---------------------------------------------------------------------------
// Pure, Testable Helper Functions
// ---------------------------------------------------------------------------

/// Parses the start byte from a `Content-Range: bytes <start>-<end>/<total>` header.
pub(crate) fn parse_content_range_start(value: &str) -> Option<u64> {
    let trimmed = value.trim();
    let range = trimmed.strip_prefix("bytes")?.trim_start();
    let first_token = range.split('-').next()?.trim();
    if first_token.is_empty() {
        return None;
    }
    first_token.parse().ok()
}

/// Verifies that a file's SHA-256 matches the expected hex hash, reading in 64 KiB chunks.
pub(crate) fn verify_sha256(path: &Path, expected: &str) -> Result<(), String> {
    let mut file = File::open(path)
        .map_err(|e| format!("Failed to open file for sha256 check: {e}"))?;

    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024]; // 64 KiB buffer

    loop {
        let n = file
            .read(&mut buffer)
            .map_err(|e| format!("Error reading file during sha256 check: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    let actual = format!("{:x}", hasher.finalize());
    let expected_trimmed = expected.trim();

    if actual.eq_ignore_ascii_case(expected_trimmed) {
        Ok(())
    } else {
        Err(format!(
            "sha256 mismatch: expected {}, got {}",
            expected_trimmed, actual
        ))
    }
}

/// Checks available free disk space on the drive holding `path`.
pub fn check_disk_space(path: &Path) -> Result<u64, String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

        let check_path = if path.exists() {
            path.to_path_buf()
        } else {
            path.parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| PathBuf::from("."))
        };

        let wide: Vec<u16> = check_path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut free_bytes_available: u64 = 0;
        let mut total_number_of_bytes: u64 = 0;
        let mut total_number_of_free_bytes: u64 = 0;

        let ret = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut free_bytes_available,
                &mut total_number_of_bytes,
                &mut total_number_of_free_bytes,
            )
        };

        if ret != 0 {
            Ok(free_bytes_available)
        } else {
            Ok(u64::MAX)
        }
    }

    #[cfg(not(windows))]
    {
        Ok(u64::MAX)
    }
}

/// Executes a resumable download across a list of URLs (primary HF then fallback mirrors).
pub(crate) async fn download_resumable(
    urls: &[String],
    partial: &Path,
    expected_size: Option<u64>,
    expected_sha256: Option<&str>,
    cancel: &AtomicBool,
    on_progress: &(dyn Fn(u64, u64) + Send + Sync),
) -> Result<DownloadOutcome, String> {
    if urls.is_empty() {
        return Err("network_error: No download URLs provided".to_string());
    }

    let client = reqwest::Client::builder()
        .connect_timeout(HTTP_CONNECT_TIMEOUT)
        .build()
        .map_err(|e| format!("network_error: Failed to initialize HTTP client: {e}"))?;

    let mut last_error = "network_error: Download failed".to_string();

    for url in urls {
        if cancel.load(Ordering::SeqCst) {
            return Ok(DownloadOutcome::Cancelled);
        }

        match download_one_url(
            &client,
            url,
            partial,
            expected_size,
            expected_sha256,
            cancel,
            on_progress,
        )
        .await
        {
            Ok(outcome) => return Ok(outcome),
            Err(e) => {
                eprintln!("[stt/models] Download attempt failed for URL '{}': {e}", url);
                last_error = e;
            }
        }
    }

    Err(last_error)
}

async fn download_one_url(
    client: &reqwest::Client,
    url: &str,
    partial_path: &Path,
    expected_size: Option<u64>,
    expected_sha256: Option<&str>,
    cancel: &AtomicBool,
    on_progress: &(dyn Fn(u64, u64) + Send + Sync),
) -> Result<DownloadOutcome, String> {
    let mut resume_from = if partial_path.is_file() {
        partial_path.metadata().map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };

    // If partial file is already full size, verify hash immediately
    if let (Some(expected), Some(sha)) = (expected_size, expected_sha256) {
        if resume_from == expected {
            if verify_sha256(partial_path, sha).is_ok() {
                on_progress(expected, expected);
                return Ok(DownloadOutcome::Completed);
            } else {
                let _ = fs::remove_file(partial_path);
                resume_from = 0;
            }
        } else if resume_from > expected {
            let _ = fs::remove_file(partial_path);
            resume_from = 0;
        }
    }

    let mut request = client.get(url);
    if resume_from > 0 {
        request = request.header("Range", format!("bytes={resume_from}-"));
    }

    let response = tokio::select! {
        resp = tokio::time::timeout(DOWNLOAD_STALL_TIMEOUT, request.send()) => {
            match resp {
                Ok(Ok(r)) => r,
                Ok(Err(e)) => return Err(format!("network_error: HTTP request failed: {e}")),
                Err(_) => return Err(format!("network_error: Connection timed out after {}s", DOWNLOAD_STALL_TIMEOUT.as_secs())),
            }
        }
        _ = async {
            while !cancel.load(Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        } => {
            return Ok(DownloadOutcome::Cancelled);
        }
    };

    let status = response.status();

    // 416 Range Not Satisfiable
    if resume_from > 0 && status == StatusCode::RANGE_NOT_SATISFIABLE {
        if let Some(sha) = expected_sha256 {
            if verify_sha256(partial_path, sha).is_ok() {
                if let Some(total) = expected_size {
                    on_progress(total, total);
                }
                return Ok(DownloadOutcome::Completed);
            }
        }
        let _ = fs::remove_file(partial_path);
        return Err("network_error: Server rejected range request (HTTP 416)".to_string());
    }

    // 200 OK when we requested a Range: server ignored range, so restart fresh
    if resume_from > 0 && status == StatusCode::OK {
        let _ = fs::remove_file(partial_path);
        resume_from = 0;
    }

    if !status.is_success() {
        return Err(format!("network_error: Server returned HTTP {status}"));
    }

    // On 206 Partial Content, verify start offset matches resume_from
    if resume_from > 0 && status == StatusCode::PARTIAL_CONTENT {
        let starts_at = response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(parse_content_range_start);

        if starts_at != Some(resume_from) {
            let _ = fs::remove_file(partial_path);
            return Err(format!(
                "network_error: Content-Range offset mismatch (expected {resume_from}, got {starts_at:?})"
            ));
        }
    }

    let total_size = expected_size.unwrap_or_else(|| {
        response
            .content_length()
            .map(|l| resume_from + l)
            .unwrap_or(0)
    });

    let mut file = if resume_from > 0 {
        OpenOptions::new()
            .append(true)
            .open(partial_path)
            .map_err(|e| format!("Failed to open partial file for append: {e}"))?
    } else {
        File::create(partial_path)
            .map_err(|e| format!("Failed to create partial file: {e}"))?
    };

    let mut downloaded = resume_from;
    on_progress(downloaded, total_size);

    let mut stream = response.bytes_stream();

    loop {
        if cancel.load(Ordering::SeqCst) {
            return Ok(DownloadOutcome::Cancelled);
        }

        let chunk = tokio::select! {
            next_item = tokio::time::timeout(DOWNLOAD_STALL_TIMEOUT, stream.next()) => {
                match next_item {
                    Ok(Some(Ok(bytes))) => bytes,
                    Ok(Some(Err(e))) => return Err(format!("network_error: Stream chunk read failed: {e}")),
                    Ok(None) => break, // Stream finished
                    Err(_) => return Err(format!("network_error: Stream stalled: no bytes for {}s", DOWNLOAD_STALL_TIMEOUT.as_secs())),
                }
            }
            _ = async {
                while !cancel.load(Ordering::SeqCst) {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            } => {
                return Ok(DownloadOutcome::Cancelled);
            }
        };

        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write chunk to disk: {e}"))?;

        downloaded += chunk.len() as u64;
        on_progress(downloaded, total_size);
    }

    file.flush()
        .map_err(|e| format!("Failed to flush file to disk: {e}"))?;
    drop(file);

    if total_size > 0 && downloaded < total_size {
        return Err(format!(
            "network_error: Incomplete download (received {downloaded}, expected {total_size})"
        ));
    }

    Ok(DownloadOutcome::Completed)
}

fn matches_model_target(
    file_path: &Path,
    fname: &str,
    repo_id: Option<&str>,
    trimmed: &str,
    cat_opt: Option<&catalog::CatalogModel>,
) -> bool {
    let stem = file_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    if fname.eq_ignore_ascii_case(trimmed)
        || stem.eq_ignore_ascii_case(trimmed)
        || trimmed.ends_with(fname)
    {
        return true;
    }
    if let Some(repo) = repo_id {
        if format!("{repo}/{fname}").eq_ignore_ascii_case(trimmed) {
            return true;
        }
    }
    if let Some(cat) = cat_opt {
        if cat.files.iter().any(|f| f.filename.eq_ignore_ascii_case(fname)) {
            return true;
        }
    }
    false
}

pub fn get_hf_cache_dirs(extra_dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    // 1. %HF_HOME% (and %HF_HOME%/hub)
    if let Ok(hf_home) = std::env::var("HF_HOME") {
        let p = PathBuf::from(&hf_home);
        let hub = p.join("hub");
        if hub.is_dir() {
            dirs.push(hub);
        }
        if p.is_dir() {
            dirs.push(p);
        }
    }

    // 2. %HUGGINGFACE_HUB_CACHE%
    if let Ok(hub_cache) = std::env::var("HUGGINGFACE_HUB_CACHE") {
        let p = PathBuf::from(hub_cache);
        if p.is_dir() {
            dirs.push(p);
        }
    }

    // 3. %USERPROFILE%\.cache\huggingface\hub or $HOME/.cache/huggingface/hub
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let p = PathBuf::from(profile).join(".cache").join("huggingface").join("hub");
        if p.is_dir() {
            dirs.push(p);
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let p = PathBuf::from(home).join(".cache").join("huggingface").join("hub");
        if p.is_dir() {
            dirs.push(p);
        }
    }

    // 4. Non-standard install caches:
    for env_var in &["BUN_INSTALL_CACHE_DIR", "UV_CACHE_DIR"] {
        if let Ok(val) = std::env::var(env_var) {
            let p = PathBuf::from(val);
            if let Some(parent) = p.parent() {
                let hf = parent.join(".cache").join("huggingface").join("hub");
                if hf.is_dir() {
                    dirs.push(hf);
                }
            }
        }
    }

    let non_standard = [
        PathBuf::from(r"D:\npm-global\.cache\huggingface\hub"),
        PathBuf::from(r"C:\npm-global\.cache\huggingface\hub"),
    ];
    for p in non_standard {
        if p.is_dir() {
            dirs.push(p);
        }
    }

    // 5. Extra dirs (from struct or testing)
    for p in extra_dirs {
        dirs.push(p.clone());
    }

    // Deduplicate cache directory paths
    let mut unique = Vec::new();
    let mut seen = HashSet::new();
    for d in dirs {
        let key = fs::canonicalize(&d).unwrap_or_else(|_| d.clone());
        if seen.insert(key) {
            unique.push(d);
        }
    }

    unique
}

pub fn get_handy_models_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        let p = PathBuf::from(appdata).join("com.pais.handy").join("models");
        if p.is_dir() {
            dirs.push(p);
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let p1 = PathBuf::from(&home).join(".config").join("com.pais.handy").join("models");
        if p1.is_dir() {
            dirs.push(p1);
        }
        let p2 = PathBuf::from(&home).join("Library").join("Application Support").join("com.pais.handy").join("models");
        if p2.is_dir() {
            dirs.push(p2);
        }
    }
    dirs
}

pub fn scan_hf_cache(
    cache_root: &Path,
    results: &mut Vec<ModelInfo>,
    seen_paths: &mut HashSet<PathBuf>,
    seen_filenames: &HashMap<String, String>,
) {
    if !cache_root.is_dir() {
        return;
    }

    let entries = match fs::read_dir(cache_root) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let folder_name = entry.file_name().to_string_lossy().to_string();
        let repo_id = if let Some(rest) = folder_name.strip_prefix("models--") {
            rest.replace("--", "/")
        } else if path.join("snapshots").is_dir() {
            folder_name.replace("--", "/")
        } else {
            continue;
        };

        let is_handy = repo_id.starts_with("handy-computer/") || repo_id.contains("handy");
        let origin = if is_handy { "Handy" } else { "HuggingFace cache" };

        let snapshots_dir = path.join("snapshots");
        if !snapshots_dir.is_dir() {
            continue;
        }

        let snap_entries = match fs::read_dir(&snapshots_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for snap_entry in snap_entries.flatten() {
            let rev_path = snap_entry.path();
            if !rev_path.is_dir() {
                continue;
            }
            let rev = snap_entry.file_name().to_string_lossy().to_string();

            let files = match fs::read_dir(&rev_path) {
                Ok(e) => e,
                Err(_) => continue,
            };

            for file_entry in files.flatten() {
                let file_path = file_entry.path();
                let filename = file_entry.file_name().to_string_lossy().to_string();

                if !filename.ends_with(".gguf") || filename.ends_with(".part") {
                    continue;
                }

                if !file_path.is_file() {
                    continue;
                }

                let canonical = fs::canonicalize(&file_path).unwrap_or_else(|_| file_path.clone());
                if seen_paths.contains(&canonical) {
                    continue;
                }

                // If catalog already accounts for this file:
                if let Some(cat_id) = seen_filenames.get(&filename) {
                    seen_paths.insert(canonical);
                    if let Some(cat_model) = results.iter_mut().find(|m| m.id == *cat_id) {
                        if !cat_model.installed {
                            cat_model.installed = true;
                            cat_model.path = Some(file_path.to_string_lossy().to_string());
                            cat_model.deletable = Some(false);
                            cat_model.origin = Some(origin.to_string());
                        }
                    }
                    continue;
                }

                // Avoid duplicate listing if already discovered
                if results.iter().any(|m| (m.filename == filename && m.source == "detected") || m.path.as_deref() == Some(file_path.to_str().unwrap_or(""))) {
                    seen_paths.insert(canonical);
                    continue;
                }

                seen_paths.insert(canonical);

                let size = file_path.metadata().map(|m| m.len()).unwrap_or(0);
                let stem = file_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&filename);

                let id = if results.iter().any(|m| m.id == stem) {
                    format!("{}/{}", repo_id, filename)
                } else {
                    stem.to_string()
                };

                let name = clean_custom_name(stem);
                let quant = extract_quant(stem);
                let stem_lower = stem.to_lowercase();
                let is_streaming = stem_lower.contains("streaming") || filename.to_lowercase().contains("streaming");

                let languages = if stem_lower.contains("nemotron") {
                    vec!["ru".to_string(), "en".to_string()]
                } else if stem_lower.contains("parakeet") {
                    vec!["en".to_string(), "ru".to_string()]
                } else if stem_lower.contains(".en") || stem_lower.contains("-en") {
                    vec!["en".to_string()]
                } else {
                    vec!["multilingual".to_string()]
                };
                let language_count = languages.len() as u32;

                let (speed_score, accuracy_score) = if stem_lower.contains("nemotron") {
                    (0.90, 0.92)
                } else if stem_lower.contains("parakeet") {
                    (0.95, 0.90)
                } else {
                    (0.70, 0.70)
                };

                let parameters = if stem.contains("0.6b") || stem.contains("0.6B") {
                    "0.6B".to_string()
                } else if stem.contains("0.5b") || stem.contains("0.5B") {
                    "0.5B".to_string()
                } else if stem.contains("1.5b") || stem.contains("1.5B") {
                    "1.5B".to_string()
                } else if stem.contains("tiny") {
                    "39M".to_string()
                } else if stem.contains("base") {
                    "74M".to_string()
                } else if stem.contains("small") {
                    "244M".to_string()
                } else if stem.contains("medium") {
                    "769M".to_string()
                } else if stem.contains("large") {
                    "1550M".to_string()
                } else {
                    "Unknown".to_string()
                };

                results.push(ModelInfo {
                    id,
                    name,
                    engine: "transcribecpp".to_string(),
                    description: format!("From HuggingFace cache: {}", repo_id),
                    filename: filename.clone(),
                    quant: quant.clone(),
                    quants: vec![quant],
                    bytes: size,
                    sha256: None,
                    revision: Some(rev.clone()),
                    languages,
                    language_count,
                    speed_score,
                    accuracy_score,
                    parameters,
                    recommended: false,
                    supports_translation: true,
                    supports_language_detect: true,
                    installed: true,
                    path: Some(file_path.to_string_lossy().to_string()),
                    is_downloading: false,
                    partial_bytes: 0,
                    is_custom: false,
                    source: "detected".to_string(),
                    origin: Some(origin.to_string()),
                    deletable: Some(false),
                    streaming: Some(is_streaming),
                });
            }
        }
    }
}

pub fn scan_handy_dir(
    handy_dir: &Path,
    results: &mut Vec<ModelInfo>,
    seen_paths: &mut HashSet<PathBuf>,
    seen_filenames: &HashMap<String, String>,
) {
    if !handy_dir.is_dir() {
        return;
    }

    let entries = match fs::read_dir(handy_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let file_path = entry.path();
        if !file_path.is_file() {
            continue;
        }

        let filename = entry.file_name().to_string_lossy().to_string();
        if (!filename.ends_with(".gguf") && !filename.ends_with(".bin")) || filename.ends_with(".part") {
            continue;
        }

        let canonical = fs::canonicalize(&file_path).unwrap_or_else(|_| file_path.clone());
        if seen_paths.contains(&canonical) {
            continue;
        }

        if let Some(cat_id) = seen_filenames.get(&filename) {
            seen_paths.insert(canonical);
            if let Some(cat_model) = results.iter_mut().find(|m| m.id == *cat_id) {
                if !cat_model.installed {
                    cat_model.installed = true;
                    cat_model.path = Some(file_path.to_string_lossy().to_string());
                    cat_model.deletable = Some(false);
                    cat_model.origin = Some("Handy".to_string());
                }
            }
            continue;
        }

        if results.iter().any(|m| (m.filename == filename && m.source == "detected") || m.path.as_deref() == Some(file_path.to_str().unwrap_or(""))) {
            seen_paths.insert(canonical);
            continue;
        }

        seen_paths.insert(canonical);

        let size = file_path.metadata().map(|m| m.len()).unwrap_or(0);
        let stem = file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&filename);

        let id = if results.iter().any(|m| m.id == stem) {
            format!("handy/{}", filename)
        } else {
            stem.to_string()
        };

        let name = clean_custom_name(stem);
        let quant = extract_quant(stem);
        let stem_lower = stem.to_lowercase();
        let is_streaming = stem_lower.contains("streaming") || filename.to_lowercase().contains("streaming");

        results.push(ModelInfo {
            id,
            name,
            engine: "transcribecpp".to_string(),
            description: "From Handy models directory".to_string(),
            filename: filename.clone(),
            quant: quant.clone(),
            quants: vec![quant],
            bytes: size,
            sha256: None,
            revision: None,
            languages: vec!["multilingual".to_string()],
            language_count: 0,
            speed_score: 0.70,
            accuracy_score: 0.70,
            parameters: "Custom".to_string(),
            recommended: false,
            supports_translation: true,
            supports_language_detect: true,
            installed: true,
            path: Some(file_path.to_string_lossy().to_string()),
            is_downloading: false,
            partial_bytes: 0,
            is_custom: false,
            source: "detected".to_string(),
            origin: Some("Handy".to_string()),
            deletable: Some(false),
            streaming: Some(is_streaming),
        });
    }
}

fn clean_custom_name(stem: &str) -> String {
    let clean = stem.replace(['-', '_'], " ");
    let mut words = Vec::new();
    for w in clean.split_whitespace() {
        let mut chars = w.chars();
        if let Some(first) = chars.next() {
            words.push(format!("{}{}", first.to_uppercase(), chars.as_str()));
        }
    }
    if words.is_empty() {
        stem.to_string()
    } else {
        words.join(" ")
    }
}

fn extract_quant(stem: &str) -> String {
    let upper = stem.to_uppercase();
    for q in [
        "Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "Q4_0", "Q4_1", "Q5_0", "Q5_1", "F16", "F32",
    ] {
        if upper.contains(q) {
            return q.to_string();
        }
    }
    "custom".to_string()
}

/// Extracts a .tar.gz archive safely into target_dir with zip-slip prevention.
pub fn extract_archive_safe(archive_path: &Path, target_dir: &Path) -> Result<(), String> {
    use flate2::read::GzDecoder;
    use tar::Archive;

    let tar_gz = File::open(archive_path)
        .map_err(|e| format!("Failed to open archive: {e}"))?;
    let tar = GzDecoder::new(tar_gz);
    let mut archive = Archive::new(tar);

    let temp_extract_dir = target_dir.with_extension("extracting");
    if temp_extract_dir.exists() {
        let _ = fs::remove_dir_all(&temp_extract_dir);
    }
    fs::create_dir_all(&temp_extract_dir)
        .map_err(|e| format!("Failed to create temp extract dir: {e}"))?;

    for entry_res in archive.entries().map_err(|e| format!("Corrupt tar archive: {e}"))? {
        let mut entry = entry_res.map_err(|e| format!("Failed to read archive entry: {e}"))?;
        let path = entry.path().map_err(|e| format!("Invalid path in archive: {e}"))?;

        // Zip-slip defense: reject any parent dir components or prefix/root escapes
        for comp in path.components() {
            if matches!(comp, std::path::Component::ParentDir | std::path::Component::Prefix(_)) {
                let _ = fs::remove_dir_all(&temp_extract_dir);
                return Err("zip_slip: Archive member path escapes target directory".to_string());
            }
        }
        if path.is_absolute() {
            let _ = fs::remove_dir_all(&temp_extract_dir);
            return Err("zip_slip: Archive member path is absolute".to_string());
        }

        let out_path = temp_extract_dir.join(&path);
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dirs: {e}"))?;
        }

        entry.unpack(&out_path).map_err(|e| {
            let _ = fs::remove_dir_all(&temp_extract_dir);
            format!("Failed to unpack entry: {e}")
        })?;
    }

    // Check for nested single directory (e.g. archive unpacked into moonshine-tiny-streaming-en/...)
    let subdirs: Vec<_> = fs::read_dir(&temp_extract_dir)
        .map_err(|e| format!("Failed to read temp dir: {e}"))?
        .filter_map(|e| e.ok())
        .filter(|e| {
            let fname = e.file_name();
            let name_str = fname.to_string_lossy();
            !name_str.starts_with("._") && !name_str.starts_with("__MACOSX")
        })
        .collect();

    let is_single_subdir = subdirs.len() == 1 && subdirs[0].file_type().map(|ft| ft.is_dir()).unwrap_or(false);

    if target_dir.exists() {
        let _ = fs::remove_dir_all(target_dir);
    }

    if is_single_subdir {
        let inner_dir = subdirs[0].path();
        fs::rename(&inner_dir, target_dir)
            .map_err(|e| format!("Failed to move extracted dir: {e}"))?;
        let _ = fs::remove_dir_all(&temp_extract_dir);
    } else {
        fs::rename(&temp_extract_dir, target_dir)
            .map_err(|e| format!("Failed to move temp extract dir: {e}"))?;
    }

    Ok(())
}

/// Verifies that all expected model files exist in the model directory.
pub fn verify_model_files(model_dir: &Path, engine: &str) -> Result<(), String> {
    match engine.to_ascii_lowercase().as_str() {
        "gigaam" => {
            let has_model = model_dir.join("model.int8.onnx").is_file()
                || model_dir.join("model.onnx").is_file();
            let has_vocab = model_dir.join("vocab.txt").is_file();
            if !has_model || !has_vocab {
                return Err(format!("gigaam model incomplete: model={has_model}, vocab={has_vocab}"));
            }
        }
        "sensevoice" => {
            let has_model = model_dir.join("model.int8.onnx").is_file()
                || model_dir.join("model.onnx").is_file();
            let has_tokens = model_dir.join("tokens.txt").is_file();
            if !has_model || !has_tokens {
                return Err(format!("sensevoice model incomplete: model={has_model}, tokens={has_tokens}"));
            }
        }
        "parakeet" => {
            let has_pre = model_dir.join("nemo128.onnx").is_file();
            let has_vocab = model_dir.join("vocab.txt").is_file();
            if !has_pre || !has_vocab {
                return Err(format!("parakeet model incomplete: nemo128={has_pre}, vocab={has_vocab}"));
            }
        }
        "canary" => {
            let has_pre = model_dir.join("nemo128.onnx").is_file();
            let has_vocab = model_dir.join("vocab.txt").is_file();
            if !has_pre || !has_vocab {
                return Err(format!("canary model incomplete: nemo128={has_pre}, vocab={has_vocab}"));
            }
        }
        "cohere" => {
            let has_vocab = model_dir.join("tokens.txt").is_file()
                || model_dir.join("vocabulary.txt").is_file();
            if !has_vocab {
                return Err("cohere model incomplete: tokens.txt missing".to_string());
            }
        }
        "moonshine" => {
            let has_cfg = model_dir.join("streaming_config.json").is_file();
            let has_tok = model_dir.join("tokenizer.json").is_file();
            if !has_cfg && !has_tok {
                return Err("moonshine model incomplete: neither streaming_config.json nor tokenizer.json found".to_string());
            }
        }
        _ => {}
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn parse_content_range_start_cases() {
        assert_eq!(parse_content_range_start("bytes 500-999/1000"), Some(500));
        assert_eq!(parse_content_range_start("bytes 0-499/1000"), Some(0));
        assert_eq!(parse_content_range_start("bytes 1048576-2097151/5242880"), Some(1048576));
        assert_eq!(parse_content_range_start("bytes 100-/*"), Some(100));

        // Malformed / invalid
        assert_eq!(parse_content_range_start("bytes */1000"), None);
        assert_eq!(parse_content_range_start("invalid-range"), None);
        assert_eq!(parse_content_range_start(""), None);
        assert_eq!(parse_content_range_start("bytes -500/1000"), None);
    }

    #[test]
    fn verify_sha256_match_and_mismatch() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test.bin");

        let content = b"hello tempo whisper speech recognition";
        fs::write(&file_path, content).unwrap();

        let mut hasher = Sha256::new();
        hasher.update(content);
        let expected_hash = format!("{:x}", hasher.finalize());

        assert!(verify_sha256(&file_path, &expected_hash).is_ok());

        // Mismatch
        let bad_hash = "0000000000000000000000000000000000000000000000000000000000000000";
        assert!(verify_sha256(&file_path, bad_hash).is_err());
    }

    #[test]
    fn check_disk_space_returns_valid_value() {
        let dir = tempdir().unwrap();
        let space = check_disk_space(dir.path()).expect("disk space check failed");
        assert!(space > 0);
    }

    #[tokio::test]
    async fn model_manager_list_merges_catalog_and_custom() {
        let dir = tempdir().unwrap();
        let models_dir = dir.path().to_path_buf();

        // Put a fake catalog model on disk: whisper-tiny-Q8_0.gguf
        let cat_file = models_dir.join("whisper-tiny-Q8_0.gguf");
        fs::write(&cat_file, b"dummy gguf bytes").unwrap();

        // Put a fake custom model on disk: my-custom-model-q4_k_m.gguf
        let custom_file = models_dir.join("my-custom-model-q4_k_m.gguf");
        fs::write(&custom_file, b"custom gguf bytes").unwrap();

        let mgr = ModelManager::new(models_dir);
        let list = mgr.list().await;

        // Must include all 13 catalog models
        assert!(list.len() >= 14, "expected at least 13 catalog + 1 custom");

        let tiny = list.iter().find(|m| m.id == "whisper-tiny").expect("whisper-tiny not found");
        assert!(tiny.installed);
        assert_eq!(tiny.source, "catalog");
        assert!(!tiny.is_custom);
        assert!(tiny.path.is_some());

        let custom = list.iter().find(|m| m.filename == "my-custom-model-q4_k_m.gguf")
            .expect("custom model not found");
        assert!(custom.installed);
        assert!(custom.is_custom);
        assert_eq!(custom.source, "custom");
        assert_eq!(custom.quant, "Q4_K_M");
    }

    #[tokio::test]
    async fn resumable_bookkeeping_and_import() {
        let dir = tempdir().unwrap();
        let models_dir = dir.path().to_path_buf();
        let mgr = ModelManager::new(models_dir.clone());

        // Create a separate file to import
        let import_src = dir.path().join("external-speech-model-Q8_0.gguf");
        fs::write(&import_src, b"imported model content").unwrap();

        let imported = mgr.import_file(import_src.to_str().unwrap()).expect("import failed");
        assert_eq!(imported.filename, "external-speech-model-Q8_0.gguf");
        assert!(imported.installed);
        assert!(imported.is_custom);

        // Verify it resolves in installed_path
        let resolved = mgr.installed_path(&imported.id).expect("should resolve installed path");
        assert!(resolved.is_file());

        // Test delete
        mgr.delete(&imported.id).expect("delete failed");
        assert!(mgr.installed_path(&imported.id).is_none());
    }

    #[test]
    fn test_zip_slip_rejection() {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        use tar::Builder;

        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("malicious.tar.gz");
        let dest_dir = dir.path().join("extracted");

        // Create a tar.gz with a path traversal entry "../evil.txt"
        {
            let f = File::create(&archive_path).unwrap();
            let gz = GzEncoder::new(f, Compression::default());
            let mut tar = Builder::new(gz);

            let mut header = tar::Header::new_gnu();
            header.as_mut_bytes()[..11].copy_from_slice(b"../evil.txt");
            header.set_size(12);
            header.set_cksum();
            tar.append(&header, &b"evil payload"[..]).unwrap();
            tar.finish().unwrap();
        }

        let res = extract_archive_safe(&archive_path, &dest_dir);
        assert!(res.is_err(), "Expected zip-slip error, got: {:?}", res);
        let err_msg = res.unwrap_err();
        assert!(err_msg.contains("zip_slip"), "Error message should mention zip_slip: {}", err_msg);
        assert!(!dir.path().join("evil.txt").exists(), "Evil file should NOT be written outside target dir");
    }

    #[tokio::test]
    async fn test_no_re_download_of_installed_model() {
        let dir = tempdir().unwrap();
        let models_dir = dir.path().to_path_buf();
        let mgr = ModelManager::new(models_dir.clone());

        // Fake an installed gigaam-v3 model directory with .complete marker
        let giga_dir = models_dir.join("giga-am-v3-int8");
        fs::create_dir_all(&giga_dir).unwrap();
        fs::write(giga_dir.join(".complete"), "ok").unwrap();

        // Verify installed_path finds it
        assert!(mgr.installed_path("gigaam-v3").is_some());

        // start_download should return Ok(()) immediately without downloading
        let res = mgr.start_download("gigaam-v3", None).await;
        assert!(res.is_ok());
        assert!(!models_dir.join("giga-am-v3-int8.part").exists(), "Should not create .part file for installed model");
    }

    #[tokio::test]
    async fn fake_hf_cache_discovered_with_origin_and_deletable_false() {
        let dir = tempdir().unwrap();
        let models_dir = dir.path().join("models");
        let fake_cache = dir.path().join("hf_cache");

        let repo = fake_cache.join("models--handy-computer--nemotron-test-streaming-0.6b-gguf");
        let snap = repo.join("snapshots").join("rev123");
        fs::create_dir_all(&snap).unwrap();
        let model_file = snap.join("nemotron-test-streaming-0.6b-Q8_0.gguf");
        fs::write(&model_file, b"fake nemotron model content").unwrap();

        let mgr = ModelManager::new(models_dir)
            .with_extra_caches(vec![fake_cache]);
        let list = mgr.list().await;

        let detected = list
            .iter()
            .find(|m| m.filename == "nemotron-test-streaming-0.6b-Q8_0.gguf")
            .expect("detected nemotron model not found");

        assert_eq!(detected.source, "detected");
        assert_eq!(detected.origin, Some("Handy".to_string()));
        assert_eq!(detected.deletable, Some(false));
        assert_eq!(detected.engine, "transcribecpp");
        assert!(detected.installed);
        assert_eq!(detected.streaming, Some(true));
        assert_eq!(detected.quant, "Q8_0");
        assert_eq!(
            detected.path,
            Some(model_file.to_string_lossy().to_string())
        );

        // Also verify installed_path resolves it
        let resolved = mgr
            .installed_path(&detected.id)
            .expect("should resolve detected model path");
        assert_eq!(resolved, model_file);
    }

    #[tokio::test]
    async fn same_file_reached_through_two_cache_paths_listed_once() {
        let dir = tempdir().unwrap();
        let models_dir = dir.path().join("models");
        let cache1 = dir.path().join("cache1");
        let cache2 = dir.path().join("cache2");

        let repo1 = cache1.join("models--handy-computer--parakeet-test-0.6b-v3-gguf");
        let snap1 = repo1.join("snapshots").join("rev1");
        fs::create_dir_all(&snap1).unwrap();
        let file1 = snap1.join("parakeet-test-0.6b-v3-Q8_0.gguf");
        fs::write(&file1, b"parakeet model bytes").unwrap();

        let repo2 = cache2.join("models--handy-computer--parakeet-test-0.6b-v3-gguf");
        let snap2 = repo2.join("snapshots").join("rev1");
        fs::create_dir_all(&snap2).unwrap();
        let file2 = snap2.join("parakeet-test-0.6b-v3-Q8_0.gguf");
        fs::write(&file2, b"parakeet model bytes").unwrap();

        let mgr = ModelManager::new(models_dir)
            .with_extra_caches(vec![cache1, cache2]);
        let list = mgr.list().await;

        let count = list
            .iter()
            .filter(|m| m.filename == "parakeet-test-0.6b-v3-Q8_0.gguf")
            .count();
        assert_eq!(count, 1, "model should only be listed once across two caches");
    }

    #[tokio::test]
    async fn missing_cache_does_not_error() {
        let dir = tempdir().unwrap();
        let models_dir = dir.path().join("models");
        let missing = dir.path().join("nonexistent_cache_folder");

        let mgr = ModelManager::new(models_dir).with_extra_caches(vec![missing]);
        let list = mgr.list().await;
        assert!(!list.is_empty(), "list should succeed even when cache dir is missing");
    }

    #[tokio::test]
    async fn detected_model_origin_huggingface_cache() {
        let dir = tempdir().unwrap();
        let models_dir = dir.path().join("models");
        let cache = dir.path().join("hf_cache");

        let repo = cache.join("models--some-org--custom-asr-gguf");
        let snap = repo.join("snapshots").join("rev99");
        fs::create_dir_all(&snap).unwrap();
        let model_file = snap.join("custom-asr-model-Q4_K_M.gguf");
        fs::write(&model_file, b"custom asr bytes").unwrap();

        let mgr = ModelManager::new(models_dir).with_extra_caches(vec![cache]);
        let list = mgr.list().await;

        let detected = list
            .iter()
            .find(|m| m.filename == "custom-asr-model-Q4_K_M.gguf")
            .expect("detected custom asr not found");

        assert_eq!(detected.source, "detected");
        assert_eq!(detected.origin, Some("HuggingFace cache".to_string()));
        assert_eq!(detected.deletable, Some(false));
        assert_eq!(detected.engine, "transcribecpp");
    }

    #[tokio::test]
    async fn catalog_model_not_double_listed_when_present_in_hf_cache() {
        let dir = tempdir().unwrap();
        let models_dir = dir.path().join("models");
        let cache = dir.path().join("hf_cache");

        // Put whisper-tiny default quant file in fake cache
        let repo = cache.join("models--handy-computer--whisper-tiny-gguf");
        let snap = repo.join("snapshots").join("rev_tiny");
        fs::create_dir_all(&snap).unwrap();
        let model_file = snap.join("whisper-tiny-Q8_0.gguf");
        fs::write(&model_file, b"whisper tiny bytes").unwrap();

        let mgr = ModelManager::new(models_dir).with_extra_caches(vec![cache]);
        let list = mgr.list().await;

        // Verify whisper-tiny is only listed once
        let tiny_matches: Vec<_> = list
            .iter()
            .filter(|m| m.id == "whisper-tiny" || m.filename == "whisper-tiny-Q8_0.gguf")
            .collect();
        assert_eq!(
            tiny_matches.len(),
            1,
            "whisper-tiny must not be double listed: {:?}",
            tiny_matches
        );

        let tiny = tiny_matches[0];
        assert!(tiny.installed);
        assert_eq!(tiny.source, "catalog");
        assert_eq!(tiny.origin, Some("Handy".to_string()));
        assert_eq!(tiny.deletable, Some(false));
        assert_eq!(
            tiny.path,
            Some(model_file.to_string_lossy().to_string())
        );
    }
}
