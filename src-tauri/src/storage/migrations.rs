// src-tauri/src/storage/migrations.rs
// DDL versioning and idempotent migration runner.

use rusqlite::{params, Connection};

pub const SCHEMA_VERSION_LATEST: u32 = 1;

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
  file_path TEXT NOT NULL, duration_sec INTEGER, transcript TEXT, transcript_status TEXT,
  updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, source TEXT NOT NULL,   -- local | google
  google_id TEXT, calendar_id TEXT, title TEXT, start_at TEXT, end_at TEXT,
  all_day INTEGER DEFAULT 0, location TEXT, task_id TEXT,
  updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS calendars_meta (calendar_id TEXT PRIMARY KEY, sync_token TEXT, last_sync_at TEXT);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, kind TEXT NOT NULL,    -- pomodoro | stopwatch
  started_at TEXT, ended_at TEXT, duration_sec INTEGER, completed INTEGER, task_id TEXT,
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
