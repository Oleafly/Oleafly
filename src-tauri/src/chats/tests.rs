use super::*;

fn chat(id: &str, updated_at: f64, messages: usize) -> String {
    let messages: Vec<serde_json::Value> = (0..messages)
        .map(|index| serde_json::json!({ "role": "user", "content": format!("message {index}") }))
        .collect();
    serde_json::json!({
        "id": id,
        "projectId": "p1",
        "title": format!("Chat {id}"),
        "createdAt": 1,
        "updatedAt": updated_at,
        "messages": messages,
    })
    .to_string()
}

fn parsed(load: &ChatsLoad) -> Vec<serde_json::Value> {
    serde_json::from_str::<Vec<serde_json::Value>>(&load.json).unwrap()
}

fn ids(load: &ChatsLoad) -> Vec<String> {
    parsed(load)
        .iter()
        .map(|chat| chat["id"].as_str().unwrap().to_string())
        .collect()
}

// 0.4.7's check, kept: a project id never leaves the chats folder.
#[test]
fn rejects_illegal_project_ids() {
    let root = std::path::Path::new("data");
    for bad in ["..", "a/b", ""] {
        assert!(chat_path(root, bad, "chat_1").is_err(), "{bad}");
    }
}

#[test]
fn rejects_unsafe_chat_ids() {
    let long = "a".repeat(129);
    for bad in [
        "",
        "..",
        "a/b",
        "a\\b",
        "CON",
        "nul",
        "com1",
        "lpt9",
        "chat.1",
        "-lead",
        long.as_str(),
    ] {
        assert!(validate_chat_id(bad).is_err(), "{bad}");
    }
    assert!(validate_chat_id("chat_1739_ab12cd").is_ok());
    assert!(validate_chat_id("CONSOLE").is_ok());
}

#[test]
fn migrates_a_legacy_project_file_into_per_chat_files() {
    let root = tempfile::tempdir().unwrap();
    let chats = root.path().join("chats");
    std::fs::create_dir_all(&chats).unwrap();
    let legacy = format!("[{},{}]", chat("a", 1.0, 1), chat("b", 2.0, 1));
    std::fs::write(chats.join("p1.json"), &legacy).unwrap();
    assert!(migrate_legacy_chats(root.path(), "p1").unwrap());
    assert!(chats.join("p1").join("a.json").is_file());
    assert!(chats.join("p1").join("b.json").is_file());
    // The file stays where 0.4.7 reads it, untouched, and is not renamed.
    assert_eq!(
        std::fs::read_to_string(chats.join("p1.json")).unwrap(),
        legacy
    );
    assert!(!chats.join("p1.json.migrated").exists());
    // Merged once: an unchanged file is not merged again.
    assert!(!migrate_legacy_chats(root.path(), "p1").unwrap());
    assert_eq!(
        ids(&read_project_chats(root.path(), "p1", usize::MAX).unwrap()),
        ["b", "a"]
    );
}

fn set_modified(path: &Path, modified: std::time::SystemTime) {
    std::fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(modified)
        .unwrap();
}

#[test]
fn a_chat_deleted_after_the_merge_stays_deleted() {
    let root = tempfile::tempdir().unwrap();
    let chats = root.path().join("chats");
    std::fs::create_dir_all(&chats).unwrap();
    std::fs::write(
        chats.join("p1.json"),
        format!("[{},{}]", chat("a", 1.0, 1), chat("b", 2.0, 1)),
    )
    .unwrap();
    migrate_legacy_chats(root.path(), "p1").unwrap();
    delete_chat(root.path(), "p1", "a").unwrap();
    // Every later load sees the same legacy file and leaves the history be.
    assert!(!migrate_legacy_chats(root.path(), "p1").unwrap());
    assert_eq!(
        ids(&read_project_chats(root.path(), "p1", usize::MAX).unwrap()),
        ["b"]
    );
}

#[test]
fn a_legacy_file_written_after_a_downgrade_is_merged_again() {
    let root = tempfile::tempdir().unwrap();
    let chats = root.path().join("chats");
    std::fs::create_dir_all(&chats).unwrap();
    std::fs::write(chats.join("p1.json"), format!("[{}]", chat("a", 1.0, 1))).unwrap();
    assert!(migrate_legacy_chats(root.path(), "p1").unwrap());
    // 0.4.7 ran again, edited a chat and added one, and saved the array.
    std::fs::write(
        chats.join("p1.json"),
        format!("[{},{}]", chat("a", 7.0, 4), chat("c", 8.0, 1)),
    )
    .unwrap();
    assert!(migrate_legacy_chats(root.path(), "p1").unwrap());
    let a: serde_json::Value =
        serde_json::from_str(&read_chat(root.path(), "p1", "a").unwrap()).unwrap();
    assert_eq!(a["messages"].as_array().unwrap().len(), 4);
    assert!(chats.join("p1").join("c.json").is_file());
    assert!(!migrate_legacy_chats(root.path(), "p1").unwrap());
}

#[test]
fn a_chat_deleted_here_stays_deleted_when_0_4_7_saves_the_legacy_file_again() {
    let root = tempfile::tempdir().unwrap();
    let chats = root.path().join("chats");
    std::fs::create_dir_all(&chats).unwrap();
    std::fs::write(
        chats.join("p1.json"),
        format!("[{},{}]", chat("a", 1.0, 1), chat("b", 2.0, 1)),
    )
    .unwrap();
    assert!(migrate_legacy_chats(root.path(), "p1").unwrap());
    delete_chat(root.path(), "p1", "a").unwrap();
    // 0.4.7 ran again: it still has a and changed it, and it added c.
    std::fs::write(
        chats.join("p1.json"),
        format!(
            "[{},{},{}]",
            chat("a", 5.0, 3),
            chat("b", 2.0, 1),
            chat("c", 6.0, 1)
        ),
    )
    .unwrap();
    assert!(migrate_legacy_chats(root.path(), "p1").unwrap());
    assert_eq!(
        ids(&read_project_chats(root.path(), "p1", usize::MAX).unwrap()),
        ["c", "b"]
    );
}

#[test]
fn a_chat_continued_in_both_versions_keeps_both_copies() {
    let root = tempfile::tempdir().unwrap();
    let chats = root.path().join("chats");
    std::fs::create_dir_all(&chats).unwrap();
    std::fs::write(chats.join("p1.json"), format!("[{}]", chat("a", 1.0, 1))).unwrap();
    assert!(migrate_legacy_chats(root.path(), "p1").unwrap());
    // Five messages added here, then one in 0.4.7 after a downgrade.
    write_chat(root.path(), "p1", "a", &chat("a", 5.0, 6), false).unwrap();
    std::fs::write(chats.join("p1.json"), format!("[{}]", chat("a", 7.0, 2))).unwrap();
    assert!(migrate_legacy_chats(root.path(), "p1").unwrap());
    let messages = |id: &str| {
        let value: serde_json::Value =
            serde_json::from_str(&read_chat(root.path(), "p1", id).unwrap()).unwrap();
        assert_eq!(value["id"], id);
        value["messages"].as_array().unwrap().len()
    };
    let copy = legacy_copy_id("a", Some(7.0));
    assert_eq!((messages("a"), messages(&copy)), (6, 2));
    // 0.4.7 carries on with its copy: that copy follows, the chat here stays.
    std::fs::write(chats.join("p1.json"), format!("[{}]", chat("a", 9.0, 3))).unwrap();
    assert!(migrate_legacy_chats(root.path(), "p1").unwrap());
    assert_eq!((messages("a"), messages(&copy)), (6, 3));
    assert_eq!(
        ids(&read_project_chats(root.path(), "p1", usize::MAX).unwrap()),
        [copy.as_str(), "a"]
    );
}

#[test]
fn a_legacy_copy_id_is_a_valid_chat_id_even_for_the_longest_ids() {
    let long = "a".repeat(MAX_CHAT_ID_LEN);
    for id in ["chat_1739_ab12cd", long.as_str()] {
        let copy = legacy_copy_id(id, Some(1_712_345_678_901.0));
        assert!(validate_chat_id(&copy).is_ok(), "{copy}");
        assert_ne!(copy, id);
    }
}

#[test]
fn legacy_chats_that_cannot_be_files_are_counted_and_stay_in_the_legacy_file() {
    let root = tempfile::tempdir().unwrap();
    let chats = root.path().join("chats");
    std::fs::create_dir_all(&chats).unwrap();
    let huge = serde_json::json!({
        "id": "huge",
        "updatedAt": 3,
        "pad": "x".repeat(MAX_CHAT_JSON_BYTES),
    });
    let legacy = format!(
        "[{},{},{},{}]",
        chat("fine", 1.0, 1),
        // Not a file name, and no id at all.
        chat("chat.1710000000", 2.0, 1),
        serde_json::json!({ "title": "no id", "updatedAt": 2 }),
        huge
    );
    std::fs::write(chats.join("p1.json"), &legacy).unwrap();
    let first = migrate_legacy(root.path(), "p1").unwrap();
    assert_eq!(
        first,
        Migration {
            merged: true,
            skipped: 3
        }
    );
    // The count is remembered while the legacy file is unchanged, and the
    // file still holds those chats.
    let second = migrate_legacy(root.path(), "p1").unwrap();
    assert_eq!(
        second,
        Migration {
            merged: false,
            skipped: 3
        }
    );
    assert_eq!(
        std::fs::read_to_string(chats.join("p1.json")).unwrap(),
        legacy
    );
    assert_eq!(
        ids(&read_project_chats(root.path(), "p1", usize::MAX).unwrap()),
        ["fine"]
    );
}

#[test]
fn a_project_without_a_legacy_file_has_nothing_to_merge() {
    let root = tempfile::tempdir().unwrap();
    assert_eq!(
        migrate_legacy(root.path(), "p1").unwrap(),
        Migration::default()
    );
    assert!(!root.path().join("chats").exists());
}

#[test]
fn migration_keeps_whichever_copy_of_a_chat_is_newer() {
    let root = tempfile::tempdir().unwrap();
    write_chat(root.path(), "p1", "a", &chat("a", 5.0, 3), false).unwrap();
    write_chat(root.path(), "p1", "b", &chat("b", 1.0, 1), false).unwrap();
    std::fs::write(
        root.path().join("chats").join("p1.json"),
        format!("[{},{}]", chat("a", 4.0, 1), chat("b", 9.0, 2)),
    )
    .unwrap();
    migrate_legacy_chats(root.path(), "p1").unwrap();
    let a: serde_json::Value =
        serde_json::from_str(&read_chat(root.path(), "p1", "a").unwrap()).unwrap();
    let b: serde_json::Value =
        serde_json::from_str(&read_chat(root.path(), "p1", "b").unwrap()).unwrap();
    assert_eq!(a["messages"].as_array().unwrap().len(), 3);
    assert_eq!(b["updatedAt"], 9.0);
}

#[test]
fn load_returns_newest_first_and_counts_skipped_files() {
    let root = tempfile::tempdir().unwrap();
    write_chat(root.path(), "p1", "old", &chat("old", 1.0, 1), false).unwrap();
    write_chat(root.path(), "p1", "new", &chat("new", 3.0, 1), false).unwrap();
    let dir = root.path().join("chats").join("p1");
    std::fs::write(dir.join("broken.json"), "{not json").unwrap();
    std::fs::write(dir.join("mismatch.json"), chat("other", 2.0, 1)).unwrap();
    let huge = format!(
        "{{\"id\":\"huge\",\"pad\":\"{}\"}}",
        "x".repeat(MAX_CHAT_JSON_BYTES)
    );
    std::fs::write(dir.join("huge.json"), huge).unwrap();
    let load = read_project_chats(root.path(), "p1", usize::MAX).unwrap();
    assert_eq!(ids(&load), ["new", "old"]);
    assert_eq!(load.skipped, 3);
}

#[test]
fn load_ignores_staging_files() {
    let root = tempfile::tempdir().unwrap();
    write_chat(root.path(), "p1", "a", &chat("a", 1.0, 1), false).unwrap();
    let dir = root.path().join("chats").join("p1");
    std::fs::write(dir.join(".a.json.123.1.tmp"), chat("a", 9.0, 1)).unwrap();
    std::fs::write(dir.join(".hidden.json"), chat("hidden", 9.0, 1)).unwrap();
    let load = read_project_chats(root.path(), "p1", usize::MAX).unwrap();
    assert_eq!(ids(&load), ["a"]);
    assert_eq!(load.skipped, 0);
}

#[test]
fn a_project_without_chats_loads_empty_without_creating_a_folder() {
    let root = tempfile::tempdir().unwrap();
    let load = read_project_chats(root.path(), "p1", usize::MAX).unwrap();
    assert_eq!((load.json.as_str(), load.skipped), ("[]", 0));
    assert!(!root.path().join("chats").exists());
}

#[test]
fn returns_chats_past_the_load_budget_as_stubs() {
    let root = tempfile::tempdir().unwrap();
    let newest = chat("new", 2.0, 1);
    write_chat(root.path(), "p1", "new", &newest, false).unwrap();
    write_chat(root.path(), "p1", "old", &chat("old", 1.0, 2), false).unwrap();
    let load = read_project_chats(root.path(), "p1", newest.len()).unwrap();
    let chats = parsed(&load);
    assert!(chats[0].get("stub").is_none());
    assert_eq!(chats[0]["messages"].as_array().unwrap().len(), 1);
    assert_eq!(chats[1]["stub"], true);
    assert_eq!(chats[1]["messageCount"], 2);
    assert_eq!(chats[1]["messages"], serde_json::json!([]));
    assert_eq!(chats[1]["title"], "Chat old");
}

fn chat_file(root: &Path, id: &str) -> PathBuf {
    root.join("chats").join("p1").join(format!("{id}.json"))
}

#[test]
fn older_chats_come_from_the_stub_index_without_their_bodies_being_read() {
    let root = tempfile::tempdir().unwrap();
    for (id, updated) in [("a", 1.0), ("b", 2.0), ("c", 3.0)] {
        write_chat(root.path(), "p1", id, &chat(id, updated, 3), false).unwrap();
    }
    // The first load reads what it has not seen and records it.
    let first = read_project_chats(root.path(), "p1", 0).unwrap();
    assert!(parsed(&first).iter().all(|chat| chat["stub"] == true));
    assert!(root
        .path()
        .join("chats")
        .join("p1")
        .join(STUB_INDEX)
        .is_file());

    // Junk of the same length and the same modification time stands in for
    // the bodies of a and b. A load that read them would skip them.
    for id in ["a", "b"] {
        let path = chat_file(root.path(), id);
        let meta = std::fs::metadata(&path).unwrap();
        std::fs::write(&path, vec![b'x'; meta.len() as usize]).unwrap();
        set_modified(&path, meta.modified().unwrap());
    }
    let second = read_project_chats(root.path(), "p1", 0).unwrap();
    assert_eq!(second.skipped, 0);
    assert_eq!(ids(&second), ["c", "b", "a"]);
    assert_eq!(parsed(&second)[2]["messageCount"], 3);
    assert_eq!(parsed(&second)[2]["title"], "Chat a");

    // Room for the newest only: it is read in full, the others stay stubs.
    let newest = std::fs::metadata(chat_file(root.path(), "c"))
        .unwrap()
        .len();
    let third = read_project_chats(root.path(), "p1", newest as usize).unwrap();
    assert_eq!(third.skipped, 0);
    let chats = parsed(&third);
    assert_eq!(chats[0]["messages"].as_array().unwrap().len(), 3);
    assert!(chats[0].get("stub").is_none());
    assert_eq!(
        (chats[1]["stub"].clone(), chats[2]["stub"].clone()),
        (true.into(), true.into())
    );
}

#[test]
fn a_chat_that_changed_is_read_again_and_the_index_follows() {
    let root = tempfile::tempdir().unwrap();
    write_chat(root.path(), "p1", "a", &chat("a", 1.0, 2), false).unwrap();
    assert_eq!(
        parsed(&read_project_chats(root.path(), "p1", 0).unwrap())[0]["messageCount"],
        2
    );
    let changed = serde_json::json!({
        "id": "a",
        "title": "Renamed",
        "updatedAt": 5.0,
        "messages": [{ "role": "user", "content": "one" }, { "role": "user", "content": "two" }, { "role": "user", "content": "three" }],
    })
    .to_string();
    write_chat(root.path(), "p1", "a", &changed, false).unwrap();
    let load = read_project_chats(root.path(), "p1", 0).unwrap();
    let stub = &parsed(&load)[0];
    assert_eq!(
        (stub["title"].as_str(), stub["messageCount"].as_u64()),
        (Some("Renamed"), Some(3))
    );
    assert_eq!(stub["updatedAt"], 5.0);
}

#[test]
fn a_corrupt_stub_index_is_rebuilt_and_deleted_chats_leave_it() {
    let root = tempfile::tempdir().unwrap();
    write_chat(root.path(), "p1", "a", &chat("a", 1.0, 1), false).unwrap();
    write_chat(root.path(), "p1", "b", &chat("b", 2.0, 1), false).unwrap();
    let index = root.path().join("chats").join("p1").join(STUB_INDEX);
    std::fs::write(&index, "{ not json").unwrap();
    let load = read_project_chats(root.path(), "p1", 0).unwrap();
    assert_eq!(
        (ids(&load), load.skipped),
        (vec!["b".to_string(), "a".to_string()], 0)
    );
    let recorded: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&index).unwrap()).unwrap();
    assert_eq!(recorded.as_object().unwrap().len(), 2);

    delete_chat(root.path(), "p1", "a").unwrap();
    let load = read_project_chats(root.path(), "p1", 0).unwrap();
    assert_eq!(ids(&load), ["b"]);
    let recorded: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&index).unwrap()).unwrap();
    assert_eq!(
        recorded.as_object().unwrap().keys().collect::<Vec<_>>(),
        ["b"]
    );
}

#[test]
fn a_body_that_goes_bad_between_the_listing_and_the_read_is_skipped_not_returned() {
    let root = tempfile::tempdir().unwrap();
    write_chat(root.path(), "p1", "a", &chat("a", 1.0, 1), false).unwrap();
    read_project_chats(root.path(), "p1", 0).unwrap();
    // Same length and time as the indexed file, but no longer a chat.
    let path = chat_file(root.path(), "a");
    let meta = std::fs::metadata(&path).unwrap();
    std::fs::write(&path, vec![b'{'; meta.len() as usize]).unwrap();
    set_modified(&path, meta.modified().unwrap());
    let load = read_project_chats(root.path(), "p1", usize::MAX).unwrap();
    assert_eq!((load.json.as_str(), load.skipped), ("[]", 1));
}

#[test]
fn save_writes_only_the_named_chat() {
    let root = tempfile::tempdir().unwrap();
    write_chat(root.path(), "p1", "a", &chat("a", 1.0, 1), false).unwrap();
    let other = root.path().join("chats").join("p1").join("a.json");
    let before = std::fs::read(&other).unwrap();
    write_chat(root.path(), "p1", "b", &chat("b", 2.0, 4), false).unwrap();
    assert_eq!(std::fs::read(&other).unwrap(), before);
}

#[test]
fn save_rejects_a_chat_over_the_limit_with_a_stable_code() {
    let root = tempfile::tempdir().unwrap();
    let json = format!(
        "{{\"id\":\"a\",\"pad\":\"{}\"}}",
        "x".repeat(MAX_CHAT_JSON_BYTES)
    );
    let error = write_chat(root.path(), "p1", "a", &json, false).unwrap_err();
    assert!(error.starts_with(CHAT_TOO_LARGE), "{error}");
}

#[test]
fn save_rejects_a_chat_whose_id_does_not_match() {
    let root = tempfile::tempdir().unwrap();
    assert!(write_chat(root.path(), "p1", "a", &chat("b", 1.0, 1), false).is_err());
    assert!(write_chat(root.path(), "p1", "a", "[]", false).is_err());
    assert!(write_chat(root.path(), "../p1", "a", &chat("a", 1.0, 1), false).is_err());
}

#[test]
fn keeps_non_ascii_titles_intact() {
    let root = tempfile::tempdir().unwrap();
    let json =
        serde_json::json!({ "id": "a", "title": "Résumé 履歴", "updatedAt": 1, "messages": [] })
            .to_string();
    write_chat(root.path(), "p1", "a", &json, false).unwrap();
    assert_eq!(read_chat(root.path(), "p1", "a").unwrap(), json);
}

#[test]
fn delete_tolerates_a_missing_file() {
    let root = tempfile::tempdir().unwrap();
    delete_chat(root.path(), "p1", "gone").unwrap();
    write_chat(root.path(), "p1", "a", &chat("a", 1.0, 1), false).unwrap();
    delete_chat(root.path(), "p1", "a").unwrap();
    assert!(!root.path().join("chats").join("p1").join("a.json").exists());
}

#[test]
fn remove_project_chats_removes_the_folder_legacy_file_and_backup() {
    let root = tempfile::tempdir().unwrap();
    write_chat(root.path(), "p1", "a", &chat("a", 1.0, 1), false).unwrap();
    let chats = root.path().join("chats");
    std::fs::write(chats.join("p1.json"), "[]").unwrap();
    std::fs::write(chats.join("p1.json.migrated"), "[]").unwrap();
    write_chat(root.path(), "p2", "b", &chat("b", 1.0, 1), false).unwrap();
    remove_project_chats_in(root.path(), "p1").unwrap();
    assert!(!chats.join("p1").exists());
    assert!(!chats.join("p1.json").exists());
    assert!(!chats.join("p1.json.migrated").exists());
    assert!(chats.join("p2").join("b.json").is_file());
    remove_project_chats_in(root.path(), "p1").unwrap();
}

#[test]
fn repeated_save_replaces_existing_file_and_removes_staging_files() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("project.json");
    save_to_path(&path, "[]").unwrap();
    save_to_path(&path, "[{\"id\":\"second\"}]").unwrap();
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "[{\"id\":\"second\"}]"
    );
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
}

#[test]
fn failed_replace_preserves_existing_file() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("project.json");
    std::fs::write(&path, "old").unwrap();
    assert!(replace_path(&root.path().join("missing.tmp"), &path).is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
}
