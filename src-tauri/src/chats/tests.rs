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
    std::fs::write(
        chats.join("p1.json"),
        format!("[{},{}]", chat("a", 1.0, 1), chat("b", 2.0, 1)),
    )
    .unwrap();
    assert!(migrate_legacy_chats(root.path(), "p1").unwrap());
    assert!(chats.join("p1").join("a.json").is_file());
    assert!(chats.join("p1").join("b.json").is_file());
    assert!(chats.join("p1.json.migrated").is_file());
    assert!(!chats.join("p1.json").exists());
    assert!(!migrate_legacy_chats(root.path(), "p1").unwrap());
    assert_eq!(
        ids(&read_project_chats(root.path(), "p1", usize::MAX).unwrap()),
        ["b", "a"]
    );
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
fn replaces_an_older_migration_backup() {
    let root = tempfile::tempdir().unwrap();
    let chats = root.path().join("chats");
    std::fs::create_dir_all(&chats).unwrap();
    std::fs::write(chats.join("p1.json.migrated"), "old backup").unwrap();
    std::fs::write(chats.join("p1.json"), format!("[{}]", chat("a", 1.0, 1))).unwrap();
    assert!(migrate_legacy_chats(root.path(), "p1").unwrap());
    let backup = std::fs::read_to_string(chats.join("p1.json.migrated")).unwrap();
    assert!(backup.contains("\"a\""));
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
