//! The approval gate for desktop apps. Observation runs; every action asks
//! through a native dialog first; a deny rule for `desktop_apps` blocks
//! everything. Approval modes (Full access included) and allow rules never
//! skip these prompts: they were granted for files and commands, and allow
//! rules can be written from the renderer.

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::policy::{clipped, preview_clipped, CuratedTool, Step, ToolClass};
use super::{BoxFuture, CuaScope, RuntimeKind, Surface};

pub(crate) const DENIED_TEXT: &str =
    "Desktop apps are denied for this project in the approval rules.";
pub(crate) const MAX_MESSAGE_CHARS: usize = 6_000;
const MAX_STEP_LINE_CHARS: usize = 160;
const MAX_TEXT_CHARS: usize = 200;
const MAX_ADDRESS_CHARS: usize = 500;
const MAX_PREVIEW_CHARS: usize = 600;
const MAX_SCRIPT_CHARS: usize = 4_000;
const MAX_GRANT_KEYS: usize = 256;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum GateDecision {
    Run,
    Ask { session_option: bool },
    Refuse(&'static str),
}

/// What the gate does with one call. `granted` says the user already allowed
/// this tool for the chat, session or task. A call in the user's own
/// signed-in browser never takes part in grants: it asks every time, and the
/// dialog has no "Allow for this chat" choice.
pub(crate) fn decide(
    tool: &CuratedTool,
    denied_by_rules: bool,
    granted: bool,
    signed_in: bool,
) -> GateDecision {
    if denied_by_rules {
        return GateDecision::Refuse(DENIED_TEXT);
    }
    let session_grant = tool.session_grant && !signed_in;
    match tool.class {
        ToolClass::Session | ToolClass::Observe => GateDecision::Run,
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
    /// Steps of a batch the message lists (0 for a single action). The rest
    /// run too when the batch is allowed, but the user never saw them.
    pub shown_steps: usize,
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

fn step_line(index: usize, step: &Step, t: &Translate<'_>) -> String {
    let more = more_items(t);
    let detail = super::policy::preview_text(&step.args, &more);
    let line = format!("{}. {} {}", index + 1, step.tool, detail);
    clip_with_note(line.trim_end(), MAX_STEP_LINE_CHARS, t)
}

/// The origin an address belongs to (`https://host[:port]`), when it is one.
fn origin_of(url: &str) -> Option<String> {
    let parsed = tauri::Url::parse(url.trim()).ok()?;
    matches!(parsed.scheme(), "http" | "https")
        .then(|| parsed.origin().ascii_serialization())
        .filter(|origin| origin != "null")
}

fn signed_in_line(args: &Value, t: &Translate<'_>) -> String {
    match args.get("url").and_then(Value::as_str).and_then(origin_of) {
        Some(origin) => t("dialog.desktopApps.signedInOn", &[("origin", &origin)]),
        None => t("dialog.desktopApps.signedIn", &[]),
    }
}

/// The dialog text: what the agent wants to do, then the detail. A batch
/// lists every step it has room for, each line and the whole message
/// bounded, and says what it cut: characters of a line or text, the steps
/// it left out. `signed_in` adds a line that the action happens in the
/// user's own signed-in browser.
pub(crate) fn approval_message(
    agent: &str,
    tool: &CuratedTool,
    args: &Value,
    steps: Option<&[Step]>,
    signed_in: bool,
    t: &Translate<'_>,
) -> Approval {
    let agent = capitalized(agent);
    if let Some(steps) = steps {
        let mut message = t("dialog.desktopApps.steps", &[("agent", &agent)]);
        let mut shown_steps = 0;
        for (index, step) in steps.iter().enumerate() {
            let line = step_line(index, step, t);
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
        message.push_str(&signed_in_line(args, t));
    }
    let more = more_items(t);
    let detail = if tool.name == "run_script" {
        let (shown, cut) = preview_clipped(args, MAX_SCRIPT_CHARS, &more);
        with_cut(shown, cut, t)
    } else if let Some(text) = args.get("text").and_then(Value::as_str) {
        let (shown, cut) = clipped(text, MAX_TEXT_CHARS);
        with_cut(t("dialog.desktopApps.text", &[("text", &shown)]), cut, t)
    } else if let Some(url) = args.get("url").and_then(Value::as_str) {
        let (shown, cut) = clipped(url, MAX_ADDRESS_CHARS);
        with_cut(t("dialog.desktopApps.address", &[("url", &shown)]), cut, t)
    } else {
        let (shown, cut) = preview_clipped(args, MAX_PREVIEW_CHARS, &more);
        with_cut(shown, cut, t)
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

/// Asks the user. Implementations answer `Deny` once `wait` has passed.
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
        Surface::Chat | Surface::Task => Duration::from_secs(10 * 60),
        Surface::Acp => Duration::from_secs(90),
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
    turn: tokio::sync::Mutex<()>,
}

impl NativeApprover {
    pub(crate) fn new(app: tauri::AppHandle) -> Self {
        Self {
            app,
            turn: tokio::sync::Mutex::new(()),
        }
    }
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
            let Ok(_turn) = tokio::time::timeout(wait, self.turn.lock()).await else {
                return Answer::Deny;
            };
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
                        let _ = sender.send(answer_from_dialog(&result, &chosen));
                    });
            } else {
                dialog
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        labels.once.clone(),
                        labels.deny.clone(),
                    ))
                    .show(move |allowed| {
                        let _ = sender.send(if allowed { Answer::Once } else { Answer::Deny });
                    });
            }
            // A late answer finds the receiver gone and changes nothing.
            match tokio::time::timeout(deadline.saturating_duration_since(Instant::now()), receiver)
                .await
            {
                Ok(Ok(answer)) => answer,
                _ => Answer::Deny,
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
                    return Answer::Deny;
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
            decide(curated("list_windows").unwrap(), false, false, false),
            GateDecision::Run
        );
        assert_eq!(
            decide(curated("start_session").unwrap(), false, false, false),
            GateDecision::Run
        );
        assert_eq!(
            decide(curated("click").unwrap(), false, false, false),
            GateDecision::Ask {
                session_option: true
            }
        );
        assert_eq!(
            decide(curated("click").unwrap(), false, true, false),
            GateDecision::Run
        );
        assert_eq!(
            decide(curated("run_script").unwrap(), false, true, false),
            GateDecision::Ask {
                session_option: false
            }
        );
    }

    #[test]
    fn the_signed_in_browser_always_asks_and_offers_no_session_choice() {
        for granted in [false, true] {
            assert_eq!(
                decide(curated("browser_click").unwrap(), false, granted, true),
                GateDecision::Ask {
                    session_option: false
                },
                "granted: {granted}"
            );
        }
        // Looking is still free there.
        assert_eq!(
            decide(curated("get_browser_state").unwrap(), false, false, true),
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
                decide(curated(name).unwrap(), true, true, false),
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
        assert!(text.ends_with("(+1234 characters not shown)"), "{text}");
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
            &english,
        );
        let message = approval.message;
        assert!(
            message.chars().count() <= MAX_MESSAGE_CHARS,
            "{}",
            message.chars().count()
        );
        let last = message.lines().last().unwrap();
        assert!(last.starts_with("Steps not shown: "), "{last}");
        let shown = message
            .lines()
            .filter(|line| line.contains(". type_text"))
            .count();
        assert_eq!(last, format!("Steps not shown: {}", 64 - shown));
        assert_eq!(approval.shown_steps, shown);
        assert!(shown < 64);
        for line in message.lines().skip(1) {
            assert!(line.chars().count() <= MAX_STEP_LINE_CHARS, "{line}");
        }
        // A step line that was cut says by how much.
        let second = message.lines().nth(1).unwrap();
        assert!(second.ends_with("characters not shown)"), "{second}");
    }

    #[test]
    fn waits_differ_by_surface() {
        assert_eq!(approval_wait(Surface::Acp), Duration::from_secs(90));
        assert_eq!(approval_wait(Surface::Chat), Duration::from_secs(600));
        assert_eq!(approval_wait(Surface::Task), Duration::from_secs(600));
    }
}
