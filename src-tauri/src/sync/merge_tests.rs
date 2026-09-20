// src-tauri/src/sync/merge_tests.rs
//
// Acceptance tests defending merge rules per interfaces.md §23.
// Each test is written so that reversing the rule it covers makes it fail.

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use serde_json::json;

    use crate::storage::migrations::migrate;
    use crate::storage::repo;
    use crate::sync::journal::JournalEntry;
    use crate::sync::merge::{apply_incoming_entry, decide_merge, MergeDecision};

    fn setup_mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    /// Scenario 1: two devices — A creates, B imports, both see the row.
    /// Defends: New incoming items from peer are applied when not locally present.
    /// Reversing this rule (e.g. ignoring peer creations or dropping new items) causes this test to fail.
    #[test]
    fn test_rule_two_devices_peer_create_is_applied() {
        let conn_b = setup_mem_db();
        let dev_a = "device-A-1111";
        let dev_b = repo::pref_device_id(&conn_b).unwrap();

        let incoming_task = json!({
            "id": "task-shared-01",
            "title": "Created on device A",
            "created_at": "2026-09-20T10:00:00Z",
            "updated_at": "2026-09-20T10:00:00Z"
        });

        let entry = JournalEntry {
            id: 1,
            table_name: "tasks".to_string(),
            row_id: "task-shared-01".to_string(),
            op: "insert".to_string(),
            payload: Some(serde_json::to_string(&incoming_task).unwrap()),
            created_at: "2026-09-20T10:00:00Z".to_string(),
            device_id: dev_a.to_string(),
        };

        let (applied, _conflict) = apply_incoming_entry(&conn_b, &entry, &dev_b).expect("apply");
        assert!(applied, "Rule: peer creation MUST be applied to local DB");

        // Verify B sees the row
        let row_on_b = repo::get(&conn_b, "tasks", "task-shared-01").unwrap();
        assert!(row_on_b.is_some(), "Device B must see the row created on device A");
        assert_eq!(row_on_b.unwrap()["title"], "Created on device A");
    }

    /// Scenario 2: conflict — both edit the same row, strictly later updated_at wins,
    /// and equal timestamps resolve by device_id deterministically.
    /// Defends:
    /// - Later timestamp wins over earlier timestamp (reversing to earlier wins fails).
    /// - Equal timestamps resolve identically when run repeatedly (deterministic tie-break).
    #[test]
    fn test_rule_strictly_later_updated_at_wins_and_tie_breaks_deterministically() {
        // Sub-case 2a: Peer is later than local -> peer wins
        let local_earlier = json!({
            "id": "task-01",
            "title": "Local title",
            "updated_at": "2026-09-20T10:00:00Z"
        });
        let peer_later = JournalEntry {
            id: 2,
            table_name: "tasks".to_string(),
            row_id: "task-01".to_string(),
            op: "update".to_string(),
            payload: Some(json!({"id": "task-01", "title": "Peer later title", "updated_at": "2026-09-20T10:05:00Z"}).to_string()),
            created_at: "2026-09-20T10:05:00Z".to_string(),
            device_id: "dev-peer".to_string(),
        };
        let (decision_later, is_conflict) = decide_merge(Some(&local_earlier), &peer_later, "dev-local");
        assert_eq!(decision_later, MergeDecision::ApplyPeer, "Strictly later updated_at MUST win");
        assert!(is_conflict, "Concurrent edit must be flagged as conflict");

        // Sub-case 2b: Peer is earlier than local -> local wins
        let peer_earlier = JournalEntry {
            id: 3,
            table_name: "tasks".to_string(),
            row_id: "task-01".to_string(),
            op: "update".to_string(),
            payload: Some(json!({"id": "task-01", "title": "Peer earlier title", "updated_at": "2026-09-20T09:55:00Z"}).to_string()),
            created_at: "2026-09-20T09:55:00Z".to_string(),
            device_id: "dev-peer".to_string(),
        };
        let (decision_earlier, _) = decide_merge(Some(&local_earlier), &peer_earlier, "dev-local");
        assert_eq!(decision_earlier, MergeDecision::KeepLocal, "Earlier peer edit MUST NOT overwrite later local edit");

        // Sub-case 2c: Equal timestamps -> tie-break by device_id deterministically
        let local_tie = json!({
            "id": "task-01",
            "title": "Tie title",
            "updated_at": "2026-09-20T10:00:00Z"
        });
        let peer_tie = JournalEntry {
            id: 4,
            table_name: "tasks".to_string(),
            row_id: "task-01".to_string(),
            op: "update".to_string(),
            payload: Some(json!({"id": "task-01", "title": "Peer tie title", "updated_at": "2026-09-20T10:00:00Z"}).to_string()),
            created_at: "2026-09-20T10:00:00Z".to_string(),
            device_id: "dev-peer-z".to_string(),
        };
        // Run merge twice to assert identical deterministic outcome
        let (res1, _) = decide_merge(Some(&local_tie), &peer_tie, "dev-local-a");
        let (res2, _) = decide_merge(Some(&local_tie), &peer_tie, "dev-local-a");
        assert_eq!(res1, res2, "Tie break MUST be deterministic across repeated runs");
        assert_eq!(res1, MergeDecision::ApplyPeer, "dev-peer-z > dev-local-a so peer wins tie");

        // And vice versa: peer device "dev-a" vs local "dev-z" -> local wins tie (KeepLocal) because "dev-z" > "dev-a"
        let peer_tie_lower = JournalEntry {
            id: 5,
            table_name: "tasks".to_string(),
            row_id: "task-01".to_string(),
            op: "update".to_string(),
            payload: Some(json!({"id": "task-01", "title": "Peer tie lower", "updated_at": "2026-09-20T10:00:00Z"}).to_string()),
            created_at: "2026-09-20T10:00:00Z".to_string(),
            device_id: "dev-a".to_string(),
        };
        let (res3, _) = decide_merge(Some(&local_tie), &peer_tie_lower, "dev-z");
        assert_eq!(res3, MergeDecision::KeepLocal, "dev-z > dev-a so local wins tie");
    }

    /// Scenario 3: offline edits — B edits while A is unreachable, then they meet — B's work survives.
    /// Defends: When device B edited offline with a timestamp later than A's last known state,
    /// merging into A adopts B's work.
    /// Reversing this rule (e.g. discarding offline edits or prioritizing node A blindly) fails.
    #[test]
    fn test_rule_offline_edits_survive() {
        let conn_a = setup_mem_db();
        let dev_a = repo::pref_device_id(&conn_a).unwrap();

        // Initial shared row on A
        repo::insert(&conn_a, "tasks", &json!({
            "id": "task-offline-test",
            "title": "Original baseline",
            "updated_at": "2026-09-20T08:00:00Z"
        })).unwrap();

        // While offline, B made edits at 09:30:00Z
        let b_offline_entry = JournalEntry {
            id: 10,
            table_name: "tasks".to_string(),
            row_id: "task-offline-test".to_string(),
            op: "update".to_string(),
            payload: Some(json!({
                "id": "task-offline-test",
                "title": "B edited while offline",
                "updated_at": "2026-09-20T09:30:00Z"
            }).to_string()),
            created_at: "2026-09-20T09:30:00Z".to_string(),
            device_id: "device-B".to_string(),
        };

        let (applied, _) = apply_incoming_entry(&conn_a, &b_offline_entry, &dev_a).expect("apply offline work");
        assert!(applied, "Offline work with later timestamp MUST be applied");

        let row_on_a = repo::get(&conn_a, "tasks", "task-offline-test").unwrap().unwrap();
        assert_eq!(row_on_a["title"], "B edited while offline", "B's offline edit must survive");
    }

    /// Scenario 4: a row deleted on A and edited later on B is not silently destroyed:
    /// the later edit wins, which is what rule 3 in §23 is for.
    /// Defends: A delete does NOT permanently destroy a row if a peer made a strictly later edit.
    /// Reversing this rule (e.g. tombstone always trumps updates) fails this test.
    #[test]
    fn test_rule_later_edit_wins_over_earlier_delete() {
        let conn_a = setup_mem_db();
        let dev_a = repo::pref_device_id(&conn_a).unwrap();

        // Row was created and then soft-deleted on A at 10:00:00Z
        repo::insert(&conn_a, "tasks", &json!({
            "id": "task-del-revive",
            "title": "Initial",
            "updated_at": "2026-09-20T09:00:00Z"
        })).unwrap();

        // Soft delete on A
        repo::soft_delete(&conn_a, "tasks", "task-del-revive").unwrap();

        // Verify it is currently deleted on A
        let row_on_a = repo::get(&conn_a, "tasks", "task-del-revive").unwrap().unwrap();
        assert!(row_on_a["deleted_at"].as_str().is_some(), "Row must be soft deleted on A initially");

        // Now incoming from B: B edited the row LATER at 11:00:00Z (e.g. user revived/edited it on B)
        let b_later_edit = JournalEntry {
            id: 20,
            table_name: "tasks".to_string(),
            row_id: "task-del-revive".to_string(),
            op: "update".to_string(),
            payload: Some(json!({
                "id": "task-del-revive",
                "title": "Edited later on B",
                "updated_at": "2030-01-01T12:00:00Z",
                "deleted_at": null
            }).to_string()),
            created_at: "2030-01-01T12:00:00Z".to_string(),
            device_id: "device-B".to_string(),
        };

        let (applied, _) = apply_incoming_entry(&conn_a, &b_later_edit, &dev_a).expect("apply later edit");
        assert!(applied, "Rule 3: Later edit MUST win over earlier delete");

        // Check that the row is alive with B's new title
        let revived_on_a = repo::get(&conn_a, "tasks", "task-del-revive").unwrap();
        assert!(revived_on_a.is_some(), "Row must be active again because later edit won");
        assert_eq!(revived_on_a.unwrap()["title"], "Edited later on B");
    }
    /// The case that actually loses work: a peer deletes a row while this device
    /// was editing it offline. The local edit is later, so it must survive — a
    /// delete that arrives after the fact must not undo work it never saw.
    ///
    /// The test above covers the mirror image (a later peer edit beating an
    /// earlier local delete) and passes even when every peer entry wins, which is
    /// exactly the bug this one exists to catch.
    #[test]
    fn test_rule_incoming_delete_does_not_kill_a_later_local_edit() {
        let conn_a = setup_mem_db();
        let dev_a = repo::pref_device_id(&conn_a).unwrap();

        // Edited here at 12:00, long after the peer's delete below.
        repo::insert(&conn_a, "tasks", &json!({
            "id": "task-offline-edit",
            "title": "Edited here offline",
            "updated_at": "2026-09-20T12:00:00Z"
        })).unwrap();

        // The peer deleted it at 10:00 — before that edit existed.
        let peer_delete = JournalEntry {
            id: 30,
            table_name: "tasks".to_string(),
            row_id: "task-offline-edit".to_string(),
            op: "delete".to_string(),
            payload: Some(json!({
                "id": "task-offline-edit",
                "updated_at": "2026-09-20T10:00:00Z",
                "deleted_at": "2026-09-20T10:00:00Z"
            }).to_string()),
            created_at: "2026-09-20T10:00:00Z".to_string(),
            device_id: "device-B".to_string(),
        };

        let (applied, _) = apply_incoming_entry(&conn_a, &peer_delete, &dev_a)
            .expect("apply earlier delete");
        assert!(!applied, "Rule 3: an earlier delete must not overwrite a later local edit");

        let survivor = repo::get(&conn_a, "tasks", "task-offline-edit").unwrap();
        assert!(survivor.is_some(), "the offline edit must still be there");
        assert_eq!(survivor.unwrap()["title"], "Edited here offline");
    }

    /// The other half of rule 3: a delete that IS later still deletes. Without
    /// this, "the local copy always wins" would look like a passing merge.
    #[test]
    fn test_rule_a_later_incoming_delete_still_deletes() {
        let conn_a = setup_mem_db();
        let dev_a = repo::pref_device_id(&conn_a).unwrap();

        repo::insert(&conn_a, "tasks", &json!({
            "id": "task-deleted-later",
            "title": "Old title",
            "updated_at": "2026-09-20T08:00:00Z"
        })).unwrap();

        let peer_delete = JournalEntry {
            id: 31,
            table_name: "tasks".to_string(),
            row_id: "task-deleted-later".to_string(),
            op: "delete".to_string(),
            payload: Some(json!({
                "id": "task-deleted-later",
                "updated_at": "2026-09-20T18:00:00Z",
                "deleted_at": "2026-09-20T18:00:00Z"
            }).to_string()),
            created_at: "2026-09-20T18:00:00Z".to_string(),
            device_id: "device-B".to_string(),
        };

        let (applied, _) = apply_incoming_entry(&conn_a, &peer_delete, &dev_a)
            .expect("apply later delete");
        assert!(applied, "a later delete must be applied");

        // `repo::get` deliberately returns tombstones — the merge needs to see
        // them — so the assertion is about `deleted_at`, not about absence.
        let row = repo::get(&conn_a, "tasks", "task-deleted-later")
            .unwrap()
            .expect("the row still exists as a tombstone");
        assert!(
            row["deleted_at"].as_str().is_some(),
            "a later delete must mark the row deleted"
        );
    }
}
