// src-tauri/src/storage/migrations.rs
// DDL versioning and idempotent migration runner.

use rusqlite::{params, Connection};

pub const SCHEMA_VERSION_LATEST: u32 = 4;

pub fn migrate(conn: &Connection) -> Result<u32, String> {
    // 1. Ensure schema_version table exists
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );"
    ).map_err(|e| format!("Failed to create schema_version table: {e}"))?;

    let current_version: u32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version;",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if current_version < 1 {
        apply_migration_0001(conn)?;
    }
    if current_version < 2 {
        apply_migration_0002(conn)?;
    }
    if current_version < 3 {
        apply_migration_0003(conn)?;
    }
    if current_version < 4 {
        apply_migration_0004(conn)?;
    }
    // Return the latest applied version
    let latest_version: u32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version;",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to query latest schema version: {e}"))?;

    Ok(latest_version)
}

fn apply_migration_0001(conn: &Connection) -> Result<(), String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start transaction for migration 0001: {e}"))?;

    // DDL verbatim from interfaces §2 (order matters: referenced tables first)
    tx.execute_batch(
        "
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'open',
  list_id TEXT, parent_id TEXT, priority INTEGER DEFAULT 0,
  due_date TEXT, start_at TEXT, planned_minutes INTEGER,
  completed_at TEXT, position REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS lists (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, position REAL,
  updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT, body_md TEXT NOT NULL DEFAULT '',
  pinned INTEGER DEFAULT 0, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS drawings (id TEXT PRIMARY KEY, title TEXT, scene_json TEXT NOT NULL,
  preview_path TEXT, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS recordings (id TEXT PRIMARY KEY, title TEXT,
  kind TEXT NOT NULL,                       -- audio | screen
  -- Note: duration_sec is declared REAL (floating point seconds). Existing installs keep an INTEGER-affinity
  -- column where SQLite stores fractional values unchanged; no table migration is needed.
  file_path TEXT NOT NULL, duration_sec REAL, transcript TEXT, transcript_status TEXT,
  updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, source TEXT NOT NULL,   -- local | google
  google_id TEXT, calendar_id TEXT, title TEXT, start_at TEXT, end_at TEXT,
  all_day INTEGER DEFAULT 0, location TEXT, task_id TEXT,
  updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS calendars_meta (calendar_id TEXT PRIMARY KEY, sync_token TEXT, last_sync_at TEXT);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, kind TEXT NOT NULL,    -- pomodoro | stopwatch
  started_at TEXT, ended_at TEXT, duration_sec REAL, completed INTEGER, task_id TEXT,
  updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS links (from_kind TEXT, from_id TEXT, to_kind TEXT, to_id TEXT,
  updated_at TEXT NOT NULL, PRIMARY KEY (from_kind, from_id, to_kind, to_id));
CREATE TABLE IF NOT EXISTS alarms (id TEXT PRIMARY KEY, label TEXT, time TEXT, days TEXT, repeat TEXT,
  enabled INTEGER, sound TEXT, voice_prompt TEXT, note TEXT,
  updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT, row_id TEXT,
  op TEXT, payload TEXT, created_at TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(kind UNINDEXED, row_id UNINDEXED, title, body,
  tokenize='unicode61');
        ",
    )
    .map_err(|e| format!("Migration 0001 DDL failed: {e}"))?;

    // Triggers that insert into sync_outbox on insert and on update of each soft-deleted entity table.
    // Soft-deleted entity tables: tasks, lists, notes, drawings, recordings, events, sessions, alarms, chat_messages.
    // On INSERT: op = 'insert', table_name = '...', row_id = NEW.id, created_at = NEW.updated_at
    // On UPDATE: op = 'update', table_name = '...', row_id = NEW.id, created_at = NEW.updated_at
    tx.execute_batch(
        "
-- tasks triggers
CREATE TRIGGER IF NOT EXISTS trg_tasks_insert AFTER INSERT ON tasks
BEGIN
    INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at)
    VALUES ('tasks', NEW.id, 'insert', NULL, NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS trg_tasks_update AFTER UPDATE ON tasks
BEGIN
    INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at)
    VALUES ('tasks', NEW.id, 'update', NULL, NEW.updated_at);
END;

-- lists triggers
CREATE TRIGGER IF NOT EXISTS trg_lists_insert AFTER INSERT ON lists
BEGIN
    INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at)
    VALUES ('lists', NEW.id, 'insert', NULL, NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS trg_lists_update AFTER UPDATE ON lists
BEGIN
    INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at)
    VALUES ('lists', NEW.id, 'update', NULL, NEW.updated_at);
END;

-- notes triggers
CREATE TRIGGER IF NOT EXISTS trg_notes_insert AFTER INSERT ON notes
BEGIN
    INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at)
    VALUES ('notes', NEW.id, 'insert', NULL, NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS trg_notes_update AFTER UPDATE ON notes
BEGIN
    INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at)
    VALUES ('notes', NEW.id, 'update', NULL, NEW.updated_at);
END;

-- drawings triggers
CREATE TRIGGER IF NOT EXISTS trg_drawings_insert AFTER INSERT ON drawings
BEGIN
    INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at)
    VALUES ('drawings', NEW.id, 'insert', NULL, NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS trg_drawings_update AFTER UPDATE ON drawings
BEGIN
    INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at)
    VALUES ('drawings', NEW.id, 'update', NULL, NEW.updated_at);
END;

-- recordings triggers
CREATE TRIGGER IF NOT EXISTS trg_recordings_insert AFTER INSERT ON recordings
BEGIN
    INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at)
    VALUES ('recordings', NEW.id, 'insert', NULL, NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS trg_recordings_update AFTER UPDATE ON recordings
BEGIN
    INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at)
    VALUES ('recordings', NEW.id, 'update', NULL, NEW.updated_at);
END;

-- events triggers
CREATE TRIGGER IF NOT EXISTS trg_events_insert AFTER INSERT ON events
BEGIN
    INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at)
    VALUES ('events', NEW.id, 'insert', NULL, NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS trg_events_update AFTER UPDATE ON events
BEGIN
    INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at)
    VALUES ('events', NEW.id, 'update', NULL, NEW.updated_at);
END;

-- sessions triggers
CREATE TRIGGER IF NOT EXISTS trg_sessions_insert AFTER INSERT ON sessions
BEGIN
    INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at)
    VALUES ('sessions', NEW.id, 'insert', NULL, NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS trg_sessions_update AFTER UPDATE ON sessions
BEGIN
    INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at)
    VALUES ('sessions', NEW.id, 'update', NULL, NEW.updated_at);
END;

-- alarms triggers
CREATE TRIGGER IF NOT EXISTS trg_alarms_insert AFTER INSERT ON alarms
BEGIN
    INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at)
    VALUES ('alarms', NEW.id, 'insert', NULL, NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS trg_alarms_update AFTER UPDATE ON alarms
BEGIN
    INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at)
    VALUES ('alarms', NEW.id, 'update', NULL, NEW.updated_at);
END;

-- chat_messages triggers
CREATE TRIGGER IF NOT EXISTS trg_chat_messages_insert AFTER INSERT ON chat_messages
BEGIN
    INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at)
    VALUES ('chat_messages', NEW.id, 'insert', NULL, NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS trg_chat_messages_update AFTER UPDATE ON chat_messages
BEGIN
    INSERT INTO sync_outbox (table_name, row_id, op, payload, created_at)
    VALUES ('chat_messages', NEW.id, 'update', NULL, NEW.updated_at);
END;
        ",
    )
    .map_err(|e| format!("Migration 0001 triggers failed: {e}"))?;

    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2);",
        params![1, now],
    )
    .map_err(|e| format!("Failed to record schema version 1: {e}"))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit migration 0001: {e}"))?;

    Ok(())
}
fn apply_migration_0002(conn: &Connection) -> Result<(), String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start transaction for migration 0002: {e}"))?;

    // Drop legacy trigger-based sync_outbox population because journal is now written in repo layer
    tx.execute_batch(
        "
DROP TRIGGER IF EXISTS trg_tasks_insert;
DROP TRIGGER IF EXISTS trg_tasks_update;
DROP TRIGGER IF EXISTS trg_lists_insert;
DROP TRIGGER IF EXISTS trg_lists_update;
DROP TRIGGER IF EXISTS trg_notes_insert;
DROP TRIGGER IF EXISTS trg_notes_update;
DROP TRIGGER IF EXISTS trg_drawings_insert;
DROP TRIGGER IF EXISTS trg_drawings_update;
DROP TRIGGER IF EXISTS trg_recordings_insert;
DROP TRIGGER IF EXISTS trg_recordings_update;
DROP TRIGGER IF EXISTS trg_events_insert;
DROP TRIGGER IF EXISTS trg_events_update;
DROP TRIGGER IF EXISTS trg_sessions_insert;
DROP TRIGGER IF EXISTS trg_sessions_update;
DROP TRIGGER IF EXISTS trg_alarms_insert;
DROP TRIGGER IF EXISTS trg_alarms_update;
DROP TRIGGER IF EXISTS trg_chat_messages_insert;
DROP TRIGGER IF EXISTS trg_chat_messages_update;
        ",
    )
    .map_err(|e| format!("Migration 0002 DROP TRIGGERS failed: {e}"))?;

    // Guarded check: add device_id to sync_outbox if missing
    let has_device_id: bool = {
        let mut stmt = tx
            .prepare("PRAGMA table_info(sync_outbox);")
            .map_err(|e| format!("Failed to inspect sync_outbox pragma: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                let col_name: String = row.get(1)?;
                Ok(col_name)
            })
            .map_err(|e| format!("Failed to query table_info: {e}"))?;
        let mut found = false;
        for name in rows.flatten() {
            if name == "device_id" {
                found = true;
                break;
            }
        }
        found
    };

    if !has_device_id {
        tx.execute("ALTER TABLE sync_outbox ADD COLUMN device_id TEXT;", [])
            .map_err(|e| format!("Migration 0002 ALTER TABLE failed: {e}"))?;
    }

    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2);",
        params![2, now],
    )
    .map_err(|e| format!("Failed to record schema version 2: {e}"))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit migration 0002: {e}"))?;

    Ok(())
}

fn apply_migration_0003(conn: &Connection) -> Result<(), String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start transaction for migration 0003: {e}"))?;

    tx.execute_batch(
        "
CREATE TABLE IF NOT EXISTS stt_history (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  duration_ms INTEGER,
  model_id TEXT,
  language TEXT,
  audio_path TEXT,
  saved INTEGER NOT NULL DEFAULT 0,
  app_name TEXT
);
CREATE INDEX IF NOT EXISTS idx_stt_history_created_at ON stt_history(created_at DESC);
        ",
    )
    .map_err(|e| format!("Migration 0003 DDL failed: {e}"))?;

    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2);",
        params![3, now],
    )
    .map_err(|e| format!("Failed to record schema version 3: {e}"))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit migration 0003: {e}"))?;

    Ok(())
}
fn apply_migration_0004(conn: &Connection) -> Result<(), String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start transaction for migration 0004: {e}"))?;

    let existing_cols: Vec<String> = {
        let mut stmt = tx
            .prepare("PRAGMA table_info(alarms);")
            .map_err(|e| format!("Failed to inspect alarms pragma: {e}"))?;
        let rows = stmt
            .query_map([], |row| row.get(1))
            .map_err(|e| format!("Failed to query table_info: {e}"))?;
        rows.flatten().collect()
    };

    if !existing_cols.contains(&"date".to_string()) {
        tx.execute("ALTER TABLE alarms ADD COLUMN date TEXT;", [])
            .map_err(|e| format!("Migration 0004 ALTER TABLE date failed: {e}"))?;
    }
    if !existing_cols.contains(&"interval_minutes".to_string()) {
        tx.execute("ALTER TABLE alarms ADD COLUMN interval_minutes INTEGER;", [])
            .map_err(|e| format!("Migration 0004 ALTER TABLE interval_minutes failed: {e}"))?;
    }
    if !existing_cols.contains(&"window_start".to_string()) {
        tx.execute("ALTER TABLE alarms ADD COLUMN window_start TEXT;", [])
            .map_err(|e| format!("Migration 0004 ALTER TABLE window_start failed: {e}"))?;
    }
    if !existing_cols.contains(&"window_end".to_string()) {
        tx.execute("ALTER TABLE alarms ADD COLUMN window_end TEXT;", [])
            .map_err(|e| format!("Migration 0004 ALTER TABLE window_end failed: {e}"))?;
    }

    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2);",
        params![4, now],
    )
    .map_err(|e| format!("Failed to record schema version 4: {e}"))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit migration 0004: {e}"))?;

    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn table_columns(conn: &Connection, table: &str) -> Vec<String> {
        let sql = format!("PRAGMA table_info({table});");
        let mut stmt = conn.prepare(&sql).unwrap();
        stmt.query_map([], |row| row.get(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    }

    fn migrated_db() -> (Connection, u32) {
        let conn = Connection::open_in_memory().unwrap();
        let version = migrate(&conn).unwrap();
        (conn, version)
    }

    #[test]
    fn test_migration_0002_adds_device_id_column() {
        let (conn, _) = migrated_db();
        let cols = table_columns(&conn, "sync_outbox");
        assert!(cols.contains(&"device_id".to_string()), "sync_outbox must contain device_id column");
    }

    #[test]
    fn test_migration_0003_creates_stt_history_table() {
        let (conn, version) = migrated_db();
        assert_eq!(version, 4);
        let cols = table_columns(&conn, "stt_history");
        assert!(cols.contains(&"id".to_string()));
        assert!(cols.contains(&"text".to_string()));
        assert!(cols.contains(&"created_at".to_string()));
        assert!(cols.contains(&"updated_at".to_string()));
        assert!(cols.contains(&"deleted_at".to_string()));
        assert!(cols.contains(&"duration_ms".to_string()));
        assert!(cols.contains(&"model_id".to_string()));
        assert!(cols.contains(&"language".to_string()));
        assert!(cols.contains(&"audio_path".to_string()));
        assert!(cols.contains(&"saved".to_string()));
        assert!(cols.contains(&"app_name".to_string()));
    }

    #[test]
    fn test_migration_0004_adds_alarm_columns() {
        let (conn, version) = migrated_db();
        assert_eq!(version, 4);
        let cols = table_columns(&conn, "alarms");
        assert!(cols.contains(&"date".to_string()));
        assert!(cols.contains(&"interval_minutes".to_string()));
        assert!(cols.contains(&"window_start".to_string()));
        assert!(cols.contains(&"window_end".to_string()));
    }

    #[test]
    fn test_migration_0004_preserves_old_alarms_and_reads_none() {
        let conn = Connection::open_in_memory().unwrap();
        // Run migration up to v3
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
        ).unwrap();
        apply_migration_0001(&conn).unwrap();
        apply_migration_0002(&conn).unwrap();
        apply_migration_0003(&conn).unwrap();

        // Insert legacy alarm without new columns
        conn.execute(
            "INSERT INTO alarms (id, label, time, days, repeat, enabled, sound, voice_prompt, note, updated_at)
             VALUES ('old1', 'Old Alarm', '07:30', '[]', 'daily', 1, 'gentle', NULL, NULL, '2026-01-01T00:00:00Z');",
            [],
        ).unwrap();

        // Migrate to v4
        let version = migrate(&conn).unwrap();
        assert_eq!(version, 4);

        // Read back via repo
        let loaded = crate::storage::repo::get(&conn, "alarms", "old1").unwrap().expect("alarm exists");
        assert_eq!(loaded["id"], "old1");
        assert_eq!(loaded["label"], "Old Alarm");
        assert_eq!(loaded["time"], "07:30");
        assert!(loaded["date"].is_null());
        assert!(loaded["interval_minutes"].is_null());
        assert!(loaded["window_start"].is_null());
        assert!(loaded["window_end"].is_null());
    }
}
