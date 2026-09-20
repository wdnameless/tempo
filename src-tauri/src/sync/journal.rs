// src-tauri/src/sync/journal.rs
//
// Journal access and serialization for sync engine.
// Each entry in sync_outbox contains table_name, row_id, op, payload, created_at, device_id.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JournalEntry {
    pub id: i64,
    pub table_name: String,
    pub row_id: String,
    pub op: String,
    pub payload: Option<String>,
    pub created_at: String,
    pub device_id: String,
}

/// Returns count of pending entries in sync_outbox.
pub fn get_pending_count(conn: &Connection) -> Result<u32, String> {
    let count: u32 = conn
        .query_row("SELECT COUNT(*) FROM sync_outbox", [], |r| r.get(0))
        .map_err(|e| format!("Failed to count sync_outbox: {e}"))?;
    Ok(count)
}

/// Reads all pending entries from sync_outbox ordered by id ascending.
pub fn read_pending_entries(conn: &Connection) -> Result<Vec<JournalEntry>, String> {
    let mut stmt = conn
        .prepare("SELECT id, table_name, row_id, op, payload, created_at, COALESCE(device_id, '') FROM sync_outbox ORDER BY id ASC")
        .map_err(|e| format!("Failed to query sync_outbox: {e}"))?;

    let rows = stmt
        .query_map([], |r| {
            Ok(JournalEntry {
                id: r.get(0)?,
                table_name: r.get(1)?,
                row_id: r.get(2)?,
                op: r.get(3)?,
                payload: r.get(4)?,
                created_at: r.get(5)?,
                device_id: r.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to read sync_outbox rows: {e}"))?;

    let mut entries = Vec::new();
    for row in rows {
        let mut entry = row.map_err(|e| e.to_string())?;

        // Entries written by the trigger-based journal of wave 0 carry no payload,
        // and the peer refuses to apply a change whose content is missing. Rather
        // than ship a queue of failures — and rather than drop the user's earlier
        // work — the payload is taken from the row as it stands now. An entry
        // whose row is gone has nothing left to say and is skipped.
        if entry.payload.is_none() && entry.op != "delete" {
            match crate::storage::repo::get(conn, &entry.table_name, &entry.row_id) {
                Ok(Some(row)) => entry.payload = serde_json::to_string(&row).ok(),
                _ => continue,
            }
        }
        if entry.payload.is_none() && entry.op != "delete" {
            continue;
        }

        entries.push(entry);
    }
    Ok(entries)
}

/// Removes journal entries up to max_id once they have been safely exported and applied.
pub fn mark_entries_applied(conn: &Connection, max_id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM sync_outbox WHERE id <= ?1", params![max_id])
        .map_err(|e| format!("Failed to mark outbox entries applied: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("memory db");
        crate::storage::migrations::migrate(&conn).expect("migrate");
        conn
    }

    /// A payload-less entry is a change the peer cannot apply, so it must either
    /// gain the row's current content or leave the queue.
    #[test]
    fn payload_less_entries_are_filled_or_dropped() {
        let conn = setup();
        conn.execute(
            "INSERT INTO tasks (id, title, status, position, updated_at) VALUES ('t-live', 'Живая', 'open', 1, '2026-09-20T10:00:00Z')",
            [],
        )
        .expect("seed task");

        // What the old trigger left behind: no payload, no device.
        conn.execute(
            "INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at) VALUES ('tasks', 't-live', 'insert', NULL, '2026-09-20T10:00:00Z')",
            [],
        )
        .expect("legacy entry");
        conn.execute(
            "INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at) VALUES ('tasks', 't-gone', 'insert', NULL, '2026-09-20T10:00:00Z')",
            [],
        )
        .expect("legacy entry for a missing row");

        let entries = read_pending_entries(&conn).expect("read pending");
        assert_eq!(entries.len(), 1, "the entry with no row left is dropped");
        let payload = entries[0].payload.as_deref().expect("payload filled from the row");
        assert!(payload.contains("Живая"), "the payload carries the row as it stands: {payload}");
    }
}
