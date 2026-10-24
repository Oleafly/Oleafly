use super::*;

struct Fixture {
    workspace: tempfile::TempDir,
    home: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Self {
        Self {
            workspace: tempfile::tempdir().unwrap(),
            home: tempfile::tempdir().unwrap(),
        }
    }

    fn spec(&self, network: bool) -> SandboxSpec {
        SandboxSpec {
            workspace: self.workspace.path().canonicalize().unwrap(),
            read_only: vec![],
            read_write: vec![],
            network,
            gpu: false,
            env: BTreeMap::new(),
            child_processes: false,
            home: self.home.path().to_path_buf(),
            ..SandboxSpec::default()
        }
    }

    fn real_home(&self) -> PathBuf {
        self.home.path().canonicalize().unwrap()
    }
}

fn program() -> PathBuf {
    std::env::current_exe().unwrap()
}

fn invalid(result: Result<std::process::Command, SandboxError>) -> String {
    match result {
        Err(SandboxError::Invalid(message)) => message,
        Err(other) => panic!("expected an invalid spec, got {other:?}"),
        Ok(_) => panic!("expected an invalid spec, got a command"),
    }
}

#[test]
fn sandbox_rejects_invalid_temporary_folders_and_overbroad_read_grants() {
    let fixture = Fixture::new();
    let mut missing = fixture.spec(false);
    missing.home = fixture.workspace.path().join("missing");
    assert_eq!(
        invalid(command(&missing, &program(), &[])),
        "The task command's temporary folder is unavailable."
    );

    let file = fixture.workspace.path().join("temp-file");
    std::fs::write(&file, "original").unwrap();
    let mut not_a_folder = fixture.spec(false);
    not_a_folder.home = file.clone();
    assert_eq!(
        invalid(command(&not_a_folder, &program(), &[])),
        "The task command needs a real temporary folder."
    );
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "original");

    let filesystem_root = program().ancestors().last().unwrap().to_path_buf();
    let mut root_grant = fixture.spec(false);
    root_grant.read_only = vec![filesystem_root];
    assert_eq!(
        invalid(command(&root_grant, &program(), &[])),
        "Task runtimes require specific readable files or folders."
    );

    if let Some(home) = home_dir().filter(|home| home.is_dir()) {
        let mut home_grant = fixture.spec(false);
        home_grant.read_only = vec![home];
        assert_eq!(
            invalid(command(&home_grant, &program(), &[])),
            "Task runtimes require specific readable files or folders."
        );
    }

    let mut missing_grant = fixture.spec(false);
    missing_grant.read_only = vec![fixture.workspace.path().join("missing-read")];
    assert_eq!(
        invalid(command(&missing_grant, &program(), &[])),
        "A task runtime file is unavailable."
    );

    let mut missing_program = fixture.spec(false);
    missing_program.read_only = vec![];
    assert_eq!(
        invalid(command(
            &missing_program,
            &fixture.workspace.path().join("no-such-program"),
            &[]
        )),
        "The task executable is unavailable."
    );
}

#[cfg(unix)]
#[test]
fn sandbox_rejects_linked_temporary_folders() {
    let fixture = Fixture::new();
    let linked = fixture.workspace.path().join("linked-temp");
    std::os::unix::fs::symlink(fixture.home.path(), &linked).unwrap();
    let mut spec = fixture.spec(false);
    spec.home = linked;
    assert_eq!(
        invalid(command(&spec, &program(), &[])),
        "The task command needs a real temporary folder."
    );
}

#[cfg(target_os = "macos")]
#[test]
fn macos_profile_is_unchanged_for_a_fixed_spec() {
    let fixture = Fixture::new();
    let args_os: Vec<OsString> = vec!["-c".into(), "true".into()];
    let offline = command(&fixture.spec(false), Path::new("/bin/sh"), &args_os).unwrap();
    assert_eq!(offline.get_program(), "/usr/bin/sandbox-exec");
    let args: Vec<String> = offline
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    assert_eq!(args[0], "-p");
    assert!(args[1].starts_with("(version 1) (deny default) (allow process*) (allow syscall-unix) (allow file-read-metadata) (allow sysctl-read) (allow signal (target same-sandbox)) (deny syscall-unix (syscall-number SYS_setsid SYS_setpgid) (with errno 1)) (deny syscall-unix (syscall-number SYS_posix_spawn) (with errno 78))"));
    assert!(!args[1].contains("(allow network*)"));
    assert!(!args[1].contains("(allow iokit-open)"));
    let home = serde_json::to_string(&fixture.real_home().to_string_lossy()).unwrap();
    assert!(args[1].contains(&format!("(allow file-write* (subpath {home}))")));
    assert!(args[1].ends_with("(allow file-write-data (literal \"/dev/null\") (literal \"/dev/zero\") (literal \"/dev/random\") (literal \"/dev/urandom\"))"));
    assert_eq!(&args[2..], ["/bin/sh", "-c", "true"]);

    let online = command(&fixture.spec(true), Path::new("/bin/sh"), &args_os).unwrap();
    let profile = online
        .get_args()
        .nth(1)
        .unwrap()
        .to_string_lossy()
        .into_owned();
    assert!(profile.contains("(allow network*)"));
}

#[cfg(target_os = "linux")]
#[test]
fn linux_bwrap_arguments_are_unchanged_for_a_fixed_spec() {
    if availability() != Availability::Available {
        return;
    }
    let fixture = Fixture::new();
    let writable = fixture
        .workspace
        .path()
        .canonicalize()
        .unwrap()
        .join("analysis");
    std::fs::create_dir(&writable).unwrap();
    let mut spec = fixture.spec(false);
    spec.read_write = vec![writable.clone()];
    let args_os: Vec<OsString> = vec!["-c".into(), "true".into()];
    let built = command(&spec, Path::new("/bin/sh"), &args_os).unwrap();
    let args: Vec<String> = built
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        &args[..4],
        [
            "--die-with-parent",
            "--new-session",
            "--unshare-all",
            "--unshare-pid"
        ]
    );
    assert!(!args.iter().any(|arg| arg == "--share-net"));
    assert_eq!(&args[4..8], ["--proc", "/proc", "--dev", "/dev"]);
    // The workspace is mounted read-only as a whole, then the write grants
    // and the home folder on top of it.
    let workspace = spec.workspace.to_string_lossy().into_owned();
    let mount = args
        .windows(3)
        .position(|grant| grant[0] == "--ro-bind" && grant[1] == workspace && grant[2] == workspace)
        .unwrap();
    let writable = writable.to_string_lossy().into_owned();
    let home = fixture.real_home().to_string_lossy().into_owned();
    assert_eq!(
        &args[mount + 3..mount + 6],
        ["--bind", &writable, &writable]
    );
    assert_eq!(&args[mount + 6..mount + 9], ["--bind", &home, &home]);
    let program = Path::new("/bin/sh").canonicalize().unwrap();
    assert_eq!(
        &args[args.len() - 4..],
        ["--", &program.to_string_lossy(), "-c", "true"]
    );
    assert!(args[8..mount]
        .chunks(3)
        .all(|grant| grant[0] == "--ro-bind" && grant[1] == grant[2]));

    let online = command(&fixture.spec(true), Path::new("/bin/sh"), &args_os).unwrap();
    assert!(online.get_args().any(|arg| arg == "--share-net"));
}

// Windows has its own sandbox now; this covers every other system.
#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
#[test]
fn unsupported_platforms_report_the_0_4_7_message() {
    let fixture = Fixture::new();
    assert_eq!(
        availability(),
        Availability::Unavailable(UNSUPPORTED_MESSAGE.into())
    );
    assert_eq!(
        command(&fixture.spec(false), &program(), &[]).unwrap_err(),
        SandboxError::Unsupported(UNSUPPORTED_MESSAGE.into())
    );
}

#[test]
fn the_fixed_environment_cannot_be_overridden() {
    let fixture = Fixture::new();
    for reserved in ["PATH", "home", "TMPDIR"] {
        let mut spec = fixture.spec(false);
        spec.env.insert(reserved.into(), "/tmp".into());
        let message = invalid(command(&spec, &program(), &[]));
        assert!(message.contains(reserved), "{message}");
    }
    // The variables below are the macOS and Linux base environment.
    if cfg!(windows) || availability() != Availability::Available {
        return;
    }
    let mut spec = fixture.spec(false);
    spec.env.insert("WANDB_MODE".into(), "offline".into());
    spec.env
        .insert("XDG_CACHE_HOME".into(), "/custom-cache".into());
    let built = command(&spec, &program(), &[]).unwrap();
    let envs: BTreeMap<String, Option<String>> = built
        .get_envs()
        .map(|(name, value)| {
            (
                name.to_string_lossy().into_owned(),
                value.map(|value| value.to_string_lossy().into_owned()),
            )
        })
        .collect();
    let home = fixture.real_home();
    assert_eq!(envs["WANDB_MODE"].as_deref(), Some("offline"));
    assert_eq!(
        envs["HOME"].as_deref(),
        Some(home.to_string_lossy().as_ref())
    );
    // Temporary files and state live in folders of the home (Python reads
    // TMPDIR first).
    assert_eq!(
        envs["TMPDIR"].as_deref(),
        Some(home.join("tmp").to_string_lossy().as_ref())
    );
    assert_eq!(envs["PATH"].as_deref(), Some(UNIX_TASK_PATH));
    assert_eq!(envs["XDG_CACHE_HOME"].as_deref(), Some("/custom-cache"));
    assert_eq!(
        envs["XDG_STATE_HOME"].as_deref(),
        Some(home.join(".local/state").to_string_lossy().as_ref())
    );
    assert_eq!(built.get_current_dir(), Some(spec.workspace.as_path()));
}

#[test]
fn spec_round_trips_through_json_with_windows_paths() {
    let fixture = Fixture::new();
    let mut spec = SandboxSpec {
        workspace: PathBuf::from(r"C:\Users\Ada B\Données\paper"),
        home: PathBuf::from(r"\\?\D:\tmp\oleafly-task-1"),
        ..fixture.spec(false)
    };
    spec.read_only = vec![PathBuf::from(r"\\server\share\data")];
    spec.env.insert("CUDA_VISIBLE_DEVICES".into(), "0".into());
    let json = serde_json::to_string(&spec).unwrap();
    assert!(json.contains("\"readOnly\""));
    assert_eq!(serde_json::from_str::<SandboxSpec>(&json).unwrap(), spec);

    let minimal: SandboxSpec = serde_json::from_str(
        r#"{"workspace":"/w","readOnly":[],"readWrite":[],"network":false,"home":"/h"}"#,
    )
    .unwrap();
    assert!(!minimal.gpu);
    assert!(minimal.env.is_empty());
}

#[test]
fn availability_serializes_with_its_reason() {
    assert_eq!(
        serde_json::to_value(Availability::Unavailable("missing".into())).unwrap(),
        serde_json::json!({"state": "unavailable", "reason": "missing"})
    );
    assert_eq!(
        serde_json::to_value(Availability::Available).unwrap(),
        serde_json::json!({"state": "available"})
    );
}

#[cfg(unix)]
#[tokio::test]
async fn dropping_the_guard_kills_the_process_group() {
    let mut command = tokio::process::Command::new("/bin/sh");
    command
        .args(["-c", "sleep 30 & wait"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    process::isolate_process_tree(&mut command);
    let mut child = command.spawn().unwrap();
    let guard = process::contain_process_tree(child.id().unwrap()).unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    assert!(child.try_wait().unwrap().is_none());
    drop(guard);
    tokio::time::timeout(std::time::Duration::from_secs(5), child.wait())
        .await
        .expect("the process group outlived its guard")
        .unwrap();
}

#[cfg(unix)]
#[test]
fn a_disarmed_guard_leaves_the_process_running() {
    let mut command = std::process::Command::new("/bin/sh");
    command
        .args(["-c", "sleep 2"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    process::isolate_std_process_tree(&mut command);
    let mut child = command.spawn().unwrap();
    let guard = process::contain_process_tree(child.id()).unwrap();
    guard.disarm();
    std::thread::sleep(std::time::Duration::from_millis(200));
    assert!(child.try_wait().unwrap().is_none());
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(target_os = "macos")]
#[test]
fn child_processes_drop_only_the_posix_spawn_deny() {
    let fixture = Fixture::new();
    let readable = vec![];
    let temp = fixture.real_home();
    let spec = fixture.spec(false);
    let request = |child_processes| crate::PlatformRequest {
        program: std::path::Path::new("/bin/sh"),
        args: &[],
        root: &spec.workspace,
        writable: &[],
        temp: &temp,
        network: false,
        gpu: false,
        child_processes,
        readable: &readable,
        protected: &[],
        hidden: &[],
    };
    let denied = crate::macos::profile(&request(false)).unwrap();
    assert!(denied.contains("SYS_posix_spawn"));
    let allowed = crate::macos::profile(&request(true)).unwrap();
    assert!(!allowed.contains("SYS_posix_spawn"));
    assert!(allowed.contains("(deny default)"));
    assert!(allowed.contains("SYS_setsid SYS_setpgid"));
}

/// Runs `script` with `/bin/sh -c` in the sandbox of `spec`.
#[cfg(unix)]
fn run_sh(spec: &SandboxSpec, script: &str) -> (i32, String) {
    let args: Vec<OsString> = vec!["-c".into(), script.into()];
    let output = command(spec, Path::new("/bin/sh"), &args)
        .unwrap()
        .stdin(std::process::Stdio::null())
        .output()
        .unwrap();
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    (output.status.code().unwrap_or(-1), text)
}

#[cfg(unix)]
#[test]
fn hidden_paths_cannot_be_read_or_changed_by_a_confined_command() {
    if availability() != Availability::Available {
        return;
    }
    let fixture = Fixture::new();
    let workspace = fixture.workspace.path().canonicalize().unwrap();
    std::fs::write(workspace.join("notes.txt"), "visible notes").unwrap();
    std::fs::write(workspace.join(".env"), "TOKEN=secret-token").unwrap();
    std::fs::create_dir(workspace.join(".private")).unwrap();
    std::fs::write(workspace.join(".private/plan.txt"), "secret-plan").unwrap();
    let mut spec = fixture.spec(false);
    spec.read_write = vec![workspace.clone()];
    spec.deny_read = vec![workspace.join(".env"), workspace.join(".private")];
    let (_, output) = run_sh(
        &spec,
        "cat notes.txt; cat .env; cat .private/plan.txt; echo changed > .env; echo changed > .private/new.txt",
    );
    assert!(output.contains("visible notes"), "{output}");
    assert!(!output.contains("secret-token"), "{output}");
    assert!(!output.contains("secret-plan"), "{output}");
    assert_eq!(
        std::fs::read_to_string(workspace.join(".env")).unwrap(),
        "TOKEN=secret-token"
    );
    assert!(!workspace.join(".private/new.txt").exists());
    // Without the list the same command reads them.
    spec.deny_read.clear();
    let (_, output) = run_sh(&spec, "cat .env");
    assert!(output.contains("secret-token"), "{output}");
}

#[cfg(unix)]
#[test]
fn a_confined_command_cannot_create_git_or_oleafly_state_in_its_workspace() {
    if availability() != Availability::Available {
        return;
    }
    let fixture = Fixture::new();
    let workspace = fixture.workspace.path().canonicalize().unwrap();
    let mut spec = fixture.spec(false);
    spec.read_write = vec![workspace.clone()];
    // A write the sandbox allows, so a sandbox that can't start here (it
    // nests badly inside another one) skips the test.
    let (code, _) = run_sh(&spec, "echo ok > fine.txt");
    if code != 0 || !workspace.join("fine.txt").is_file() {
        return;
    }
    let (_, output) = run_sh(
        &spec,
        "mkdir -p .git/hooks; echo '[core]' > .git/config; echo hook > .git/hooks/pre-commit; mkdir -p .oleafly; echo x > .oleafly/state",
    );
    assert!(!workspace.join(".git/config").exists(), "{output}");
    assert!(!workspace.join(".git/hooks").exists(), "{output}");
    assert!(!workspace.join(".oleafly/state").exists(), "{output}");
}

#[cfg(target_os = "macos")]
#[test]
fn child_processes_let_programs_that_posix_spawn_start_helpers() {
    let fixture = Fixture::new();
    // awk's system() and Rust's Command start their children with posix_spawn.
    let script = "/usr/bin/awk 'BEGIN { exit system(\"/bin/echo helper\") }'";
    let (code, _) = run_sh(&fixture.spec(false), script);
    assert_ne!(code, 0);
    let mut spec = fixture.spec(false);
    spec.child_processes = true;
    let (code, output) = run_sh(&spec, script);
    assert_eq!(code, 0, "{output}");
    assert!(output.contains("helper"), "{output}");
}
