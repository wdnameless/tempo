// src-tauri/src/sync/transport.rs
//
// Folder transport for cross-device sync.
// Exports outbox journal to files, reads peer files, copies media if flag is enabled.

use std::fs;
use std::path::Path;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::journal::{self, JournalEntry};
use super::merge;
use super::SyncOutcome;
use crate::storage::repo;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncBatchFile {
    pub version: u32,
    pub device_id: String,
    pub timestamp: String,
    pub entries: Vec<JournalEntry>,
}

/// Discovers referenced media files in payloads (e.g. recordings, audio, attachments).
pub fn extract_media_references(entries: &[JournalEntry]) -> Vec<String> {
    let mut files = Vec::new();
    for entry in entries {
        if let Some(payload_str) = &entry.payload {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(payload_str) {
                // Check "file_path" in recordings or similar
                if let Some(fp) = val.get("file_path").and_then(|v| v.as_str()) {
                    if !fp.is_empty() {
                        files.push(fp.to_string());
                    }
                }
                // Check "path"
                if let Some(fp) = val.get("path").and_then(|v| v.as_str()) {
                    if !fp.is_empty() {
                        files.push(fp.to_string());
                    }
                }
            }
        }
    }
    files.sort();
    files.dedup();
    files
}

/// Executes folder transport sync:
/// 1. Exports pending journal entries to sync_dir/journal_<device_id>_<timestamp>.json
/// 2. If media flag is on, copies referenced media files into sync_dir/media/
/// 3. Reads peer files from sync_dir, skipping corrupt or half-written files with logging.
/// 4. Merges peer entries into local DB.
/// 5. If media flag is on, copies any peer media from sync_dir/media/ into local app_data_dir.
/// 6. Marks exported entries as applied so they won't be re-sent.
pub fn perform_folder_sync(
    conn: &Connection,
    sync_dir: &Path,
    app_data_dir: &Path,
    media_enabled: bool,
) -> Result<SyncOutcome, String> {
    fs::create_dir_all(sync_dir)
        .map_err(|e| format!("Failed to create sync directory: {e}"))?;

    let local_device_id = repo::pref_device_id(conn)?;
    let mut outcome = SyncOutcome::default();

    // Step 1: Export local pending entries
    let pending = journal::read_pending_entries(conn)?;
    let mut max_exported_id = 0i64;

    if !pending.is_empty() {
        max_exported_id = pending.iter().map(|e| e.id).max().unwrap_or(0);
        let now_ts = chrono::Utc::now().to_rfc3339().replace(':', "-");
        let batch = SyncBatchFile {
            version: 1,
            device_id: local_device_id.clone(),
            timestamp: now_ts.clone(),
            entries: pending.clone(),
        };

        let temp_filename = format!("tmp_{}_{}.json", local_device_id, now_ts);
        let final_filename = format!("journal_{}_{}.json", local_device_id, now_ts);
        let temp_path = sync_dir.join(temp_filename);
        let final_path = sync_dir.join(final_filename);

        let json_bytes = serde_json::to_vec_pretty(&batch)
            .map_err(|e| format!("Failed to serialize sync batch: {e}"))?;

        // Write to temporary file first, then atomic rename so peers never see half-written files
        fs::write(&temp_path, &json_bytes)
            .map_err(|e| format!("Failed to write sync temp file: {e}"))?;
        fs::rename(&temp_path, &final_path)
            .map_err(|e| format!("Failed to commit sync file: {e}"))?;

        outcome.sent = pending.len() as u32;

        // Step 2: Media export if flag enabled
        if media_enabled {
            let media_files = extract_media_references(&pending);
            let target_media_dir = sync_dir.join("media");
            let _ = fs::create_dir_all(&target_media_dir);

            for rel_file in media_files {
                let src_path = app_data_dir.join(&rel_file);
                let dest_path = target_media_dir.join(&rel_file);
                if src_path.exists() {
                    if let Some(parent) = dest_path.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    if fs::copy(&src_path, &dest_path).is_ok() {
                        outcome.media_copied += 1;
                    }
                }
            }
        }
    }

    // Step 3: Read peer files from sync_dir
    let dir_entries = fs::read_dir(sync_dir)
        .map_err(|e| format!("Failed to read sync directory: {e}"))?;

    let mut peer_files: Vec<SyncBatchFile> = Vec::new();

    for entry in dir_entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if fname.starts_with("journal_") && fname.ends_with(".json") {
                // Read and parse
                match fs::read_to_string(&path) {
                    Ok(content) => match serde_json::from_str::<SyncBatchFile>(&content) {
                        Ok(batch) => {
                            // Don't import our own files
                            if batch.device_id != local_device_id {
                                peer_files.push(batch);
                            }
                        }
                        Err(e) => {
                            // File is corrupt or half-written: report and skip, never apply partially
                            eprintln!("Skipping corrupt sync file {}: {e}", path.display());
                        }
                    },
                    Err(e) => {
                        eprintln!("Failed to read sync file {}: {e}", path.display());
                    }
                }
            }
        }
    }

    // Sort peer files by timestamp so changes apply chronologically
    peer_files.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

    // Step 4: Merge peer entries
    for batch in &peer_files {
        outcome.received += batch.entries.len() as u32;
        for entry in &batch.entries {
            match merge::apply_incoming_entry(conn, entry, &local_device_id) {
                Ok((applied, is_conflict)) => {
                    if applied {
                        outcome.applied += 1;
                    }
                    if is_conflict {
                        outcome.conflicts += 1;
                    }
                }
                Err(e) => {
                    eprintln!("Error applying entry for table {}: {e}", entry.table_name);
                }
            }
        }

        // Step 5: Copy incoming media if enabled
        if media_enabled {
            let media_files = extract_media_references(&batch.entries);
            let peer_media_dir = sync_dir.join("media");
            for rel_file in media_files {
                let src_path = peer_media_dir.join(&rel_file);
                let dest_path = app_data_dir.join(&rel_file);
                if src_path.exists() && !dest_path.exists() {
                    if let Some(parent) = dest_path.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    if fs::copy(&src_path, &dest_path).is_ok() {
                        outcome.media_copied += 1;
                    }
                }
            }
        }
    }

    // Step 6: Mark exported entries as applied so next run doesn't re-send them
    if max_exported_id > 0 {
        journal::mark_entries_applied(conn, max_exported_id)?;
    }

    Ok(outcome)
}
