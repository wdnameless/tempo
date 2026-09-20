//! Media asset storage on disk: save, delete, usage, and size-capped pruning.
//!
//! Assets are stored under `<data>/assets/<kind>/<name>` where `<data>` is the parent
//! directory of `tempo.db`. Supported asset kinds include `drawing`, `audio`, `screen`,
//! and `preview`.
//!
//! To prevent path traversal attacks from untrusted or malformed inputs coming across IPC,
//! all names are strictly sanitized and all deletion paths are canonicalized and verified
//! to remain strictly within the media directory.

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::SystemTime;

/// Reference to a stored asset returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssetRef {
    pub kind: String,
    pub path: String,
    pub bytes: usize,
}

/// Disk usage breakdown across stored asset categories.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssetUsage {
    pub total: u64,
    pub by_kind: HashMap<String, u64>,
}

/// Result of an asset pruning operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssetPruneResult {
    pub removed: usize,
    pub freed: u64,
}

/// Sanitizes an input file name.
///
/// Strips directory components and rejects path traversal elements such as `..`.
pub fn sanitize_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Asset name cannot be empty".to_string());
    }

    let path = Path::new(trimmed);
    for comp in path.components() {
        match comp {
            Component::Normal(_) => {}
            Component::ParentDir => {
                return Err(format!("Asset name '{name}' contains path traversal (..)"));
            }
            Component::RootDir | Component::Prefix(_) | Component::CurDir => {
                return Err(format!("Asset name '{name}' contains invalid path components"));
            }
        }
    }

    if let Some(file_name) = path.file_name() {
        let clean = file_name.to_string_lossy().to_string();
        if clean.is_empty() || clean == "." || clean == ".." {
            return Err(format!("Invalid sanitized asset name: '{name}'"));
        }
        Ok(clean)
    } else {
        Err(format!("Asset name '{name}' has no valid file name component"))
    }
}

/// Validates kind name (e.g. "drawing", "audio", "screen", "preview").
pub fn sanitize_kind(kind: &str) -> Result<String, String> {
    let trimmed = kind.trim();
    if trimmed.is_empty() {
        return Err("Asset kind cannot be empty".to_string());
    }
    if !trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err(format!("Invalid asset kind: '{kind}'"));
    }
    Ok(trimmed.to_string())
}

/// Resolves the root assets directory given the data directory containing `tempo.db`.
pub fn assets_root_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("assets")
}

/// Saves decoded base64 asset data under `<assets_dir>/<kind>/<name>`.
pub fn save_asset_in(
    assets_dir: &Path,
    kind: &str,
    name: &str,
    data_base64: &str,
) -> Result<AssetRef, String> {
    let clean_kind = sanitize_kind(kind)?;
    let clean_name = sanitize_name(name)?;

    let target_dir = assets_dir.join(&clean_kind);
    fs::create_dir_all(&target_dir).map_err(|e| {
        format!("Failed to create asset directory '{}': {e}", target_dir.display())
    })?;

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(data_base64.trim())
        .map_err(|e| format!("Failed to decode asset base64 data: {e}"))?;

    let target_path = target_dir.join(&clean_name);
    fs::write(&target_path, &decoded).map_err(|e| {
        format!("Failed to write asset file '{}': {e}", target_path.display())
    })?;

    // Return canonical or absolute path
    let canonical = fs::canonicalize(&target_path)
        .unwrap_or_else(|_| target_path.clone());

    Ok(AssetRef {
        kind: clean_kind,
        path: canonical.to_string_lossy().to_string(),
        bytes: decoded.len(),
    })
}

/// Validates that a path is strictly inside the assets directory.
/// Returns Ok(canonical_path) if valid, or Err if traversal detected or outside.
pub fn verify_path_inside_assets(assets_dir: &Path, input_path: &Path) -> Result<PathBuf, String> {
    // If the assets directory doesn't exist yet, create it so canonicalize works.
    if !assets_dir.exists() {
        fs::create_dir_all(assets_dir).map_err(|e| {
            format!("Failed to create assets directory: {e}")
        })?;
    }

    let canonical_assets = fs::canonicalize(assets_dir).map_err(|e| {
        format!("Failed to canonicalize assets directory '{}': {e}", assets_dir.display())
    })?;

    // Check if the input file exists.
    let canonical_target = if input_path.exists() {
        fs::canonicalize(input_path).map_err(|e| {
            format!("Failed to canonicalize asset path '{}': {e}", input_path.display())
        })?
    } else {
        // If file does not exist, check its parent or resolve components against assets_dir
        // For non-existent files, canonicalize the existing ancestor, then append remainder.
        let mut cur = input_path.to_path_buf();
        let mut tail = PathBuf::new();
        while !cur.exists() {
            if let Some(name) = cur.file_name() {
                let prev_tail = tail;
                tail = PathBuf::from(name);
                tail.push(prev_tail);
            }
            if !cur.pop() {
                break;
            }
        }

        if cur.exists() {
            let canon_ancestor = fs::canonicalize(&cur).map_err(|e| {
                format!("Failed to canonicalize ancestor '{}': {e}", cur.display())
            })?;
            canon_ancestor.join(tail)
        } else {
            // Cannot resolve anything
            return Err(format!("Cannot resolve path '{}'", input_path.display()));
        }
    };

    // Verify canonical prefix
    if canonical_target.starts_with(&canonical_assets) && canonical_target != canonical_assets {
        Ok(canonical_target)
    } else {
        Err(format!(
            "Access denied: path '{}' is outside the media directory '{}'",
            input_path.display(),
            canonical_assets.display()
        ))
    }
}

/// Deletes an asset at `path`.
///
/// Refuses paths outside the assets directory. Missing files succeed without error.
pub fn delete_asset_in(assets_dir: &Path, raw_path: &str) -> Result<(), String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    let path = Path::new(trimmed);
    let verified = verify_path_inside_assets(assets_dir, path)?;

    if verified.exists() {
        fs::remove_file(&verified).map_err(|e| {
            format!("Failed to delete asset file '{}': {e}", verified.display())
        })?;
    }

    Ok(())
}

/// Returns metadata (size in bytes) for an asset. Missing file returns 0 bytes.
///
/// Refuses paths outside the assets directory.
pub fn stat_asset_in(assets_dir: &Path, raw_path: &str) -> Result<u64, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err("Asset path cannot be empty".to_string());
    }

    let path = Path::new(trimmed);
    let full_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        assets_dir.join(path)
    };

    let verified = verify_path_inside_assets(assets_dir, &full_path)?;
    if !verified.exists() {
        return Ok(0);
    }

    let meta = fs::metadata(&verified).map_err(|e| {
        format!("Failed to read metadata for '{}': {e}", verified.display())
    })?;
    Ok(meta.len())
}

/// Calculates storage usage across all kinds under `assets_dir`.
pub fn usage_in(assets_dir: &Path) -> Result<AssetUsage, String> {
    let mut total: u64 = 0;
    let mut by_kind: HashMap<String, u64> = HashMap::new();

    if !assets_dir.exists() {
        return Ok(AssetUsage { total, by_kind });
    }

    let entries = fs::read_dir(assets_dir).map_err(|e| {
        format!("Failed to read assets directory '{}': {e}", assets_dir.display())
    })?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let kind_name = entry.file_name().to_string_lossy().to_string();
            let mut kind_total: u64 = 0;

            if let Ok(files) = fs::read_dir(&path) {
                for file_entry in files.flatten() {
                    let file_path = file_entry.path();
                    if file_path.is_file() {
                        if let Ok(meta) = file_entry.metadata() {
                            let size = meta.len();
                            kind_total += size;
                            total += size;
                        }
                    }
                }
            }

            by_kind.insert(kind_name, kind_total);
        }
    }

    Ok(AssetUsage { total, by_kind })
}

struct AssetFileEntry {
    path: PathBuf,
    modified: SystemTime,
    bytes: u64,
}

/// Prunes oldest assets when total exceeds `limit_bytes` until total <= `limit_bytes`.
pub fn prune_in(assets_dir: &Path, limit_bytes: u64) -> Result<AssetPruneResult, String> {
    if !assets_dir.exists() {
        return Ok(AssetPruneResult { removed: 0, freed: 0 });
    }

    let mut files = Vec::new();
    let mut total: u64 = 0;

    let entries = fs::read_dir(assets_dir).map_err(|e| {
        format!("Failed to read assets directory '{}': {e}", assets_dir.display())
    })?;

    for kind_entry in entries.flatten() {
        let kind_path = kind_entry.path();
        if kind_path.is_dir() {
            if let Ok(file_entries) = fs::read_dir(&kind_path) {
                for file_entry in file_entries.flatten() {
                    let p = file_entry.path();
                    if p.is_file() {
                        if let Ok(meta) = file_entry.metadata() {
                            let bytes = meta.len();
                            let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                            total += bytes;
                            files.push(AssetFileEntry {
                                path: p,
                                modified,
                                bytes,
                            });
                        }
                    }
                }
            }
        }
    }

    if total <= limit_bytes {
        return Ok(AssetPruneResult { removed: 0, freed: 0 });
    }

    // Sort files ascending by modified time (oldest first)
    files.sort_by_key(|f| f.modified);

    let mut removed = 0;
    let mut freed = 0;

    for file in files {
        if total <= limit_bytes {
            break;
        }

        if let Ok(()) = fs::remove_file(&file.path) {
            removed += 1;
            freed += file.bytes;
            total = total.saturating_sub(file.bytes);
        }
    }

    Ok(AssetPruneResult { removed, freed })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Duration;

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);

    struct TestTempDir {
        path: PathBuf,
    }

    impl TestTempDir {
        fn new() -> Self {
            let cnt = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
            let path = std::env::temp_dir().join(format!("tempo_asset_test_{}_{}", std::process::id(), cnt));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("create_dir_all");
            Self { path }
        }
        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestTempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn setup_temp_assets() -> (TestTempDir, PathBuf) {
        let temp = TestTempDir::new();
        let assets_dir = temp.path().join("assets");
        fs::create_dir_all(&assets_dir).expect("create_dir_all");
        (temp, assets_dir)
    }
    #[test]
    fn test_save_and_verify_bytes() {
        let (_tmp, assets_dir) = setup_temp_assets();
        let data = b"hello tempo asset world";
        let b64 = base64::engine::general_purpose::STANDARD.encode(data);

        let asset_ref = save_asset_in(&assets_dir, "drawing", "stroke_1.bin", &b64)
            .expect("save_asset_in");

        assert_eq!(asset_ref.kind, "drawing");
        assert_eq!(asset_ref.bytes, data.len());

        let read_back = fs::read(&asset_ref.path).expect("read asset");
        assert_eq!(read_back, data);
    }

    #[test]
    fn test_name_with_traversal_is_rejected() {
        let (_tmp, assets_dir) = setup_temp_assets();
        let b64 = base64::engine::general_purpose::STANDARD.encode(b"malicious");

        let err1 = save_asset_in(&assets_dir, "drawing", "../escape.png", &b64);
        assert!(err1.is_err());
        assert!(err1.unwrap_err().contains("path traversal"));

        let err2 = save_asset_in(&assets_dir, "drawing", "subdir/../../escape.png", &b64);
        assert!(err2.is_err());

        let err3 = save_asset_in(&assets_dir, "drawing", "..", &b64);
        assert!(err3.is_err());
    }

    #[test]
    fn test_delete_refuses_path_outside_assets_dir() {
        let (tmp, assets_dir) = setup_temp_assets();

        // Create a sensitive file outside assets_dir
        let outside_file = tmp.path().join("sensitive.txt");
        fs::write(&outside_file, b"cannot touch this").expect("write sensitive");

        let res = delete_asset_in(&assets_dir, outside_file.to_str().unwrap());
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Access denied"));
        assert!(outside_file.exists()); // file is still intact
    }

    #[test]
    fn test_delete_missing_file_succeeds() {
        let (_tmp, assets_dir) = setup_temp_assets();
        let missing = assets_dir.join("drawing").join("does_not_exist.png");

        let res = delete_asset_in(&assets_dir, missing.to_str().unwrap());
        assert!(res.is_ok());
    }

    #[test]
    fn test_usage_sums_per_kind() {
        let (_tmp, assets_dir) = setup_temp_assets();

        let b64_d1 = base64::engine::general_purpose::STANDARD.encode(b"12345"); // 5 bytes
        let b64_d2 = base64::engine::general_purpose::STANDARD.encode(b"1234567890"); // 10 bytes
        let b64_a1 = base64::engine::general_purpose::STANDARD.encode(b"1234567"); // 7 bytes

        save_asset_in(&assets_dir, "drawing", "d1.bin", &b64_d1).unwrap();
        save_asset_in(&assets_dir, "drawing", "d2.bin", &b64_d2).unwrap();
        save_asset_in(&assets_dir, "audio", "a1.bin", &b64_a1).unwrap();

        let usage = usage_in(&assets_dir).expect("usage_in");
        assert_eq!(usage.total, 22);
        assert_eq!(*usage.by_kind.get("drawing").unwrap(), 15);
        assert_eq!(*usage.by_kind.get("audio").unwrap(), 7);
    }

    #[test]
    fn test_prune_removes_oldest_first_and_stops_once_under_limit() {
        let (_tmp, assets_dir) = setup_temp_assets();
        let draw_dir = assets_dir.join("drawing");
        fs::create_dir_all(&draw_dir).unwrap();

        let file1 = draw_dir.join("oldest.bin");
        let file2 = draw_dir.join("middle.bin");
        let file3 = draw_dir.join("newest.bin");

        let mut f1 = File::create(&file1).unwrap();
        f1.write_all(&[1; 100]).unwrap();
        drop(f1);

        std::thread::sleep(Duration::from_millis(50));

        let mut f2 = File::create(&file2).unwrap();
        f2.write_all(&[2; 100]).unwrap();
        drop(f2);

        std::thread::sleep(Duration::from_millis(50));

        let mut f3 = File::create(&file3).unwrap();
        f3.write_all(&[3; 100]).unwrap();
        drop(f3);

        let usage = usage_in(&assets_dir).unwrap();
        assert_eq!(usage.total, 300);

        // Limit is 250 -> oldest (100) removed -> remaining 200 <= 250 -> stops.
        let prune = prune_in(&assets_dir, 250).unwrap();
        assert_eq!(prune.removed, 1);
        assert_eq!(prune.freed, 100);

        assert!(!file1.exists());
        assert!(file2.exists());
        assert!(file3.exists());

        let usage_after = usage_in(&assets_dir).unwrap();
        assert_eq!(usage_after.total, 200);
    }

    #[test]
    fn test_stat_asset_size_and_missing() {
        let (_tmp, assets_dir) = setup_temp_assets();
        let b64 = base64::engine::general_purpose::STANDARD.encode(b"sample data 12345");
        let asset_ref = save_asset_in(&assets_dir, "audio", "sample.wav", &b64).unwrap();

        // Exists -> exact size
        let size = stat_asset_in(&assets_dir, &asset_ref.path).unwrap();
        assert_eq!(size, 17);

        // Missing file inside assets -> returns 0
        let missing = stat_asset_in(&assets_dir, &assets_dir.join("audio").join("missing.wav").to_string_lossy()).unwrap();
        assert_eq!(missing, 0);

        // Outside assets -> error
        let err = stat_asset_in(&assets_dir, "../../secret.txt");
        assert!(err.is_err());
    }
}
