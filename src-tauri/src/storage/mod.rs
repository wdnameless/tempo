// src-tauri/src/storage/mod.rs

pub mod assets;
pub mod migrations;
pub mod repo;
pub mod schema;
use std::path::{Path, PathBuf};
use rusqlite::Connection;
use serde_json::Value;
use super::is_portable_running;

pub fn db_path_in(base: &Path) -> PathBuf {
    base.join("data").join("tempo.db")
}

pub struct DbState(pub std::sync::Mutex<Option<rusqlite::Connection>>);

#[tauri::command]
pub fn db_path(app: tauri::AppHandle) -> Result<String, String> {
    let p = if is_portable_running() {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                db_path_in(parent)
            } else {
                db_path_in(Path::new("."))
            }
        } else {
            db_path_in(Path::new("."))
        }
    } else {
        use tauri::Manager;
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?;
        dir.join("tempo.db")
    };
    Ok(p.to_string_lossy().to_string())
}

pub fn with_db<F, R>(app: &tauri::AppHandle, f: F) -> Result<R, String>
where
    F: FnOnce(&Connection) -> Result<R, String>,
{
    use tauri::Manager;
    let state = app.state::<DbState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        let path_str = db_path(app.clone())?;
        let path = PathBuf::from(path_str);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(&path).map_err(|e| e.to_string())?;
        migrations::migrate(&conn)?;
        *guard = Some(conn);
    }
    let conn = guard.as_ref().unwrap();
    f(conn)
}

/// Reads the legacy JSON store, if one is still lying around.
///
/// Two places are checked, because the rename moved the data directory: the
/// bundle identifier changed from `com.alarmer.smart` to `app.tempo.desktop`, so
/// an installed copy keeps its old file under the previous identifier's folder
/// while the new database lives under the new one. Looking only beside the
/// database would silently migrate nothing and the user's alarms, tasks and notes
/// would look lost.
///
/// Returns `None` when there is nothing to migrate, which is the normal state for
/// a fresh install. The file is only read, never deleted: it stays the user's
/// backup until the migration is proven on a real install.
#[tauri::command]
pub fn load_legacy_store(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri::Manager;

    const LEGACY_FILE: &str = "alarmer.json";
    const LEGACY_IDENTIFIER: &str = "com.alarmer.smart";

    let mut candidates: Vec<PathBuf> = Vec::new();

    // Portable builds keep both files in the same folder, so this covers them.
    if let Ok(db) = db_path(app.clone()) {
        if let Some(dir) = PathBuf::from(db).parent() {
            candidates.push(dir.join(LEGACY_FILE));
        }
    }

    // The installed upgrade path: the previous identifier's data directory.
    if let Ok(roaming) = app.path().data_dir() {
        candidates.push(roaming.join(LEGACY_IDENTIFIER).join(LEGACY_FILE));
    }

    for candidate in candidates {
        if candidate.is_file() {
            return std::fs::read_to_string(&candidate).map(Some).map_err(|e| e.to_string());
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn db_ready(app: tauri::AppHandle) -> Result<bool, String> {
    with_db(&app, |_conn| Ok(true))
}

#[tauri::command]
pub fn db_list(
    app: tauri::AppHandle,
    table: String,
    include_deleted: Option<bool>,
) -> Result<Vec<Value>, String> {
    with_db(&app, |conn| {
        repo::list(conn, &table, include_deleted.unwrap_or(false))
    })
}

#[tauri::command]
pub fn db_get(
    app: tauri::AppHandle,
    table: String,
    id: String,
) -> Result<Option<Value>, String> {
    with_db(&app, |conn| repo::get(conn, &table, &id))
}

#[tauri::command]
pub fn db_insert(
    app: tauri::AppHandle,
    table: String,
    row: Value,
) -> Result<Value, String> {
    with_db(&app, |conn| repo::insert(conn, &table, &row))
}

#[tauri::command]
pub fn db_update(
    app: tauri::AppHandle,
    table: String,
    id: String,
    patch: Value,
) -> Result<Value, String> {
    with_db(&app, |conn| repo::update(conn, &table, &id, &patch))
}

#[tauri::command]
pub fn db_delete(app: tauri::AppHandle, table: String, id: String) -> Result<(), String> {
    with_db(&app, |conn| repo::soft_delete(conn, &table, &id))
}

#[tauri::command]
pub fn db_changed_since(
    app: tauri::AppHandle,
    table: String,
    iso: String,
) -> Result<Vec<Value>, String> {
    with_db(&app, |conn| repo::changed_since(conn, &table, &iso))
}

#[tauri::command]
pub fn db_pref_get(
    app: tauri::AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    with_db(&app, |conn| repo::pref_get(conn, &key))
}

#[tauri::command]
pub fn db_pref_set(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    with_db(&app, |conn| repo::pref_set(conn, &key, &value))
}

#[tauri::command]
pub fn db_search(
    app: tauri::AppHandle,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<repo::SearchHit>, String> {
    with_db(&app, |conn| repo::search_fts(conn, &query, limit))
}

#[tauri::command]
pub fn db_reindex(app: tauri::AppHandle, kind: Option<String>) -> Result<u32, String> {
    with_db(&app, |conn| repo::reindex_fts(conn, kind.as_deref()))
}

#[tauri::command]
pub fn links_set(
    app: tauri::AppHandle,
    from_kind: String,
    from_id: String,
    to: Vec<repo::LinkRef>,
) -> Result<u32, String> {
    with_db(&app, |conn| repo::links_set(conn, &from_kind, &from_id, &to))
}

#[tauri::command]
pub fn links_backlinks(
    app: tauri::AppHandle,
    kind: String,
    id: String,
) -> Result<Vec<repo::BacklinkRow>, String> {
    with_db(&app, |conn| repo::links_backlinks(conn, &kind, &id))
}

/// Resolves the media root directory (`<data>/assets`).
pub fn assets_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let p_str = db_path(app.clone())?;
    let p = PathBuf::from(p_str);
    let parent = p.parent().ok_or_else(|| "Failed to get database parent dir".to_string())?;
    Ok(assets::assets_root_dir(parent))
}

#[tauri::command]
pub fn asset_save(
    app: tauri::AppHandle,
    kind: String,
    name: String,
    data_base64: String,
) -> Result<assets::AssetRef, String> {
    let dir = assets_path(&app)?;
    assets::save_asset_in(&dir, &kind, &name, &data_base64)
}

#[tauri::command]
pub fn asset_delete(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = assets_path(&app)?;
    assets::delete_asset_in(&dir, &path)
}

#[tauri::command]
pub fn asset_usage(app: tauri::AppHandle) -> Result<assets::AssetUsage, String> {
    let dir = assets_path(&app)?;
    assets::usage_in(&dir)
}

#[tauri::command]
pub fn asset_prune(app: tauri::AppHandle, limit_bytes: u64) -> Result<assets::AssetPruneResult, String> {
    let dir = assets_path(&app)?;
    assets::prune_in(&dir, limit_bytes)
}


#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use serde_json::json;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrations::migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn test_db_path_in() {
        let base = Path::new("C:/app");
        assert_eq!(
            db_path_in(base),
            PathBuf::from("C:/app/data/tempo.db")
        );
    }

    #[test]
    fn test_migration_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        let v1 = migrations::migrate(&conn).unwrap();
        assert_eq!(v1, 1);
        let v2 = migrations::migrate(&conn).unwrap();
        assert_eq!(v2, 1);
    }

    #[test]
    fn test_insert_stamps_uuid_and_updated_at() {
        let conn = setup_test_db();
        let row = repo::insert(
            &conn,
            "tasks",
            &json!({
                "title": "Test task",
                "note": "Some note"
            }),
        )
        .unwrap();

        let id = row.get("id").and_then(|v| v.as_str()).unwrap();
        assert_eq!(id.len(), 36);
        // Verify UUID v4 format
        assert!(uuid::Uuid::parse_str(id).is_ok());

        let updated_at = row.get("updated_at").and_then(|v| v.as_str()).unwrap();
        assert!(!updated_at.is_empty());
        assert!(chrono::DateTime::parse_from_rfc3339(updated_at).is_ok());
    }

    #[test]
    fn test_soft_delete_and_list() {
        let conn = setup_test_db();
        let inserted = repo::insert(
            &conn,
            "notes",
            &json!({
                "title": "My Note",
                "body_md": "Content"
            }),
        )
        .unwrap();

        let id = inserted.get("id").and_then(|v| v.as_str()).unwrap();

        let active_before = repo::list(&conn, "notes", false).unwrap();
        assert_eq!(active_before.len(), 1);

        repo::soft_delete(&conn, "notes", id).unwrap();

        let active_after = repo::list(&conn, "notes", false).unwrap();
        assert_eq!(active_after.len(), 0);

        let all_after = repo::list(&conn, "notes", true).unwrap();
        assert_eq!(all_after.len(), 1);
        assert!(!all_after[0].get("deleted_at").unwrap().is_null());
    }

    #[test]
    fn test_changed_since_filters() {
        let conn = setup_test_db();
        let inserted = repo::insert(
            &conn,
            "tasks",
            &json!({ "title": "Task 1" }),
        )
        .unwrap();
        let id = inserted.get("id").and_then(|v| v.as_str()).unwrap();

        let t0 = "2020-01-01T00:00:00Z";
        let list1 = repo::changed_since(&conn, "tasks", t0).unwrap();
        assert_eq!(list1.len(), 1);

        let t_future = "2099-01-01T00:00:00Z";
        let list2 = repo::changed_since(&conn, "tasks", t_future).unwrap();
        assert_eq!(list2.len(), 0);

        // Update task and check
        repo::update(&conn, "tasks", id, &json!({ "title": "Updated Task 1" })).unwrap();
        let list3 = repo::changed_since(&conn, "tasks", t0).unwrap();
        assert_eq!(list3.len(), 1);
        assert_eq!(list3[0]["title"], "Updated Task 1");
    }

    #[test]
    fn test_prefs_round_trip() {
        let conn = setup_test_db();
        let none = repo::pref_get(&conn, "theme").unwrap();
        assert_eq!(none, None);

        repo::pref_set(&conn, "theme", "dark").unwrap();
        let val = repo::pref_get(&conn, "theme").unwrap();
        assert_eq!(val, Some("dark".to_string()));

        repo::pref_set(&conn, "theme", "tempo").unwrap();
        let val2 = repo::pref_get(&conn, "theme").unwrap();
        assert_eq!(val2, Some("tempo".to_string()));
    }

    #[test]
    fn test_db_search_finds_russian_text() {
        let conn = setup_test_db();
        repo::insert(
            &conn,
            "notes",
            &json!({
                "title": "Встреча с командой",
                "body_md": "Обсудили архитектуру хранилища и синхронизацию"
            }),
        )
        .unwrap();

        repo::reindex_fts(&conn, None).unwrap();

        let hits = repo::search_fts(&conn, "архитектуру", None).unwrap();
        assert!(!hits.is_empty());
        assert_eq!(hits[0].kind, "note");
        assert_eq!(hits[0].title, "Встреча с командой");

        let hits_prefix = repo::search_fts(&conn, "хранил*", None).unwrap();
        assert!(!hits_prefix.is_empty());
    }

    #[test]
    fn test_unknown_table_name_returns_err() {
        let conn = setup_test_db();
        let res = repo::list(&conn, "malicious_table", false);
        assert!(res.is_err());
        assert_eq!(res.unwrap_err(), "Unknown table: malicious_table");

        let res2 = repo::insert(&conn, "unknown_table", &json!({}));
        assert!(res2.is_err());
    }

    #[test]
    fn test_outbox_trigger_fires_on_update() {
        let conn = setup_test_db();
        let task = repo::insert(&conn, "tasks", &json!({ "title": "Buy milk" })).unwrap();
        let id = task["id"].as_str().unwrap();

        let outbox_after_insert = repo::list(&conn, "sync_outbox", false).unwrap();
        assert_eq!(outbox_after_insert.len(), 1);
        assert_eq!(outbox_after_insert[0]["table_name"], "tasks");
        assert_eq!(outbox_after_insert[0]["row_id"], id);
        assert_eq!(outbox_after_insert[0]["op"], "insert");

        repo::update(&conn, "tasks", id, &json!({ "title": "Buy organic milk" })).unwrap();

        let outbox_after_update = repo::list(&conn, "sync_outbox", false).unwrap();
        assert_eq!(outbox_after_update.len(), 2);
        assert_eq!(outbox_after_update[1]["table_name"], "tasks");
        assert_eq!(outbox_after_update[1]["row_id"], id);
        assert_eq!(outbox_after_update[1]["op"], "update");
    }
}
