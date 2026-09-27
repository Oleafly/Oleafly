use super::*;
use std::os::unix::fs::PermissionsExt;
use tempfile::TempDir;

struct Fixture {
    _home: TempDir,
    _data: TempDir,
    _apps: TempDir,
    _system: TempDir,
    environment: Environment,
}

fn fixture(platform: Platform) -> Fixture {
    let home = TempDir::new().unwrap();
    let data = TempDir::new().unwrap();
    let apps = TempDir::new().unwrap();
    let system = TempDir::new().unwrap();
    let bundled = apps.path().join("Oleafly.app/Contents/MacOS/oleafly-cli");
    std::fs::create_dir_all(bundled.parent().unwrap()).unwrap();
    std::fs::write(&bundled, b"#!/bin/sh\necho oleafly 1\n").unwrap();
    std::fs::set_permissions(&bundled, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::set_permissions(system.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
    let environment = Environment {
        platform,
        home: home.path().canonicalize().unwrap(),
        data_root: data.path().to_path_buf(),
        bundled: Some(bundled.canonicalize().unwrap()),
        appimage: None,
        system_directory: system.path().to_path_buf(),
        search_path: Vec::new(),
        shell: None,
    };
    Fixture {
        _home: home,
        _data: data,
        _apps: apps,
        _system: system,
        environment,
    }
}

fn no_shell_path(_: ShellStart) -> Vec<PathBuf> {
    Vec::new()
}

fn local_bin(environment: &Environment) -> PathBuf {
    environment.home.join(".local/bin")
}

fn entries(directory: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn record_json(environment: &Environment) -> serde_json::Value {
    serde_json::from_slice(&std::fs::read(environment.data_root.join(RECORD_FILE)).unwrap())
        .unwrap()
}

#[test]
fn macos_uses_usr_local_bin_only_when_this_user_can_write_to_it() {
    let fixture = fixture(Platform::MacOs);
    let mut environment = fixture.environment.clone();
    if unsafe { libc::geteuid() } != 0 {
        assert_eq!(choose_directory(&environment), local_bin(&environment));
    }
    std::fs::set_permissions(
        &environment.system_directory,
        std::fs::Permissions::from_mode(0o755),
    )
    .unwrap();
    assert_eq!(choose_directory(&environment), environment.system_directory);
    environment.system_directory = environment.home.join("missing");
    assert_eq!(choose_directory(&environment), local_bin(&environment));
}

#[test]
fn linux_uses_the_per_user_bin_folder() {
    let fixture = fixture(Platform::Linux);
    let environment = fixture.environment.clone();
    std::fs::set_permissions(
        &environment.system_directory,
        std::fs::Permissions::from_mode(0o755),
    )
    .unwrap();
    assert_eq!(choose_directory(&environment), local_bin(&environment));
}

#[test]
fn only_the_appimage_this_app_runs_from_is_trusted() {
    let root = TempDir::new().unwrap();
    let appimage = root.path().join("Oleafly.AppImage");
    std::fs::write(&appimage, b"appimage").unwrap();
    let mount = root.path().join(".mount_Oleafl1");
    std::fs::create_dir_all(mount.join("usr/bin")).unwrap();
    std::fs::write(mount.join("usr/bin/oleafly-desktop"), b"app").unwrap();
    let mount = mount.canonicalize().unwrap();
    let executable = mount.join("usr/bin/oleafly-desktop");
    let editor = root.path().join("Editor.AppImage");
    std::fs::write(&editor, b"editor").unwrap();
    let editor_mount = root.path().join(".mount_Editor2");
    std::fs::create_dir_all(&editor_mount).unwrap();
    let installed = Path::new("/usr/bin/oleafly-desktop");

    assert_eq!(
        running_appimage(
            Platform::Linux,
            Some(appimage.clone().into()),
            Some(mount.clone().into()),
            Some(&executable)
        ),
        Some(appimage.clone())
    );
    assert_eq!(
        running_appimage(
            Platform::Linux,
            Some(editor.clone().into()),
            Some(editor_mount.clone().into()),
            Some(installed)
        ),
        None
    );
    assert_eq!(
        running_appimage(Platform::Linux, Some(editor.into()), None, Some(installed)),
        None
    );
    assert_eq!(
        running_appimage(
            Platform::Linux,
            Some(appimage.clone().into()),
            Some(mount.clone().into()),
            None
        ),
        None
    );
    assert_eq!(
        running_appimage(
            Platform::MacOs,
            Some(appimage.into()),
            Some(mount.clone().into()),
            Some(&executable)
        ),
        None
    );
    assert_eq!(
        running_appimage(
            Platform::Linux,
            Some("Oleafly.AppImage".into()),
            Some(mount.into()),
            Some(&executable)
        ),
        None
    );
}

#[test]
fn a_command_the_linux_package_installs_needs_no_install() {
    let fixture = fixture(Platform::Linux);
    let environment = fixture.environment.clone();
    let bundled = environment.bundled.clone().unwrap();
    let packaged = bundled.with_file_name("oleafly");
    std::fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("linux/oleafly"),
        &packaged,
    )
    .unwrap();
    std::fs::set_permissions(&packaged, std::fs::Permissions::from_mode(0o755)).unwrap();

    let found = status(&environment, &no_shell_path);
    assert_eq!(found.state, State::Packaged);
    assert_eq!(found.path, Some(packaged.display().to_string()));
    assert_eq!(found.method, None);
    assert!(found.hint.is_none());

    let mut macos = environment.clone();
    macos.platform = Platform::MacOs;
    assert_eq!(status(&macos, &no_shell_path).state, State::NotInstalled);

    let mut appimage = environment.clone();
    appimage.appimage = Some(environment.home.join("Oleafly.AppImage"));
    assert_eq!(status(&appimage, &no_shell_path).state, State::NotInstalled);

    install(&environment, &no_shell_path).unwrap();
    let linked = status(&environment, &no_shell_path);
    assert_eq!(linked.state, State::Installed);
    uninstall(&environment, &no_shell_path).unwrap();
    assert_eq!(status(&environment, &no_shell_path).state, State::Packaged);

    std::fs::write(&packaged, b"\x7fELF desktop app built by cargo").unwrap();
    assert_eq!(
        status(&environment, &no_shell_path).state,
        State::NotInstalled,
        "a development build's app binary is not the packaged command"
    );
}

#[test]
fn install_links_the_bundled_command_and_remembers_it() {
    let fixture = fixture(Platform::MacOs);
    let environment = &fixture.environment;
    let before = status(environment, &no_shell_path);
    assert_eq!(before.state, State::NotInstalled);
    assert_eq!(before.method, Some(Method::Link));
    assert_eq!(before.path.as_deref(), Some("~/.local/bin/oleafly"));
    assert_eq!(before.directory.as_deref(), Some("~/.local/bin"));

    let change = install(environment, &no_shell_path).unwrap();
    assert_eq!(change.action, Action::Linked);
    assert_eq!(change.status.state, State::Installed);
    let command = local_bin(environment).join("oleafly");
    assert!(std::fs::symlink_metadata(&command)
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(
        std::fs::read_link(&command).unwrap(),
        environment.bundled.clone().unwrap()
    );
    assert_eq!(entries(&local_bin(environment)), vec!["oleafly"]);
    let record = record_json(environment);
    assert_eq!(record["method"], "link");
    assert_eq!(record["path"], command.display().to_string());
    assert!(record.get("app").is_none_or(serde_json::Value::is_null));
}

#[test]
fn an_appimage_install_copies_the_command_and_records_where_the_app_is() {
    let fixture = fixture(Platform::Linux);
    let mut environment = fixture.environment.clone();
    let appimage = environment.home.join("Apps/Oleafly_0.5.0_amd64.AppImage");
    std::fs::create_dir_all(appimage.parent().unwrap()).unwrap();
    std::fs::write(&appimage, b"appimage").unwrap();
    environment.appimage = Some(appimage.clone());
    assert_eq!(
        status(&environment, &no_shell_path).method,
        Some(Method::Copy)
    );

    let change = install(&environment, &no_shell_path).unwrap();
    assert_eq!(change.action, Action::Copied);
    assert_eq!(change.status.state, State::Installed);
    let command = local_bin(&environment).join("oleafly");
    let metadata = std::fs::symlink_metadata(&command).unwrap();
    assert!(metadata.is_file());
    assert_eq!(metadata.permissions().mode() & 0o777, 0o700);
    assert_eq!(
        std::fs::read(&command).unwrap(),
        std::fs::read(environment.bundled.as_ref().unwrap()).unwrap()
    );
    assert_eq!(entries(&local_bin(&environment)), vec!["oleafly"]);
    let record = record_json(&environment);
    assert_eq!(record["method"], "copy");
    assert_eq!(record["app"], appimage.display().to_string());

    std::fs::write(
        environment.bundled.as_ref().unwrap(),
        b"#!/bin/sh\necho oleafly 2\n",
    )
    .unwrap();
    assert_eq!(status(&environment, &no_shell_path).state, State::Outdated);
    assert_eq!(
        install(&environment, &no_shell_path).unwrap().status.state,
        State::Installed
    );
    assert_eq!(
        std::fs::read(&command).unwrap(),
        b"#!/bin/sh\necho oleafly 2\n".to_vec()
    );

    let moved = environment.home.join("Apps/Oleafly.AppImage");
    std::fs::rename(&appimage, &moved).unwrap();
    environment.appimage = Some(moved.clone());
    assert_eq!(status(&environment, &no_shell_path).state, State::Outdated);
    install(&environment, &no_shell_path).unwrap();
    assert_eq!(
        record_json(&environment)["app"],
        moved.display().to_string()
    );
}

#[test]
fn a_moved_app_leaves_an_outdated_link_that_install_repairs() {
    let fixture = fixture(Platform::MacOs);
    let mut environment = fixture.environment.clone();
    install(&environment, &no_shell_path).unwrap();
    let old = environment.bundled.clone().unwrap();
    let moved = environment
        .home
        .join("Applications/Oleafly.app/Contents/MacOS/oleafly-cli");
    std::fs::create_dir_all(moved.parent().unwrap()).unwrap();
    std::fs::rename(&old, &moved).unwrap();
    environment.bundled = Some(moved.canonicalize().unwrap());
    assert_eq!(status(&environment, &no_shell_path).state, State::Outdated);
    let change = install(&environment, &no_shell_path).unwrap();
    assert_eq!(change.status.state, State::Installed);
    assert_eq!(
        std::fs::read_link(local_bin(&environment).join("oleafly")).unwrap(),
        environment.bundled.clone().unwrap()
    );
}

#[test]
fn someone_elses_oleafly_is_never_replaced() {
    let fixture = fixture(Platform::Linux);
    let environment = &fixture.environment;
    std::fs::create_dir_all(local_bin(environment)).unwrap();
    let command = local_bin(environment).join("oleafly");
    std::fs::write(&command, b"mine").unwrap();
    assert_eq!(status(environment, &no_shell_path).state, State::Occupied);
    let error = install(environment, &no_shell_path).unwrap_err();
    assert_eq!(error.code, "shell_command.occupied");
    assert_eq!(
        error.params.get("path").map(String::as_str),
        Some("~/.local/bin/oleafly")
    );
    assert_eq!(std::fs::read(&command).unwrap(), b"mine");
    let error = uninstall(environment, &no_shell_path).unwrap_err();
    assert_eq!(error.code, "shell_command.occupied");
    assert_eq!(std::fs::read(&command).unwrap(), b"mine");
    assert!(!environment.data_root.join(RECORD_FILE).exists());
}

#[test]
fn remove_deletes_only_what_oleafly_installed() {
    let fixture = fixture(Platform::MacOs);
    let environment = &fixture.environment;
    install(environment, &no_shell_path).unwrap();
    let change = uninstall(environment, &no_shell_path).unwrap();
    assert_eq!(change.action, Action::Removed);
    assert_eq!(change.status.state, State::NotInstalled);
    assert!(entries(&local_bin(environment)).is_empty());
    assert!(!environment.data_root.join(RECORD_FILE).exists());

    install(environment, &no_shell_path).unwrap();
    let command = local_bin(environment).join("oleafly");
    std::fs::remove_file(&command).unwrap();
    std::fs::write(&command, b"replaced by the user").unwrap();
    let error = uninstall(environment, &no_shell_path).unwrap_err();
    assert_eq!(error.code, "shell_command.changed");
    assert_eq!(std::fs::read(&command).unwrap(), b"replaced by the user");
}

#[test]
fn a_changed_copy_is_left_in_place() {
    let fixture = fixture(Platform::Linux);
    let mut environment = fixture.environment.clone();
    environment.appimage = Some(environment.home.join("Oleafly.AppImage"));
    install(&environment, &no_shell_path).unwrap();
    let command = local_bin(&environment).join("oleafly");
    std::fs::write(&command, b"edited").unwrap();
    assert_eq!(status(&environment, &no_shell_path).state, State::Occupied);
    assert_eq!(
        uninstall(&environment, &no_shell_path).unwrap_err().code,
        "shell_command.changed"
    );
    assert_eq!(std::fs::read(&command).unwrap(), b"edited");
}

#[test]
fn a_link_to_this_app_counts_as_installed_even_without_a_record() {
    let fixture = fixture(Platform::MacOs);
    let environment = &fixture.environment;
    std::fs::create_dir_all(local_bin(environment)).unwrap();
    let command = local_bin(environment).join("oleafly");
    std::os::unix::fs::symlink(environment.bundled.as_ref().unwrap(), &command).unwrap();
    assert_eq!(status(environment, &no_shell_path).state, State::Installed);
    uninstall(environment, &no_shell_path).unwrap();
    assert!(std::fs::symlink_metadata(&command).is_err());
}

#[test]
fn a_record_for_a_command_the_user_deleted_is_forgotten() {
    let fixture = fixture(Platform::MacOs);
    let environment = &fixture.environment;
    install(environment, &no_shell_path).unwrap();
    std::fs::remove_file(local_bin(environment).join("oleafly")).unwrap();
    assert_eq!(
        status(environment, &no_shell_path).state,
        State::NotInstalled
    );
    assert_eq!(
        uninstall(environment, &no_shell_path).unwrap().status.state,
        State::NotInstalled
    );
    assert!(!environment.data_root.join(RECORD_FILE).exists());
    assert_eq!(
        install(environment, &no_shell_path).unwrap().status.state,
        State::Installed
    );
}

#[test]
fn status_says_whether_the_folder_is_on_path() {
    let fixture = fixture(Platform::MacOs);
    let mut environment = fixture.environment.clone();
    let probes = std::cell::RefCell::new(Vec::new());
    let shell_path = |start: ShellStart| {
        probes.borrow_mut().push(start);
        Vec::new()
    };
    assert!(!status(&environment, &shell_path).on_path);
    assert!(
        probes.borrow().is_empty(),
        "no probe before anything is installed"
    );

    install(&environment, &no_shell_path).unwrap();
    let missing = status(&environment, &shell_path);
    assert!(!missing.on_path);
    assert!(!missing.after_sign_in);
    assert!(missing.hint.is_some());
    assert_eq!(*probes.borrow(), vec![ShellStart::Login]);

    let directory = local_bin(&environment);
    let found = status(&environment, &|start| {
        if start == ShellStart::Login {
            vec![directory.clone()]
        } else {
            Vec::new()
        }
    });
    assert!(found.on_path);
    assert!(found.hint.is_none());
    environment.search_path = vec![PathBuf::from("/usr/bin"), directory.join(".")];
    assert!(status(&environment, &shell_path).on_path);
    assert_eq!(probes.borrow().len(), 1, "the app's own PATH answers first");
}

#[test]
fn linux_says_when_the_folder_arrives_only_at_the_next_sign_in() {
    let fixture = fixture(Platform::Linux);
    let environment = fixture.environment.clone();
    install(&environment, &no_shell_path).unwrap();
    let directory = local_bin(&environment);

    let probes = std::cell::RefCell::new(Vec::new());
    let profile_only = |start: ShellStart| {
        probes.borrow_mut().push(start);
        if start == ShellStart::Login {
            vec![PathBuf::from("/usr/bin"), directory.clone()]
        } else {
            vec![PathBuf::from("/usr/bin")]
        }
    };
    let later = status(&environment, &profile_only);
    assert!(!later.on_path);
    assert!(later.after_sign_in);
    assert!(later.hint.is_none());
    assert_eq!(
        *probes.borrow(),
        vec![ShellStart::Interactive, ShellStart::Login]
    );

    let rc_file = |start: ShellStart| {
        assert_eq!(start, ShellStart::Interactive);
        vec![directory.clone()]
    };
    let now = status(&environment, &rc_file);
    assert!(now.on_path);
    assert!(!now.after_sign_in);
    assert!(now.hint.is_none());

    let nowhere = status(&environment, &no_shell_path);
    assert!(!nowhere.on_path);
    assert!(!nowhere.after_sign_in);
    assert_eq!(nowhere.hint.unwrap().file.as_deref(), Some("~/.profile"));
}

#[test]
fn the_path_hint_matches_the_users_shell() {
    let home = Path::new("/Users/me");
    let local = home.join(".local/bin");
    assert_eq!(
        path_hint(Platform::MacOs, Some(Path::new("/bin/zsh")), &local, home),
        PathHint {
            file: Some("~/.zshrc".into()),
            line: r#"export PATH="$HOME/.local/bin:$PATH""#.into(),
        }
    );
    assert_eq!(
        path_hint(
            Platform::Linux,
            Some(Path::new("/usr/bin/bash")),
            &local,
            home
        )
        .file
        .as_deref(),
        Some("~/.bashrc")
    );
    assert_eq!(
        path_hint(Platform::MacOs, Some(Path::new("/bin/bash")), &local, home)
            .file
            .as_deref(),
        Some("~/.bash_profile")
    );
    assert_eq!(
        path_hint(
            Platform::Linux,
            Some(Path::new("/opt/homebrew/bin/fish")),
            &local,
            home
        ),
        PathHint {
            file: None,
            line: "fish_add_path ~/.local/bin".into(),
        }
    );
    assert_eq!(
        path_hint(Platform::Linux, None, Path::new("/usr/local/bin"), home),
        PathHint {
            file: Some("~/.profile".into()),
            line: r#"export PATH="/usr/local/bin:$PATH""#.into(),
        }
    );
}

#[test]
fn builds_without_the_command_and_quarantined_copies_explain_why() {
    let fixture = fixture(Platform::MacOs);
    let mut environment = fixture.environment.clone();
    environment.bundled = Some(PathBuf::from(
        "/private/var/folders/xy/T/AppTranslocation/1234/d/Oleafly.app/Contents/MacOS/oleafly-cli",
    ));
    assert_eq!(status(&environment, &no_shell_path).state, State::MoveApp);
    assert_eq!(
        install(&environment, &no_shell_path).unwrap_err().code,
        "shell_command.move_app"
    );
    environment.bundled = None;
    assert_eq!(
        status(&environment, &no_shell_path).state,
        State::Unavailable
    );
    assert_eq!(
        install(&environment, &no_shell_path).unwrap_err().code,
        "shell_command.unavailable"
    );
}

#[test]
fn paths_under_home_are_shown_with_a_tilde() {
    let home = Path::new("/home/me");
    assert_eq!(
        tilde(Path::new("/home/me/.local/bin/oleafly"), home),
        "~/.local/bin/oleafly"
    );
    assert_eq!(tilde(Path::new("/home/me"), home), "~");
    assert_eq!(
        tilde(Path::new("/home/meadow/bin"), home),
        "/home/meadow/bin"
    );
    assert_eq!(
        tilde(Path::new("/usr/local/bin/oleafly"), home),
        "/usr/local/bin/oleafly"
    );
}

#[test]
fn the_shell_path_is_read_without_waiting_on_background_jobs() {
    let folder = TempDir::new().unwrap();
    let shell = folder.path().join("fake-shell");
    std::fs::write(
        &shell,
        "#!/bin/sh\n(sleep 5 &)\necho 'Welcome back'\necho '/opt/tools:/home/me/.local/bin'\n",
    )
    .unwrap();
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
    let started = Instant::now();
    assert_eq!(
        shell_path_within(Some(&shell), ShellStart::Login, Duration::from_secs(3)),
        vec![
            PathBuf::from("/opt/tools"),
            PathBuf::from("/home/me/.local/bin")
        ]
    );
    assert!(started.elapsed() < Duration::from_secs(3));

    let slow = folder.path().join("slow-shell");
    std::fs::write(&slow, "#!/bin/sh\nsleep 5\necho /never\n").unwrap();
    std::fs::set_permissions(&slow, std::fs::Permissions::from_mode(0o755)).unwrap();
    let started = Instant::now();
    assert!(
        shell_path_within(Some(&slow), ShellStart::Login, Duration::from_millis(200)).is_empty()
    );
    assert!(started.elapsed() < Duration::from_secs(3));

    let stuck = folder.path().join("stuck-shell");
    let pid_file = folder.path().join("helper.pid");
    std::fs::write(
        &stuck,
        format!(
            "#!/bin/sh\nsleep 30 &\necho $! > '{}'\nwait\n",
            pid_file.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&stuck, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(
        shell_path_within(Some(&stuck), ShellStart::Login, Duration::from_millis(500)).is_empty()
    );
    let helper: libc::pid_t = std::fs::read_to_string(&pid_file)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while unsafe { libc::kill(helper, 0) } == 0 {
        assert!(
            Instant::now() < deadline,
            "the stuck shell's helper outlived the probe"
        );
        std::thread::sleep(Duration::from_millis(25));
    }

    assert!(shell_path_within(None, ShellStart::Login, Duration::from_secs(1)).is_empty());
    assert!(shell_path_within(
        Some(Path::new("zsh")),
        ShellStart::Login,
        Duration::from_secs(1)
    )
    .is_empty());
}

#[test]
fn the_probe_starts_the_shell_the_way_a_terminal_does() {
    let folder = TempDir::new().unwrap();
    let shell = folder.path().join("fake-shell");
    std::fs::write(
        &shell,
        "#!/bin/sh\n\
         path=/usr/bin\n\
         for flag in \"$@\"; do\n\
         case \"$flag\" in\n\
         -l) path=\"/profile/bin:$path\" ;;\n\
         -i) path=\"/rc/bin:$path\" ;;\n\
         esac\n\
         done\n\
         echo 'Last login: today'\n\
         echo __OLEAFLY_PATH__\n\
         echo \"$path\"\n\
         echo 'logout'\n",
    )
    .unwrap();
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(
        shell_path_within(
            Some(&shell),
            ShellStart::Interactive,
            Duration::from_secs(3)
        ),
        vec![PathBuf::from("/rc/bin"), PathBuf::from("/usr/bin")]
    );
    let login = shell_path_within(Some(&shell), ShellStart::Login, Duration::from_secs(3));
    assert!(login.contains(&PathBuf::from("/rc/bin")), "{login:?}");
    assert!(login.contains(&PathBuf::from("/profile/bin")), "{login:?}");
}

#[test]
fn the_printed_path_is_the_line_after_the_marker() {
    assert_eq!(
        printed_path("motd\n__OLEAFLY_PATH__\n/a:/b\nlogout\n"),
        vec![PathBuf::from("/a"), PathBuf::from("/b")]
    );
    assert_eq!(
        printed_path("Welcome\n/c:/d\n\n"),
        vec![PathBuf::from("/c"), PathBuf::from("/d")]
    );
    assert!(printed_path("__OLEAFLY_PATH__\n\n").is_empty());
    assert!(printed_path("").is_empty());
}

#[test]
fn a_folder_added_in_zshrc_counts_as_on_path() {
    let zsh = Path::new("/bin/zsh");
    if !zsh.is_file() {
        return;
    }
    let folder = TempDir::new().unwrap();
    let dotfiles = folder.path().join("dotfiles");
    std::fs::create_dir(&dotfiles).unwrap();
    std::fs::write(
        dotfiles.join(".zshrc"),
        "export PATH=\"/oleafly-zshrc-marker/bin:$PATH\"\n",
    )
    .unwrap();
    let shell = folder.path().join("zsh");
    std::fs::write(
        &shell,
        format!(
            "#!/bin/sh\nZDOTDIR='{}' exec /bin/zsh \"$@\"\n",
            dotfiles.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
    for start in [ShellStart::Interactive, ShellStart::Login] {
        let path = shell_path_within(Some(&shell), start, Duration::from_secs(10));
        assert!(
            path.contains(&PathBuf::from("/oleafly-zshrc-marker/bin")),
            "{start:?} missed ~/.zshrc: {path:?}"
        );
    }
}

#[test]
fn the_app_package_builds_the_command_it_installs() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let bin = manifest_dir
        .join("src/bin")
        .join(format!("{BUNDLED_CLI}.rs"));
    assert!(bin.is_file(), "{} is missing", bin.display());
    let manifest: toml::Value =
        toml::from_str(&std::fs::read_to_string(manifest_dir.join("Cargo.toml")).unwrap()).unwrap();
    assert_eq!(
        manifest["package"]["default-run"].as_str(),
        Some("oleafly"),
        "tauri dev and the bundler must still pick the app, not the command"
    );
    assert!(manifest["dependencies"].get("oleafly-cli").is_some());
}
