// src-tauri/src/stt/history.rs
// Persistent speech-to-text transcription history with audio file management and pruning.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use tauri::AppHandle;

/// A single speech-to-text transcription record.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub text: String,
    pub created_at: String,
    pub duration_ms: u64,
    pub model_id: Option<String>,
    pub language: Option<String>,
    pub audio_path: Option<String>,
    pub saved: bool,
    pub app_name: Option<String>,
}

/// Inserts or updates a transcription history entry.
pub fn insert(app: &AppHandle, entry: &HistoryEntry) -> Result<(), String> {
    crate::storage::with_db(app, |conn| insert_conn(conn, entry))
}

/// Lists transcription history entries ordered by created_at DESC.
pub fn list(app: &AppHandle, limit: usize) -> Result<Vec<HistoryEntry>, String> {
    crate::storage::with_db(app, |conn| list_conn(conn, limit))
}

/// Retrieves a single transcription history entry by its ID.
pub fn get(app: &AppHandle, id: &str) -> Result<Option<HistoryEntry>, String> {
    crate::storage::with_db(app, |conn| get_conn(conn, id))
}

/// Updates the saved status of a transcription history entry.
/// Saved entries are preserved across retention and count-based pruning.
pub fn set_saved(app: &AppHandle, id: &str, saved: bool) -> Result<(), String> {
    crate::storage::with_db(app, |conn| set_saved_conn(conn, id, saved))
}

/// Deletes a transcription history entry and removes its associated audio file.
pub fn delete(app: &AppHandle, id: &str) -> Result<(), String> {
    crate::storage::with_db(app, |conn| delete_conn(conn, id))
}

/// Prunes unsaved history entries based on count limit and retention window.
/// Saved entries are NEVER deleted by this function.
/// Returns the number of entries deleted.
pub fn prune(app: &AppHandle, limit: usize, retention_days: u32) -> Result<usize, String> {
    crate::storage::with_db(app, |conn| prune_conn(conn, limit, retention_days))
}

/// Clears all history entries and deletes their associated audio files.
pub fn clear(app: &AppHandle) -> Result<(), String> {
    crate::storage::with_db(app, clear_conn)
}

// ---------------------------------------------------------------------------
// Connection-level implementations (usable with in-memory / temp DB in tests)
// ---------------------------------------------------------------------------

pub fn insert_conn(conn: &Connection, entry: &HistoryEntry) -> Result<(), String> {
    let id = if entry.id.trim().is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        entry.id.clone()
    };

    let created_at = if entry.created_at.trim().is_empty() {
        chrono::Utc::now().to_rfc3339()
    } else {
        entry.created_at.clone()
    };

    let updated_at = chrono::Utc::now().to_rfc3339();
    let saved_int = if entry.saved { 1 } else { 0 };
    let duration_int = entry.duration_ms as i64;

    conn.execute(
        "INSERT INTO stt_history (
            id, text, created_at, updated_at, deleted_at,
            duration_ms, model_id, language, audio_path, saved, app_name
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(id) DO UPDATE SET
            text = excluded.text,
            updated_at = excluded.updated_at,
            duration_ms = excluded.duration_ms,
            model_id = excluded.model_id,
            language = excluded.language,
            audio_path = excluded.audio_path,
            saved = excluded.saved,
            app_name = excluded.app_name;",
        params![
            id,
            entry.text,
            created_at,
            updated_at,
            Option::<String>::None,
            duration_int,
            entry.model_id,
            entry.language,
            entry.audio_path,
            saved_int,
            entry.app_name,
        ],
    )
    .map_err(|e| format!("Failed to insert stt_history entry: {e}"))?;

    Ok(())
}

fn map_history_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryEntry> {
    let duration: i64 = row.get(3).unwrap_or(0);
    let saved_int: i32 = row.get(7).unwrap_or(0);
    Ok(HistoryEntry {
        id: row.get(0)?,
        text: row.get(1)?,
        created_at: row.get(2)?,
        duration_ms: if duration < 0 { 0 } else { duration as u64 },
        model_id: row.get(4)?,
        language: row.get(5)?,
        audio_path: row.get(6)?,
        saved: saved_int != 0,
        app_name: row.get(8)?,
    })
}

pub fn list_conn(conn: &Connection, limit: usize) -> Result<Vec<HistoryEntry>, String> {
    let query = if limit > 0 {
        "SELECT id, text, created_at, duration_ms, model_id, language, audio_path, saved, app_name
         FROM stt_history
         ORDER BY created_at DESC
         LIMIT ?1"
    } else {
        "SELECT id, text, created_at, duration_ms, model_id, language, audio_path, saved, app_name
         FROM stt_history
         ORDER BY created_at DESC"
    };

    let mut stmt = conn
        .prepare(query)
        .map_err(|e| format!("Failed to prepare list query: {e}"))?;

    let rows = if limit > 0 {
        stmt.query_map(params![limit as i64], map_history_row)
    } else {
        stmt.query_map([], map_history_row)
    }
    .map_err(|e| format!("Failed to execute list query: {e}"))?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r.map_err(|e| format!("Row mapping error: {e}"))?);
    }
    Ok(result)
}

pub fn get_conn(conn: &Connection, id: &str) -> Result<Option<HistoryEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, text, created_at, duration_ms, model_id, language, audio_path, saved, app_name
             FROM stt_history
             WHERE id = ?1",
        )
        .map_err(|e| format!("Failed to prepare get query: {e}"))?;

    let mut rows = stmt
        .query_map(params![id], map_history_row)
        .map_err(|e| format!("Failed to execute get query: {e}"))?;

    if let Some(res) = rows.next() {
        Ok(Some(res.map_err(|e| format!("Row mapping error: {e}"))?))
    } else {
        Ok(None)
    }
}

pub fn set_saved_conn(conn: &Connection, id: &str, saved: bool) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let saved_int = if saved { 1 } else { 0 };

    conn.execute(
        "UPDATE stt_history SET saved = ?1, updated_at = ?2 WHERE id = ?3",
        params![saved_int, now, id],
    )
    .map_err(|e| format!("Failed to update saved flag: {e}"))?;

    Ok(())
}

pub fn delete_conn(conn: &Connection, id: &str) -> Result<(), String> {
    // 1. Fetch audio path before deleting database row
    let audio_path: Option<String> = conn
        .query_row(
            "SELECT audio_path FROM stt_history WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .unwrap_or(None);

    // 2. Delete database entry
    conn.execute("DELETE FROM stt_history WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete history row: {e}"))?;

    // 3. Remove associated audio file if no other entry references it
    if let Some(path_str) = &audio_path {
        remove_audio_file_if_unreferenced(conn, path_str);
    }

    Ok(())
}

pub fn prune_conn(conn: &Connection, limit: usize, retention_days: u32) -> Result<usize, String> {
    let mut to_delete_ids = HashSet::new();

    // 1. Retention-based pruning: all unsaved entries older than retention_days
    if retention_days > 0 {
        let cutoff = chrono::Utc::now() - chrono::Duration::days(retention_days as i64);
        let cutoff_str = cutoff.to_rfc3339();

        let mut stmt = conn
            .prepare("SELECT id FROM stt_history WHERE saved = 0 AND created_at < ?1")
            .map_err(|e| format!("Failed to prepare retention query: {e}"))?;

        let rows = stmt
            .query_map(params![cutoff_str], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query expired entries: {e}"))?;

        for id_res in rows {
            to_delete_ids.insert(id_res.map_err(|e| e.to_string())?);
        }
    }

    // 2. Limit-based pruning: oldest unsaved entries beyond the count limit
    if limit > 0 {
        let mut stmt = conn
            .prepare("SELECT id FROM stt_history WHERE saved = 0 ORDER BY created_at DESC")
            .map_err(|e| format!("Failed to prepare limit query: {e}"))?;

        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query unsaved entries: {e}"))?;

        let mut unsaved_ids = Vec::new();
        for id_res in rows {
            unsaved_ids.push(id_res.map_err(|e| e.to_string())?);
        }

        if unsaved_ids.len() > limit {
            for id in &unsaved_ids[limit..] {
                to_delete_ids.insert(id.clone());
            }
        }
    }

    if to_delete_ids.is_empty() {
        return Ok(0);
    }

    // Collect audio paths of entries about to be removed
    let mut audio_paths = Vec::new();
    for id in &to_delete_ids {
        let audio_path: Option<String> = conn
            .query_row(
                "SELECT audio_path FROM stt_history WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap_or(None);

        if let Some(p) = audio_path {
            if !p.trim().is_empty() {
                audio_paths.push(p);
            }
        }
    }

    // Delete records from database
    let count = to_delete_ids.len();
    for id in &to_delete_ids {
        conn.execute("DELETE FROM stt_history WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to prune history row: {e}"))?;
    }

    // Delete orphaned audio files
    for path_str in audio_paths {
        remove_audio_file_if_unreferenced(conn, &path_str);
    }

    Ok(count)
}

pub fn clear_conn(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT DISTINCT audio_path FROM stt_history WHERE audio_path IS NOT NULL")
        .map_err(|e| format!("Failed to query audio paths: {e}"))?;

    let audio_paths: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| format!("Failed to collect audio paths: {e}"))?
        .filter_map(Result::ok)
        .collect();

    conn.execute("DELETE FROM stt_history", [])
        .map_err(|e| format!("Failed to clear stt_history table: {e}"))?;

    for path_str in audio_paths {
        if !path_str.trim().is_empty() {
            let p = Path::new(&path_str);
            if p.exists() {
                let _ = std::fs::remove_file(p);
            }
        }
    }

    Ok(())
}

fn remove_audio_file_if_unreferenced(conn: &Connection, path_str: &str) {
    if path_str.trim().is_empty() {
        return;
    }
    let remaining: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM stt_history WHERE audio_path = ?1",
            params![path_str],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if remaining == 0 {
        let p = Path::new(path_str);
        if p.exists() {
            if let Err(e) = std::fs::remove_file(p) {
                eprintln!("[stt/history] Failed to remove audio file {}: {}", path_str, e);
            }
        }
    }
}
/// Writes 16 kHz mono f32 PCM samples to a WAV file with 16-bit integer PCM encoding.
pub fn write_wav_file(path: &Path, samples: &[f32], sample_rate: u32) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec)
        .map_err(|e| format!("Failed to create WAV file: {e}"))?;

    for &sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let val = (clamped * 32767.0).round() as i16;
        writer
            .write_sample(val)
            .map_err(|e| format!("Failed to write WAV sample: {e}"))?;
    }

    writer
        .finalize()
        .map_err(|e| format!("Failed to finalize WAV file: {e}"))?;
    Ok(())
}


// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::tempdir;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::storage::migrations::migrate(&conn).expect("migration must succeed");
        conn
    }

    #[test]
    fn test_insert_and_get() {
        let conn = setup_test_db();
        let entry = HistoryEntry {
            id: "entry-1".to_string(),
            text: "Testing speech to text history".to_string(),
            created_at: "2026-09-22T10:00:00Z".to_string(),
            duration_ms: 2500,
            model_id: Some("whisper-small".to_string()),
            language: Some("en".to_string()),
            audio_path: Some("/tmp/audio1.wav".to_string()),
            saved: false,
            app_name: Some("Tempo".to_string()),
        };

        insert_conn(&conn, &entry).unwrap();
        let retrieved = get_conn(&conn, "entry-1").unwrap();
        assert_eq!(retrieved, Some(entry));
    }

    #[test]
    fn test_list_ordering_and_limit() {
        let conn = setup_test_db();
        let entries = vec![
            HistoryEntry {
                id: "e1".to_string(),
                text: "first".to_string(),
                created_at: "2026-09-20T10:00:00Z".to_string(),
                duration_ms: 1000,
                model_id: None,
                language: None,
                audio_path: None,
                saved: false,
                app_name: None,
            },
            HistoryEntry {
                id: "e2".to_string(),
                text: "second".to_string(),
                created_at: "2026-09-21T10:00:00Z".to_string(),
                duration_ms: 1000,
                model_id: None,
                language: None,
                audio_path: None,
                saved: false,
                app_name: None,
            },
            HistoryEntry {
                id: "e3".to_string(),
                text: "third".to_string(),
                created_at: "2026-09-22T10:00:00Z".to_string(),
                duration_ms: 1000,
                model_id: None,
                language: None,
                audio_path: None,
                saved: false,
                app_name: None,
            },
        ];

        for e in &entries {
            insert_conn(&conn, e).unwrap();
        }

        let all = list_conn(&conn, 10).unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].id, "e3"); // Newest first
        assert_eq!(all[1].id, "e2");
        assert_eq!(all[2].id, "e1");

        let limited = list_conn(&conn, 2).unwrap();
        assert_eq!(limited.len(), 2);
        assert_eq!(limited[0].id, "e3");
        assert_eq!(limited[1].id, "e2");
    }

    #[test]
    fn test_set_saved() {
        let conn = setup_test_db();
        let entry = HistoryEntry {
            id: "e_saved".to_string(),
            text: "to be saved".to_string(),
            created_at: "2026-09-22T10:00:00Z".to_string(),
            duration_ms: 1000,
            model_id: None,
            language: None,
            audio_path: None,
            saved: false,
            app_name: None,
        };

        insert_conn(&conn, &entry).unwrap();
        assert!(!get_conn(&conn, "e_saved").unwrap().unwrap().saved);

        set_saved_conn(&conn, "e_saved", true).unwrap();
        assert!(get_conn(&conn, "e_saved").unwrap().unwrap().saved);

        set_saved_conn(&conn, "e_saved", false).unwrap();
        assert!(!get_conn(&conn, "e_saved").unwrap().unwrap().saved);
    }

    #[test]
    fn test_delete_removes_audio_file() {
        let conn = setup_test_db();
        let dir = tempdir().unwrap();
        let audio_path = dir.path().join("recording.wav");
        {
            let mut f = File::create(&audio_path).unwrap();
            f.write_all(b"audio-data").unwrap();
        }
        assert!(audio_path.exists());

        let entry = HistoryEntry {
            id: "e_delete".to_string(),
            text: "delete test".to_string(),
            created_at: "2026-09-22T10:00:00Z".to_string(),
            duration_ms: 1000,
            model_id: None,
            language: None,
            audio_path: Some(audio_path.to_str().unwrap().to_string()),
            saved: false,
            app_name: None,
        };

        insert_conn(&conn, &entry).unwrap();
        delete_conn(&conn, "e_delete").unwrap();

        assert_eq!(get_conn(&conn, "e_delete").unwrap(), None);
        assert!(!audio_path.exists(), "Audio file must be deleted on entry deletion");
    }

    #[test]
    fn test_prune_retention_window() {
        let conn = setup_test_db();
        let dir = tempdir().unwrap();

        let old_unsaved_path = dir.path().join("old_unsaved.wav");
        File::create(&old_unsaved_path).unwrap().write_all(b"1").unwrap();

        let old_saved_path = dir.path().join("old_saved.wav");
        File::create(&old_saved_path).unwrap().write_all(b"2").unwrap();

        let recent_unsaved_path = dir.path().join("recent_unsaved.wav");
        File::create(&recent_unsaved_path).unwrap().write_all(b"3").unwrap();

        let now = chrono::Utc::now();
        let ten_days_ago = (now - chrono::Duration::days(10)).to_rfc3339();
        let one_day_ago = (now - chrono::Duration::days(1)).to_rfc3339();

        // 1. Old unsaved entry (should be pruned)
        insert_conn(
            &conn,
            &HistoryEntry {
                id: "old_unsaved".to_string(),
                text: "old unsaved".to_string(),
                created_at: ten_days_ago.clone(),
                duration_ms: 1000,
                model_id: None,
                language: None,
                audio_path: Some(old_unsaved_path.to_str().unwrap().to_string()),
                saved: false,
                app_name: None,
            },
        )
        .unwrap();

        // 2. Old SAVED entry (must survive despite being old)
        insert_conn(
            &conn,
            &HistoryEntry {
                id: "old_saved".to_string(),
                text: "old saved".to_string(),
                created_at: ten_days_ago,
                duration_ms: 1000,
                model_id: None,
                language: None,
                audio_path: Some(old_saved_path.to_str().unwrap().to_string()),
                saved: true,
                app_name: None,
            },
        )
        .unwrap();

        // 3. Recent unsaved entry (must survive retention window)
        insert_conn(
            &conn,
            &HistoryEntry {
                id: "recent_unsaved".to_string(),
                text: "recent unsaved".to_string(),
                created_at: one_day_ago,
                duration_ms: 1000,
                model_id: None,
                language: None,
                audio_path: Some(recent_unsaved_path.to_str().unwrap().to_string()),
                saved: false,
                app_name: None,
            },
        )
        .unwrap();

        // Prune with 5 days retention window, no count limit
        let pruned = prune_conn(&conn, 0, 5).unwrap();
        assert_eq!(pruned, 1, "Only old_unsaved should be pruned");

        // Old unsaved is deleted from DB and disk
        assert_eq!(get_conn(&conn, "old_unsaved").unwrap(), None);
        assert!(!old_unsaved_path.exists());

        // Old saved survives in DB and disk
        assert!(get_conn(&conn, "old_saved").unwrap().is_some());
        assert!(old_saved_path.exists(), "Saved entry audio file must survive retention prune");

        // Recent unsaved survives in DB and disk
        assert!(get_conn(&conn, "recent_unsaved").unwrap().is_some());
        assert!(recent_unsaved_path.exists());
    }

    #[test]
    fn test_prune_count_limit() {
        let conn = setup_test_db();
        let dir = tempdir().unwrap();

        let now = chrono::Utc::now();
        let mut audio_files = Vec::new();

        // Create 5 unsaved entries (e1 is oldest, e5 is newest)
        for i in 1..=5 {
            let p = dir.path().join(format!("unsaved_{i}.wav"));
            File::create(&p).unwrap().write_all(b"test").unwrap();
            audio_files.push(p.clone());

            let created = (now - chrono::Duration::hours(6 - i)).to_rfc3339();
            insert_conn(
                &conn,
                &HistoryEntry {
                    id: format!("e{i}"),
                    text: format!("entry {i}"),
                    created_at: created,
                    duration_ms: 1000,
                    model_id: None,
                    language: None,
                    audio_path: Some(p.to_str().unwrap().to_string()),
                    saved: false,
                    app_name: None,
                },
            )
            .unwrap();
        }

        // Create 2 saved entries with old timestamps
        let saved_path_1 = dir.path().join("saved_1.wav");
        File::create(&saved_path_1).unwrap().write_all(b"saved1").unwrap();
        let saved_path_2 = dir.path().join("saved_2.wav");
        File::create(&saved_path_2).unwrap().write_all(b"saved2").unwrap();

        insert_conn(
            &conn,
            &HistoryEntry {
                id: "s1".to_string(),
                text: "saved 1".to_string(),
                created_at: (now - chrono::Duration::hours(20)).to_rfc3339(),
                duration_ms: 1000,
                model_id: None,
                language: None,
                audio_path: Some(saved_path_1.to_str().unwrap().to_string()),
                saved: true,
                app_name: None,
            },
        )
        .unwrap();

        insert_conn(
            &conn,
            &HistoryEntry {
                id: "s2".to_string(),
                text: "saved 2".to_string(),
                created_at: (now - chrono::Duration::hours(25)).to_rfc3339(),
                duration_ms: 1000,
                model_id: None,
                language: None,
                audio_path: Some(saved_path_2.to_str().unwrap().to_string()),
                saved: true,
                app_name: None,
            },
        )
        .unwrap();

        // Prune with limit 2 (keep 2 newest unsaved: e5 and e4; delete e1, e2, e3)
        let pruned = prune_conn(&conn, 2, 0).unwrap();
        assert_eq!(pruned, 3, "3 oldest unsaved entries must be pruned");

        // Old unsaved entries deleted
        assert_eq!(get_conn(&conn, "e1").unwrap(), None);
        assert_eq!(get_conn(&conn, "e2").unwrap(), None);
        assert_eq!(get_conn(&conn, "e3").unwrap(), None);
        assert!(!audio_files[0].exists());
        assert!(!audio_files[1].exists());
        assert!(!audio_files[2].exists());

        // Newest 2 unsaved survive
        assert!(get_conn(&conn, "e4").unwrap().is_some());
        assert!(get_conn(&conn, "e5").unwrap().is_some());
        assert!(audio_files[3].exists());
        assert!(audio_files[4].exists());

        // Saved entries survive unconditionally
        assert!(get_conn(&conn, "s1").unwrap().is_some());
        assert!(get_conn(&conn, "s2").unwrap().is_some());
        assert!(saved_path_1.exists());
        assert!(saved_path_2.exists());
    }

    #[test]
    fn test_clear_removes_all_and_files() {
        let conn = setup_test_db();
        let dir = tempdir().unwrap();

        let f1 = dir.path().join("c1.wav");
        File::create(&f1).unwrap().write_all(b"1").unwrap();
        let f2 = dir.path().join("c2.wav");
        File::create(&f2).unwrap().write_all(b"2").unwrap();

        insert_conn(
            &conn,
            &HistoryEntry {
                id: "c1".to_string(),
                text: "clear 1".to_string(),
                created_at: "2026-09-22T10:00:00Z".to_string(),
                duration_ms: 1000,
                model_id: None,
                language: None,
                audio_path: Some(f1.to_str().unwrap().to_string()),
                saved: false,
                app_name: None,
            },
        )
        .unwrap();

        insert_conn(
            &conn,
            &HistoryEntry {
                id: "c2".to_string(),
                text: "clear 2".to_string(),
                created_at: "2026-09-22T11:00:00Z".to_string(),
                duration_ms: 1000,
                model_id: None,
                language: None,
                audio_path: Some(f2.to_str().unwrap().to_string()),
                saved: true,
                app_name: None,
            },
        )
        .unwrap();

        clear_conn(&conn).unwrap();
        let list = list_conn(&conn, 10).unwrap();
        assert!(list.is_empty());
        assert!(!f1.exists());
        assert!(!f2.exists());
    }

    #[test]
    fn test_write_wav_file_round_trip() {
        let dir = tempdir().unwrap();
        let wav_path = dir.path().join("test_roundtrip.wav");

        let original_samples: Vec<f32> = (0..16000)
            .map(|i| (i as f32 * 440.0 * 2.0 * std::f32::consts::PI / 16000.0).sin() * 0.8)
            .collect();

        write_wav_file(&wav_path, &original_samples, 16000).expect("write_wav_file failed");
        assert!(wav_path.is_file());

        let mut reader = hound::WavReader::open(&wav_path).expect("failed to open written WAV");
        let spec = reader.spec();
        assert_eq!(spec.channels, 1);
        assert_eq!(spec.sample_rate, 16000);
        assert_eq!(spec.bits_per_sample, 16);
        assert_eq!(spec.sample_format, hound::SampleFormat::Int);

        let read_samples: Vec<i16> = reader.samples::<i16>().filter_map(|s| s.ok()).collect();
        assert_eq!(read_samples.len(), 16000);
    }

    #[test]
    fn test_delete_removes_real_audio_file_on_disk() {
        let dir = tempdir().unwrap();
        let conn = setup_test_db();
        let wav_path = dir.path().join("delete_me.wav");

        let dummy_samples = vec![0.0f32; 1600];
        write_wav_file(&wav_path, &dummy_samples, 16000).unwrap();
        assert!(wav_path.exists());

        let entry = HistoryEntry {
            id: "del-file-entry".to_string(),
            text: "Testing file deletion on delete".to_string(),
            created_at: "2026-09-22T12:00:00Z".to_string(),
            duration_ms: 100,
            model_id: None,
            language: None,
            audio_path: Some(wav_path.to_str().unwrap().to_string()),
            saved: false,
            app_name: None,
        };

        insert_conn(&conn, &entry).unwrap();
        delete_conn(&conn, "del-file-entry").unwrap();

        assert!(!wav_path.exists(), "audio file on disk must be deleted after history entry is deleted");
    }
}
