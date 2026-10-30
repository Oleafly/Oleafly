//! The approval gate for desktop apps. Observation runs; every action asks
//! through a native dialog first, unless the user allowed that tool for the
//! chat, session or task (never in the signed-in browser, never for
//! scripts); a deny rule for `desktop_apps` blocks everything. Approval modes
//! (Full access included) and allow rules never skip these prompts: they
//! were granted for files and commands, and allow rules can be written from
//! the renderer.

use std::collections::{HashMap, HashSet, VecDeque};
use std::hash::Hash;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{Map, Value};

use super::policy::{bounded, clipped, preview_clipped, CuratedTool, Step, ToolClass};
use super::{lock, BoxFuture, CuaScope, RuntimeKind, Surface};

pub(crate) const DENIED_TEXT: &str =
    "Computer Use is denied for this project in the approval rules.";
pub(crate) const MAX_MESSAGE_CHARS: usize = 6_000;
const MAX_STEP_LINE_CHARS: usize = 160;
const MAX_TEXT_CHARS: usize = 200;
const MAX_ADDRESS_CHARS: usize = 500;
const MAX_PREVIEW_CHARS: usize = 600;
const MAX_SCRIPT_CHARS: usize = 4_000;
const MAX_GRANT_KEYS: usize = 256;
/// How long a chat or task dialog waits. The built-in agent gives a tool
/// five minutes; the wait plus a batch's run time stays under that, so an
/// approval never arrives after the call was given up on.
const CHAT_APPROVAL_WAIT: Duration = Duration::from_secs(3 * 60);
const ACP_APPROVAL_WAIT: Duration = Duration::from_secs(90);
/// A dialog keeps the one-at-a-time slot until it is answered, but never
/// longer than this, in case the dialog never reports back.
const MAX_DIALOG_HOLD: Duration = Duration::from_secs(15 * 60);
/// Entries kept per kind of thing seen; a full map starts over.
const MAX_SEEN: usize = 512;
const MAX_SEEN_ELEMENTS: usize = 4_096;
const MAX_SEEN_CHARS: usize = 80;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum GateDecision {
    Run,
    Ask { session_option: bool },
    Refuse(&'static str),
}

/// What the gate does with one call. `granted` says the user already allowed
/// this tool for the chat, session or task. A call in the user's own
/// signed-in browser never takes part in grants: it asks every time, and the
/// dialog has no "Allow for this chat" choice. With asking off in Settings
/// nothing asks; a deny rule still refuses.
pub(crate) fn decide(
    tool: &CuratedTool,
    denied_by_rules: bool,
    granted: bool,
    signed_in: bool,
    asking: bool,
) -> GateDecision {
    if denied_by_rules {
        return GateDecision::Refuse(DENIED_TEXT);
    }
    let session_grant = tool.session_grant && !signed_in;
    match tool.class {
        ToolClass::Session | ToolClass::Observe => GateDecision::Run,
        ToolClass::Act if !asking => GateDecision::Run,
        ToolClass::Act if granted && session_grant => GateDecision::Run,
        ToolClass::Act => GateDecision::Ask {
            session_option: session_grant,
        },
    }
}

/// The name a grant is kept under: the tool on its runtime, so a grant for
/// one profile never covers another.
pub(crate) fn grant_name(kind: RuntimeKind, tool: &str) -> String {
    format!("{}:{tool}", kind.as_str())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Answer {
    Once,
    /// Allow this tool for the rest of the chat, session or task.
    Session,
    Deny,
    /// The wait ran out (for the dialog, or for the user) with no answer.
    Unanswered,
}

#[derive(Clone, Debug)]
pub(crate) struct DialogLabels {
    pub once: String,
    /// Empty on the two-button dialog.
    pub session: String,
    pub deny: String,
}

/// What the user chose. Escape lands on the cancel slot, which is always
/// "Don't allow"; anything unexpected is a no.
pub(crate) fn answer_from_dialog(
    result: &tauri_plugin_dialog::MessageDialogResult,
    labels: &DialogLabels,
) -> Answer {
    use tauri_plugin_dialog::MessageDialogResult;
    match result {
        MessageDialogResult::Custom(label) if *label == labels.once => Answer::Once,
        MessageDialogResult::Custom(label)
            if !labels.session.is_empty() && *label == labels.session =>
        {
            Answer::Session
        }
        MessageDialogResult::Yes | MessageDialogResult::Ok => Answer::Once,
        MessageDialogResult::No if !labels.session.is_empty() => Answer::Session,
        _ => Answer::Deny,
    }
}

fn capitalized(text: &str) -> String {
    let mut characters = text.trim().chars();
    match characters.next() {
        Some(first) => first.to_uppercase().chain(characters).collect(),
        None => String::new(),
    }
}

/// Looks up a dialog string by key, filling in its values.
pub(crate) type Translate<'a> = dyn Fn(&str, &[(&str, &str)]) -> String + 'a;

/// What the dialog says, and how many of a batch's steps it lists.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Approval {
    pub message: String,
    /// Steps of a batch the message lists (0 for a single action). Only
    /// these run when the batch is allowed: the user never saw the rest, and
    /// the dialog says they won't run.
    pub shown_steps: usize,
}

/// What a dialog can say about what an action acts on, beyond its
/// arguments: the app, window and element, as the driver last described
/// them.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Target {
    pub app: Option<String>,
    pub window: Option<String>,
    pub element: Option<String>,
}

impl Target {
    /// `Zotero, Button "Export"` for a step line; empty when nothing is
    /// known.
    fn short(&self) -> String {
        [self.app.as_deref(), self.element.as_deref()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(", ")
    }
}

/// Everything a dialog names besides the arguments.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct DialogContext {
    /// The research task that asks.
    pub task: Option<String>,
    /// What one action acts on.
    pub target: Target,
    /// What each step of a batch acts on, in step order.
    pub steps: Vec<Target>,
    /// The origin of the signed-in browser's tab, as last seen.
    pub origin: Option<String>,
}

fn more_items<'a>(t: &'a Translate<'a>) -> impl Fn(usize) -> String + 'a {
    move |count| {
        t(
            "dialog.desktopApps.moreItems",
            &[("count", &count.to_string())],
        )
    }
}

/// `text` within `max_chars`; a line that was cut ends with how many
/// characters it lost.
fn clip_with_note(text: &str, max_chars: usize, t: &Translate<'_>) -> String {
    let total = text.chars().count();
    if total <= max_chars {
        return text.to_string();
    }
    let note = |cut: usize| t("dialog.desktopApps.cut", &[("count", &cut.to_string())]);
    let keep = max_chars.saturating_sub(note(total).chars().count() + 1);
    let kept: String = text.chars().take(keep).collect();
    format!("{kept} {}", note(total - keep))
}

/// A detail followed, when it was cut, by how much is not shown.
fn with_cut(detail: String, cut: usize, t: &Translate<'_>) -> String {
    if cut == 0 {
        return detail;
    }
    let note = t("dialog.desktopApps.cut", &[("count", &cut.to_string())]);
    format!("{detail}\n{note}")
}

fn step_line(index: usize, step: &Step, target: Option<&Target>, t: &Translate<'_>) -> String {
    let more = more_items(t);
    let detail = super::policy::preview_text(&step.args, &more);
    let named = target
        .map(Target::short)
        .filter(|named| !named.is_empty())
        .map(|named| format!(" ({named})"))
        .unwrap_or_default();
    let line = format!("{}. {}{named} {}", index + 1, step.tool, detail);
    clip_with_note(line.trim_end(), MAX_STEP_LINE_CHARS, t)
}

/// The origin an address belongs to (`https://host[:port]`), when it is one.
pub(crate) fn origin_of(url: &str) -> Option<String> {
    let parsed = tauri::Url::parse(url.trim()).ok()?;
    matches!(parsed.scheme(), "http" | "https")
        .then(|| parsed.origin().ascii_serialization())
        .filter(|origin| origin != "null")
}

/// The site comes from where the tab goes (`browser_navigate`), else from
/// the tab as last seen; never from an address another tool was given.
fn signed_in_line(
    tool: &CuratedTool,
    args: &Value,
    context: &DialogContext,
    t: &Translate<'_>,
) -> String {
    let origin = if tool.name == "browser_navigate" {
        args.get("url").and_then(Value::as_str).and_then(origin_of)
    } else {
        context.origin.clone()
    };
    match origin {
        Some(origin) => t("dialog.desktopApps.signedInOn", &[("origin", &origin)]),
        None => t("dialog.desktopApps.signedIn", &[]),
    }
}

/// The lines that name the task and what the action acts on.
fn context_lines(context: &DialogContext, t: &Translate<'_>) -> Vec<String> {
    let mut lines = Vec::new();
    if let Some(task) = &context.task {
        lines.push(t("dialog.desktopApps.task", &[("title", task)]));
    }
    let target = &context.target;
    if let Some(app) = &target.app {
        lines.push(t("dialog.desktopApps.app", &[("name", app)]));
    }
    if let Some(window) = &target.window {
        lines.push(t("dialog.desktopApps.window", &[("title", window)]));
    }
    if let Some(element) = &target.element {
        lines.push(t("dialog.desktopApps.element", &[("element", element)]));
    }
    lines
}

/// Every argument, redacted: the text or address first, as a headline, then
/// the rest.
fn action_detail(args: &Value, t: &Translate<'_>) -> String {
    let more = more_items(t);
    let mut parts = Vec::new();
    let mut rest = args.clone();
    if let Some(text) = args.get("text").and_then(Value::as_str) {
        let (shown, cut) = clipped(text, MAX_TEXT_CHARS);
        parts.push(with_cut(
            t("dialog.desktopApps.text", &[("text", &shown)]),
            cut,
            t,
        ));
        if let Some(map) = rest.as_object_mut() {
            map.remove("text");
        }
    } else if let Some(url) = args.get("url").and_then(Value::as_str) {
        let (shown, cut) = clipped(url, MAX_ADDRESS_CHARS);
        parts.push(with_cut(
            t("dialog.desktopApps.address", &[("url", &shown)]),
            cut,
            t,
        ));
        if let Some(map) = rest.as_object_mut() {
            map.remove("url");
        }
    }
    let (shown, cut) = preview_clipped(&rest, MAX_PREVIEW_CHARS, &more);
    let shown = with_cut(shown, cut, t);
    if !shown.is_empty() {
        parts.push(shown);
    }
    parts.join("\n")
}

/// The dialog text: what the agent wants to do, the task and what it acts
/// on, then every argument. A batch lists every step it has room for, each
/// line and the whole message bounded, and says what it cut: characters of
/// a line or text, the steps it left out (which then don't run).
/// `signed_in` adds a line that the action happens in the user's own
/// signed-in browser.
pub(crate) fn approval_message(
    agent: &str,
    tool: &CuratedTool,
    args: &Value,
    steps: Option<&[Step]>,
    signed_in: bool,
    context: &DialogContext,
    t: &Translate<'_>,
) -> Approval {
    let agent = capitalized(agent);
    if let Some(steps) = steps {
        let mut message = t("dialog.desktopApps.steps", &[("agent", &agent)]);
        if let Some(task) = &context.task {
            message.push('\n');
            message.push_str(&t("dialog.desktopApps.task", &[("title", task)]));
        }
        let mut shown_steps = 0;
        for (index, step) in steps.iter().enumerate() {
            let line = step_line(index, step, context.steps.get(index), t);
            let left = (steps.len() - index).to_string();
            let more = t("dialog.desktopApps.moreSteps", &[("count", &left)]);
            let after = message.chars().count() + 1 + line.chars().count();
            let room_for_more =
                index + 1 == steps.len() || after + 1 + more.chars().count() <= MAX_MESSAGE_CHARS;
            if after > MAX_MESSAGE_CHARS || !room_for_more {
                message.push('\n');
                message.push_str(&more);
                return Approval {
                    message,
                    shown_steps,
                };
            }
            message.push('\n');
            message.push_str(&line);
            shown_steps += 1;
        }
        return Approval {
            message,
            shown_steps,
        };
    }
    let action = tool
        .action_key
        .map(|key| t(&format!("dialog.desktopApps.actions.{key}"), &[]))
        .unwrap_or_else(|| tool.name.to_string());
    let mut message = t(
        "dialog.desktopApps.action",
        &[("agent", &agent), ("action", &action)],
    );
    if signed_in {
        message.push('\n');
        message.push_str(&signed_in_line(tool, args, context, t));
    }
    for line in context_lines(context, t) {
        message.push('\n');
        message.push_str(&line);
    }
    let detail = if tool.name == "run_script" {
        let more = more_items(t);
        let (shown, cut) = preview_clipped(args, MAX_SCRIPT_CHARS, &more);
        with_cut(shown, cut, t)
    } else {
        action_detail(args, t)
    };
    if !detail.is_empty() {
        message.push_str("\n\n");
        message.push_str(&detail);
    }
    Approval {
        message: clip_with_note(&message, MAX_MESSAGE_CHARS, t),
        shown_steps: 0,
    }
}

/// Asks the user. Implementations answer `Unanswered` once `wait` has passed.
pub(crate) trait Approver: Send + Sync {
    fn ask<'a>(
        &'a self,
        scope: &'a CuaScope,
        message: String,
        session_option: bool,
        wait: Duration,
    ) -> BoxFuture<'a, Answer>;
}

/// How long a dialog may wait for the user. ACP agents give up on a tool
/// call sooner than chats and tasks do.
pub(crate) fn approval_wait(surface: Surface) -> Duration {
    match surface {
        Surface::Chat | Surface::Task => CHAT_APPROVAL_WAIT,
        Surface::Acp => ACP_APPROVAL_WAIT,
    }
}

fn session_label_key(surface: Surface) -> &'static str {
    match surface {
        Surface::Chat => "dialog.desktopApps.allowChat",
        Surface::Acp => "dialog.desktopApps.allowSession",
        Surface::Task => "dialog.desktopApps.allowTask",
    }
}

/// The native dialog, one at a time.
pub(crate) struct NativeApprover {
    app: tauri::AppHandle,
    /// Held while a dialog is on screen. The dialog's own answer releases
    /// it, not the call that asked, so a dialog still open after its call
    /// gave up never has a second one stacked behind it.
    turn: Arc<tokio::sync::Mutex<()>>,
}

impl NativeApprover {
    pub(crate) fn new(app: tauri::AppHandle) -> Self {
        Self {
            app,
            turn: Arc::new(tokio::sync::Mutex::new(())),
        }
    }
}

/// The one-dialog slot, released by whichever comes first: the dialog's
/// answer or `MAX_DIALOG_HOLD`.
type HeldSlot = Arc<std::sync::Mutex<Option<tokio::sync::OwnedMutexGuard<()>>>>;

fn hold_slot(guard: tokio::sync::OwnedMutexGuard<()>) -> HeldSlot {
    let held: HeldSlot = Arc::new(std::sync::Mutex::new(Some(guard)));
    let expiry = held.clone();
    super::spawn_background(async move {
        tokio::time::sleep(MAX_DIALOG_HOLD).await;
        lock(&expiry).take();
    });
    held
}

impl Approver for NativeApprover {
    fn ask<'a>(
        &'a self,
        scope: &'a CuaScope,
        message: String,
        session_option: bool,
        wait: Duration,
    ) -> BoxFuture<'a, Answer> {
        Box::pin(async move {
            use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
            let deadline = Instant::now() + wait;
            let Ok(guard) = tokio::time::timeout(wait, self.turn.clone().lock_owned()).await else {
                return Answer::Unanswered;
            };
            let slot = hold_slot(guard);
            let labels = DialogLabels {
                once: crate::i18n::t("dialog.desktopApps.allowOnce"),
                session: if session_option {
                    crate::i18n::t(session_label_key(scope.surface))
                } else {
                    String::new()
                },
                deny: crate::i18n::t("dialog.desktopApps.deny"),
            };
            let (sender, receiver) = tokio::sync::oneshot::channel();
            // The first button is the default one on every system, and the
            // plugin turns a closed dialog (Escape, the close button) into
            // the last slot, which on Linux arrives as that slot's label. So
            // "Don't allow" has to stay last: moving it first would make a
            // closed dialog allow the action.
            let dialog = self
                .app
                .dialog()
                .message(message)
                .title(crate::i18n::t("dialog.desktopApps.title"))
                .kind(MessageDialogKind::Warning);
            if session_option {
                let chosen = labels.clone();
                dialog
                    .buttons(MessageDialogButtons::YesNoCancelCustom(
                        labels.once.clone(),
                        labels.session.clone(),
                        labels.deny.clone(),
                    ))
                    .show_with_result(move |result| {
                        lock(&slot).take();
                        let _ = sender.send(answer_from_dialog(&result, &chosen));
                    });
            } else {
                dialog
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        labels.once.clone(),
                        labels.deny.clone(),
                    ))
                    .show(move |allowed| {
                        lock(&slot).take();
                        let _ = sender.send(if allowed { Answer::Once } else { Answer::Deny });
                    });
            }
            // A late answer finds the receiver gone and changes nothing.
            match tokio::time::timeout(deadline.saturating_duration_since(Instant::now()), receiver)
                .await
            {
                Ok(Ok(answer)) => answer,
                _ => Answer::Unanswered,
            }
        })
    }
}

/// "Allow for this chat/session/task" grants, per grant key and tool.
#[derive(Default)]
pub(crate) struct GrantStore {
    grants: HashMap<String, HashSet<String>>,
    /// Keys in the order they were first granted; the oldest go first.
    order: VecDeque<String>,
}

impl GrantStore {
    pub(crate) fn has(&self, key: &str, tool: &str) -> bool {
        self.grants
            .get(key)
            .is_some_and(|tools| tools.contains(tool))
    }

    pub(crate) fn grant(&mut self, key: &str, tool: &str) {
        if !self.grants.contains_key(key) {
            self.order.push_back(key.to_string());
            while self.order.len() > MAX_GRANT_KEYS {
                if let Some(oldest) = self.order.pop_front() {
                    self.grants.remove(&oldest);
                }
            }
        }
        self.grants
            .entry(key.to_string())
            .or_default()
            .insert(tool.to_string());
    }

    pub(crate) fn clear_key(&mut self, key: &str) {
        self.grants.remove(key);
        self.order.retain(|existing| existing != key);
    }

    pub(crate) fn clear_all(&mut self) {
        self.grants.clear();
        self.order.clear();
    }
}

/// What the driver said about the browser one session uses on one runtime.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct SeenBrowser {
    /// The browser `browser_prepare` opened.
    pub prepared: Option<u64>,
    /// The process and window Oleafly bound, from the driver's window list.
    pub window: Option<(u64, u64)>,
    /// The target and tab the last bind, page read or navigation named.
    pub target: Option<String>,
    pub tab: Option<String>,
}

/// An element as the driver's last look at its window described it.
#[derive(Clone, Debug, PartialEq, Eq)]
struct SeenElement {
    description: String,
    pid: Option<u64>,
    window_id: Option<u64>,
}

/// What the driver's own answers said about apps, windows, elements and the
/// signed-in browser's tab, so a dialog can name what an action acts on.
/// Only the driver writes here, never the model. Each map is bounded.
#[derive(Default)]
pub(crate) struct Seen {
    apps: HashMap<u64, String>,
    windows: HashMap<(u64, u64), String>,
    /// Window id → the process that owns it.
    owners: HashMap<u64, u64>,
    /// A window read's `snapshot_id` → the session that read it, its process
    /// and its window. Cua Driver 0.38 leaves the elements out of the
    /// structured answer, and its element tokens are `<snapshot_id>:<row>`.
    snapshots: HashMap<String, (String, u64, u64)>,
    /// Snapshots read in a turn that has ended. The driver's session ended
    /// with the turn, and their element tokens with it.
    ended: HashSet<String>,
    browsers: HashMap<(String, RuntimeKind), SeenBrowser>,
    /// By `element_token`, and by `<snapshot_id>#<element_index>`.
    elements: HashMap<String, SeenElement>,
    /// Session key → the origin of its signed-in browser tab.
    origins: HashMap<String, String>,
}

fn insert_bounded<K: Eq + Hash, V>(map: &mut HashMap<K, V>, cap: usize, key: K, value: V) {
    if map.len() >= cap && !map.contains_key(&key) {
        map.clear();
    }
    map.insert(key, value);
}

/// A name or label an app reported, fit for one dialog line: no control or
/// format characters, spaces collapsed, at most 80 characters.
fn shown_name(value: Option<&Value>) -> Option<String> {
    let text: String = value?
        .as_str()?
        .chars()
        .filter(|character| !character.is_control() && !super::config::is_format_char(*character))
        .collect();
    let joined = text.split_whitespace().collect::<Vec<_>>().join(" ");
    (!joined.is_empty()).then(|| bounded(&joined, MAX_SEEN_CHARS))
}

fn number(value: Option<&Value>) -> Option<u64> {
    let value = value?;
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|text| text.trim().parse().ok()))
}

fn snapshot_id(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .filter(|snapshot| !snapshot.is_empty() && snapshot.len() <= 128)
}

/// The snapshot an element token or `snapshot_id` argument names.
fn named_snapshot(args: &Value) -> Option<&str> {
    args.get("element_token")
        .and_then(Value::as_str)
        .and_then(|token| token.split_once(':'))
        .map(|(snapshot, _)| snapshot)
        .or_else(|| snapshot_id(args.get("snapshot_id")))
}

/// Whether a call names its process, directly or in its `target`.
pub(crate) fn names_pid(args: &Map<String, Value>) -> bool {
    args.get("pid").is_some_and(|pid| !pid.is_null())
        || args
            .get("target")
            .and_then(|target| target.get("pid"))
            .is_some_and(|pid| !pid.is_null())
}

fn snapshot_key(snapshot: Option<&Value>, index: Option<&Value>) -> Option<String> {
    let snapshot = match snapshot? {
        Value::String(text) if !text.is_empty() && text.len() <= 128 => text.clone(),
        Value::Number(number) => number.to_string(),
        _ => return None,
    };
    Some(format!("{snapshot}#{}", number(index)?))
}

/// `Button "Export"`: the role (without the `AX` prefix) and the label.
/// Never the element's value, which can be what the user typed.
fn element_description(element: &Value) -> Option<String> {
    let role = shown_name(element.get("role")).map(|role| match role.strip_prefix("AX") {
        Some(rest) if !rest.is_empty() => rest.to_string(),
        _ => role,
    });
    let label = shown_name(element.get("label")).or_else(|| shown_name(element.get("title")));
    match (role, label) {
        (Some(role), Some(label)) => Some(format!("{role} \"{label}\"")),
        (Some(role), None) => Some(role),
        (None, Some(label)) => Some(format!("\"{label}\"")),
        (None, None) => None,
    }
}

impl Seen {
    fn record_app(&mut self, entry: &Value) {
        let Some(pid) = number(entry.get("pid")) else {
            return;
        };
        if let Some(name) =
            shown_name(entry.get("app_name")).or_else(|| shown_name(entry.get("name")))
        {
            insert_bounded(&mut self.apps, MAX_SEEN, pid, name);
        }
        let Some(window_id) = number(entry.get("window_id")) else {
            return;
        };
        insert_bounded(&mut self.owners, MAX_SEEN, window_id, pid);
        if let Some(title) =
            shown_name(entry.get("title")).or_else(|| shown_name(entry.get("window_title")))
        {
            insert_bounded(&mut self.windows, MAX_SEEN, (pid, window_id), title);
        }
    }

    /// Learns which session, process and window a window read's snapshot
    /// belongs to.
    fn record_snapshot(&mut self, session_key: &str, structured: &Value) {
        let (Some(pid), Some(window_id), Some(snapshot)) = (
            number(structured.get("pid")),
            number(structured.get("window_id")),
            snapshot_id(structured.get("snapshot_id")),
        ) else {
            return;
        };
        // A restarted driver counts its snapshots from the start again.
        self.ended.remove(snapshot);
        insert_bounded(
            &mut self.snapshots,
            MAX_SEEN,
            snapshot.to_string(),
            (session_key.to_string(), pid, window_id),
        );
    }

    /// Learns from one successful answer to `tool`, called with `args` on
    /// `kind` for `session_key`.
    pub(crate) fn record(
        &mut self,
        session_key: &str,
        kind: RuntimeKind,
        tool: &str,
        args: &Value,
        result: &Value,
    ) {
        if result.get("isError").and_then(Value::as_bool) == Some(true) {
            return;
        }
        let structured = result
            .get("structuredContent")
            .filter(|structured| structured.is_object());
        if kind != RuntimeKind::Desktop {
            if let Some(structured) = structured {
                self.record_browser(session_key, kind, tool, structured);
            }
        }
        if kind == RuntimeKind::SignedInBrowser {
            let url = if tool == "browser_navigate" {
                args.get("url")
            } else {
                structured.and_then(|structured| {
                    structured
                        .get("url")
                        .or_else(|| structured.pointer("/tab/url"))
                })
            };
            if let Some(origin) = url.and_then(Value::as_str).and_then(origin_of) {
                insert_bounded(&mut self.origins, MAX_SEEN, session_key.to_string(), origin);
            }
            return;
        }
        let Some(structured) = structured else {
            return;
        };
        self.record_app(structured);
        self.record_snapshot(session_key, structured);
        for list in ["windows", "apps"] {
            for entry in structured
                .get(list)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .take(MAX_SEEN)
            {
                self.record_app(entry);
            }
        }
        let Some(elements) = structured.get("elements").and_then(Value::as_array) else {
            return;
        };
        let pid = number(structured.get("pid")).or_else(|| number(args.get("pid")));
        let window_id =
            number(structured.get("window_id")).or_else(|| number(args.get("window_id")));
        if let (Some(pid), Some(window_id), Some(title)) =
            (pid, window_id, shown_name(structured.get("window_title")))
        {
            insert_bounded(&mut self.windows, MAX_SEEN, (pid, window_id), title);
        }
        for element in elements.iter().take(MAX_SEEN_ELEMENTS) {
            let Some(description) = element_description(element) else {
                continue;
            };
            let seen = SeenElement {
                description,
                pid,
                window_id,
            };
            if let Some(token) = element
                .get("element_token")
                .and_then(Value::as_str)
                .filter(|token| !token.is_empty() && token.len() <= 256)
            {
                insert_bounded(
                    &mut self.elements,
                    MAX_SEEN_ELEMENTS,
                    token.to_string(),
                    seen.clone(),
                );
            }
            if let Some(key) =
                snapshot_key(structured.get("snapshot_id"), element.get("element_index"))
            {
                insert_bounded(&mut self.elements, MAX_SEEN_ELEMENTS, key, seen);
            }
        }
    }

    /// The process, window and element an action's arguments point at: as
    /// given, or as the driver described the element, snapshot or window.
    fn located(&self, args: &Value) -> (Option<u64>, Option<u64>, Option<&SeenElement>) {
        let token = args.get("element_token").and_then(Value::as_str);
        let element = token
            .and_then(|token| self.elements.get(token))
            .or_else(|| {
                snapshot_key(args.get("snapshot_id"), args.get("element_index"))
                    .and_then(|key| self.elements.get(&key))
            });
        let snapshot = named_snapshot(args).and_then(|snapshot| self.snapshots.get(snapshot));
        let window_id = number(args.get("window_id"))
            .or_else(|| element.and_then(|seen| seen.window_id))
            .or_else(|| snapshot.map(|(_, _, window_id)| *window_id));
        let pid = number(args.get("pid"))
            .or_else(|| element.and_then(|seen| seen.pid))
            .or_else(|| snapshot.map(|(_, pid, _)| *pid))
            .or_else(|| window_id.and_then(|window_id| self.owners.get(&window_id).copied()));
        (pid, window_id, element)
    }

    /// Adds the `pid` the driver gave for the element, snapshot or window
    /// the arguments name, when they leave it out. Cua Driver 0.38 refuses
    /// a call to a window whose process the call doesn't name.
    pub(crate) fn fill_pid(&self, args: &mut Map<String, Value>) {
        if names_pid(args) {
            return;
        }
        if let (Some(pid), _, _) = self.located(&Value::Object(args.clone())) {
            args.insert("pid".into(), Value::from(pid));
        }
    }

    /// The app, window and element an action's arguments point at, as far
    /// as they were seen.
    pub(crate) fn target(&self, args: &Value) -> Target {
        let (pid, window_id, element) = self.located(args);
        Target {
            app: pid.and_then(|pid| self.apps.get(&pid).cloned()),
            window: pid
                .zip(window_id)
                .and_then(|key| self.windows.get(&key).cloned()),
            element: element.map(|seen| seen.description.clone()),
        }
    }

    /// The signed-in browser tab's origin for this session, as last seen.
    pub(crate) fn origin(&self, session_key: &str) -> Option<String> {
        self.origins.get(session_key).cloned()
    }

    /// Whether the arguments name a snapshot read in a turn that ended. Its
    /// element tokens went with the driver's session, so the action would
    /// only be refused, after the user had been asked.
    pub(crate) fn names_ended_snapshot(&self, args: &Value) -> bool {
        named_snapshot(args).is_some_and(|snapshot| self.ended.contains(snapshot))
    }

    fn browser_entry(&mut self, session_key: &str, kind: RuntimeKind) -> &mut SeenBrowser {
        let key = (session_key.to_string(), kind);
        if self.browsers.len() >= MAX_SEEN && !self.browsers.contains_key(&key) {
            self.browsers.clear();
        }
        self.browsers.entry(key).or_default()
    }

    /// Learns the browser a session opened, and the target and tab a bind,
    /// page read or navigation named.
    fn record_browser(
        &mut self,
        session_key: &str,
        kind: RuntimeKind,
        tool: &str,
        structured: &Value,
    ) {
        let seen = self.browser_entry(session_key, kind);
        match tool {
            "browser_prepare" => {
                if let Some(pid) = number(structured.get("prepared_pid")) {
                    *seen = SeenBrowser {
                        prepared: Some(pid),
                        ..SeenBrowser::default()
                    };
                }
            }
            "get_browser_state" | "browser_navigate" => {
                if let Some(target) = structured
                    .get("target_id")
                    .and_then(Value::as_str)
                    .filter(|target| !target.is_empty() && target.len() <= 256)
                {
                    seen.target = Some(target.to_string());
                }
                if let Some(tab) = super::browser::answered_tab(structured)
                    .filter(|tab| !tab.is_empty() && tab.len() <= 256)
                {
                    seen.tab = Some(tab);
                }
            }
            _ => {}
        }
    }

    /// The browser this session uses on `kind`, as the driver described it.
    pub(crate) fn browser(&self, session_key: &str, kind: RuntimeKind) -> Option<&SeenBrowser> {
        self.browsers.get(&(session_key.to_string(), kind))
    }

    /// Remembers the window Oleafly bound for this session, from the
    /// driver's own window list.
    pub(crate) fn note_browser_window(
        &mut self,
        session_key: &str,
        kind: RuntimeKind,
        pid: u64,
        window_id: u64,
    ) {
        self.browser_entry(session_key, kind).window = Some((pid, window_id));
    }

    pub(crate) fn forget_session(&mut self, session_key: &str) {
        self.origins.remove(session_key);
        self.browsers.retain(|(key, _), _| key != session_key);
        let ended: Vec<String> = self
            .snapshots
            .iter()
            .filter(|(_, (key, _, _))| key == session_key)
            .map(|(snapshot, _)| snapshot.clone())
            .collect();
        for snapshot in ended {
            self.snapshots.remove(&snapshot);
            if self.ended.len() >= MAX_SEEN {
                self.ended.clear();
            }
            self.ended.insert(snapshot);
        }
    }
}

#[cfg(test)]
pub(crate) mod testing {
    use std::collections::VecDeque;
    use std::sync::Mutex;
    use std::time::Duration;

    use super::{Answer, Approver};
    use crate::cua_driver::{lock, BoxFuture, CuaScope};

    /// Answers from a script, after an optional delay; records each message.
    #[derive(Default)]
    pub(crate) struct ScriptedApprover {
        pub answers: Mutex<VecDeque<Answer>>,
        pub delay: Duration,
        pub asked: Mutex<Vec<String>>,
        pub session_options: Mutex<Vec<bool>>,
    }

    impl ScriptedApprover {
        pub(crate) fn with(answers: &[Answer]) -> Self {
            Self {
                answers: Mutex::new(answers.iter().copied().collect()),
                ..Self::default()
            }
        }

        pub(crate) fn asked(&self) -> Vec<String> {
            lock(&self.asked).clone()
        }
    }

    impl Approver for ScriptedApprover {
        fn ask<'a>(
            &'a self,
            _scope: &'a CuaScope,
            message: String,
            session_option: bool,
            wait: Duration,
        ) -> BoxFuture<'a, Answer> {
            Box::pin(async move {
                lock(&self.asked).push(message);
                lock(&self.session_options).push(session_option);
                let answer = lock(&self.answers).pop_front().unwrap_or(Answer::Deny);
                // An answer that would come after the wait counts as none,
                // like the native dialog's (no need to sleep through it).
                if self.delay > wait {
                    return Answer::Unanswered;
                }
                tokio::time::sleep(self.delay).await;
                answer
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cua_driver::policy::{curated, Step};
    use serde_json::json;
    use tauri_plugin_dialog::MessageDialogResult;

    fn english(key: &str, params: &[(&str, &str)]) -> String {
        crate::i18n::t_with_in("en", key, params)
    }

    fn labels(session: &str) -> DialogLabels {
        DialogLabels {
            once: "Allow once".into(),
            session: session.into(),
            deny: "Don't allow".into(),
        }
    }

    #[test]
    fn observation_runs_and_actions_ask() {
        assert_eq!(
            decide(curated("list_windows").unwrap(), false, false, false, true),
            GateDecision::Run
        );
        assert_eq!(
            decide(curated("start_session").unwrap(), false, false, false, true),
            GateDecision::Run
        );
        assert_eq!(
            decide(curated("click").unwrap(), false, false, false, true),
            GateDecision::Ask {
                session_option: true
            }
        );
        assert_eq!(
            decide(curated("click").unwrap(), false, true, false, true),
            GateDecision::Run
        );
        assert_eq!(
            decide(curated("run_script").unwrap(), false, true, false, true),
            GateDecision::Ask {
                session_option: false
            }
        );
    }

    #[test]
    fn the_signed_in_browser_always_asks_and_offers_no_session_choice() {
        for granted in [false, true] {
            assert_eq!(
                decide(
                    curated("browser_click").unwrap(),
                    false,
                    granted,
                    true,
                    true
                ),
                GateDecision::Ask {
                    session_option: false
                },
                "granted: {granted}"
            );
        }
        // Looking is still free there.
        assert_eq!(
            decide(
                curated("get_browser_state").unwrap(),
                false,
                false,
                true,
                true
            ),
            GateDecision::Run
        );
    }

    #[test]
    fn grants_are_kept_per_runtime() {
        assert_eq!(grant_name(RuntimeKind::Desktop, "click"), "desktop:click");
        assert_ne!(
            grant_name(RuntimeKind::Browser, "browser_click"),
            grant_name(RuntimeKind::SignedInBrowser, "browser_click")
        );
    }

    #[test]
    fn a_deny_rule_blocks_even_observation() {
        for name in [
            "list_windows",
            "get_browser_state",
            "start_session",
            "click",
        ] {
            assert_eq!(
                decide(curated(name).unwrap(), true, true, false, true),
                GateDecision::Refuse(DENIED_TEXT),
                "{name}"
            );
        }
    }

    #[test]
    fn escape_and_unknown_dialog_results_mean_dont_allow() {
        let three = labels("Allow for this chat");
        assert_eq!(
            answer_from_dialog(&MessageDialogResult::Cancel, &three),
            Answer::Deny
        );
        assert_eq!(
            answer_from_dialog(&MessageDialogResult::Custom("weird".into()), &three),
            Answer::Deny
        );
        assert_eq!(
            answer_from_dialog(&MessageDialogResult::Custom("Don't allow".into()), &three),
            Answer::Deny
        );
        assert_eq!(
            answer_from_dialog(&MessageDialogResult::Ok, &three),
            Answer::Once
        );
        assert_eq!(
            answer_from_dialog(&MessageDialogResult::Yes, &three),
            Answer::Once
        );
        assert_eq!(
            answer_from_dialog(&MessageDialogResult::No, &three),
            Answer::Session
        );
        assert_eq!(
            answer_from_dialog(
                &MessageDialogResult::Custom("Allow for this chat".into()),
                &three
            ),
            Answer::Session
        );
        let two = labels("");
        assert_eq!(
            answer_from_dialog(&MessageDialogResult::No, &two),
            Answer::Deny
        );
        assert_eq!(
            answer_from_dialog(&MessageDialogResult::Custom(String::new()), &two),
            Answer::Deny
        );
    }

    #[test]
    fn grant_store_keeps_at_most_256_keys() {
        let mut grants = GrantStore::default();
        for index in 0..300 {
            grants.grant(&format!("chat:{index}"), "click");
        }
        assert!(!grants.has("chat:0", "click"));
        assert!(!grants.has("chat:43", "click"));
        assert!(grants.has("chat:44", "click"));
        assert!(grants.has("chat:299", "click"));
        grants.grant("chat:299", "type_text");
        assert!(grants.has("chat:299", "type_text"));
        grants.clear_key("chat:299");
        assert!(!grants.has("chat:299", "click"));
        grants.clear_all();
        assert!(!grants.has("chat:298", "click"));
    }

    fn message(tool: &str, args: Value) -> String {
        approval_message(
            "assistant",
            curated(tool).unwrap(),
            &args,
            None,
            false,
            &DialogContext::default(),
            &english,
        )
        .message
    }

    #[test]
    fn single_actions_name_the_action_and_the_detail() {
        let text = message(
            "type_text",
            json!({"text": "Results section", "session": "x"}),
        );
        assert!(
            text.starts_with("Assistant wants to type in an app."),
            "{text}"
        );
        assert!(text.contains("Results section"));
        let text = message(
            "browser_navigate",
            json!({"url": "https://journal.example.org/submit"}),
        );
        assert!(
            text.contains("https://journal.example.org/submit"),
            "{text}"
        );
        let text = message(
            "click",
            json!({"pid": 4, "element_index": 7, "password": "hunter2"}),
        );
        assert!(
            text.contains("element_index") && !text.contains("hunter2"),
            "{text}"
        );
    }

    #[test]
    fn a_signed_in_action_says_so_and_names_the_site_when_it_is_known() {
        let ask = |tool: &str, args: Value, signed_in: bool| {
            approval_message(
                "assistant",
                curated(tool).unwrap(),
                &args,
                None,
                signed_in,
                &DialogContext::default(),
                &english,
            )
            .message
        };
        let navigate = ask(
            "browser_navigate",
            json!({"url": "https://Journal.example.org:8443/submit?id=1"}),
            true,
        );
        assert!(
            navigate.contains(
                "This acts in your own signed-in browser, on https://journal.example.org:8443."
            ),
            "{navigate}"
        );
        assert!(navigate.contains("Address: https://Journal.example.org:8443/submit?id=1"));
        let click = ask("browser_click", json!({"ref": "e4"}), true);
        assert!(
            click.contains("This acts in your own signed-in browser.")
                && !click.contains("browser, on "),
            "{click}"
        );
        let separate = ask(
            "browser_navigate",
            json!({"url": "https://journal.example.org"}),
            false,
        );
        assert!(!separate.contains("signed-in"), "{separate}");
    }

    #[test]
    fn a_cut_text_or_address_says_how_much_is_not_shown() {
        let text = message(
            "type_text",
            json!({"text": "a".repeat(MAX_TEXT_CHARS + 1234)}),
        );
        assert!(text.contains(&"a".repeat(MAX_TEXT_CHARS)), "{text}");
        assert!(!text.contains(&"a".repeat(MAX_TEXT_CHARS + 1)));
        assert!(text.ends_with("(characters not shown: 1234)"), "{text}");
        let exact = message("type_text", json!({"text": "a".repeat(MAX_TEXT_CHARS)}));
        assert!(!exact.contains("not shown"), "{exact}");
        let address = message(
            "browser_navigate",
            json!({"url": format!("https://a.org/{}", "p".repeat(700))}),
        );
        assert!(address.contains("characters not shown"), "{address}");
        let script = message(
            "run_script",
            json!({"script": "x".repeat(MAX_SCRIPT_CHARS + 50)}),
        );
        assert!(script.contains("characters not shown"), "{script}");
        assert!(script.chars().count() <= MAX_MESSAGE_CHARS);
    }

    #[test]
    fn a_batch_lists_its_steps_within_bounds() {
        let steps = vec![
            Step {
                tool: "click".into(),
                args: json!({"x": 1}),
            },
            Step {
                tool: "type_text".into(),
                args: json!({"text": "hi"}),
            },
            Step {
                tool: "press_key".into(),
                args: json!({"key": "return"}),
            },
        ];
        let approval = approval_message(
            "assistant",
            curated("run_steps").unwrap(),
            &json!({}),
            Some(&steps),
            false,
            &DialogContext::default(),
            &english,
        );
        assert_eq!(approval.shown_steps, 3);
        let lines: Vec<&str> = approval.message.lines().collect();
        assert!(lines[1].starts_with("1. click"), "{}", approval.message);
        assert!(lines[2].starts_with("2. type_text"), "{}", approval.message);
        assert!(lines[3].starts_with("3. press_key"), "{}", approval.message);

        let long: Vec<Step> = (0..64)
            .map(|_| Step {
                tool: "type_text".into(),
                args: json!({"text": "a".repeat(1000)}),
            })
            .collect();
        let approval = approval_message(
            "assistant",
            curated("run_steps").unwrap(),
            &json!({}),
            Some(&long),
            false,
            &DialogContext::default(),
            &english,
        );
        let message = approval.message;
        assert!(
            message.chars().count() <= MAX_MESSAGE_CHARS,
            "{}",
            message.chars().count()
        );
        let last = message.lines().last().unwrap();
        assert!(last.starts_with("Steps not shown and not run: "), "{last}");
        let shown = message
            .lines()
            .filter(|line| line.contains(". type_text"))
            .count();
        assert_eq!(last, format!("Steps not shown and not run: {}", 64 - shown));
        assert_eq!(approval.shown_steps, shown);
        assert!(shown < 64);
        for line in message.lines().skip(1) {
            assert!(line.chars().count() <= MAX_STEP_LINE_CHARS, "{line}");
        }
        // A step line that was cut says by how much.
        let second = message.lines().nth(1).unwrap();
        assert!(
            second.contains("(characters not shown: ") && second.ends_with(')'),
            "{second}"
        );
    }

    #[test]
    fn counts_read_right_when_only_one_thing_is_left_out() {
        let text = message("type_text", json!({"text": "a".repeat(MAX_TEXT_CHARS + 1)}));
        assert!(text.ends_with("(characters not shown: 1)"), "{text}");
        let items: Vec<u32> = (0..65).collect();
        let text = message("set_value", json!({ "value": items }));
        assert!(text.contains("Items not shown: 1"), "{text}");
    }

    /// The built-in agent's limit for one tool call (`oleafly-agent`'s
    /// `MAX_TOOL_EXECUTION_DURATION`).
    const AGENT_TOOL_DEADLINE: Duration = Duration::from_secs(5 * 60);

    #[test]
    fn a_dialog_never_outlasts_the_call_that_asked() {
        assert_eq!(approval_wait(Surface::Acp), Duration::from_secs(90));
        assert_eq!(approval_wait(Surface::Chat), Duration::from_secs(180));
        assert_eq!(approval_wait(Surface::Task), Duration::from_secs(180));
        // An approval at the last moment still leaves a batch its full time.
        for surface in [Surface::Chat, Surface::Task] {
            assert!(
                approval_wait(surface) + crate::cua_driver::runtime::BATCH_TIMEOUT
                    < AGENT_TOOL_DEADLINE
            );
        }
    }

    #[test]
    fn single_actions_show_every_argument_with_the_text_first() {
        let text = message(
            "type_text",
            json!({"pid": 4312, "element_token": "el-9", "text": "Thanks"}),
        );
        let lines: Vec<&str> = text.lines().collect();
        let headline = lines.iter().position(|line| *line == "Text: \"Thanks\"");
        let rest = lines
            .iter()
            .position(|line| line.contains("\"element_token\":\"el-9\"") && line.contains("4312"));
        assert!(
            headline.is_some() && rest.is_some() && headline < rest,
            "{text}"
        );
        // Whatever else comes with a text is listed too.
        let launch = message(
            "launch_app",
            json!({"bundle_id": "org.zotero.zotero", "webkit_inspector_port": 9222, "text": "Opening Zotero"}),
        );
        assert!(
            launch.contains("webkit_inspector_port") && launch.contains("org.zotero.zotero"),
            "{launch}"
        );
    }

    #[test]
    fn an_address_given_to_a_click_never_names_the_signed_in_site() {
        let click = approval_message(
            "assistant",
            curated("browser_click").unwrap(),
            &json!({"ref": "e9", "url": "https://journal.example.org"}),
            None,
            true,
            &DialogContext::default(),
            &english,
        )
        .message;
        assert!(
            click.contains("This acts in your own signed-in browser.")
                && !click.contains("browser, on "),
            "{click}"
        );
        // The tab as last seen does.
        let seen = approval_message(
            "assistant",
            curated("browser_click").unwrap(),
            &json!({"ref": "e9"}),
            None,
            true,
            &DialogContext {
                origin: Some("https://library.example.edu".into()),
                ..DialogContext::default()
            },
            &english,
        )
        .message;
        assert!(
            seen.contains(
                "This acts in your own signed-in browser, on https://library.example.edu."
            ),
            "{seen}"
        );
    }

    #[test]
    fn dialogs_name_the_task_app_window_and_element() {
        let context = DialogContext {
            task: Some("Export the survey data".into()),
            target: Target {
                app: Some("Zotero".into()),
                window: Some("My Library".into()),
                element: Some("Button \"Export\"".into()),
            },
            ..DialogContext::default()
        };
        let text = approval_message(
            "research task",
            curated("click").unwrap(),
            &json!({"element_token": "el-1"}),
            None,
            false,
            &context,
            &english,
        )
        .message;
        for line in [
            "Research task wants to click in an app.",
            "Task: Export the survey data",
            "App: Zotero",
            "Window: My Library",
            "Element: Button \"Export\"",
        ] {
            assert!(text.lines().any(|shown| shown == line), "{line}: {text}");
        }
        let steps = vec![Step {
            tool: "click".into(),
            args: json!({"element_token": "el-1"}),
        }];
        let batch = approval_message(
            "research task",
            curated("run_steps").unwrap(),
            &json!({}),
            Some(&steps),
            false,
            &DialogContext {
                steps: vec![context.target.clone()],
                ..context
            },
            &english,
        )
        .message;
        assert!(
            batch.contains("Task: Export the survey data")
                && batch.contains("1. click (Zotero, Button \"Export\")"),
            "{batch}"
        );
    }

    #[test]
    fn what_the_driver_saw_names_the_target_of_an_action() {
        let mut seen = Seen::default();
        seen.record(
            "run:a",
            RuntimeKind::Desktop,
            "list_windows",
            &json!({}),
            &json!({"structuredContent": {"windows": [
                {"pid": 4312, "window_id": 88, "app_name": "Zotero", "title": "My Library"}
            ]}}),
        );
        seen.record(
            "run:a",
            RuntimeKind::Desktop,
            "get_window_state",
            &json!({"pid": 4312, "window_id": 88}),
            &json!({"structuredContent": {"snapshot_id": "s1", "elements": [
                {"element_index": 3, "element_token": "el-3", "role": "AXButton", "label": "Export", "value": "secret typed text"},
                {"element_index": 4, "role": "AXTextField\u{202e}"}
            ]}}),
        );
        assert_eq!(
            seen.target(&json!({"element_token": "el-3"})),
            Target {
                app: Some("Zotero".into()),
                window: Some("My Library".into()),
                element: Some("Button \"Export\"".into()),
            }
        );
        assert_eq!(
            seen.target(&json!({"snapshot_id": "s1", "element_index": 4, "pid": 4312}))
                .element,
            Some("TextField".into())
        );
        assert_eq!(seen.target(&json!({"pid": 1})), Target::default());
        // An error answer teaches nothing.
        seen.record(
            "run:a",
            RuntimeKind::Desktop,
            "list_windows",
            &json!({}),
            &json!({"isError": true, "structuredContent": {"windows": [{"pid": 1, "app_name": "Fake"}]}}),
        );
        assert_eq!(seen.target(&json!({"pid": 1})).app, None);
    }

    #[test]
    fn with_asking_off_actions_run_and_deny_rules_still_refuse() {
        for name in ["click", "run_script", "browser_click", "launch_app"] {
            for signed_in in [false, true] {
                assert_eq!(
                    decide(curated(name).unwrap(), false, false, signed_in, false),
                    GateDecision::Run,
                    "{name}"
                );
            }
            assert_eq!(
                decide(curated(name).unwrap(), true, false, false, false),
                GateDecision::Refuse(DENIED_TEXT)
            );
        }
    }

    #[test]
    fn a_missing_pid_comes_from_the_window_or_snapshot_the_driver_showed() {
        let mut seen = Seen::default();
        seen.record(
            "run:a",
            RuntimeKind::Desktop,
            "list_windows",
            &json!({}),
            &json!({"structuredContent": {"windows": [
                {"pid": 52508, "window_id": 178776, "app_name": "TextEdit", "title": ""}
            ]}}),
        );
        // 0.38's window read: no elements, and tokens are `<snapshot_id>:<row>`.
        seen.record(
            "run:a",
            RuntimeKind::Desktop,
            "get_window_state",
            &json!({"pid": 52508, "window_id": 178776}),
            &json!({"structuredContent": {
                "pid": 52508, "window_id": 178776, "app_name": "TextEdit",
                "window_title": "Untitled.txt", "snapshot_id": "s00000001"
            }}),
        );
        let filled = |args: Value| {
            let Value::Object(mut map) = args else {
                unreachable!()
            };
            seen.fill_pid(&mut map);
            map.get("pid").cloned()
        };
        assert_eq!(filled(json!({"window_id": 178776})), Some(json!(52508)));
        assert_eq!(
            filled(json!({"element_token": "s00000001:1", "text": "hi"})),
            Some(json!(52508))
        );
        // A pid the call gives is kept, and nothing is made up.
        assert_eq!(
            filled(json!({"pid": 7, "window_id": 178776})),
            Some(json!(7))
        );
        assert_eq!(filled(json!({"window_id": 5, "text": "hi"})), None);
        assert_eq!(filled(json!({"element_token": "s0000000f:1"})), None);
        // The dialog can name the window an element token is in.
        assert_eq!(
            seen.target(&json!({"element_token": "s00000001:1"})),
            Target {
                app: Some("TextEdit".into()),
                window: Some("Untitled.txt".into()),
                element: None,
            }
        );
        // The turn's end takes its snapshots along; another session's
        // stay, and a driver that reuses the id makes it current again.
        let read = |snapshot: &str| json!({"structuredContent": {"pid": 52508, "window_id": 178776, "snapshot_id": snapshot}});
        let state = RuntimeKind::Desktop;
        seen.record(
            "run:b",
            state,
            "get_window_state",
            &json!({}),
            &read("s00000002"),
        );
        assert!(!seen.names_ended_snapshot(&json!({"element_token": "s00000001:1"})));
        seen.forget_session("run:a");
        assert!(seen.names_ended_snapshot(&json!({"element_token": "s00000001:1"})));
        assert!(!seen.names_ended_snapshot(&json!({"element_token": "s00000002:1"})));
        assert!(!seen.names_ended_snapshot(&json!({"element_token": "s0000000f:1"})));
        seen.record(
            "run:c",
            state,
            "get_window_state",
            &json!({}),
            &read("s00000001"),
        );
        assert!(!seen.names_ended_snapshot(&json!({"element_token": "s00000001:1"})));
    }

    #[test]
    fn the_signed_in_tab_is_learned_from_where_it_went_and_what_it_shows() {
        let mut seen = Seen::default();
        seen.record(
            "run:a",
            RuntimeKind::SignedInBrowser,
            "browser_navigate",
            &json!({"url": "https://journal.example.org/submit"}),
            &json!({"content": [{"type": "text", "text": "ok"}]}),
        );
        assert_eq!(
            seen.origin("run:a").as_deref(),
            Some("https://journal.example.org")
        );
        seen.record(
            "run:a",
            RuntimeKind::SignedInBrowser,
            "get_browser_state",
            &json!({}),
            &json!({"structuredContent": {"url": "https://library.example.edu/x"}}),
        );
        assert_eq!(
            seen.origin("run:a").as_deref(),
            Some("https://library.example.edu")
        );
        // The separate profile never counts for the signed-in line.
        seen.record(
            "run:b",
            RuntimeKind::Browser,
            "browser_navigate",
            &json!({"url": "https://a.org"}),
            &json!({}),
        );
        assert_eq!(seen.origin("run:b"), None);
        seen.forget_session("run:a");
        assert_eq!(seen.origin("run:a"), None);
    }
}
