use std::path::Path;

use serde_json::{json, Value};

fn decode(result: &Value) -> Value {
    serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap()
}

fn write_skill(storage: &Path, id: &str, name: &str) {
    let directory = storage.join("skills").join(id);
    std::fs::create_dir_all(directory.join("scripts")).unwrap();
    std::fs::write(
        directory.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: Review the sources.\n---\n\nStart with the claim audit.\n"),
    )
    .unwrap();
    std::fs::write(
        directory.join("scripts").join("verify_citations.py"),
        "print('ok')\n",
    )
    .unwrap();
}

#[tokio::test]
async fn a_device_enabled_skill_loads_with_its_folder_and_script_commands() {
    let root = tempfile::tempdir().unwrap();
    let storage = root.path().join("skills-storage");
    write_skill(&storage, "literature-review", "Literature Review");
    let bridge = oleafly_research::mcp::serve(oleafly_research::mcp::McpStart {
        project_id: "project-a".into(),
        root: root.path().to_path_buf(),
        allowed: None,
        linked_roots: Vec::new(),
        services: super::services(storage.clone(), None),
        task: None,
    })
    .await
    .unwrap();

    let listed = decode(&bridge.call_tool("list_skills", &json!({})).await.unwrap());
    assert_eq!(listed["skills"][0]["id"], "literature-review");
    assert_eq!(listed["skills"][0]["enabled"], true);

    let loaded = decode(
        &bridge
            .call_tool("load_skill", &json!({"id":"literature-review"}))
            .await
            .unwrap(),
    );
    assert_eq!(loaded["id"], "literature-review");
    assert_eq!(loaded["name"], "Literature Review");
    assert!(loaded["instructions"]
        .as_str()
        .unwrap()
        .contains("Start with the claim audit."));
    assert!(loaded["dir"]
        .as_str()
        .unwrap()
        .ends_with("literature-review"));
    assert_eq!(loaded["scripts"][0]["path"], "scripts/verify_citations.py");
    assert!(loaded["scripts"][0]["command"]
        .as_str()
        .unwrap()
        .replace('\\', "/")
        .contains("scripts/verify_citations.py"));

    crate::skills::set_project_enabled(
        &storage,
        None,
        "project-a",
        "literature-review",
        Some(false),
    )
    .unwrap();
    let refused = bridge
        .call_tool("load_skill", &json!({"id":"literature-review"}))
        .await
        .unwrap_err();
    assert!(refused.contains("literature-review"));
    bridge.shutdown().await;
}

#[test]
fn restricted_projects_get_no_research_bridge() {
    let _env = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let project = crate::paths::create_project_dir("restricted-bridge").unwrap();
    assert_eq!(super::admit("restricted-bridge").unwrap(), project);
    let _restricted = crate::trust::testing::restrict("restricted-bridge");
    let error = super::admit("restricted-bridge").unwrap_err();
    assert!(error.contains("\"code\":\"trust.mcp\""), "{error}");
    std::env::remove_var("OLEAFLY_DATA_DIR");
}
