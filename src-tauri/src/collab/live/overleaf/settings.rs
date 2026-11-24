use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use oleafly_collab::CollabError;
use oleafly_online::live::rest::SettingsUpdate;
use oleafly_online::live::session::OverleafSession;
use oleafly_online::realtime::events::ProjectEvent;
use oleafly_online::realtime::project::flavor_for_compiler;
use oleafly_online::realtime::{DocId, SpellLanguage};
use serde::{Deserialize, Serialize};
use tokio::sync::Notify;

use super::history::rest_failed;
use super::notices::{NotSent, OverleafNotice, OverleafNoticePayload, Setting};
use super::{off_runtime, Mirror, OverleafLive};
use crate::collab::commands::CollabCommandError;
use crate::collab::live::session::{guard, io, not_live};
use crate::collab::settings::Applied;
use crate::project::ProjectMeta;

const BASE_FILE: &str = "settings-base.json";
const DEBOUNCE: Duration = Duration::from_millis(300);
const TREE_WAIT: Duration = Duration::from_secs(2);
const ROOT_EXTENSIONS: [&str; 4] = ["tex", "ltx", "rtex", "rnw"];
const OVERLEAF_FLAVORS: [&str; 3] = ["pdflatex", "xelatex", "lualatex"];
const LATEXMK: &str = "latexmk";

const SHARED: [Setting; 3] = [Setting::MainDoc, Setting::Compiler, Setting::Spelling];

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Sides {
    pub(crate) main_doc: Option<String>,
    pub(crate) compiler: Option<String>,
    pub(crate) spelling: Option<String>,
}

impl Sides {
    pub(crate) fn local(meta: &ProjectMeta) -> Sides {
        Sides {
            main_doc: Some(meta.main_doc.clone()),
            compiler: Some(format!(
                "{}:{}",
                meta.engine.to_ascii_lowercase(),
                meta.tex_flavor.as_deref().unwrap_or_default()
            )),
            spelling: meta.dictionary_locale.clone(),
        }
    }

    fn get(&self, setting: Setting) -> Option<String> {
        match setting {
            Setting::MainDoc => self.main_doc.clone(),
            Setting::Compiler => self.compiler.clone(),
            Setting::Spelling => self.spelling.clone(),
            Setting::Image | Setting::Bibliography => None,
        }
    }

    fn set(&mut self, setting: Setting, value: Option<String>) {
        match setting {
            Setting::MainDoc => self.main_doc = value,
            Setting::Compiler => self.compiler = value,
            Setting::Spelling => self.spelling = value,
            Setting::Image | Setting::Bibliography => {}
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Base {
    pub(crate) local: Sides,
    pub(crate) remote: Sides,
}

pub(crate) fn overleaf_compiler(local: &str) -> Option<String> {
    let (engine, flavor) = local.split_once(':')?;
    (engine == LATEXMK && OVERLEAF_FLAVORS.contains(&flavor)).then(|| flavor.to_owned())
}

fn language_of(code: &str) -> String {
    let language = code
        .split(['_', '-'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    match language.as_str() {
        "nb" | "nn" => "no".to_owned(),
        _ => language,
    }
}

pub(crate) fn overleaf_language(locale: &str, languages: &[SpellLanguage]) -> Option<String> {
    if let Some(exact) = languages
        .iter()
        .find(|language| language.code.eq_ignore_ascii_case(locale))
    {
        return Some(exact.code.clone());
    }
    let wanted = language_of(locale);
    languages
        .iter()
        .find(|language| language.code.eq_ignore_ascii_case(&wanted))
        .map(|language| language.code.clone())
}

pub(crate) fn local_pack(code: &str, packs: &[String]) -> Option<String> {
    if let Some(exact) = packs.iter().find(|pack| pack.eq_ignore_ascii_case(code)) {
        return Some(exact.clone());
    }
    let wanted = language_of(code);
    let matching: Vec<&String> = packs
        .iter()
        .filter(|pack| language_of(pack) == wanted)
        .collect();
    let preferred = matching.iter().find(|pack| {
        let mut parts = pack.split(['_', '-']);
        let language = parts.next().unwrap_or_default();
        parts
            .next()
            .is_some_and(|region| region.eq_ignore_ascii_case(language))
    });
    preferred
        .or_else(|| matching.first())
        .map(|pack| (*pack).clone())
}

pub(crate) fn may_be_root(path: &str) -> bool {
    path.rsplit_once('.').is_some_and(|(_, extension)| {
        ROOT_EXTENSIONS
            .iter()
            .any(|allowed| extension.eq_ignore_ascii_case(allowed))
    })
}

#[derive(Default)]
struct SyncState {
    base: Option<Base>,
    awaiting: BTreeMap<&'static str, VecDeque<String>>,
}

#[derive(Default)]
pub(crate) struct SettingsSync {
    wake: Arc<Notify>,
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    state: Mutex<SyncState>,
}

impl SettingsSync {
    pub(super) fn start(&self, mirror: &Arc<Mirror>) {
        let wake = Arc::clone(&self.wake);
        let mirror = Arc::downgrade(mirror);
        let task = tauri::async_runtime::spawn(run(mirror, wake));
        if let Some(previous) = guard(&self.task).replace(task) {
            previous.abort();
        }
    }

    pub(crate) fn wake(&self) {
        self.wake.notify_one();
    }

    pub(super) fn close(&self) {
        if let Some(task) = guard(&self.task).take() {
            task.abort();
        }
        *guard(&self.state) = SyncState::default();
    }

    fn expect(&self, setting: Setting, value: &str) {
        guard(&self.state)
            .awaiting
            .entry(setting.wire())
            .or_default()
            .push_back(value.to_owned());
    }

    fn forget(&self, setting: Setting, value: &str) {
        let mut state = guard(&self.state);
        if let Some(queue) = state.awaiting.get_mut(setting.wire()) {
            if let Some(at) = queue.iter().rposition(|kept| kept == value) {
                queue.remove(at);
            }
        }
    }

    fn awaits(&self, setting: Setting) -> bool {
        guard(&self.state)
            .awaiting
            .get(setting.wire())
            .is_some_and(|queue| !queue.is_empty())
    }

    pub(super) fn own_echo(&self, setting: Setting, value: &str) -> bool {
        let mut state = guard(&self.state);
        let Some(queue) = state.awaiting.get_mut(setting.wire()) else {
            return false;
        };
        if queue.front().is_some_and(|front| front == value) {
            queue.pop_front();
            return true;
        }
        queue.clear();
        false
    }
}

impl Drop for SettingsSync {
    fn drop(&mut self) {
        if let Some(task) = guard(&self.task).take() {
            task.abort();
        }
    }
}

async fn run(mirror: Weak<Mirror>, wake: Arc<Notify>) {
    loop {
        let Some(live) = mirror.upgrade() else {
            return;
        };
        let known = reconcile(&live).await;
        drop(live);
        if known {
            wake.notified().await;
            tokio::time::sleep(DEBOUNCE).await;
        } else {
            tokio::select! {
                () = wake.notified() => {}
                () = tokio::time::sleep(TREE_WAIT) => {}
            }
        }
    }
}

fn store_base(path: &std::path::Path, base: &Base) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(base).map_err(std::io::Error::other)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    oleafly_core::atomic::write_atomic_private(path, &bytes)
}

fn log(mirror: &Mirror, message: impl std::fmt::Display) {
    let _ = crate::project::append_app_log(format!(
        "Live editing with Overleaf, project {}: {message}",
        mirror.disk.project_id
    ));
}

impl Mirror {
    fn notice_not_sent(&self, setting: Setting, reason: NotSent) {
        self.disk.host.overleaf_notice(OverleafNoticePayload {
            project_id: self.disk.project_id.clone(),
            notice: OverleafNotice::SettingNotSent { setting, reason },
        });
    }

    fn packs(&self) -> Vec<String> {
        let Some(app) = self.host.app() else {
            return Vec::new();
        };
        match crate::dictionaries::catalog(&app) {
            Ok(packs) => packs.into_iter().map(|pack| pack.id).collect(),
            Err(error) => {
                log(
                    self,
                    format!("could not read the spelling catalog: {error}"),
                );
                Vec::new()
            }
        }
    }

    pub(super) fn follow_local(
        &self,
        main_doc: Option<&str>,
        flavor: Option<&str>,
        dictionary: Option<&str>,
    ) -> Result<Option<ProjectMeta>, String> {
        let root = self.disk.root.clone();
        crate::project::follow_shared_settings(&self.disk.project_id, |meta| {
            let flavor = flavor
                .map(str::to_owned)
                .or_else(|| meta.tex_flavor.clone());
            let mut changed =
                crate::project::adopt_online_settings(&root, meta, main_doc, flavor.as_deref());
            if let Some(pack) = dictionary {
                if meta.dictionary_locale.as_deref() != Some(pack) {
                    meta.dictionary_locale = Some(pack.to_owned());
                    changed = true;
                }
            }
            Ok(((), changed))
        })
        .map(|(_, meta)| meta)
    }

    fn applied(&self, meta: ProjectMeta) {
        self.host.settings_changed(Applied {
            project_id: self.disk.project_id.clone(),
            meta: Some(meta),
            notices: Vec::new(),
            pushed: false,
        });
    }

    fn follow_remote(&self, setting: Setting, value: Option<&str>) -> bool {
        let followed = match (setting, value) {
            (Setting::MainDoc, Some(path)) => self.follow_local(Some(path), None, None),
            (Setting::Compiler, Some(compiler)) => match flavor_for_compiler(compiler) {
                Some(flavor) => self.follow_local(None, Some(flavor), None),
                None => {
                    log(self, format!("Overleaf uses the {compiler} compiler, which Oleafly doesn't run. The project keeps its engine"));
                    Ok(None)
                }
            },
            (Setting::Spelling, Some(code)) if !code.is_empty() => {
                match local_pack(code, &self.packs()) {
                    Some(pack) => self.follow_local(None, None, Some(&pack)),
                    None => {
                        log(self, format!("Overleaf checks spelling in {code}, which has no Oleafly dictionary. The project keeps its own"));
                        Ok(None)
                    }
                }
            }
            _ => Ok(None),
        };
        match followed {
            Ok(Some(meta)) => {
                self.applied(meta);
                true
            }
            Ok(None) => false,
            Err(error) => {
                log(
                    self,
                    format!("could not follow a setting from Overleaf: {error}"),
                );
                false
            }
        }
    }

    pub(super) fn follow_project(&self, event: ProjectEvent) {
        let project_id = self.disk.project_id.clone();
        let ProjectEvent::Name(name) = event else {
            self.followed(event);
            return;
        };
        match crate::project::rename_project_blocking(project_id.clone(), name) {
            Ok(meta) => self.host.settings_changed(Applied {
                project_id,
                meta: Some(meta),
                notices: Vec::new(),
                pushed: false,
            }),
            Err(error) => {
                self.disk.log(format!(
                    "Live editing could not follow the project name from Overleaf for project {project_id}: {error}"
                ));
            }
        }
    }

    pub(super) fn followed(&self, event: ProjectEvent) {
        let (setting, value) = match &event {
            ProjectEvent::RootDoc(doc) => (Setting::MainDoc, doc.0.clone()),
            ProjectEvent::Compiler(compiler) => (Setting::Compiler, compiler.clone()),
            ProjectEvent::SpellLanguage(code) => (Setting::Spelling, code.clone()),
            ProjectEvent::Image(image) => (Setting::Image, image.clone()),
            ProjectEvent::MainBibliography(doc) => (Setting::Bibliography, doc.0.clone()),
            ProjectEvent::Name(_) | ProjectEvent::DeletedOrRenamedExternally => return,
        };
        if self.settings.own_echo(setting, &value) {
            return;
        }
        match &event {
            ProjectEvent::RootDoc(doc) => {
                if let Some(path) = self.path_of(doc) {
                    self.follow_remote(Setting::MainDoc, Some(&path));
                }
            }
            ProjectEvent::Compiler(_) | ProjectEvent::SpellLanguage(_) => {
                self.follow_remote(setting, Some(&value));
            }
            _ => {}
        }
        self.settings.wake();
    }

    fn base_path(&self) -> std::path::PathBuf {
        self.hold_dir().join(BASE_FILE)
    }

    async fn load_base(&self) -> Option<Base> {
        if let Some(base) = guard(&self.settings.state).base.clone() {
            return Some(base);
        }
        let loaded = tokio::fs::read(self.base_path())
            .await
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Base>(&bytes).ok());
        guard(&self.settings.state).base.clone_from(&loaded);
        loaded
    }

    async fn save_base(&self, base: Base) {
        guard(&self.settings.state).base = Some(base.clone());
        let path = self.base_path();
        let saved = off_runtime(move || store_base(&path, &base)).await;
        match saved {
            Ok(Ok(())) => {}
            Ok(Err(error)) => log(
                self,
                format!("could not save the shared settings it last agreed on: {error}"),
            ),
            Err(error) => log(
                self,
                format!("could not save the shared settings it last agreed on: {error}"),
            ),
        }
    }

    fn wire_value(
        &self,
        setting: Setting,
        local: &Option<String>,
        languages: &[SpellLanguage],
    ) -> Option<String> {
        let local = local.as_deref()?;
        match setting {
            Setting::MainDoc => {
                let doc = self.doc_at(local)?;
                may_be_root(local).then_some(doc.0)
            }
            Setting::Compiler => overleaf_compiler(local),
            Setting::Spelling => overleaf_language(local, languages),
            Setting::Image | Setting::Bibliography => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Step {
    Follow,
    Agree,
    Conflict,
    NoEquivalent,
    Push {
        value: String,
        expected: Option<String>,
    },
}

pub(crate) fn decide(
    setting: Setting,
    base: &Base,
    local: &Sides,
    remote: &Sides,
    wire: impl Fn(&Option<String>) -> Option<String>,
) -> Option<Step> {
    let (mine, theirs) = (local.get(setting), remote.get(setting));
    let local_moved = mine != base.local.get(setting);
    let remote_moved = theirs != base.remote.get(setting);
    let agrees = || match setting {
        Setting::MainDoc => mine == theirs,
        _ => wire(&mine) == theirs,
    };
    Some(match (local_moved, remote_moved) {
        (false, false) => return None,
        (false, true) => Step::Follow,
        (true, true) if agrees() => Step::Agree,
        (true, true) => Step::Conflict,
        (true, false) => match wire(&mine) {
            Some(value) => Step::Push {
                expected: match setting {
                    Setting::MainDoc => mine,
                    _ => Some(value.clone()),
                },
                value,
            },
            None => Step::NoEquivalent,
        },
    })
}

async fn project_meta(mirror: &Mirror) -> Option<ProjectMeta> {
    let project_id = mirror.disk.project_id.clone();
    match off_runtime(move || crate::project::read_meta(&project_id)).await {
        Ok(Ok(meta)) => Some(meta),
        Ok(Err(error)) | Err(error) => {
            log(
                mirror,
                format!("could not read the project settings: {error}"),
            );
            None
        }
    }
}

#[derive(Default)]
struct Plan {
    update: SettingsUpdate,
    pushed: Vec<(Setting, String, Option<String>)>,
    followed: Vec<Setting>,
}

fn plan_settings(
    mirror: &Mirror,
    base: &mut Base,
    local: &Sides,
    remote: &Sides,
    languages: &[SpellLanguage],
) -> Plan {
    let mut plan = Plan::default();
    for setting in SHARED {
        let wire = |local: &Option<String>| mirror.wire_value(setting, local, languages);
        match decide(setting, base, local, remote, wire) {
            None => {}
            Some(Step::Follow) => {
                plan.followed.push(setting);
                base.remote.set(setting, remote.get(setting));
            }
            Some(Step::Agree) => {
                base.local.set(setting, local.get(setting));
                base.remote.set(setting, remote.get(setting));
            }
            Some(Step::Conflict) => {
                plan.followed.push(setting);
                base.remote.set(setting, remote.get(setting));
                mirror.notice_not_sent(setting, NotSent::Conflict);
            }
            Some(Step::NoEquivalent) => {
                base.local.set(setting, local.get(setting));
                mirror.notice_not_sent(setting, NotSent::NoEquivalent);
            }
            Some(Step::Push { value, expected }) => {
                match setting {
                    Setting::MainDoc => plan.update.root_doc = Some(DocId(value.clone())),
                    Setting::Compiler => plan.update.compiler = Some(value.clone()),
                    _ => plan.update.spelling = Some(value.clone()),
                }
                plan.pushed.push((setting, value, expected));
            }
        }
    }
    plan
}

async fn follow_settings(
    mirror: &Arc<Mirror>,
    followed: &[Setting],
    remote: &Sides,
    base: &mut Base,
) {
    for setting in followed {
        let value = remote.get(*setting);
        let (worker, setting) = (Arc::clone(mirror), *setting);
        if let Err(error) =
            off_runtime(move || worker.follow_remote(setting, value.as_deref())).await
        {
            log(
                mirror,
                format!("could not follow a setting from Overleaf: {error}"),
            );
        }
    }
    if followed.is_empty() {
        return;
    }
    if let Some(meta) = project_meta(mirror).await {
        let now = Sides::local(&meta);
        for setting in followed {
            base.local.set(*setting, now.get(*setting));
        }
    }
}

async fn push_settings(
    mirror: &Mirror,
    session: &OverleafSession,
    plan: &Plan,
    local: &Sides,
    base: &mut Base,
) {
    let Plan { update, pushed, .. } = plan;
    if pushed.is_empty() {
        return;
    }
    for (setting, value, _) in pushed {
        mirror.settings.expect(*setting, value);
    }
    let Err(error) = session.update_settings(update).await else {
        for (setting, _, expected) in pushed {
            base.local.set(*setting, local.get(*setting));
            base.remote.set(*setting, expected.clone());
        }
        return;
    };
    for (setting, value, _) in pushed {
        mirror.settings.forget(*setting, value);
    }
    log(
        mirror,
        format!("could not send a project setting to Overleaf: {error}"),
    );
    let temporary = error.is_temporary();
    let reason = if temporary {
        NotSent::Failed
    } else {
        NotSent::Refused
    };
    for (setting, _, _) in pushed {
        if !temporary {
            base.local.set(*setting, local.get(*setting));
        }
        mirror.notice_not_sent(*setting, reason);
    }
}

async fn reconcile(mirror: &Arc<Mirror>) -> bool {
    let Some(session) = mirror.session.get().and_then(Weak::upgrade) else {
        return false;
    };
    if session.nodes().is_empty() {
        return false;
    }
    let Some(meta) = project_meta(mirror).await else {
        return true;
    };
    let settings = session.project_settings();
    let mut remote = Sides {
        main_doc: settings
            .root_doc
            .as_ref()
            .and_then(|doc| mirror.path_of(doc)),
        compiler: settings
            .compiler
            .as_deref()
            .map(str::trim)
            .filter(|compiler| !compiler.is_empty())
            .map(str::to_ascii_lowercase),
        spelling: settings.spelling.clone(),
    };
    let local = Sides::local(&meta);
    let Some(mut base) = mirror.load_base().await else {
        mirror.save_base(Base { local, remote }).await;
        return true;
    };
    for setting in SHARED {
        if mirror.settings.awaits(setting) || remote.get(setting).is_none() {
            remote.set(setting, base.remote.get(setting));
        }
    }
    let before = base.clone();
    let plan = plan_settings(mirror, &mut base, &local, &remote, &settings.languages);
    follow_settings(mirror, &plan.followed, &remote, &mut base).await;
    push_settings(mirror, &session, &plan, &local, &mut base).await;
    if base != before {
        mirror.save_base(base).await;
    }
    true
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverleafImage {
    pub name: String,
    pub description: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverleafLiveSettings {
    pub image: Option<String>,
    pub images: Vec<OverleafImage>,
    pub bibliography: Option<String>,
    pub bibliographies: Vec<String>,
    pub can_change: bool,
}

fn bare_image(image: &str) -> &str {
    image.rsplit('/').next().unwrap_or(image)
}

impl OverleafLive {
    pub(crate) fn settings_changed_here(&self) {
        self.mirror.settings.wake();
    }

    pub(crate) fn overleaf_settings(&self) -> OverleafLiveSettings {
        let settings = self.session.project_settings();
        let image = settings.image.as_deref().map(bare_image).map(str::to_owned);
        let images = settings
            .images
            .iter()
            .filter(|choice| choice.allowed || Some(choice.name.as_str()) == image.as_deref())
            .map(|choice| OverleafImage {
                name: choice.name.clone(),
                description: choice.description.clone(),
            })
            .collect();
        let mut bibliographies: Vec<String> = self
            .session
            .nodes()
            .into_iter()
            .filter(|node| node.kind == oleafly_online::realtime::tree::NodeKind::Doc)
            .filter(|node| node.name.to_ascii_lowercase().ends_with(".bib"))
            .filter_map(|node| self.mirror.path_of(&DocId(node.id.0)))
            .collect();
        bibliographies.sort();
        OverleafLiveSettings {
            image,
            images,
            bibliography: settings
                .bibliography
                .as_ref()
                .and_then(|doc| self.mirror.path_of(doc)),
            bibliographies,
            can_change: self.writes(),
        }
    }

    pub(crate) async fn set_overleaf_setting(
        &self,
        setting: &str,
        value: &str,
    ) -> Result<(), CollabError> {
        if !self.writes() {
            return Err(CollabError::Api {
                status: 403,
                code: "forbidden".to_owned(),
                message: "only owners and editors can change Overleaf project settings".to_owned(),
            });
        }
        let invalid = |message: &str| CollabError::Api {
            status: 400,
            code: "invalid".to_owned(),
            message: message.to_owned(),
        };
        let (setting, wire, update) = match setting {
            "image" => {
                let listed = self
                    .overleaf_settings()
                    .images
                    .iter()
                    .any(|image| image.name == value);
                if !listed {
                    return Err(invalid(
                        "that TeX Live version isn't offered on this server",
                    ));
                }
                (
                    Setting::Image,
                    value.to_owned(),
                    SettingsUpdate {
                        image: Some(value.to_owned()),
                        ..SettingsUpdate::default()
                    },
                )
            }
            "bibliography" => {
                let doc = self
                    .doc_at(value)
                    .filter(|_| value.to_ascii_lowercase().ends_with(".bib"))
                    .ok_or_else(|| invalid("pick a .bib file in this project"))?;
                (
                    Setting::Bibliography,
                    doc.0.clone(),
                    SettingsUpdate {
                        bibliography: Some(doc),
                        ..SettingsUpdate::default()
                    },
                )
            }
            _ => return Err(invalid("not an Overleaf project setting")),
        };
        self.mirror.settings.expect(setting, &wire);
        match self.session.update_settings(&update).await {
            Ok(()) => Ok(()),
            Err(error) => {
                self.mirror.settings.forget(setting, &wire);
                log(
                    &self.mirror,
                    format!("could not change a project setting on Overleaf: {error}"),
                );
                Err(rest_failed(error))
            }
        }
    }
}

fn overleaf_now(project_id: &str) -> Result<Arc<OverleafLive>, CollabCommandError> {
    super::commands::live_now(project_id).ok_or_else(|| CollabCommandError::from(not_live()))
}

#[tauri::command]
pub async fn overleaf_live_settings(
    project_id: String,
) -> Result<OverleafLiveSettings, CollabCommandError> {
    let live = overleaf_now(&project_id)?;
    off_runtime(move || live.overleaf_settings())
        .await
        .map_err(io)
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn overleaf_live_set_setting(
    project_id: String,
    setting: String,
    value: String,
) -> Result<(), CollabCommandError> {
    overleaf_now(&project_id)?
        .set_overleaf_setting(&setting, &value)
        .await
        .map_err(CollabCommandError::from)
}
