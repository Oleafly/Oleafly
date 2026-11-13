use crate::cloud::engine::{
    delete_project_folder, download_into, local_date, now_ms, sync_project, tombstone_remote,
    RoundEnv, RoundOptions, RoundResult, SyncContext, Tombstone,
};
use crate::cloud::state::{Hold, ProjectState};
use crate::cloud::store::{CloudStore, DropboxStore, WriteMode};
use crate::cloud::tests::fake_dropbox::{point_at, FakeDropbox};
use crate::cloud::tests::memory::MemoryStore;
use crate::note_links::{LinkKind, NoteLinks};
use crate::project::{ProjectInfo, ProjectMeta};
use oleafly_core::ids::{DeviceId, ProjectId};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

const MASKING: &str = "6f1c2b7e-3d4a-4e5f-9a8b-0c1d2e3f4a5b";
const ENCODER: &str = "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";
const READING: &str = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const METHODS: &str = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const TITLE: &str = "Masking strategy";
const FIGURE: &[u8] =
    b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\x06\0\0\0\x1f\x15\xc4\x89\xff\xfe\0\x80";
const FIGURE_PATH: &str = "assets/loss-curve-1a2b3c4d.png";
const FIGURE_ORIGIN: &str = "assets/origins/loss-curve-1a2b3c4d.png.json";
const FIRST: &str = "The encoder trains on patches with a mask ratio of 0.75.";
const NEXT: &str = "Try a ratio of 0.9.";
const DESK_NOTE: &str = "masking-note";
const LAPTOP_NOTE: &str = "laptop-masking";

struct Computer {
    name: &'static str,
    id: DeviceId,
    data: tempfile::TempDir,
    states: BTreeMap<String, ProjectState>,
    hlc: u64,
}

impl Computer {
    fn new(name: &'static str) -> Self {
        let computer = Self {
            name,
            id: DeviceId::new(),
            data: tempfile::tempdir().unwrap(),
            states: BTreeMap::new(),
            hlc: 0,
        };
        std::fs::create_dir_all(computer.data.path().join("projects")).unwrap();
        computer
    }

    fn root(&self, project: &str) -> PathBuf {
        self.data.path().join("projects").join(project)
    }

    fn path(&self, project: &str, path: &str) -> PathBuf {
        let mut target = self.root(project);
        for part in path.split('/') {
            target.push(part);
        }
        target
    }

    fn write(&self, project: &str, path: &str, bytes: impl AsRef<[u8]>) {
        let target = self.path(project, path);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(target, bytes).unwrap();
    }

    fn read(&self, project: &str, path: &str) -> Option<Vec<u8>> {
        std::fs::read(self.path(project, path)).ok()
    }

    fn text(&self, project: &str, path: &str) -> String {
        std::fs::read_to_string(self.path(project, path))
            .unwrap_or_else(|error| panic!("{path} in {project} on {}: {error}", self.name))
    }

    fn remove(&self, project: &str, path: &str) {
        std::fs::remove_file(self.path(project, path)).unwrap();
    }

    fn meta(&self, project: &str) -> Value {
        serde_json::from_str(&self.text(project, "project.json")).unwrap()
    }

    fn change_meta(&self, project: &str, change: impl FnOnce(&mut ProjectMeta)) {
        let bytes = self.read(project, "project.json").unwrap();
        let mut meta = crate::project::parse_project_meta(&bytes).unwrap();
        change(&mut meta);
        crate::project::write_meta_at(&self.root(project).join("project.json"), &meta).unwrap();
    }

    fn note(&self, project: &str, title: &str, kind: &str, related: Option<&str>, text: &str) {
        std::fs::create_dir_all(self.root(project)).unwrap();
        let mut extra = HashMap::new();
        if let Some(related) = related {
            extra.insert("relatedProject".to_string(), json!(related));
        }
        crate::project::write_meta_at(
            &self.root(project).join("project.json"),
            &ProjectMeta {
                name: title.into(),
                main_doc: "note.md".into(),
                engine: "markdown".into(),
                kind: kind.into(),
                extra,
                ..ProjectMeta::default()
            },
        )
        .unwrap();
        self.write(project, "note.md", text);
    }

    fn masking_note(&self, project: &str, related: Option<&str>) {
        self.note(
            project,
            TITLE,
            "note",
            related,
            &note_text(MASKING, TITLE, "🧪", &masking_body(FIRST, NEXT)),
        );
        self.write(project, FIGURE_PATH, FIGURE);
        self.write(
            project,
            FIGURE_ORIGIN,
            origin_record(FIGURE_PATH, "Loss curve.png"),
        );
    }

    fn paper(&self, project: &str, name: &str) {
        std::fs::create_dir_all(self.root(project)).unwrap();
        crate::project::write_meta_at(
            &self.root(project).join("project.json"),
            &ProjectMeta {
                name: name.into(),
                main_doc: "main.tex".into(),
                engine: "latexmk".into(),
                ..ProjectMeta::default()
            },
        )
        .unwrap();
        self.write(project, "main.tex", format!("\\section{{{name}}}\n"));
    }

    fn env(&self, project: &str) -> RoundEnv {
        RoundEnv {
            root: self.root(project),
            staging: self.data.path().join("cloud-staging"),
            trash: self.data.path().join("cloud-trash"),
            lock_id: None,
            persist_pending: None,
            persist_base: None,
        }
    }

    fn context(&self) -> SyncContext {
        SyncContext {
            device: self.id,
            device_name: self.name.to_string(),
            fallback_name: "Note".into(),
        }
    }

    fn state(&self, project: &str) -> &ProjectState {
        &self.states[project]
    }

    async fn sync<S: CloudStore>(
        &mut self,
        store: &S,
        project: &str,
        cloud: ProjectId,
    ) -> RoundResult {
        self.sync_with(store, project, cloud, uploads()).await
    }

    async fn sync_with<S: CloudStore>(
        &mut self,
        store: &S,
        project: &str,
        cloud: ProjectId,
        options: RoundOptions,
    ) -> RoundResult {
        let previous = self.states.get(project).cloned().unwrap_or_default();
        let result = sync_project(
            store,
            &self.env(project),
            &self.context(),
            cloud,
            &previous,
            self.hlc,
            &options,
        )
        .await
        .unwrap();
        assert!(
            result.error.is_none(),
            "{project} on {}: {:?}",
            self.name,
            result.error
        );
        self.states
            .insert(project.to_string(), result.project.clone());
        self.hlc = self.hlc.max(result.hlc);
        result
    }

    async fn pull<S: CloudStore>(
        &mut self,
        store: &S,
        project: &str,
        cloud: ProjectId,
    ) -> RoundResult {
        self.states
            .entry(project.to_string())
            .or_default()
            .remote_dirty = true;
        self.sync(store, project, cloud).await
    }

    async fn download<S: CloudStore>(&mut self, store: &S, project: &str, cloud: ProjectId) {
        std::fs::create_dir_all(self.root(project)).unwrap();
        let downloaded = download_into(
            store,
            cloud,
            &self.root(project),
            &self.data.path().join("cloud-staging"),
        )
        .await
        .unwrap()
        .unwrap();
        self.states.insert(
            project.to_string(),
            ProjectState {
                cloud: Some(cloud),
                base: downloaded.base,
                remote_rev: (!downloaded.stale).then_some(downloaded.rev),
                remote_dirty: downloaded.stale,
                ..ProjectState::default()
            },
        );
    }

    fn library(&self) -> (Vec<ProjectInfo>, Vec<NoteLinks>) {
        let _env = crate::paths::data_dir_env_lock();
        std::env::set_var("OLEAFLY_DATA_DIR", self.data.path());
        let listed = crate::project::list_projects_blocking();
        let links = crate::note_links::note_links_blocking();
        std::env::remove_var("OLEAFLY_DATA_DIR");
        (listed.unwrap(), links.unwrap())
    }

    fn link_project(&self, note: &str, related: Option<&str>) {
        let _env = crate::paths::data_dir_env_lock();
        std::env::set_var("OLEAFLY_DATA_DIR", self.data.path());
        let linked =
            crate::project::set_note_related_project_blocking(note, related.map(str::to_string));
        std::env::remove_var("OLEAFLY_DATA_DIR");
        linked.unwrap();
    }
}

fn uploads() -> RoundOptions {
    RoundOptions {
        allow_uploads: true,
        ..RoundOptions::default()
    }
}

fn note_text(id: &str, title: &str, icon: &str, body: &str) -> String {
    format!(
        "---\ntitle: {title}\nkind: note\nid: {id}\nicon: {icon}\ncolor: spring\ntags: [ml, vision]\naliases:\n  - MAE\nstatus: draft\nrun: 3\n---\n\n{body}"
    )
}

fn masking_body(first: &str, next: &str) -> String {
    format!(
        "## Where things stand\n\n{first}\n\n## Results\n\nRun 3 reached 64.1%. See [Encoder study](oleafly://note/{ENCODER}).\n\n![Loss curve]({FIGURE_PATH})\n\n## Next\n\n{next}\n"
    )
}

fn origin_record(asset: &str, file_name: &str) -> String {
    serde_json::to_string_pretty(&json!({
        "version": 1,
        "asset": asset,
        "kind": "file",
        "sha256": "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809",
        "copiedAt": 1_762_600_000_000_i64,
        "fileName": file_name,
    }))
    .unwrap()
}

fn listed<'a>(projects: &'a [ProjectInfo], id: &str) -> &'a ProjectInfo {
    projects
        .iter()
        .find(|project| project.id == id)
        .unwrap_or_else(|| panic!("{id} is not in the library"))
}

fn note_id_of(text: &str) -> Option<String> {
    crate::note_links::scan_note(String::new(), String::new(), text).note_id
}

fn note_targets(links: &[NoteLinks], project: &str) -> Vec<String> {
    links
        .iter()
        .find(|note| note.project_id == project)
        .unwrap_or_else(|| panic!("{project} has no links entry"))
        .links
        .iter()
        .filter(|link| link.kind == LinkKind::Note)
        .map(|link| link.id.clone())
        .collect()
}

fn assert_still_the_note(text: &str, id: &str) {
    assert!(crate::project::front_matter_declares_note(text), "{text}");
    assert_eq!(note_id_of(text).as_deref(), Some(id), "{text}");
}

async fn paired_note<S: CloudStore>(
    desk_store: &S,
    laptop_store: &S,
    cloud: ProjectId,
) -> (Computer, Computer) {
    let mut desk = Computer::new("Desk");
    let mut laptop = Computer::new("Laptop");
    desk.masking_note(DESK_NOTE, None);
    assert_eq!(
        desk.sync(desk_store, DESK_NOTE, cloud)
            .await
            .outcome
            .uploaded,
        4
    );
    laptop.download(laptop_store, LAPTOP_NOTE, cloud).await;
    (desk, laptop)
}

async fn a_personal_note_arrives_whole_and_its_links_still_resolve<S: CloudStore>(
    desk_store: &S,
    laptop_store: &S,
) -> Vec<ProjectId> {
    let masking = ProjectId::new();
    let encoder = ProjectId::new();
    let mut desk = Computer::new("Desk");
    let mut laptop = Computer::new("Laptop");
    desk.paper("swift-teal-otter", "Thesis");
    desk.masking_note(DESK_NOTE, Some("swift-teal-otter"));
    desk.note(
        "encoder-note",
        "Encoder study",
        "",
        None,
        &note_text(
            ENCODER,
            "Encoder study",
            "🔬",
            &format!("Builds on [Masking strategy](oleafly://note/{MASKING}).\n"),
        ),
    );
    assert_eq!(
        desk.sync(desk_store, DESK_NOTE, masking)
            .await
            .outcome
            .uploaded,
        4
    );
    assert_eq!(
        desk.sync(desk_store, "encoder-note", encoder)
            .await
            .outcome
            .uploaded,
        2
    );

    laptop.download(laptop_store, LAPTOP_NOTE, masking).await;
    laptop
        .download(laptop_store, "laptop-encoder", encoder)
        .await;
    for path in ["note.md", FIGURE_PATH, FIGURE_ORIGIN] {
        assert_eq!(
            laptop.read(LAPTOP_NOTE, path),
            desk.read(DESK_NOTE, path),
            "{path}"
        );
    }
    assert_eq!(
        laptop.read(LAPTOP_NOTE, FIGURE_PATH).as_deref(),
        Some(FIGURE)
    );
    assert_eq!(
        laptop.read("laptop-encoder", "note.md"),
        desk.read("encoder-note", "note.md")
    );
    let meta = laptop.meta(LAPTOP_NOTE);
    assert_eq!(meta["kind"], "note");
    assert_eq!(meta["name"], TITLE);
    assert_eq!(meta["main_doc"], "note.md");
    assert_eq!(meta["engine"], "markdown");
    assert!(meta.get("relatedProject").is_none(), "{meta}");
    let text = laptop.text(LAPTOP_NOTE, "note.md");
    for line in ["icon: 🧪", "color: spring", "tags: [ml, vision]", "run: 3"] {
        assert!(text.contains(line), "{line}");
    }

    let (projects, links) = laptop.library();
    let masking_note = listed(&projects, LAPTOP_NOTE);
    assert_eq!(masking_note.kind, "note");
    assert_eq!(masking_note.name, TITLE);
    assert_eq!(masking_note.related_project, None);
    let encoder_note = listed(&projects, "laptop-encoder");
    assert_eq!(encoder_note.kind, "note");
    assert_eq!(encoder_note.name, "Encoder study");
    let by_id: BTreeMap<String, String> = links
        .iter()
        .filter_map(|note| Some((note.note_id.clone()?, note.project_id.clone())))
        .collect();
    assert_eq!(by_id.get(MASKING).map(String::as_str), Some(LAPTOP_NOTE));
    assert_eq!(
        by_id.get(ENCODER).map(String::as_str),
        Some("laptop-encoder")
    );
    assert_eq!(note_targets(&links, LAPTOP_NOTE), vec![ENCODER.to_string()]);
    assert_eq!(
        note_targets(&links, "laptop-encoder"),
        vec![MASKING.to_string()]
    );

    assert!(
        laptop
            .sync(laptop_store, LAPTOP_NOTE, masking)
            .await
            .outcome
            .unchanged
    );
    assert!(
        laptop
            .sync(laptop_store, "laptop-encoder", encoder)
            .await
            .outcome
            .unchanged
    );
    vec![masking, encoder]
}

async fn edits_on_both_computers_keep_both_versions_and_the_note_identity<S: CloudStore>(
    desk_store: &S,
    laptop_store: &S,
) -> Vec<ProjectId> {
    let cloud = ProjectId::new();
    let (mut desk, mut laptop) = paired_note(desk_store, laptop_store, cloud).await;
    let date = local_date();

    desk.write(
        DESK_NOTE,
        "note.md",
        note_text(
            MASKING,
            TITLE,
            "🧪",
            &masking_body(
                "The encoder now trains on patches with a mask ratio of 0.8.",
                NEXT,
            ),
        ),
    );
    laptop.write(
        LAPTOP_NOTE,
        "note.md",
        note_text(
            MASKING,
            TITLE,
            "🧪",
            &masking_body(FIRST, "Try a ratio of 0.9, then 0.95 on the larger model."),
        ),
    );
    assert_eq!(
        laptop
            .sync(laptop_store, LAPTOP_NOTE, cloud)
            .await
            .outcome
            .uploaded,
        1
    );
    let met = desk.pull(desk_store, DESK_NOTE, cloud).await;
    assert_eq!(met.outcome.conflicts, 1);
    let copy = format!("note (Laptop {date}).md");
    let kept = desk.text(DESK_NOTE, "note.md");
    assert!(kept.contains("mask ratio of 0.8") && !kept.contains("0.95"));
    let theirs = desk.text(DESK_NOTE, &copy);
    assert!(theirs.contains("0.95") && !theirs.contains("mask ratio of 0.8"));
    assert_eq!(desk.state(DESK_NOTE).conflict_copies, vec![copy.clone()]);

    laptop.pull(laptop_store, LAPTOP_NOTE, cloud).await;
    assert_eq!(laptop.text(LAPTOP_NOTE, "note.md"), kept);
    assert_eq!(laptop.text(LAPTOP_NOTE, &copy), theirs);
    for (computer, project) in [(&desk, DESK_NOTE), (&laptop, LAPTOP_NOTE)] {
        for file in ["note.md", copy.as_str()] {
            assert_still_the_note(&computer.text(project, file), MASKING);
        }
    }

    let desk_text = kept.replacen("icon: 🧪", "icon: 🔬", 1);
    desk.write(DESK_NOTE, "note.md", &desk_text);
    let laptop_text = kept
        .replacen("tags: [ml, vision]", "tags: [ml, vision, ssl]", 1)
        .replacen("run: 3", "run: 4", 1);
    laptop.write(LAPTOP_NOTE, "note.md", &laptop_text);
    laptop.sync(laptop_store, LAPTOP_NOTE, cloud).await;
    assert_eq!(
        desk.pull(desk_store, DESK_NOTE, cloud)
            .await
            .outcome
            .conflicts,
        1
    );
    let second = format!("note (Laptop {date} 2).md");
    assert_eq!(desk.text(DESK_NOTE, "note.md"), desk_text);
    assert_eq!(desk.text(DESK_NOTE, &second), laptop_text);
    laptop.pull(laptop_store, LAPTOP_NOTE, cloud).await;
    assert_eq!(laptop.text(LAPTOP_NOTE, "note.md"), desk_text);
    for (computer, project) in [(&desk, DESK_NOTE), (&laptop, LAPTOP_NOTE)] {
        for file in ["note.md", copy.as_str(), second.as_str()] {
            assert_still_the_note(&computer.text(project, file), MASKING);
        }
    }

    desk.change_meta(DESK_NOTE, |meta| meta.name = "Masking strategy v2".into());
    laptop.change_meta(LAPTOP_NOTE, |meta| {
        meta.dictionary_locale = Some("en-GB".into());
    });
    laptop.sync(laptop_store, LAPTOP_NOTE, cloud).await;
    assert_eq!(
        desk.pull(desk_store, DESK_NOTE, cloud)
            .await
            .outcome
            .conflicts,
        0
    );
    laptop.pull(laptop_store, LAPTOP_NOTE, cloud).await;
    for (computer, project) in [(&desk, DESK_NOTE), (&laptop, LAPTOP_NOTE)] {
        let meta = computer.meta(project);
        assert_eq!(meta["name"], "Masking strategy v2", "{}", computer.name);
        assert_eq!(meta["dictionary_locale"], "en-GB", "{}", computer.name);
        assert_eq!(meta["kind"], "note", "{}", computer.name);
        assert_eq!(meta["main_doc"], "note.md", "{}", computer.name);
        assert!(!computer
            .root(project)
            .read_dir()
            .unwrap()
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().starts_with("project (")));
    }

    let (projects, links) = laptop.library();
    let notes: Vec<&ProjectInfo> = projects
        .iter()
        .filter(|project| project.kind == "note")
        .collect();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].id, LAPTOP_NOTE);
    assert_eq!(notes[0].name, "Masking strategy v2");
    assert_eq!(
        links
            .iter()
            .find(|note| note.project_id == LAPTOP_NOTE)
            .and_then(|note| note.note_id.clone())
            .as_deref(),
        Some(MASKING)
    );
    vec![cloud]
}

async fn deleting_a_note_follows_the_rules_for_deleting_any_project<S: CloudStore>(
    desk_store: &S,
    laptop_store: &S,
) -> Vec<ProjectId> {
    let cloud = ProjectId::new();
    let (mut desk, mut laptop) = paired_note(desk_store, laptop_store, cloud).await;

    desk.remove(DESK_NOTE, FIGURE_PATH);
    desk.remove(DESK_NOTE, FIGURE_ORIGIN);
    assert_eq!(
        desk.sync(desk_store, DESK_NOTE, cloud)
            .await
            .outcome
            .deleted_remote,
        2
    );
    let pulled = laptop.pull(laptop_store, LAPTOP_NOTE, cloud).await;
    assert_eq!(pulled.outcome.deleted_local, 2);
    assert!(!pulled.outcome.held);
    assert!(laptop.read(LAPTOP_NOTE, FIGURE_PATH).is_none());
    assert!(!laptop.root(LAPTOP_NOTE).join("assets").exists());
    let laptop_root = laptop.root(LAPTOP_NOTE).canonicalize().unwrap();
    for path in [FIGURE_PATH, FIGURE_ORIGIN] {
        assert!(
            crate::os_trash::test_support::trashed(&laptop_root.join(path)),
            "{path}"
        );
    }

    desk.remove(DESK_NOTE, "note.md");
    desk.remove(DESK_NOTE, "project.json");
    let held = desk.sync(desk_store, DESK_NOTE, cloud).await;
    assert!(held.outcome.held);
    assert_eq!(
        desk.state(DESK_NOTE).hold,
        Some(Hold::MassDelete { count: 2, total: 2 })
    );
    let restored = desk
        .sync_with(
            desk_store,
            DESK_NOTE,
            cloud,
            RoundOptions {
                restore_deleted: true,
                ..uploads()
            },
        )
        .await;
    assert_eq!(restored.outcome.downloaded, 2);
    assert!(desk.state(DESK_NOTE).hold.is_none());
    assert_still_the_note(&desk.text(DESK_NOTE, "note.md"), MASKING);
    assert_eq!(desk.meta(DESK_NOTE)["kind"], "note");

    desk.remove(DESK_NOTE, "note.md");
    desk.remove(DESK_NOTE, "project.json");
    let emptied = desk
        .sync_with(
            desk_store,
            DESK_NOTE,
            cloud,
            RoundOptions {
                allow_mass_delete: true,
                ..uploads()
            },
        )
        .await;
    assert_eq!(emptied.outcome.deleted_remote, 2);
    let waiting = laptop.pull(laptop_store, LAPTOP_NOTE, cloud).await;
    assert!(waiting.outcome.held);
    assert_eq!(
        laptop.state(LAPTOP_NOTE).hold,
        Some(Hold::RemoteDelete { count: 1, total: 1 })
    );
    assert_still_the_note(&laptop.text(LAPTOP_NOTE, "note.md"), MASKING);

    let tombstone = serde_json::to_vec(&Tombstone {
        device: "Desk".into(),
        at_ms: now_ms(),
    })
    .unwrap();
    desk_store
        .put(&tombstone_remote(cloud), tombstone, WriteMode::Overwrite)
        .await
        .unwrap();
    delete_project_folder(desk_store, cloud).await.unwrap();
    let removed = laptop.pull(laptop_store, LAPTOP_NOTE, cloud).await;
    assert_eq!(removed.outcome.removed_by.as_deref(), Some("Desk"));
    let state = laptop.state(LAPTOP_NOTE);
    assert!(state.paused);
    assert!(state.hold.is_none());
    assert!(state.base.is_empty());
    assert_still_the_note(&laptop.text(LAPTOP_NOTE, "note.md"), MASKING);
    assert_eq!(laptop.meta(LAPTOP_NOTE)["kind"], "note");
    let (projects, _) = laptop.library();
    assert_eq!(listed(&projects, LAPTOP_NOTE).kind, "note");
    vec![cloud]
}

async fn notes_inside_a_project_sync_like_its_other_files<S: CloudStore>(
    desk_store: &S,
    laptop_store: &S,
) -> Vec<ProjectId> {
    let cloud = ProjectId::new();
    let mut desk = Computer::new("Desk");
    let mut laptop = Computer::new("Laptop");
    let plot = "notes/assets/plot-5e6f7a8b.png";
    let plot_origin = "notes/assets/origins/plot-5e6f7a8b.png.json";
    let reading = "notes/Reading list.md";
    let methods = "notes/Methods.md";
    desk.paper("paper", "Thesis");
    desk.write(
        "paper",
        reading,
        note_text(
            READING,
            "Reading list",
            "📚",
            &format!("Start with [Methods](oleafly://note/{METHODS}).\n"),
        ),
    );
    desk.write(
        "paper",
        methods,
        note_text(METHODS, "Methods", "🧪", "Patches of 16 pixels.\n"),
    );
    desk.write("paper", plot, FIGURE);
    desk.write("paper", plot_origin, origin_record(plot, "plot.png"));
    assert_eq!(
        desk.sync(desk_store, "paper", cloud).await.outcome.uploaded,
        6
    );

    laptop.download(laptop_store, "laptop-paper", cloud).await;
    for path in [reading, methods, plot, plot_origin, "main.tex"] {
        assert_eq!(
            laptop.read("laptop-paper", path),
            desk.read("paper", path),
            "{path}"
        );
    }
    let methods_edit = note_text(
        METHODS,
        "Methods",
        "🧪",
        "Patches of 16 pixels, masked at 0.75.\n",
    );
    laptop.write("laptop-paper", methods, &methods_edit);
    let table = "notes/assets/table-9a8b7c6d.csv";
    let table_origin = "notes/assets/origins/table-9a8b7c6d.csv.json";
    laptop.write("laptop-paper", table, "ratio,accuracy\n0.75,64.1\n");
    laptop.write(
        "laptop-paper",
        table_origin,
        origin_record(table, "table.csv"),
    );
    assert_eq!(
        laptop
            .sync(laptop_store, "laptop-paper", cloud)
            .await
            .outcome
            .uploaded,
        3
    );
    assert_eq!(
        desk.pull(desk_store, "paper", cloud)
            .await
            .outcome
            .downloaded,
        3
    );
    assert_eq!(desk.text("paper", methods), methods_edit);
    assert_eq!(
        desk.read("paper", table),
        laptop.read("laptop-paper", table)
    );

    desk.remove("paper", plot);
    desk.remove("paper", plot_origin);
    assert_eq!(
        desk.sync(desk_store, "paper", cloud)
            .await
            .outcome
            .deleted_remote,
        2
    );
    let pulled = laptop.pull(laptop_store, "laptop-paper", cloud).await;
    assert_eq!(pulled.outcome.deleted_local, 2);
    assert!(laptop.read("laptop-paper", plot).is_none());
    assert!(laptop.read("laptop-paper", table).is_some());

    desk.write(
        "paper",
        methods,
        note_text(
            METHODS,
            "Methods",
            "🧪",
            "Patches of 16 pixels, masked at 0.8.\n",
        ),
    );
    laptop.write(
        "laptop-paper",
        methods,
        note_text(
            METHODS,
            "Methods",
            "🧪",
            "Patches of 14 pixels, masked at 0.75.\n",
        ),
    );
    laptop.sync(laptop_store, "laptop-paper", cloud).await;
    assert_eq!(
        desk.pull(desk_store, "paper", cloud)
            .await
            .outcome
            .conflicts,
        1
    );
    let copy = format!("notes/Methods (Laptop {}).md", local_date());
    assert!(desk.text("paper", methods).contains("masked at 0.8"));
    let theirs = desk.text("paper", &copy);
    assert!(theirs.contains("14 pixels"));
    assert_still_the_note(&theirs, METHODS);
    laptop.pull(laptop_store, "laptop-paper", cloud).await;
    assert_eq!(laptop.text("laptop-paper", &copy), theirs);
    assert_eq!(laptop.meta("laptop-paper")["main_doc"], "main.tex");
    vec![cloud]
}

fn dropbox(fake: &FakeDropbox) -> DropboxStore {
    let token = fake.with(|dropbox| dropbox.mint_token());
    let _pointed = point_at(fake.endpoints());
    DropboxStore::new(token, None)
}

macro_rules! through_every_provider {
    ($($scenario:ident),* $(,)?) => {
        mod memory_store {
            $(
                #[tokio::test]
                async fn $scenario() {
                    let store = super::MemoryStore::default();
                    super::$scenario(&store, &store).await;
                }
            )*
        }

        mod dropbox_fake {
            $(
                #[tokio::test]
                async fn $scenario() {
                    let fake = super::FakeDropbox::start().await;
                    super::$scenario(&super::dropbox(&fake), &super::dropbox(&fake)).await;
                }
            )*
        }

        mod drive_fake {
            $(
                #[tokio::test]
                async fn $scenario() {
                    let fake = crate::cloud::tests::fake_drive::FakeDrive::start().await;
                    super::$scenario(&fake.store(), &fake.store()).await;
                }
            )*
        }

        mod s3_fake {
            $(
                #[tokio::test]
                async fn $scenario() {
                    let fake = crate::cloud::tests::fake_s3::FakeS3::start().await;
                    super::$scenario(&fake.store("oleafly"), &fake.store("oleafly")).await;
                }
            )*
        }
    };
}

through_every_provider!(
    a_personal_note_arrives_whole_and_its_links_still_resolve,
    edits_on_both_computers_keep_both_versions_and_the_note_identity,
    deleting_a_note_follows_the_rules_for_deleting_any_project,
    notes_inside_a_project_sync_like_its_other_files,
);

#[tokio::test]
async fn a_notes_linked_project_stays_on_the_computer_that_linked_it() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Computer::new("Desk");
    let mut laptop = Computer::new("Laptop");
    desk.paper("swift-teal-otter", "Thesis");
    laptop.paper("swift-teal-otter", "Grant budget");
    laptop.paper("brave-mint-fox", "Thesis");
    desk.masking_note(DESK_NOTE, Some("swift-teal-otter"));
    desk.sync(&store, DESK_NOTE, cloud).await;

    laptop.download(&store, LAPTOP_NOTE, cloud).await;
    assert!(laptop.meta(LAPTOP_NOTE).get("relatedProject").is_none());
    let (projects, _) = laptop.library();
    assert_eq!(listed(&projects, LAPTOP_NOTE).related_project, None);

    laptop.link_project(LAPTOP_NOTE, Some("brave-mint-fox"));
    assert!(
        laptop
            .sync(&store, LAPTOP_NOTE, cloud)
            .await
            .outcome
            .unchanged
    );
    desk.pull(&store, DESK_NOTE, cloud).await;
    assert_eq!(desk.meta(DESK_NOTE)["relatedProject"], "swift-teal-otter");

    desk.change_meta(DESK_NOTE, |meta| meta.name = "Masking strategy v2".into());
    assert_eq!(
        desk.sync(&store, DESK_NOTE, cloud).await.outcome.uploaded,
        1
    );
    laptop.pull(&store, LAPTOP_NOTE, cloud).await;
    let meta = laptop.meta(LAPTOP_NOTE);
    assert_eq!(meta["name"], "Masking strategy v2");
    assert_eq!(meta["relatedProject"], "brave-mint-fox");

    desk.link_project(DESK_NOTE, None);
    desk.change_meta(DESK_NOTE, |meta| {
        meta.dictionary_locale = Some("en-GB".into());
    });
    laptop.change_meta(LAPTOP_NOTE, |meta| meta.name = "Masking".into());
    laptop.sync(&store, LAPTOP_NOTE, cloud).await;
    assert_eq!(
        desk.pull(&store, DESK_NOTE, cloud).await.outcome.conflicts,
        0
    );
    laptop.pull(&store, LAPTOP_NOTE, cloud).await;
    let desk_meta = desk.meta(DESK_NOTE);
    let laptop_meta = laptop.meta(LAPTOP_NOTE);
    for meta in [&desk_meta, &laptop_meta] {
        assert_eq!(meta["name"], "Masking");
        assert_eq!(meta["dictionary_locale"], "en-GB");
        assert_eq!(meta["kind"], "note");
    }
    assert!(desk_meta.get("relatedProject").is_none());
    assert_eq!(laptop_meta["relatedProject"], "brave-mint-fox");
    let (desk_projects, _) = desk.library();
    assert_eq!(listed(&desk_projects, DESK_NOTE).related_project, None);
    let (laptop_projects, _) = laptop.library();
    assert_eq!(
        listed(&laptop_projects, LAPTOP_NOTE)
            .related_project
            .as_deref(),
        Some("brave-mint-fox")
    );
}

#[tokio::test]
async fn a_note_without_a_kind_in_project_json_still_arrives_as_a_note() {
    let store = MemoryStore::default();
    let cloud = ProjectId::new();
    let mut desk = Computer::new("Desk");
    let mut laptop = Computer::new("Laptop");
    desk.note(
        "joined-note",
        "Shared",
        "",
        None,
        &note_text(MASKING, "Shared", "🧪", "Written with a collaborator.\n"),
    );
    desk.sync(&store, "joined-note", cloud).await;
    laptop.download(&store, "laptop-joined", cloud).await;
    assert_eq!(laptop.meta("laptop-joined")["kind"], "");
    let (projects, links) = laptop.library();
    assert_eq!(listed(&projects, "laptop-joined").kind, "note");
    assert!(
        links
            .iter()
            .any(|note| note.project_id == "laptop-joined"
                && note.note_id.as_deref() == Some(MASKING))
    );
}

mod live_bucket {
    use super::{
        a_personal_note_arrives_whole_and_its_links_still_resolve,
        deleting_a_note_follows_the_rules_for_deleting_any_project,
        edits_on_both_computers_keep_both_versions_and_the_note_identity,
        notes_inside_a_project_sync_like_its_other_files,
    };
    use crate::cloud::engine::{delete_project_folder, now_ms, tombstone_remote};
    use crate::cloud::s3::{S3Config, S3Keys, S3Store};
    use crate::cloud::store::CloudStore;

    fn setting(name: &str) -> Option<String> {
        std::env::var(format!("OLEAFLY_S3_TEST_{name}"))
            .ok()
            .filter(|value| !value.is_empty())
    }

    fn live_store() -> Option<S3Store> {
        let config = S3Config {
            endpoint: setting("ENDPOINT")?,
            region: setting("REGION").unwrap_or_default(),
            bucket: setting("BUCKET")?,
            prefix: format!("oleafly-test-{}/notes", now_ms()),
            path_style: setting("PATH_STYLE").is_none_or(|value| value != "0"),
        };
        let keys = S3Keys {
            access_key_id: setting("KEY")?,
            secret_access_key: setting("SECRET")?,
        };
        Some(S3Store::new(config, keys).unwrap())
    }

    #[tokio::test]
    async fn a_live_bucket_carries_notes_with_assets_edits_conflicts_and_deletes() {
        let Some(store) = live_store() else {
            return;
        };
        store.probe().await.unwrap();
        let mut clouds =
            a_personal_note_arrives_whole_and_its_links_still_resolve(&store, &store).await;
        clouds.extend(
            edits_on_both_computers_keep_both_versions_and_the_note_identity(&store, &store).await,
        );
        clouds.extend(
            deleting_a_note_follows_the_rules_for_deleting_any_project(&store, &store).await,
        );
        clouds.extend(notes_inside_a_project_sync_like_its_other_files(&store, &store).await);
        for cloud in clouds {
            delete_project_folder(&store, cloud).await.unwrap();
            let _ = store.delete(&tombstone_remote(cloud), None).await;
        }
        assert!(store.list("/projects").await.unwrap().is_empty());
    }
}
