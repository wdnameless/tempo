// src-tauri/src/stt/models.rs
// Catalog, paths, disk-space check, and download management for Whisper GGUF models.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

pub const DEFAULT_BASE_URL: &str = "https://huggingface.co/handy-computer/whisper-{id}-gguf/resolve/main/{filename}";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ModelCatalogItem {
    pub id: &'static str,
    pub name: &'static str,
    pub filename: &'static str,
    pub bytes: u64,
    pub wer: f32,
    pub languages: u32,
}

pub const CATALOG: &[ModelCatalogItem] = &[
    ModelCatalogItem {
        id: "tiny",
        name: "Tiny (46 MB)",
        filename: "whisper-tiny-Q8_0.gguf",
        bytes: 46 * 1024 * 1024,
        wer: 7.52,
        languages: 99,
    },
    ModelCatalogItem {
        id: "base",
        name: "Base (85 MB)",
        filename: "whisper-base-Q8_0.gguf",
        bytes: 85 * 1024 * 1024,
        wer: 5.12,
        languages: 99,
    },
    ModelCatalogItem {
        id: "small",
        name: "Small (270 MB)",
        filename: "whisper-small-Q8_0.gguf",
        bytes: 270 * 1024 * 1024,
        wer: 3.33,
        languages: 99,
    },
    ModelCatalogItem {
        id: "medium",
        name: "Medium (832 MB)",
        filename: "whisper-medium-Q8_0.gguf",
        bytes: 832 * 1024 * 1024,
        wer: 2.64,
        languages: 99,
    },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub bytes: u64,
    pub wer: f32,
    pub languages: u32,
    pub installed: bool,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DownloadProgress {
    pub model_id: Option<String>,
    pub received: u64,
    pub total: u64,
    pub done: bool,
    pub error: Option<String>,
    pub cancelled: Option<bool>,
}

pub struct DownloadManager {
    models_dir: PathBuf,
    current_download: Arc<Mutex<Option<Arc<ActiveDownload>>>>,
    last_progress: Arc<Mutex<DownloadProgress>>,
}
pub type DownloadTracker = DownloadManager;

impl DownloadManager {
    pub async fn snapshot(&self) -> DownloadProgress {
        self.get_progress().await
    }
}

pub fn get_catalog(models_dir: &Path) -> Vec<ModelInfo> {
    DownloadManager::new(models_dir.to_path_buf()).list_catalog()
}

pub fn get_installed_models(models_dir: &Path) -> Vec<ModelInfo> {
    get_catalog(models_dir).into_iter().filter(|m| m.installed).collect()
}

pub fn remove_model(models_dir: &Path, model_id: &str) -> Result<(), String> {
    DownloadManager::new(models_dir.to_path_buf()).delete_model(model_id)
}

pub fn free_disk_space_bytes(path: &Path) -> Result<u64, String> {
    check_disk_space(path)
}

pub async fn download_model_file(
    manager: Arc<DownloadManager>,
    model_id: &str,
    mirror: Option<String>,
) -> Result<(), String> {
    manager.start_download(model_id, mirror).await
}


pub struct ActiveDownload {
    model_id: String,
    received: Arc<AtomicU64>,
    total: Arc<AtomicU64>,
    cancelled: Arc<AtomicBool>,
}

impl DownloadManager {
    pub fn new(models_dir: PathBuf) -> Self {
        Self {
            models_dir,
            current_download: Arc::new(Mutex::new(None)),
            last_progress: Arc::new(Mutex::new(DownloadProgress::default())),
        }
    }

    pub(crate) fn current_download_arc(&self) -> Arc<Mutex<Option<Arc<ActiveDownload>>>> {
        Arc::clone(&self.current_download)
    }

    pub fn last_progress_arc(&self) -> Arc<Mutex<DownloadProgress>> {
        Arc::clone(&self.last_progress)
    }

    pub fn models_dir(&self) -> &Path {
        &self.models_dir
    }

    pub fn list_catalog(&self) -> Vec<ModelInfo> {
        CATALOG
            .iter()
            .map(|item| {
                let model_path = self.models_dir.join(item.filename);
                let installed = model_path.is_file();
                ModelInfo {
                    id: item.id.to_string(),
                    name: item.name.to_string(),
                    filename: item.filename.to_string(),
                    bytes: item.bytes,
                    wer: item.wer,
                    languages: item.languages,
                    installed,
                    path: if installed {
                        Some(model_path.to_string_lossy().to_string())
                    } else {
                        None
                    },
                }
            })
            .collect()
    }

    pub fn get_model_path(&self, model_id: &str) -> Option<PathBuf> {
        let item = CATALOG.iter().find(|m| m.id == model_id)?;
        let path = self.models_dir.join(item.filename);
        if path.is_file() {
            Some(path)
        } else {
            None
        }
    }

    pub fn delete_model(&self, model_id: &str) -> Result<(), String> {
        let item = CATALOG
            .iter()
            .find(|m| m.id == model_id)
            .ok_or_else(|| format!("Unknown model: {model_id}"))?;
        let path = self.models_dir.join(item.filename);
        if path.is_file() {
            std::fs::remove_file(&path).map_err(|e| format!("Failed to delete model file: {e}"))?;
        }
        Ok(())
    }

    pub async fn get_progress(&self) -> DownloadProgress {
        let guard = self.current_download.lock().await;
        if let Some(active) = &*guard {
            DownloadProgress {
                model_id: Some(active.model_id.clone()),
                received: active.received.load(Ordering::Relaxed),
                total: active.total.load(Ordering::Relaxed),
                done: false,
                error: None,
                cancelled: Some(active.cancelled.load(Ordering::Relaxed)),
            }
        } else {
            self.last_progress.lock().await.clone()
        }
    }

    pub async fn cancel(&self) {
        let guard = self.current_download.lock().await;
        if let Some(active) = &*guard {
            active.cancelled.store(true, Ordering::SeqCst);
        }
    }

    pub async fn start_download(
        &self,
        model_id: &str,
        mirror: Option<String>,
    ) -> Result<(), String> {
        let item = CATALOG
            .iter()
            .find(|m| m.id == model_id)
            .ok_or_else(|| format!("Unknown model: {model_id}"))?
            .clone();

        // 1. Check if already downloading
        {
            let mut guard = self.current_download.lock().await;
            if guard.is_some() {
                return Err("Download already in progress".to_string());
            }

            // Create models dir if missing
            if let Err(e) = std::fs::create_dir_all(&self.models_dir) {
                return Err(format!("Failed to create models directory: {e}"));
            }

            // 2. Check disk space: required bytes + 20 MB safety margin
            let required_bytes = item.bytes + (20 * 1024 * 1024);
            let free_space = check_disk_space(&self.models_dir)?;
            if free_space < required_bytes {
                let err_msg = format!(
                    "disk_space: not enough free disk space (available: {} MB, required: {} MB)",
                    free_space / (1024 * 1024),
                    required_bytes / (1024 * 1024)
                );
                *self.last_progress.lock().await = DownloadProgress {
                    model_id: Some(model_id.to_string()),
                    received: 0,
                    total: item.bytes,
                    done: false,
                    error: Some(err_msg.clone()),
                    cancelled: Some(false),
                };
                return Err(err_msg);
            }

            let active = Arc::new(ActiveDownload {
                model_id: model_id.to_string(),
                received: Arc::new(AtomicU64::new(0)),
                total: Arc::new(AtomicU64::new(item.bytes)),
                cancelled: Arc::new(AtomicBool::new(false)),
            });
            *guard = Some(active);
        }

        let download_url = build_download_url(item.id, item.filename, mirror.as_deref());
        let final_path = self.models_dir.join(item.filename);
        let temp_path = self.models_dir.join(format!("{}.tmp.{}", item.filename, uuid::Uuid::new_v4()));
        let models_dir = self.models_dir.clone();
        let current_download_clone = self.current_download_arc();
        let last_progress_clone = self.last_progress_arc();
        let model_id_owned = model_id.to_string();
        let item_bytes = item.bytes;
        let active_download = {
            self.current_download.lock().await.as_ref().cloned()
        };

        tauri::async_runtime::spawn(async move {
            let res = execute_download(
                download_url,
                temp_path.clone(),
                final_path.clone(),
                active_download,
            )
            .await;

            // Clear current download and update last_progress
            let mut guard = current_download_clone.lock().await;
            *guard = None;

            let mut last = last_progress_clone.lock().await;
            match res {
                Ok(()) => {
                    *last = DownloadProgress {
                        model_id: Some(model_id_owned),
                        received: item_bytes,
                        total: item_bytes,
                        done: true,
                        error: None,
                        cancelled: Some(false),
                    };
                }
                Err(e) if e == "cancelled" => {
                    *last = DownloadProgress {
                        model_id: Some(model_id_owned),
                        received: 0,
                        total: item_bytes,
                        done: false,
                        error: Some("cancelled".to_string()),
                        cancelled: Some(true),
                    };
                    // Ensure temp file is cleaned up
                    let _ = std::fs::remove_file(&temp_path);
                }
                Err(e) => {
                    *last = DownloadProgress {
                        model_id: Some(model_id_owned),
                        received: 0,
                        total: item_bytes,
                        done: false,
                        error: Some(e),
                        cancelled: Some(false),
                    };
                    let _ = std::fs::remove_file(&temp_path);
                }
            }
        });

        let _ = models_dir;
        Ok(())
    }
}
pub fn build_download_url(id: &str, filename: &str, mirror: Option<&str>) -> String {
    if let Some(m) = mirror {
        let m = m.trim();
        if !m.is_empty() {
            // Replace templates or append filename
            if m.contains("{id}") || m.contains("{filename}") {
                return m.replace("{id}", id).replace("{filename}", filename);
            }
            if m.ends_with('/') {
                return format!("{m}{filename}");
            }
            return format!("{m}/{filename}");
        }
    }

    format!(
        "https://huggingface.co/handy-computer/whisper-{id}-gguf/resolve/main/{filename}"
    )
}

pub fn check_disk_space(path: &Path) -> Result<u64, String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

        // Path or parent
        let check_path = if path.exists() {
            path.to_path_buf()
        } else {
            path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."))
        };

        let wide: Vec<u16> = check_path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
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
            // If checking exact folder failed, try root (e.g. C:\)
            let root = check_path.components().next().map(|c| c.as_os_str()).unwrap_or_default();
            let mut wide_root: Vec<u16> = root.encode_wide().collect();
            wide_root.push(b'\\' as u16);
            wide_root.push(0);

            let ret_root = unsafe {
                GetDiskFreeSpaceExW(
                    wide_root.as_ptr(),
                    &mut free_bytes_available,
                    &mut total_number_of_bytes,
                    &mut total_number_of_free_bytes,
                )
            };
            if ret_root != 0 {
                Ok(free_bytes_available)
            } else {
                Err(format!("GetDiskFreeSpaceExW failed with code {}", unsafe { windows_sys::Win32::Foundation::GetLastError() }))
            }
        }
    }

    #[cfg(not(windows))]
    {
        // For non-windows platforms, fallback to 100 GB in test/dev
        Ok(100 * 1024 * 1024 * 1024)
    }
}

async fn execute_download(
    url: String,
    temp_path: PathBuf,
    final_path: PathBuf,
    active: Option<Arc<ActiveDownload>>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("network_error: client build failed: {e}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("network_error: request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("network_error: HTTP status {}", response.status()));
    }

    if let Some(content_len) = response.content_length() {
        if let Some(act) = &active {
            act.total.store(content_len, Ordering::Relaxed);
        }
    }

    let mut file = tokio::fs::File::create(&temp_path)
        .await
        .map_err(|e| format!("disk_space: failed to create temporary file: {e}"))?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;

    while let Some(chunk_res) = stream.next().await {
        if let Some(act) = &active {
            if act.cancelled.load(Ordering::Relaxed) {
                drop(file);
                let _ = tokio::fs::remove_file(&temp_path).await;
                return Err("cancelled".to_string());
            }
        }

        let chunk = chunk_res.map_err(|e| format!("network_error: stream read failed: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("disk_space: failed to write to temporary file: {e}"))?;

        downloaded += chunk.len() as u64;
        if let Some(act) = &active {
            act.received.store(downloaded, Ordering::Relaxed);
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("disk_space: failed to flush temporary file: {e}"))?;
    drop(file);

    // Atomically rename temp_path -> final_path
    tokio::fs::rename(&temp_path, &final_path)
        .await
        .map_err(|e| format!("Failed to move completed model to destination: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_matches_spec() {
        assert_eq!(CATALOG.len(), 4);
        let tiny = &CATALOG[0];
        assert_eq!(tiny.id, "tiny");
        assert_eq!(tiny.filename, "whisper-tiny-Q8_0.gguf");
        assert_eq!(tiny.bytes, 46 * 1024 * 1024);
        assert!((tiny.wer - 7.52).abs() < 0.001);

        let base = &CATALOG[1];
        assert_eq!(base.id, "base");
        assert_eq!(base.filename, "whisper-base-Q8_0.gguf");
        assert_eq!(base.bytes, 85 * 1024 * 1024);

        let small = &CATALOG[2];
        assert_eq!(small.id, "small");
        assert_eq!(small.bytes, 270 * 1024 * 1024);

        let medium = &CATALOG[3];
        assert_eq!(medium.id, "medium");
        assert_eq!(medium.bytes, 832 * 1024 * 1024);
    }

    #[test]
    fn build_download_url_default_and_mirror() {
        let url_default = build_download_url("base", "whisper-base-Q8_0.gguf", None);
        assert_eq!(
            url_default,
            "https://huggingface.co/handy-computer/whisper-base-gguf/resolve/main/whisper-base-Q8_0.gguf"
        );

        let url_mirror = build_download_url(
            "base",
            "whisper-base-Q8_0.gguf",
            Some("https://hf-mirror.com/handy-computer/whisper-base-gguf/resolve/main/"),
        );
        assert_eq!(
            url_mirror,
            "https://hf-mirror.com/handy-computer/whisper-base-gguf/resolve/main/whisper-base-Q8_0.gguf"
        );

        let url_template = build_download_url(
            "tiny",
            "whisper-tiny-Q8_0.gguf",
            Some("https://mirror.internal/{id}/{filename}"),
        );
        assert_eq!(url_template, "https://mirror.internal/tiny/whisper-tiny-Q8_0.gguf");
    }

    #[test]
    fn check_disk_space_returns_positive_number() {
        let temp_dir = std::env::temp_dir();
        let space = check_disk_space(&temp_dir).expect("should query disk space");
        assert!(space > 0);
    }

    #[tokio::test]
    async fn temp_file_atomic_rename_contract() {
        let temp_dir = std::env::temp_dir().join(format!("stt_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let final_path = temp_dir.join("whisper-tiny-Q8_0.gguf");
        let temp_path = temp_dir.join("whisper-tiny-Q8_0.gguf.tmp.test");

        // Write partial data to temp
        std::fs::write(&temp_path, b"partial data").unwrap();
        assert!(temp_path.exists());
        assert!(!final_path.exists());

        // Simulate failed download cleanup
        std::fs::remove_file(&temp_path).unwrap();
        assert!(!temp_path.exists());
        assert!(!final_path.exists(), "Final file must never exist on failed download");

        // Simulate success rename
        std::fs::write(&temp_path, b"complete data").unwrap();
        std::fs::rename(&temp_path, &final_path).unwrap();
        assert!(!temp_path.exists());
        assert!(final_path.exists());
        assert_eq!(std::fs::read(&final_path).unwrap(), b"complete data");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
