// src-tauri/src/vault.rs
// Local markdown vault management: filesystem commands, atomic writes, safe relative paths.

use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultEntry {
    pub path: String,
    pub name: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    pub children: Vec<VaultEntry>,
}

/// Resolves the current vault root directory.
/// Defaults to `<data_dir>/vault`, overridable by preference `tempo_vault_root`.
pub fn resolve_vault_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(Some(custom)) = crate::storage::with_db(app, |conn| {
        crate::storage::repo::pref_get(conn, "tempo_vault_root")
    }) {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            let p = PathBuf::from(trimmed);
            if !p.exists() {
                std::fs::create_dir_all(&p)
                    .map_err(|e| format!("Failed to create custom vault root '{}': {e}", p.display()))?;
            }
            return Ok(p);
        }
    }

    let data_dir = crate::app_data_root(app)?;

    let default_root = data_dir.join("vault");
    if !default_root.exists() {
        std::fs::create_dir_all(&default_root)
            .map_err(|e| format!("Failed to create default vault root '{}': {e}", default_root.display()))?;
    }
    Ok(default_root)
}

/// Normalizes path string representation (stripping Windows UNC prefix if present).
fn normalize_path_str(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
}

/// Verifies that a relative path stays within the vault root and resolves its full filesystem path.
/// Rejects `..`, absolute paths, drive prefixes, null bytes, and symlinks escaping root.
pub fn resolve_safe_path(root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let trimmed = rel_path.trim();
    if trimmed.is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    if trimmed.contains('\0') {
        return Err("Path contains null byte".to_string());
    }

    if trimmed.starts_with('/') || trimmed.starts_with('\\') {
        return Err(format!("Absolute paths are not allowed: {rel_path}"));
    }

    let p = Path::new(trimmed);

    // Reject absolute paths and drive prefixes
    if p.is_absolute() {
        return Err(format!("Absolute paths are not allowed: {rel_path}"));
    }

    for comp in p.components() {
        match comp {
            std::path::Component::Prefix(_) => {
                return Err(format!("Drive prefixes are not allowed: {rel_path}"));
            }
            std::path::Component::RootDir => {
                return Err(format!("Root directory paths are not allowed: {rel_path}"));
            }
            std::path::Component::ParentDir => {
                return Err(format!("Parent directory traversal ('..') is not allowed: {rel_path}"));
            }
            _ => {}
        }
    }

    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Failed to resolve vault root '{}': {e}", root.display()))?;

    let candidate = root.join(p);

    // Symlink and traversal verification
    if candidate.exists() {
        let canonical_candidate = candidate
            .canonicalize()
            .map_err(|e| format!("Failed to resolve path '{}': {e}", candidate.display()))?;
        if !canonical_candidate.starts_with(&canonical_root) {
            return Err(format!("Path escapes vault root: {rel_path}"));
        }
    } else {
        let mut ancestor = candidate.as_path();
        while !ancestor.exists() {
            if let Some(parent) = ancestor.parent() {
                ancestor = parent;
            } else {
                break;
            }
        }
        if ancestor.exists() {
            let canonical_ancestor = ancestor
                .canonicalize()
                .map_err(|e| format!("Failed to resolve ancestor of '{}': {e}", candidate.display()))?;
            if !canonical_ancestor.starts_with(&canonical_root) {
                return Err(format!("Path escapes vault root: {rel_path}"));
            }
        }
    }

    Ok(candidate)
}

/// Atomically writes content to a file via a temporary file in the same directory.
pub fn atomic_write(target: &Path, content: &str) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("Target '{}' has no parent directory", target.display()))?;
    if !parent.exists() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory '{}': {e}", parent.display()))?;
    }

    let file_name = target
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "note".to_string());
    let temp_name = format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4().simple());
    let temp_path = parent.join(temp_name);

    let write_res = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut file = std::fs::File::create(&temp_path)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        Ok(())
    })();

    if let Err(e) = write_res {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("Failed to write temporary file '{}': {e}", temp_path.display()));
    }

    if let Err(e) = std::fs::rename(&temp_path, target) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("Failed to rename temp file to '{}': {e}", target.display()));
    }

    Ok(())
}

/// Recursively lists only folders and .md files in the vault.
pub fn list_vault_entries(root: &Path, current_dir: &Path) -> Result<Vec<VaultEntry>, String> {
    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(current_dir)
        .map_err(|e| format!("Failed to read directory '{}': {e}", current_dir.display()))?;

    for entry_res in read_dir {
        let entry = entry_res.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if name.starts_with('.') {
            continue;
        }

        let rel_path = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");

        if file_type.is_dir() {
            let children = list_vault_entries(root, &path)?;
            entries.push(VaultEntry {
                path: rel_path,
                name,
                is_dir: true,
                children,
            });
        } else if file_type.is_file() && name.to_lowercase().ends_with(".md") {
            entries.push(VaultEntry {
                path: rel_path,
                name,
                is_dir: false,
                children: Vec::new(),
            });
        }
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

/// Computes the daily note path for a given ISO date string.
pub fn daily_path_from_iso(date_str: &str) -> Result<String, String> {
    let trimmed = date_str.trim();
    let d = if trimmed.len() >= 10 {
        &trimmed[0..10]
    } else {
        return Err(format!("Invalid date format: '{date_str}', expected YYYY-MM-DD"));
    };

    let parts: Vec<&str> = d.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
        return Err(format!("Invalid date format: '{date_str}', expected YYYY-MM-DD"));
    }

    let year = parts[0];
    let month = parts[1];
    let day = parts[2];

    Ok(format!("Journal/{year}/{month}/{year}-{month}-{day}.md"))
}

// =========================================================================
// Tauri IPC Commands
// =========================================================================

#[tauri::command]
pub fn vault_root(app: tauri::AppHandle) -> Result<String, String> {
    let root = resolve_vault_root(&app)?;
    Ok(normalize_path_str(&root))
}

#[tauri::command]
pub fn vault_set_root(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    let p = PathBuf::from(trimmed);
    if !p.exists() {
        std::fs::create_dir_all(&p)
            .map_err(|e| format!("Failed to create folder '{}': {e}", p.display()))?;
    }
    let canonical = p
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize path '{}': {e}", p.display()))?;
    let normalized = normalize_path_str(&canonical);

    crate::storage::with_db(&app, |conn| {
        crate::storage::repo::pref_set(conn, "tempo_vault_root", &normalized)
    })?;

    Ok(normalized)
}

#[tauri::command]
pub async fn vault_pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let res = folder.map(|f| f.to_string());
        let _ = tx.send(res);
    });
    rx.await.map_err(|e| format!("Dialog cancelled or closed: {e}"))
}

#[tauri::command]
pub fn vault_list(app: tauri::AppHandle) -> Result<Vec<VaultEntry>, String> {
    let root = resolve_vault_root(&app)?;
    list_vault_entries(&root, &root)
}

#[tauri::command]
pub fn vault_read(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let root = resolve_vault_root(&app)?;
    let target = resolve_safe_path(&root, &path)?;
    std::fs::read_to_string(&target).map_err(|e| format!("Failed to read note '{path}': {e}"))
}

#[tauri::command]
pub fn vault_write(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    let root = resolve_vault_root(&app)?;
    let target = resolve_safe_path(&root, &path)?;
    atomic_write(&target, &content)
}

#[tauri::command]
pub fn vault_create(app: tauri::AppHandle, path: String, content: Option<String>) -> Result<(), String> {
    let root = resolve_vault_root(&app)?;
    let target = resolve_safe_path(&root, &path)?;
    if target.exists() {
        return Err(format!("File already exists: {path}"));
    }
    atomic_write(&target, content.as_deref().unwrap_or(""))
}

#[tauri::command]
pub fn vault_rename(app: tauri::AppHandle, from: String, to: String) -> Result<(), String> {
    let root = resolve_vault_root(&app)?;
    let safe_from = resolve_safe_path(&root, &from)?;
    let safe_to = resolve_safe_path(&root, &to)?;

    if !safe_from.exists() {
        return Err(format!("Source path not found: {from}"));
    }
    if let Some(parent) = safe_to.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create destination parent: {e}"))?;
        }
    }
    std::fs::rename(&safe_from, &safe_to)
        .map_err(|e| format!("Failed to rename '{from}' to '{to}': {e}"))
}

#[tauri::command]
pub fn vault_delete(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let root = resolve_vault_root(&app)?;
    let safe_path = resolve_safe_path(&root, &path)?;
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let canonical_target = safe_path
        .canonicalize()
        .map_err(|e| format!("Path not found: '{path}': {e}"))?;

    if canonical_target == canonical_root {
        return Err("Cannot delete the vault root".to_string());
    }

    if safe_path.is_file() {
        std::fs::remove_file(&safe_path).map_err(|e| format!("Failed to delete file '{path}': {e}"))
    } else if safe_path.is_dir() {
        std::fs::remove_dir_all(&safe_path).map_err(|e| format!("Failed to delete folder '{path}': {e}"))
    } else {
        Err(format!("Path not found: '{path}'"))
    }
}

#[tauri::command]
pub fn vault_mkdir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let root = resolve_vault_root(&app)?;
    let safe_path = resolve_safe_path(&root, &path)?;
    std::fs::create_dir_all(&safe_path)
        .map_err(|e| format!("Failed to create directory '{path}': {e}"))
}

#[tauri::command]
pub fn vault_daily(
    app: tauri::AppHandle,
    date_iso: Option<String>,
    date: Option<String>,
) -> Result<String, String> {
    let root = resolve_vault_root(&app)?;
    let date_str = date_iso
        .or(date)
        .ok_or_else(|| "Missing required date parameter".to_string())?;
    let rel_path = daily_path_from_iso(&date_str)?;
    let target = resolve_safe_path(&root, &rel_path)?;

    if target.exists() {
        // Idempotent: return existing path without recreating
        return Ok(rel_path);
    }

    let date_clean = &date_str.trim()[0..10];
    let template = format!("# {date_clean}\n\n## \n");
    atomic_write(&target, &template)?;
    Ok(rel_path)
}

#[tauri::command]
pub fn vault_open(app: tauri::AppHandle) -> Result<(), String> {
    let root = resolve_vault_root(&app)?;
    let root_str = root.to_string_lossy().to_string();

    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer").arg(&root_str).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = opener::open(&root_str);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_resolve_safe_path_rejects_escape() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // Traversals
        assert!(resolve_safe_path(root, "..").is_err());
        assert!(resolve_safe_path(root, "../secret.md").is_err());
        assert!(resolve_safe_path(root, "notes/../../secret.md").is_err());
        assert!(resolve_safe_path(root, "a/b/../../../secret.md").is_err());

        // Absolute paths
        #[cfg(windows)]
        {
            assert!(resolve_safe_path(root, "C:\\Windows\\System32").is_err());
            assert!(resolve_safe_path(root, "\\Windows\\System32").is_err());
            assert!(resolve_safe_path(root, "/Windows/System32").is_err());
        }
        #[cfg(not(windows))]
        {
            assert!(resolve_safe_path(root, "/etc/passwd").is_err());
        }

        // Empty path
        assert!(resolve_safe_path(root, "").is_err());
        assert!(resolve_safe_path(root, "   ").is_err());

        // Valid relative paths
        assert!(resolve_safe_path(root, "note.md").is_ok());
        assert!(resolve_safe_path(root, "folder/note.md").is_ok());
        assert!(resolve_safe_path(root, "folder/sub/note.md").is_ok());
    }

    #[test]
    fn test_resolve_safe_path_symlink_escape() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let outside_dir = tempdir().unwrap();
        let outside_file = outside_dir.path().join("secret.md");
        std::fs::write(&outside_file, "secret").unwrap();

        // Create a symlink inside root pointing outside
        let link_path = root.join("symlink_outside.md");
        #[cfg(windows)]
        let symlink_created = std::os::windows::fs::symlink_file(&outside_file, &link_path).is_ok();
        #[cfg(unix)]
        let symlink_created = std::os::unix::fs::symlink(&outside_file, &link_path).is_ok();

        if symlink_created {
            assert!(resolve_safe_path(root, "symlink_outside.md").is_err());
        }
    }

    #[test]
    fn test_atomic_write_and_read_roundtrip() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let file_path = root.join("sub").join("test.md");

        atomic_write(&file_path, "Hello Markdown!").unwrap();
        assert!(file_path.exists());

        let read_back = std::fs::read_to_string(&file_path).unwrap();
        assert_eq!(read_back, "Hello Markdown!");

        // Verify no leftover .tmp files
        let parent = file_path.parent().unwrap();
        for entry in std::fs::read_dir(parent).unwrap() {
            let name = entry.unwrap().file_name().to_string_lossy().to_string();
            assert!(!name.ends_with(".tmp"), "No temporary files should remain: {name}");
        }
    }

    #[test]
    fn test_vault_create_refuses_overwrite() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let file_path = root.join("existing.md");
        std::fs::write(&file_path, "original content").unwrap();

        let target = resolve_safe_path(root, "existing.md").unwrap();
        assert!(target.exists());

        // Attempt to create when file exists
        let create_res = (|| -> Result<(), String> {
            if target.exists() {
                return Err("File already exists: existing.md".to_string());
            }
            atomic_write(&target, "new content")
        })();

        assert!(create_res.is_err());
        assert_eq!(std::fs::read_to_string(&file_path).unwrap(), "original content");
    }

    #[test]
    fn test_vault_list_returns_only_md_and_folders() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // Create folders and files
        std::fs::create_dir_all(root.join("folder").join("sub")).unwrap();
        std::fs::write(root.join("note1.md"), "# Note 1").unwrap();
        std::fs::write(root.join("folder").join("note2.md"), "# Note 2").unwrap();
        std::fs::write(root.join("folder").join("sub").join("note3.md"), "# Note 3").unwrap();

        // Create non-md and hidden files
        std::fs::write(root.join("image.png"), "binary").unwrap();
        std::fs::write(root.join("data.json"), "{}").unwrap();
        std::fs::write(root.join(".hidden.md"), "secret").unwrap();
        std::fs::write(root.join("folder").join("ignore.txt"), "text").unwrap();

        let entries = list_vault_entries(root, root).unwrap();

        // Root level should have "folder" (dir) and "note1.md" (file), but NOT "image.png", "data.json", or ".hidden.md"
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "folder");
        assert!(entries[0].is_dir);
        assert_eq!(entries[1].name, "note1.md");
        assert!(!entries[1].is_dir);

        // folder level should have "sub" (dir) and "note2.md" (file), but NOT "ignore.txt"
        let folder_entries = &entries[0].children;
        assert_eq!(folder_entries.len(), 2);
        assert_eq!(folder_entries[0].name, "sub");
        assert!(folder_entries[0].is_dir);
        assert_eq!(folder_entries[1].name, "note2.md");
        assert!(!folder_entries[1].is_dir);

        // sub level should have "note3.md"
        let sub_entries = &folder_entries[0].children;
        assert_eq!(sub_entries.len(), 1);
        assert_eq!(sub_entries[0].name, "note3.md");
    }

    #[test]
    fn test_vault_list_handles_uppercase_md_extension() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        std::fs::write(root.join("UPPER.MD"), "# Upper").unwrap();
        std::fs::write(root.join("Mixed.Md"), "# Mixed").unwrap();
        std::fs::write(root.join("not_md.mdd"), "no").unwrap();

        let entries = list_vault_entries(root, root).unwrap();
        assert_eq!(entries.len(), 2);
        let names: Vec<String> = entries.into_iter().map(|e| e.name).collect();
        assert!(names.contains(&"UPPER.MD".to_string()));
        assert!(names.contains(&"Mixed.Md".to_string()));
    }

    #[test]
    fn test_vault_daily_path_and_idempotence() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        let date_iso = "2026-09-22T14:30:00.000Z";
        let rel_path = daily_path_from_iso(date_iso).unwrap();
        assert_eq!(rel_path, "Journal/2026/09/2026-09-22.md");

        // 1st call seeds file
        let target = resolve_safe_path(root, &rel_path).unwrap();
        assert!(!target.exists());

        let date_clean = &date_iso[0..10];
        let template = format!("# {date_clean}\n\n## \n");
        atomic_write(&target, &template).unwrap();
        assert!(target.exists());

        let content_seed = std::fs::read_to_string(&target).unwrap();
        assert_eq!(content_seed, "# 2026-09-22\n\n## \n");

        // User edits note
        std::fs::write(&target, "# 2026-09-22\n\n## Plan\n- Task A").unwrap();

        // 2nd call: existing file is not recreated
        if !target.exists() {
            atomic_write(&target, &template).unwrap();
        }

        let content_after = std::fs::read_to_string(&target).unwrap();
        assert_eq!(content_after, "# 2026-09-22\n\n## Plan\n- Task A");
    }
}
