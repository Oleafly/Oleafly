use crate::cloud::engine::{
    capture_with, download_into, list_remote_projects, now_ms, sync_project, tombstone_remote,
    version_remote, FileRecord, RoundEnv, RoundError, RoundOptions, RoundResult, SyncContext,
    Tombstone, VersionManifest,
};
use crate::cloud::settings::{self, SettingsOutcome, SettingsRound};
use crate::cloud::state::{Hold, PendingDelete, ProjectState, SettingsState};
use crate::cloud::store::{CloudStore, StoreError, WriteMode};
use crate::cloud::tests::memory::MemoryStore;
use oleafly_core::hlc::{Hlc, Stamp};
use oleafly_core::ids::{DeviceId, ProjectId};
use std::path::PathBuf;

struct Device {
    name: String,
    id: DeviceId,
    dir: tempfile::TempDir,
    project: ProjectState,
    hlc: u64,
}

impl Device {
    fn new(name: &str) -> Self {
        let device = Self {
            name: name.into(),
            id: DeviceId::new(),
            dir: tempfile::tempdir().unwrap(),
            project: ProjectState::default(),
            hlc: 0,
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

    async fn sync(&mut self, store: &MemoryStore, cloud: ProjectId) -> RoundResult {
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

    async fn sync_with(
        &mut self,
        store: &MemoryStore,
        cloud: ProjectId,
        options: RoundOptions,
    ) -> RoundResult {
        self.try_sync(store, cloud, options).await.unwrap()
    }

    async fn try_sync(
        &mut self,
        store: &MemoryStore,
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

    async fn download(&mut self, store: &MemoryStore, cloud: ProjectId) {
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
    crate::project_ids::rfc3339_from_unix_ms(now_ms())[..10].to_string()
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
        "experimentation": {"cloudSync": true}
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
            "main.tex is missing from dropbox".into()
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
    let reused = capture_with(&desk.root(), &base).unwrap();
    assert_eq!(reused.files["main.tex"].hash, fake);
    desk.write("main.tex", "changed");
    let rehashed = capture_with(&desk.root(), &base).unwrap();
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
