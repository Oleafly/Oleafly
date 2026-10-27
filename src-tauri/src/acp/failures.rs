use crate::app_error::{map_values, AppError};
use oleafly_acp::{redact::Redactor, ErrorKind, RpcError};

pub(super) const START_CANCELLED: &str = "acp.start.cancelled";
pub(crate) const OWNER_CLOSED: &str = "acp.start.owner_closed";
pub(super) const ALREADY_CONNECTED: &str = "acp.start.already_connected";
pub(super) const TOO_MANY_SESSIONS: &str = "acp.start.session_limit";
pub(super) const ONLY_V1: &str = "acp.start.v1_only";
pub(super) const CANNOT_RESUME: &str = "acp.start.cannot_resume";
pub(super) const CONVERSATION_GONE: &str = "acp.start.conversation_gone";
pub(super) const NOT_INSTALLED: &str = "acp.start.not_installed";
pub(super) const CHOSEN_PROGRAM_MISSING: &str = "acp.start.program_missing";
pub(super) const NODE_NEEDED: &str = "acp.start.node_needed";
pub(super) const REMOTE_NOT_SET_UP: &str = "acp.start.remote_not_set_up";
pub(super) const SSH_MISSING: &str = "acp.start.ssh_missing";
pub(super) const MOVED_TO_LOCAL: &str = "acp.start.moved_to_local";
pub(super) const MOVED_TO_REMOTE: &str = "acp.start.moved_to_remote";
pub(super) const MOVED_MACHINE: &str = "acp.start.moved_machine";
pub(super) const MOVED_PROFILE: &str = "acp.start.moved_profile";
pub(super) const SIGN_IN: &str = "acp.session.sign_in";
pub(super) const CLAUDE_GATEWAY: &str = "acp.session.claude_gateway";
pub(super) const NPM_UNREACHABLE: &str = "acp.install.npm_unreachable";
pub(super) const NPM_TIMED_OUT: &str = "acp.install.npm_timed_out";
pub(super) const TRANSCRIPT_NOT_SAVED: &str = "acp.session.transcript_not_saved";
pub(super) const TRANSCRIPT_FULL: &str = "acp.session.transcript_full";
pub(super) const NO_STOP_REASON: &str = "acp.turn.no_stop_reason";
pub(super) const STOPPED_EARLY: &str = "acp.turn.stopped_early";
pub(super) const CODEX_TURN_ERROR: &str = "acp.turn.codex_error";
pub(super) const EMPTY_TURN: &str = "acp.notice.empty_turn";
pub(super) const EMPTY_TURN_ADVICE: &str = "acp.notice.empty_turn_advice";
pub(super) const OUTSIDE_PROJECT: &str = "acp.notice.outside_project";
pub(super) const OUTSIDE_PROJECT_PATH: &str = "acp.notice.outside_project_path";
pub(super) const OUTSIDE_PROJECT_RULE: &str = "acp.notice.outside_project_rule";
pub(super) const HERMES_TOOLS_LOST: &str = "acp.notice.hermes_tools_lost";
pub(super) const HERMES_TOOLS_ADVICE: &str = "acp.notice.hermes_tools_advice";
pub(super) const ROUTE_FAILED: &str = "acp.notice.route_failed";
pub(super) const UNROUTE_FAILED: &str = "acp.notice.unroute_failed";
pub(super) const CODEX_OPENAI_ONLY: &str = "acp.notice.codex_openai_only";
pub(super) const NO_SAVED_KEY: &str = "acp.notice.no_saved_key";
pub(super) const KEY_KIND_UNSUPPORTED: &str = "acp.notice.key_kind_unsupported";

pub(super) fn coded(code: &'static str) -> String {
    AppError::new(code).into()
}

#[cfg(test)]
pub(crate) fn is_code(text: &str, code: &str) -> bool {
    crate::app_error::code(text).as_deref() == Some(code)
}

fn quoting(
    error: &RpcError,
    plain: &'static str,
    with_output: &'static str,
    command_help: &'static str,
) -> AppError {
    match error.output.as_deref() {
        Some(_) if error.command_help() => AppError::new(command_help),
        Some(output) => AppError::new(with_output).param("output", output),
        None => AppError::new(plain),
    }
}

pub(super) fn rpc_message(error: &RpcError) -> String {
    let coded = match &error.kind {
        None => return error.message.clone(),
        Some(ErrorKind::Disconnected) => quoting(
            error,
            "acp.session.disconnected",
            "acp.session.disconnected_with_output",
            "acp.session.disconnected_command_help",
        ),
        Some(ErrorKind::DisconnectedBeforeReply) => quoting(
            error,
            "acp.session.no_reply",
            "acp.session.no_reply_with_output",
            "acp.session.no_reply_command_help",
        ),
        Some(ErrorKind::TimedOutStopped) => quoting(
            error,
            "acp.session.timed_out_stopped",
            "acp.session.timed_out_stopped_with_output",
            "acp.session.timed_out_stopped_command_help",
        ),
        Some(ErrorKind::TimedOut) => AppError::new("acp.session.timed_out"),
        Some(ErrorKind::Silent { minutes }) => {
            AppError::new("acp.session.silent").param("minutes", minutes)
        }
        Some(ErrorKind::SpawnFailed { kind, path }) => AppError::new("acp.start.spawn_failed")
            .param("kind", kind)
            .param("path", path),
        Some(ErrorKind::NotConnected) => AppError::new("acp.session.not_connected"),
    };
    coded.into()
}

pub(super) fn redacted(redactor: &Redactor, text: &str) -> String {
    map_values(text, |value| redactor.text(value))
}

pub(super) fn not_acp(version: u16) -> String {
    AppError::new("acp.start.unsupported_version")
        .param("version", version)
        .into()
}

pub(super) fn routing(code: &'static str, provider: &str) -> String {
    AppError::new(code).param("provider", provider).into()
}

pub(super) fn outside_project(path: Option<&str>) -> String {
    match path {
        Some(path) => AppError::new(OUTSIDE_PROJECT_PATH)
            .param("path", path)
            .into(),
        None => coded(OUTSIDE_PROJECT_RULE),
    }
}

pub(super) fn node_missing(required: u32) -> String {
    AppError::new("acp.start.node_missing")
        .param("required", required)
        .into()
}

pub(super) fn node_outdated(required: u32, major: u32) -> String {
    AppError::new("acp.start.node_outdated")
        .param("required", required)
        .param("major", major)
        .into()
}

pub(super) fn bridge_outdated(package: &str, found: &str, pinned: &str) -> String {
    AppError::new("acp.start.bridge_outdated")
        .param("package", package)
        .param("found", found)
        .param("pinned", pinned)
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_error::{code, english};

    fn params(text: &str) -> serde_json::Value {
        let json: serde_json::Value =
            serde_json::from_str(text.strip_prefix(crate::app_error::PREFIX).unwrap()).unwrap();
        json["params"].clone()
    }

    #[test]
    fn every_connection_failure_maps_to_its_code_and_params() {
        let cases = [
            (ErrorKind::Disconnected, "", "acp.session.disconnected"),
            (
                ErrorKind::Disconnected,
                "panic: boom",
                "acp.session.disconnected_with_output",
            ),
            (
                ErrorKind::Disconnected,
                "Usage: agent [OPTIONS]",
                "acp.session.disconnected_command_help",
            ),
            (
                ErrorKind::DisconnectedBeforeReply,
                "",
                "acp.session.no_reply",
            ),
            (
                ErrorKind::DisconnectedBeforeReply,
                "panic: boom",
                "acp.session.no_reply_with_output",
            ),
            (
                ErrorKind::DisconnectedBeforeReply,
                "error: see --help",
                "acp.session.no_reply_command_help",
            ),
            (
                ErrorKind::TimedOutStopped,
                "",
                "acp.session.timed_out_stopped",
            ),
            (
                ErrorKind::TimedOutStopped,
                "Error: connect ETIMEDOUT",
                "acp.session.timed_out_stopped_with_output",
            ),
            (
                ErrorKind::TimedOutStopped,
                "Options:\n  --acp",
                "acp.session.timed_out_stopped_command_help",
            ),
            (ErrorKind::TimedOut, "", "acp.session.timed_out"),
            (ErrorKind::Silent { minutes: 20 }, "", "acp.session.silent"),
            (
                ErrorKind::SpawnFailed {
                    kind: "PermissionDenied".into(),
                    path: "/opt/agent".into(),
                },
                "",
                "acp.start.spawn_failed",
            ),
            (ErrorKind::NotConnected, "", "acp.session.not_connected"),
        ];
        for (kind, output, expected) in cases {
            let error = RpcError::connection(kind, output);
            let text = rpc_message(&error);
            assert_eq!(code(&text).as_deref(), Some(expected), "{text}");
            assert_eq!(english(&text).as_deref(), Some(error.message.as_str()));
        }
        let quoted = rpc_message(&RpcError::connection(
            ErrorKind::Disconnected,
            "panic: boom",
        ));
        assert_eq!(params(&quoted)["output"], "panic: boom");
        let silent = rpc_message(&RpcError::connection(ErrorKind::Silent { minutes: 20 }, ""));
        assert_eq!(params(&silent)["minutes"], "20");
        let spawn = rpc_message(&RpcError::connection(
            ErrorKind::SpawnFailed {
                kind: "NotFound".into(),
                path: "/opt/agent".into(),
            },
            "",
        ));
        assert_eq!(params(&spawn)["kind"], "NotFound");
        assert_eq!(params(&spawn)["path"], "/opt/agent");
    }

    #[test]
    fn an_agent_error_keeps_the_agent_s_own_words() {
        let error = RpcError::agent(-32000, "Authentication required".into());
        assert_eq!(rpc_message(&error), "Authentication required");
        assert_eq!(rpc_message(&RpcError::local("plain")), "plain");
    }

    #[test]
    fn every_code_renders_in_english() {
        let english_of = |text: String| english(&text).unwrap_or_else(|| panic!("{text}"));
        let plain = [
            (START_CANCELLED, "The start was cancelled."),
            (
                OWNER_CLOSED,
                "The window or task closed while the agent was starting.",
            ),
            (ALREADY_CONNECTED, "This ACP session is already connected."),
            (
                TOO_MANY_SESSIONS,
                "Eight ACP sessions are already connected. Disconnect one before starting another.",
            ),
            (ONLY_V1, "The agent only supports ACP version 1."),
            (
                CANNOT_RESUME,
                "This agent cannot resume saved sessions. Start a new conversation to continue working.",
            ),
            (
                CONVERSATION_GONE,
                "The agent no longer has this conversation. Start a new one.",
            ),
            (
                NOT_INSTALLED,
                "This agent isn't installed yet. Install it, or choose its program in Settings.",
            ),
            (
                MOVED_TO_LOCAL,
                "This conversation ran on another machine, and Hermes now runs on this computer. Start a new conversation to continue.",
            ),
            (
                MOVED_TO_REMOTE,
                "This conversation ran on this computer, and Hermes now runs on another machine. Start a new conversation to continue.",
            ),
            (
                MOVED_MACHINE,
                "This conversation ran on another machine than the one Hermes uses now. Start a new conversation to continue.",
            ),
            (
                MOVED_PROFILE,
                "This conversation ran in another Hermes profile. Switch the project back to that profile or start a new conversation.",
            ),
            (
                CHOSEN_PROGRAM_MISSING,
                "The program chosen for this agent is missing. Choose it again in Settings.",
            ),
            (NODE_NEEDED, "Install Node.js to run this agent."),
            (
                REMOTE_NOT_SET_UP,
                "Set up the remote machine for Hermes in its settings first.",
            ),
            (
                SSH_MISSING,
                "Oleafly couldn't find ssh on this computer. Install OpenSSH, then try again.",
            ),
            (SIGN_IN, "Sign in to this agent, then try again."),
            (
                CLAUDE_GATEWAY,
                "Claude Code uses a custom API endpoint. Check ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN in your shell profile or Claude Code's settings.json, then reconnect.",
            ),
            (
                TRANSCRIPT_NOT_SAVED,
                "The ACP transcript could not be saved. The agent was stopped to preserve the saved history.",
            ),
            (
                TRANSCRIPT_FULL,
                "This session reached its transcript size limit. Start a new conversation.",
            ),
            (
                NO_STOP_REASON,
                "The agent did not report how this turn ended.",
            ),
            (
                STOPPED_EARLY,
                "The agent stopped before completing this turn.",
            ),
            (CODEX_TURN_ERROR, "Codex stopped this turn with an error."),
            (EMPTY_TURN, "The agent ended its turn without replying."),
            (
                EMPTY_TURN_ADVICE,
                "Check the agent's model and sign-in, then try again.",
            ),
            (
                OUTSIDE_PROJECT,
                "Oleafly refused a request outside this project.",
            ),
            (
                OUTSIDE_PROJECT_RULE,
                "Agents can only use files inside the project.",
            ),
            (
                HERMES_TOOLS_LOST,
                "Hermes lost the project tools when its model changed.",
            ),
            (HERMES_TOOLS_ADVICE, "Reconnect to restore them."),
            (CODEX_OPENAI_ONLY, "Codex can only use an OpenAI key."),
            (NO_SAVED_KEY, "There is no saved key for this provider."),
            (
                KEY_KIND_UNSUPPORTED,
                "This agent cannot use this kind of key.",
            ),
        ];
        for (code, sentence) in plain {
            assert_eq!(english_of(coded(code)), sentence, "{code}");
        }
        assert_eq!(
            english_of(not_acp(2)),
            "This agent does not support ACP version 2."
        );
        assert_eq!(
            english_of(routing(ROUTE_FAILED, "deepseek")),
            "Oleafly could not route this agent through your deepseek key."
        );
        assert_eq!(
            english_of(routing(UNROUTE_FAILED, "openai")),
            "Oleafly could not stop routing this agent through your openai key."
        );
        assert_eq!(
            english_of(outside_project(Some("~/notes.txt"))),
            "The agent asked to use ~/notes.txt. Agents can only use files inside the project."
        );
        assert_eq!(
            english_of(outside_project(None)),
            "Agents can only use files inside the project."
        );
        assert_eq!(
            english_of(node_missing(20)),
            "Install Node.js 20 or newer to run this agent."
        );
        assert_eq!(
            english_of(node_outdated(20, 18)),
            "This agent needs Node.js 20 or newer. The detected version is 18."
        );
        assert_eq!(
            english_of(bridge_outdated("@zed-industries/claude-code-acp", "0.1.0", "0.5.0")),
            "@zed-industries/claude-code-acp 0.1.0 on this computer is too old. Oleafly needs 0.5.0 or newer. Install the bridge in Settings."
        );
    }

    #[test]
    fn redaction_reaches_inside_an_envelope_and_keeps_it_readable() {
        let redactor = Redactor::new(&[]);
        let secret = format!("sk-{}", "a".repeat(30));
        let error = RpcError::connection(
            ErrorKind::DisconnectedBeforeReply,
            &format!("rejected key {secret}"),
        );
        let text = redacted(&redactor, &rpc_message(&error));
        assert!(!text.contains(&secret), "{text}");
        assert_eq!(
            code(&text).as_deref(),
            Some("acp.session.no_reply_with_output")
        );
        let stored = redactor.value(&serde_json::json!({ "error": text }));
        let stored = stored["error"].as_str().unwrap();
        assert!(english(stored).unwrap().starts_with(
            "The agent disconnected before replying. Last output from the agent: rejected key"
        ));
        assert_eq!(redacted(&redactor, "plain"), "plain");
        assert!(is_code(&coded(START_CANCELLED), START_CANCELLED));
        assert!(!is_code("The start was cancelled.", START_CANCELLED));
    }
}
