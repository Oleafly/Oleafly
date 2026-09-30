use super::*;
use crate::acp::catalog::CliProgram;

fn builtin(id: &str) -> AgentDefinition {
    catalog::builtins()
        .into_iter()
        .find(|definition| definition.id == id)
        .unwrap()
}

fn limits() -> CheckLimits {
    CheckLimits {
        version: Duration::from_secs(10),
        initialize: Duration::from_secs(5),
    }
}

/// A Pi CLI that runs on Node.js and fails `--version` the way it does when
/// Node.js is missing or too old: an npm `.cmd` launcher on Windows, a
/// `#!…node` script elsewhere (whose interpreter is not there).
fn node_script_cli(folder: &Path) -> Located {
    #[cfg(windows)]
    {
        let path = folder.join("pi.cmd");
        std::fs::write(
            &path,
            "@echo off\r\necho 'node' is not recognized as an internal or external command 1>&2\r\nexit /b 9009\r\n",
        )
        .unwrap();
        Located {
            path,
            kind: ProgramKind::Script,
        }
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;
        let path = folder.join("pi");
        std::fs::write(
            &path,
            "#!/nonexistent/oleafly-fixture/node\nconsole.log('0.81.2')\n",
        )
        .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        Located {
            path,
            kind: ProgramKind::Native,
        }
    }
}

/// A `node` stand-in that reports `version`.
fn fake_node(folder: &Path, version: &str) -> PathBuf {
    #[cfg(windows)]
    {
        let path = folder.join("node.cmd");
        std::fs::write(&path, format!("@echo off\r\necho {version}\r\n")).unwrap();
        path
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;
        let path = folder.join("node");
        std::fs::write(&path, format!("#!/bin/sh\necho {version}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        path
    }
}

fn pi_plan(cli: &Located, node: Option<PathBuf>) -> Plan {
    Plan {
        launch: Err("fixture: the check stops before the launch".into()),
        cli: Some(CliProgram {
            located: cli.clone(),
            overridden: true,
        }),
        cli_rejected: Vec::new(),
        node,
    }
}

#[tokio::test]
async fn a_node_script_cli_without_node_is_reported_as_missing_node_not_a_wrong_program() {
    let temp = tempfile::tempdir().unwrap();
    let cli = node_script_cli(temp.path());
    let check = check_plan(
        &temp.path().join("acp"),
        &builtin("pi"),
        Some(cli.path.clone()),
        pi_plan(&cli, None),
        limits(),
    )
    .await;
    assert_eq!(check.code, "node_missing", "{check:?}");
    assert_eq!(
        check.program.as_deref(),
        Some(cli.path.to_string_lossy().as_ref())
    );
}

#[tokio::test]
async fn a_node_script_cli_with_an_old_node_is_reported_as_node_too_old() {
    let temp = tempfile::tempdir().unwrap();
    let cli = node_script_cli(temp.path());
    let node_folder = temp.path().join("node-20");
    std::fs::create_dir(&node_folder).unwrap();
    let node = fake_node(&node_folder, "v20.11.1");
    let check = check_plan(
        &temp.path().join("acp"),
        &builtin("pi"),
        Some(cli.path.clone()),
        pi_plan(&cli, Some(node)),
        limits(),
    )
    .await;
    assert_eq!(check.code, "node_too_old", "{check:?}");
    let detail = check.detail.unwrap_or_default();
    assert!(detail.contains("22.19.0"), "{detail}");
    assert!(detail.contains("20.11.1"), "{detail}");
}

#[tokio::test]
async fn an_installed_bridge_without_node_is_reported_as_missing_node_not_a_missing_bridge() {
    let temp = tempfile::tempdir().unwrap();
    let plan = Plan {
        // What `resolve_launch` returns for a Node.js bridge receipt when
        // Node.js cannot be found.
        launch: Err("Install Node.js to run this agent.".into()),
        cli: None,
        cli_rejected: Vec::new(),
        node: None,
    };
    let check = check_plan(
        &temp.path().join("acp"),
        &builtin("claude"),
        None,
        plan,
        limits(),
    )
    .await;
    assert_eq!(check.code, "node_missing", "{check:?}");
}

#[tokio::test]
async fn a_bridge_that_is_not_installed_is_still_reported_when_node_is_there() {
    let temp = tempfile::tempdir().unwrap();
    let node = fake_node(temp.path(), "v22.20.0");
    let plan = Plan {
        launch: Err("The agent is not installed.".into()),
        cli: None,
        cli_rejected: Vec::new(),
        node: Some(node),
    };
    let check = check_plan(
        &temp.path().join("acp"),
        &builtin("claude"),
        None,
        plan,
        limits(),
    )
    .await;
    assert_eq!(check.code, "bridge_missing", "{check:?}");
    assert_eq!(check.detail.as_deref(), Some("The agent is not installed."));
}
