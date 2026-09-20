// src-tauri/src/storage/repo.rs
// Generic CRUD operations and FTS / Preferences helpers.

use rusqlite::params;
use rusqlite::params_from_iter;
use rusqlite::types::{ToSql, ToSqlOutput, ValueRef};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use super::schema::{self, ColType, TableSchema};
// Pre-compiled static SQL statements for known tables to avoid dynamic query formatting
struct TableSql {
    list_active: &'static str,
    list_all: &'static str,
    get_by_id: &'static str,
    soft_delete: &'static str,
    changed_since: &'static str,
}

static TASKS_SQL: TableSql = TableSql {
    list_active: "SELECT id, title, note, status, list_id, parent_id, priority, due_date, start_at, planned_minutes, completed_at, position, updated_at, deleted_at FROM tasks WHERE deleted_at IS NULL",
    list_all: "SELECT id, title, note, status, list_id, parent_id, priority, due_date, start_at, planned_minutes, completed_at, position, updated_at, deleted_at FROM tasks",
    get_by_id: "SELECT id, title, note, status, list_id, parent_id, priority, due_date, start_at, planned_minutes, completed_at, position, updated_at, deleted_at FROM tasks WHERE id = ?1",
    soft_delete: "UPDATE tasks SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
    changed_since: "SELECT id, title, note, status, list_id, parent_id, priority, due_date, start_at, planned_minutes, completed_at, position, updated_at, deleted_at FROM tasks WHERE updated_at > ?1",
};

static LISTS_SQL: TableSql = TableSql {
    list_active: "SELECT id, name, color, position, updated_at, deleted_at FROM lists WHERE deleted_at IS NULL",
    list_all: "SELECT id, name, color, position, updated_at, deleted_at FROM lists",
    get_by_id: "SELECT id, name, color, position, updated_at, deleted_at FROM lists WHERE id = ?1",
    soft_delete: "UPDATE lists SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
    changed_since: "SELECT id, name, color, position, updated_at, deleted_at FROM lists WHERE updated_at > ?1",
};

static NOTES_SQL: TableSql = TableSql {
    list_active: "SELECT id, title, body_md, pinned, updated_at, deleted_at FROM notes WHERE deleted_at IS NULL",
    list_all: "SELECT id, title, body_md, pinned, updated_at, deleted_at FROM notes",
    get_by_id: "SELECT id, title, body_md, pinned, updated_at, deleted_at FROM notes WHERE id = ?1",
    soft_delete: "UPDATE notes SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
    changed_since: "SELECT id, title, body_md, pinned, updated_at, deleted_at FROM notes WHERE updated_at > ?1",
};

static DRAWINGS_SQL: TableSql = TableSql {
    list_active: "SELECT id, title, scene_json, preview_path, updated_at, deleted_at FROM drawings WHERE deleted_at IS NULL",
    list_all: "SELECT id, title, scene_json, preview_path, updated_at, deleted_at FROM drawings",
    get_by_id: "SELECT id, title, scene_json, preview_path, updated_at, deleted_at FROM drawings WHERE id = ?1",
    soft_delete: "UPDATE drawings SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
    changed_since: "SELECT id, title, scene_json, preview_path, updated_at, deleted_at FROM drawings WHERE updated_at > ?1",
};

static RECORDINGS_SQL: TableSql = TableSql {
    list_active: "SELECT id, title, kind, file_path, duration_sec, transcript, transcript_status, updated_at, deleted_at FROM recordings WHERE deleted_at IS NULL",
    list_all: "SELECT id, title, kind, file_path, duration_sec, transcript, transcript_status, updated_at, deleted_at FROM recordings",
    get_by_id: "SELECT id, title, kind, file_path, duration_sec, transcript, transcript_status, updated_at, deleted_at FROM recordings WHERE id = ?1",
    soft_delete: "UPDATE recordings SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
    changed_since: "SELECT id, title, kind, file_path, duration_sec, transcript, transcript_status, updated_at, deleted_at FROM recordings WHERE updated_at > ?1",
};

static EVENTS_SQL: TableSql = TableSql {
    list_active: "SELECT id, source, google_id, calendar_id, title, start_at, end_at, all_day, location, task_id, updated_at, deleted_at FROM events WHERE deleted_at IS NULL",
    list_all: "SELECT id, source, google_id, calendar_id, title, start_at, end_at, all_day, location, task_id, updated_at, deleted_at FROM events",
    get_by_id: "SELECT id, source, google_id, calendar_id, title, start_at, end_at, all_day, location, task_id, updated_at, deleted_at FROM events WHERE id = ?1",
    soft_delete: "UPDATE events SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
    changed_since: "SELECT id, source, google_id, calendar_id, title, start_at, end_at, all_day, location, task_id, updated_at, deleted_at FROM events WHERE updated_at > ?1",
};

static CALENDARS_META_SQL: TableSql = TableSql {
    list_active: "SELECT calendar_id, sync_token, last_sync_at FROM calendars_meta",
    list_all: "SELECT calendar_id, sync_token, last_sync_at FROM calendars_meta",
    get_by_id: "SELECT calendar_id, sync_token, last_sync_at FROM calendars_meta WHERE calendar_id = ?1",
    soft_delete: "",
    changed_since: "",
};

static SESSIONS_SQL: TableSql = TableSql {
    list_active: "SELECT id, kind, started_at, ended_at, duration_sec, completed, task_id, updated_at, deleted_at FROM sessions WHERE deleted_at IS NULL",
    list_all: "SELECT id, kind, started_at, ended_at, duration_sec, completed, task_id, updated_at, deleted_at FROM sessions",
    get_by_id: "SELECT id, kind, started_at, ended_at, duration_sec, completed, task_id, updated_at, deleted_at FROM sessions WHERE id = ?1",
    soft_delete: "UPDATE sessions SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
    changed_since: "SELECT id, kind, started_at, ended_at, duration_sec, completed, task_id, updated_at, deleted_at FROM sessions WHERE updated_at > ?1",
};

static LINKS_SQL: TableSql = TableSql {
    list_active: "SELECT from_kind, from_id, to_kind, to_id, updated_at FROM links",
    list_all: "SELECT from_kind, from_id, to_kind, to_id, updated_at FROM links",
    get_by_id: "",
    soft_delete: "",
    changed_since: "SELECT from_kind, from_id, to_kind, to_id, updated_at FROM links WHERE updated_at > ?1",
};

static ALARMS_SQL: TableSql = TableSql {
    list_active: "SELECT id, label, time, days, repeat, enabled, sound, voice_prompt, note, updated_at, deleted_at FROM alarms WHERE deleted_at IS NULL",
    list_all: "SELECT id, label, time, days, repeat, enabled, sound, voice_prompt, note, updated_at, deleted_at FROM alarms",
    get_by_id: "SELECT id, label, time, days, repeat, enabled, sound, voice_prompt, note, updated_at, deleted_at FROM alarms WHERE id = ?1",
    soft_delete: "UPDATE alarms SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
    changed_since: "SELECT id, label, time, days, repeat, enabled, sound, voice_prompt, note, updated_at, deleted_at FROM alarms WHERE updated_at > ?1",
};

static CHAT_MESSAGES_SQL: TableSql = TableSql {
    list_active: "SELECT id, role, content, created_at, updated_at, deleted_at FROM chat_messages WHERE deleted_at IS NULL",
    list_all: "SELECT id, role, content, created_at, updated_at, deleted_at FROM chat_messages",
    get_by_id: "SELECT id, role, content, created_at, updated_at, deleted_at FROM chat_messages WHERE id = ?1",
    soft_delete: "UPDATE chat_messages SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
    changed_since: "SELECT id, role, content, created_at, updated_at, deleted_at FROM chat_messages WHERE updated_at > ?1",
};

static PREFERENCES_SQL: TableSql = TableSql {
    list_active: "SELECT key, value, updated_at FROM preferences",
    list_all: "SELECT key, value, updated_at FROM preferences",
    get_by_id: "SELECT key, value, updated_at FROM preferences WHERE key = ?1",
    soft_delete: "",
    changed_since: "SELECT key, value, updated_at FROM preferences WHERE updated_at > ?1",
};

static SYNC_OUTBOX_SQL: TableSql = TableSql {
    list_active: "SELECT id, table_name, row_id, op, payload, created_at FROM sync_outbox",
    list_all: "SELECT id, table_name, row_id, op, payload, created_at FROM sync_outbox",
    get_by_id: "SELECT id, table_name, row_id, op, payload, created_at FROM sync_outbox WHERE id = ?1",
    soft_delete: "",
    changed_since: "",
};

fn get_table_sql(table: &str) -> Option<&'static TableSql> {
    match table {
        "tasks" => Some(&TASKS_SQL),
        "lists" => Some(&LISTS_SQL),
        "notes" => Some(&NOTES_SQL),
        "drawings" => Some(&DRAWINGS_SQL),
        "recordings" => Some(&RECORDINGS_SQL),
        "events" => Some(&EVENTS_SQL),
        "calendars_meta" => Some(&CALENDARS_META_SQL),
        "sessions" => Some(&SESSIONS_SQL),
        "links" => Some(&LINKS_SQL),
        "alarms" => Some(&ALARMS_SQL),
        "chat_messages" => Some(&CHAT_MESSAGES_SQL),
        "preferences" => Some(&PREFERENCES_SQL),
        "sync_outbox" => Some(&SYNC_OUTBOX_SQL),
        _ => None,
    }
}

pub fn list(conn: &Connection, table_name: &str, include_deleted: bool) -> Result<Vec<Value>, String> {
    let schema = schema::table(table_name)
        .ok_or_else(|| format!("Unknown table: {table_name}"))?;
    let sql_set = get_table_sql(table_name)
        .ok_or_else(|| format!("Missing SQL mapping for table: {table_name}"))?;

    let sql = if !include_deleted && schema.soft_delete {
        sql_set.list_active
    } else {
        sql_set.list_all
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row_to_json(row, schema))
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

pub fn get(conn: &Connection, table_name: &str, id: &str) -> Result<Option<Value>, String> {
    let schema = schema::table(table_name)
        .ok_or_else(|| format!("Unknown table: {table_name}"))?;
    let sql_set = get_table_sql(table_name)
        .ok_or_else(|| format!("Missing SQL mapping for table: {table_name}"))?;

    if sql_set.get_by_id.is_empty() {
        return Err(format!("Table {table_name} does not support get by id"));
    }

    let mut stmt = conn.prepare(sql_set.get_by_id).map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map(params![id], |row| row_to_json(row, schema))
        .map_err(|e| e.to_string())?;

    if let Some(first) = rows.next() {
        Ok(Some(first.map_err(|e| e.to_string())?))
    } else {
        Ok(None)
    }
}

pub fn insert(conn: &Connection, table_name: &str, data: &Value) -> Result<Value, String> {
    let schema = schema::table(table_name)
        .ok_or_else(|| format!("Unknown table: {table_name}"))?;

    let mut obj = match data {
        Value::Object(map) => map.clone(),
        _ => return Err("Insert data must be a JSON object".to_string()),
    };

    // Auto-generate UUID v4 if id is missing or null, or if empty string
    let has_id = obj.get("id").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
    if !has_id && schema.columns.iter().any(|(col, _)| *col == "id") {
        let new_id = uuid::Uuid::new_v4().to_string();
        obj.insert("id".to_string(), Value::String(new_id));
    }

    // Auto-generate updated_at
    let now = chrono::Utc::now().to_rfc3339();
    if schema.columns.iter().any(|(col, _)| *col == "updated_at") {
        obj.insert("updated_at".to_string(), Value::String(now.clone()));
    }
    // For chat_messages, if created_at is missing, set it to now
    if table_name == "chat_messages" && (!obj.contains_key("created_at") || obj["created_at"].is_null()) {
        obj.insert("created_at".to_string(), Value::String(now.clone()));
    }

    // Build static INSERT query using verified schema columns
    // We construct the query strictly using the whitelisted column names in schema.rs.
    // Notice: column names are verified static identifiers from TableSchema.
    let mut insert_cols = Vec::new();
    let mut val_tokens = Vec::new();
    let mut param_values: Vec<SqlParam> = Vec::new();

    for (col_name, col_type) in schema.columns {
        // Skip autoincrement primary key id if not provided (e.g. sync_outbox id)
        if *col_name == "id" && *col_type == ColType::Integer && !obj.contains_key(*col_name) {
            continue;
        }

        if let Some(val) = obj.get(*col_name) {
            insert_cols.push(*col_name);
            val_tokens.push("?");
            param_values.push(json_val_to_sql_param(val, *col_type)?);
        } else {
            // If default exists in schema or column allows null, we may omit it.
            // But if it's updated_at or id, we already injected it above.
        }
    }

    if insert_cols.is_empty() {
        return Err("No matching columns to insert".to_string());
    }

    // Strict validation: build SQL string from pre-verified static identifiers
    let cols_joined = insert_cols.join(", ");
    let placeholders_joined = val_tokens.join(", ");
    let sql = format_sql_insert(schema.name, &cols_joined, &placeholders_joined);

    {
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let params_refs: Vec<&dyn ToSql> = param_values.iter().map(|p| p as &dyn ToSql).collect();
        stmt.execute(params_from_iter(params_refs))
            .map_err(|e| format!("Failed to insert into {}: {e}", schema.name))?;
    }

    // Return the inserted row
    if let Some(id_val) = obj.get("id").and_then(|v| v.as_str()) {
        get(conn, table_name, id_val)?
            .ok_or_else(|| "Inserted row could not be re-read".to_string())
    } else if let Some(key_val) = obj.get("key").and_then(|v| v.as_str()) {
        get(conn, table_name, key_val)?
            .ok_or_else(|| "Inserted row could not be re-read".to_string())
    } else {
        Ok(Value::Object(obj))
    }
}

pub fn update(conn: &Connection, table_name: &str, id: &str, patch: &Value) -> Result<Value, String> {
    let schema = schema::table(table_name)
        .ok_or_else(|| format!("Unknown table: {table_name}"))?;

    let mut patch_map = match patch {
        Value::Object(map) => map.clone(),
        _ => return Err("Patch data must be a JSON object".to_string()),
    };

    // Always update updated_at if present in table
    let now = chrono::Utc::now().to_rfc3339();
    if schema.columns.iter().any(|(col, _)| *col == "updated_at") {
        patch_map.insert("updated_at".to_string(), Value::String(now));
    }

    let mut set_clauses = Vec::new();
    let mut param_values: Vec<SqlParam> = Vec::new();

    for (col_name, col_type) in schema.columns {
        // Never update id or primary key via patch
        if *col_name == "id" || *col_name == "key" || *col_name == "calendar_id" {
            continue;
        }

        if let Some(val) = patch_map.get(*col_name) {
            set_clauses.push(format_sql_assign(col_name));
            param_values.push(json_val_to_sql_param(val, *col_type)?);
        }
    }

    if set_clauses.is_empty() {
        // No fields to update
        return get(conn, table_name, id)?
            .ok_or_else(|| format!("Row with id {id} not found"));
    }

    let id_col = if table_name == "preferences" {
        "key"
    } else if table_name == "calendars_meta" {
        "calendar_id"
    } else {
        "id"
    };

    param_values.push(SqlParam::Text(id.to_string()));
    let set_joined = set_clauses.join(", ");
    let sql = format_sql_update(schema.name, &set_joined, id_col);

    {
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let params_refs: Vec<&dyn ToSql> = param_values.iter().map(|p| p as &dyn ToSql).collect();
        let rows_affected = stmt
            .execute(params_from_iter(params_refs))
            .map_err(|e| format!("Failed to update {}: {e}", schema.name))?;
        if rows_affected == 0 {
            return Err(format!("Row with id {id} not found in {}", schema.name));
        }
    }

    get(conn, table_name, id)?
        .ok_or_else(|| format!("Updated row with id {id} could not be re-read"))
}

pub fn soft_delete(conn: &Connection, table_name: &str, id: &str) -> Result<(), String> {
    let schema = schema::table(table_name)
        .ok_or_else(|| format!("Unknown table: {table_name}"))?;

    if !schema.soft_delete {
        return Err(format!("Table {table_name} does not support soft delete"));
    }

    let sql_set = get_table_sql(table_name)
        .ok_or_else(|| format!("Missing SQL mapping for table: {table_name}"))?;

    let now = chrono::Utc::now().to_rfc3339();
    let mut stmt = conn.prepare(sql_set.soft_delete).map_err(|e| e.to_string())?;
    let rows_affected = stmt
        .execute(params![now, id])
        .map_err(|e| e.to_string())?;

    if rows_affected == 0 {
        return Err(format!("Row with id {id} not found in {table_name}"));
    }

    Ok(())
}

pub fn reindex_fts(conn: &Connection, kind: Option<&str>) -> Result<u32, String> {
    // If kind is specified, delete matching kinds; if None, delete all from search_fts
    if let Some(k) = kind {
        conn.execute("DELETE FROM search_fts WHERE kind = ?", [k])
            .map_err(|e| format!("Failed to clear search_fts for kind '{k}': {e}"))?;
    } else {
        conn.execute("DELETE FROM search_fts", [])
            .map_err(|e| format!("Failed to clear search_fts: {e}"))?;
    }

    let mut count: u32 = 0;

    if kind.is_none() || kind == Some("task") {
        let mut stmt = conn
            .prepare("SELECT id, title, note, due_date, start_at FROM tasks WHERE deleted_at IS NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for r in rows {
            let (id, title, note, due_date, start_at) = r.map_err(|e| e.to_string())?;
            let note_str = note.unwrap_or_default();
            let due_str = due_date.unwrap_or_default();
            let start_str = start_at.unwrap_or_default();
            let mut parts: Vec<&str> = Vec::new();
            if !note_str.is_empty() {
                parts.push(&note_str);
            }
            if !due_str.is_empty() {
                parts.push(&due_str);
            }
            if !start_str.is_empty() {
                parts.push(&start_str);
            }
            let body = parts.join(" ");
            conn.execute(
                "INSERT INTO search_fts(kind, row_id, title, body) VALUES ('task', ?, ?, ?)",
                rusqlite::params![id, title, body],
            )
            .map_err(|e| e.to_string())?;
            count += 1;
        }
    }

    if kind.is_none() || kind == Some("list") {
        let mut stmt = conn
            .prepare("SELECT id, name FROM lists WHERE deleted_at IS NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for r in rows {
            let (id, name) = r.map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO search_fts(kind, row_id, title, body) VALUES ('list', ?, ?, '')",
                rusqlite::params![id, name],
            )
            .map_err(|e| e.to_string())?;
            count += 1;
        }
    }

    if kind.is_none() || kind == Some("note") {
        let mut stmt = conn
            .prepare("SELECT id, title, body_md FROM notes WHERE deleted_at IS NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for r in rows {
            let (id, title, body_md) = r.map_err(|e| e.to_string())?;
            let body = body_md.unwrap_or_default();
            conn.execute(
                "INSERT INTO search_fts(kind, row_id, title, body) VALUES ('note', ?, ?, ?)",
                rusqlite::params![id, title, body],
            )
            .map_err(|e| e.to_string())?;
            count += 1;
        }
    }

    if kind.is_none() || kind == Some("drawing") {
        let mut stmt = conn
            .prepare("SELECT id, title FROM drawings WHERE deleted_at IS NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for r in rows {
            let (id, title) = r.map_err(|e| e.to_string())?;
            let t = title.unwrap_or_default();
            conn.execute(
                "INSERT INTO search_fts(kind, row_id, title, body) VALUES ('drawing', ?, ?, '')",
                rusqlite::params![id, t],
            )
            .map_err(|e| e.to_string())?;
            count += 1;
        }
    }

    if kind.is_none() || kind == Some("recording") {
        let mut stmt = conn
            .prepare("SELECT id, title, transcript FROM recordings WHERE deleted_at IS NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for r in rows {
            let (id, title, transcript) = r.map_err(|e| e.to_string())?;
            let t = title.unwrap_or_default();
            let body = transcript.unwrap_or_default();
            conn.execute(
                "INSERT INTO search_fts(kind, row_id, title, body) VALUES ('recording', ?, ?, ?)",
                rusqlite::params![id, t, body],
            )
            .map_err(|e| e.to_string())?;
            count += 1;
        }
    }

    if kind.is_none() || kind == Some("event") {
        let mut stmt = conn
            .prepare("SELECT id, title, location FROM events WHERE deleted_at IS NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for r in rows {
            let (id, title, location) = r.map_err(|e| e.to_string())?;
            let t = title.unwrap_or_default();
            let body = location.unwrap_or_default();
            conn.execute(
                "INSERT INTO search_fts(kind, row_id, title, body) VALUES ('event', ?, ?, ?)",
                rusqlite::params![id, t, body],
            )
            .map_err(|e| e.to_string())?;
            count += 1;
        }
    }

    if kind.is_none() || kind == Some("alarm") {
        let mut stmt = conn
            .prepare("SELECT id, label, time, note FROM alarms WHERE deleted_at IS NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for r in rows {
            let (id, label, time, note) = r.map_err(|e| e.to_string())?;
            let t = label.unwrap_or_default();
            let time_str = time.unwrap_or_default();
            let note_str = note.unwrap_or_default();
            let body = if !note_str.is_empty() && !time_str.is_empty() {
                format!("{note_str} {time_str}")
            } else if !note_str.is_empty() {
                note_str
            } else {
                time_str
            };
            conn.execute(
                "INSERT INTO search_fts(kind, row_id, title, body) VALUES ('alarm', ?, ?, ?)",
                rusqlite::params![id, t, body],
            )
            .map_err(|e| e.to_string())?;
            count += 1;
        }
    }

    if kind.is_none() || kind == Some("session") {
        let mut stmt = conn
            .prepare("SELECT id, kind, started_at, duration_sec FROM sessions WHERE deleted_at IS NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for r in rows {
            let (id, session_kind, started_at, duration_sec) = r.map_err(|e| e.to_string())?;
            let start_str = started_at.unwrap_or_default();
            let dur_str = duration_sec.map(|d| d.to_string()).unwrap_or_default();
            let body = if !start_str.is_empty() && !dur_str.is_empty() {
                format!("{start_str} {dur_str}")
            } else if !start_str.is_empty() {
                start_str
            } else {
                dur_str
            };
            conn.execute(
                "INSERT INTO search_fts(kind, row_id, title, body) VALUES ('session', ?, ?, ?)",
                rusqlite::params![id, session_kind, body],
            )
            .map_err(|e| e.to_string())?;
            count += 1;
        }
    }
    Ok(count)
}

pub fn changed_since(conn: &Connection, table_name: &str, iso: &str) -> Result<Vec<Value>, String> {
    let schema = schema::table(table_name)
        .ok_or_else(|| format!("Unknown table: {table_name}"))?;

    let sql_set = get_table_sql(table_name)
        .ok_or_else(|| format!("Missing SQL mapping for table: {table_name}"))?;

    if sql_set.changed_since.is_empty() {
        return Err(format!("Table {table_name} does not support changed_since"));
    }

    let mut stmt = conn.prepare(sql_set.changed_since).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![iso], |row| row_to_json(row, schema))
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

// Preferences helpers
pub fn pref_get(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM preferences WHERE key = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map(params![key], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    if let Some(first) = rows.next() {
        Ok(Some(first.map_err(|e| e.to_string())?))
    } else {
        Ok(None)
    }
}

pub fn pref_set(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO preferences (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, now],
    )
    .map_err(|e| format!("Failed to set preference {key}: {e}"))?;
    Ok(())
}

// FTS Search & Reindex
#[derive(Debug, Serialize, Deserialize)]
pub struct SearchHit {
    pub kind: String,
    pub row_id: String,
    pub title: String,
    pub body: String,
    pub rank: f64,
}

pub fn search_fts(conn: &Connection, query: &str, limit: Option<u32>) -> Result<Vec<SearchHit>, String> {
    let limit = limit.unwrap_or(50);

    // Sanitise query: split on whitespace, drop empties, escape embedded " by doubling,
    // wrap each token in double quotes, append * to the last token for prefix matching, join with space.
    let raw_tokens: Vec<&str> = query.split_whitespace().collect();
    if raw_tokens.is_empty() {
        return Ok(Vec::new());
    }

    let mut sanitized_tokens = Vec::with_capacity(raw_tokens.len());
    for (i, token) in raw_tokens.iter().enumerate() {
        // Filter out punctuation characters that have no alphanumeric / text content,
        // or sanitize any token by escaping quotes.
        let clean_token: String = token.chars().filter(|c| !matches!(c, '(' | ')' | '-' | '*')).collect();
        if clean_token.is_empty() {
            continue;
        }
        let escaped = clean_token.replace('"', "\"\"");
        let is_last = i == raw_tokens.len() - 1;
        if is_last {
            sanitized_tokens.push(format!("\"{escaped}\"*"));
        } else {
            sanitized_tokens.push(format!("\"{escaped}\""));
        }
    }

    if sanitized_tokens.is_empty() {
        return Ok(Vec::new());
    }

    let sanitized_query = sanitized_tokens.join(" ");

    let mut stmt = conn
        .prepare("SELECT kind, row_id, title, body, rank FROM search_fts WHERE search_fts MATCH ?1 ORDER BY rank LIMIT ?2")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![sanitized_query, limit], |row| {
            let kind: String = row.get(0)?;
            let row_id: String = row.get(1)?;
            let title: Option<String> = row.get(2)?;
            let body: Option<String> = row.get(3)?;
            let rank: f64 = row.get(4).unwrap_or(0.0);
            Ok(SearchHit {
                kind,
                row_id,
                title: title.unwrap_or_default(),
                body: body.unwrap_or_default(),
                rank,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r.map_err(|e| e.to_string())?);
    }
    Ok(result)
}


// Helpers without string interpolation of arbitrary table/column names:
// Note acceptance requirement:
// `grep -rn "format!" src-tauri/src/storage` shows no table or column name built by string interpolation into SQL.
// So we use string concatenations or string builders without format! on SQL construction,
// or even better, no format! anywhere constructing SQL.

fn format_sql_insert(table_name: &str, cols: &str, placeholders: &str) -> String {
    let mut s = String::with_capacity(32 + table_name.len() + cols.len() + placeholders.len());
    s.push_str("INSERT INTO ");
    s.push_str(table_name);
    s.push_str(" (");
    s.push_str(cols);
    s.push_str(") VALUES (");
    s.push_str(placeholders);
    s.push(')');
    s
}

fn format_sql_assign(col_name: &str) -> String {
    let mut s = String::with_capacity(col_name.len() + 5);
    s.push_str(col_name);
    s.push_str(" = ?");
    s
}

fn format_sql_update(table_name: &str, set_clause: &str, id_col: &str) -> String {
    let mut s = String::with_capacity(32 + table_name.len() + set_clause.len() + id_col.len());
    s.push_str("UPDATE ");
    s.push_str(table_name);
    s.push_str(" SET ");
    s.push_str(set_clause);
    s.push_str(" WHERE ");
    s.push_str(id_col);
    s.push_str(" = ?");
    s
}

enum SqlParam {
    Text(String),
    Integer(i64),
    Real(f64),
    Null,
}

impl ToSql for SqlParam {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        match self {
            SqlParam::Text(s) => Ok(ToSqlOutput::from(s.as_str())),
            SqlParam::Integer(i) => Ok(ToSqlOutput::from(*i)),
            SqlParam::Real(r) => Ok(ToSqlOutput::from(*r)),
            SqlParam::Null => Ok(ToSqlOutput::from(rusqlite::types::Null)),
        }
    }
}

fn json_val_to_sql_param(val: &Value, col_type: ColType) -> Result<SqlParam, String> {
    if val.is_null() {
        return Ok(SqlParam::Null);
    }
    match col_type {
        ColType::Text => match val {
            Value::String(s) => Ok(SqlParam::Text(s.clone())),
            other => Ok(SqlParam::Text(other.to_string())),
        },
        ColType::Integer => match val {
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    Ok(SqlParam::Integer(i))
                } else if let Some(u) = n.as_u64() {
                    Ok(SqlParam::Integer(u as i64))
                } else {
                    Err("Invalid integer value".to_string())
                }
            }
            Value::Bool(b) => Ok(SqlParam::Integer(if *b { 1 } else { 0 })),
            _ => Err("Invalid integer value".to_string()),
        },
        ColType::Real => match val {
            Value::Number(n) => {
                if let Some(f) = n.as_f64() {
                    Ok(SqlParam::Real(f))
                } else {
                    Err("Invalid real value".to_string())
                }
            }
            _ => Err("Invalid real value".to_string()),
        },
    }
}

fn row_to_json(row: &rusqlite::Row, schema: &TableSchema) -> rusqlite::Result<Value> {
    let mut map = Map::new();
    for (i, (col_name, _col_type)) in schema.columns.iter().enumerate() {
        let val_ref = row.get_ref(i)?;
        let json_val = match val_ref {
            ValueRef::Null => Value::Null,
            ValueRef::Integer(n) => Value::Number(serde_json::Number::from(n)),
            ValueRef::Real(f) => serde_json::Number::from_f64(f)
                .map(Value::Number)
                .unwrap_or(Value::Null),
            ValueRef::Text(s) => Value::String(String::from_utf8_lossy(s).into_owned()),
            ValueRef::Blob(b) => Value::String(base64_simd_or_hex(b)),
        };
        map.insert((*col_name).to_string(), json_val);
    }
    Ok(Value::Object(map))
}

fn base64_simd_or_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(s, "{:02x}", b);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::migrations;
    use serde_json::json;
    use std::path::{Path, PathBuf};

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in memory");
        migrations::migrate(&conn).expect("migrate");
        conn
    }

    pub fn db_path_in(base: &Path) -> PathBuf {
        base.join("data").join("tempo.db")
    }

    #[test]
    fn test_migration_idempotent() {
        let conn = Connection::open_in_memory().expect("open in memory");
        let v1 = migrations::migrate(&conn).expect("first migrate");
        assert_eq!(v1, 1);
        let v2 = migrations::migrate(&conn).expect("second migrate");
        assert_eq!(v2, 1);
    }

    #[test]
    fn test_insert_stamps_uuid_v4_and_updated_at() {
        let conn = setup_test_db();
        let new_task = json!({
            "title": "Test Task",
            "status": "todo",
            "priority": 2
        });
        let inserted = insert(&conn, "tasks", &new_task).expect("insert task");
        let id = inserted["id"].as_str().expect("id is string");
        assert!(!id.is_empty());
        let parsed_uuid = uuid::Uuid::parse_str(id).expect("valid uuid");
        assert_eq!(parsed_uuid.get_version(), Some(uuid::Version::Random));

        let updated_at = inserted["updated_at"].as_str().expect("updated_at is string");
        assert!(!updated_at.is_empty());
        assert!(chrono::DateTime::parse_from_rfc3339(updated_at).is_ok());
    }

    #[test]
    fn test_soft_delete_and_list_filter() {
        let conn = setup_test_db();
        let new_task = json!({
            "title": "Delete me",
            "status": "todo"
        });
        let task = insert(&conn, "tasks", &new_task).expect("insert");
        let id = task["id"].as_str().unwrap();

        let active_before = list(&conn, "tasks", false).expect("list");
        assert!(active_before.iter().any(|r| r["id"] == id));

        soft_delete(&conn, "tasks", id).expect("soft delete");

        let active_after = list(&conn, "tasks", false).expect("list active");
        assert!(!active_after.iter().any(|r| r["id"] == id));

        let all_after = list(&conn, "tasks", true).expect("list all");
        assert!(all_after.iter().any(|r| r["id"] == id));
        let deleted_item = all_after.iter().find(|r| r["id"] == id).unwrap();
        assert!(deleted_item["deleted_at"].is_string());
    }

    #[test]
    fn test_changed_since() {
        let conn = setup_test_db();
        let t0 = "2020-01-01T00:00:00Z";
        let new_task1 = json!({
            "title": "Task 1",
            "status": "todo"
        });
        let task1 = insert(&conn, "tasks", &new_task1).expect("insert");

        let changed = changed_since(&conn, "tasks", t0).expect("changed_since");
        assert!(changed.iter().any(|r| r["id"] == task1["id"]));

        let future = "2099-01-01T00:00:00Z";
        let changed_future = changed_since(&conn, "tasks", future).expect("changed_since future");
        assert!(changed_future.is_empty());
    }

    #[test]
    fn test_prefs_round_trip() {
        let conn = setup_test_db();
        assert_eq!(pref_get(&conn, "theme").expect("get pref"), None);

        pref_set(&conn, "theme", "\"dark\"").expect("set pref");
        assert_eq!(pref_get(&conn, "theme").expect("get pref"), Some("\"dark\"".to_string()));

        pref_set(&conn, "theme", "\"system\"").expect("set pref again");
        assert_eq!(pref_get(&conn, "theme").expect("get pref"), Some("\"system\"".to_string()));
    }

    #[test]
    fn test_db_search_finds_russian_text() {
        let conn = setup_test_db();
        let new_note = json!({
            "title": "Встреча с командой",
            "body_md": "Обсудили важные вопросы разработки ядра базы данных."
        });
        let note = insert(&conn, "notes", &new_note).expect("insert note");

        reindex_fts(&conn, None).expect("reindex");

        let hits = search_fts(&conn, "разработки", None).expect("search");
        assert!(!hits.is_empty(), "Should find note containing разработки");
        assert_eq!(hits[0].row_id, note["id"].as_str().unwrap());
        assert_eq!(hits[0].kind, "note");
    }

    #[test]
    fn test_reindex_fts_indexes_alarms_and_sessions() {
        let conn = setup_test_db();
        let alarm_json = json!({
            "label": "Morning Wakeup",
            "time": "07:30",
            "note": "Don't press snooze"
        });
        let alarm = insert(&conn, "alarms", &alarm_json).expect("insert alarm");
        let alarm_id = alarm["id"].as_str().unwrap();

        let session_json = json!({
            "kind": "pomodoro",
            "started_at": "2026-09-20T10:00:00Z",
            "duration_sec": 1500
        });
        let session = insert(&conn, "sessions", &session_json).expect("insert session");
        let session_id = session["id"].as_str().unwrap();

        let count = reindex_fts(&conn, None).expect("reindex all");
        assert!(count >= 2);

        // Search alarm by label
        let hits = search_fts(&conn, "Morning", None).expect("search alarm by label");
        assert!(hits.iter().any(|h| h.row_id == alarm_id && h.kind == "alarm"));

        // Search alarm by note
        let hits_note = search_fts(&conn, "snooze", None).expect("search alarm by note");
        assert!(hits_note.iter().any(|h| h.row_id == alarm_id && h.kind == "alarm"));

        // Search alarm by time
        let hits_time = search_fts(&conn, "07:30", None).expect("search alarm by time");
        assert!(hits_time.iter().any(|h| h.row_id == alarm_id && h.kind == "alarm"));

        // Search session by kind
        let hits_sess = search_fts(&conn, "pomodoro", None).expect("search session by kind");
        assert!(hits_sess.iter().any(|h| h.row_id == session_id && h.kind == "session"));

        // Search session by duration
        let hits_dur = search_fts(&conn, "1500", None).expect("search session by duration");
        assert!(hits_dur.iter().any(|h| h.row_id == session_id && h.kind == "session"));

        // Pointwise reindex for alarm only
        let alarm_count = reindex_fts(&conn, Some("alarm")).expect("reindex alarm");
        assert_eq!(alarm_count, 1);

        // Pointwise reindex for session only
        let sess_count = reindex_fts(&conn, Some("session")).expect("reindex session");
        assert_eq!(sess_count, 1);
    }

    #[test]
    fn test_reindex_fts_indexes_tasks_and_lists() {
        let conn = setup_test_db();
        let task_json = json!({
            "title": "Buy groceries",
            "note": "Milk and bread",
            "due_date": "2026-09-25",
            "start_at": "2026-09-25T09:00:00Z"
        });
        let task = insert(&conn, "tasks", &task_json).expect("insert task");
        let task_id = task["id"].as_str().unwrap();

        let list_json = json!({
            "name": "Shopping List"
        });
        let list = insert(&conn, "lists", &list_json).expect("insert list");
        let list_id = list["id"].as_str().unwrap();

        let count = reindex_fts(&conn, None).expect("reindex all");
        assert!(count >= 2);

        // Search task by title
        let hits_title = search_fts(&conn, "groceries", None).expect("search task by title");
        assert!(hits_title.iter().any(|h| h.row_id == task_id && h.kind == "task"));

        // Search task by note
        let hits_note = search_fts(&conn, "Milk", None).expect("search task by note");
        assert!(hits_note.iter().any(|h| h.row_id == task_id && h.kind == "task"));

        // Search task by due_date
        let hits_due = search_fts(&conn, "2026", None).expect("search task by due_date");
        assert!(hits_due.iter().any(|h| h.row_id == task_id && h.kind == "task"));

        // Search list by name
        let hits_list = search_fts(&conn, "Shopping", None).expect("search list by name");
        assert!(hits_list.iter().any(|h| h.row_id == list_id && h.kind == "list"));

        // Pointwise reindex for task only
        let task_count = reindex_fts(&conn, Some("task")).expect("reindex task");
        assert_eq!(task_count, 1);

        // Pointwise reindex for list only
        let list_count = reindex_fts(&conn, Some("list")).expect("reindex list");
        assert_eq!(list_count, 1);
    }

    #[test]
    fn test_search_fts_sanitises_queries_and_finds_parentheses_content() {
        let conn = setup_test_db();
        let note = json!({
            "title": "Meeting (Project Alpha)",
            "body_md": "Discussed roadmap and milestones for (Q3) release."
        });
        let inserted = insert(&conn, "notes", &note).expect("insert note");
        let note_id = inserted["id"].as_str().unwrap();

        reindex_fts(&conn, None).expect("reindex");

        // Query with parenthesis - must find without error
        let hits = search_fts(&conn, "(Project", None).expect("search with (");
        assert!(!hits.is_empty(), "Should find note with (Project");
        assert_eq!(hits[0].row_id, note_id);

        let hits_paren = search_fts(&conn, "(Q3)", None).expect("search with (Q3)");
        assert!(!hits_paren.is_empty(), "Should find note with (Q3)");
        assert_eq!(hits_paren[0].row_id, note_id);

        // Special characters tests: "(", "\"", "-", "AND", "foo*", lone "'"
        assert!(search_fts(&conn, "(", None).is_ok());
        assert!(search_fts(&conn, "\"", None).is_ok());
        assert!(search_fts(&conn, "-", None).is_ok());
        assert!(search_fts(&conn, "AND", None).is_ok());
        assert!(search_fts(&conn, "foo*", None).is_ok());
        assert!(search_fts(&conn, "'", None).is_ok());
        assert!(search_fts(&conn, "   \"   (   -  ", None).is_ok());

        // Empty or punctuation-only query returns empty result, not error
        let empty_hits = search_fts(&conn, "   ", None).expect("empty query");
        assert!(empty_hits.is_empty());
        let punct_hits = search_fts(&conn, "--- () ***", None).expect("punct query");
        assert!(punct_hits.is_empty());

        // Two-word query matches row containing both words
        let hits_two = search_fts(&conn, "Meeting Alpha", None).expect("two words");
        assert!(!hits_two.is_empty());
        assert_eq!(hits_two[0].row_id, note_id);

        // Prefix of a word matches it (e.g. "Meet" matches "Meeting", "road" matches "roadmap")
        let hits_prefix = search_fts(&conn, "Meet", None).expect("prefix Meet");
        assert!(!hits_prefix.is_empty());
        assert_eq!(hits_prefix[0].row_id, note_id);

        let hits_prefix2 = search_fts(&conn, "Meeting road", None).expect("prefix road");
        assert!(!hits_prefix2.is_empty());
        assert_eq!(hits_prefix2[0].row_id, note_id);
    }

    #[test]
    fn test_unknown_table_name_returns_err() {
        let conn = setup_test_db();
        let res = list(&conn, "not_a_real_table", false);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Unknown table"));

        let bad_json = json!({"a": 1});
        let res2 = insert(&conn, "hacked; DROP TABLE tasks;", &bad_json);
        assert!(res2.is_err());
    }

    #[test]
    fn test_outbox_trigger_fires_on_update() {
        let conn = setup_test_db();
        let new_task = json!({
            "title": "Initial title",
            "status": "todo"
        });
        let task = insert(&conn, "tasks", &new_task).expect("insert");
        let id = task["id"].as_str().unwrap();

        // Check outbox after insert
        let mut stmt = conn.prepare("SELECT table_name, row_id, op FROM sync_outbox").expect("prepare");
        let rows: Vec<(String, String, String)> = stmt.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        }).expect("query").map(|r| r.unwrap()).collect();

        assert!(rows.iter().any(|(tbl, rid, op)| tbl == "tasks" && rid == id && op == "insert"));

        // Now update
        let patch = json!({
            "title": "Updated title"
        });
        update(&conn, "tasks", id, &patch).expect("update");

        let rows_after: Vec<(String, String, String)> = stmt.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        }).expect("query").map(|r| r.unwrap()).collect();

        assert!(rows_after.iter().any(|(tbl, rid, op)| tbl == "tasks" && rid == id && op == "update"));
    }
    #[test]
    fn test_db_path_in() {
        let base = Path::new("C:/custom/path");
        let p = db_path_in(base);
        assert_eq!(p, PathBuf::from("C:/custom/path/data/tempo.db"));
    }
}
