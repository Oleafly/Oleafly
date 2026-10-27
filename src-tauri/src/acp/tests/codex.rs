use super::*;
use crate::acp::preferences::{AgentPreferences, RememberedChoice};
use crate::acp::tests::{fixture_python, fixture_temp};
use std::ffi::OsString;
use std::path::Path;
use std::time::{Duration, Instant};

fn python_check(code: &str, cwd: &Path) -> ConfigCheck {
    ConfigCheck {
        program: fixture_python(),
        args: vec!["-c".into(), code.into()],
        env: Vec::new(),
        cwd: cwd.to_path_buf(),
        batch: false,
    }
}

#[tokio::test]
async fn a_codex_that_fails_to_load_its_config_reports_what_it_printed() {
    let temp = fixture_temp();
    let failing = python_check(
        "import sys; assert sys.argv[1:] == ['cli', 'features', 'list'], sys.argv; \
         print('Error loading config.toml: `wire_api = \"chat\"` is no longer supported.', file=sys.stderr); \
         print('in `model_providers.deepseek.wire_api`', file=sys.stderr); sys.exit(1)",
        temp.path(),
    );
    assert_eq!(
        check_failure(&failing).await.as_deref(),
        Some(
            "Error loading config.toml: `wire_api = \"chat\"` is no longer supported.\n\
             in `model_providers.deepseek.wire_api`"
        )
    );
    let passing = python_check("print('undo stable false')", temp.path());
    assert_eq!(check_failure(&passing).await, None);
    let silent = python_check("import sys; sys.exit(2)", temp.path());
    assert_eq!(check_failure(&silent).await, None);
}

#[tokio::test]
async fn a_codex_check_that_hangs_is_stopped_within_its_limit() {
    let temp = fixture_temp();
    let hanging = python_check("import time; time.sleep(30)", temp.path());
    let started = Instant::now();
    assert_eq!(check_failure(&hanging).await, None);
    assert!(started.elapsed() < Duration::from_secs(10));
}

#[test]
fn the_config_file_follows_codex_home() {
    let home = Path::new("/home/someone");
    let set = |name: &str| (name == "CODEX_HOME").then(|| OsString::from("/elsewhere/codex"));
    assert_eq!(
        config_path(&set, Some(home)),
        Some(Path::new("/elsewhere/codex").join("config.toml"))
    );
    let unset = |_: &str| None;
    assert_eq!(
        config_path(&unset, Some(home)),
        Some(home.join(".codex").join("config.toml"))
    );
    let empty = |name: &str| (name == "CODEX_HOME").then(|| OsString::from(""));
    assert_eq!(
        config_path(&empty, Some(home)),
        Some(home.join(".codex").join("config.toml"))
    );
    assert_eq!(config_path(&unset, None), None);
}

fn config(text: &str) -> Option<ConfigProvider> {
    let temp = fixture_temp();
    let path = temp.path().join("config.toml");
    std::fs::write(&path, text).unwrap();
    config_provider(&path)
}

#[test]
fn a_config_naming_another_provider_names_it_and_its_key_variable() {
    let deepseek = r#"
model_provider = "deepseek"
model = "deepseek-chat"

[model_providers.deepseek]
name = "DeepSeek"
base_url = "https://api.deepseek.com/v1"
env_key = "DEEPSEEK_API_KEY"
wire_api = "responses"
"#;
    assert_eq!(
        config(deepseek),
        Some(ConfigProvider {
            name: "DeepSeek".into(),
            env_key: Some("DEEPSEEK_API_KEY".into()),
        })
    );
    assert_eq!(
        config("model_provider = \"ollama\"\n"),
        Some(ConfigProvider {
            name: "ollama".into(),
            env_key: None,
        })
    );
    let profile = r#"
profile = "work"
[profiles.work]
model_provider = "azure"
[model_providers.azure]
env_key = "bad key"
"#;
    assert_eq!(
        config(profile),
        Some(ConfigProvider {
            name: "azure".into(),
            env_key: None,
        })
    );
}

#[test]
fn openai_missing_broken_and_huge_configs_name_no_provider() {
    assert_eq!(config("model_provider = \"openai\"\n"), None);
    assert_eq!(config("model = \"gpt-5.5\"\n"), None);
    assert_eq!(config("model_provider = [\n"), None);
    assert_eq!(
        config(&format!(
            "model_provider = \"deepseek\"\n# {}\n",
            "x".repeat(300 * 1024)
        )),
        None
    );
    let temp = fixture_temp();
    assert_eq!(config_provider(&temp.path().join("missing.toml")), None);
}

#[test]
fn a_sign_in_error_says_what_codex_actually_needs() {
    let deepseek = ConfigProvider {
        name: "DeepSeek".into(),
        env_key: Some("DEEPSEEK_API_KEY".into()),
    };
    let english = |reason: Option<String>| reason.and_then(|text| crate::app_error::english(&text));
    let setup = sign_in_reason(
        Some("Error loading config.toml: bad".into()),
        Some("OpenAI".into()),
        Some(deepseek.clone()),
    );
    assert_eq!(
        crate::app_error::code(setup.as_deref().unwrap()).as_deref(),
        Some("acp.session.codex_setup")
    );
    assert_eq!(
        english(setup).as_deref(),
        Some("Codex reported a problem with its setup:\nError loading config.toml: bad")
    );
    assert_eq!(
        english(sign_in_reason(
            None,
            Some("OpenAI".into()),
            Some(deepseek.clone())
        ))
        .as_deref(),
        Some("Your OpenAI key was rejected.")
    );
    assert_eq!(
        english(sign_in_reason(None, None, Some(deepseek))).as_deref(),
        Some("Codex uses the DeepSeek provider from its config.toml. Check that DEEPSEEK_API_KEY is set and valid, then reconnect.")
    );
    assert_eq!(
        english(sign_in_reason(
            None,
            None,
            Some(ConfigProvider {
                name: "ollama".into(),
                env_key: None,
            })
        ))
        .as_deref(),
        Some("Codex uses the ollama provider from its config.toml. Check its settings, then reconnect.")
    );
    assert_eq!(sign_in_reason(None, None, None), None);
}

#[test]
fn a_system_error_body_is_unwrapped_to_its_message() {
    assert_eq!(
        system_error_message(
            "{\"error\": {\"message\": \"The 'gpt-x' model is not supported.\", \"type\": \"invalid_request_error\"}}\n\n"
        ),
        "The 'gpt-x' model is not supported."
    );
    assert_eq!(
        system_error_message("{\"message\": \"Rate limited\"}"),
        "Rate limited"
    );
    assert_eq!(
        system_error_message("{\"error\": \"Quota exceeded\"}"),
        "Quota exceeded"
    );
    assert_eq!(
        system_error_message("  stream disconnected before completion  \n"),
        "stream disconnected before completion"
    );
    assert_eq!(system_error_message("{\"detail\": 1}"), "{\"detail\": 1}");
    assert_eq!(
        crate::app_error::english_error(&system_error_message(" \n ")),
        "Codex stopped this turn with an error."
    );
    assert_eq!(
        system_error_message(&"y".repeat(5000)).chars().count(),
        2000
    );
}

fn remembered(value: &str, name: &str) -> AgentPreferences {
    AgentPreferences {
        mode: Some(RememberedChoice {
            value: value.into(),
            name: name.into(),
        }),
        ..Default::default()
    }
}

#[test]
fn codex_starts_in_the_remembered_mode_unless_it_turns_checks_off() {
    assert_eq!(
        initial_mode(&remembered("read-only", "Read-only")),
        Some(("INITIAL_AGENT_MODE".to_owned(), OsString::from("read-only")))
    );
    assert_eq!(
        initial_mode(&remembered("agent-full-access", "Full access")),
        None
    );
    assert_eq!(initial_mode(&remembered("agent", "Full access")), None);
    assert_eq!(initial_mode(&remembered("read only\0", "Read-only")), None);
    assert_eq!(initial_mode(&AgentPreferences::default()), None);
}

#[cfg(unix)]
mod live {
    use crate::acp::preferences::RememberedChoice;
    use crate::acp::tests::{fixture_definition, fixture_temp};
    use crate::acp::types::*;
    use crate::acp::AcpRuntime;
    use std::path::Path;
    use std::sync::Arc;

    fn codex_bridge(root: &Path, extra: &[&str]) -> AgentDefinition {
        use std::os::unix::fs::PermissionsExt;
        let command = fixture_definition(
            extra
                .iter()
                .map(|argument| (*argument).to_owned())
                .collect(),
            root,
        )
        .distribution
        .command
        .unwrap();
        let quoted: Vec<String> = std::iter::once(command.executable)
            .chain(command.args)
            .map(|part| format!("'{}'", part.replace('\'', "'\\''")))
            .collect();
        let wrapper = root.join("codex-acp");
        std::fs::write(
            &wrapper,
            format!("#!/bin/sh\nexec {} \"$@\"\n", quoted.join(" ")),
        )
        .unwrap();
        std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
        AgentDefinition {
            id: "fixture-codex".into(),
            name: "Fixture Codex".into(),
            version: "1.0.0".into(),
            description: String::new(),
            builtin: false,
            distribution: Distribution {
                command: Some(CommandDistribution {
                    executable: wrapper.to_string_lossy().into_owned(),
                    args: Vec::new(),
                }),
                ..Distribution::default()
            },
        }
    }

    async fn start(
        extra: &[&str],
    ) -> (
        tempfile::TempDir,
        Arc<AcpRuntime>,
        Result<SessionSnapshot, String>,
    ) {
        start_with(extra, AgentPreferences::default()).await
    }

    async fn start_with(
        extra: &[&str],
        prefs: AgentPreferences,
    ) -> (
        tempfile::TempDir,
        Arc<AcpRuntime>,
        Result<SessionSnapshot, String>,
    ) {
        let temp = fixture_temp();
        let project = temp.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
        runtime
            .register(&serde_json::to_string(&codex_bridge(temp.path(), extra)).unwrap())
            .unwrap();
        runtime
            .set_agent_preferences("fixture-codex", prefs)
            .await
            .unwrap();
        let started = runtime
            .start(StartSession {
                project_id: "test-project".into(),
                project_path: project,
                agent_id: "fixture-codex".into(),
                owner: Some("fixture-window".into()),
                ..StartSession::default()
            })
            .await;
        (temp, runtime, started)
    }

    #[tokio::test]
    async fn a_codex_config_error_at_start_is_shown_instead_of_a_sign_in() {
        let (_temp, _runtime, started) = start(&[
            "",
            "--require-login",
            "--codex-config-error",
            "`wire_api = \"chat\"` is no longer supported.",
        ])
        .await;
        let error = crate::app_error::english_error(&started.unwrap_err());
        assert!(
            error.starts_with("Codex reported a problem with its setup:"),
            "{error}"
        );
        assert!(error.contains("`wire_api = \"chat\"` is no longer supported."));
    }

    #[tokio::test]
    async fn a_codex_config_error_in_a_turn_keeps_the_session_out_of_sign_in() {
        let (_temp, runtime, started) =
            start(&["", "--codex-config-error", "unknown model provider"]).await;
        let id = started.unwrap().session.id;
        let error = runtime
            .prompt(&id, "auth-required".into(), Vec::new())
            .await
            .unwrap_err();
        let error = crate::app_error::english_error(&error);
        assert!(error.contains("unknown model provider"), "{error}");
        assert_eq!(
            runtime.snapshot(&id).await.unwrap().session.status,
            SessionStatus::Ready
        );
        runtime.close(&id).await.unwrap();
    }

    #[tokio::test]
    async fn codex_is_started_in_the_remembered_mode_only_when_it_keeps_checks_on() {
        for (value, name, expected) in [
            (Some("read-only"), "Read-only", Some("read-only")),
            (Some("agent-full-access"), "Full access", None),
            (None, "", None),
        ] {
            let prefs = AgentPreferences {
                mode: value.map(|value| RememberedChoice {
                    value: value.into(),
                    name: name.into(),
                }),
                ..Default::default()
            };
            let (temp, runtime, started) =
                start_with(&["", "--codex-options", "--record-launch"], prefs).await;
            let id = started.unwrap().session.id;
            let launch: serde_json::Value = serde_json::from_str(
                &std::fs::read_to_string(temp.path().join("launch.json")).unwrap(),
            )
            .unwrap();
            assert_eq!(launch["initialMode"].as_str(), expected, "{value:?}");
            runtime.close(&id).await.unwrap();
        }
    }
}
