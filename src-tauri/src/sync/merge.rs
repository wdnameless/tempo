// src-tauri/src/sync/merge.rs
//
// Merge rules implementation per interfaces.md §23.
//
// Invariants:
// 1. Strictly later updated_at wins.
// 2. Ties in updated_at are resolved deterministically by device_id (higher lexicographical wins).
// 3. A soft delete travels as op: "delete" and stays deleted unless the local copy was edited LATER.
// 4. Offline work must never be lost.

use rusqlite::Connection;
use serde_json::Value;

use super::journal::JournalEntry;
use crate::storage::repo;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergeDecision {
    ApplyPeer,
    KeepLocal,
}

/// Determines whether an incoming peer entry should be applied locally.
/// Returns (decision, is_conflict).
pub fn decide_merge(
    local_row: Option<&Value>,
    peer_entry: &JournalEntry,
    local_device_id: &str,
) -> (MergeDecision, bool) {
    let local = match local_row {
        Some(l) => l,
        None => {
            // Local row does not exist.
            // If peer op is delete and we have no local row, nothing to apply or keep.
            if peer_entry.op == "delete" {
                return (MergeDecision::KeepLocal, false);
            }
            return (MergeDecision::ApplyPeer, false);
        }
    };

    // Extract local updated_at (or deleted_at, or created_at)
    let local_updated_at = local
        .get("updated_at")
        .and_then(|v| v.as_str())
        .or_else(|| local.get("deleted_at").and_then(|v| v.as_str()))
        .unwrap_or("");
    let payload_val: Option<serde_json::Value> = peer_entry
        .payload
        .as_deref()
        .and_then(|p| serde_json::from_str(p).ok());

    let peer_updated_at = payload_val
        .as_ref()
        .and_then(|v| v.get("updated_at"))
        .and_then(|v| v.as_str())
        .or_else(|| payload_val.as_ref().and_then(|v| v.get("deleted_at")).and_then(|v| v.as_str()))
        .unwrap_or(peer_entry.created_at.as_str());
    if peer_updated_at > local_updated_at {
        (MergeDecision::ApplyPeer, true)
    } else if peer_updated_at < local_updated_at {
        (MergeDecision::KeepLocal, true)
    } else {
        // Equal timestamps: deterministic tie break by device_id
        let peer_dev = &peer_entry.device_id;
        let local_dev = local_device_id;
        if peer_dev.as_str() > local_dev {
            (MergeDecision::ApplyPeer, true)
        } else {
            (MergeDecision::KeepLocal, true)
        }
    }
}
/// Applies an incoming journal entry to the local database, following merge rules.
/// Returns Ok(applied: bool, is_conflict: bool).
pub fn apply_incoming_entry(
    conn: &Connection,
    entry: &JournalEntry,
    local_device_id: &str,
) -> Result<(bool, bool), String> {
    if !repo::is_syncable_table(&entry.table_name) {
        // Skip non-syncable tables
        return Ok((false, false));
    }

    // Fetch local row including soft-deleted ones (repo::get queries by id without deleted_at filter)
    let local_row = repo::get(conn, &entry.table_name, &entry.row_id)?;
    let (decision, is_conflict) = decide_merge(local_row.as_ref(), entry, local_device_id);

    match decision {
        MergeDecision::KeepLocal => Ok((false, is_conflict)),
        MergeDecision::ApplyPeer => {
            // Remember current max id in sync_outbox so we don't re-journal incoming synced entries
            let pre_max: i64 = conn
                .query_row("SELECT COALESCE(MAX(id), 0) FROM sync_outbox", [], |r| r.get(0))
                .unwrap_or(0);

            if entry.op == "delete" {
                // If local row exists and not already deleted, soft delete it
                if let Some(loc) = &local_row {
                    let is_already_deleted = loc.get("deleted_at").and_then(|v| v.as_str()).is_some();
                    if !is_already_deleted {
                        repo::soft_delete(conn, &entry.table_name, &entry.row_id)?;
                    }
                }
            } else {
                // Insert or update with peer payload
                let payload_val: Value = match &entry.payload {
                    Some(s) => serde_json::from_str(s).map_err(|e| format!("Invalid JSON payload: {e}"))?,
                    None => return Err(format!("Missing payload for peer entry op={}", entry.op)),
                };

                if local_row.is_some() {
                    // Update or overwrite
                    repo::update(conn, &entry.table_name, &entry.row_id, &payload_val)?;
                } else {
                    // Insert
                    repo::insert(conn, &entry.table_name, &payload_val)?;
                }
            }

            // Delete any outbox entries created as a side effect of applying incoming peer entry
            let _ = conn.execute("DELETE FROM sync_outbox WHERE id > ?1", rusqlite::params![pre_max]);

            Ok((true, is_conflict))
        }
    }
}
