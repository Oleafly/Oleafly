use super::{
    download_into, sync_project, version_remote, RoundEnv, RoundError, RoundOptions, RoundResult,
    SyncContext, Tombstone, VersionManifest,
};
use crate::cloud::memory::MemoryStore;
use crate::cloud::settings::{self, SettingsOutcome, SettingsRound};
use crate::cloud::state::{Hold, ProjectState, SettingsState};
use crate::cloud::store::{CloudStore, StoreError, WriteMode};
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
            remote_rev: Some(downloaded.rev),
            remote_dirty: false,
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
    crate::project_ids::rfc3339_from_unix_ms(super::now_ms())[..10].to_string()
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
        .put(
            &super::tombstone_remote(cloud),
            tombstone,
            WriteMode::Overwrite,
        )
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
            file.rev = None;
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
    version.files.push(super::FileRecord {
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
    let SettingsOutcome::Choose { values, stamp } = choose else {
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
    let listed = super::list_remote_projects(&store, &known).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].cloud, other);
    assert_eq!(listed[0].name, "Grant");
    assert!(listed[0].size > 0);
}
