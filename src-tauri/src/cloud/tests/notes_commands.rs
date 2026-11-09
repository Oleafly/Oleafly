#![allow(clippy::await_holding_lock)]

use crate::cloud::commands::{
    cloud_connect_begin, cloud_connect_paste, cloud_download_project, cloud_remove_remote,
    cloud_set_device_name, cloud_state, cloud_sync_now,
};
use crate::cloud::engine::{tombstone_remote, version_remote};
use crate::cloud::tests::fake_dropbox::{point_at, FakeDropbox, Pointed};
use crate::note_links::LinkKind;
use crate::project::ProjectInfo;
use oleafly_core::ids::ProjectId;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::MutexGuard;
use tauri::Manager as _;

const MASKING: &str = "6f1c2b7e-3d4a-4e5f-9a8b-0c1d2e3f4a5b";
const ENCODER: &str = "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";
const FIGURE: &[u8] =
    b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\x06\0\0\0\x1f\xff\xfe";

struct Computers {
    fake: FakeDropbox,
    desk: tempfile::TempDir,
    laptop: tempfile::TempDir,
    _pointed: Pointed,
    _env: MutexGuard<'static, ()>,
}

impl Computers {
    async fn new() -> Self {
        let env = crate::paths::data_dir_env_lock();
        let fake = FakeDropbox::start().await;
        let pointed = point_at(fake.endpoints());
        let computers = Self {
            fake,
            desk: tempfile::tempdir().unwrap(),
            laptop: tempfile::tempdir().unwrap(),
            _pointed: pointed,
            _env: env,
        };
        for (dir, name) in [
            (computers.laptop.path(), "Laptop"),
            (computers.desk.path(), "Desk"),
        ] {
            std::env::set_var("OLEAFLY_DATA_DIR", dir);
            let begin = view(cloud_connect_begin(None, true).await.unwrap());
            assert_eq!(begin["paste"], true);
            let flow = begin["flowId"].as_str().unwrap().to_string();
            cloud_connect_paste(flow, format!("code-{name}"))
                .await
                .unwrap();
            cloud_set_device_name(name.into()).unwrap();
        }
        computers
    }

    fn on_desk(&self) {
        std::env::set_var("OLEAFLY_DATA_DIR", self.desk.path());
    }

    fn on_laptop(&self) {
        std::env::set_var("OLEAFLY_DATA_DIR", self.laptop.path());
    }

    fn remote_files(&self, cloud: ProjectId) -> Vec<String> {
        let bytes = self
            .fake
            .with(|dropbox| dropbox.read(&version_remote(cloud)))
            .unwrap();
        let version: Value = serde_json::from_slice(&bytes).unwrap();
        version["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|file| file["path"].as_str().unwrap().to_string())
            .collect()
    }

    fn remote_exists(&self, path: &str) -> bool {
        self.fake.with(|dropbox| dropbox.read(path)).is_some()
    }
}

impl Drop for Computers {
    fn drop(&mut self) {
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}

fn view<T: serde::Serialize>(value: T) -> Value {
    serde_json::to_value(value).unwrap()
}

fn local_id(done: Value) -> String {
    done["localId"].as_str().unwrap().to_string()
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

fn row_for(state: &Value, local_id: &str) -> Value {
    state["projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|project| project["localId"] == local_id)
        .cloned()
        .unwrap_or(Value::Null)
}

async fn sync() -> Value {
    let report = view(cloud_sync_now(None).await.unwrap());
    assert_eq!(report["error"], Value::Null, "{report}");
    report
}

fn cloud_of(local_id: &str) -> ProjectId {
    crate::cloud::state::snapshot().unwrap().projects[local_id]
        .cloud
        .unwrap()
}

fn library() -> Vec<ProjectInfo> {
    crate::project::list_projects_blocking().unwrap()
}

fn listed<'a>(projects: &'a [ProjectInfo], id: &str) -> &'a ProjectInfo {
    projects
        .iter()
        .find(|project| project.id == id)
        .unwrap_or_else(|| panic!("{id} is not in the library"))
}

fn root_of(local_id: &str) -> std::path::PathBuf {
    crate::paths::project_dir(local_id).unwrap()
}

fn write(root: &Path, path: &str, content: &str) {
    let target = root.join(path);
    std::fs::create_dir_all(target.parent().unwrap()).unwrap();
    std::fs::write(target, content).unwrap();
}

fn note_source(id: &str, title: &str, body: &str) -> String {
    format!("---\ntitle: {title}\nkind: note\nid: {id}\nicon: 🧪\ncolor: spring\ntags: [ml, vision]\nstatus: draft\n---\n\n{body}")
}

fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(crate::state::AppState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap()
}

#[tokio::test]
async fn notes_made_on_one_computer_open_as_notes_on_another_and_leave_when_removed() {
    let computers = Computers::new().await;
    let app = mock_app();

    computers.on_desk();
    let paper = "swift-teal-otter";
    let paper_root = crate::paths::create_project_dir(paper).unwrap();
    write(
        &paper_root,
        "project.json",
        &json!({"name": "Thesis", "main_doc": "main.tex"}).to_string(),
    );
    write(&paper_root, "main.tex", "\\section{Masking}");
    let masking = crate::project::create_note_project_from(
        "Masking strategy".into(),
        note_source(
            MASKING,
            "Masking strategy",
            &format!("See [Encoder study](oleafly://note/{ENCODER}).\n"),
        ),
        Some(paper.into()),
    )
    .unwrap();
    let encoder = crate::project::create_note_project_from(
        "Encoder study".into(),
        note_source(
            ENCODER,
            "Encoder study",
            &format!("Builds on [Masking strategy](oleafly://note/{MASKING}).\n"),
        ),
        None,
    )
    .unwrap();
    let picked = computers.desk.path().join("Loss curve.png");
    std::fs::write(&picked, FIGURE).unwrap();
    let asset = crate::project::import_file_into_note(&masking, &picked).unwrap();
    let origin = crate::project::note_origin_path(&asset.path);
    let desk_masking = root_of(&masking);
    let desk_encoder = root_of(&encoder);

    let first = sync().await;
    assert_eq!(report_for(&first, &masking)["error"], Value::Null);
    let masking_cloud = cloud_of(&masking);
    let encoder_cloud = cloud_of(&encoder);
    let paper_cloud = cloud_of(paper);
    let sent = computers.remote_files(masking_cloud);
    for path in [
        "project.json",
        "note.md",
        asset.path.as_str(),
        origin.as_str(),
    ] {
        assert!(sent.iter().any(|file| file == path), "{path} in {sent:?}");
    }
    assert!(!sent.iter().any(|file| file.starts_with(".git")));

    computers.on_laptop();
    let unrelated = crate::paths::create_project_dir(paper).unwrap();
    write(
        &unrelated,
        "project.json",
        &json!({"name": "Grant budget", "main_doc": "main.tex"}).to_string(),
    );
    write(&unrelated, "main.tex", "\\section{Budget}");
    let laptop_masking = local_id(view(
        cloud_download_project(masking_cloud.to_string(), app.state())
            .await
            .unwrap(),
    ));
    let laptop_encoder = local_id(view(
        cloud_download_project(encoder_cloud.to_string(), app.state())
            .await
            .unwrap(),
    ));
    let laptop_paper = local_id(view(
        cloud_download_project(paper_cloud.to_string(), app.state())
            .await
            .unwrap(),
    ));
    let laptop_root = root_of(&laptop_masking);
    assert_eq!(
        std::fs::read(laptop_root.join(&asset.path)).unwrap(),
        FIGURE
    );
    assert_eq!(
        std::fs::read(laptop_root.join(&origin)).unwrap(),
        std::fs::read(desk_masking.join(&origin)).unwrap()
    );
    assert_eq!(
        std::fs::read(laptop_root.join("note.md")).unwrap(),
        std::fs::read(desk_masking.join("note.md")).unwrap()
    );

    let projects = library();
    let note = listed(&projects, &laptop_masking);
    assert_eq!(note.kind, "note");
    assert_eq!(note.name, "Masking strategy");
    assert_eq!(note.main_doc, "note.md");
    assert_eq!(note.related_project, None);
    assert_eq!(listed(&projects, &laptop_encoder).kind, "note");
    assert_eq!(listed(&projects, &laptop_paper).kind, "document");
    let links = crate::note_links::note_links_blocking().unwrap();
    let id_of = |project: &str| {
        links
            .iter()
            .find(|note| note.project_id == project)
            .and_then(|note| note.note_id.clone())
    };
    assert_eq!(id_of(&laptop_masking).as_deref(), Some(MASKING));
    assert_eq!(id_of(&laptop_encoder).as_deref(), Some(ENCODER));
    let masking_links = &links
        .iter()
        .find(|note| note.project_id == laptop_masking)
        .unwrap()
        .links;
    assert!(masking_links
        .iter()
        .any(|link| link.kind == LinkKind::Note && link.id == ENCODER));

    crate::project::set_note_related_project_blocking(&laptop_masking, Some(laptop_paper.clone()))
        .unwrap();
    let mut text = std::fs::read_to_string(laptop_root.join("note.md")).unwrap();
    text.push_str("\nRun 4 reached 65.0%.\n");
    std::fs::write(laptop_root.join("note.md"), &text).unwrap();
    let pushed = sync().await;
    assert_eq!(report_for(&pushed, &laptop_masking)["uploaded"], 1);
    assert_eq!(
        library()
            .iter()
            .find(|project| project.id == laptop_masking)
            .and_then(|project| project.related_project.clone()),
        Some(laptop_paper.clone())
    );

    computers.on_desk();
    let pulled = sync().await;
    assert_eq!(report_for(&pulled, &masking)["downloaded"], 1);
    assert_eq!(
        std::fs::read_to_string(desk_masking.join("note.md")).unwrap(),
        text
    );
    assert_eq!(
        listed(&library(), &masking).related_project.as_deref(),
        Some(paper)
    );

    crate::project::recycle_project_synchronized(
        app.state::<crate::state::AppState>().inner(),
        encoder.clone(),
    )
    .await
    .unwrap();
    assert!(!desk_encoder.exists());
    let after = sync().await;
    assert_eq!(report_for(&after, &encoder), Value::Null);
    assert!(computers.remote_exists(&version_remote(encoder_cloud)));
    cloud_remove_remote(encoder_cloud.to_string())
        .await
        .unwrap();
    assert!(!computers.remote_exists(&version_remote(encoder_cloud)));
    assert!(computers.remote_exists(&tombstone_remote(encoder_cloud)));

    computers.on_laptop();
    sync().await;
    let state = view(cloud_state().await.unwrap());
    let row = row_for(&state, &laptop_encoder);
    assert_eq!(row["mode"], "removed", "{row}");
    assert_eq!(row["removedBy"], "Desk");
    let laptop_encoder_root = root_of(&laptop_encoder);
    assert!(laptop_encoder_root.join("note.md").is_file());
    assert!(laptop_encoder_root.join("project.json").is_file());
    assert_eq!(listed(&library(), &laptop_encoder).kind, "note");
    assert_eq!(row_for(&state, &laptop_masking)["mode"], "sync");
}
