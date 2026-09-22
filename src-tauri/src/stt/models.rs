//! Model management, download orchestration, disk verification, and catalog resolution.
//!
//! Provides resumable downloads with HTTP Range requests, multi-mirror fallback,
//! streaming sha256 verification in 64 KiB chunks, disk space safety checks,
//! and unified listing across catalog, disk-cached, and custom GGUF models.

use std::collections::HashMap;
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
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
    pub source: String, // "catalog" | "custom"
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
        }
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

            let (chosen_file, installed, path_str) = match (installed_file, installed_path) {
                (Some(f), Some(p)) => (f, true, Some(p.to_string_lossy().to_string())),
                _ => (def_file.unwrap_or(&cat.files[0]), false, None),
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

            results.push(ModelInfo {
                id: cat.id.clone(),
                name: cat.name.clone(),
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
            });
        }

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

                let size = path.metadata().map(|m| m.len()).unwrap_or(0);
                let stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&filename);

                let id = stem.to_string();
                let name = clean_custom_name(stem);
                let quant = extract_quant(stem);

                results.push(ModelInfo {
                    id,
                    name,
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
                });
            }
        }

        results
    }

    /// Resolves the on-disk file path for an installed model.
    pub fn installed_path(&self, model_id: &str) -> Option<PathBuf> {
        let trimmed = model_id.trim();
        if trimmed.is_empty() {
            return None;
        }

        // 1. If catalog model, check its files in priority order
        if let Some(cat) = catalog::find(trimmed) {
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

        // 2. Direct path check in models_dir
        let candidates = [
            self.models_dir.join(trimmed),
            self.models_dir.join(format!("{trimmed}.gguf")),
            self.models_dir.join(format!("{trimmed}.bin")),
        ];

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

        None
    }

    /// Starts a resumable model download in the background.
    pub async fn start_download(
        &self,
        model_id: &str,
        quant: Option<String>,
    ) -> Result<(), String> {
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

        let target_path = self.models_dir.join(&quant_file.filename);
        if target_path.is_file() {
            return Ok(());
        }

        // Check available disk space
        let free_space = check_disk_space(&self.models_dir).unwrap_or(u64::MAX);
        if free_space < quant_file.size_bytes {
            let err = format!(
                "disk_full: Not enough disk space. Required: {} MB, available: {} MB",
                quant_file.size_bytes / (1024 * 1024),
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
            total: quant_file.size_bytes,
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

        let urls = catalog::download_urls(cat, quant_file);
        let partial_path = self.models_dir.join(format!("{}.part", quant_file.filename));
        let expected_size = quant_file.size_bytes;
        let expected_sha256 = quant_file.sha256.clone();
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
                let speed = if elapsed > 0.0 {
                    (received as f64) / elapsed
                } else {
                    0.0
                };
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

                let p = DownloadProgress {
                    model_id: model_id_cb.clone(),
                    received,
                    total,
                    percentage: pct,
                    speed_bps: speed,
                    eta_secs: eta,
                    phase: "downloading".to_string(),
                    error: None,
                };

                if let Ok(mut lock) = progress_cb.try_lock() {
                    *lock = p.clone();
                }

                let should_emit = if let Ok(mut guard) = last_emit.try_lock() {
                    if now.duration_since(*guard) >= PROGRESS_EMIT_THROTTLE || received == total {
                        *guard = now;
                        true
                    } else {
                        false
                    }
                } else {
                    false
                };

                if should_emit {
                    if let Ok(guard) = app_cb.try_lock() {
                        if let Some(app) = guard.as_ref() {
                            let _ = app.emit("stt://model-progress", &p);
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
            )
            .await;

            // Remove from active downloads
            {
                let mut active = active_downloads_arc.lock().await;
                active.remove(&model_id_owned);
            }

            let emit_failed = |phase: &str, err: &str| {
                if let Ok(mut lock) = progress.try_lock() {
                    lock.phase = phase.to_string();
                    lock.error = Some(err.to_string());
                }
                if let Ok(guard) = app_handle_arc.try_lock() {
                    if let Some(app) = guard.as_ref() {
                        let _ = app.emit(
                            "stt://model-failed",
                            serde_json::json!({ "modelId": model_id_owned, "error": err }),
                        );
                    }
                }
            };

            match outcome {
                Ok(DownloadOutcome::Completed) => {
                    if let Ok(mut lock) = progress.try_lock() {
                        lock.phase = "verifying".to_string();
                    }
                    if let Ok(guard) = app_handle_arc.try_lock() {
                        if let Some(app) = guard.as_ref() {
                            if let Ok(lock) = progress.try_lock() {
                                let _ = app.emit("stt://model-progress", &*lock);
                            }
                        }
                    }

                    let verify_res = if let Some(expected) = &expected_sha256 {
                        verify_sha256(&partial_path, expected)
                    } else {
                        Ok(())
                    };

                    match verify_res {
                        Ok(()) => {
                            if let Err(e) = fs::rename(&partial_path, &target_path) {
                                emit_failed("error", &format!("Failed to finalize model file: {e}"));
                            } else {
                                if let Ok(mut lock) = progress.try_lock() {
                                    lock.phase = "done".to_string();
                                    lock.percentage = 100.0;
                                }
                                if let Ok(guard) = app_handle_arc.try_lock() {
                                    if let Some(app) = guard.as_ref() {
                                        let _ = app.emit(
                                            "stt://model-complete",
                                            serde_json::json!({ "modelId": model_id_owned }),
                                        );
                                        let _ = app.emit("stt://models-updated", serde_json::json!({}));
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            let _ = fs::remove_file(&partial_path);
                            emit_failed("error", &format!("model_verify_failed: {e}"));
                        }
                    }
                }
                Ok(DownloadOutcome::Cancelled) => {
                    emit_failed("cancelled", "cancelled");
                }
                Err(err_msg) => {
                    emit_failed("error", &err_msg);
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
}
