#![allow(clippy::await_holding_lock)]

use crate::cloud::commands::{
    cloud_connect_begin, cloud_connect_cancel, cloud_connect_paste, cloud_connect_wait,
    cloud_details, cloud_disconnect, cloud_download_project, cloud_project_dismiss_conflicts,
    cloud_project_remove, cloud_project_replace_remote, cloud_project_resolve_hold,
    cloud_project_set_mode, cloud_remove_remote, cloud_set_device_name, cloud_set_enabled,
    cloud_settings_applied, cloud_settings_defer, cloud_settings_download,
    cloud_settings_keep_local, cloud_settings_sync, cloud_state, cloud_sync_now,
    cloud_wait_for_changes, DirtyFile,
};
use crate::cloud::engine::{now_ms, project_remote, tombstone_remote, version_remote};
use crate::cloud::settings::SETTINGS_REMOTE;
use crate::cloud::state::ProjectState;
use crate::cloud::store::{Endpoints, StoreError};
use crate::cloud::tests::fake_dropbox::{
    black_hole, point_at, FakeDropbox, Pointed, Reply, DISPLAY_NAME, EMAIL,
};
use oleafly_core::content::ContentHash;
use oleafly_core::hlc::{Hlc, Stamp};
use oleafly_core::ids::{DeviceId, ProjectId};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::MutexGuard;
use tauri::Manager as _;

struct Harness {
    pointed: Pointed,
    fake: FakeDropbox,
    _dir: tempfile::TempDir,
    _env: MutexGuard<'static, ()>,
}

impl Harness {
    async fn new() -> Self {
        let env = crate::paths::data_dir_env_lock();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", dir.path());
        let fake = FakeDropbox::start().await;
        let pointed = point_at(fake.endpoints());
        Self {
            pointed,
            fake,
            _dir: dir,
            _env: env,
        }
    }

    async fn connect(&self) {
        let begin = view(cloud_connect_begin(true).await.unwrap());
        assert_eq!(begin["paste"], true);
        let done = cloud_connect_paste(text(&begin["flowId"]), "code-1".into())
            .await
            .unwrap();
        assert_eq!(view(done)["email"], EMAIL);
    }

    fn project(&self, id: &str, name: &str, files: &[(&str, &str)]) -> PathBuf {
        let root = crate::paths::create_project_dir(id).unwrap();
        write(
            &root,
            "project.json",
            &json!({"name": name, "main_doc": "main.tex"}).to_string(),
        );
        for (path, content) in files {
            write(&root, path, content);
        }
        root
    }

    fn remote(&self, path: &str) -> Option<String> {
        self.fake
            .with(|dropbox| dropbox.read(path))
            .map(|bytes| String::from_utf8(bytes).unwrap())
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}

fn view<T: serde::Serialize>(value: T) -> Value {
    serde_json::to_value(value).unwrap()
}

fn text(value: &Value) -> String {
    value.as_str().unwrap().to_string()
}

fn code(error: &str) -> String {
    let body = error
        .strip_prefix(crate::app_error::PREFIX)
        .unwrap_or(error);
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| value["code"].as_str().map(str::to_string))
        .unwrap_or_else(|| error.to_string())
}

fn code_of(value: &Value) -> String {
    value.as_str().map(code).unwrap_or_default()
}

fn write(root: &Path, path: &str, content: &str) {
    let mut target = root.to_path_buf();
    for part in path.split('/') {
        target.push(part);
    }
    std::fs::create_dir_all(target.parent().unwrap()).unwrap();
    std::fs::write(target, content).unwrap();
}

fn read(root: &Path, path: &str) -> String {
    let mut target = root.to_path_buf();
    for part in path.split('/') {
        target.push(part);
    }
    std::fs::read_to_string(target).unwrap()
}

fn entry(local_id: &str) -> ProjectState {
    crate::cloud::state::snapshot()
        .unwrap()
        .projects
        .get(local_id)
        .cloned()
        .unwrap_or_default()
}

fn cloud_of(local_id: &str) -> ProjectId {
    entry(local_id).cloud.unwrap()
}

fn report_for(report: &Value, local_id: &str) -> Value {
    report["projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|project| project["localId"] == local_id)
        .cloned()
        .unwrap_or(Value::Null)
}

fn listed(state: &Value, local_id: &str) -> Value {
    state["projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|project| project["localId"] == local_id)
        .cloned()
        .unwrap_or(Value::Null)
}

fn fresh_stamp() -> Value {
    serde_json::to_value(Stamp::new(
        Hlc::from_raw((now_ms() + 1_000) << 16),
        DeviceId::new(),
    ))
    .unwrap()
}

async fn sync() -> Value {
    view(cloud_sync_now(None).await.unwrap())
}

async fn state() -> Value {
    view(cloud_state().await.unwrap())
}

fn edit_remote(fake: &FakeDropbox, cloud: ProjectId, path: &str, content: &str) {
    fake.with(|dropbox| {
        let rev = dropbox.write(
            &format!("{}/files/{path}", project_remote(cloud)),
            content.as_bytes().to_vec(),
        );
        let mut version: Value =
            serde_json::from_slice(&dropbox.read(&version_remote(cloud)).unwrap()).unwrap();
        let files = version["files"].as_array_mut().unwrap();
        files.retain(|file| file["path"] != path);
        files.push(json!({
            "path": path,
            "hash": ContentHash::digest(content.as_bytes()).to_hex(),
            "size": content.len(),
            "rev": rev,
        }));
        version["stamp"] = fresh_stamp();
        version["device"] = json!("Laptop");
        dropbox.write(
            &version_remote(cloud),
            serde_json::to_vec(&version).unwrap(),
        );
    });
}

fn seed_remote(fake: &FakeDropbox, name: &str, tex: &str) -> ProjectId {
    let cloud = ProjectId::new();
    let meta = json!({"name": name, "main_doc": "main.tex"}).to_string();
    fake.with(|dropbox| {
        let base = project_remote(cloud);
        let tex_rev = dropbox.write(
            &format!("{base}/files/main.tex"),
            tex.as_bytes().to_vec(),
        );
        let meta_rev = dropbox.write(
            &format!("{base}/files/project.json"),
            meta.as_bytes().to_vec(),
        );
        let version = json!({
            "v": 1,
            "project": cloud,
            "name": name,
            "manifest": {"name": name, "main_doc": "main.tex"},
            "stamp": fresh_stamp(),
            "device": "Laptop",
            "files": [
                {"path": "main.tex", "hash": ContentHash::digest(tex.as_bytes()).to_hex(), "size": tex.len(), "rev": tex_rev},
                {"path": "project.json", "hash": ContentHash::digest(meta.as_bytes()).to_hex(), "size": meta.len(), "rev": meta_rev}
            ]
        });
        dropbox.write(&version_remote(cloud), serde_json::to_vec(&version).unwrap());
    });
    cloud
}

fn write_settings(fake: &FakeDropbox, blob: &Value) {
    fake.with(|dropbox| dropbox.write(SETTINGS_REMOTE, serde_json::to_vec(blob).unwrap()));
}

fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(crate::state::AppState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap()
}

async fn loopback_flow() -> Option<(String, String)> {
    let begin = view(cloud_connect_begin(false).await.unwrap());
    if begin["paste"] == true {
        cloud_connect_cancel(text(&begin["flowId"]));
        return None;
    }
    let url = reqwest::Url::parse(&text(&begin["authUrl"])).unwrap();
    let redirect = url
        .query_pairs()
        .find(|(key, _)| key == "redirect_uri")
        .map(|(_, value)| value.into_owned())
        .unwrap();
    Some((text(&begin["flowId"]), redirect))
}

async fn visit(url: String) -> u16 {
    reqwest::Client::new()
        .get(url)
        .send()
        .await
        .unwrap()
        .status()
        .as_u16()
}

#[tokio::test]
async fn connecting_by_pasted_code_or_by_the_loopback_page_stores_the_account() {
    let harness = Harness::new().await;

    let begin = view(cloud_connect_begin(true).await.unwrap());
    let flow = text(&begin["flowId"]);
    let auth_url = text(&begin["authUrl"]);
    assert!(auth_url.contains("code_challenge_method=S256"));
    assert!(!auth_url.contains("redirect_uri"));
    for (pasted, expected) in [
        ("two words", "cloud.code_invalid"),
        ("bad", "cloud.code_invalid"),
        ("denied", "cloud.sign_in_cancelled"),
    ] {
        let error = cloud_connect_paste(flow.clone(), pasted.into())
            .await
            .err()
            .unwrap();
        assert_eq!(code(&error), expected, "pasting {pasted}");
    }
    assert_eq!(
        code(&cloud_connect_wait(flow.clone()).await.err().unwrap()),
        "cloud.sign_in_cancelled"
    );
    let pasted = format!("http://127.0.0.1:53171/oauth/dropbox?state={flow}&code=code-1");
    let done = view(cloud_connect_paste(flow.clone(), pasted).await.unwrap());
    assert_eq!(done["email"], EMAIL);
    let form = harness
        .fake
        .with(|dropbox| dropbox.token_forms.last().cloned().unwrap());
    assert_eq!(form["code"], "code-1");
    assert_eq!(form["grant_type"], "authorization_code");
    assert_eq!(form["code_verifier"].len(), 86);
    assert!(!form.contains_key("redirect_uri"));
    assert!(!form.contains_key("client_secret"));
    assert_eq!(
        code(
            &cloud_connect_paste(flow, "code-2".into())
                .await
                .err()
                .unwrap()
        ),
        "cloud.code_invalid"
    );
    let connected = state().await;
    assert_eq!(connected["status"], "connected");
    assert_eq!(connected["email"], EMAIL);
    assert_eq!(connected["displayName"], DISPLAY_NAME);
    assert_eq!(connected["enabled"], true);
    assert_eq!(connected["lastEmail"], EMAIL);

    harness.fake.with(|dropbox| dropbox.omit_refresh = true);
    let begin = view(cloud_connect_begin(true).await.unwrap());
    assert_eq!(
        code(
            &cloud_connect_paste(text(&begin["flowId"]), "code-3".into())
                .await
                .err()
                .unwrap()
        ),
        "cloud.code_invalid"
    );
    harness.fake.with(|dropbox| dropbox.omit_refresh = false);
    cloud_connect_cancel(text(&begin["flowId"]));
    cloud_connect_cancel("no-such-flow".into());

    let stale = text(&view(cloud_connect_begin(true).await.unwrap())["flowId"]);
    let flow = text(&view(cloud_connect_begin(true).await.unwrap())["flowId"]);
    assert_eq!(
        code(
            &cloud_connect_paste(stale, "code-5".into())
                .await
                .err()
                .unwrap()
        ),
        "cloud.code_invalid"
    );
    let huge = "x".repeat(2 * 1024 * 1024);
    for reply in [
        Reply::Status(500),
        Reply::Raw("not json"),
        Reply::Json(json!({"access_token": "", "expires_in": 60})),
        Reply::Json(json!({"padding": huge})),
    ] {
        harness
            .fake
            .with(|dropbox| dropbox.fault("oauth2/token", None, reply, 1));
        let error = cloud_connect_paste(flow.clone(), "code-6".into())
            .await
            .err()
            .unwrap();
        assert_eq!(code(&error), "cloud.network");
    }
    cloud_connect_cancel(flow);
    for (reply, expected) in [
        (Reply::Status(401), "cloud.revoked"),
        (Reply::Status(500), "cloud.network"),
        (Reply::Raw("not json"), "cloud.network"),
    ] {
        harness
            .fake
            .with(|dropbox| dropbox.fault("users/get_current_account", None, reply, 1));
        let flow = text(&view(cloud_connect_begin(true).await.unwrap())["flowId"]);
        let error = cloud_connect_paste(flow, "code-7".into())
            .await
            .err()
            .unwrap();
        assert_eq!(code(&error), expected);
    }

    if let Some((flow, _)) = loopback_flow().await {
        assert_eq!(
            code(
                &cloud_connect_paste(flow.clone(), "code-4".into())
                    .await
                    .err()
                    .unwrap()
            ),
            "cloud.code_invalid"
        );
        assert_eq!(
            code(&cloud_connect_wait(flow).await.err().unwrap()),
            "cloud.sign_in_cancelled"
        );
    }
    if let Some((flow, redirect)) = loopback_flow().await {
        assert_eq!(visit(format!("{redirect}?state={flow}")).await, 400);
        let (done, status) = tokio::join!(
            cloud_connect_wait(flow.clone()),
            visit(format!("{redirect}?state={flow}&code=loop%2Dcode+%zz"))
        );
        assert_eq!(status, 200);
        assert_eq!(view(done.unwrap())["email"], EMAIL);
        let form = harness
            .fake
            .with(|dropbox| dropbox.token_forms.last().cloned().unwrap());
        assert_eq!(form["code"], "loop-code %zz");
        assert_eq!(form["redirect_uri"], redirect);
    }
    if let Some((flow, redirect)) = loopback_flow().await {
        let (done, status) = tokio::join!(
            cloud_connect_wait(flow.clone()),
            visit(format!("{redirect}?state={flow}&error=access_denied"))
        );
        assert_eq!(status, 200);
        assert_eq!(code(&done.err().unwrap()), "cloud.sign_in_cancelled");
    }
    if let Some((flow, _)) = loopback_flow().await {
        cloud_connect_cancel(flow.clone());
        assert_eq!(
            code(&cloud_connect_wait(flow).await.err().unwrap()),
            "cloud.sign_in_cancelled"
        );
    }
    if let Some((flow, _)) = loopback_flow().await {
        let (done, ()) = tokio::join!(cloud_connect_wait(flow.clone()), async {
            tokio::task::yield_now().await;
            cloud_connect_cancel(flow.clone());
        });
        assert_eq!(code(&done.err().unwrap()), "cloud.sign_in_cancelled");
    }
    assert_eq!(state().await["status"], "connected");
}

#[tokio::test]
async fn the_state_follows_the_account_from_disconnected_to_revoked() {
    let harness = Harness::new().await;
    let record = crate::paths::oleafly_root()
        .unwrap()
        .join("cloud")
        .join("connection.json");
    std::fs::create_dir_all(&record).unwrap();
    assert_eq!(code(&cloud_state().await.err().unwrap()), "cloud.local_io");
    std::fs::remove_dir(&record).unwrap();
    std::fs::write(&record, vec![b' '; 1024 * 1024 + 1]).unwrap();
    assert_eq!(code(&cloud_state().await.err().unwrap()), "cloud.local_io");
    std::fs::write(&record, b"{not json").unwrap();
    assert_eq!(code(&cloud_state().await.err().unwrap()), "cloud.local_io");
    std::fs::remove_file(&record).unwrap();
    let empty = state().await;
    assert_eq!(empty["status"], "disconnected");
    assert_eq!(empty["projects"], json!([]));
    assert_eq!(
        code(&cloud_details().await.err().unwrap()),
        "cloud.not_connected"
    );
    assert_eq!(
        code(&cloud_sync_now(None).await.err().unwrap()),
        "cloud.not_connected"
    );
    cloud_set_device_name("Desk".into()).unwrap();
    let named = state().await;
    assert_eq!(named["status"], "disconnected");
    assert_eq!(named["deviceName"], "Desk");

    let root = harness.project("thesis", "Thesis", &[("main.tex", "\\section{One}")]);
    harness.connect().await;
    let connected = state().await;
    assert_eq!(connected["linkedCount"], 0);
    let thesis = listed(&connected, "thesis");
    assert_eq!(thesis["name"], "Thesis");
    assert_eq!(thesis["mode"], "sync");
    assert_eq!(thesis["lastSyncedMs"], 0);
    assert_eq!(thesis["cloudId"], "");
    let binding = crate::project_ids::ensure("thesis", &root).unwrap();
    assert_eq!(
        listed(&state().await, "thesis")["cloudId"],
        binding.project.to_string()
    );

    let first = sync().await;
    assert_eq!(first["error"], Value::Null);
    assert_eq!(report_for(&first, "thesis")["uploaded"], 2);
    let synced = state().await;
    let thesis = listed(&synced, "thesis");
    assert_eq!(thesis["cloudId"], cloud_of("thesis").to_string());
    assert!(thesis["sizeBytes"].as_u64().unwrap() > 0);
    assert!(thesis["lastSyncedMs"].as_u64().unwrap() > 0);
    assert!(synced["lastSyncedMs"].as_u64().unwrap() > 0);

    harness.fake.with(|dropbox| {
        dropbox.refresh_revoked = true;
        dropbox.expire_tokens();
    });
    write(&root, "main.tex", "\\section{One, revised}");
    let revoked = sync().await;
    assert_eq!(code_of(&revoked["error"]), "cloud.revoked");
    let after = state().await;
    assert_eq!(after["status"], "revoked");
    assert_eq!(code_of(&after["lastError"]), "cloud.revoked");
    assert_eq!(
        code(&cloud_sync_now(None).await.err().unwrap()),
        "cloud.revoked"
    );
    let details = view(cloud_details().await.unwrap());
    assert_eq!(details["space"], Value::Null);
    assert_eq!(code_of(&details["error"]), "cloud.revoked");

    cloud_disconnect().await.unwrap();
    assert!(harness.fake.with(|dropbox| dropbox.revoked.is_empty()));
    let gone = state().await;
    assert_eq!(gone["status"], "disconnected");
    assert_eq!(gone["lastEmail"], EMAIL);
    assert_eq!(gone["deviceName"], "Desk");
}

#[tokio::test]
async fn details_show_the_space_and_the_projects_that_live_only_in_dropbox() {
    let harness = Harness::new().await;
    harness.connect().await;
    harness.project("kept", "Kept", &[("main.tex", "kept")]);
    harness.project("binned", "Binned", &[("main.tex", "binned")]);
    assert_eq!(sync().await["error"], Value::Null);
    let binned = cloud_of("binned");
    let laptop = seed_remote(&harness.fake, "From the laptop", "laptop text");
    harness.fake.with(|dropbox| {
        dropbox.write("/projects/not-a-project/version.json", b"{}".to_vec());
        dropbox.page_size = 1;
    });
    let app = mock_app();
    crate::project::recycle_project("binned".into(), app.state())
        .await
        .unwrap();

    let details = view(cloud_details().await.unwrap());
    assert_eq!(details["error"], Value::Null);
    assert_eq!(
        details["space"]["used"],
        harness.fake.with(|dropbox| dropbox.used())
    );
    assert_eq!(details["space"]["allocated"], 2_u64 * 1024 * 1024 * 1024);
    let remote = details["remote"].as_array().unwrap();
    assert_eq!(remote.len(), 2);
    let find = |cloud: ProjectId| {
        remote
            .iter()
            .find(|project| project["cloudId"] == cloud.to_string())
            .cloned()
            .unwrap()
    };
    let from_laptop = find(laptop);
    assert_eq!(from_laptop["name"], "From the laptop");
    assert_eq!(from_laptop["mode"], "download");
    assert_eq!(from_laptop["recycled"], false);
    assert_eq!(from_laptop["localId"], Value::Null);
    assert!(from_laptop["sizeBytes"].as_u64().unwrap() > 0);
    let recycled = find(binned);
    assert_eq!(recycled["name"], "Binned");
    assert_eq!(recycled["recycled"], true);

    harness.fake.with(|dropbox| {
        dropbox.fault("users/get_space_usage", None, Reply::Status(500), 1);
        dropbox.fault("users/get_space_usage", None, Reply::Raw("not json"), 1);
    });
    for _ in 0..2 {
        let without_space = view(cloud_details().await.unwrap());
        assert_eq!(without_space["space"], Value::Null);
        assert_eq!(without_space["remote"].as_array().unwrap().len(), 2);
    }

    harness.fake.with(|dropbox| {
        dropbox.fault("files/list_folder", None, Reply::Status(429), 4);
    });
    let limited = view(cloud_details().await.unwrap());
    assert_eq!(code_of(&limited["error"]), "cloud.rate_limited");
    assert_eq!(limited["remote"], json!([]));

    harness.fake.with(|dropbox| dropbox.expire_tokens());
    let refreshed = view(cloud_details().await.unwrap());
    assert_eq!(refreshed["error"], Value::Null);
    assert_eq!(refreshed["space"]["allocated"], 2_u64 * 1024 * 1024 * 1024);
    assert_eq!(view(cloud_state().await.unwrap())["status"], "connected");
}

#[tokio::test]
async fn sync_uploads_then_downloads_what_another_computer_changed() {
    let harness = Harness::new().await;
    harness.connect().await;
    let alpha = harness.project(
        "alpha",
        "Alpha",
        &[("main.tex", "alpha v1"), ("refs.bib", "@book{a}")],
    );
    harness.project("beta", "Beta", &[("main.tex", "beta v1")]);

    let first = sync().await;
    assert_eq!(first["error"], Value::Null);
    assert_eq!(report_for(&first, "alpha")["uploaded"], 3);
    assert_eq!(report_for(&first, "beta")["uploaded"], 2);
    let alpha_cloud = cloud_of("alpha");
    let main_remote = format!("{}/files/main.tex", project_remote(alpha_cloud));
    assert_eq!(harness.remote(&main_remote).as_deref(), Some("alpha v1"));

    assert_eq!(sync().await["projects"], json!([]));
    harness.fake.with(|dropbox| dropbox.clear_calls());
    let quiet = sync().await;
    assert_eq!(quiet["projects"], json!([]));
    assert_eq!(quiet["error"], Value::Null);
    harness.fake.with(|dropbox| {
        assert_eq!(dropbox.file_calls(), 0);
        assert_eq!(dropbox.calls("files/list_folder/continue"), 1);
    });

    edit_remote(
        &harness.fake,
        alpha_cloud,
        "main.tex",
        "alpha v2 from the laptop",
    );
    let pulled = sync().await;
    assert_eq!(report_for(&pulled, "alpha")["downloaded"], 1);
    assert_eq!(report_for(&pulled, "beta"), Value::Null);
    assert_eq!(read(&alpha, "main.tex"), "alpha v2 from the laptop");

    edit_remote(
        &harness.fake,
        alpha_cloud,
        "main.tex",
        "alpha v3 while the file is open",
    );
    let open: DirtyFile =
        serde_json::from_value(json!({"localId": "alpha", "path": "/main.tex"})).unwrap();
    let kept = view(cloud_sync_now(Some(vec![open])).await.unwrap());
    assert_eq!(report_for(&kept, "alpha")["downloaded"], 0);
    assert_eq!(read(&alpha, "main.tex"), "alpha v2 from the laptop");
    assert!(entry("alpha").remote_dirty);
    let caught_up = sync().await;
    assert_eq!(report_for(&caught_up, "alpha")["downloaded"], 1);
    assert_eq!(read(&alpha, "main.tex"), "alpha v3 while the file is open");

    harness.fake.with(|dropbox| {
        dropbox.reset_cursors();
        dropbox.clear_calls();
    });
    let reset = sync().await;
    assert_eq!(reset["error"], Value::Null);
    assert_eq!(reset["projects"], json!([]));
    harness.fake.with(|dropbox| {
        assert_eq!(dropbox.calls("files/list_folder/get_latest_cursor"), 1);
        assert_eq!(dropbox.calls("files/get_metadata"), 2);
    });

    let forms = harness.fake.with(|dropbox| {
        dropbox.expire_tokens();
        dropbox.token_forms.len()
    });
    write(&alpha, "main.tex", "alpha v4, edited on this computer");
    let pushed = sync().await;
    assert_eq!(pushed["error"], Value::Null);
    assert_eq!(report_for(&pushed, "alpha")["uploaded"], 1);
    assert_eq!(
        harness.remote(&main_remote).as_deref(),
        Some("alpha v4, edited on this computer")
    );
    let refreshes = harness.fake.with(|dropbox| dropbox.token_forms.len()) - forms;
    assert_eq!(refreshes, 1);
}

#[tokio::test]
async fn a_full_dropbox_stops_uploads_until_space_returns() {
    let harness = Harness::new().await;
    harness.connect().await;
    let alpha = harness.project("alpha", "Alpha", &[("main.tex", "small")]);
    assert_eq!(sync().await["error"], Value::Null);

    harness
        .fake
        .with(|dropbox| dropbox.quota = Some(dropbox.used() + 4));
    write(&alpha, "main.tex", "a much longer edit that no longer fits");
    let full = sync().await;
    assert_eq!(code_of(&full["error"]), "cloud.quota_full");
    let after = state().await;
    assert_eq!(after["quotaFull"], true);
    assert_eq!(code_of(&after["lastError"]), "cloud.quota_full");
    assert_eq!(
        code_of(&listed(&after, "alpha")["error"]),
        "cloud.quota_full"
    );

    harness.fake.with(|dropbox| dropbox.clear_calls());
    let still = sync().await;
    assert_eq!(code_of(&still["error"]), "cloud.quota_full");
    harness.fake.with(|dropbox| {
        assert_eq!(dropbox.calls("files/upload_session/start"), 0);
        assert_eq!(dropbox.calls("users/get_space_usage"), 1);
        dropbox.fault("users/get_space_usage", None, Reply::Status(500), 1);
        dropbox.clear_calls();
    });
    let unknown = sync().await;
    assert_eq!(code_of(&unknown["error"]), "cloud.quota_full");
    harness.fake.with(|dropbox| {
        assert_eq!(dropbox.calls("files/upload_session/start"), 1);
        assert_eq!(dropbox.calls("files/upload_session/finish_batch_v2"), 1);
        dropbox.quota = None;
    });

    let freed = sync().await;
    assert_eq!(freed["error"], Value::Null);
    assert_eq!(report_for(&freed, "alpha")["uploaded"], 1);
    assert_eq!(state().await["quotaFull"], false);
}

#[tokio::test]
async fn server_errors_conflicts_rate_limits_and_busy_projects_are_reported() {
    let harness = Harness::new().await;
    harness.connect().await;
    let alpha = harness.project("alpha", "Alpha", &[("main.tex", "alpha")]);
    harness.project("beta", "Beta", &[("main.tex", "beta")]);
    assert_eq!(sync().await["error"], Value::Null);
    assert_eq!(sync().await["error"], Value::Null);

    write(&alpha, "main.tex", "alpha, second draft");
    harness.fake.with(|dropbox| {
        dropbox.fault(
            "files/download",
            Some("version.json"),
            Reply::Status(500),
            4,
        );
    });
    let failed = sync().await;
    assert_eq!(failed["error"], Value::Null);
    assert_eq!(
        code_of(&report_for(&failed, "alpha")["error"]),
        "cloud.server"
    );
    assert_eq!(
        code(entry("alpha").last_error.as_deref().unwrap()),
        "cloud.server"
    );
    assert!(entry("alpha").remote_dirty);

    harness.fake.with(|dropbox| {
        dropbox.fault(
            "files/upload",
            Some("version.json"),
            Reply::Refuse("path/conflict/file/.."),
            1,
        );
    });
    let retried = sync().await;
    assert_eq!(report_for(&retried, "alpha")["error"], Value::Null);
    assert_eq!(report_for(&retried, "alpha")["uploaded"], 1);

    write(&alpha, "main.tex", "alpha, third draft with more words");
    harness.fake.with(|dropbox| {
        dropbox.fault(
            "files/upload",
            Some("version.json"),
            Reply::Refuse("path/conflict/file/.."),
            3,
        );
    });
    let busy = sync().await;
    assert_eq!(
        code_of(&report_for(&busy, "alpha")["error"]),
        "cloud.remote_busy"
    );

    harness.fake.with(|dropbox| {
        dropbox.fault("files/list_folder/continue", None, Reply::Status(429), 4);
    });
    let limited = sync().await;
    assert_eq!(code_of(&limited["error"]), "cloud.rate_limited");
    assert_eq!(limited["projects"], json!([]));
    assert_eq!(limited["lastSyncedMs"], 0);
    assert_eq!(code_of(&state().await["lastError"]), "cloud.rate_limited");

    harness.fake.with(|dropbox| {
        dropbox.fault("files/list_folder/continue", None, Reply::Status(500), 4);
    });
    let recovered = sync().await;
    assert_eq!(recovered["error"], Value::Null);
    assert_eq!(report_for(&recovered, "alpha")["uploaded"], 1);
    assert!(crate::cloud::state::snapshot().unwrap().cursor.is_none());

    write(
        &alpha,
        "main.tex",
        "alpha, a fourth draft that meets a busy dropbox",
    );
    harness.fake.with(|dropbox| {
        dropbox.fault(
            "files/upload_session/finish_batch_v2",
            None,
            Reply::Status(429),
            4,
        );
    });
    let throttled = sync().await;
    assert_eq!(code_of(&throttled["error"]), "cloud.rate_limited");
    assert_eq!(
        code_of(&report_for(&throttled, "alpha")["error"]),
        "cloud.rate_limited"
    );

    let lock = crate::worktree_lock::ProjectWorktreeLock::exclusive("beta").unwrap();
    let locked = view(
        cloud_project_resolve_hold("beta".into(), "restore".into(), None)
            .await
            .unwrap(),
    );
    assert_eq!(code_of(&locked["error"]), "cloud.project_busy");
    drop(lock);
    assert_eq!(
        code(
            &cloud_project_resolve_hold("beta".into(), "maybe".into(), None)
                .await
                .err()
                .unwrap()
        ),
        "cloud.server"
    );
}

#[tokio::test]
async fn an_unreachable_dropbox_reports_network_errors_and_keeps_the_account() {
    let harness = Harness::new().await;
    harness.connect().await;
    harness.project("alpha", "Alpha", &[("main.tex", "alpha")]);
    assert_eq!(sync().await["error"], Value::Null);

    let hole = black_hole().await;
    harness.pointed.repoint(Endpoints {
        token: hole.endpoints.token.clone(),
        ..harness.fake.endpoints()
    });
    harness.fake.with(|dropbox| dropbox.expire_tokens());
    let refused = sync().await;
    assert_eq!(code_of(&refused["error"]), "cloud.network");
    assert_eq!(state().await["status"], "connected");

    harness.pointed.repoint(hole.endpoints.clone());
    let offline = sync().await;
    assert_eq!(code_of(&offline["error"]), "cloud.network");
    assert_eq!(offline["projects"], json!([]));
    let details = view(cloud_details().await.unwrap());
    assert_eq!(code_of(&details["error"]), "cloud.network");
    assert_eq!(details["space"], Value::Null);
    let after = state().await;
    assert_eq!(after["status"], "connected");
    assert_eq!(code_of(&after["lastError"]), "cloud.network");

    cloud_disconnect().await.unwrap();
    assert_eq!(state().await["status"], "disconnected");
}

#[tokio::test]
async fn pausing_removing_and_resuming_projects() {
    let harness = Harness::new().await;
    harness.connect().await;
    let alpha = harness.project("alpha", "Alpha", &[("main.tex", "alpha")]);
    harness.project("beta", "Beta", &[("main.tex", "beta")]);
    assert_eq!(sync().await["error"], Value::Null);
    let alpha_cloud = cloud_of("alpha");
    let main_remote = format!("{}/files/main.tex", project_remote(alpha_cloud));

    cloud_project_set_mode("alpha".into(), "pause".into())
        .await
        .unwrap();
    assert_eq!(listed(&state().await, "alpha")["mode"], "pause");
    write(&alpha, "main.tex", "alpha, written while paused");
    let paused = sync().await;
    assert_eq!(report_for(&paused, "alpha"), Value::Null);
    assert_eq!(harness.remote(&main_remote).as_deref(), Some("alpha"));

    cloud_project_set_mode("alpha".into(), "sync".into())
        .await
        .unwrap();
    assert_eq!(listed(&state().await, "alpha")["mode"], "sync");
    assert_eq!(report_for(&sync().await, "alpha")["uploaded"], 1);
    assert_eq!(
        harness.remote(&main_remote).as_deref(),
        Some("alpha, written while paused")
    );
    assert_eq!(
        code(
            &cloud_project_set_mode("alpha".into(), "later".into())
                .await
                .unwrap_err()
        ),
        "cloud.server"
    );

    let tombstone_name = format!("{alpha_cloud}.json");
    harness.fake.with(|dropbox| {
        dropbox.fault(
            "files/upload",
            Some(&tombstone_name),
            Reply::Refuse("path/insufficient_space/.."),
            1,
        );
    });
    assert_eq!(
        code(&cloud_project_remove("alpha".into()).await.unwrap_err()),
        "cloud.quota_full"
    );
    harness.fake.with(|dropbox| {
        dropbox.fault("files/delete_v2", None, Reply::Status(400), 1);
    });
    cloud_project_remove("alpha".into()).await.unwrap();
    assert!(harness.remote(&tombstone_remote(alpha_cloud)).is_some());
    assert!(harness.remote(&version_remote(alpha_cloud)).is_some());
    assert!(crate::cloud::state::snapshot().unwrap().projects["alpha"].remove_pending);
    assert_eq!(listed(&state().await, "alpha")["mode"], "removed");
    sync().await;
    assert!(harness.remote(&version_remote(alpha_cloud)).is_none());
    assert!(!crate::cloud::state::snapshot().unwrap().projects["alpha"].remove_pending);
    let removed = state().await;
    assert_eq!(listed(&removed, "alpha")["mode"], "removed");
    assert_eq!(
        listed(&removed, "alpha")["removedBy"],
        removed["deviceName"]
    );
    assert_eq!(report_for(&sync().await, "alpha"), Value::Null);
    assert!(harness.remote(&version_remote(alpha_cloud)).is_none());
    harness.fake.with(|dropbox| {
        dropbox.fault("files/delete_v2", None, Reply::Status(400), 1);
    });
    assert_eq!(
        code(
            &cloud_project_set_mode("alpha".into(), "sync".into())
                .await
                .unwrap_err()
        ),
        "cloud.server"
    );
    assert_eq!(listed(&state().await, "alpha")["mode"], "removed");

    cloud_project_set_mode("alpha".into(), "sync".into())
        .await
        .unwrap();
    assert!(harness.remote(&tombstone_remote(alpha_cloud)).is_none());
    assert_eq!(report_for(&sync().await, "alpha")["uploaded"], 2);
    assert!(harness.remote(&version_remote(alpha_cloud)).is_some());

    let beta_cloud = cloud_of("beta");
    harness.fake.with(|dropbox| {
        dropbox.remove(&project_remote(beta_cloud));
        dropbox.write(
            &tombstone_remote(beta_cloud),
            json!({"device": "Laptop", "at_ms": now_ms()})
                .to_string()
                .into_bytes(),
        );
    });
    sync().await;
    let elsewhere = listed(&state().await, "beta");
    assert_eq!(elsewhere["mode"], "removed");
    assert_eq!(elsewhere["removedBy"], "Laptop");
}

#[tokio::test]
async fn mass_deletions_wait_for_a_choice_to_restore_or_delete() {
    let harness = Harness::new().await;
    harness.connect().await;
    let chapters: Vec<(String, String)> = (1..=22)
        .map(|number| {
            (
                format!("chapters/ch{number:02}.tex"),
                format!("chapter {number}"),
            )
        })
        .collect();
    let mut files: Vec<(&str, &str)> = vec![("main.tex", "\\input{chapters}")];
    files.extend(
        chapters
            .iter()
            .map(|(path, content)| (path.as_str(), content.as_str())),
    );
    let book = harness.project("book", "Book", &files);
    assert_eq!(report_for(&sync().await, "book")["uploaded"], 24);
    let cloud = cloud_of("book");
    let remove_chapters = || {
        for number in 1..=21 {
            std::fs::remove_file(book.join("chapters").join(format!("ch{number:02}.tex"))).unwrap();
        }
    };

    remove_chapters();
    let held = sync().await;
    assert_eq!(report_for(&held, "book")["held"], true);
    let waiting = listed(&state().await, "book");
    assert_eq!(waiting["mode"], "held");
    assert_eq!(
        waiting["hold"],
        json!({"kind": "massDelete", "count": 21, "total": 24})
    );

    let restored = view(
        cloud_project_resolve_hold("book".into(), "restore".into(), None)
            .await
            .unwrap(),
    );
    assert_eq!(restored["downloaded"], 21);
    assert_eq!(restored["error"], Value::Null);
    assert_eq!(read(&book, "chapters/ch01.tex"), "chapter 1");
    assert_eq!(listed(&state().await, "book")["mode"], "sync");

    remove_chapters();
    assert_eq!(report_for(&sync().await, "book")["held"], true);
    let deleted = view(
        cloud_project_resolve_hold("book".into(), "delete".into(), None)
            .await
            .unwrap(),
    );
    assert_eq!(deleted["deletedRemote"], 21);
    let files = format!("{}/files/chapters", project_remote(cloud));
    assert!(harness.remote(&format!("{files}/ch01.tex")).is_none());
    assert_eq!(
        harness.remote(&format!("{files}/ch22.tex")).as_deref(),
        Some("chapter 22")
    );
    assert_eq!(listed(&state().await, "book")["mode"], "sync");
}

#[tokio::test]
async fn downloads_create_find_or_restore_library_projects() {
    let harness = Harness::new().await;
    harness.connect().await;
    let app = mock_app();
    let projects = crate::paths::projects_root().unwrap();
    let laptop = seed_remote(&harness.fake, "Laptop Paper", "\\section{Laptop}");

    let done = view(
        cloud_download_project(laptop.to_string(), app.state())
            .await
            .unwrap(),
    );
    assert_eq!(done["restored"], false);
    let local = text(&done["localId"]);
    assert_eq!(
        read(&projects.join(&local), "main.tex"),
        "\\section{Laptop}"
    );
    assert_eq!(entry(&local).cloud, Some(laptop));
    assert_eq!(listed(&state().await, &local)["name"], "Laptop Paper");

    let again = view(
        cloud_download_project(laptop.to_string(), app.state())
            .await
            .unwrap(),
    );
    assert_eq!(again["localId"], local.as_str());
    assert_eq!(again["restored"], false);

    crate::project::recycle_project(local.clone(), app.state())
        .await
        .unwrap();
    assert!(!projects.join(&local).exists());
    let back = view(
        cloud_download_project(laptop.to_string(), app.state())
            .await
            .unwrap(),
    );
    assert_eq!(back["restored"], true);
    assert_eq!(back["localId"], local.as_str());
    assert!(projects.join(&local).join("main.tex").is_file());
    assert!(entry(&local).remote_dirty);

    std::fs::remove_dir_all(projects.join(&local)).unwrap();
    let fresh = view(
        cloud_download_project(laptop.to_string(), app.state())
            .await
            .unwrap(),
    );
    assert_eq!(fresh["restored"], false);
    let fresh_id = text(&fresh["localId"]);
    assert_eq!(
        read(&projects.join(&fresh_id), "main.tex"),
        "\\section{Laptop}"
    );

    for missing in [ProjectId::new().to_string(), "not-an-id".to_string()] {
        assert_eq!(
            code(
                &cloud_download_project(missing, app.state())
                    .await
                    .err()
                    .unwrap()
            ),
            "cloud.not_found"
        );
    }

    let limited = seed_remote(&harness.fake, "Limited", "\\section{Limited}");
    harness.fake.with(|dropbox| {
        dropbox.fault(
            "files/download",
            Some("version.json"),
            Reply::Status(429),
            4,
        );
    });
    assert_eq!(
        code(
            &cloud_download_project(limited.to_string(), app.state())
                .await
                .err()
                .unwrap()
        ),
        "cloud.rate_limited"
    );

    let broken = seed_remote(&harness.fake, "Broken", "\\section{Broken}");
    harness.fake.with(|dropbox| {
        let mut version: Value =
            serde_json::from_slice(&dropbox.read(&version_remote(broken)).unwrap()).unwrap();
        version["files"][0]["hash"] = json!(ContentHash::digest(b"other bytes").to_hex());
        dropbox.write(
            &version_remote(broken),
            serde_json::to_vec(&version).unwrap(),
        );
    });
    assert_eq!(
        code(
            &cloud_download_project(broken.to_string(), app.state())
                .await
                .err()
                .unwrap()
        ),
        "cloud.download_missing"
    );
}

#[tokio::test]
async fn switching_off_renaming_and_disconnecting() {
    let harness = Harness::new().await;
    cloud_disconnect().await.unwrap();
    assert_eq!(
        code(&cloud_set_enabled(true).unwrap_err()),
        "cloud.not_connected"
    );
    assert_eq!(
        code(&cloud_set_device_name("bad/name".into()).unwrap_err()),
        "cloud.device_name_invalid"
    );
    assert_eq!(
        code(&cloud_set_device_name("   ".into()).unwrap_err()),
        "cloud.device_name_empty"
    );

    harness.connect().await;
    cloud_set_device_name("Desk Mac".into()).unwrap();
    cloud_set_enabled(false).unwrap();
    let off = state().await;
    assert_eq!(off["enabled"], false);
    assert_eq!(off["deviceName"], "Desk Mac");
    assert_eq!(
        code(&cloud_sync_now(None).await.err().unwrap()),
        "cloud.disabled"
    );
    assert_eq!(
        code(&cloud_settings_sync(json!({})).await.err().unwrap()),
        "cloud.disabled"
    );
    cloud_set_enabled(true).unwrap();
    assert_eq!(state().await["enabled"], true);

    harness.fake.with(|dropbox| {
        dropbox.fault("auth/token/revoke", None, Reply::Status(500), 1);
    });
    cloud_disconnect().await.unwrap();
    assert_eq!(
        harness
            .fake
            .with(|dropbox| dropbox.calls("auth/token/revoke")),
        1
    );
    let gone = state().await;
    assert_eq!(gone["status"], "disconnected");
    assert_eq!(gone["lastEmail"], EMAIL);
    assert_eq!(gone["deviceName"], "Desk Mac");
    assert!(crate::secrets::get_cloud_secret(
        "cloud/dropbox/refresh",
        crate::secrets::SecretBackend::File
    )
    .unwrap()
    .is_none());
    cloud_disconnect().await.unwrap();
    assert_eq!(
        code(&cloud_details().await.err().unwrap()),
        "cloud.not_connected"
    );
}

#[tokio::test]
async fn settings_push_apply_choose_and_keep_local() {
    let harness = Harness::new().await;
    harness.connect().await;
    assert_eq!(
        view(cloud_settings_download().await.unwrap()),
        json!({"values": null, "stamp": "0"})
    );

    let mine = json!({"appearance": {"theme": "dark"}, "experimentation": {"webBrowser": true}});
    let dark = json!({"appearance": {"theme": "dark"}});
    assert_eq!(
        view(cloud_settings_sync(mine.clone()).await.unwrap()),
        json!({"outcome": "pushed"})
    );
    let stored: Value = serde_json::from_str(&harness.remote(SETTINGS_REMOTE).unwrap()).unwrap();
    assert_eq!(stored["values"], dark);
    assert_eq!(
        view(cloud_settings_sync(mine.clone()).await.unwrap()),
        json!({"outcome": "current"})
    );

    let light = json!({"appearance": {"theme": "light"}});
    write_settings(
        &harness.fake,
        &json!({"stamp": fresh_stamp(), "device": "Laptop", "values": light}),
    );
    let apply = view(cloud_settings_sync(mine.clone()).await.unwrap());
    assert_eq!(apply["outcome"], "apply");
    assert_eq!(apply["values"], light);
    let stamp = text(&apply["stamp"]);
    cloud_settings_applied("1".into(), light.clone()).unwrap();
    let offered = crate::cloud::state::snapshot().unwrap().settings;
    assert_eq!(offered.offered, Some(stamp.parse().unwrap()));
    assert_ne!(offered.stamp, stamp.parse::<u64>().unwrap());
    assert_eq!(
        code(&cloud_settings_applied("soon".into(), light.clone()).unwrap_err()),
        "cloud.server"
    );
    cloud_settings_applied(stamp.clone(), light.clone()).unwrap();
    assert_eq!(
        view(cloud_settings_sync(light.clone()).await.unwrap()),
        json!({"outcome": "current"})
    );
    assert_eq!(
        view(cloud_settings_download().await.unwrap()),
        json!({"values": light, "stamp": stamp})
    );

    let sepia = json!({"appearance": {"theme": "sepia"}});
    harness.fake.with(|dropbox| {
        dropbox.fault(
            "files/upload",
            Some("settings.json"),
            Reply::Refuse("path/conflict/file/.."),
            1,
        );
    });
    assert_eq!(
        view(cloud_settings_sync(sepia.clone()).await.unwrap()),
        json!({"outcome": "pushed"})
    );

    harness.fake.with(|dropbox| {
        dropbox.fault(
            "files/upload",
            Some("settings.json"),
            Reply::Refuse("path/conflict/file/.."),
            1,
        );
    });
    cloud_settings_keep_local(mine.clone()).await.unwrap();
    let kept: Value = serde_json::from_str(&harness.remote(SETTINGS_REMOTE).unwrap()).unwrap();
    assert_eq!(kept["values"], dark);

    cloud_disconnect().await.unwrap();
    assert_eq!(harness.fake.with(|dropbox| dropbox.revoked.len()), 1);
    harness
        .fake
        .with(|dropbox| dropbox.account_id = "dbid:AAOtherAccount".into());
    harness.connect().await;
    let choose = view(cloud_settings_sync(sepia.clone()).await.unwrap());
    assert_eq!(choose["outcome"], "choose");
    assert_eq!(choose["values"], dark);
    assert_eq!(
        view(cloud_settings_sync(dark.clone()).await.unwrap()),
        json!({"outcome": "current"})
    );

    write_settings(
        &harness.fake,
        &json!({"v": 1, "stamp": fresh_stamp(), "values": [1]}),
    );
    assert_eq!(
        code(&cloud_settings_sync(sepia.clone()).await.err().unwrap()),
        "cloud.remote_unreadable"
    );

    write_settings(
        &harness.fake,
        &json!({"v": 99, "stamp": fresh_stamp(), "values": {}}),
    );
    assert_eq!(
        code(&cloud_settings_sync(sepia.clone()).await.err().unwrap()),
        "cloud.newer_version"
    );
    harness
        .fake
        .with(|dropbox| dropbox.write(SETTINGS_REMOTE, b"not json".to_vec()));
    assert_eq!(
        code(&cloud_settings_download().await.err().unwrap()),
        "cloud.remote_unreadable"
    );
    cloud_settings_keep_local(sepia.clone()).await.unwrap();
    let replaced: Value = serde_json::from_str(&harness.remote(SETTINGS_REMOTE).unwrap()).unwrap();
    assert_eq!(replaced["values"], sepia);
    assert_eq!(
        code(&cloud_settings_sync(json!([1, 2])).await.err().unwrap()),
        "cloud.local_io"
    );
}

#[tokio::test]
async fn a_missing_sign_in_secret_shows_that_access_ended() {
    let harness = Harness::new().await;
    harness.connect().await;
    harness.project("alpha", "Alpha", &[("main.tex", "alpha")]);
    let backend = crate::secrets::cloud_secret_backend().backend;
    let _ = crate::secrets::delete_cloud_secret("cloud/dropbox/refresh", backend);
    harness.fake.with(|dropbox| dropbox.expire_tokens());
    let report = sync().await;
    assert_eq!(code_of(&report["error"]), "cloud.revoked");
    assert_eq!(state().await["status"], "revoked");
}

#[tokio::test]
async fn a_round_never_refreshes_into_another_account() {
    let harness = Harness::new().await;
    harness.connect().await;
    let refresh = crate::cloud::commands::refresher("dbid:someone-else");
    let error = refresh().await.unwrap_err();
    assert!(matches!(error, StoreError::Network(_)));
    assert_eq!(state().await["status"], "connected");
    drop(harness);
}

#[tokio::test]
async fn projects_only_in_dropbox_can_be_removed_from_dropbox() {
    let harness = Harness::new().await;
    harness.connect().await;
    let laptop = seed_remote(&harness.fake, "From the laptop", "laptop text");
    let before = view(cloud_details().await.unwrap());
    assert_eq!(before["remote"].as_array().unwrap().len(), 1);
    let id = laptop.to_string();
    harness.fake.with(|dropbox| {
        dropbox.fault(
            "files/delete_v2",
            Some(&id),
            Reply::Refuse("too_many_files/.."),
            1,
        );
    });
    cloud_remove_remote(id).await.unwrap();
    assert!(harness.remote(&version_remote(laptop)).is_none());
    assert!(harness.remote(&tombstone_remote(laptop)).is_some());
    assert_eq!(view(cloud_details().await.unwrap())["remote"], json!([]));
    harness.project("alpha", "Alpha", &[("main.tex", "alpha")]);
    sync().await;
    assert_eq!(
        code(
            &cloud_remove_remote(cloud_of("alpha").to_string())
                .await
                .unwrap_err()
        ),
        "cloud.server"
    );
    assert_eq!(
        code(&cloud_remove_remote("nope".into()).await.unwrap_err()),
        "cloud.not_found"
    );
}

#[tokio::test]
async fn details_reuse_what_they_read_until_a_project_changes() {
    let harness = Harness::new().await;
    harness.connect().await;
    let laptop = seed_remote(&harness.fake, "From the laptop", "laptop text");
    let first = view(cloud_details().await.unwrap());
    assert_eq!(first["remote"][0]["name"], "From the laptop");
    harness.fake.with(|dropbox| dropbox.clear_calls());
    let again = view(cloud_details().await.unwrap());
    assert_eq!(again["remote"][0]["name"], "From the laptop");
    assert_eq!(
        harness.fake.with(|dropbox| dropbox.calls("files/download")),
        0
    );
    harness.fake.with(|dropbox| {
        let mut version: Value =
            serde_json::from_slice(&dropbox.read(&version_remote(laptop)).unwrap()).unwrap();
        version["name"] = json!("Renamed on the laptop");
        dropbox.write(
            &version_remote(laptop),
            serde_json::to_vec(&version).unwrap(),
        );
    });
    let renamed = view(cloud_details().await.unwrap());
    assert_eq!(renamed["remote"][0]["name"], "Renamed on the laptop");
}

#[tokio::test]
async fn quiet_rounds_still_mark_projects_as_checked() {
    let harness = Harness::new().await;
    harness.connect().await;
    harness.project("alpha", "Alpha", &[("main.tex", "alpha")]);
    sync().await;
    crate::cloud::state::update(|state| {
        state.projects.get_mut("alpha").unwrap().last_synced_ms = 1;
    })
    .unwrap();
    assert_eq!(sync().await["projects"], json!([]));
    assert!(entry("alpha").last_synced_ms > 1);
    drop(harness);
}

#[tokio::test]
async fn a_postponed_settings_choice_stays_postponed() {
    let harness = Harness::new().await;
    harness.connect().await;
    write_settings(
        &harness.fake,
        &json!({"v": 1, "stamp": fresh_stamp(), "device": "Laptop", "values": {"appearance": {"theme": "dark"}}}),
    );
    let mine = json!({"appearance": {"theme": "light"}});
    let choose = view(cloud_settings_sync(mine.clone()).await.unwrap());
    assert_eq!(choose["outcome"], "choose");
    assert_eq!(choose["deferred"], false);
    cloud_settings_defer(text(&choose["stamp"])).unwrap();
    let later = view(cloud_settings_sync(mine.clone()).await.unwrap());
    assert_eq!(later["outcome"], "choose");
    assert_eq!(later["deferred"], true);
    assert!(cloud_settings_defer("later".into()).is_err());
    cloud_settings_keep_local(mine.clone()).await.unwrap();
    assert_eq!(
        view(cloud_settings_sync(mine).await.unwrap()),
        json!({"outcome": "current"})
    );
}

#[tokio::test]
async fn reports_name_changed_files_and_conflict_copies_wait_to_be_dismissed() {
    let harness = Harness::new().await;
    harness.connect().await;
    let alpha = harness.project("alpha", "Alpha", &[("main.tex", "alpha v1")]);
    sync().await;
    let alpha_cloud = cloud_of("alpha");
    edit_remote(&harness.fake, alpha_cloud, "main.tex", "from the laptop");
    let pulled = sync().await;
    assert_eq!(report_for(&pulled, "alpha")["changed"], json!(["main.tex"]));
    assert_eq!(report_for(&pulled, "alpha")["changedTruncated"], false);

    write(&alpha, "main.tex", "edited here");
    edit_remote(&harness.fake, alpha_cloud, "main.tex", "edited there");
    let conflicted = sync().await;
    assert_eq!(report_for(&conflicted, "alpha")["conflicts"], 1);
    let copies = listed(&state().await, "alpha")["conflictCopies"].clone();
    assert_eq!(copies.as_array().unwrap().len(), 1);
    sync().await;
    assert_eq!(listed(&state().await, "alpha")["conflictCopies"], copies);
    cloud_project_dismiss_conflicts("alpha".into()).unwrap();
    let dismissed = state().await;
    assert_eq!(listed(&dismissed, "alpha")["conflictCopies"], json!([]));
    assert_eq!(listed(&dismissed, "alpha")["conflicts"], 0);

    harness
        .fake
        .with(|dropbox| dropbox.write(&version_remote(alpha_cloud), b"not json".to_vec()));
    write(&alpha, "main.tex", "after the damage");
    let broken = sync().await;
    assert_eq!(
        code_of(&report_for(&broken, "alpha")["error"]),
        "cloud.remote_unreadable"
    );
    let replaced = view(
        cloud_project_replace_remote("alpha".into(), None)
            .await
            .unwrap(),
    );
    assert_eq!(replaced["error"], Value::Null);
    let version: Value =
        serde_json::from_str(&harness.remote(&version_remote(alpha_cloud)).unwrap()).unwrap();
    assert!(version["files"]
        .as_array()
        .unwrap()
        .iter()
        .any(|file| file["path"] == "main.tex"));
    assert_eq!(
        code(&cloud_project_remove("ghost".into()).await.unwrap_err()),
        "cloud.not_found"
    );
    assert_eq!(
        code(
            &cloud_project_replace_remote("ghost".into(), None)
                .await
                .err()
                .unwrap()
        ),
        "cloud.not_found"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn an_unreadable_file_never_blocks_the_first_sync() {
    use std::os::unix::fs::PermissionsExt as _;
    let harness = Harness::new().await;
    harness.connect().await;
    let root = harness.project(
        "alpha",
        "Alpha",
        &[("main.tex", "alpha"), ("secret.tex", "locked")],
    );
    let secret = root.join("secret.tex");
    std::fs::set_permissions(&secret, std::fs::Permissions::from_mode(0o000)).unwrap();
    let readable = std::fs::read(&secret).is_ok();
    let first = sync().await;
    std::fs::set_permissions(&secret, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(report_for(&first, "alpha")["error"], Value::Null);
    if !readable {
        assert_eq!(report_for(&first, "alpha")["uploaded"], 2);
        assert_eq!(
            listed(&state().await, "alpha")["skippedFiles"],
            json!([{"path": "secret.tex", "reason": "unreadable"}])
        );
    }
}

#[tokio::test]
async fn waiting_for_changes_follows_the_change_cursor_and_what_dropbox_asks() {
    let harness = Harness::new().await;
    harness.connect().await;
    assert_eq!(
        view(cloud_wait_for_changes().await.unwrap()),
        json!({"changes": false, "retryAfterMs": 60000})
    );
    harness.project("alpha", "Alpha", &[("main.tex", "alpha v1")]);
    sync().await;
    sync().await;
    assert_eq!(
        view(cloud_wait_for_changes().await.unwrap()),
        json!({"changes": false, "retryAfterMs": null})
    );
    edit_remote(
        &harness.fake,
        cloud_of("alpha"),
        "main.tex",
        "from the laptop",
    );
    assert_eq!(
        view(cloud_wait_for_changes().await.unwrap())["changes"],
        true
    );
    harness.fake.with(|dropbox| dropbox.reset_cursors());
    assert_eq!(
        view(cloud_wait_for_changes().await.unwrap()),
        json!({"changes": true, "retryAfterMs": null})
    );
    harness.fake.with(|dropbox| {
        dropbox.fault(
            "files/list_folder/longpoll",
            None,
            Reply::Json(json!({"changes": false, "backoff": 30})),
            1,
        );
        dropbox.fault("files/list_folder/longpoll", None, Reply::Status(429), 1);
    });
    assert_eq!(
        view(cloud_wait_for_changes().await.unwrap()),
        json!({"changes": false, "retryAfterMs": 30000})
    );
    assert_eq!(
        code(&cloud_wait_for_changes().await.err().unwrap()),
        "cloud.rate_limited"
    );
    assert_eq!(
        harness
            .fake
            .with(|dropbox| dropbox.calls("files/list_folder/longpoll")),
        5
    );
    cloud_set_enabled(false).unwrap();
    assert_eq!(
        code(&cloud_wait_for_changes().await.err().unwrap()),
        "cloud.disabled"
    );
}
