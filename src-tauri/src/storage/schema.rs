// src-tauri/src/storage/schema.rs
// Single whitelist for table schemas: table names, column names, column types, and soft-delete flags.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColType {
    Text,
    Integer,
    Real,
}

#[derive(Debug, Clone)]
pub struct TableSchema {
    pub name: &'static str,
    pub columns: &'static [(&'static str, ColType)],
    pub soft_delete: bool,
}

static TASKS_COLS: &[(&str, ColType)] = &[
    ("id", ColType::Text),
    ("title", ColType::Text),
    ("note", ColType::Text),
    ("status", ColType::Text),
    ("list_id", ColType::Text),
    ("parent_id", ColType::Text),
    ("priority", ColType::Integer),
    ("due_date", ColType::Text),
    ("start_at", ColType::Text),
    ("planned_minutes", ColType::Integer),
    ("completed_at", ColType::Text),
    ("position", ColType::Real),
    ("updated_at", ColType::Text),
    ("deleted_at", ColType::Text),
];

static LISTS_COLS: &[(&str, ColType)] = &[
    ("id", ColType::Text),
    ("name", ColType::Text),
    ("color", ColType::Text),
    ("position", ColType::Real),
    ("updated_at", ColType::Text),
    ("deleted_at", ColType::Text),
];

static NOTES_COLS: &[(&str, ColType)] = &[
    ("id", ColType::Text),
    ("title", ColType::Text),
    ("body_md", ColType::Text),
    ("pinned", ColType::Integer),
    ("updated_at", ColType::Text),
    ("deleted_at", ColType::Text),
];

static DRAWINGS_COLS: &[(&str, ColType)] = &[
    ("id", ColType::Text),
    ("title", ColType::Text),
    ("scene_json", ColType::Text),
    ("preview_path", ColType::Text),
    ("updated_at", ColType::Text),
    ("deleted_at", ColType::Text),
];

static RECORDINGS_COLS: &[(&str, ColType)] = &[
    ("id", ColType::Text),
    ("title", ColType::Text),
    ("kind", ColType::Text),
    ("file_path", ColType::Text),
    ("duration_sec", ColType::Real),
    ("transcript", ColType::Text),
    ("transcript_status", ColType::Text),
    ("updated_at", ColType::Text),
    ("deleted_at", ColType::Text),
];

static EVENTS_COLS: &[(&str, ColType)] = &[
    ("id", ColType::Text),
    ("source", ColType::Text),
    ("google_id", ColType::Text),
    ("calendar_id", ColType::Text),
    ("title", ColType::Text),
    ("start_at", ColType::Text),
    ("end_at", ColType::Text),
    ("all_day", ColType::Integer),
    ("location", ColType::Text),
    ("task_id", ColType::Text),
    ("updated_at", ColType::Text),
    ("deleted_at", ColType::Text),
];

static CALENDARS_META_COLS: &[(&str, ColType)] = &[
    ("calendar_id", ColType::Text),
    ("sync_token", ColType::Text),
    ("last_sync_at", ColType::Text),
];

static SESSIONS_COLS: &[(&str, ColType)] = &[
    ("id", ColType::Text),
    ("kind", ColType::Text),
    ("started_at", ColType::Text),
    ("ended_at", ColType::Text),
    ("duration_sec", ColType::Real),
    ("completed", ColType::Integer),
    ("task_id", ColType::Text),
    ("updated_at", ColType::Text),
    ("deleted_at", ColType::Text),
];

static LINKS_COLS: &[(&str, ColType)] = &[
    ("from_kind", ColType::Text),
    ("from_id", ColType::Text),
    ("to_kind", ColType::Text),
    ("to_id", ColType::Text),
    ("updated_at", ColType::Text),
];

static ALARMS_COLS: &[(&str, ColType)] = &[
    ("id", ColType::Text),
    ("label", ColType::Text),
    ("time", ColType::Text),
    ("days", ColType::Text),
    ("repeat", ColType::Text),
    ("enabled", ColType::Integer),
    ("sound", ColType::Text),
    ("voice_prompt", ColType::Text),
    ("note", ColType::Text),
    ("updated_at", ColType::Text),
    ("deleted_at", ColType::Text),
];

static CHAT_MESSAGES_COLS: &[(&str, ColType)] = &[
    ("id", ColType::Text),
    ("role", ColType::Text),
    ("content", ColType::Text),
    ("created_at", ColType::Text),
    ("updated_at", ColType::Text),
    ("deleted_at", ColType::Text),
];

static PREFERENCES_COLS: &[(&str, ColType)] = &[
    ("key", ColType::Text),
    ("value", ColType::Text),
    ("updated_at", ColType::Text),
];

static SYNC_OUTBOX_COLS: &[(&str, ColType)] = &[
    ("id", ColType::Integer),
    ("table_name", ColType::Text),
    ("row_id", ColType::Text),
    ("op", ColType::Text),
    ("payload", ColType::Text),
    ("created_at", ColType::Text),
    ("device_id", ColType::Text),
];

pub static SCHEMAS: &[TableSchema] = &[
    TableSchema {
        name: "tasks",
        columns: TASKS_COLS,
        soft_delete: true,
    },
    TableSchema {
        name: "lists",
        columns: LISTS_COLS,
        soft_delete: true,
    },
    TableSchema {
        name: "notes",
        columns: NOTES_COLS,
        soft_delete: true,
    },
    TableSchema {
        name: "drawings",
        columns: DRAWINGS_COLS,
        soft_delete: true,
    },
    TableSchema {
        name: "recordings",
        columns: RECORDINGS_COLS,
        soft_delete: true,
    },
    TableSchema {
        name: "events",
        columns: EVENTS_COLS,
        soft_delete: true,
    },
    TableSchema {
        name: "calendars_meta",
        columns: CALENDARS_META_COLS,
        soft_delete: false,
    },
    TableSchema {
        name: "sessions",
        columns: SESSIONS_COLS,
        soft_delete: true,
    },
    TableSchema {
        name: "links",
        columns: LINKS_COLS,
        soft_delete: false,
    },
    TableSchema {
        name: "alarms",
        columns: ALARMS_COLS,
        soft_delete: true,
    },
    TableSchema {
        name: "chat_messages",
        columns: CHAT_MESSAGES_COLS,
        soft_delete: true,
    },
    TableSchema {
        name: "preferences",
        columns: PREFERENCES_COLS,
        soft_delete: false,
    },
    TableSchema {
        name: "sync_outbox",
        columns: SYNC_OUTBOX_COLS,
        soft_delete: false,
    },
];

pub fn table(name: &str) -> Option<&'static TableSchema> {
    SCHEMAS.iter().find(|s| s.name == name)
}
