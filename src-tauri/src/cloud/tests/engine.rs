use crate::cloud::engine::{
    capture_with, download_into, list_remote_projects, local_date, now_ms, sanitize_label,
    sync_project, tombstone_remote, version_remote, FileRecord, RoundEnv, RoundError, RoundOptions,
    RoundResult, SyncContext, Tombstone, VersionManifest,
};
use crate::cloud::settings::{self, SettingsOutcome, SettingsRound};
use crate::cloud::state::{BaseEntry, Failure, Hold, PendingDelete, ProjectState, SettingsState};
use crate::cloud::store::{CloudStore, StoreError, WriteMode};
use crate::cloud::tests::memory::MemoryStore;
use oleafly_core::hlc::{Hlc, Stamp};
use oleafly_core::ids::{DeviceId, ProjectId};
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

type SavedBase = std::sync::Arc<std::sync::Mutex<Vec<(String, Option<BaseEntry>)>>>;

struct Device {
    name: String,
    id: DeviceId,
    dir: tempfile::TempDir,
    project: ProjectState,
    hlc: u64,
    saved: SavedBase,
}

impl Device {
    fn new(name: &str) -> Self {
        let device = Self {
            name: name.into(),
            id: DeviceId::new(),
            dir: tempfile::tempdir().unwrap(),
            project: ProjectState::default(),
            hlc: 0,
            saved: std::sync::Arc::default(),
        };
        std::fs::create_dir_all(device.root()).unwrap();
        device
    }

    fn root(&self) -> PathBuf {
        self.dir.path().join("project")
    }

    fn env(&self) -> RoundEnv {
        RoundEnv {
            root: self.root(),
            staging: self.dir.path().join("staging"),
            trash: self.dir.path().join("trash"),
            lock_id: None,
            persist_pending: None,
            persist_base: Some({
                let saved = std::sync::Arc::clone(&self.saved);
                std::sync::Arc::new(move |changes: &[(String, Option<BaseEntry>)]| {
                    saved.lock().unwrap().extend(changes.iter().cloned());
                })
            }),
        }
    }

    fn context(&self) -> SyncContext {
        SyncContext {
            device: self.id,
            device_name: self.name.clone(),
            fallback_name: "Project".into(),
        }
    }

    fn write(&self, path: &str, content: &str) {
        let target = self.root().join(path);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(target, content).unwrap();
    }

    fn read(&self, path: &str) -> Option<String> {
        std::fs::read_to_string(self.root().join(path)).ok()
    }

    fn remove(&self, path: &str) {
        std::fs::remove_file(self.root().join(path)).unwrap();
    }

    fn names(&self) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(self.root())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    async fn sync<S: CloudStore>(&mut self, store: &S, cloud: ProjectId) -> RoundResult {
        self.sync_with(
            store,
            cloud,
            RoundOptions {
                allow_uploads: true,
                ..RoundOptions::default()
            },
        )
        .await
    }

    async fn sync_with<S: CloudStore>(
        &mut self,
        store: &S,
        cloud: ProjectId,
        options: RoundOptions,
    ) -> RoundResult {
        self.try_sync(store, cloud, options).await.unwrap()
    }

    async fn try_sync<S: CloudStore>(
        &mut self,
        store: &S,
        cloud: ProjectId,
        options: RoundOptions,
    ) -> Result<RoundResult, RoundError> {
        let result = sync_project(
            store,
            &self.env(),
            &self.context(),
            cloud,
            &self.project,
            self.hlc,
            &options,
        )
        .await?;
        self.project = result.project.clone();
        self.hlc = result.hlc;
        Ok(result)
    }

    async fn download<S: CloudStore>(&mut self, store: &S, cloud: ProjectId) {
        let downloaded =
            download_into(store, cloud, &self.root(), &self.dir.path().join("staging"))
                .await
                .unwrap()
                .unwrap();
        self.project = ProjectState {
            cloud: Some(cloud),
            base: downloaded.base,
            remote_rev: (!downloaded.stale).then_some(downloaded.rev),
            remote_dirty: downloaded.stale,
            ..ProjectState::default()
        };
    }
}

fn thesis(device: &Device) {
    device.write(
        "project.json",
        r#"{"name":"Thesis","main_doc":"main.tex","engine":"latexmk"}"#,
    );
    device.write("main.tex", "one");
    device.write("main.aux", "build output");
}

fn today() -> String {
    local_date()
}

#[cfg(unix)]
#[test]
fn conflict_copies_carry_the_date_on_this_computer() {
    let shell_date = || {
        let output = std::process::Command::new("date")
            .arg("+%Y-%m-%d")
            .output()
            .unwrap();
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    };
    let before = shell_date();
    let ours = local_date();
    let after = shell_date();
    assert!(
        ours == before || ours == after,
        "{ours} vs {before}/{after}"
    );
}

fn file_remote(cloud: ProjectId, path: &str) -> String {
    format!("/projects/{cloud}/files/{path}")
}

fn remote_version(store: &MemoryStore, cloud: ProjectId) -> VersionManifest {
    serde_json::from_slice(&store.read(&version_remote(cloud)).unwrap()).unwrap()
}

async fn paired() -> (MemoryStore, ProjectId, Device, Device) {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    let mut laptop = Device::new("Laptop");
    thesis(&desk);
    desk.sync(&store, cloud).await;
    laptop.download(&store, cloud).await;
    (store, cloud, desk, laptop)
}

#[tokio::test]
async fn two_computers_share_edits_and_deletes_and_build_output_stays_home() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    let mut laptop = Device::new("Laptop");
    thesis(&desk);
    let first = desk.sync(&store, cloud).await;
    assert_eq!(first.outcome.uploaded, 2);
    assert!(store.read(&file_remote(cloud, "main.aux")).is_none());
    assert_eq!(
        remote_version(&store, cloud).device.as_deref(),
        Some("Desk")
    );

    laptop.download(&store, cloud).await;
    assert_eq!(laptop.read("main.tex").as_deref(), Some("one"));
    assert!(laptop.sync(&store, cloud).await.outcome.unchanged);

    laptop.write("main.tex", "two from laptop");
    laptop.write("notes/ideas.md", "new");
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    desk.project.remote_dirty = true;
    let pulled = desk.sync(&store, cloud).await;
    assert_eq!(pulled.outcome.downloaded, 2);
    assert_eq!(desk.read("main.tex").as_deref(), Some("two from laptop"));
    assert_eq!(desk.read("notes/ideas.md").as_deref(), Some("new"));

    desk.remove("notes/ideas.md");
    desk.sync(&store, cloud).await;
    laptop.project.remote_dirty = true;
    let applied = laptop.sync(&store, cloud).await;
    assert_eq!(applied.outcome.deleted_local, 1);
    assert!(laptop.read("notes/ideas.md").is_none());
    assert!(!laptop.root().join("notes").exists());
    assert!(crate::os_trash::test_support::trashed(
        &laptop.root().canonicalize().unwrap().join("notes/ideas.md")
    ));
}

#[tokio::test]
async fn quarto_output_stays_home_and_calepin_results_sync() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    desk.write(
        "project.json",
        r#"{"name":"Report","main_doc":"report.qmd","engine":"quarto"}"#,
    );
    desk.write("report.qmd", "# Report");
    desk.write("report_files/figure-html/plot.png", "figure");
    desk.write(".quarto/xref/index.json", "{}");
    desk.write(".calepin/calepin.typ", "runtime");
    desk.write("data_files/raw.csv", "a,b");
    let first = desk.sync(&store, cloud).await;
    assert_eq!(first.outcome.uploaded, 4);
    for left_out in [
        "report_files/figure-html/plot.png",
        ".quarto/xref/index.json",
    ] {
        assert!(
            store.read(&file_remote(cloud, left_out)).is_none(),
            "{left_out}"
        );
    }
    assert!(store
        .read(&file_remote(cloud, "data_files/raw.csv"))
        .is_some());
    assert!(store
        .read(&file_remote(cloud, ".calepin/calepin.typ"))
        .is_some());
}

#[tokio::test]
async fn concurrent_edits_keep_both_versions_and_name_the_copy_after_its_author() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    desk.write("main.tex", "desk edit");
    laptop.write("main.tex", "laptop edit");
    laptop.sync(&store, cloud).await;
    desk.project.remote_dirty = true;
    let conflicted = desk.sync(&store, cloud).await;
    assert_eq!(conflicted.outcome.conflicts, 1);
    assert_eq!(desk.read("main.tex").as_deref(), Some("desk edit"));
    let copy = format!("main (Laptop {}).tex", today());
    assert_eq!(desk.read(&copy).as_deref(), Some("laptop edit"));

    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    assert_eq!(laptop.read("main.tex").as_deref(), Some("desk edit"));
    assert_eq!(laptop.read(&copy).as_deref(), Some("laptop edit"));

    desk.write("main.tex", "desk again");
    laptop.write("main.tex", "laptop again");
    laptop.sync(&store, cloud).await;
    desk.project.remote_dirty = true;
    desk.sync(&store, cloud).await;
    assert_eq!(desk.read(&copy).as_deref(), Some("laptop edit"));
    assert_eq!(
        desk.read(&format!("main (Laptop {} 2).tex", today()))
            .as_deref(),
        Some("laptop again")
    );
    desk.project.remote_dirty = true;
    assert!(desk.sync(&store, cloud).await.outcome.conflicts == 0);
}

#[tokio::test]
async fn a_missing_remote_record_uploads_again_and_never_deletes_local_files() {
    let (store, cloud, mut desk, _laptop) = paired().await;
    store.remove(&format!("/projects/{cloud}"));
    desk.project.remote_dirty = true;
    let result = desk.sync(&store, cloud).await;
    assert_eq!(result.outcome.deleted_local, 0);
    assert_eq!(result.outcome.uploaded, 2);
    assert_eq!(desk.read("main.tex").as_deref(), Some("one"));
    assert!(desk.read("project.json").is_some());
    assert_eq!(remote_version(&store, cloud).files.len(), 2);
}

#[tokio::test]
async fn a_project_removed_from_dropbox_pauses_here_and_keeps_every_file() {
    let (store, cloud, _desk, mut laptop) = paired().await;
    let tombstone = serde_json::to_vec(&Tombstone {
        device: "Desk".into(),
        at_ms: 1,
    })
    .unwrap();
    store
        .put(&tombstone_remote(cloud), tombstone, WriteMode::Overwrite)
        .await
        .unwrap();
    store.remove(&format!("/projects/{cloud}"));
    laptop.project.remote_dirty = true;
    let result = laptop.sync(&store, cloud).await;
    assert_eq!(result.outcome.removed_by.as_deref(), Some("Desk"));
    assert!(laptop.project.paused);
    assert!(laptop.project.base.is_empty());
    assert_eq!(laptop.read("main.tex").as_deref(), Some("one"));
    assert!(store.read(&version_remote(cloud)).is_none());
}

#[tokio::test]
async fn deleting_most_files_holds_the_project_until_the_person_decides() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    thesis(&desk);
    for index in 0..30 {
        desk.write(
            &format!("sections/part-{index}.tex"),
            &format!("part {index}"),
        );
    }
    desk.sync(&store, cloud).await;
    for index in 0..25 {
        desk.remove(&format!("sections/part-{index}.tex"));
    }
    let held = desk.sync(&store, cloud).await;
    assert!(held.outcome.held);
    assert_eq!(
        desk.project.hold,
        Some(Hold::MassDelete {
            count: 25,
            total: 32
        })
    );
    assert_eq!(remote_version(&store, cloud).files.len(), 32);
    assert!(store
        .read(&file_remote(cloud, "sections/part-0.tex"))
        .is_some());

    let restored = desk
        .sync_with(
            &store,
            cloud,
            RoundOptions {
                restore_deleted: true,
                allow_uploads: true,
                ..RoundOptions::default()
            },
        )
        .await;
    assert_eq!(restored.outcome.downloaded, 25);
    assert_eq!(desk.read("sections/part-3.tex").as_deref(), Some("part 3"));
    assert!(desk.project.hold.is_none());

    for index in 0..25 {
        desk.remove(&format!("sections/part-{index}.tex"));
    }
    assert!(desk.sync(&store, cloud).await.outcome.held);
    let deleted = desk
        .sync_with(
            &store,
            cloud,
            RoundOptions {
                allow_mass_delete: true,
                allow_uploads: true,
                ..RoundOptions::default()
            },
        )
        .await;
    assert_eq!(deleted.outcome.deleted_remote, 25);
    assert_eq!(remote_version(&store, cloud).files.len(), 7);
    assert!(store
        .read(&file_remote(cloud, "sections/part-0.tex"))
        .is_none());
}

#[tokio::test]
async fn an_emptied_project_folder_is_held_even_when_small() {
    let (store, cloud, mut desk, _laptop) = paired().await;
    desk.remove("main.tex");
    desk.remove("project.json");
    let held = desk.sync(&store, cloud).await;
    assert!(held.outcome.held);
    assert_eq!(remote_version(&store, cloud).files.len(), 2);
}

#[tokio::test]
async fn remote_paths_into_git_or_outside_the_project_are_never_written() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let hostile = [
        ".git/hooks/pre-commit",
        "vendor/.git/config",
        "GIT~1/hooks/pre-commit",
        ".oleafly/build/main.aux",
        "../escape.tex",
        "a/../../escape.tex",
        "C:evil.dll",
        "CON.tex",
        "/abs.tex",
    ];
    let mut files = Vec::new();
    for path in hostile.iter().chain(std::iter::once(&"ok.tex")) {
        let bytes = format!("payload {path}");
        store.overwrite(&file_remote(cloud, path), bytes.as_bytes());
        files.push(serde_json::json!({
            "path": path,
            "hash": oleafly_core::content::ContentHash::digest(bytes.as_bytes()).to_hex(),
            "size": bytes.len(),
            "exec": true,
        }));
    }
    let version = serde_json::json!({
        "v": 1,
        "project": cloud,
        "name": "Planted",
        "stamp": Stamp::new(Hlc::from_raw(1 << 16), DeviceId::new()),
        "files": files,
    });
    store.overwrite(
        &version_remote(cloud),
        &serde_json::to_vec(&version).unwrap(),
    );
    let mut laptop = Device::new("Laptop");
    laptop.write("project.json", r#"{"name":"Mine","main_doc":"main.tex"}"#);
    laptop.project.base.clear();
    let result = laptop.sync(&store, cloud).await;
    assert_eq!(laptop.read("ok.tex").as_deref(), Some("payload ok.tex"));
    assert!(!laptop.root().join(".git").exists());
    assert!(!laptop.root().join("vendor").exists());
    assert!(!laptop.root().join("GIT~1").exists());
    assert!(!laptop.root().join(".oleafly").exists());
    assert!(!laptop.dir.path().join("escape.tex").exists());
    assert!(result.error.is_none());
    let published = remote_version(&store, cloud);
    for path in hostile {
        assert!(
            published.files.iter().any(|file| file.path == path),
            "{path}"
        );
    }
}

#[tokio::test]
async fn a_case_only_rename_never_deletes_the_file_anywhere() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    desk.write("figure.png", "pixels");
    desk.sync(&store, cloud).await;
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    std::fs::rename(desk.root().join("figure.png"), desk.root().join("tmp.png")).unwrap();
    std::fs::rename(desk.root().join("tmp.png"), desk.root().join("Figure.png")).unwrap();
    let renamed = desk.sync(&store, cloud).await;
    assert_eq!(renamed.outcome.deleted_remote, 0);
    assert!(store.read(&file_remote(cloud, "figure.png")).is_some());
    laptop.project.remote_dirty = true;
    let other = laptop.sync(&store, cloud).await;
    assert_eq!(other.outcome.deleted_local, 0);
    assert!(laptop
        .names()
        .iter()
        .any(|name| name.eq_ignore_ascii_case("figure.png")));
}

#[tokio::test]
async fn a_file_that_does_not_match_its_record_is_left_alone() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    desk.write("main.tex", "desk edit");
    desk.sync(&store, cloud).await;
    let mut version = remote_version(&store, cloud);
    for file in &mut version.files {
        if file.path == "main.tex" {
            file.hash = oleafly_core::content::ContentHash::digest(b"something else").to_hex();
            assert!(file.rev.is_some());
        }
    }
    store.overwrite(
        &version_remote(cloud),
        &serde_json::to_vec(&version).unwrap(),
    );
    laptop.project.remote_dirty = true;
    let result = laptop.sync(&store, cloud).await;
    assert_eq!(laptop.read("main.tex").as_deref(), Some("one"));
    assert!(result.outcome.skipped >= 1);
    assert!(laptop.project.remote_dirty);
}

#[tokio::test]
async fn unsaved_editor_buffers_are_never_overwritten() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    desk.write("main.tex", "desk edit");
    desk.sync(&store, cloud).await;
    laptop.project.remote_dirty = true;
    let deferred = laptop
        .sync_with(
            &store,
            cloud,
            RoundOptions {
                allow_uploads: true,
                dirty: ["main.tex".to_string()].into_iter().collect(),
                ..RoundOptions::default()
            },
        )
        .await;
    assert_eq!(deferred.outcome.downloaded, 0);
    assert_eq!(laptop.read("main.tex").as_deref(), Some("one"));
    assert!(laptop.project.remote_dirty);
    laptop.sync(&store, cloud).await;
    assert_eq!(laptop.read("main.tex").as_deref(), Some("desk edit"));
}

#[tokio::test]
async fn project_settings_merge_by_field_and_device_fields_stay_home() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    desk.write(
        "project.json",
        r#"{"name":"Thesis","main_doc":"main.tex","engine":"latexmk","exports":[{"date":1,"filename":"x.pdf","path":"/Users/desk/x.pdf"}]}"#,
    );
    assert!(desk.sync(&store, cloud).await.outcome.unchanged);

    desk.write(
        "project.json",
        r##"{"name":"Thesis","main_doc":"main.tex","engine":"latexmk","color":"#ff0000","exports":[{"date":1,"filename":"x.pdf","path":"/Users/desk/x.pdf"}]}"##,
    );
    laptop.write(
        "project.json",
        r#"{"name":"Thesis 2","main_doc":"main.tex","engine":"latexmk","hidden":false}"#,
    );
    laptop.sync(&store, cloud).await;
    desk.project.remote_dirty = true;
    let merged = desk.sync(&store, cloud).await;
    assert_eq!(merged.outcome.conflicts, 0);
    let desk_meta: serde_json::Value =
        serde_json::from_str(&desk.read("project.json").unwrap()).unwrap();
    assert_eq!(desk_meta["name"], "Thesis 2");
    assert_eq!(desk_meta["color"], "#ff0000");
    assert_eq!(desk_meta["exports"][0]["path"], "/Users/desk/x.pdf");
    assert!(!desk
        .names()
        .iter()
        .any(|name| name.starts_with("project (")));

    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    let laptop_meta: serde_json::Value =
        serde_json::from_str(&laptop.read("project.json").unwrap()).unwrap();
    assert_eq!(laptop_meta["color"], "#ff0000");
    assert!(laptop_meta.get("exports").is_none());
}

#[tokio::test]
async fn a_full_dropbox_keeps_local_changes_and_still_brings_others_in() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    laptop.write("notes.md", "from laptop");
    laptop.sync(&store, cloud).await;
    store.with(|inner| inner.quota = Some(0));
    desk.write("main.tex", "a much longer desk edit that needs space");
    desk.project.remote_dirty = true;
    let full = desk.sync(&store, cloud).await;
    assert!(full.outcome.quota_hit);
    assert_eq!(desk.read("notes.md").as_deref(), Some("from laptop"));
    assert_eq!(
        desk.read("main.tex").as_deref(),
        Some("a much longer desk edit that needs space")
    );
    assert!(remote_version(&store, cloud)
        .files
        .iter()
        .any(|file| file.path == "main.tex" && file.size == 3));
    store.with(|inner| inner.quota = None);
    let later = desk.sync(&store, cloud).await;
    assert_eq!(later.outcome.uploaded, 1);
}

#[tokio::test]
async fn a_quiet_project_costs_no_requests_and_a_changed_flag_costs_one() {
    let (store, cloud, mut desk, _laptop) = paired().await;
    desk.project.remote_dirty = false;
    store.with(|inner| inner.calls = 0);
    assert!(desk.sync(&store, cloud).await.outcome.unchanged);
    assert_eq!(store.with(|inner| inner.calls), 0);
    desk.project.remote_dirty = true;
    assert!(desk.sync(&store, cloud).await.outcome.unchanged);
    assert_eq!(store.with(|inner| inner.calls), 1);
    assert!(!desk.project.remote_dirty);
}

#[tokio::test]
async fn a_racing_writer_fails_the_commit_and_the_retry_loses_nothing() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    desk.write("main.tex", "desk edit");
    store.with(|inner| inner.race_next_version = true);
    let raced = desk.sync(&store, cloud).await;
    assert_eq!(raced.error, Some(RoundError::Store(StoreError::Conflict)));
    assert!(desk.project.remote_dirty);
    let retried = desk.sync(&store, cloud).await;
    assert!(retried.error.is_none());
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    assert_eq!(laptop.read("main.tex").as_deref(), Some("desk edit"));
}

#[tokio::test]
async fn a_manifest_written_alongside_ours_never_deletes_the_files_it_missed() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    laptop.write("main.tex", "laptop edit");
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    desk.project.remote_dirty = true;
    desk.sync(&store, cloud).await;
    assert_eq!(desk.read("main.tex").as_deref(), Some("laptop edit"));
    let shared = store.read(&version_remote(cloud)).unwrap();

    desk.write("desk.tex", "only on the desk");
    desk.sync(&store, cloud).await;
    assert!(remote_version(&store, cloud)
        .files
        .iter()
        .any(|file| file.path == "desk.tex"));

    store
        .put(&version_remote(cloud), shared, WriteMode::Overwrite)
        .await
        .unwrap();
    laptop.write("laptop.tex", "only on the laptop");
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    let raced = remote_version(&store, cloud);
    assert!(!raced.files.iter().any(|file| file.path == "desk.tex"));

    desk.project.remote_dirty = true;
    let merged = desk.sync(&store, cloud).await;
    assert!(merged.error.is_none(), "{:?}", merged.error);
    assert_eq!(merged.outcome.deleted_local, 0);
    assert_eq!(desk.read("desk.tex").as_deref(), Some("only on the desk"));
    assert_eq!(
        desk.read("laptop.tex").as_deref(),
        Some("only on the laptop")
    );
    let healed = remote_version(&store, cloud);
    for path in ["desk.tex", "laptop.tex", "main.tex"] {
        assert!(healed.files.iter().any(|file| file.path == path), "{path}");
    }

    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    assert_eq!(laptop.read("desk.tex").as_deref(), Some("only on the desk"));
}

#[tokio::test]
async fn a_lineage_copied_forward_by_an_older_oleafly_still_lets_deletes_through() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    laptop.write("notes.md", "to be removed");
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    desk.project.remote_dirty = true;
    desk.sync(&store, cloud).await;
    assert!(desk.read("notes.md").is_some());

    let mut older = remote_version(&store, cloud);
    older.files.retain(|file| file.path != "notes.md");
    older.stamp = Stamp::new(
        Hlc::from_raw(older.stamp.hlc.raw() + (1 << 16)),
        DeviceId::new(),
    );
    store
        .put(
            &version_remote(cloud),
            serde_json::to_vec(&older).unwrap(),
            WriteMode::Overwrite,
        )
        .await
        .unwrap();

    desk.project.remote_dirty = true;
    let applied = desk.sync(&store, cloud).await;
    assert_eq!(applied.outcome.deleted_local, 1);
    assert!(desk.read("notes.md").is_none());
}

#[tokio::test]
async fn a_record_from_a_newer_oleafly_is_left_untouched() {
    let (store, cloud, mut desk, _laptop) = paired().await;
    let mut value: serde_json::Value =
        serde_json::from_slice(&store.read(&version_remote(cloud)).unwrap()).unwrap();
    value["v"] = serde_json::json!(2);
    let bytes = serde_json::to_vec(&value).unwrap();
    store.overwrite(&version_remote(cloud), &bytes);
    desk.write("main.tex", "desk edit");
    desk.project.remote_dirty = true;
    let error = desk
        .try_sync(
            &store,
            cloud,
            RoundOptions {
                allow_uploads: true,
                ..RoundOptions::default()
            },
        )
        .await
        .err();
    assert_eq!(error, Some(RoundError::NewerVersion));
    assert_eq!(store.read(&version_remote(cloud)).unwrap(), bytes);
}

#[tokio::test]
async fn excluding_a_folder_stops_syncing_it_without_deleting_it_elsewhere() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    desk.write("data/raw.csv", "1,2,3");
    desk.sync(&store, cloud).await;
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    desk.write(
        "project.json",
        r#"{"name":"Thesis","main_doc":"main.tex","engine":"latexmk","sync_exclude":["data"]}"#,
    );
    let excluded = desk.sync(&store, cloud).await;
    assert_eq!(excluded.outcome.deleted_remote, 0);
    assert!(remote_version(&store, cloud)
        .files
        .iter()
        .any(|file| file.path == "data/raw.csv"));
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    assert_eq!(laptop.read("data/raw.csv").as_deref(), Some("1,2,3"));
    assert!(!desk.project.base.contains_key("data/raw.csv"));
    desk.project.remote_dirty = false;
    assert!(desk.sync(&store, cloud).await.outcome.unchanged);
}

#[tokio::test]
async fn a_downloaded_project_drops_device_fields_and_unsafe_entries() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    desk.write(
        "project.json",
        r#"{"name":"Thesis","main_doc":"main.tex","engine":"latexmk","hidden":true,"exports":[{"date":1,"filename":"x.pdf","path":"/Users/desk/x.pdf"}]}"#,
    );
    desk.write("main.tex", "one");
    desk.sync(&store, cloud).await;
    let mut version = remote_version(&store, cloud);
    store.overwrite(
        &file_remote(cloud, ".git/hooks/post-checkout"),
        b"#!/bin/sh",
    );
    version.files.push(FileRecord {
        path: ".git/hooks/post-checkout".into(),
        hash: oleafly_core::content::ContentHash::digest(b"#!/bin/sh").to_hex(),
        size: 9,
        exec: true,
        rev: None,
        extra: serde_json::Map::new(),
    });
    store.overwrite(
        &version_remote(cloud),
        &serde_json::to_vec(&version).unwrap(),
    );
    let laptop = Device::new("Laptop");
    let downloaded = download_into(
        &store,
        cloud,
        &laptop.root(),
        &laptop.dir.path().join("staging"),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(downloaded.skipped, 1);
    assert!(!laptop.root().join(".git").exists());
    let meta: serde_json::Value =
        serde_json::from_str(&laptop.read("project.json").unwrap()).unwrap();
    assert_eq!(meta["name"], "Thesis");
    assert!(meta.get("hidden").is_none());
    assert!(meta.get("exports").is_none());
}

fn long_thesis(device: &Device) {
    thesis(device);
    for index in 0..150 {
        device.write(
            &format!("chapters/part-{index:03}.tex"),
            &format!("part {index}"),
        );
    }
}

#[tokio::test]
async fn a_large_download_comes_as_one_zip_and_checks_every_file() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    long_thesis(&desk);
    desk.sync(&store, cloud).await;
    store.overwrite(
        &file_remote(cloud, "chapters/part-007.tex"),
        b"bytes the version record does not know",
    );
    store.with(|inner| inner.downloads = 0);

    let mut laptop = Device::new("Laptop");
    laptop.download(&store, cloud).await;
    assert_eq!(store.with(|inner| (inner.zips, inner.downloads)), (1, 2));
    assert_eq!(
        laptop.read("chapters/part-007.tex").as_deref(),
        Some("part 7")
    );
    assert_eq!(
        laptop.read("chapters/part-139.tex").as_deref(),
        Some("part 139")
    );
    assert_eq!(laptop.read("main.tex").as_deref(), Some("one"));
    assert!(laptop.sync(&store, cloud).await.outcome.unchanged);

    let (small, small_cloud, _desk, _office) = paired().await;
    assert_eq!(small.with(|inner| inner.zips), 0);
    assert!(small.read(&version_remote(small_cloud)).is_some());
}

#[tokio::test]
async fn putting_back_most_of_a_project_downloads_it_as_one_zip() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    long_thesis(&desk);
    desk.sync(&store, cloud).await;
    std::fs::remove_dir_all(desk.root().join("chapters")).unwrap();
    assert!(desk.sync(&store, cloud).await.outcome.held);
    store.with(|inner| inner.downloads = 0);

    desk.sync_with(
        &store,
        cloud,
        RoundOptions {
            allow_uploads: true,
            restore_deleted: true,
            ..RoundOptions::default()
        },
    )
    .await;
    assert_eq!(store.with(|inner| (inner.zips, inner.downloads)), (1, 0));
    assert_eq!(
        desk.read("chapters/part-012.tex").as_deref(),
        Some("part 12")
    );

    let mut laptop = Device::new("Laptop");
    laptop.download(&store, cloud).await;
    laptop.write("chapters/part-001.tex", "part 1 from the laptop");
    laptop.sync(&store, cloud).await;
    desk.project.remote_dirty = true;
    store.with(|inner| inner.downloads = 0);
    assert_eq!(desk.sync(&store, cloud).await.outcome.downloaded, 1);
    assert_eq!(store.with(|inner| (inner.zips, inner.downloads)), (2, 1));
    assert_eq!(
        desk.read("chapters/part-001.tex").as_deref(),
        Some("part 1 from the laptop")
    );
}

#[tokio::test]
async fn an_unreadable_zip_falls_back_to_one_download_per_file() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    long_thesis(&desk);
    desk.sync(&store, cloud).await;
    store.with(|inner| {
        inner.broken_zip = true;
        inner.downloads = 0;
    });

    let mut laptop = Device::new("Laptop");
    laptop.download(&store, cloud).await;
    assert_eq!(store.with(|inner| (inner.zips, inner.downloads)), (1, 152));
    assert_eq!(
        laptop.read("chapters/part-021.tex").as_deref(),
        Some("part 21")
    );
    let staging = std::fs::read_dir(laptop.dir.path().join("staging"))
        .unwrap()
        .count();
    assert_eq!(staging, 0);
}

#[tokio::test]
async fn a_long_first_backup_reports_progress_and_marks_interim_records_unfinished() {
    crate::cloud::progress::recorded::listen();
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    thesis(&desk);
    for index in 0..450 {
        desk.write(&format!("parts/p-{index:03}.tex"), &format!("part {index}"));
    }
    desk.sync(&store, cloud).await;
    let pending: Vec<Option<u64>> = store.with(|inner| {
        inner
            .history
            .values()
            .filter_map(|bytes| serde_json::from_slice::<VersionManifest>(bytes).ok())
            .map(|version| version.pending)
            .collect()
    });
    assert_eq!(pending, vec![Some(252), Some(52), None]);
    let uploads: Vec<(u64, u64)> = crate::cloud::progress::recorded::for_cloud(&cloud.to_string())
        .iter()
        .filter(|event| event.phase == crate::cloud::progress::Phase::Uploading)
        .map(|event| (event.done, event.total))
        .collect();
    assert_eq!(uploads.first(), Some(&(0, 452)));
    assert_eq!(uploads.last(), Some(&(452, 452)));
    assert!(uploads.windows(2).all(|pair| pair[0].0 <= pair[1].0));

    let interim = store.with(|inner| {
        inner
            .history
            .values()
            .find_map(|bytes| {
                serde_json::from_slice::<VersionManifest>(bytes)
                    .ok()
                    .filter(|version| version.pending == Some(52))
            })
            .unwrap()
    });
    store.overwrite(
        &version_remote(cloud),
        &serde_json::to_vec(&interim).unwrap(),
    );
    let listed = list_remote_projects(&store, &BTreeSet::new(), &mut BTreeMap::new())
        .await
        .unwrap();
    assert_eq!(listed[0].pending, Some(52));
    assert_eq!(listed[0].device.as_deref(), Some("Desk"));

    let mut laptop = Device::new("Laptop");
    laptop.download(&store, cloud).await;
    let fetched: Vec<(u64, u64)> = crate::cloud::progress::recorded::for_cloud(&cloud.to_string())
        .iter()
        .filter(|event| event.phase == crate::cloud::progress::Phase::Fetching)
        .map(|event| (event.done, event.total))
        .collect();
    assert!(fetched.len() >= 2, "{fetched:?}");
    assert_eq!(
        fetched.last().map(|(done, total)| done == total),
        Some(true)
    );
    let arrived = std::fs::read_dir(laptop.root().join("parts"))
        .unwrap()
        .count();
    assert_eq!(arrived as u64 + 1 + 52, 452);
    assert_eq!(laptop.read("main.tex").as_deref(), Some("one"));
    assert!(laptop.project.remote_dirty || laptop.project.remote_rev.is_some());
}

fn figures(device: &Device, folder: &str) {
    std::fs::create_dir_all(device.root().join(folder)).unwrap();
    for index in 0..3_u8 {
        std::fs::write(
            device.root().join(format!("{folder}/f{index}.png")),
            vec![index + 1; 600 * 1024],
        )
        .unwrap();
    }
    device.write(&format!("{folder}/notes.txt"), "small");
}

#[tokio::test]
async fn renaming_a_folder_copies_large_files_in_dropbox_and_moves_them_on_other_computers() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    thesis(&desk);
    figures(&desk, "figs");
    desk.sync(&store, cloud).await;
    let mut laptop = Device::new("Laptop");
    laptop.download(&store, cloud).await;

    std::fs::rename(desk.root().join("figs"), desk.root().join("figures")).unwrap();
    store.with(|inner| inner.upload_bytes = 0);
    let renamed = desk.sync(&store, cloud).await;
    assert_eq!(renamed.outcome.copied, 3);
    assert_eq!(store.with(|inner| inner.upload_bytes), 5);
    assert!(store.read(&file_remote(cloud, "figs/f0.png")).is_none());
    assert_eq!(
        store.read(&file_remote(cloud, "figures/f2.png")),
        Some(vec![3; 600 * 1024])
    );

    store.with(|inner| inner.downloads = 0);
    laptop.project.remote_dirty = true;
    let pulled = laptop.sync(&store, cloud).await;
    assert_eq!(store.with(|inner| inner.downloads), 0);
    assert_eq!(pulled.outcome.downloaded, 4);
    assert_eq!(pulled.outcome.deleted_local, 4);
    assert!(!laptop.root().join("figs").exists());
    assert_eq!(
        std::fs::read(laptop.root().join("figures/f1.png")).unwrap(),
        vec![2; 600 * 1024]
    );
    assert_eq!(laptop.read("figures/notes.txt").as_deref(), Some("small"));
    assert!(!laptop.dir.path().join("trash").exists());
    assert!(laptop.sync(&store, cloud).await.outcome.unchanged);
}

#[tokio::test]
async fn a_copy_that_does_not_match_the_file_here_is_uploaded_instead() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    thesis(&desk);
    figures(&desk, "figs");
    desk.sync(&store, cloud).await;
    std::fs::rename(desk.root().join("figs"), desk.root().join("figures")).unwrap();
    store.with(|inner| {
        inner.corrupt_copies = true;
        inner.upload_bytes = 0;
    });
    let renamed = desk.sync(&store, cloud).await;
    assert_eq!(renamed.outcome.copied, 0);
    assert_eq!(store.with(|inner| inner.copies), 3);
    assert_eq!(store.with(|inner| inner.upload_bytes), 3 * 600 * 1024 + 5);
    assert_eq!(
        store.read(&file_remote(cloud, "figures/f0.png")),
        Some(vec![1; 600 * 1024])
    );
    let mut laptop = Device::new("Laptop");
    laptop.download(&store, cloud).await;
    assert_eq!(
        std::fs::read(laptop.root().join("figures/f0.png")).unwrap(),
        vec![1; 600 * 1024]
    );
}

#[tokio::test]
async fn a_missing_file_fails_a_download_without_leaving_half_a_project() {
    let (store, cloud, _desk, _laptop) = paired().await;
    store.remove(&file_remote(cloud, "main.tex"));
    let mut version = remote_version(&store, cloud);
    for file in &mut version.files {
        file.rev = None;
    }
    store.overwrite(
        &version_remote(cloud),
        &serde_json::to_vec(&version).unwrap(),
    );
    let office = Device::new("Office");
    let result = download_into(
        &store,
        cloud,
        &office.root(),
        &office.dir.path().join("staging"),
    )
    .await;
    assert!(matches!(
        result,
        Err(RoundError::Store(StoreError::Verify(_)))
    ));
    assert!(office.names().is_empty());
}

#[tokio::test]
async fn going_offline_mid_round_keeps_everything_that_already_happened() {
    let (store, cloud, mut desk, _laptop) = paired().await;
    desk.write("main.tex", "desk edit");
    store.with(|inner| inner.offline = true);
    let result = desk
        .try_sync(
            &store,
            cloud,
            RoundOptions {
                allow_uploads: true,
                ..RoundOptions::default()
            },
        )
        .await;
    assert!(matches!(
        result,
        Err(RoundError::Store(StoreError::Network(_)))
    ));
    store.with(|inner| inner.offline = false);
    let back = desk.sync(&store, cloud).await;
    assert_eq!(back.outcome.uploaded, 1);
}

fn round<'a>(
    device: &'a Device,
    hlc: &'a mut u64,
    state: &'a mut SettingsState,
) -> SettingsRound<'a> {
    SettingsRound {
        device: device.id,
        device_name: &device.name,
        hlc,
        state,
    }
}

#[tokio::test]
async fn settings_start_with_a_choice_on_a_new_computer_and_then_merge() {
    let store = MemoryStore::default();
    let desk = Device::new("Desk");
    let laptop = Device::new("Laptop");
    let (mut desk_hlc, mut laptop_hlc) = (0, 0);
    let mut desk_state = SettingsState::default();
    let mut laptop_state = SettingsState::default();
    let desk_values = serde_json::json!({
        "appearance": {"theme": "dark", "fontSize": 14},
        "dictionary": {"words": ["alpha"]},
        "experimentation": {"webBrowser": true}
    });
    let pushed = settings::sync_settings(
        &store,
        round(&desk, &mut desk_hlc, &mut desk_state),
        desk_values.clone(),
    )
    .await
    .unwrap();
    assert_eq!(pushed, SettingsOutcome::Pushed);
    let stored: serde_json::Value =
        serde_json::from_slice(&store.read(settings::SETTINGS_REMOTE).unwrap()).unwrap();
    assert!(stored["values"].get("experimentation").is_none());

    let laptop_values = serde_json::json!({"appearance": {"theme": "light", "fontSize": 14}, "dictionary": {"words": []}});
    let choose = settings::sync_settings(
        &store,
        round(&laptop, &mut laptop_hlc, &mut laptop_state),
        laptop_values.clone(),
    )
    .await
    .unwrap();
    let SettingsOutcome::Choose { values, stamp, .. } = choose else {
        panic!("expected a choice, got {choose:?}");
    };
    assert_eq!(values["appearance"]["theme"], "dark");
    assert!(!settings::applied(
        &mut laptop_state,
        stamp + 1,
        values.clone()
    ));
    assert!(settings::applied(&mut laptop_state, stamp, values.clone()));

    let offline_desk = serde_json::json!({"appearance": {"theme": "dark", "fontSize": 18}, "dictionary": {"words": ["alpha", "beta"]}});
    let offline_laptop = serde_json::json!({"appearance": {"theme": "solarized", "fontSize": 14}, "dictionary": {"words": ["alpha", "gamma"]}});
    settings::sync_settings(
        &store,
        round(&desk, &mut desk_hlc, &mut desk_state),
        offline_desk,
    )
    .await
    .unwrap();
    let merged = settings::sync_settings(
        &store,
        round(&laptop, &mut laptop_hlc, &mut laptop_state),
        offline_laptop,
    )
    .await
    .unwrap();
    let SettingsOutcome::Apply { values, stamp } = merged else {
        panic!("expected merged settings, got {merged:?}");
    };
    assert_eq!(values["appearance"]["theme"], "solarized");
    assert_eq!(values["appearance"]["fontSize"], 18);
    assert_eq!(
        values["dictionary"]["words"],
        serde_json::json!(["alpha", "gamma", "beta"])
    );
    assert!(settings::applied(&mut laptop_state, stamp, values.clone()));
    let settled = settings::sync_settings(
        &store,
        round(&laptop, &mut laptop_hlc, &mut laptop_state),
        values.clone(),
    )
    .await
    .unwrap();
    assert_eq!(settled, SettingsOutcome::Current);
    let pulled = settings::sync_settings(
        &store,
        round(&desk, &mut desk_hlc, &mut desk_state),
        serde_json::json!({"appearance": {"theme": "dark", "fontSize": 18}, "dictionary": {"words": ["alpha", "beta"]}}),
    )
    .await
    .unwrap();
    let SettingsOutcome::Apply {
        values: desk_view, ..
    } = pulled
    else {
        panic!("expected the desk to pull the merge, got {pulled:?}");
    };
    assert_eq!(desk_view, values);
}

#[tokio::test]
async fn keeping_this_computers_settings_replaces_the_cloud_copy() {
    let store = MemoryStore::default();
    let desk = Device::new("Desk");
    let laptop = Device::new("Laptop");
    let (mut desk_hlc, mut laptop_hlc) = (0, 0);
    let mut desk_state = SettingsState::default();
    let mut laptop_state = SettingsState::default();
    settings::sync_settings(
        &store,
        round(&desk, &mut desk_hlc, &mut desk_state),
        serde_json::json!({"a": 1}),
    )
    .await
    .unwrap();
    let choose = settings::sync_settings(
        &store,
        round(&laptop, &mut laptop_hlc, &mut laptop_state),
        serde_json::json!({"a": 2}),
    )
    .await
    .unwrap();
    assert!(matches!(choose, SettingsOutcome::Choose { .. }));
    settings::keep_local(
        &store,
        round(&laptop, &mut laptop_hlc, &mut laptop_state),
        serde_json::json!({"a": 2}),
    )
    .await
    .unwrap();
    let pulled = settings::sync_settings(
        &store,
        round(&desk, &mut desk_hlc, &mut desk_state),
        serde_json::json!({"a": 1}),
    )
    .await
    .unwrap();
    assert_eq!(
        pulled,
        SettingsOutcome::Apply {
            values: serde_json::json!({"a": 2}),
            stamp: laptop_state.stamp
        }
    );
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn names_that_differ_only_by_case_sync_one_file_and_skip_the_other() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    thesis(&desk);
    desk.write("Notes.md", "upper");
    desk.write("notes.md", "lower");
    let result = desk.sync(&store, cloud).await;
    assert_eq!(result.outcome.skipped, 1);
    let published = remote_version(&store, cloud);
    assert_eq!(
        published
            .files
            .iter()
            .filter(|file| file.path.eq_ignore_ascii_case("notes.md"))
            .count(),
        1
    );
}

#[cfg(unix)]
#[tokio::test]
async fn an_unreadable_file_is_never_published_as_deleted() {
    use std::os::unix::fs::PermissionsExt as _;
    let (store, cloud, mut desk, _laptop) = paired().await;
    let main = desk.root().join("main.tex");
    std::fs::set_permissions(&main, std::fs::Permissions::from_mode(0o000)).unwrap();
    desk.write("other.tex", "new");
    let result = desk.sync(&store, cloud).await;
    std::fs::set_permissions(&main, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(result.outcome.deleted_remote, 0);
    assert!(remote_version(&store, cloud)
        .files
        .iter()
        .any(|file| file.path == "main.tex"));
    assert!(store.read(&file_remote(cloud, "main.tex")).is_some());
}

#[tokio::test]
async fn cloud_only_projects_are_listed_with_their_names_and_sizes() {
    let (store, cloud, _desk, _laptop) = paired().await;
    let other = ProjectId::new();
    let mut office = Device::new("Office");
    office.write("project.json", r#"{"name":"Grant","main_doc":"main.tex"}"#);
    office.write("main.tex", "budget");
    office.sync(&store, other).await;
    store.overwrite("/projects/not-a-project/version.json", b"{}");
    let known = [cloud].into_iter().collect();
    let listed = list_remote_projects(&store, &known, &mut std::collections::BTreeMap::new())
        .await
        .unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].cloud, other);
    assert_eq!(listed[0].name, "Grant");
    assert!(listed[0].size > 0);
}

#[tokio::test]
async fn projects_uploaded_by_the_first_cloud_build_still_download_and_sync() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let meta = br#"{"name":"Early","main_doc":"main.tex","engine":"latexmk"}"#;
    let tex = b"from the first build";
    store.overwrite(&file_remote(cloud, "project.json"), meta);
    store.overwrite(&file_remote(cloud, "main.tex"), tex);
    let version = serde_json::json!({
        "v": 1,
        "project": cloud,
        "name": "Early",
        "manifest": {"name": "Early", "main_doc": "main.tex", "engine": "latexmk"},
        "stamp": Stamp::new(Hlc::from_raw(1 << 16), DeviceId::new()),
        "files": [
            {"path": "main.tex", "hash": oleafly_core::content::ContentHash::digest(tex).to_hex(), "size": tex.len()},
            {"path": "project.json", "hash": oleafly_core::content::ContentHash::digest(meta).to_hex(), "size": meta.len()}
        ]
    });
    store.overwrite(
        &version_remote(cloud),
        &serde_json::to_vec(&version).unwrap(),
    );
    let mut laptop = Device::new("Laptop");
    laptop.download(&store, cloud).await;
    assert_eq!(
        laptop.read("main.tex").as_deref(),
        Some("from the first build")
    );
    let meta: serde_json::Value =
        serde_json::from_str(&laptop.read("project.json").unwrap()).unwrap();
    assert_eq!(meta["name"], "Early");
    laptop.project.remote_dirty = true;
    let healed = laptop.sync(&store, cloud).await;
    assert!(healed.error.is_none());
    assert_eq!(healed.outcome.conflicts, 0);
    assert_eq!(
        laptop.read("main.tex").as_deref(),
        Some("from the first build")
    );
}

#[tokio::test]
async fn a_missing_file_names_itself_in_the_error() {
    let (store, cloud, _desk, _laptop) = paired().await;
    store.remove(&file_remote(cloud, "main.tex"));
    let mut version = remote_version(&store, cloud);
    for file in &mut version.files {
        file.rev = None;
    }
    store.overwrite(
        &version_remote(cloud),
        &serde_json::to_vec(&version).unwrap(),
    );
    let office = Device::new("Office");
    let error = download_into(
        &store,
        cloud,
        &office.root(),
        &office.dir.path().join("staging"),
    )
    .await
    .err();
    assert_eq!(
        error,
        Some(RoundError::Store(StoreError::Verify(
            "main.tex is missing from memory".into()
        )))
    );
}

#[tokio::test]
async fn an_unpinned_record_from_the_first_build_trusts_the_bytes_in_dropbox_and_heals() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let meta = br#"{"name":"Early","main_doc":"main.tex","engine":"latexmk"}"#;
    store.overwrite(&file_remote(cloud, "project.json"), meta);
    store.overwrite(
        &file_remote(cloud, "main.tex"),
        b"what is really in dropbox",
    );
    let version = serde_json::json!({
        "v": 1,
        "project": cloud,
        "name": "Early",
        "stamp": Stamp::new(Hlc::from_raw(1 << 16), DeviceId::new()),
        "files": [
            {"path": "main.tex", "hash": oleafly_core::content::ContentHash::digest(b"an older edit").to_hex(), "size": 13},
            {"path": "project.json", "hash": oleafly_core::content::ContentHash::digest(meta).to_hex(), "size": meta.len()}
        ]
    });
    store.overwrite(
        &version_remote(cloud),
        &serde_json::to_vec(&version).unwrap(),
    );
    let mut laptop = Device::new("Laptop");
    laptop.download(&store, cloud).await;
    assert_eq!(
        laptop.read("main.tex").as_deref(),
        Some("what is really in dropbox")
    );
    laptop.project.remote_dirty = true;
    let healed = laptop.sync(&store, cloud).await;
    assert!(healed.error.is_none());
    assert_eq!(healed.outcome.conflicts, 0);
    let main = remote_version(&store, cloud)
        .files
        .into_iter()
        .find(|file| file.path == "main.tex")
        .unwrap();
    assert_eq!(
        main.hash,
        oleafly_core::content::ContentHash::digest(b"what is really in dropbox").to_hex()
    );
    laptop.project.remote_dirty = true;
    assert!(laptop.sync(&store, cloud).await.outcome.unchanged);
}

#[tokio::test]
async fn a_main_document_inside_the_compile_folder_syncs() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    desk.write(
        "project.json",
        r#"{"name":"Paper","main_doc":"paper/main.tex","compile_dir":"paper"}"#,
    );
    desk.write("paper/main.tex", "body");
    desk.write("paper/figures/plot.png", "png");
    desk.write("paper/main.aux", "aux");
    let first = desk.sync(&store, cloud).await;
    assert_eq!(first.outcome.uploaded, 3);
    let paths: Vec<String> = remote_version(&store, cloud)
        .files
        .iter()
        .map(|file| file.path.clone())
        .collect();
    assert!(paths.contains(&"paper/main.tex".to_string()));
    assert!(paths.contains(&"paper/figures/plot.png".to_string()));
    assert!(!paths.iter().any(|path| path.ends_with(".aux")));
    let mut laptop = Device::new("Laptop");
    laptop.download(&store, cloud).await;
    assert_eq!(laptop.read("paper/main.tex").as_deref(), Some("body"));
}

#[tokio::test]
async fn a_record_this_build_cannot_read_never_deletes_the_local_file() {
    let (store, cloud, _desk, mut laptop) = paired().await;
    let mut version = remote_version(&store, cloud);
    for file in &mut version.files {
        if file.path == "main.tex" {
            file.rev = Some("zz".into());
        }
    }
    store.overwrite(
        &version_remote(cloud),
        &serde_json::to_vec(&version).unwrap(),
    );
    laptop.project.remote_dirty = true;
    laptop.project.remote_rev = None;
    let result = laptop.sync(&store, cloud).await;
    assert!(result.error.is_none());
    assert_eq!(result.outcome.deleted_local, 0);
    assert_eq!(laptop.read("main.tex").as_deref(), Some("one"));
    assert!(remote_version(&store, cloud)
        .files
        .iter()
        .any(|file| file.path == "main.tex" && file.rev.as_deref() == Some("zz")));
    assert!(!laptop.project.remote_dirty);
}

#[tokio::test]
async fn renaming_a_folder_moves_its_files_without_a_hold() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    thesis(&desk);
    for index in 0..30 {
        desk.write(
            &format!("chapters/part{index}.tex"),
            &format!("part {index}"),
        );
    }
    desk.sync(&store, cloud).await;
    std::fs::rename(desk.root().join("chapters"), desk.root().join("sections")).unwrap();
    let moved = desk.sync(&store, cloud).await;
    assert!(!moved.outcome.held);
    assert_eq!(moved.outcome.deleted_remote, 30);
    assert_eq!(moved.outcome.uploaded, 30);
    let version = remote_version(&store, cloud);
    assert!(version
        .files
        .iter()
        .all(|file| !file.path.starts_with("chapters/")));
    assert_eq!(
        version
            .files
            .iter()
            .filter(|file| file.path.starts_with("sections/"))
            .count(),
        30
    );
    for index in 0..25 {
        desk.remove(&format!("sections/part{index}.tex"));
    }
    desk.write("empty-a.tex", "");
    let held = desk.sync(&store, cloud).await;
    assert!(held.outcome.held);
}

#[cfg(unix)]
#[tokio::test]
async fn skipped_files_are_counted_and_listed_with_their_reasons() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    thesis(&desk);
    desk.write("node_modules/pkg/index.js", "x");
    std::os::unix::fs::symlink(desk.root().join("main.tex"), desk.root().join("alias.tex"))
        .unwrap();
    let first = desk.sync(&store, cloud).await;
    assert_eq!(first.outcome.skipped, 2);
    assert_eq!(desk.project.skipped, 2);
    let reasons: Vec<(String, String)> = desk
        .project
        .skipped_files
        .iter()
        .map(|file| (file.path.clone(), file.reason.clone()))
        .collect();
    assert!(reasons.contains(&("node_modules".into(), "packageFolder".into())));
    assert!(reasons.contains(&("alias.tex".into(), "symlink".into())));
}

#[tokio::test]
async fn a_revision_dropbox_no_longer_keeps_is_not_downloaded_every_round() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    desk.write("main.tex", "two");
    desk.sync(&store, cloud).await;
    let rev = remote_version(&store, cloud)
        .files
        .iter()
        .find(|file| file.path == "main.tex")
        .and_then(|file| file.rev.clone())
        .unwrap();
    store.with(|inner| {
        inner.purged.insert(rev);
    });
    store.overwrite(&file_remote(cloud, "main.tex"), b"three, not in any record");
    laptop.project.remote_dirty = true;
    let first = laptop.sync(&store, cloud).await;
    assert_eq!(first.outcome.downloaded, 0);
    assert_eq!(laptop.read("main.tex").as_deref(), Some("one"));
    assert!(laptop.project.failed.contains_key("main.tex"));
    assert!(laptop
        .project
        .skipped_files
        .iter()
        .any(|file| file.path == "main.tex" && file.reason == "downloadFailed"));
    let fetched = store.with(|inner| inner.downloads);
    laptop.project.remote_dirty = true;
    let second = laptop.sync(&store, cloud).await;
    assert!(second.error.is_none());
    assert_eq!(store.with(|inner| inner.downloads), fetched);
    laptop.project.failed.get_mut("main.tex").unwrap().at_ms = 0;
    laptop.sync(&store, cloud).await;
    assert!(store.with(|inner| inner.downloads) > fetched);
}

#[tokio::test]
async fn a_settled_file_keeps_its_hash_between_launches() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    thesis(&desk);
    let past = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
    for name in ["project.json", "main.tex"] {
        std::fs::File::options()
            .write(true)
            .open(desk.root().join(name))
            .unwrap()
            .set_modified(past)
            .unwrap();
    }
    desk.sync(&store, cloud).await;
    assert!(desk.project.base["main.tex"].stamp.is_some());
    let fake = "f".repeat(64);
    let mut base = desk.project.base.clone();
    base.get_mut("main.tex").unwrap().hash = fake.clone();
    let reused = capture_with(&desk.root(), &base, None).unwrap();
    assert_eq!(reused.files["main.tex"].hash, fake);
    desk.write("main.tex", "changed");
    let rehashed = capture_with(&desk.root(), &base, None).unwrap();
    assert_ne!(rehashed.files["main.tex"].hash, fake);
}

#[tokio::test]
async fn a_nearly_full_dropbox_skips_files_that_cannot_fit() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    thesis(&desk);
    desk.sync(&store, cloud).await;
    desk.write("data.bin", &"x".repeat(4096));
    desk.write("note.tex", "small");
    let before = store.with(|inner| inner.upload_bytes);
    let result = desk
        .sync_with(
            &store,
            cloud,
            RoundOptions {
                allow_uploads: true,
                free_bytes: Some(1024),
                ..RoundOptions::default()
            },
        )
        .await;
    assert!(result.outcome.quota_hit);
    assert_eq!(result.outcome.uploaded, 1);
    assert_eq!(store.with(|inner| inner.upload_bytes) - before, 5);
    assert!(store.read(&file_remote(cloud, "data.bin")).is_none());
    assert!(desk.project.remote_dirty);
}

#[tokio::test]
async fn stopping_a_round_keeps_the_rest_for_next_time() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    thesis(&desk);
    let flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
    let stopped = desk
        .sync_with(
            &store,
            cloud,
            RoundOptions {
                allow_uploads: true,
                cancel: Some(flag.clone()),
                ..RoundOptions::default()
            },
        )
        .await;
    assert_eq!(stopped.outcome.uploaded, 0);
    assert!(desk.project.remote_dirty);
    flag.store(false, std::sync::atomic::Ordering::Relaxed);
    let resumed = desk
        .sync_with(
            &store,
            cloud,
            RoundOptions {
                allow_uploads: true,
                cancel: Some(flag),
                ..RoundOptions::default()
            },
        )
        .await;
    assert_eq!(resumed.outcome.uploaded, 2);
}

#[tokio::test]
async fn a_delete_waits_for_the_revision_it_expected() {
    let (store, cloud, mut desk, _laptop) = paired().await;
    let stray = file_remote(cloud, "stray.tex");
    let stray_rev = store.with(|inner| inner.write(&stray, b"another computer".to_vec()));
    let kept = file_remote(cloud, "kept.tex");
    store.overwrite(&kept, b"newer");
    let persisted = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen = persisted.clone();
    desk.project.pending_deletes = vec![
        PendingDelete {
            path: "stray.tex".into(),
            rev: Some(stray_rev),
        },
        PendingDelete {
            path: "kept.tex".into(),
            rev: Some("0123456789abcdef".into()),
        },
    ];
    let mut env = desk.env();
    env.persist_pending = Some(std::sync::Arc::new(move |pending: &[PendingDelete]| {
        seen.lock().unwrap().extend(pending.iter().cloned());
    }));
    let result = sync_project(
        &store,
        &env,
        &desk.context(),
        cloud,
        &desk.project,
        desk.hlc,
        &RoundOptions {
            allow_uploads: true,
            ..RoundOptions::default()
        },
    )
    .await
    .unwrap();
    assert!(result.error.is_none());
    assert!(store.read(&stray).is_none());
    assert_eq!(store.read(&kept).as_deref(), Some(&b"newer"[..]));
    assert!(result.project.pending_deletes.is_empty());
    assert_eq!(persisted.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn replacing_a_file_with_a_folder_converges() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    desk.write("notes", "a file");
    desk.sync(&store, cloud).await;
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    assert_eq!(laptop.read("notes").as_deref(), Some("a file"));
    desk.remove("notes");
    desk.write("notes/intro.tex", "now a folder");
    desk.sync(&store, cloud).await;
    desk.sync(&store, cloud).await;
    let version = remote_version(&store, cloud);
    assert!(version
        .files
        .iter()
        .any(|file| file.path == "notes/intro.tex"));
    assert!(!version.files.iter().any(|file| file.path == "notes"));
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    assert_eq!(
        laptop.read("notes/intro.tex").as_deref(),
        Some("now a folder")
    );
}

#[tokio::test]
async fn an_unreadable_record_in_dropbox_can_be_replaced_from_this_computer() {
    let (store, cloud, mut desk, _laptop) = paired().await;
    store.overwrite(&version_remote(cloud), b"not json");
    desk.project.remote_dirty = true;
    desk.write("main.tex", "desk edit");
    let failed = desk
        .try_sync(
            &store,
            cloud,
            RoundOptions {
                allow_uploads: true,
                ..RoundOptions::default()
            },
        )
        .await;
    assert!(matches!(failed, Err(RoundError::Unreadable(_))));
    let replaced = desk
        .sync_with(
            &store,
            cloud,
            RoundOptions {
                allow_uploads: true,
                replace_remote: true,
                ..RoundOptions::default()
            },
        )
        .await;
    assert!(replaced.error.is_none());
    assert!(remote_version(&store, cloud)
        .files
        .iter()
        .any(|file| file.path == "main.tex"));
    assert_eq!(
        store.read(&file_remote(cloud, "main.tex")).as_deref(),
        Some(&b"desk edit"[..])
    );
}

#[tokio::test]
async fn an_unreadable_tombstone_names_no_device() {
    let (store, cloud, _desk, mut laptop) = paired().await;
    store.remove(&format!("/projects/{cloud}"));
    store.overwrite(&tombstone_remote(cloud), b"garbage");
    laptop.project.remote_dirty = true;
    let removed = laptop.sync(&store, cloud).await;
    assert_eq!(removed.outcome.removed_by.as_deref(), Some(""));
    assert!(laptop.project.paused);
}

#[tokio::test]
async fn conflict_copies_add_up_until_dismissed_and_name_what_changed() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    desk.write("main.tex", "desk version");
    desk.sync(&store, cloud).await;
    laptop.write("main.tex", "laptop version");
    laptop.project.remote_dirty = true;
    let first = laptop.sync(&store, cloud).await;
    assert_eq!(first.outcome.conflicts, 1);
    let copy = format!("main (Desk {}).tex", today());
    assert!(first.outcome.changed.contains(&copy));
    assert_eq!(laptop.project.conflict_copies, vec![copy.clone()]);
    desk.project.remote_dirty = true;
    desk.sync(&store, cloud).await;
    desk.write("main.tex", "desk again");
    desk.sync(&store, cloud).await;
    laptop.write("main.tex", "laptop again");
    laptop.project.remote_dirty = true;
    let second = laptop.sync(&store, cloud).await;
    assert_eq!(second.outcome.conflicts, 1);
    assert_eq!(laptop.project.conflicts, 2);
    assert_eq!(laptop.project.conflict_copies.len(), 2);
}

#[tokio::test]
async fn a_crash_after_placing_a_conflict_copy_reuses_it() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    desk.write("main.tex", "desk version");
    desk.sync(&store, cloud).await;
    laptop.write("main.tex", "laptop version");
    let copy = format!("main (Desk {}).tex", today());
    laptop.write(&copy, "desk version");
    laptop.project.remote_dirty = true;
    let result = laptop.sync(&store, cloud).await;
    assert_eq!(result.outcome.conflicts, 1);
    assert!(!laptop
        .names()
        .iter()
        .any(|name| name.starts_with("main (Desk") && name.ends_with(" 2).tex")));
    assert_eq!(laptop.read(&copy).as_deref(), Some("desk version"));
}

#[tokio::test]
async fn merged_settings_that_were_not_applied_never_revert_the_other_computer() {
    let store = MemoryStore::default();
    let desk = Device::new("Desk");
    let laptop = Device::new("Laptop");
    let (mut desk_hlc, mut laptop_hlc) = (0, 0);
    let mut desk_state = SettingsState::default();
    let mut laptop_state = SettingsState::default();
    let start = serde_json::json!({"theme": "light", "font": 14});
    settings::sync_settings(
        &store,
        round(&desk, &mut desk_hlc, &mut desk_state),
        start.clone(),
    )
    .await
    .unwrap();
    let choose = settings::sync_settings(
        &store,
        round(&laptop, &mut laptop_hlc, &mut laptop_state),
        serde_json::json!({"theme": "light", "font": 12}),
    )
    .await
    .unwrap();
    let SettingsOutcome::Choose {
        stamp, deferred, ..
    } = choose
    else {
        panic!("expected a choice, got {choose:?}");
    };
    assert!(!deferred);
    assert!(settings::defer(&mut laptop_state, stamp));
    let again = settings::sync_settings(
        &store,
        round(&laptop, &mut laptop_hlc, &mut laptop_state),
        serde_json::json!({"theme": "light", "font": 12}),
    )
    .await
    .unwrap();
    assert!(matches!(
        again,
        SettingsOutcome::Choose { deferred: true, .. }
    ));
    assert!(settings::applied(&mut laptop_state, stamp, start.clone()));
    assert!(laptop_state.deferred.is_none());

    settings::sync_settings(
        &store,
        round(&desk, &mut desk_hlc, &mut desk_state),
        serde_json::json!({"theme": "dark", "font": 14}),
    )
    .await
    .unwrap();
    let local = serde_json::json!({"theme": "light", "font": 16});
    let merged = settings::sync_settings(
        &store,
        round(&laptop, &mut laptop_hlc, &mut laptop_state),
        local.clone(),
    )
    .await
    .unwrap();
    let SettingsOutcome::Apply { values, .. } = merged else {
        panic!("expected merged settings, got {merged:?}");
    };
    assert_eq!(values, serde_json::json!({"theme": "dark", "font": 16}));
    let unapplied = settings::sync_settings(
        &store,
        round(&laptop, &mut laptop_hlc, &mut laptop_state),
        local,
    )
    .await
    .unwrap();
    assert!(matches!(unapplied, SettingsOutcome::Apply { .. }));
    let stored: serde_json::Value =
        serde_json::from_slice(&store.read(settings::SETTINGS_REMOTE).unwrap()).unwrap();
    assert_eq!(stored["values"]["theme"], "dark");
    assert_eq!(stored["values"]["font"], 16);
}

#[tokio::test]
async fn unchanged_settings_check_the_revision_instead_of_downloading() {
    let store = MemoryStore::default();
    let desk = Device::new("Desk");
    let mut hlc = 0;
    let mut state = SettingsState::default();
    let values = serde_json::json!({"theme": "dark", "experimentation": {"webBrowser": true}});
    settings::sync_settings(&store, round(&desk, &mut hlc, &mut state), values.clone())
        .await
        .unwrap();
    let stored: serde_json::Value =
        serde_json::from_slice(&store.read(settings::SETTINGS_REMOTE).unwrap()).unwrap();
    assert!(stored["values"].get("experimentation").is_none());
    let calls = store.with(|inner| inner.calls);
    let current = settings::sync_settings(&store, round(&desk, &mut hlc, &mut state), values)
        .await
        .unwrap();
    assert_eq!(current, SettingsOutcome::Current);
    assert_eq!(store.with(|inner| inner.calls) - calls, 1);
}

#[cfg(unix)]
#[tokio::test]
async fn a_skipped_file_added_without_other_changes_is_still_listed() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    thesis(&desk);
    desk.sync(&store, cloud).await;
    assert!(desk.project.skipped_files.is_empty());
    std::os::unix::fs::symlink(desk.root().join("main.tex"), desk.root().join("alias.tex"))
        .unwrap();
    let quiet = desk.sync(&store, cloud).await;
    assert!(quiet.outcome.unchanged);
    assert_eq!(quiet.outcome.skipped, 1);
    assert_eq!(desk.project.skipped_files[0].path, "alias.tex");
    std::fs::remove_file(desk.root().join("alias.tex")).unwrap();
    desk.sync(&store, cloud).await;
    assert!(desk.project.skipped_files.is_empty());
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn a_new_name_that_differs_only_by_case_never_replaces_the_synced_file() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    thesis(&desk);
    desk.write("intro.tex", "synced");
    desk.sync(&store, cloud).await;
    desk.write("Intro.tex", "newcomer");
    let result = desk.sync(&store, cloud).await;
    assert!(result.error.is_none());
    assert_eq!(
        store.read(&file_remote(cloud, "intro.tex")).as_deref(),
        Some(&b"synced"[..])
    );
    assert!(desk
        .project
        .skipped_files
        .iter()
        .any(|file| file.path == "Intro.tex" && file.reason == "duplicateName"));
}

fn remote_paths(store: &MemoryStore, cloud: ProjectId) -> Vec<String> {
    remote_version(store, cloud)
        .files
        .into_iter()
        .map(|record| record.path)
        .collect()
}

fn uploads(allow: bool) -> RoundOptions {
    RoundOptions {
        allow_uploads: allow,
        ..RoundOptions::default()
    }
}

fn planted(store: &MemoryStore, cloud: ProjectId, files: &[(&str, &str)], size: Option<u64>) {
    let mut records = Vec::new();
    for (path, bytes) in files {
        store.overwrite(&file_remote(cloud, path), bytes.as_bytes());
        records.push(serde_json::json!({
            "path": path,
            "hash": oleafly_core::content::ContentHash::digest(bytes.as_bytes()).to_hex(),
            "size": size.unwrap_or(bytes.len() as u64),
        }));
    }
    let version = serde_json::json!({
        "v": 1,
        "project": cloud,
        "name": "Planted",
        "stamp": Stamp::new(Hlc::from_raw(1 << 16), DeviceId::new()),
        "files": records,
    });
    store.overwrite(
        &version_remote(cloud),
        &serde_json::to_vec(&version).unwrap(),
    );
}

#[tokio::test]
async fn a_record_that_lost_files_holds_here_until_you_choose_to_put_them_back() {
    let (store, cloud, _desk, mut laptop) = paired().await;
    let mut version = remote_version(&store, cloud);
    version.files.clear();
    store.overwrite(
        &version_remote(cloud),
        &serde_json::to_vec(&version).unwrap(),
    );
    laptop.project.remote_dirty = true;
    let held = laptop.sync(&store, cloud).await;
    assert!(held.outcome.held);
    assert_eq!(held.outcome.deleted_local, 0);
    assert_eq!(
        laptop.project.hold,
        Some(Hold::RemoteDelete { count: 1, total: 1 })
    );
    assert_eq!(laptop.read("main.tex").as_deref(), Some("one"));
    assert!(laptop.read("project.json").is_some());

    let kept = laptop
        .sync_with(
            &store,
            cloud,
            RoundOptions {
                restore_deleted: true,
                ..uploads(true)
            },
        )
        .await;
    assert_eq!(kept.outcome.deleted_local, 0);
    let paths = remote_paths(&store, cloud);
    assert!(paths.contains(&"main.tex".to_string()), "{paths:?}");
    assert!(paths.contains(&"project.json".to_string()), "{paths:?}");
    assert!(laptop.project.hold.is_none());
}

#[tokio::test]
async fn files_another_computer_removed_go_here_too_once_you_say_so() {
    let (store, cloud, _desk, mut laptop) = paired().await;
    let mut version = remote_version(&store, cloud);
    version.files.retain(|record| record.path == "project.json");
    store.overwrite(
        &version_remote(cloud),
        &serde_json::to_vec(&version).unwrap(),
    );
    laptop.project.remote_dirty = true;
    assert!(laptop.sync(&store, cloud).await.outcome.held);
    let gone = laptop
        .sync_with(
            &store,
            cloud,
            RoundOptions {
                allow_mass_delete: true,
                ..uploads(true)
            },
        )
        .await;
    assert_eq!(gone.outcome.deleted_local, 1);
    assert!(laptop.read("main.tex").is_none());
    assert!(laptop.read("project.json").is_some());
}

#[tokio::test]
async fn a_record_without_project_json_uploads_it_again_instead_of_deleting_it() {
    let (store, cloud, _desk, mut laptop) = paired().await;
    let mut version = remote_version(&store, cloud);
    version.files.retain(|record| record.path != "project.json");
    store.overwrite(
        &version_remote(cloud),
        &serde_json::to_vec(&version).unwrap(),
    );
    laptop.project.remote_dirty = true;
    let result = laptop.sync(&store, cloud).await;
    assert_eq!(result.outcome.deleted_local, 0);
    assert!(laptop.read("project.json").is_some());
    assert!(remote_paths(&store, cloud).contains(&"project.json".to_string()));
}

#[tokio::test]
async fn a_project_json_this_version_cannot_open_never_replaces_a_good_one() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    desk.write(
        "project.json",
        r#"{"name":"Thesis","main_doc":5,"engine":"latexmk"}"#,
    );
    desk.sync(&store, cloud).await;
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    let meta = laptop.read("project.json").unwrap();
    assert!(
        crate::project::parse_project_meta(meta.as_bytes()).is_ok(),
        "{meta}"
    );
}

#[tokio::test]
async fn names_a_case_insensitive_disk_treats_as_one_arrive_only_once() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    planted(
        &store,
        cloud,
        &[
            ("project.json", r#"{"name":"P","main_doc":"main.tex"}"#),
            ("\u{b5}m.tex", "micro sign"),
            ("\u{3bc}m.tex", "greek mu"),
        ],
        None,
    );
    let laptop = Device::new("Laptop");
    let downloaded = download_into(
        &store,
        cloud,
        &laptop.root(),
        &laptop.dir.path().join("staging"),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(downloaded.skipped, 1);
    let names = laptop.names();
    assert_eq!(names.len(), 2, "{names:?}");
}

#[tokio::test]
async fn a_rename_keeps_the_old_name_in_dropbox_until_the_new_one_uploads() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    std::fs::rename(
        desk.root().join("main.tex"),
        desk.root().join("chapter.tex"),
    )
    .unwrap();
    store.with(|inner| inner.rejected.insert(file_remote(cloud, "chapter.tex")));
    desk.sync(&store, cloud).await;
    let paths = remote_paths(&store, cloud);
    assert!(paths.contains(&"main.tex".to_string()), "{paths:?}");
    assert!(!paths.contains(&"chapter.tex".to_string()), "{paths:?}");
    assert!(store.read(&file_remote(cloud, "main.tex")).is_some());
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    assert_eq!(laptop.read("main.tex").as_deref(), Some("one"));

    store.with(|inner| inner.rejected.clear());
    desk.project.remote_dirty = true;
    desk.sync(&store, cloud).await;
    let paths = remote_paths(&store, cloud);
    assert!(paths.contains(&"chapter.tex".to_string()), "{paths:?}");
    assert!(!paths.contains(&"main.tex".to_string()), "{paths:?}");
}

#[tokio::test]
async fn a_rename_waits_whole_while_dropbox_is_full() {
    let (store, cloud, mut desk, _laptop) = paired().await;
    std::fs::rename(
        desk.root().join("main.tex"),
        desk.root().join("chapter.tex"),
    )
    .unwrap();
    let full = desk.sync_with(&store, cloud, uploads(false)).await;
    assert!(full.outcome.quota_hit);
    assert_eq!(full.outcome.deleted_remote, 0);
    assert!(remote_paths(&store, cloud).contains(&"main.tex".to_string()));
    let room = desk.sync_with(&store, cloud, uploads(true)).await;
    assert_eq!(room.outcome.deleted_remote, 1);
    assert!(remote_paths(&store, cloud).contains(&"chapter.tex".to_string()));
}

#[tokio::test]
async fn a_merged_project_json_that_did_not_upload_still_takes_the_next_change_from_elsewhere() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    laptop.write(
        "project.json",
        r#"{"name":"L1","main_doc":"main.tex","engine":"latexmk"}"#,
    );
    laptop.sync(&store, cloud).await;
    desk.write(
        "project.json",
        r##"{"name":"Thesis","main_doc":"main.tex","engine":"latexmk","color":"#336699"}"##,
    );
    store.with(|inner| inner.rejected.insert(file_remote(cloud, "project.json")));
    desk.project.remote_dirty = true;
    desk.sync(&store, cloud).await;
    store.with(|inner| inner.rejected.clear());

    laptop.write(
        "project.json",
        r#"{"name":"L2","main_doc":"main.tex","engine":"latexmk"}"#,
    );
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    desk.project.remote_dirty = true;
    desk.sync(&store, cloud).await;
    let meta: serde_json::Value =
        serde_json::from_str(&desk.read("project.json").unwrap()).unwrap();
    assert_eq!(meta["name"], "L2");
    assert_eq!(meta["color"], "#336699");
}

#[tokio::test]
async fn a_project_json_this_version_cannot_read_keeps_the_folders_it_left_out() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    desk.write(
        "project.json",
        r#"{"name":"T","main_doc":"main.tex","engine":"latexmk","sync_exclude":["data"]}"#,
    );
    desk.write("main.tex", "x");
    desk.write("data/secret.csv", "1,2");
    desk.sync(&store, cloud).await;
    assert!(store.read(&file_remote(cloud, "data/secret.csv")).is_none());
    desk.write("project.json", r#"{"name":"T","sync_exclude":["data"]}"#);
    desk.write("data/more.csv", "3");
    desk.sync(&store, cloud).await;
    assert!(store.read(&file_remote(cloud, "data/secret.csv")).is_none());
    assert!(store.read(&file_remote(cloud, "data/more.csv")).is_none());
}

#[tokio::test]
async fn an_edit_waits_for_its_conflict_copy_to_reach_dropbox() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    desk.write("main.tex", "desk edit");
    laptop.write("main.tex", "laptop edit");
    laptop.sync(&store, cloud).await;
    let copy = format!("main (Laptop {}).tex", today());
    store.with(|inner| inner.rejected.insert(file_remote(cloud, &copy)));
    desk.project.remote_dirty = true;
    desk.sync(&store, cloud).await;
    assert_eq!(desk.read(&copy).as_deref(), Some("laptop edit"));
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    assert_eq!(laptop.read("main.tex").as_deref(), Some("laptop edit"));

    desk.project.remote_dirty = true;
    desk.sync(&store, cloud).await;
    assert_eq!(laptop.read("main.tex").as_deref(), Some("laptop edit"));
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    assert_eq!(laptop.read("main.tex").as_deref(), Some("laptop edit"));

    store.with(|inner| inner.rejected.clear());
    desk.project.remote_dirty = true;
    desk.sync(&store, cloud).await;
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    assert_eq!(laptop.read("main.tex").as_deref(), Some("desk edit"));
    assert_eq!(laptop.read(&copy).as_deref(), Some("laptop edit"));
}

#[tokio::test]
async fn a_stopped_first_backup_says_more_files_are_coming() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    thesis(&desk);
    let flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
    desk.sync_with(
        &store,
        cloud,
        RoundOptions {
            cancel: Some(flag),
            ..uploads(true)
        },
    )
    .await;
    let version = remote_version(&store, cloud);
    assert!(version.files.is_empty());
    assert_eq!(version.pending, Some(2));
}

#[tokio::test]
async fn a_file_that_could_not_be_put_in_place_does_not_hold_back_an_edit_here() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    desk.write("main.tex", "desk edit");
    desk.sync(&store, cloud).await;
    let hash = remote_version(&store, cloud)
        .files
        .into_iter()
        .find(|record| record.path == "main.tex")
        .unwrap()
        .hash;
    laptop.project.failed.insert(
        "main.tex".into(),
        Failure {
            hash,
            at_ms: now_ms(),
            applying: true,
        },
    );
    laptop.write("main.tex", "laptop edit");
    laptop.project.remote_dirty = true;
    let result = laptop.sync(&store, cloud).await;
    assert_eq!(result.outcome.conflicts, 1);
    assert_eq!(
        laptop
            .read(&format!("main (Desk {}).tex", today()))
            .as_deref(),
        Some("desk edit")
    );
}

#[test]
fn waits_after_a_failure_end_on_time_and_when_the_clock_goes_back() {
    let now = now_ms();
    let failure = |at_ms: u64, applying: bool| Failure {
        hash: "h".into(),
        at_ms,
        applying,
    };
    assert!(failure(now - 1_000, false).waiting(now));
    assert!(failure(now - 1_000, true).waiting(now));
    assert!(!failure(now - 6 * 60 * 1000, true).waiting(now));
    assert!(failure(now - 6 * 60 * 1000, false).waiting(now));
    assert!(!failure(now + 60 * 60 * 1000, false).waiting(now));
}

#[tokio::test]
async fn a_conflict_copy_is_named_after_the_computer_that_wrote_that_version() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    let mut office = Device::new("Office");
    office.download(&store, cloud).await;
    desk.write("main.tex", "desk edit");
    desk.sync(&store, cloud).await;
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    laptop.write("notes.md", "unrelated");
    laptop.sync(&store, cloud).await;
    assert_eq!(
        remote_version(&store, cloud).device.as_deref(),
        Some("Laptop")
    );
    office.write("main.tex", "office edit");
    office.project.remote_dirty = true;
    office.sync(&store, cloud).await;
    assert_eq!(
        office
            .read(&format!("main (Desk {}).tex", today()))
            .as_deref(),
        Some("desk edit")
    );
}

#[test]
fn a_computer_name_that_would_hide_the_copy_is_not_used_for_it() {
    assert_eq!(sanitize_label("Laptop"), "Laptop");
    assert_eq!(sanitize_label("conflicted copy"), "conflict");
}

#[tokio::test]
async fn a_git_command_working_in_the_project_puts_the_round_off() {
    let (store, cloud, mut desk, _laptop) = paired().await;
    std::fs::create_dir_all(desk.root().join(".git")).unwrap();
    std::fs::write(desk.root().join(".git/index.lock"), "").unwrap();
    desk.write("main.tex", "half checked out");
    assert!(matches!(
        desk.try_sync(&store, cloud, uploads(true)).await,
        Err(RoundError::Busy)
    ));
    std::fs::remove_file(desk.root().join(".git/index.lock")).unwrap();
    assert_eq!(desk.sync(&store, cloud).await.outcome.uploaded, 1);
}

fn git(root: &std::path::Path, args: &[&str]) -> bool {
    let mut command = std::process::Command::new("git");
    command.arg("-C").arg(root).args(args);
    for (name, _) in std::env::vars() {
        if name.starts_with("GIT_") {
            command.env_remove(name);
        }
    }
    command.output().is_ok_and(|output| output.status.success())
}

#[tokio::test]
async fn a_log_git_tracks_is_backed_up_and_other_build_output_is_not() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    thesis(&desk);
    desk.write("results/run.log", "accuracy 0.93");
    if !git(&desk.root(), &["init", "-q"]) {
        return;
    }
    assert!(git(&desk.root(), &["add", "results/run.log"]));
    desk.sync(&store, cloud).await;
    assert_eq!(
        store
            .read(&file_remote(cloud, "results/run.log"))
            .as_deref(),
        Some(b"accuracy 0.93".as_slice())
    );
    assert!(store.read(&file_remote(cloud, "main.aux")).is_none());
    desk.write("results/run.log", "accuracy 0.95");
    desk.sync(&store, cloud).await;
    assert_eq!(
        store
            .read(&file_remote(cloud, "results/run.log"))
            .as_deref(),
        Some(b"accuracy 0.95".as_slice())
    );
}

#[tokio::test]
async fn python_environments_and_bytecode_caches_stay_home() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Device::new("Desk");
    thesis(&desk);
    desk.write(".venv/lib/site.py", "x");
    desk.write("code/__pycache__/a.cpython-312.pyc", "x");
    desk.write("code/a.py", "print()");
    desk.sync(&store, cloud).await;
    assert!(store.read(&file_remote(cloud, "code/a.py")).is_some());
    assert!(store
        .read(&file_remote(cloud, ".venv/lib/site.py"))
        .is_none());
    assert!(store
        .read(&file_remote(cloud, "code/__pycache__/a.cpython-312.pyc"))
        .is_none());
    assert!(desk
        .project
        .skipped_files
        .iter()
        .any(|file| file.path == ".venv" && file.reason == "packageFolder"));
}

#[tokio::test]
async fn sizes_in_a_hostile_record_never_overflow_the_listing() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    planted(
        &store,
        cloud,
        &[("a.tex", "a"), ("b.tex", "b")],
        Some(u64::MAX),
    );
    let mut cache = BTreeMap::new();
    let listed = list_remote_projects(&store, &BTreeSet::new(), &mut cache)
        .await
        .unwrap();
    assert_eq!(listed[0].size, u64::MAX);
}

#[tokio::test]
async fn files_that_arrive_are_agreed_on_before_the_rest_of_the_round() {
    let (store, cloud, mut desk, mut laptop) = paired().await;
    desk.write("main.tex", "desk edit");
    desk.remove("main.aux");
    desk.sync(&store, cloud).await;
    laptop.saved.lock().unwrap().clear();
    laptop.project.remote_dirty = true;
    laptop.sync(&store, cloud).await;
    let saved = laptop.saved.lock().unwrap().clone();
    let entry = saved
        .iter()
        .find(|(path, _)| path == "main.tex")
        .and_then(|(_, entry)| entry.clone())
        .unwrap();
    assert_eq!(
        entry.hash,
        oleafly_core::content::ContentHash::digest(b"desk edit").to_hex()
    );
}

mod s3_live {
    use super::{file_remote, now_ms, thesis, today, version_remote, Device, ProjectId};
    use crate::cloud::engine::delete_project_folder;
    use crate::cloud::s3::{S3Config, S3Keys, S3Store};
    use crate::cloud::store::{CloudStore, StoreError, WriteMode};

    fn env(name: &str) -> Option<String> {
        std::env::var(format!("OLEAFLY_S3_TEST_{name}"))
            .ok()
            .filter(|value| !value.is_empty())
    }

    fn live_store(folder: &str) -> Option<S3Store> {
        let config = S3Config {
            endpoint: env("ENDPOINT")?,
            region: env("REGION").unwrap_or_default(),
            bucket: env("BUCKET")?,
            prefix: format!("oleafly-test-{}/{folder}", now_ms()),
            path_style: env("PATH_STYLE").is_none_or(|value| value != "0"),
        };
        let keys = S3Keys {
            access_key_id: env("KEY")?,
            secret_access_key: env("SECRET")?,
        };
        Some(S3Store::new(config, keys).unwrap())
    }

    #[tokio::test]
    async fn a_live_bucket_passes_the_probe_and_syncs_edits_conflicts_and_deletes() {
        let Some(store) = live_store("sync") else {
            return;
        };
        store.probe().await.unwrap();
        let cloud = ProjectId::new();
        let mut desk = Device::new("Desk");
        let mut laptop = Device::new("Laptop");
        thesis(&desk);
        let first = desk.sync(&store, cloud).await;
        assert!(first.error.is_none(), "{:?}", first.error);
        assert_eq!(first.outcome.uploaded, 2);
        assert!(store
            .metadata(&file_remote(cloud, "main.aux"))
            .await
            .unwrap()
            .is_none());

        laptop.download(&store, cloud).await;
        assert_eq!(laptop.read("main.tex").as_deref(), Some("one"));
        laptop.write("main.tex", "two from laptop");
        laptop.write("notes/ideas.md", "new");
        laptop.project.remote_dirty = true;
        laptop.sync(&store, cloud).await;
        desk.project.remote_dirty = true;
        let pulled = desk.sync(&store, cloud).await;
        assert!(pulled.error.is_none(), "{:?}", pulled.error);
        assert_eq!(pulled.outcome.downloaded, 2);
        assert_eq!(desk.read("notes/ideas.md").as_deref(), Some("new"));

        desk.write("main.tex", "desk edit");
        laptop.write("main.tex", "laptop edit");
        laptop.sync(&store, cloud).await;
        desk.project.remote_dirty = true;
        let conflicted = desk.sync(&store, cloud).await;
        assert_eq!(conflicted.outcome.conflicts, 1);
        let copy = format!("main (Laptop {}).tex", today());
        assert_eq!(desk.read(&copy).as_deref(), Some("laptop edit"));

        desk.remove("notes/ideas.md");
        desk.sync(&store, cloud).await;
        laptop.project.remote_dirty = true;
        let applied = laptop.sync(&store, cloud).await;
        assert_eq!(applied.outcome.deleted_local, 1);
        assert!(laptop.read("notes/ideas.md").is_none());

        delete_project_folder(&store, cloud).await.unwrap();
        assert!(store
            .metadata(&version_remote(cloud))
            .await
            .unwrap()
            .is_none());
        assert!(store
            .list(&format!("/projects/{cloud}"))
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn a_live_bucket_takes_a_large_file_in_parts_and_returns_it_intact() {
        let Some(store) = live_store("large") else {
            return;
        };
        let cloud = ProjectId::new();
        let mut desk = Device::new("Desk");
        let mut laptop = Device::new("Laptop");
        thesis(&desk);
        let large: String = (0..70 * 1024 * 1024 / 16)
            .map(|index| format!("{index:015x}\n"))
            .collect();
        desk.write("data/large.csv", &large);
        let uploaded = desk.sync(&store, cloud).await;
        assert!(uploaded.error.is_none(), "{:?}", uploaded.error);
        laptop.download(&store, cloud).await;
        assert_eq!(
            laptop.read("data/large.csv").map(|text| text.len()),
            Some(large.len())
        );
        assert!(laptop.read("data/large.csv").as_deref() == Some(large.as_str()));
        delete_project_folder(&store, cloud).await.unwrap();
    }

    #[tokio::test]
    async fn a_live_bucket_refuses_stale_and_duplicate_record_writes() {
        let Some(store) = live_store("cas") else {
            return;
        };
        let first = store
            .put("/record.json", b"one".to_vec(), WriteMode::Add)
            .await
            .unwrap();
        assert_eq!(
            store
                .put("/record.json", b"two".to_vec(), WriteMode::Add)
                .await,
            Err(StoreError::Conflict)
        );
        let second = store
            .put(
                "/record.json",
                b"two".to_vec(),
                WriteMode::Update(first.clone()),
            )
            .await
            .unwrap();
        assert_eq!(
            store
                .put("/record.json", b"three".to_vec(), WriteMode::Update(first))
                .await,
            Err(StoreError::Conflict)
        );
        assert_eq!(
            store.delete("/record.json", Some("\"stale\"")).await,
            Err(StoreError::Conflict)
        );
        store.delete("/record.json", Some(&second)).await.unwrap();
        assert!(store.metadata("/record.json").await.unwrap().is_none());
    }
}

mod drive_fake {
    use super::{thesis, today, version_remote, Device, ProjectId};
    use crate::cloud::engine::delete_project_folder;
    use crate::cloud::store::CloudStore;
    use crate::cloud::tests::fake_drive::FakeDrive;

    #[tokio::test]
    async fn two_computers_share_edits_conflicts_and_deletes_through_drive() {
        let fake = FakeDrive::start().await;
        let desk_store = fake.store();
        let laptop_store = fake.store();
        let cloud = ProjectId::new();
        let mut desk = Device::new("Desk");
        let mut laptop = Device::new("Laptop");
        thesis(&desk);
        let first = desk.sync(&desk_store, cloud).await;
        assert!(first.error.is_none(), "{:?}", first.error);
        assert_eq!(first.outcome.uploaded, 2);

        laptop.download(&laptop_store, cloud).await;
        assert_eq!(laptop.read("main.tex").as_deref(), Some("one"));
        laptop.write("main.tex", "two from laptop");
        laptop.write("notes/ideas.md", "new");
        laptop.project.remote_dirty = true;
        laptop.sync(&laptop_store, cloud).await;
        desk.project.remote_dirty = true;
        let pulled = desk.sync(&desk_store, cloud).await;
        assert!(pulled.error.is_none(), "{:?}", pulled.error);
        assert_eq!(pulled.outcome.downloaded, 2);

        desk.write("main.tex", "desk edit");
        laptop.write("main.tex", "laptop edit");
        laptop.sync(&laptop_store, cloud).await;
        desk.project.remote_dirty = true;
        let conflicted = desk.sync(&desk_store, cloud).await;
        assert_eq!(conflicted.outcome.conflicts, 1);
        let copy = format!("main (Laptop {}).tex", today());
        assert_eq!(desk.read(&copy).as_deref(), Some("laptop edit"));

        desk.remove("notes/ideas.md");
        desk.sync(&desk_store, cloud).await;
        laptop.project.remote_dirty = true;
        let applied = laptop.sync(&laptop_store, cloud).await;
        assert_eq!(applied.outcome.deleted_local, 1);

        delete_project_folder(&desk_store, cloud).await.unwrap();
        assert!(laptop_store
            .metadata(&version_remote(cloud))
            .await
            .unwrap()
            .is_none());
    }
}

mod s3_fake {
    use super::{download_into, now_ms, thesis, today, version_remote, Device, ProjectId};
    use crate::cloud::engine::delete_project_folder;
    use crate::cloud::store::CloudStore;
    use crate::cloud::tests::fake_s3::{FakeS3, Hold};
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::Notify;

    fn copies_of(fake: &FakeS3, cloud: ProjectId, path: &str) -> usize {
        let key = format!("oleafly/projects/{cloud}/files/{path}~");
        fake.with(|bucket| {
            bucket
                .objects
                .keys()
                .filter(|object| object.starts_with(&key))
                .count()
        })
    }

    #[tokio::test]
    async fn a_daily_sweep_removes_old_objects_no_manifest_names_and_keeps_the_rest() {
        let fake = FakeS3::start().await;
        let store = fake.store("oleafly");
        let cloud = ProjectId::new();
        let mut desk = Device::new("Desk");
        thesis(&desk);
        desk.sync(&store, cloud).await;
        assert_eq!(desk.project.swept_ms, 0);

        let hour = 60 * 60 * 1000;
        let now = now_ms();
        let files = format!("oleafly/projects/{cloud}/files/");
        let object = |path: &str, id: u128| format!("{files}{path}~{id:032x}");
        let manifest = format!("oleafly{}", version_remote(cloud));
        let crashed = object("main.tex", 1);
        let young = object("main.tex", 2);
        let after_manifest = object("notes/ideas.md", 3);
        fake.with(|bucket| {
            for key in bucket.objects.keys().cloned().collect::<Vec<_>>() {
                bucket.modified.insert(key, now - 50 * hour);
            }
            bucket.modified.insert(manifest.clone(), now - 48 * hour);
            for (key, age) in [
                (&crashed, 60 * hour),
                (&young, hour / 2),
                (&after_manifest, 30 * hour),
            ] {
                bucket.put(key, b"never published");
                bucket.modified.insert(key.clone(), now - age);
            }
        });
        let present = |key: &str| fake.with(|bucket| bucket.objects.contains_key(key));

        desk.write("main.tex", "two");
        let swept = desk.sync(&store, cloud).await;
        assert!(swept.error.is_none(), "{:?}", swept.error);
        assert!(!present(&crashed));
        assert!(present(&young));
        assert!(present(&after_manifest));
        assert!(desk.project.swept_ms >= now);
        let office = Device::new("Office");
        download_into(
            &fake.store("oleafly"),
            cloud,
            &office.root(),
            &office.dir.path().join("staging"),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(office.read("main.tex").as_deref(), Some("two"));
        assert!(office.read("project.json").is_some());

        let later = object("main.tex", 4);
        fake.with(|bucket| {
            bucket.modified.insert(manifest.clone(), now - 48 * hour);
            bucket.put(&later, b"never published");
            bucket.modified.insert(later.clone(), now - 60 * hour);
        });
        desk.write("main.tex", "three");
        desk.sync(&store, cloud).await;
        assert!(present(&later), "one sweep a day");

        fake.with(|bucket| {
            bucket.modified.insert(manifest.clone(), now - 48 * hour);
        });
        desk.project.swept_ms -= 25 * hour;
        desk.write("main.tex", "four");
        desk.sync(&store, cloud).await;
        assert!(!present(&later));
        assert!(present(&young));
    }

    #[tokio::test]
    async fn a_round_cut_off_before_it_publishes_leaves_every_published_file_readable() {
        let fake = FakeS3::start().await;
        let desk_store = fake.store("oleafly");
        let cloud = ProjectId::new();
        let mut desk = Device::new("Desk");
        thesis(&desk);
        let first = desk.sync(&desk_store, cloud).await;
        assert!(first.error.is_none(), "{:?}", first.error);

        desk.write("main.tex", "desk edit");
        let manifest = format!("PUT oleafly{}", version_remote(cloud));
        fake.with(|bucket| bucket.refused_prefix = Some(manifest));
        let cut_off = desk.sync(&desk_store, cloud).await;
        assert!(cut_off.error.is_some());
        assert_eq!(cut_off.outcome.uploaded, 0);
        fake.with(|bucket| bucket.refused_prefix = None);

        let office = Device::new("Office");
        let downloaded = download_into(
            &fake.store("oleafly"),
            cloud,
            &office.root(),
            &office.dir.path().join("staging"),
        )
        .await;
        assert!(matches!(downloaded, Ok(Some(_))), "{:?}", downloaded.err());
        assert_eq!(office.read("main.tex").as_deref(), Some("one"));

        desk.project.remote_dirty = true;
        let retried = desk.sync(&desk_store, cloud).await;
        assert!(retried.error.is_none(), "{:?}", retried.error);
        assert_eq!(retried.outcome.uploaded, 1);
        assert_eq!(copies_of(&fake, cloud, "main.tex"), 1);
        assert_eq!(copies_of(&fake, cloud, "project.json"), 1);
        assert!(desk.project.unpublished.is_empty());
    }

    #[tokio::test]
    async fn a_round_that_loses_the_race_leaves_the_winners_copy_in_the_bucket() {
        let fake = FakeS3::start().await;
        let desk_store = fake.store("oleafly");
        let laptop_store = fake.store("oleafly");
        let cloud = ProjectId::new();
        let mut desk = Device::new("Desk");
        let mut laptop = Device::new("Laptop");
        thesis(&desk);
        desk.sync(&desk_store, cloud).await;
        laptop.download(&laptop_store, cloud).await;

        desk.write("main.tex", "desk edit");
        laptop.write("main.tex", "laptop edit");
        let key = format!("oleafly/projects/{cloud}/files/main.tex");
        let arrived = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        fake.with(|bucket| {
            bucket.hold = Some(Hold {
                prefix: format!("PUT {key}"),
                arrived: Arc::clone(&arrived),
                release: Arc::clone(&release),
            });
        });
        let (lost, won) = tokio::join!(laptop.sync(&laptop_store, cloud), async {
            tokio::time::timeout(Duration::from_secs(30), arrived.notified())
                .await
                .expect("the laptop's upload never came");
            let won = desk.sync(&desk_store, cloud).await;
            release.notify_one();
            won
        });
        assert!(won.error.is_none(), "{:?}", won.error);
        assert_eq!(lost.outcome.uploaded, 0);
        let office = Device::new("Office");
        download_into(
            &fake.store("oleafly"),
            cloud,
            &office.root(),
            &office.dir.path().join("staging"),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(office.read("main.tex").as_deref(), Some("desk edit"));

        laptop.project.remote_dirty = true;
        let merged = laptop.sync(&laptop_store, cloud).await;
        assert!(merged.error.is_none(), "{:?}", merged.error);
        assert_eq!(merged.outcome.conflicts, 1);
        let copy = format!("main (Desk {}).tex", today());
        assert_eq!(laptop.read(&copy).as_deref(), Some("desk edit"));
        desk.project.remote_dirty = true;
        let pulled = desk.sync(&desk_store, cloud).await;
        assert!(pulled.error.is_none(), "{:?}", pulled.error);
        assert_eq!(desk.read("main.tex").as_deref(), Some("laptop edit"));
        assert_eq!(desk.read(&copy).as_deref(), Some("desk edit"));
    }

    #[tokio::test]
    async fn two_computers_share_edits_conflicts_and_deletes_through_a_bucket() {
        let fake = FakeS3::start().await;
        let desk_store = fake.store("oleafly");
        let laptop_store = fake.store("oleafly");
        let cloud = ProjectId::new();
        let mut desk = Device::new("Desk");
        let mut laptop = Device::new("Laptop");
        thesis(&desk);
        let first = desk.sync(&desk_store, cloud).await;
        assert!(first.error.is_none(), "{:?}", first.error);
        assert_eq!(first.outcome.uploaded, 2);

        laptop.download(&laptop_store, cloud).await;
        assert_eq!(laptop.read("main.tex").as_deref(), Some("one"));
        laptop.write("main.tex", "two from laptop");
        laptop.write("notes/ideas.md", "new");
        laptop.project.remote_dirty = true;
        laptop.sync(&laptop_store, cloud).await;
        desk.project.remote_dirty = true;
        let pulled = desk.sync(&desk_store, cloud).await;
        assert!(pulled.error.is_none(), "{:?}", pulled.error);
        assert_eq!(pulled.outcome.downloaded, 2);

        desk.write("main.tex", "desk edit");
        laptop.write("main.tex", "laptop edit");
        laptop.sync(&laptop_store, cloud).await;
        desk.project.remote_dirty = true;
        let conflicted = desk.sync(&desk_store, cloud).await;
        assert_eq!(conflicted.outcome.conflicts, 1);
        let copy = format!("main (Laptop {}).tex", today());
        assert_eq!(desk.read(&copy).as_deref(), Some("laptop edit"));

        desk.remove("notes/ideas.md");
        desk.sync(&desk_store, cloud).await;
        laptop.project.remote_dirty = true;
        let applied = laptop.sync(&laptop_store, cloud).await;
        assert_eq!(applied.outcome.deleted_local, 1);

        delete_project_folder(&desk_store, cloud).await.unwrap();
        assert!(laptop_store
            .metadata(&version_remote(cloud))
            .await
            .unwrap()
            .is_none());
        assert!(fake.with(|bucket| bucket.objects.is_empty()));
    }
}
