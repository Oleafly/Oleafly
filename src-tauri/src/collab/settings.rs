use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, PoisonError};

use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::settings::{Setting, Settings};
use oleafly_collab::sync::SharedLive;
use oleafly_collab::{load_binding, write_atomic, CollabError, CollabPaths};
use oleafly_collab_protocol::ids::AccountId;
use oleafly_collab_protocol::projects::ProjectRole;
use serde::{Deserialize, Serialize};

use crate::project::ProjectMeta;
use crate::typst_options::TypstOptionsUpdate;

pub const LIVE_SETTINGS_EVENT: &str = "collab-live-settings";
const BASE_FILE: &str = "compile-settings.json";
const MAX_NAME_CHARS: usize = 64;
const LATEXMK: &str = "latexmk";

static TURN: LazyLock<Mutex<()>> = LazyLock::new(Mutex::default);

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Base {
    #[serde(default)]
    pub shared: Settings,
    #[serde(default)]
    pub local: Settings,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SettingNotice {
    MainDocument {
        path: String,
    },
    Compiler {
        engine: String,
        flavor: Option<String>,
    },
    SpellingLanguage {
        locale: Option<String>,
    },
    TypstVersion {
        version: Option<String>,
    },
    TypstOptions,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsChangedPayload {
    pub project_id: String,
    pub account_id: Option<AccountId>,
    pub changes: Vec<SettingNotice>,
}

#[derive(Debug, Default)]
pub struct Followed {
    pub changed: BTreeSet<Setting>,
    pub announced: Vec<(Option<AccountId>, Setting)>,
    pub pushed: bool,
    pub base: Base,
}

pub struct Applied {
    pub project_id: String,
    pub meta: Option<ProjectMeta>,
    pub notices: Vec<SettingsChangedPayload>,
    pub pushed: bool,
}

pub fn base_file_in(dir: &Path) -> PathBuf {
    dir.join(BASE_FILE)
}

pub fn base_file(paths: &CollabPaths, project_id: &str) -> Result<PathBuf, CollabError> {
    Ok(base_file_in(&paths.project_dir(project_id)?))
}

pub fn remember(file: &Path, base: &Base) -> Result<(), CollabError> {
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|error| CollabError::Io(error.to_string()))?;
    }
    let bytes =
        serde_json::to_vec_pretty(base).map_err(|error| CollabError::Corrupt(error.to_string()))?;
    write_atomic(file, &bytes)
}

fn recall(file: &Path) -> Option<Base> {
    serde_json::from_slice(&std::fs::read(file).ok()?).ok()
}

fn json<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

fn portable_path(path: &str) -> Option<String> {
    let trimmed = path.trim().replace('\\', "/");
    let relative = Path::new(&trimmed);
    let inside = !trimmed.is_empty()
        && !relative.has_root()
        && !trimmed.contains(':')
        && relative.components().all(|component| {
            matches!(
                component,
                std::path::Component::Normal(_) | std::path::Component::CurDir
            )
        });
    inside.then_some(trimmed)
}

fn plain_name(value: &str, extra: &[char]) -> bool {
    !value.is_empty()
        && value.chars().count() <= MAX_NAME_CHARS
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || extra.contains(&character))
}

pub fn shared_of(meta: &ProjectMeta, main_id: Option<&str>) -> Settings {
    let typst = meta.typst.clone().unwrap_or_default();
    let fonts: Vec<String> = typst
        .font_paths
        .iter()
        .filter_map(|path| portable_path(path))
        .collect();
    let variants: BTreeMap<&String, &BTreeMap<String, String>> = typst
        .variants
        .iter()
        .map(|(name, variant)| (name, &variant.inputs))
        .collect();
    let mut settings = Settings::new();
    if let Some(id) = main_id {
        settings.insert(Setting::MainDoc, id.to_owned());
    }
    settings.insert(Setting::Engine, meta.engine.clone());
    settings.insert(
        Setting::TexFlavor,
        meta.tex_flavor.clone().unwrap_or_default(),
    );
    settings.insert(
        Setting::DictionaryLocale,
        meta.dictionary_locale.clone().unwrap_or_default(),
    );
    settings.insert(
        Setting::TypstVersion,
        meta.typst_version_pin().unwrap_or_default().to_owned(),
    );
    settings.insert(
        Setting::TypstVendorPackages,
        typst.vendor_packages.to_string(),
    );
    settings.insert(Setting::TypstSystemFonts, typst.system_fonts.to_string());
    settings.insert(Setting::TypstReproducible, typst.reproducible.to_string());
    settings.insert(Setting::TypstFontPaths, json(&fonts));
    settings.insert(Setting::TypstInputs, json(&typst.inputs));
    settings.insert(Setting::TypstVariants, json(&variants));
    settings
}

fn flag(shared: &Settings, setting: Setting) -> Option<bool> {
    match shared.get(&setting).map(String::as_str) {
        Some("true") => Some(true),
        Some("false") => Some(false),
        _ => None,
    }
}

fn parsed<T: serde::de::DeserializeOwned>(shared: &Settings, setting: Setting) -> Option<T> {
    serde_json::from_str(shared.get(&setting)?).ok()
}

fn adopt_typst(meta: &mut ProjectMeta, shared: &Settings) {
    let mut spec = meta.typst.clone().unwrap_or_default();
    if let Some(version) = shared.get(&Setting::TypstVersion) {
        let version = version.trim();
        if version.is_empty() {
            spec.version = None;
        } else if plain_name(version, &['.', '-', '+']) {
            spec.version = Some(version.to_owned());
        }
    }
    if let Some(vendor) = flag(shared, Setting::TypstVendorPackages) {
        spec.vendor_packages = vendor;
    }
    let fonts = parsed::<Vec<String>>(shared, Setting::TypstFontPaths).map(|paths| {
        paths
            .iter()
            .filter_map(|path| portable_path(path))
            .collect::<Vec<String>>()
    });
    let updates = [
        TypstOptionsUpdate {
            system_fonts: flag(shared, Setting::TypstSystemFonts),
            reproducible: flag(shared, Setting::TypstReproducible),
            ..TypstOptionsUpdate::default()
        },
        TypstOptionsUpdate {
            font_paths: fonts,
            ..TypstOptionsUpdate::default()
        },
        TypstOptionsUpdate {
            inputs: parsed(shared, Setting::TypstInputs),
            ..TypstOptionsUpdate::default()
        },
        TypstOptionsUpdate {
            variants: parsed(shared, Setting::TypstVariants),
            ..TypstOptionsUpdate::default()
        },
    ];
    for update in updates {
        let mut next = spec.clone();
        if update.apply(&mut next).is_ok() {
            spec = next;
        }
    }
    meta.typst = (!spec.is_empty()).then_some(spec);
}

fn locale(value: &str) -> Option<Option<String>> {
    let value = value.trim();
    if value.is_empty() {
        return Some(None);
    }
    plain_name(value, &['_', '-']).then(|| Some(value.to_owned()))
}

fn differences(before: &ProjectMeta, after: &ProjectMeta) -> BTreeSet<Setting> {
    let was = shared_of(before, None);
    let now = shared_of(after, None);
    let mut changed: BTreeSet<Setting> = Setting::ALL
        .into_iter()
        .filter(|setting| was.get(setting) != now.get(setting))
        .collect();
    if before.main_doc != after.main_doc {
        changed.insert(Setting::MainDoc);
    }
    changed
}

pub fn adopt(
    meta: &mut ProjectMeta,
    shared: &Settings,
    main_path: Option<&str>,
) -> BTreeSet<Setting> {
    let before = meta.clone();
    if let Some(path) = main_path {
        meta.main_doc = path.to_owned();
    }
    let wanted = shared
        .get(&Setting::Engine)
        .cloned()
        .unwrap_or_else(|| before.engine.clone());
    meta.engine = crate::project::engine_for_main_document(&wanted, &meta.main_doc)
        .or_else(|_| crate::project::engine_for_main_document(&before.engine, &meta.main_doc))
        .unwrap_or_else(|_| before.engine.clone());
    let flavor = shared
        .get(&Setting::TexFlavor)
        .map(String::as_str)
        .or(before.tex_flavor.as_deref());
    meta.tex_flavor = crate::project::validate_tex_flavor(&meta.engine, flavor)
        .ok()
        .flatten();
    if let Some(next) = shared
        .get(&Setting::DictionaryLocale)
        .and_then(|value| locale(value))
    {
        meta.dictionary_locale = next;
    }
    adopt_typst(meta, shared);
    if meta.engine != LATEXMK {
        meta.allow_shell_escape = false;
    }
    differences(&before, meta)
}

fn file_at(layout: &Layout, path: &str) -> Option<String> {
    layout
        .iter()
        .find(|(_, placed)| placed.kind != NodeKind::Dir && placed.path == path)
        .map(|(id, _)| id.clone())
}

fn path_of(layout: &Layout, id: &str) -> Option<String> {
    layout
        .get(id)
        .filter(|placed| placed.kind != NodeKind::Dir)
        .map(|placed| placed.path.clone())
}

fn on_disk(root: &Path, path: &str) -> bool {
    super::disk::safe_target(root, path).is_some_and(|target| target.is_file())
}

pub fn seed(doc: &mut ProjectDoc, meta: &ProjectMeta) -> Result<Base, CollabError> {
    let layout = materialize::layout(&doc.nodes()?);
    let settings = shared_of(meta, file_at(&layout, &meta.main_doc).as_deref());
    doc.set_settings(&settings)?;
    let shared = doc.settings();
    Ok(Base {
        local: shared.clone(),
        shared,
    })
}

pub fn joined(doc: &ProjectDoc, meta: &mut ProjectMeta) -> Result<Base, CollabError> {
    let layout = materialize::layout(&doc.nodes()?);
    let shared = doc.settings();
    if shared.is_empty() {
        if let Some(main) = doc.meta("main_doc").filter(|main| !main.is_empty()) {
            meta.main_doc = main;
        }
        if let Some(engine) = doc.meta("engine").filter(|engine| !engine.is_empty()) {
            meta.engine = engine;
        }
    } else {
        let main = shared
            .get(&Setting::MainDoc)
            .and_then(|id| path_of(&layout, id));
        adopt(meta, &shared, main.as_deref());
    }
    meta.allow_shell_escape = false;
    let local = shared_of(meta, file_at(&layout, &meta.main_doc).as_deref());
    Ok(Base { shared, local })
}

pub fn follow(
    live: &mut LiveProject,
    meta: &mut ProjectMeta,
    base: Option<&Base>,
    root: &Path,
    me: Option<AccountId>,
) -> Result<Followed, CollabError> {
    let layout = materialize::layout(&live.doc().nodes()?);
    let shared = live.doc().settings();
    let local = shared_of(meta, file_at(&layout, &meta.main_doc).as_deref());
    let can_edit = live.can_edit();
    let seeds = can_edit && live.role() == ProjectRole::Owner;
    let mut take = Settings::new();
    let mut push = Settings::new();
    let mut remote = BTreeSet::new();
    for setting in Setting::ALL {
        let ours = local.get(&setting);
        let theirs = shared.get(&setting);
        let Some(base) = base else {
            match (theirs, ours) {
                (Some(theirs), _) => {
                    take.insert(setting, theirs.clone());
                }
                (None, Some(ours)) if seeds => {
                    push.insert(setting, ours.clone());
                }
                _ => {}
            }
            continue;
        };
        let moved_there = theirs.is_some() && theirs != base.shared.get(&setting);
        let moved_here = ours.is_some() && ours != base.local.get(&setting) && ours != theirs;
        match (theirs, ours) {
            (Some(theirs), _) if moved_there => {
                take.insert(setting, theirs.clone());
                remote.insert(setting);
            }
            (_, Some(ours)) if moved_here && can_edit => {
                push.insert(setting, ours.clone());
            }
            (Some(theirs), Some(_)) if moved_here => {
                take.insert(setting, theirs.clone());
            }
            (None, Some(ours)) if seeds => {
                push.insert(setting, ours.clone());
            }
            _ => {}
        }
    }
    let mut deferred = false;
    let mut main_path = None;
    if let Some(id) = take.get(&Setting::MainDoc) {
        main_path = path_of(&layout, id);
        if main_path.is_none() {
            take.remove(&Setting::MainDoc);
            deferred = true;
        }
    }
    let mut changed = BTreeSet::new();
    if !take.is_empty() {
        changed = adopt(meta, &take, main_path.as_deref());
    }
    if !take.contains_key(&Setting::MainDoc) {
        let renamed = shared
            .get(&Setting::MainDoc)
            .and_then(|id| path_of(&layout, id))
            .filter(|path| {
                *path != meta.main_doc
                    && file_at(&layout, &meta.main_doc).is_none()
                    && !on_disk(root, &meta.main_doc)
                    && on_disk(root, path)
            });
        if let Some(path) = renamed {
            changed.extend(adopt(meta, &Settings::new(), Some(&path)));
        }
    }
    let pushed = can_edit && !push.is_empty() && live.doc_mut().set_settings(&push)?;
    let mut announced = Vec::new();
    if let Some(base) = base {
        let own_peer = live.doc().peer_id();
        for setting in take.keys().filter(|setting| remote.contains(*setting)) {
            if !changed.contains(setting) || !base.shared.contains_key(setting) {
                continue;
            }
            if live.doc().setting_writer(*setting) == Some(own_peer) {
                continue;
            }
            let author = live.doc().setting_author(*setting);
            if author.is_some() && author == me {
                continue;
            }
            announced.push((author, *setting));
        }
    }
    let mut next_shared = live.doc().settings();
    if deferred {
        match base.and_then(|base| base.shared.get(&Setting::MainDoc)) {
            Some(previous) => {
                next_shared.insert(Setting::MainDoc, previous.clone());
            }
            None => {
                next_shared.remove(&Setting::MainDoc);
            }
        }
    }
    Ok(Followed {
        changed,
        announced,
        pushed,
        base: Base {
            shared: next_shared,
            local: shared_of(meta, file_at(&layout, &meta.main_doc).as_deref()),
        },
    })
}

fn notice(meta: &ProjectMeta, setting: Setting) -> SettingNotice {
    match setting {
        Setting::MainDoc => SettingNotice::MainDocument {
            path: meta.main_doc.clone(),
        },
        Setting::Engine | Setting::TexFlavor => SettingNotice::Compiler {
            engine: meta.engine.clone(),
            flavor: meta.tex_flavor.clone(),
        },
        Setting::DictionaryLocale => SettingNotice::SpellingLanguage {
            locale: meta.dictionary_locale.clone(),
        },
        Setting::TypstVersion => SettingNotice::TypstVersion {
            version: meta.typst_version_pin().map(str::to_owned),
        },
        Setting::TypstVendorPackages
        | Setting::TypstSystemFonts
        | Setting::TypstReproducible
        | Setting::TypstFontPaths
        | Setting::TypstInputs
        | Setting::TypstVariants => SettingNotice::TypstOptions,
    }
}

fn notices(
    project_id: &str,
    meta: &ProjectMeta,
    announced: &[(Option<AccountId>, Setting)],
) -> Vec<SettingsChangedPayload> {
    let mut payloads: Vec<SettingsChangedPayload> = Vec::new();
    for (author, setting) in announced {
        let change = notice(meta, *setting);
        let index = match payloads
            .iter()
            .position(|payload| payload.account_id == *author)
        {
            Some(index) => index,
            None => {
                payloads.push(SettingsChangedPayload {
                    project_id: project_id.to_owned(),
                    account_id: *author,
                    changes: Vec::new(),
                });
                payloads.len() - 1
            }
        };
        if !payloads[index].changes.contains(&change) {
            payloads[index].changes.push(change);
        }
    }
    for payload in &mut payloads {
        let moved_main = payload
            .changes
            .iter()
            .any(|change| matches!(change, SettingNotice::MainDocument { .. }));
        payload.changes.retain(|change| {
            !(moved_main
                && matches!(change, SettingNotice::Compiler { engine, .. } if engine == "typst" || engine == "markdown"))
        });
    }
    payloads
}

pub fn follow_project(
    project_id: &str,
    live: &SharedLive,
    root: &Path,
    base_file: &Path,
    me: Option<AccountId>,
) -> Result<Applied, String> {
    let _turn = TURN.lock().unwrap_or_else(PoisonError::into_inner);
    let base = recall(base_file);
    let (followed, meta) = crate::project::follow_shared_settings(project_id, |meta| {
        let mut live = live.lock().unwrap_or_else(PoisonError::into_inner);
        let followed =
            follow(&mut live, meta, base.as_ref(), root, me).map_err(|error| error.to_string())?;
        let changed = !followed.changed.is_empty();
        Ok((followed, changed))
    })?;
    if base.as_ref() != Some(&followed.base) {
        remember(base_file, &followed.base).map_err(|error| error.to_string())?;
    }
    let notices = meta
        .as_ref()
        .map(|meta| notices(project_id, meta, &followed.announced))
        .unwrap_or_default();
    Ok(Applied {
        project_id: project_id.to_owned(),
        meta,
        notices,
        pushed: followed.pushed,
    })
}

fn role_of(project_id: &str) -> Option<ProjectRole> {
    if let Some(role) = super::live::read_live(project_id, LiveProject::role) {
        return Some(role);
    }
    let paths = CollabPaths::new(crate::paths::collab_root().ok()?);
    load_binding(&paths, project_id)
        .ok()
        .flatten()
        .map(|binding| binding.role)
}

pub fn refuse_viewer(project_id: &str) -> Result<(), String> {
    if !super::registry::is_shared(project_id) {
        return Ok(());
    }
    match role_of(project_id) {
        Some(ProjectRole::Viewer) => {
            Err(crate::app_error::AppError::new("project.shared_settings_viewer").into())
        }
        _ => Ok(()),
    }
}

pub fn local_changed(project_id: &str) {
    if let Some(active) = super::live::active_for(project_id) {
        active.follow_settings();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collab::testing::TempLibrary;
    use oleafly_collab::doc::NodeKind;
    use oleafly_collab::materialize;
    use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};
    use oleafly_collab_protocol::projects::ProjectRole;
    use std::sync::{Arc, Mutex};

    fn meta(main: &str, engine: &str) -> ProjectMeta {
        ProjectMeta {
            name: "Paper".into(),
            main_doc: main.into(),
            engine: engine.into(),
            ..ProjectMeta::default()
        }
    }

    fn id_of(doc: &ProjectDoc, path: &str) -> String {
        materialize::layout(&doc.nodes().unwrap())
            .into_iter()
            .find(|(_, placed)| placed.path == path)
            .map(|(id, _)| id)
            .unwrap_or_else(|| panic!("{path} is not shared"))
    }

    fn document(files: &[&str]) -> ProjectDoc {
        let mut doc = ProjectDoc::create().unwrap();
        let mut dirs: BTreeMap<String, String> = BTreeMap::new();
        for path in files {
            let mut parent: Option<String> = None;
            let segments: Vec<&str> = path.split('/').collect();
            for depth in 0..segments.len() - 1 {
                let dir = segments[..=depth].join("/");
                let id = match dirs.get(&dir) {
                    Some(id) => id.clone(),
                    None => {
                        let id = doc
                            .add_node(parent.as_deref(), segments[depth], NodeKind::Dir, None, "")
                            .unwrap();
                        dirs.insert(dir, id.clone());
                        id
                    }
                };
                parent = Some(id);
            }
            doc.add_node(
                parent.as_deref(),
                segments[segments.len() - 1],
                NodeKind::Text,
                None,
                "x\n",
            )
            .unwrap();
        }
        doc
    }

    fn typst_spec() -> oleafly_core::TypstSpec {
        oleafly_core::TypstSpec {
            version: Some("0.13.1".into()),
            system_fonts: false,
            reproducible: true,
            font_paths: vec!["fonts".into(), "/Library/Fonts".into(), "../outside".into()],
            inputs: [("draft".to_owned(), "true".to_owned())]
                .into_iter()
                .collect(),
            variants: [(
                "camera".to_owned(),
                oleafly_core::TypstVariant {
                    inputs: [("draft".to_owned(), "false".to_owned())]
                        .into_iter()
                        .collect(),
                    extra: Default::default(),
                },
            )]
            .into_iter()
            .collect(),
            ..oleafly_core::TypstSpec::default()
        }
    }

    struct Bob {
        project_id: String,
        root: PathBuf,
        live: SharedLive,
        base_file: PathBuf,
        account: AccountId,
        _scratch: tempfile::TempDir,
    }

    impl Bob {
        fn follow(&self) -> Applied {
            follow_project(
                &self.project_id,
                &self.live,
                &self.root,
                &self.base_file,
                Some(self.account),
            )
            .unwrap()
        }

        fn meta(&self) -> ProjectMeta {
            crate::project::read_meta(&self.project_id).unwrap()
        }

        fn settings(&self) -> Settings {
            self.live.lock().unwrap().doc().settings()
        }
    }

    struct Alice {
        live: LiveProject,
        account: AccountId,
        seq: u64,
    }

    impl Alice {
        fn change(&mut self, entries: &[(Setting, &str)]) {
            let settings: Settings = entries
                .iter()
                .map(|(setting, value)| (*setting, (*value).to_owned()))
                .collect();
            self.live.doc_mut().set_settings(&settings).unwrap();
        }

        fn send(&mut self, bob: &Bob) {
            let since = bob.live.lock().unwrap().doc().version();
            let payload = self.live.doc().export_since(&since).unwrap();
            self.seq += 1;
            bob.live
                .lock()
                .unwrap()
                .import_update_from(self.seq, &payload, Some(self.account))
                .unwrap();
        }

        fn hear(&mut self, bob: &Bob) {
            let payload = bob
                .live
                .lock()
                .unwrap()
                .doc()
                .export_since(&self.live.doc().version())
                .unwrap();
            self.seq += 1;
            self.live
                .import_update_from(self.seq, &payload, Some(bob.account))
                .unwrap();
        }
    }

    fn join(
        library: &TempLibrary,
        project_id: &str,
        files: &[&str],
        doc: &ProjectDoc,
        role: ProjectRole,
    ) -> Bob {
        let contents: Vec<(&str, &str)> = files.iter().map(|path| (*path, "x\n")).collect();
        let root = library.project(project_id, &contents);
        let copy = ProjectDoc::load(&doc.snapshot().unwrap()).unwrap();
        let mut local = meta("main.tex", "xetex");
        let base = joined(&copy, &mut local).unwrap();
        crate::project::write_meta(project_id, &local).unwrap();
        let scratch = tempfile::tempdir().unwrap();
        let base_file = scratch.path().join(BASE_FILE);
        remember(&base_file, &base).unwrap();
        Bob {
            project_id: project_id.to_owned(),
            root,
            live: Arc::new(Mutex::new(LiveProject::new(copy, 0, role))),
            base_file,
            account: AccountId::new_v7(),
            _scratch: scratch,
        }
    }

    fn alice(doc: &ProjectDoc) -> Alice {
        Alice {
            live: LiveProject::new(
                ProjectDoc::load(&doc.snapshot().unwrap()).unwrap(),
                0,
                ProjectRole::Owner,
            ),
            account: AccountId::new_v7(),
            seq: 0,
        }
    }

    fn seeded(files: &[&str], owner: &ProjectMeta) -> ProjectDoc {
        let mut doc = document(files);
        seed(&mut doc, owner).unwrap();
        doc
    }

    #[test]
    fn sharing_seeds_every_portable_compile_setting_and_never_shell_escape() {
        let mut doc = document(&["main.tex", "chapters/intro.tex"]);
        let mut owner = meta("main.tex", "latexmk");
        owner.tex_flavor = Some("xelatex".into());
        owner.dictionary_locale = Some("en_GB".into());
        owner.allow_shell_escape = true;
        owner.typst = Some(typst_spec());
        owner.color = "#ff0000".into();
        owner.hidden = true;
        owner.forked_from = Some("elsewhere".into());
        let base = seed(&mut doc, &owner).unwrap();
        let expected: Settings = [
            (Setting::MainDoc, id_of(&doc, "main.tex")),
            (Setting::Engine, "latexmk".to_owned()),
            (Setting::TexFlavor, "xelatex".to_owned()),
            (Setting::DictionaryLocale, "en_GB".to_owned()),
            (Setting::TypstVersion, "0.13.1".to_owned()),
            (Setting::TypstVendorPackages, "false".to_owned()),
            (Setting::TypstSystemFonts, "false".to_owned()),
            (Setting::TypstReproducible, "true".to_owned()),
            (Setting::TypstFontPaths, r#"["fonts"]"#.to_owned()),
            (Setting::TypstInputs, r#"{"draft":"true"}"#.to_owned()),
            (
                Setting::TypstVariants,
                r#"{"camera":{"draft":"false"}}"#.to_owned(),
            ),
        ]
        .into_iter()
        .collect();
        assert_eq!(doc.settings(), expected);
        assert_eq!(base.shared, expected);
        assert_eq!(base.local, expected);
    }

    #[test]
    fn joining_adopts_the_shared_settings_with_the_main_file_at_its_path_here() {
        let mut owner = meta("chapters/thesis.tex", "latexmk");
        owner.tex_flavor = Some("lualatex".into());
        owner.dictionary_locale = Some("de_DE".into());
        owner.typst = Some(typst_spec());
        let doc = seeded(&["main.tex", "chapters/thesis.tex"], &owner);
        let mut here = meta("main.tex", "xetex");
        here.color = "#00ff00".into();
        here.hidden = true;
        let base = joined(&doc, &mut here).unwrap();
        assert_eq!(here.main_doc, "chapters/thesis.tex");
        assert_eq!(here.engine, "latexmk");
        assert_eq!(here.tex_flavor.as_deref(), Some("lualatex"));
        assert_eq!(here.dictionary_locale.as_deref(), Some("de_DE"));
        let typst = here.typst.clone().unwrap();
        assert_eq!(typst.version.as_deref(), Some("0.13.1"));
        assert!(!typst.system_fonts);
        assert!(typst.reproducible);
        assert_eq!(typst.font_paths, vec!["fonts".to_owned()]);
        assert_eq!(typst.inputs["draft"], "true");
        assert_eq!(typst.variants["camera"].inputs["draft"], "false");
        assert!(!here.allow_shell_escape);
        assert_eq!(here.color, "#00ff00");
        assert!(here.hidden);
        assert_eq!(base.shared, doc.settings());
        assert_eq!(base.local, doc.settings());

        let mut legacy = document(&["main.tex", "paper.tex"]);
        legacy.set_meta("main_doc", "paper.tex").unwrap();
        legacy.set_meta("engine", "latexmk").unwrap();
        let mut older = meta("main.tex", "xetex");
        let base = joined(&legacy, &mut older).unwrap();
        assert_eq!(older.main_doc, "paper.tex");
        assert_eq!(older.engine, "latexmk");
        assert!(base.shared.is_empty());
    }

    #[test]
    fn a_remote_compile_change_updates_project_json_and_the_engine_descriptor() {
        let library = TempLibrary::new();
        let files = ["main.tex", "intro.tex"];
        let doc = seeded(&files, &meta("main.tex", "xetex"));
        let mut alice = alice(&doc);
        let bob = join(&library, "bob-remote", &files, &doc, ProjectRole::Editor);
        assert!(bob.follow().meta.is_none());
        let intro = id_of(alice.live.doc(), "intro.tex");
        alice.change(&[
            (Setting::MainDoc, &intro),
            (Setting::Engine, "latexmk"),
            (Setting::TexFlavor, "xelatex"),
            (Setting::DictionaryLocale, "fr_FR"),
        ]);
        alice.send(&bob);
        let applied = bob.follow();
        let written = applied
            .meta
            .expect("project.json follows the shared settings");
        assert_eq!(written.main_doc, "intro.tex");
        let on_disk = bob.meta();
        assert_eq!(on_disk.main_doc, "intro.tex");
        assert_eq!(on_disk.engine, "latexmk");
        assert_eq!(on_disk.tex_flavor.as_deref(), Some("xelatex"));
        assert_eq!(on_disk.dictionary_locale.as_deref(), Some("fr_FR"));
        let engine = crate::project::project_state_engine(&bob.project_id, &on_disk).unwrap();
        assert_eq!(engine.tex_flavor.as_deref(), Some("xelatex"));
        assert_eq!(engine.id, "latexmk");
        assert_eq!(
            applied.notices,
            vec![SettingsChangedPayload {
                project_id: bob.project_id.clone(),
                account_id: Some(alice.account),
                changes: vec![
                    SettingNotice::MainDocument {
                        path: "intro.tex".into()
                    },
                    SettingNotice::Compiler {
                        engine: "latexmk".into(),
                        flavor: Some("xelatex".into())
                    },
                    SettingNotice::SpellingLanguage {
                        locale: Some("fr_FR".into())
                    },
                ],
            }]
        );
        assert!(!applied.pushed);
        let again = bob.follow();
        assert!(again.meta.is_none());
        assert!(again.notices.is_empty());
    }

    #[test]
    fn switching_the_main_document_to_typst_names_only_the_new_main_document() {
        let library = TempLibrary::new();
        let files = ["main.tex", "notes.typ"];
        let doc = seeded(&files, &meta("main.tex", "xetex"));
        let mut alice = alice(&doc);
        let bob = join(&library, "bob-typst", &files, &doc, ProjectRole::Editor);
        let notes = id_of(alice.live.doc(), "notes.typ");
        alice.change(&[(Setting::MainDoc, &notes), (Setting::Engine, "typst")]);
        alice.send(&bob);
        let applied = bob.follow();
        assert_eq!(bob.meta().main_doc, "notes.typ");
        assert_eq!(bob.meta().engine, "typst");
        assert_eq!(
            applied.notices,
            vec![SettingsChangedPayload {
                project_id: bob.project_id.clone(),
                account_id: Some(alice.account),
                changes: vec![SettingNotice::MainDocument {
                    path: "notes.typ".into()
                }],
            }]
        );
    }

    #[test]
    fn renaming_the_main_file_elsewhere_keeps_it_the_main_document_here() {
        let library = TempLibrary::new();
        let files = ["main.tex", "intro.tex"];
        let doc = seeded(&files, &meta("main.tex", "xetex"));
        let mut alice = alice(&doc);
        let bob = join(&library, "bob-rename", &files, &doc, ProjectRole::Editor);
        let main = id_of(alice.live.doc(), "main.tex");
        alice.live.doc_mut().rename(&main, "thesis.tex").unwrap();
        alice.send(&bob);
        assert!(bob.follow().meta.is_none());
        assert_eq!(bob.meta().main_doc, "main.tex");
        std::fs::rename(bob.root.join("main.tex"), bob.root.join("thesis.tex")).unwrap();
        let applied = bob.follow();
        assert!(applied.notices.is_empty());
        assert_eq!(bob.meta().main_doc, "thesis.tex");
        assert_eq!(bob.settings()[&Setting::MainDoc], main);
        assert!(!applied.pushed);
    }

    #[test]
    fn shell_escape_never_travels_in_either_direction() {
        let library = TempLibrary::new();
        let files = ["main.tex"];
        library.project("alice-escape", &[("main.tex", "x\n")]);
        crate::project::write_meta("alice-escape", &meta("main.tex", "latexmk")).unwrap();
        crate::project::write_shell_escape_trust("alice-escape").unwrap();
        let trusted = crate::project::read_meta("alice-escape").unwrap();
        assert!(trusted.allow_shell_escape);
        let doc = seeded(&files, &trusted);
        let mut alice = alice(&doc);
        let bob = join(&library, "bob-escape", &files, &doc, ProjectRole::Editor);
        assert!(!bob.meta().allow_shell_escape);
        assert!(!crate::project::shell_escape_trusted("bob-escape").unwrap());

        crate::project::write_shell_escape_trust("bob-escape").unwrap();
        assert!(bob.meta().allow_shell_escape);
        let before = bob.settings();
        let quiet = bob.follow();
        assert!(!quiet.pushed);
        assert_eq!(bob.settings(), before);
        alice.hear(&bob);
        assert_eq!(alice.live.doc().settings(), before);

        alice
            .live
            .doc_mut()
            .set_meta("allow_shell_escape", "true")
            .unwrap();
        alice
            .live
            .doc_mut()
            .set_meta("shell_escape", "true")
            .unwrap();
        alice.change(&[(Setting::Engine, "xetex")]);
        alice.send(&bob);
        bob.follow();
        assert_eq!(bob.meta().engine, "xetex");
        assert!(!crate::project::shell_escape_trusted("bob-escape").unwrap());

        alice.change(&[(Setting::Engine, "latexmk")]);
        alice.send(&bob);
        bob.follow();
        let here = bob.meta();
        assert_eq!(here.engine, "latexmk");
        assert!(!here.allow_shell_escape);
        assert!(!crate::project::shell_escape_trusted("bob-escape").unwrap());
        let raw = std::fs::read_to_string(bob.root.join("project.json")).unwrap();
        assert!(!raw.contains("shell_escape"), "{raw}");
        assert!(
            crate::project::read_meta("alice-escape")
                .unwrap()
                .allow_shell_escape
        );
    }

    #[test]
    fn a_viewer_cannot_change_the_shared_compile_settings() {
        let library = TempLibrary::new();
        let files = ["main.tex"];
        let doc = seeded(&files, &meta("main.tex", "xetex"));
        let bob = join(&library, "bob-viewer", &files, &doc, ProjectRole::Viewer);
        assert!(refuse_viewer("bob-viewer").is_ok());
        let paths = CollabPaths::new(crate::paths::collab_root().unwrap());
        let binding = |role| oleafly_collab::ShareBinding {
            server_url: "https://collab.test".to_owned(),
            server_id: ServerId::new_v7(),
            shared_project_id: SharedProjectId::new_v7(),
            role,
            created_at: 0,
        };
        std::fs::create_dir_all(paths.project_dir("bob-viewer").unwrap()).unwrap();
        oleafly_collab::save_binding(&paths, "bob-viewer", &binding(ProjectRole::Viewer)).unwrap();
        crate::collab::registry::invalidate("bob-viewer");
        let refused = refuse_viewer("bob-viewer").unwrap_err();
        assert!(
            refused.contains("project.shared_settings_viewer"),
            "{refused}"
        );
        oleafly_collab::save_binding(&paths, "bob-viewer", &binding(ProjectRole::Editor)).unwrap();
        crate::collab::registry::invalidate("bob-viewer");
        assert!(refuse_viewer("bob-viewer").is_ok());
        crate::collab::registry::invalidate("bob-viewer");

        let before = bob.settings();
        let mut edited = bob.meta();
        edited.engine = "latexmk".into();
        edited.tex_flavor = Some("pdflatex".into());
        crate::project::write_meta("bob-viewer", &edited).unwrap();
        let applied = bob.follow();
        assert!(!applied.pushed);
        assert_eq!(bob.settings(), before);
        assert_eq!(bob.meta().engine, "xetex");
        assert_eq!(bob.meta().tex_flavor, None);
    }

    #[test]
    fn a_local_settings_change_writes_through_to_everyone() {
        let library = TempLibrary::new();
        let files = ["main.tex", "notes.typ"];
        let doc = seeded(&files, &meta("main.tex", "xetex"));
        let mut alice = alice(&doc);
        let bob = join(&library, "bob-local", &files, &doc, ProjectRole::Editor);
        let mut edited = bob.meta();
        edited.engine = "latexmk".into();
        edited.tex_flavor = Some("pdflatex".into());
        edited.dictionary_locale = Some("es_ES".into());
        crate::project::write_meta("bob-local", &edited).unwrap();
        let applied = bob.follow();
        assert!(applied.pushed);
        assert!(applied.notices.is_empty());
        assert!(applied.meta.is_none());
        alice.hear(&bob);
        let shared = alice.live.doc().settings();
        assert_eq!(shared[&Setting::Engine], "latexmk");
        assert_eq!(shared[&Setting::TexFlavor], "pdflatex");
        assert_eq!(shared[&Setting::DictionaryLocale], "es_ES");
        assert_eq!(
            alice.live.doc().setting_author(Setting::Engine),
            Some(bob.account)
        );
        assert!(!bob.follow().pushed);
    }

    #[test]
    fn the_owner_seeds_a_project_shared_before_settings_travelled() {
        let library = TempLibrary::new();
        let files = ["main.tex"];
        let doc = document(&files);
        let editor = join(&library, "editor-legacy", &files, &doc, ProjectRole::Editor);
        std::fs::remove_file(&editor.base_file).unwrap();
        assert!(!editor.follow().pushed);
        assert!(editor.settings().is_empty());

        let owner = join(&library, "owner-legacy", &files, &doc, ProjectRole::Owner);
        std::fs::remove_file(&owner.base_file).unwrap();
        let mut local = owner.meta();
        local.engine = "latexmk".into();
        crate::project::write_meta("owner-legacy", &local).unwrap();
        assert!(owner.follow().pushed);
        let shared = owner.settings();
        assert_eq!(shared[&Setting::Engine], "latexmk");
        assert_eq!(shared[&Setting::MainDoc], id_of(&doc, "main.tex"));
    }
}
