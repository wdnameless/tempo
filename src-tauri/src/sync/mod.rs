// src-tauri/src/sync/mod.rs
//
// Sync engine module for cross-device synchronization.
// Interfaces defined in interfaces.md §23.
pub mod journal;
pub mod merge;
pub mod transport;

#[cfg(test)]
mod merge_tests;
#[cfg(test)]
mod transport_tests;

use std::path::{Path, PathBuf};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::storage::repo;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncStatus {
    pub device_id: String,
    pub transport: String,
    pub folder: Option<String>,
    pub last_sync: Option<String>,
    pub pending: u32,
    pub media: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct SyncOutcome {
    pub sent: u32,
    pub received: u32,
    pub applied: u32,
    pub conflicts: u32,
    pub media_copied: u32,
}

pub const PREF_SYNC_TRANSPORT: &str = "sync_transport";
pub const PREF_SYNC_FOLDER: &str = "sync_folder";
pub const PREF_SYNC_MEDIA: &str = "sync_media";
pub const PREF_SYNC_LAST_SYNC: &str = "sync_last_sync";
pub const PREF_SYNC_LAST_EXPORT_ID: &str = "sync_last_export_id";

/// Returns current sync status including device ID, transport setting, pending count, etc.
pub fn get_sync_status(conn: &Connection) -> Result<SyncStatus, String> {
    let device_id = repo::pref_device_id(conn)?;
    let transport = repo::pref_get(conn, PREF_SYNC_TRANSPORT)?
        .unwrap_or_else(|| "none".to_string());
    let folder = repo::pref_get(conn, PREF_SYNC_FOLDER)?;
    let last_sync = repo::pref_get(conn, PREF_SYNC_LAST_SYNC)?;
    let pending = journal::get_pending_count(conn)?;
    let media = repo::pref_get(conn, PREF_SYNC_MEDIA)?
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);

    Ok(SyncStatus {
        device_id,
        transport,
        folder,
        last_sync,
        pending,
        media,
    })
}

/// Sets the transport mode and optional folder path.
pub fn set_sync_transport(conn: &Connection, transport: &str, folder: Option<&str>) -> Result<(), String> {
    repo::pref_set(conn, PREF_SYNC_TRANSPORT, transport)?;
    if let Some(f) = folder {
        repo::pref_set(conn, PREF_SYNC_FOLDER, f)?;
    }
    Ok(())
}

/// Sets whether media sync is enabled.
pub fn set_sync_media(conn: &Connection, enabled: bool) -> Result<(), String> {
    repo::pref_set(conn, PREF_SYNC_MEDIA, if enabled { "true" } else { "false" })?;
    Ok(())
}

/// Executes sync now with the configured folder transport.
pub fn sync_now_internal(conn: &Connection, app_data_dir: &Path) -> Result<SyncOutcome, String> {
    let status = get_sync_status(conn)?;
    if status.transport == "none" || status.transport.is_empty() {
        return Err("no_transport".to_string());
    }
    if status.transport != "folder" {
        return Err(format!("Unsupported transport: {}", status.transport));
    }
    let folder_str = status.folder.ok_or_else(|| "folder_not_configured".to_string())?;
    let sync_dir = PathBuf::from(&folder_str);
    if !sync_dir.exists() {
        return Err(format!("folder_not_found: {}", sync_dir.display()));
    }

    let outcome = transport::perform_folder_sync(conn, &sync_dir, app_data_dir, status.media)?;

    // Record last sync timestamp
    let now = chrono::Utc::now().to_rfc3339();
    repo::pref_set(conn, PREF_SYNC_LAST_SYNC, &now)?;

    Ok(outcome)
}

#[tauri::command]
pub fn sync_status(app: tauri::AppHandle) -> Result<SyncStatus, String> {
    crate::storage::with_db(&app, get_sync_status)
}

#[tauri::command]
pub fn sync_set_transport(
    app: tauri::AppHandle,
    transport: String,
    folder: Option<String>,
) -> Result<(), String> {
    crate::storage::with_db(&app, |conn| set_sync_transport(conn, &transport, folder.as_deref()))
}

#[tauri::command]
pub fn sync_set_media(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    crate::storage::with_db(&app, |conn| set_sync_media(conn, enabled))
}

#[tauri::command]
pub fn sync_now(app: tauri::AppHandle) -> Result<SyncOutcome, String> {
    let db_path_str = crate::storage::db_path(app.clone())?;
    let db_p = PathBuf::from(db_path_str);
    let data_dir = db_p.parent().ok_or_else(|| "Failed to resolve app data directory".to_string())?;
    crate::storage::with_db(&app, |conn| sync_now_internal(conn, data_dir))
}

#[tauri::command]
pub fn sync_pending(app: tauri::AppHandle) -> Result<u32, String> {
    crate::storage::with_db(&app, journal::get_pending_count)
}
