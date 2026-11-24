use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};
use std::time::{Duration, Instant};

use oleafly_collab::sync::{EndReason, LiveStatus};
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_live::live::moves::RemovedPayload;
use oleafly_live::live::payloads::{
    AccountChangedPayload, DocPendingPayload, KeptPayload, OverleafMember, OverleafMembersPayload,
    PresenceLeftPayload, PresencePayload, RemoteEditPayload, RolePayload, StatusPayload,
    UploadFile, UploadState, UploadsPayload,
};
use oleafly_live::live::unwritten::{UnwrittenPayload, UnwrittenReason};
use oleafly_live::overleaf::notices::{OverleafNotice, OverleafNoticePayload};
use oleafly_live::overleaf::{Mirror, MirrorHooks, TreeNotice, TreeNoticeKind};
use oleafly_live::DiskHost;
use oleafly_online::realtime::events::ProjectEvent;
use oleafly_online::realtime::DocId;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::Notify;

use crate::auth::shared::one_line;
use crate::contract::event_line;
use crate::contract::printer::PrintSender;
use crate::remote::sync::listed;

pub(crate) const COMMAND: &str = "remote live";
const EDIT_EVERY: Duration = Duration::from_secs(1);
const EDITS_KEPT: usize = 256;

#[derive(Debug, Default, PartialEq)]
pub(crate) struct Work {
    pub(crate) status: Option<LiveStatus>,
    pub(crate) reviews: Vec<String>,
    pub(crate) deletes: Vec<String>,
    pub(crate) members: bool,
}

#[derive(Clone)]
pub(crate) struct Out {
    sender: PrintSender,
    json: bool,
    quiet: bool,
}

impl Out {
    pub(crate) fn new(sender: PrintSender, json: bool, quiet: bool) -> Out {
        Out {
            sender,
            json,
            quiet,
        }
    }

    pub(crate) fn emit(&self, event: &str, fields: Value, human: impl FnOnce() -> String) {
        if self.json {
            self.sender.send(event_line(COMMAND, event, fields));
        } else if !self.quiet {
            self.sender.send(human());
        }
    }

    pub(crate) fn last(&self, line: String, within: Duration) -> bool {
        self.sender.send_within(line, within)
    }
}

#[derive(Default)]
pub(crate) struct Edits {
    told: HashMap<(String, Option<String>), Instant>,
}

impl Edits {
    pub(crate) fn admit(&mut self, path: &str, user_id: Option<&str>, now: Instant) -> bool {
        let key = (path.to_owned(), user_id.map(str::to_owned));
        let recent = |last: &Instant| now.saturating_duration_since(*last) < EDIT_EVERY;
        if self.told.get(&key).is_some_and(recent) {
            return false;
        }
        if self.told.len() >= EDITS_KEPT {
            self.told.retain(|_, last| recent(last));
        }
        self.told.insert(key, now);
        true
    }
}

struct Peer {
    user_id: String,
    name: Option<String>,
    path: Option<String>,
}

#[derive(Default)]
struct Seen {
    state: Option<String>,
    status: Option<LiveStatus>,
    reviews: BTreeSet<String>,
    deletes: BTreeSet<String>,
    members: bool,
    role: Option<(ProjectRole, bool)>,
    pending: HashSet<String>,
    peers: HashMap<String, Peer>,
    names: HashMap<String, String>,
    uploads: Vec<(String, UploadState)>,
    filled_tenth: Option<usize>,
    edits: Edits,
}

impl Seen {
    fn name_of(&self, user_id: &str) -> Option<String> {
        self.names.get(user_id).cloned().or_else(|| {
            self.peers
                .values()
                .find(|peer| peer.user_id == user_id)
                .and_then(|peer| peer.name.clone())
        })
    }
}

pub(crate) struct CliHost {
    out: Out,
    wake: Notify,
    seen: Mutex<Seen>,
}

impl CliHost {
    pub(crate) fn new(out: Out) -> CliHost {
        CliHost {
            out,
            wake: Notify::new(),
            seen: Mutex::new(Seen::default()),
        }
    }

    fn seen(&self) -> MutexGuard<'_, Seen> {
        self.seen.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn owe(&self, add: impl FnOnce(&mut Seen)) {
        add(&mut self.seen());
        self.wake.notify_one();
    }

    pub(crate) async fn woken(&self) {
        self.wake.notified().await;
    }

    pub(crate) fn work(&self) -> Work {
        let mut seen = self.seen();
        Work {
            status: seen.status.take(),
            reviews: std::mem::take(&mut seen.reviews).into_iter().collect(),
            deletes: std::mem::take(&mut seen.deletes).into_iter().collect(),
            members: std::mem::take(&mut seen.members),
        }
    }

    pub(crate) fn know(&self, members: Vec<OverleafMember>) {
        self.seen().names = members
            .into_iter()
            .filter(|member| !member.person.display_name.is_empty())
            .map(|member| (member.person.account_id, member.person.display_name))
            .collect();
    }
}

fn fields_of(payload: &impl Serialize) -> Value {
    let mut fields = serde_json::to_value(payload).unwrap_or(Value::Null);
    if let Some(object) = fields.as_object_mut() {
        object.remove("projectId");
    }
    fields
}

fn who(name: Option<&str>) -> String {
    name.map_or_else(|| "Someone".to_owned(), one_line)
}

fn state_fields(status: &LiveStatus, pending: u64) -> Value {
    let mut fields = serde_json::to_value(status).unwrap_or(Value::Null);
    if let Some(retry) = fields
        .as_object_mut()
        .and_then(|fields| fields.remove("retry_in_ms"))
    {
        fields["retryInMs"] = retry;
    }
    fields["pending"] = json!(pending);
    fields
}

fn state_line(status: &LiveStatus) -> String {
    match status {
        LiveStatus::Connecting => "Connecting.".to_owned(),
        LiveStatus::Online => "Online.".to_owned(),
        LiveStatus::Offline { retry_in_ms } => format!(
            "Offline. Trying again in {} s.",
            retry_in_ms.div_ceil(1_000).max(1)
        ),
        LiveStatus::SignedOut => {
            "Signed out. Sign in again with oleafly auth login online or in the app, and live editing carries on.".to_owned()
        }
        LiveStatus::Idle => "Idle. Live editing wakes up when a file changes here.".to_owned(),
        LiveStatus::Ended { reason } if *reason == EndReason::Stopped => "Stopping.".to_owned(),
        LiveStatus::Ended { .. } => "Live editing ended.".to_owned(),
    }
}

fn role_line(role: ProjectRole) -> String {
    match role {
        ProjectRole::Owner | ProjectRole::Editor => "You can edit this project.".to_owned(),
        ProjectRole::Unknown => "Your role in this project isn't known yet.".to_owned(),
        ProjectRole::Reviewer | ProjectRole::Commenter | ProjectRole::Viewer => {
            "You can't edit this project, so changes made here stay here.".to_owned()
        }
    }
}

fn upload_reason(state: UploadState) -> &'static str {
    match state {
        UploadState::Waiting => "it's waiting",
        UploadState::Failed => "the upload failed",
        UploadState::TooLarge => "it's larger than the server allows",
        UploadState::ProjectTooLarge => "the project reached the server's size limit",
        UploadState::AccountStorageFull => "the project owner is out of storage",
        UploadState::TooManyUploads => "you made too many uploads in the last hour",
    }
}

fn unwritten_reason(reason: UnwrittenReason) -> &'static str {
    match reason {
        UnwrittenReason::Locked => "another program has it open",
        UnwrittenReason::ReadOnly => "it's read-only",
        UnwrittenReason::NoSpace => "the disk is full",
        UnwrittenReason::NotDownloaded => "it isn't downloaded from the cloud yet",
        UnwrittenReason::Other => "the system refused",
    }
}

fn notice_line(notice: &OverleafNotice) -> String {
    match notice {
        OverleafNotice::Merged { path, .. } => {
            format!("Merged the online changes into {}.", one_line(path))
        }
        OverleafNotice::NeedsReview { path, .. } => format!(
            "{} changed here and online before the two could be merged. The online text wins, and your version is kept as a copy.",
            one_line(path)
        ),
        OverleafNotice::Maintenance { message, delay_ms } => format!(
            "The server stops for maintenance in {} s: {}",
            delay_ms.div_ceil(1_000),
            one_line(message)
        ),
        OverleafNotice::SlowAck { waiting: true } => {
            "The server is slow to confirm changes.".to_owned()
        }
        OverleafNotice::SlowAck { waiting: false } => {
            "The server confirmed the changes.".to_owned()
        }
        OverleafNotice::Unsteady { path } => format!(
            "The server keeps disconnecting {} after someone else's edits. It reconnects on its own.",
            one_line(path)
        ),
        OverleafNotice::Fault { path, reason } => format!(
            "Live editing stopped for {}: {}",
            one_line(path),
            one_line(reason)
        ),
        OverleafNotice::External { path } => format!(
            "{} changed online outside the editor, so it was reloaded.",
            one_line(path)
        ),
        OverleafNotice::Replaced { path } => format!(
            "Some characters in {}, like emoji, can't be stored online, so they were replaced.",
            one_line(path)
        ),
        OverleafNotice::SettingNotSent { .. } => "A project setting wasn't sent.".to_owned(),
        OverleafNotice::Filling { done, total } => {
            format!("Downloading the project: {done} of {total} files.")
        }
        OverleafNotice::Filled => "The project is ready here.".to_owned(),
    }
}

fn notice_fields(payload: &OverleafNoticePayload) -> Value {
    match &payload.notice {
        OverleafNotice::Merged { path, .. } => json!({"kind": "merged", "path": path}),
        OverleafNotice::NeedsReview { path, .. } => json!({"kind": "needs_review", "path": path}),
        _ => fields_of(payload),
    }
}

fn tree_line(kind: &TreeNoticeKind) -> String {
    match kind {
        TreeNoticeKind::DeleteAsked { paths } => format!(
            "You deleted {} here but not online. To delete online too, use the online editor or the Oleafly app.",
            listed(paths)
        ),
        TreeNoticeKind::NotAllowed { paths } => format!(
            "{} can't change online, because you can't edit this project.",
            listed(paths)
        ),
        TreeNoticeKind::KeptAway { paths } => {
            format!("Deleted here but still in the online project: {}.", listed(paths))
        }
        TreeNoticeKind::StoredAsFiles { paths } => {
            format!("Stored online as files: {}.", listed(paths))
        }
        TreeNoticeKind::Linked { files } => {
            let paths: Vec<String> = files.iter().map(|file| file.path.clone()).collect();
            format!("Linked online and updated from a source: {}.", listed(&paths))
        }
        TreeNoticeKind::LinkedKept { paths } => format!(
            "Your changes to linked files stay here only: {}.",
            listed(paths)
        ),
    }
}

impl DiskHost for CliHost {
    fn status(&self, payload: StatusPayload) {
        let fields = state_fields(&payload.status, payload.pending);
        let name = fields["state"].as_str().unwrap_or_default().to_owned();
        let told = {
            let mut seen = self.seen();
            seen.status = Some(payload.status.clone());
            seen.state.replace(name.clone()) == Some(name)
        };
        self.wake.notify_one();
        if !told {
            self.out
                .emit("state", fields, || state_line(&payload.status));
        }
    }

    fn role(&self, payload: RolePayload) {
        let role = (payload.role, payload.tracking);
        if self.seen().role.replace(role) == Some(role) {
            return;
        }
        self.out.emit(
            "notice",
            json!({"kind": "role", "role": payload.role, "tracking": payload.tracking}),
            || role_line(payload.role),
        );
    }

    fn presence(&self, payload: PresencePayload) {
        let name = payload
            .person
            .as_ref()
            .and_then(|person| person.name.clone());
        let fresh = {
            let peer = Peer {
                user_id: payload.account_id.clone(),
                name: name.clone(),
                path: payload.path.clone(),
            };
            self.seen()
                .peers
                .insert(payload.device_id.clone(), peer)
                .is_none_or(|before| before.path != payload.path)
        };
        if !fresh {
            return;
        }
        let user_id = Some(payload.account_id.as_str()).filter(|id| !id.is_empty());
        self.out.emit(
            "peer",
            json!({"deviceId": payload.device_id, "userId": user_id, "name": name, "path": payload.path}),
            || match &payload.path {
                Some(path) => format!("{} is in {}.", who(name.as_deref()), one_line(path)),
                None => format!("{} joined.", who(name.as_deref())),
            },
        );
    }

    fn presence_left(&self, payload: PresenceLeftPayload) {
        let Some(peer) = self.seen().peers.remove(&payload.device_id) else {
            return;
        };
        let user_id = Some(peer.user_id.as_str()).filter(|id| !id.is_empty());
        self.out.emit(
            "peer_left",
            json!({"deviceId": payload.device_id, "userId": user_id, "name": peer.name}),
            || format!("{} left.", who(peer.name.as_deref())),
        );
    }

    fn removed(&self, payload: RemovedPayload) {
        if payload.files.is_empty() {
            return;
        }
        self.out.emit("removed", fields_of(&payload), || {
            payload
                .files
                .iter()
                .map(|file| {
                    let gone = match &file.by {
                        Some(by) => {
                            format!("{} deleted {} online.", one_line(by), one_line(&file.path))
                        }
                        None => format!("{} was deleted online.", one_line(&file.path)),
                    };
                    match &file.copy {
                        Some(copy) => {
                            format!("{gone} Your version is kept as {}.", one_line(copy))
                        }
                        None => gone,
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        });
    }

    fn kept(&self, payload: KeptPayload) {
        if payload.files.is_empty() {
            return;
        }
        self.out.emit("kept", fields_of(&payload), || {
            payload
                .files
                .iter()
                .map(|file| match &file.copy {
                    Some(copy) => format!(
                        "Your version of {} is kept as {}.",
                        one_line(&file.path),
                        one_line(copy)
                    ),
                    None => format!("Your version of {} is kept.", one_line(&file.path)),
                })
                .collect::<Vec<_>>()
                .join("\n")
        });
    }

    fn uploads(&self, payload: UploadsPayload) {
        let fresh: Vec<UploadFile> = {
            let mut seen = self.seen();
            let now: Vec<(String, UploadState)> = payload
                .files
                .iter()
                .filter(|file| file.state != UploadState::Waiting)
                .map(|file| (file.path.clone(), file.state))
                .collect();
            let fresh = payload
                .files
                .into_iter()
                .filter(|file| file.state != UploadState::Waiting)
                .filter(|file| !seen.uploads.contains(&(file.path.clone(), file.state)))
                .collect();
            seen.uploads = now;
            fresh
        };
        if fresh.is_empty() {
            return;
        }
        self.out
            .emit("notice", json!({"kind": "uploads", "files": fresh}), || {
                fresh
                    .iter()
                    .map(|file| {
                        format!(
                            "{} wasn't sent, because {}.",
                            one_line(&file.path),
                            upload_reason(file.state)
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            });
    }

    fn unwritten(&self, payload: UnwrittenPayload) {
        if payload.files.is_empty() {
            return;
        }
        self.out.emit("unwritten", fields_of(&payload), || {
            payload
                .files
                .iter()
                .map(|file| {
                    format!(
                        "Oleafly couldn't write {} here, because {}.",
                        one_line(&file.path),
                        unwritten_reason(file.reason)
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        });
    }

    fn account_changed(&self, payload: AccountChangedPayload) {
        let mut fields = fields_of(&payload);
        fields["kind"] = json!("account_changed");
        self.out.emit("notice", fields, || {
            format!(
                "You're signed in with a different account now, so the changes you made as {} weren't sent. They're kept as copies next to their files.",
                one_line(&payload.typed_as.email)
            )
        });
    }

    fn doc_pending(&self, payload: DocPendingPayload) {
        let sent = {
            let mut seen = self.seen();
            if payload.pending {
                seen.pending.insert(payload.path.clone());
                false
            } else {
                seen.pending.remove(&payload.path)
            }
        };
        if sent {
            self.out.emit("sent", json!({"path": payload.path}), || {
                format!("Sent {}.", one_line(&payload.path))
            });
        }
    }

    fn overleaf_notice(&self, payload: OverleafNoticePayload) {
        if let OverleafNotice::Filling { done, total } = payload.notice {
            let tenth = done.saturating_mul(10) / total.max(1);
            if self.seen().filled_tenth.replace(tenth) == Some(tenth) {
                return;
            }
        }
        self.out.emit("notice", notice_fields(&payload), || {
            notice_line(&payload.notice)
        });
        if let OverleafNotice::NeedsReview { path, .. } = payload.notice {
            self.owe(|seen| {
                seen.reviews.insert(path);
            });
        }
    }

    fn overleaf_members(&self, _payload: OverleafMembersPayload) {
        self.owe(|seen| seen.members = true);
    }

    fn overleaf_tree(&self, notice: TreeNotice) {
        if let TreeNoticeKind::DeleteAsked { paths } = &notice.kind {
            self.out.emit("delete_asked", json!({"paths": paths}), || {
                tree_line(&notice.kind)
            });
            self.owe(|seen| seen.deletes.extend(paths.iter().cloned()));
            return;
        }
        self.out
            .emit("tree", fields_of(&notice), || tree_line(&notice.kind));
    }

    fn remote_edit(&self, payload: RemoteEditPayload) {
        let (admitted, name) = {
            let mut seen = self.seen();
            let admitted =
                seen.edits
                    .admit(&payload.path, payload.user_id.as_deref(), Instant::now());
            let name = payload
                .user_id
                .as_deref()
                .and_then(|user_id| seen.name_of(user_id));
            (admitted, name)
        };
        if !admitted {
            return;
        }
        self.out.emit(
            "remote_edit",
            json!({"path": payload.path, "by": name, "userId": payload.user_id}),
            || {
                format!(
                    "{} edited {}.",
                    who(name.as_deref()),
                    one_line(&payload.path)
                )
            },
        );
    }
}

pub(crate) struct CliHooks {
    out: Out,
    mirror: Weak<Mirror>,
}

impl CliHooks {
    pub(crate) fn new(out: Out, mirror: &Arc<Mirror>) -> CliHooks {
        CliHooks {
            out,
            mirror: Arc::downgrade(mirror),
        }
    }

    fn path_of(&self, doc: &DocId) -> Option<String> {
        self.mirror.upgrade()?.path_of(doc)
    }
}

impl MirrorHooks for CliHooks {
    fn project_event(&self, event: ProjectEvent) {
        let (setting, what, value) = match event {
            ProjectEvent::RootDoc(doc) => ("rootDoc", "main document", self.path_of(&doc)),
            ProjectEvent::Compiler(compiler) => ("compiler", "compiler", Some(compiler)),
            ProjectEvent::Image(image) => ("imageName", "TeX Live version", Some(image)),
            ProjectEvent::SpellLanguage(language) => {
                ("spellCheckLanguage", "spelling language", Some(language))
            }
            ProjectEvent::MainBibliography(doc) => (
                "mainBibliographyDoc",
                "main bibliography",
                self.path_of(&doc),
            ),
            ProjectEvent::Name(name) => ("name", "name", Some(name)),
            ProjectEvent::DeletedOrRenamedExternally => {
                self.out.emit(
                    "notice",
                    json!({"kind": "project", "setting": "deletedOrRenamedExternally"}),
                    || "The project was renamed or deleted outside the editor.".to_owned(),
                );
                return;
            }
        };
        let Some(value) = value else {
            return;
        };
        self.out.emit(
            "notice",
            json!({"kind": "project", "setting": setting, "value": value}),
            || format!("The project's {what} is now {}.", one_line(&value)),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::printer::Printer;

    #[test]
    fn remote_edits_coalesce_per_path_and_author() {
        let mut edits = Edits::default();
        let start = Instant::now();
        let later = |millis: u64| start + Duration::from_millis(millis);
        assert!(edits.admit("main.tex", Some("bob"), start));
        assert!(!edits.admit("main.tex", Some("bob"), later(400)));
        assert!(edits.admit("main.tex", Some("carol"), later(400)));
        assert!(edits.admit("intro.tex", Some("bob"), later(400)));
        assert!(edits.admit("main.tex", None, later(400)));
        assert!(!edits.admit("main.tex", None, later(900)));
        assert!(edits.admit("main.tex", Some("bob"), later(1_000)));
        for at in 0..EDITS_KEPT as u64 * 2 {
            edits.admit(&format!("file-{at}.tex"), None, later(2_000 + at * 10));
        }
        assert!(edits.told.len() <= EDITS_KEPT + 1, "{}", edits.told.len());
    }

    struct Rig {
        host: CliHost,
        lines: std::sync::mpsc::Receiver<String>,
        _printer: Printer,
    }

    fn rig(json: bool, quiet: bool) -> Rig {
        let (sender, lines) = std::sync::mpsc::channel();
        let printer = Printer::start(
            Lines(sender),
            64,
            |count| format!("skipped {count}"),
            |_| {},
        )
        .unwrap();
        Rig {
            host: CliHost::new(Out::new(printer.sender(), json, quiet)),
            lines,
            _printer: printer,
        }
    }

    struct Lines(std::sync::mpsc::Sender<String>);

    impl std::io::Write for Lines {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            let _ = self
                .0
                .send(String::from_utf8_lossy(bytes).trim_end().to_owned());
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn next(lines: &std::sync::mpsc::Receiver<String>) -> Value {
        let line = lines.recv_timeout(Duration::from_secs(5)).unwrap();
        serde_json::from_str(&line).unwrap()
    }

    #[test]
    fn a_coauthors_edit_is_told_once_a_second_with_their_name() {
        let Rig {
            host,
            lines,
            _printer,
        } = rig(true, false);
        host.know(vec![OverleafMember {
            person: oleafly_live::live::payloads::OverleafPerson {
                account_id: "u-bob".into(),
                display_name: "Bob Tester".into(),
                avatar_url: None,
                email: None,
                login: None,
            },
            role: ProjectRole::Editor,
            granted_at: 0,
            standing: oleafly_live::live::payloads::MemberStanding::Member,
        }]);
        let edit = |path: &str| RemoteEditPayload {
            project_id: "p".into(),
            path: path.into(),
            user_id: Some("u-bob".into()),
        };
        host.remote_edit(edit("main.tex"));
        host.remote_edit(edit("main.tex"));
        host.remote_edit(edit("intro.tex"));
        let first = next(&lines);
        assert_eq!(
            (
                first["event"].clone(),
                first["path"].clone(),
                first["by"].clone()
            ),
            (json!("remote_edit"), json!("main.tex"), json!("Bob Tester"))
        );
        assert_eq!(next(&lines)["path"], "intro.tex");
        assert!(lines.recv_timeout(Duration::from_millis(200)).is_err());
    }

    #[tokio::test]
    async fn callbacks_never_wait_and_no_review_or_delete_is_lost() {
        let Rig { host, _printer, .. } = rig(true, false);
        for at in 0..100 {
            host.overleaf_notice(OverleafNoticePayload {
                project_id: "p".into(),
                notice: OverleafNotice::NeedsReview {
                    path: format!("file-{at:03}.tex"),
                    mine: "a".into(),
                    theirs: "b".into(),
                },
            });
        }
        for path in ["old.tex", "gone.tex", "old.tex"] {
            host.overleaf_tree(TreeNotice {
                project_id: "p".into(),
                kind: TreeNoticeKind::DeleteAsked {
                    paths: vec![path.into()],
                },
            });
        }
        host.overleaf_members(OverleafMembersPayload {
            project_id: "p".into(),
        });
        tokio::time::timeout(Duration::from_secs(5), host.woken())
            .await
            .expect("a callback wakes the loop");
        let work = host.work();
        assert_eq!(work.reviews.len(), 100);
        assert_eq!(work.reviews[0], "file-000.tex");
        assert_eq!(work.deletes, vec!["gone.tex", "old.tex"]);
        assert!(work.members);
        assert_eq!(host.work(), Work::default());
    }

    #[test]
    fn quiet_human_output_prints_nothing() {
        let Rig {
            host,
            lines,
            _printer,
        } = rig(false, true);
        host.remote_edit(RemoteEditPayload {
            project_id: "p".into(),
            path: "main.tex".into(),
            user_id: None,
        });
        assert!(lines.recv_timeout(Duration::from_millis(200)).is_err());
        let Rig {
            host,
            lines,
            _printer,
        } = rig(false, false);
        host.remote_edit(RemoteEditPayload {
            project_id: "p".into(),
            path: "main.tex".into(),
            user_id: None,
        });
        assert_eq!(
            lines.recv_timeout(Duration::from_secs(5)).unwrap(),
            "Someone edited main.tex."
        );
    }

    #[test]
    fn states_are_told_when_they_change_and_a_send_is_told_when_it_lands() {
        let Rig {
            host,
            lines,
            _printer,
        } = rig(true, false);
        let status = |status: LiveStatus, pending: u64| StatusPayload {
            project_id: "p".into(),
            status,
            pending,
        };
        host.status(status(LiveStatus::Online, 0));
        host.status(status(LiveStatus::Online, 3));
        host.status(status(LiveStatus::Offline { retry_in_ms: 2_500 }, 3));
        assert_eq!(next(&lines)["state"], "online");
        let offline = next(&lines);
        assert_eq!(
            (offline["state"].clone(), offline["retryInMs"].clone()),
            (json!("offline"), json!(2_500))
        );
        assert_eq!(
            host.work().status,
            Some(LiveStatus::Offline { retry_in_ms: 2_500 })
        );
        let pending = |pending: bool| DocPendingPayload {
            project_id: "p".into(),
            path: "main.tex".into(),
            pending,
        };
        host.doc_pending(pending(false));
        host.doc_pending(pending(true));
        host.doc_pending(pending(false));
        let sent = next(&lines);
        assert_eq!(
            (sent["event"].clone(), sent["path"].clone()),
            (json!("sent"), json!("main.tex"))
        );
        assert!(lines.recv_timeout(Duration::from_millis(200)).is_err());
    }
}
