#[cfg(test)]
mod tests;

use crate::app_error::AppError;
use crate::fs_identity::FsIdentity;
use crate::open_folder::OpenFolderError;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::ffi::{OsStr, OsString};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub(crate) const OPEN_FOLDER_FLAG: &str = "--open-folder";
pub(crate) const OPEN_REQUEST_EVENT: &str = "open-request";
pub(crate) const CLAIM_TIMEOUT: Duration = Duration::from_secs(10);
const QUEUE_LIMIT: usize = 16;
const SCOPE_LIMIT: usize = 8;
const REPLAY_GUARD: &str = "OLEAFLY_OPENED_ARGV";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ParseRules {
    pub(crate) file_urls: bool,
    pub(crate) windows_paths: bool,
}

impl ParseRules {
    pub(crate) const fn native() -> Self {
        Self {
            file_urls: cfg!(target_os = "macos"),
            windows_paths: cfg!(windows),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum LaunchTarget {
    Folder(PathBuf),
    Refused {
        name: String,
        error: OpenFolderError,
    },
}

pub(crate) fn parse_argv(
    argv: &[OsString],
    cwd: Option<&Path>,
    rules: ParseRules,
) -> Vec<LaunchTarget> {
    let mut targets = Vec::new();
    let mut options = true;
    let mut args = argv.iter().skip(1);
    while let Some(arg) = args.next() {
        let Some(text) = arg.to_str() else {
            targets.push(not_unicode(arg));
            continue;
        };
        if options && text == "--" {
            options = false;
        } else if options && text == OPEN_FOLDER_FLAG {
            if let Some(value) = args.next() {
                targets.extend(os_target(value, cwd, rules));
            }
        } else if let Some(value) = text
            .strip_prefix(OPEN_FOLDER_FLAG)
            .and_then(|rest| rest.strip_prefix('='))
            .filter(|_| options)
        {
            targets.extend(text_target(value, cwd, rules));
        } else if !(options && text.starts_with('-')) {
            targets.extend(text_target(text, cwd, rules));
        }
    }
    targets
}

pub(crate) fn parse_targets(
    entries: &[OsString],
    cwd: Option<&Path>,
    rules: ParseRules,
) -> Vec<LaunchTarget> {
    entries
        .iter()
        .filter_map(|entry| os_target(entry, cwd, rules))
        .collect()
}

fn not_unicode(arg: &OsStr) -> LaunchTarget {
    LaunchTarget::Refused {
        name: display_name(Path::new(&arg.to_string_lossy().into_owned())),
        error: OpenFolderError::NotUnicode,
    }
}

fn os_target(arg: &OsStr, cwd: Option<&Path>, rules: ParseRules) -> Option<LaunchTarget> {
    match arg.to_str() {
        Some(text) => text_target(text, cwd, rules),
        None => Some(not_unicode(arg)),
    }
}

fn text_target(raw: &str, cwd: Option<&Path>, rules: ParseRules) -> Option<LaunchTarget> {
    if raw.is_empty() {
        return None;
    }
    let text = if rules.windows_paths {
        repair_drive_quote(raw)
    } else {
        raw.to_string()
    };
    let path = PathBuf::from(&text);
    let refused = |error| LaunchTarget::Refused {
        name: display_name(&path),
        error,
    };
    if let Some(scheme) = url_scheme(&text) {
        let local = rules.file_urls && scheme.eq_ignore_ascii_case("file");
        let folder = if local { file_url_path(&text) } else { None };
        return Some(folder.map_or_else(
            || refused(OpenFolderError::NotAbsolute),
            LaunchTarget::Folder,
        ));
    }
    if path.is_absolute() {
        return Some(LaunchTarget::Folder(path));
    }
    Some(match cwd.filter(|cwd| cwd.is_absolute()) {
        Some(cwd) => LaunchTarget::Folder(cwd.join(&path)),
        None => refused(OpenFolderError::NotAbsolute),
    })
}

fn url_scheme(text: &str) -> Option<&str> {
    let (scheme, _) = text.split_once("://")?;
    let mut chars = scheme.chars();
    let valid = scheme.len() > 1
        && chars
            .next()
            .is_some_and(|first| first.is_ascii_alphabetic())
        && chars.all(|next| next.is_ascii_alphanumeric() || matches!(next, '+' | '-' | '.'));
    valid.then_some(scheme)
}

fn file_url_path(text: &str) -> Option<PathBuf> {
    let url = tauri::Url::parse(text).ok()?;
    if url.query().is_some() || url.fragment().is_some() {
        return None;
    }
    url.to_file_path().ok().filter(|path| path.is_absolute())
}

pub(crate) fn repair_drive_quote(text: &str) -> String {
    let Some(stripped) = text.strip_suffix('"').filter(|rest| !rest.is_empty()) else {
        return text.to_string();
    };
    let bytes = stripped.as_bytes();
    if bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return format!("{stripped}\\");
    }
    stripped.to_string()
}

pub(crate) fn display_name(path: &Path) -> String {
    let path = lexically_normal(path);
    match path.file_name() {
        Some(name) => name.to_string_lossy().into_owned(),
        None => crate::project_availability::without_verbatim_prefix(&path)
            .to_string_lossy()
            .into_owned(),
    }
}

fn lexically_normal(path: &Path) -> PathBuf {
    let mut parts: Vec<Component<'_>> = Vec::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => match parts.last() {
                Some(Component::Normal(_)) => {
                    parts.pop();
                }
                Some(Component::RootDir | Component::Prefix(_)) => {}
                _ => parts.push(component),
            },
            other => parts.push(other),
        }
    }
    parts.iter().collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum OpenSource {
    Launch,
    Forwarded,
    #[cfg_attr(not(any(test, target_os = "macos")), allow(dead_code))]
    Os,
    Picker,
    Test,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct PendingOpen {
    pub(crate) token: String,
    pub(crate) display_name: String,
    pub(crate) source: OpenSource,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ValidatedFolder {
    pub(crate) canonical: PathBuf,
    pub(crate) identity: Option<FsIdentity>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Refusal {
    pub(crate) error: OpenFolderError,
    pub(crate) browse: Option<PathBuf>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Stage {
    Validating(PathBuf),
    Checking,
    Ready(ValidatedFolder),
    Refused(Refusal),
}

#[derive(Clone, Debug)]
struct OpenRequest {
    token: String,
    display_name: String,
    source: OpenSource,
    requested: Option<PathBuf>,
    stage: Stage,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Caller {
    pub(crate) window: String,
    pub(crate) session: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Take {
    Claim,
    Inspect,
}

#[derive(Default)]
struct Queue {
    waiting: VecDeque<OpenRequest>,
    claimed: Vec<(OpenRequest, Caller)>,
    sessions: HashMap<String, u64>,
    last_session: u64,
}

impl Queue {
    fn stale(&self, caller: &Caller) -> bool {
        caller.session.is_some_and(|session| {
            self.sessions
                .get(&caller.window)
                .is_some_and(|current| session < *current)
        })
    }

    fn position(&self, token: &str) -> Option<usize> {
        self.waiting
            .iter()
            .position(|request| request.token == token)
    }

    fn take(&mut self, index: usize) -> Option<OpenRequest> {
        let request = self.waiting.remove(index)?;
        if request.source != OpenSource::Picker {
            let mut position = 0;
            self.waiting.retain(|older| {
                position += 1;
                position > index || older.source == OpenSource::Picker
            });
        }
        Some(request)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Claim {
    Ready(ValidatedFolder),
    Refused(Refusal),
    Expired,
    TimedOut,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Placement {
    Focus,
    SwitchInPlace,
}

pub(crate) trait WindowRouter: Send + Sync {
    fn arrival_window(&self) -> String;
    fn placement(&self, project_id: &str, shown: Option<&str>) -> Placement;
}

pub(crate) struct SingleWindowRouter;

impl WindowRouter for SingleWindowRouter {
    fn arrival_window(&self) -> String {
        "main".to_string()
    }

    fn placement(&self, project_id: &str, shown: Option<&str>) -> Placement {
        if shown == Some(project_id) {
            Placement::Focus
        } else {
            Placement::SwitchInPlace
        }
    }
}

pub(crate) struct OpenIntake {
    queue: Mutex<Queue>,
    scopes: Mutex<VecDeque<(String, PathBuf)>>,
    settled: tokio::sync::Notify,
    router: Arc<dyn WindowRouter>,
}

impl Default for OpenIntake {
    fn default() -> Self {
        Self {
            queue: Mutex::default(),
            scopes: Mutex::default(),
            settled: tokio::sync::Notify::new(),
            router: Arc::new(SingleWindowRouter),
        }
    }
}

impl OpenIntake {
    fn queue(&self) -> MutexGuard<'_, Queue> {
        self.queue.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn enqueue(
        &self,
        targets: Vec<LaunchTarget>,
        source: OpenSource,
    ) -> Vec<PendingOpen> {
        let mut queue = self.queue();
        let requests = &mut queue.waiting;
        let mut announced: Vec<PendingOpen> = Vec::new();
        for target in targets {
            let (display_name, requested, stage) = match target {
                LaunchTarget::Folder(path) => (
                    display_name(&path),
                    Some(path.clone()),
                    Stage::Validating(path),
                ),
                LaunchTarget::Refused { name, error } => (
                    name,
                    None,
                    Stage::Refused(Refusal {
                        error,
                        browse: None,
                    }),
                ),
            };
            let existing = requested.as_ref().and_then(|path| {
                requests.iter().find(|request| {
                    request.source != OpenSource::Picker
                        && source != OpenSource::Picker
                        && request.requested.as_ref() == Some(path)
                })
            });
            let request = match existing {
                Some(request) => request.clone(),
                None => {
                    if requests.len() == QUEUE_LIMIT {
                        requests.pop_front();
                    }
                    let request = OpenRequest {
                        token: random_token(),
                        display_name,
                        source,
                        requested,
                        stage,
                    };
                    requests.push_back(request.clone());
                    request
                }
            };
            if announced.iter().all(|seen| seen.token != request.token) {
                announced.push(request.pending());
            }
        }
        announced
    }

    pub(crate) fn pending(&self) -> Vec<PendingOpen> {
        self.queue()
            .waiting
            .iter()
            .filter(|request| request.source != OpenSource::Picker)
            .map(OpenRequest::pending)
            .collect()
    }

    pub(crate) fn begin_validation(&self) -> Vec<(String, PathBuf)> {
        self.queue()
            .waiting
            .iter_mut()
            .filter(|request| matches!(request.stage, Stage::Validating(_)))
            .filter_map(
                |request| match std::mem::replace(&mut request.stage, Stage::Checking) {
                    Stage::Validating(path) => Some((request.token.clone(), path)),
                    _ => None,
                },
            )
            .collect()
    }

    pub(crate) fn settle(&self, token: &str, outcome: Result<ValidatedFolder, Refusal>) {
        if let Some(request) = self
            .queue()
            .waiting
            .iter_mut()
            .find(|request| request.token == token)
        {
            request.stage = match outcome {
                Ok(folder) => {
                    request.display_name = display_name(&folder.canonical);
                    Stage::Ready(folder)
                }
                Err(refusal) => Stage::Refused(refusal),
            };
        }
        self.settled.notify_waiters();
    }

    pub(crate) fn begin_session(&self, window: &str) -> u64 {
        let mut queue = self.queue();
        queue.last_session += 1;
        let session = queue.last_session;
        queue.sessions.insert(window.to_string(), session);
        let (orphaned, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut queue.claimed)
            .into_iter()
            .partition(|(_, caller)| {
                caller.window == window && caller.session.is_some_and(|older| older < session)
            });
        queue.claimed = kept;
        for (request, _) in orphaned.into_iter().rev() {
            if request.source != OpenSource::Picker {
                queue.waiting.push_front(request);
            }
        }
        session
    }

    pub(crate) async fn claim(&self, token: &str, caller: &Caller, timeout: Duration) -> Claim {
        self.wait(token, caller, timeout, Take::Claim).await
    }

    pub(crate) async fn inspect(&self, token: &str, caller: &Caller, timeout: Duration) -> Claim {
        self.wait(token, caller, timeout, Take::Inspect).await
    }

    async fn wait(&self, token: &str, caller: &Caller, timeout: Duration, take: Take) -> Claim {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let settled = self.settled.notified();
            tokio::pin!(settled);
            settled.as_mut().enable();
            if let Some(claim) = self.try_take(token, caller, take) {
                return claim;
            }
            if tokio::time::timeout_at(deadline, settled).await.is_err() {
                let mut queue = self.queue();
                if !queue.stale(caller) {
                    queue.waiting.retain(|request| request.token != token);
                }
                return Claim::TimedOut;
            }
        }
    }

    fn try_take(&self, token: &str, caller: &Caller, take: Take) -> Option<Claim> {
        let mut queue = self.queue();
        if queue.stale(caller) {
            return Some(Claim::Expired);
        }
        let Some(index) = queue.position(token) else {
            return Some(Claim::Expired);
        };
        match &queue.waiting[index].stage {
            Stage::Validating(_) | Stage::Checking => return None,
            Stage::Ready(folder) if take == Take::Inspect => {
                return Some(Claim::Ready(folder.clone()));
            }
            Stage::Ready(_) | Stage::Refused(_) => {}
        }
        let request = queue.take(index)?;
        Some(match request.stage.clone() {
            Stage::Ready(folder) => {
                queue.claimed.push((request, caller.clone()));
                Claim::Ready(folder)
            }
            Stage::Refused(refusal) => Claim::Refused(refusal),
            Stage::Validating(_) | Stage::Checking => Claim::Expired,
        })
    }

    pub(crate) fn finish(&self, token: &str) {
        self.queue()
            .claimed
            .retain(|(request, _)| request.token != token);
    }

    pub(crate) fn discard(&self, token: &str, caller: &Caller) {
        let mut queue = self.queue();
        if queue.stale(caller) {
            return;
        }
        if let Some(index) = queue.position(token) {
            queue.take(index);
        }
    }

    fn settled_arrivals(&self, arrivals: &[PendingOpen]) -> Vec<PendingOpen> {
        self.queue()
            .waiting
            .iter()
            .filter(|request| {
                request.source != OpenSource::Picker
                    && matches!(request.stage, Stage::Ready(_) | Stage::Refused(_))
                    && arrivals
                        .iter()
                        .any(|arrival| arrival.token == request.token)
            })
            .map(OpenRequest::pending)
            .collect()
    }

    pub(crate) fn remember_scope(&self, path: PathBuf) -> String {
        let ticket = random_token();
        let mut scopes = self.scopes.lock().unwrap_or_else(PoisonError::into_inner);
        if scopes.len() == SCOPE_LIMIT {
            scopes.pop_front();
        }
        scopes.push_back((ticket.clone(), path));
        ticket
    }

    pub(crate) fn scope(&self, ticket: &str) -> Option<PathBuf> {
        self.scopes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .find(|(known, _)| known == ticket)
            .map(|(_, path)| path.clone())
    }

    pub(crate) fn router(&self) -> Arc<dyn WindowRouter> {
        Arc::clone(&self.router)
    }

    fn arrival(&self, token: &str) -> Option<PendingOpen> {
        self.queue()
            .waiting
            .iter()
            .find(|request| request.token == token && request.source != OpenSource::Picker)
            .map(OpenRequest::pending)
    }
}

impl OpenRequest {
    fn pending(&self) -> PendingOpen {
        PendingOpen {
            token: self.token.clone(),
            display_name: self.display_name.clone(),
            source: self.source,
        }
    }
}

fn random_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(crate) fn argv_fingerprint(argv: &[OsString]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for arg in argv.iter().skip(1) {
        for byte in arg
            .as_encoded_bytes()
            .iter()
            .copied()
            .chain(std::iter::once(0))
        {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0100_0000_01b3);
        }
    }
    format!("{hash:016x}")
}

pub(crate) fn launch_targets_from(
    argv: &[OsString],
    cwd: Option<&Path>,
    seen: Option<&OsStr>,
    rules: ParseRules,
) -> (Vec<LaunchTarget>, Option<String>) {
    let fingerprint = argv_fingerprint(argv);
    if seen.is_some_and(|seen| seen == OsStr::new(&fingerprint)) {
        return (Vec::new(), Some(fingerprint));
    }
    let targets = parse_argv(argv, cwd, rules);
    let guard = (!targets.is_empty()).then_some(fingerprint);
    (targets, guard)
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct OpenedFolderReply {
    pub(crate) project_id: String,
    pub(crate) detection: oleafly_core::Detection,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct OpenPreview {
    pub(crate) project_id: Option<String>,
    pub(crate) display_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum OpenFailure {
    Refused(Refusal),
    Failed(String),
}

pub(crate) fn validate(path: &Path) -> Result<ValidatedFolder, Refusal> {
    use crate::open_folder::Inspection;
    match crate::open_folder::inspect_folder(path) {
        Ok(Inspection::Folder(folder)) => Ok(ValidatedFolder {
            canonical: folder.canonical,
            identity: Some(folder.identity),
        }),
        Ok(Inspection::Library { .. }) => path
            .canonicalize()
            .map(|canonical| ValidatedFolder {
                canonical,
                identity: None,
            })
            .map_err(|error| refusal(OpenFolderError::Failed(error.to_string()), path)),
        Err(error) => Err(refusal(error, path)),
    }
}

fn refusal(error: OpenFolderError, path: &Path) -> Refusal {
    let browse = matches!(error, OpenFolderError::TooBroad { .. })
        .then(|| path.canonicalize().ok())
        .flatten();
    Refusal { error, browse }
}

pub(crate) fn preview(path: &Path) -> Result<OpenPreview, Refusal> {
    crate::open_folder::resolve_folder(path)
        .map(|project_id| OpenPreview {
            project_id,
            display_name: display_name(path),
        })
        .map_err(|error| refusal(error, path))
}

pub(crate) fn open_validated(
    path: &Path,
    shown: Option<&str>,
    router: &dyn WindowRouter,
) -> Result<OpenedFolderReply, OpenFailure> {
    use crate::open_folder::OpenedKind;
    let opened = crate::open_folder::register_or_resolve_folder(path)
        .map_err(|error| OpenFailure::Refused(refusal(error, path)))?;
    let project_id = opened.project_id;
    let detection =
        crate::project::detect_main_on_open(&project_id).map_err(OpenFailure::Failed)?;
    let switches = router.placement(&project_id, shown) == Placement::SwitchInPlace;
    if opened.kind == OpenedKind::Linked && switches {
        mark_opened(&project_id);
        if let (oleafly_core::Decision::Auto, Some(main)) = (detection.decision, &detection.main) {
            crate::project::remember_detected_main(&project_id, main)
                .map_err(OpenFailure::Failed)?;
        }
        crate::linked_registry::note_modified_on_disk(&project_id);
    }
    Ok(OpenedFolderReply {
        project_id,
        detection,
    })
}

fn mark_opened(project_id: &str) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0);
    if let Err(error) = crate::linked_registry::update(project_id, |record| {
        record.last_opened_at = record.last_opened_at.max(now);
        Ok(())
    }) {
        let _ = crate::project::append_app_log(format!(
            "Could not record when {project_id} was opened: {error}"
        ));
    }
}

pub(crate) fn claimed_folder(intake: &OpenIntake, claim: Claim) -> Result<ValidatedFolder, String> {
    match claim {
        Claim::Ready(folder) => Ok(folder),
        Claim::Refused(refusal) => Err(refusal_error(intake, refusal)),
        Claim::Expired => Err(AppError::new("open_folder.request_expired").into()),
        Claim::TimedOut => Err(AppError::new("open_folder.timed_out").into()),
    }
}

fn refusal_error(intake: &OpenIntake, refusal: Refusal) -> String {
    let error = refusal.error.app_error();
    match refusal.browse {
        Some(path) => error.param("browse", intake.remember_scope(path)),
        None => error,
    }
    .into()
}

pub(crate) fn launch_targets() -> Vec<LaunchTarget> {
    let argv: Vec<OsString> = std::env::args_os().collect();
    let cwd = std::env::current_dir().ok();
    let seen = std::env::var_os(REPLAY_GUARD);
    let (targets, guard) =
        launch_targets_from(&argv, cwd.as_deref(), seen.as_deref(), ParseRules::native());
    if let Some(guard) = guard {
        std::env::set_var(REPLAY_GUARD, guard);
    }
    targets
}

pub(crate) fn start<R: Runtime>(app: &AppHandle<R>) {
    spawn_validation(app.clone());
}

pub(crate) fn arrive<R: Runtime>(
    app: &AppHandle<R>,
    argv: Vec<OsString>,
    cwd: Option<PathBuf>,
    source: OpenSource,
) -> Vec<PendingOpen> {
    let targets = parse_argv(&argv, cwd.as_deref(), ParseRules::native());
    admit(app, targets, source)
}

pub(crate) fn arrive_targets<R: Runtime>(
    app: &AppHandle<R>,
    entries: Vec<OsString>,
    cwd: Option<PathBuf>,
    source: OpenSource,
) -> Vec<PendingOpen> {
    let targets = parse_targets(&entries, cwd.as_deref(), ParseRules::native());
    admit(app, targets, source)
}

fn admit<R: Runtime>(
    app: &AppHandle<R>,
    targets: Vec<LaunchTarget>,
    source: OpenSource,
) -> Vec<PendingOpen> {
    let Some(intake) = app.try_state::<OpenIntake>() else {
        return Vec::new();
    };
    let arrivals = intake.enqueue(targets, source);
    let router = intake.router();
    for arrival in intake.settled_arrivals(&arrivals) {
        deliver(app, router.as_ref(), &arrival);
    }
    if !arrivals.is_empty() {
        spawn_validation(app.clone());
    }
    arrivals
}

fn spawn_validation<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(intake) = app.try_state::<OpenIntake>() else {
            return;
        };
        let router = intake.router();
        for (token, path) in intake.begin_validation() {
            intake.settle(&token, validate(&path));
            if let Some(arrival) = intake.arrival(&token) {
                deliver(&app, router.as_ref(), &arrival);
            }
        }
    });
}

fn deliver<R: Runtime>(app: &AppHandle<R>, router: &dyn WindowRouter, arrival: &PendingOpen) {
    let label = router.arrival_window();
    if arrival.source != OpenSource::Launch {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
    let _ = app.emit_to(label.as_str(), OPEN_REQUEST_EVENT, arrival);
}

#[tauri::command]
pub async fn pending_open_requests(
    intake: tauri::State<'_, OpenIntake>,
) -> Result<Vec<PendingOpen>, String> {
    Ok(intake.pending())
}

fn caller<R: Runtime>(webview: &tauri::Webview<R>, session: Option<u64>) -> Caller {
    Caller {
        window: webview.window().label().to_string(),
        session,
    }
}

#[tauri::command]
pub async fn begin_open_session(
    webview: tauri::Webview,
    intake: tauri::State<'_, OpenIntake>,
) -> Result<u64, String> {
    Ok(intake.begin_session(webview.window().label()))
}

#[tauri::command]
pub async fn prepare_open_request(
    app: AppHandle,
    webview: tauri::Webview,
    token: String,
    session: Option<u64>,
) -> Result<OpenPreview, String> {
    let intake = app.state::<OpenIntake>();
    let caller = caller(&webview, session);
    let folder = claimed_folder(
        &intake,
        intake.inspect(&token, &caller, CLAIM_TIMEOUT).await,
    )?;
    let outcome = tauri::async_runtime::spawn_blocking(move || preview(&folder.canonical))
        .await
        .map_err(|error| OpenFolderError::Failed(error.to_string()).app_error())?;
    outcome.map_err(|refused| {
        intake.discard(&token, &caller);
        refusal_error(&intake, refused)
    })
}

#[tauri::command]
pub async fn discard_open_request(
    webview: tauri::Webview,
    intake: tauri::State<'_, OpenIntake>,
    token: String,
    session: Option<u64>,
) -> Result<(), String> {
    intake.discard(&token, &caller(&webview, session));
    Ok(())
}

#[tauri::command]
pub async fn open_folder_request(
    app: AppHandle,
    webview: tauri::Webview,
    token: String,
    session: Option<u64>,
) -> Result<OpenedFolderReply, String> {
    let intake = app.state::<OpenIntake>();
    let caller = caller(&webview, session);
    let folder = claimed_folder(&intake, intake.claim(&token, &caller, CLAIM_TIMEOUT).await)?;
    let shown = app
        .state::<crate::mcp::server::McpState>()
        .active_project
        .lock()
        .await
        .clone();
    let router = intake.router();
    #[cfg(target_os = "macos")]
    let canonical = folder.canonical.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        open_validated(&folder.canonical, shown.as_deref(), router.as_ref())
    })
    .await;
    intake.finish(&token);
    let outcome =
        outcome.map_err(|error| OpenFolderError::Failed(error.to_string()).app_error())?;
    let reply = outcome.map_err(|failure| match failure {
        OpenFailure::Refused(refusal) => refusal_error(&intake, refusal),
        OpenFailure::Failed(detail) => OpenFolderError::Failed(detail).into(),
    })?;
    #[cfg(target_os = "macos")]
    if crate::linked_registry::is_linked_id(&reply.project_id) {
        crate::system_integration::note_recent_folder(&app, &canonical);
    }
    Ok(reply)
}

#[tauri::command]
pub async fn pick_open_folder(
    app: AppHandle,
    browse: Option<String>,
) -> Result<Option<PendingOpen>, String> {
    use tauri_plugin_dialog::DialogExt;
    let intake = app.state::<OpenIntake>();
    let scope = browse.as_deref().and_then(|ticket| intake.scope(ticket));
    let title = match &scope {
        Some(folder) => crate::i18n::t_with(
            "dialog.openFolder.inside",
            &[("name", display_name(folder).as_str())],
        ),
        None => crate::i18n::t("dialog.openFolder.title"),
    };
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file().set_title(title);
    if let Some(folder) = &scope {
        dialog = dialog.set_directory(folder);
    }
    dialog.pick_folder(move |selection| {
        let _ = sender.send(selection);
    });
    let Some(selection) = receiver
        .await
        .map_err(|_| crate::project_rebind::folder_picker_failed())?
    else {
        return Ok(None);
    };
    let path = selection
        .into_path()
        .map_err(|_| String::from(OpenFolderError::NotAFolder))?;
    let picked = intake
        .enqueue(vec![LaunchTarget::Folder(path)], OpenSource::Picker)
        .into_iter()
        .next();
    spawn_validation(app.clone());
    Ok(picked)
}

#[tauri::command]
pub async fn debug_inject_open_request(
    app: AppHandle,
    path: String,
) -> Result<PendingOpen, String> {
    if !cfg!(feature = "e2e-testing") {
        return Err("Open requests can be injected only in e2e builds.".into());
    }
    arrive_targets(&app, vec![OsString::from(path)], None, OpenSource::Test)
        .into_iter()
        .next()
        .ok_or_else(|| OpenFolderError::NotAbsolute.into())
}
