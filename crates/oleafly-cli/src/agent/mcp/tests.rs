use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use serde_json::json;

use super::mcp_fixture::{self, Mode};
use super::*;
use crate::agent::policy::{AllowSet, RunPolicy, WriteMode};

fn token() -> CancellationToken {
    CancellationToken::new()
}

fn policy(commands: bool, network: bool, question: bool) -> RunPolicy {
    RunPolicy {
        allow: AllowSet {
            write: false,
            commands,
            network,
        },
        mode: WriteMode::ReadOnly,
        question,
    }
}

fn fixture_exe(directory: &Path) -> PathBuf {
    crate::support::rust_fixture(directory, "mcp_server.rs", "mcp-fixture", None)
}

fn stdio(name: &str, program: &Path, env: &[(&str, &str)]) -> McpServer {
    McpServer {
        name: name.into(),
        transport: McpTransport::Stdio {
            command: program.to_string_lossy().into_owned(),
            args: Vec::new(),
            env: env
                .iter()
                .map(|(key, value)| (key.to_string(), value.to_string()))
                .collect(),
        },
    }
}

fn remote(name: &str, url: &str, headers: &[(&str, &str)]) -> McpServer {
    McpServer {
        name: name.into(),
        transport: McpTransport::Remote {
            url: url.into(),
            headers: headers
                .iter()
                .map(|(key, value)| (key.to_string(), value.to_string()))
                .collect(),
        },
    }
}

#[tokio::test]
async fn a_stdio_server_lists_and_calls_tools() {
    let directory = tempfile::tempdir().unwrap();
    let exe = fixture_exe(directory.path());
    let (hub, warnings) = McpHub::connect(
        &[stdio("fixture", &exe, &[])],
        &policy(true, false, false),
        &McpSelection::All,
        &[],
        &token(),
    )
    .await;
    assert!(warnings.is_empty(), "{warnings:?}");
    let echo = hub.tools().iter().find(|tool| tool.tool == "echo").unwrap();
    assert!(echo.agent_name.starts_with("mcp_ext_fixture_echo_"));
    assert!(echo.read_only_hint);
    assert_eq!(
        hub.call(&echo.agent_name, json!({"text": "hi"}), &token())
            .await
            .unwrap(),
        "hi"
    );
    hub.shutdown().await;
}

#[tokio::test]
async fn a_remote_server_answers_json_and_event_stream_responses() {
    for mode in [Mode::Json, Mode::Sse] {
        let fixture = mcp_fixture::start(mode);
        let server = remote(
            "papers",
            &fixture.url(),
            &[("Authorization", "Bearer remote-token-123")],
        );
        let (hub, warnings) = McpHub::connect(
            &[server],
            &policy(false, true, false),
            &McpSelection::All,
            &[],
            &token(),
        )
        .await;
        assert!(warnings.is_empty(), "{mode:?}: {warnings:?}");
        let echo = hub
            .tools()
            .iter()
            .find(|tool| tool.tool == "echo")
            .unwrap()
            .agent_name
            .clone();
        assert_eq!(
            hub.call(&echo, json!({"text": "über"}), &token())
                .await
                .unwrap(),
            "über"
        );
        let received = fixture.received();
        let call = received
            .iter()
            .find(|request| request.method == "tools/call")
            .unwrap();
        assert_eq!(call.header("mcp-session-id"), Some(mcp_fixture::SESSION_ID));
        assert_eq!(
            call.header("mcp-protocol-version"),
            Some(MCP_PROTOCOL_VERSION)
        );
        assert_eq!(
            call.header("authorization"),
            Some("Bearer remote-token-123")
        );
        let first = &received[0];
        assert_eq!(first.method, "initialize");
        assert!(first.header("mcp-session-id").is_none());
        hub.shutdown().await;
    }
}

#[tokio::test]
async fn stdio_servers_need_commands_and_remote_servers_need_network() {
    let fixture = mcp_fixture::start(Mode::Json);
    let servers = [
        stdio("local", Path::new("/bin/true"), &[]),
        remote("web", &fixture.url(), &[]),
    ];
    let (hub, warnings) = McpHub::connect(
        &servers,
        &policy(false, false, false),
        &McpSelection::All,
        &[],
        &token(),
    )
    .await;
    assert!(hub.tools().is_empty());
    assert!(warnings[0].contains("--allow commands"), "{warnings:?}");
    assert!(warnings[1].contains("--allow network"), "{warnings:?}");
    assert!(fixture.received().is_empty());
}

#[tokio::test]
async fn ask_keeps_only_read_only_tools() {
    let fixture = mcp_fixture::start(Mode::Json);
    let (hub, _) = McpHub::connect(
        &[remote("papers", &fixture.url(), &[])],
        &policy(false, true, true),
        &McpSelection::All,
        &[],
        &token(),
    )
    .await;
    let tools: Vec<&str> = hub.tools().iter().map(|tool| tool.tool.as_str()).collect();
    assert_eq!(tools, ["echo"]);
}

fn run_policy(mode: WriteMode) -> RunPolicy {
    RunPolicy {
        allow: AllowSet {
            write: mode != WriteMode::ReadOnly,
            commands: true,
            network: true,
        },
        mode,
        question: false,
    }
}

#[tokio::test]
async fn a_run_outside_apply_gets_only_read_only_tools() {
    let fixture = mcp_fixture::start(Mode::Json);
    let work = tempfile::tempdir().unwrap();
    for (mode, expected) in [
        (WriteMode::ReadOnly, vec!["echo"]),
        (
            WriteMode::Review {
                dir: work.path().join("review"),
            },
            vec!["echo"],
        ),
        (WriteMode::Apply, vec!["echo", "write_note"]),
    ] {
        let (hub, _) = McpHub::connect_for_run(
            &[remote("papers", &fixture.url(), &[])],
            &run_policy(mode.clone()),
            &McpSelection::All,
            &[],
            work.path(),
            &token(),
        )
        .await;
        let tools: Vec<&str> = hub.tools().iter().map(|tool| tool.tool.as_str()).collect();
        assert_eq!(tools, expected, "{mode:?}");
    }
}

#[tokio::test]
async fn a_runs_stdio_servers_start_in_its_working_folder() {
    let directory = tempfile::tempdir().unwrap();
    let exe = fixture_exe(directory.path());
    let work = tempfile::tempdir().unwrap();
    let (hub, warnings) = McpHub::connect_for_run(
        &[stdio("fixture", &exe, &[])],
        &run_policy(WriteMode::Apply),
        &McpSelection::All,
        &[],
        work.path(),
        &token(),
    )
    .await;
    assert!(warnings.is_empty(), "{warnings:?}");
    let echo = hub.tools().iter().find(|tool| tool.tool == "echo").unwrap();
    let cwd = hub
        .call(&echo.agent_name, json!({"text": "<cwd>"}), &token())
        .await
        .unwrap();
    assert_eq!(
        std::fs::canonicalize(cwd).unwrap(),
        std::fs::canonicalize(work.path()).unwrap()
    );
    hub.shutdown().await;
}

#[tokio::test]
async fn a_failing_server_never_shows_its_env_values() {
    let (_, warnings) = McpHub::connect(
        &[stdio(
            "bad",
            Path::new("/no/such/program"),
            &[("TOKEN", "s3cret-token")],
        )],
        &policy(true, false, false),
        &McpSelection::All,
        &["s3cret-token".into()],
        &token(),
    )
    .await;
    assert_eq!(warnings.len(), 1);
    assert!(
        warnings
            .iter()
            .all(|warning| !warning.contains("s3cret-token")),
        "{warnings:?}"
    );
}

#[tokio::test]
async fn a_server_that_prints_its_env_keeps_it_to_itself() {
    let directory = tempfile::tempdir().unwrap();
    let exe = fixture_exe(directory.path());
    let server = stdio(
        "chatty",
        &exe,
        &[("TOKEN", "s3cret-token"), ("FIXTURE_ECHO_ENV", "TOKEN")],
    );
    let (hub, warnings) = McpHub::connect(
        &[server],
        &policy(true, false, false),
        &McpSelection::All,
        &[],
        &token(),
    )
    .await;
    assert!(warnings
        .iter()
        .all(|warning| !warning.contains("s3cret-token")));
    assert!(hub
        .tools()
        .iter()
        .all(|tool| !tool.schema.description.contains("s3cret-token")));
    hub.shutdown().await;
}

#[tokio::test]
async fn named_selections_pick_servers_and_report_unknown_names() {
    let fixture = mcp_fixture::start(Mode::Json);
    let servers = [
        remote("a", &fixture.url(), &[]),
        remote("b", &fixture.url(), &[]),
    ];
    let (hub, warnings) = McpHub::connect(
        &servers,
        &policy(false, true, false),
        &McpSelection::Named(vec!["b".into(), "zotero".into()]),
        &[],
        &token(),
    )
    .await;
    assert_eq!(hub.server_names(), ["b"]);
    assert!(warnings[0].contains("zotero"));
    let (none, warnings) = McpHub::connect(
        &servers,
        &policy(false, true, false),
        &McpSelection::None,
        &[],
        &token(),
    )
    .await;
    assert!(none.tools().is_empty() && warnings.is_empty());
}

#[tokio::test]
async fn a_silent_server_times_out_without_blocking_the_others() {
    let silent = mcp_fixture::start(Mode::Silent);
    let fine = mcp_fixture::start(Mode::Json);
    let started = std::time::Instant::now();
    let (hub, warnings) = McpHub::connect(
        &[
            remote("quiet", &silent.url(), &[]),
            remote("fine", &fine.url(), &[]),
        ],
        &policy(false, true, false),
        &McpSelection::All,
        &[],
        &token(),
    )
    .await;
    assert!(started.elapsed() < CONNECT_TIMEOUT + std::time::Duration::from_secs(3));
    assert_eq!(hub.server_names(), ["fine"]);
    assert!(warnings[0].contains("quiet"));
}

#[test]
fn npx_resolves_to_its_cmd_shim_through_pathext() {
    let found = resolve_program(
        "npx",
        Platform::Windows,
        Some(OsStr::new(r"C:\nodejs;C:\tools")),
        Some(OsStr::new(".COM;.EXE;.BAT;.CMD")),
        &|path| path == Path::new(r"C:\nodejs\npx.cmd"),
    );
    assert_eq!(found, Some(PathBuf::from(r"C:\nodejs\npx.cmd")));
    let absolute = resolve_program(
        r"C:\Program Files\nodejs\node.exe",
        Platform::Windows,
        None,
        None,
        &|_| false,
    );
    assert_eq!(
        absolute,
        Some(PathBuf::from(r"C:\Program Files\nodejs\node.exe"))
    );
    let profile = resolve_program(
        "uvx.exe",
        Platform::Windows,
        Some(OsStr::new(r"C:\Users\Zoë Müller\.local\bin")),
        None,
        &|path| path == Path::new(r"C:\Users\Zoë Müller\.local\bin\uvx.exe"),
    );
    assert_eq!(
        profile,
        Some(PathBuf::from(r"C:\Users\Zoë Müller\.local\bin\uvx.exe"))
    );
    let unix = resolve_program(
        "uvx",
        Platform::Linux,
        Some(OsStr::new("/usr/bin:/home/me/.local/bin")),
        None,
        &|path| path == Path::new("/home/me/.local/bin/uvx"),
    );
    assert_eq!(unix, Some(PathBuf::from("/home/me/.local/bin/uvx")));
    assert_eq!(
        resolve_program(
            "missing",
            Platform::Linux,
            Some(OsStr::new("/usr/bin")),
            None,
            &|_| false
        ),
        None
    );
}

#[test]
fn agent_tool_names_are_stable_provider_safe_and_bounded() {
    let first = agent_tool_name("Zotero Local", "search_items");
    assert_eq!(first, agent_tool_name("Zotero Local", "search_items"));
    assert!(first.starts_with("mcp_ext_zotero_local_search_items_"));
    for (server, tool) in [
        ("ü-server", "x"),
        ("", ""),
        (&"a".repeat(40) as &str, &"b".repeat(40) as &str),
    ] {
        let name = agent_tool_name(server, tool);
        assert!(name.len() <= 64, "{name}");
        assert!(
            name.bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_'),
            "{name}"
        );
    }
    assert_eq!(agent_tool_name("", "").split('_').nth(2), Some("server"));
}

#[test]
fn results_join_text_and_leave_out_images() {
    let result = json!({"content": [{"type": "text", "text": "a"}, {"type": "image", "data": "x", "mimeType": "image/png"}, {"type": "text", "text": "b"}]});
    assert_eq!(result_text(&result).unwrap(), "a\nb\n[1 image(s) left out]");
    let error = json!({"content": [{"type": "text", "text": "bad input"}], "isError": true});
    assert_eq!(result_text(&error).unwrap_err(), "bad input");
}

#[test]
fn acp_specs_carry_env_and_headers_as_pairs() {
    let specs = acp_server_specs(&[
        stdio("local", Path::new("/usr/bin/zotero-mcp"), &[("TOKEN", "t")]),
        remote(
            "web",
            "https://example.com/mcp",
            &[("Authorization", "Bearer x")],
        ),
    ]);
    assert_eq!(specs[0]["env"][0], json!({"name": "TOKEN", "value": "t"}));
    assert_eq!(specs[1]["type"], "http");
    assert_eq!(specs[1]["headers"][0]["name"], "Authorization");
}
