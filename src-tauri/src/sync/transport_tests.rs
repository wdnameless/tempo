// src-tauri/src/sync/transport_tests.rs
//
// Tests for folder transport and media flag.

#[cfg(test)]
mod tests {
    use std::fs;
    use tempfile::tempdir;
    use serde_json::json;

    use crate::storage::migrations::migrate;
    use crate::storage::repo;
    use crate::sync::transport::perform_folder_sync;
    use crate::sync::{set_sync_media, set_sync_transport, sync_now_internal};
    use rusqlite::Connection;

    fn setup_mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn test_folder_transport_two_devices_bidirectional_and_corrupt_file_skipped() {
        let tmp = tempdir().unwrap();
        let sync_dir = tmp.path().join("sync_folder");
        let app_data_a = tmp.path().join("app_data_a");
        let app_data_b = tmp.path().join("app_data_b");
        fs::create_dir_all(&sync_dir).unwrap();
        fs::create_dir_all(&app_data_a).unwrap();
        fs::create_dir_all(&app_data_b).unwrap();

        // Device A
        let conn_a = setup_mem_db();
        let dev_a = repo::pref_device_id(&conn_a).unwrap();

        // Device B
        let conn_b = setup_mem_db();
        let dev_b = repo::pref_device_id(&conn_b).unwrap();
        assert_ne!(dev_a, dev_b);

        // A creates task A1
        repo::insert(&conn_a, "tasks", &json!({
            "id": "task-A1",
            "title": "Task by A",
            "updated_at": "2026-09-20T12:00:00Z"
        })).unwrap();

        // B creates task B1
        repo::insert(&conn_b, "tasks", &json!({
            "id": "task-B1",
            "title": "Task by B",
            "updated_at": "2026-09-20T12:05:00Z"
        })).unwrap();

        // In the sync folder, create a corrupt / half-written file
        let corrupt_path = sync_dir.join("journal_corrupt_device_123.json");
        fs::write(&corrupt_path, b"{\"version\": 1, \"device_id\": \"corrupt\", \"entries\": [HALF WRITTEN").unwrap();

        // Perform sync from A
        let outcome_a = perform_folder_sync(&conn_a, &sync_dir, &app_data_a, false).unwrap();
        assert_eq!(outcome_a.sent, 1, "A exported 1 entry");

        // Perform sync from B: B should export B1 AND import A1 (and skip corrupt file)
        let outcome_b = perform_folder_sync(&conn_b, &sync_dir, &app_data_b, false).unwrap();
        assert_eq!(outcome_b.sent, 1, "B exported 1 entry");
        assert_eq!(outcome_b.received, 1, "B received A's entry");
        assert_eq!(outcome_b.applied, 1, "B applied A's entry");

        // Verify B now has task-A1
        let row_on_b = repo::get(&conn_b, "tasks", "task-A1").unwrap();
        assert!(row_on_b.is_some(), "B must have received task-A1 from A");

        // Perform sync on A again: A should import B1
        let outcome_a2 = perform_folder_sync(&conn_a, &sync_dir, &app_data_a, false).unwrap();
        assert_eq!(outcome_a2.received, 1, "A received B's entry");
        assert_eq!(outcome_a2.applied, 1, "A applied B's entry");

        // Verify A now has task-B1
        let row_on_a = repo::get(&conn_a, "tasks", "task-B1").unwrap();
        assert!(row_on_a.is_some(), "A must have received task-B1 from B");

        // Check outbox on A is now empty (applied marked)
        let outbox_a = repo::list(&conn_a, "sync_outbox", false).unwrap();
        assert_eq!(outbox_a.len(), 0, "Outbox should be drained after export");
    }

    #[test]
    fn test_media_flag_off_prevents_file_copy_and_media_flag_on_copies() {
        let tmp = tempdir().unwrap();
        let sync_dir = tmp.path().join("sync_folder");
        let app_data_a = tmp.path().join("app_data_a");
        let app_data_b = tmp.path().join("app_data_b");
        fs::create_dir_all(&sync_dir).unwrap();
        fs::create_dir_all(&app_data_a).unwrap();
        fs::create_dir_all(&app_data_b).unwrap();

        // Create a media file on A
        let audio_rel = "recordings/note1.wav";
        let local_audio_file = app_data_a.join(audio_rel);
        fs::create_dir_all(local_audio_file.parent().unwrap()).unwrap();
        fs::write(&local_audio_file, b"FAKE_AUDIO_DATA_12345").unwrap();

        let conn_a = setup_mem_db();
        repo::insert(&conn_a, "recordings", &json!({
            "id": "rec-01",
            "title": "Voice Memo",
            "kind": "audio",
            "file_path": audio_rel,
            "duration_sec": 5.0
        })).unwrap();

        // Case 1: media_enabled = false -> no file copied to sync_dir/media
        let outcome_no_media = perform_folder_sync(&conn_a, &sync_dir, &app_data_a, false).unwrap();
        assert_eq!(outcome_no_media.media_copied, 0);
        let sync_media_file = sync_dir.join("media").join(audio_rel);
        assert!(!sync_media_file.exists(), "When media flag is OFF, files must NOT leave device");

        // Insert another recording on A
        let audio_rel2 = "recordings/note2.wav";
        let local_audio_file2 = app_data_a.join(audio_rel2);
        fs::write(&local_audio_file2, b"FAKE_AUDIO_DATA_67890").unwrap();
        repo::insert(&conn_a, "recordings", &json!({
            "id": "rec-02",
            "title": "Voice Memo 2",
            "kind": "audio",
            "file_path": audio_rel2,
            "duration_sec": 10.0
        })).unwrap();

        // Case 2: media_enabled = true -> file copied
        let outcome_with_media = perform_folder_sync(&conn_a, &sync_dir, &app_data_a, true).unwrap();
        assert_eq!(outcome_with_media.media_copied, 1);
        let sync_media_file2 = sync_dir.join("media").join(audio_rel2);
        assert!(sync_media_file2.exists(), "When media flag is ON, file MUST be copied to sync folder");

        // Now B syncs with media enabled
        let conn_b = setup_mem_db();
        let outcome_b = perform_folder_sync(&conn_b, &sync_dir, &app_data_b, true).unwrap();
        assert!(outcome_b.media_copied >= 1);
        let dest_audio_b = app_data_b.join(audio_rel2);
        assert!(dest_audio_b.exists(), "Media file must be transferred to device B");
        assert_eq!(fs::read(&dest_audio_b).unwrap(), b"FAKE_AUDIO_DATA_67890");
    }

    #[test]
    fn test_sync_now_wrapper_and_settings() {
        let tmp = tempdir().unwrap();
        let sync_dir = tmp.path().join("sync_dir");
        fs::create_dir_all(&sync_dir).unwrap();

        let conn = setup_mem_db();

        // Without transport configured
        let err = sync_now_internal(&conn, tmp.path()).unwrap_err();
        assert_eq!(err, "no_transport");

        // Configure transport
        set_sync_transport(&conn, "folder", Some(sync_dir.to_str().unwrap())).unwrap();
        set_sync_media(&conn, true).unwrap();

        // Sync now
        let outcome = sync_now_internal(&conn, tmp.path()).unwrap();
        assert_eq!(outcome.sent, 0);

        // Verify status
        let status = crate::sync::get_sync_status(&conn).unwrap();
        assert_eq!(status.transport, "folder");
        assert!(status.media);
        assert!(status.last_sync.is_some());
    }
}
