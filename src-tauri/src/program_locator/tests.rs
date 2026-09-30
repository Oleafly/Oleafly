use super::*;
use std::ffi::OsString;

fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
    let pairs: Vec<(String, String)> = pairs
        .iter()
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect();
    move |name: &str| {
        pairs
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| OsString::from(value))
    }
}

fn file(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, content).unwrap();
}

#[cfg(unix)]
fn executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    file(path, "#!/bin/sh\n");
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

const WINDOWS: MatchRules<'static> = MatchRules {
    windows: true,
    native_only: false,
    pathext: None,
};

#[test]
fn pathext_order_decides_and_only_program_extensions_count() {
    let names = |pathext: Option<&str>, native: bool| -> Vec<String> {
        candidate_names("pi", pathext, native)
            .into_iter()
            .map(|(name, _)| name)
            .collect()
    };
    assert_eq!(names(None, false), ["pi.com", "pi.exe", "pi.bat", "pi.cmd"]);
    assert_eq!(
        names(Some(".CMD;.EXE;.VBS;.JS;.PS1;.cmd"), false),
        ["pi.cmd", "pi.exe"]
    );
    assert_eq!(names(Some(".JS;.VBS"), false), names(None, false));
    assert_eq!(names(Some(".CMD;.EXE"), true), ["pi.exe"]);
    assert_eq!(names(None, true), ["pi.com", "pi.exe"]);
    assert_eq!(
        candidate_names("pi.CMD", Some(".EXE"), false),
        [("pi.CMD".to_string(), ProgramKind::Script)]
    );
    assert_eq!(
        candidate_names("node.exe", None, true),
        [("node.exe".to_string(), ProgramKind::Native)]
    );
    assert!(candidate_names("npm.cmd", None, true)
        .iter()
        .all(|(name, _)| name.starts_with("npm.cmd.")));
}

#[test]
fn a_windows_folder_prefers_pathext_order_and_reports_powershell_only_installs() {
    let temp = tempfile::tempdir().unwrap();
    let npm = temp.path().join("npm");
    for name in ["pi", "pi.ps1", "pi.cmd"] {
        file(&npm.join(name), "fixture");
    }
    let (found, rejected) = match_in_dir(&npm, "pi", WINDOWS);
    assert_eq!(
        found,
        Some(Located {
            path: npm.join("pi.cmd"),
            kind: ProgramKind::Script
        })
    );
    assert!(rejected.is_empty());
    file(&npm.join("pi.exe"), "fixture");
    let rules = MatchRules {
        pathext: Some(".CMD;.EXE"),
        ..WINDOWS
    };
    assert_eq!(
        match_in_dir(&npm, "pi", rules).0.unwrap().path,
        npm.join("pi.cmd")
    );
    assert_eq!(
        match_in_dir(&npm, "pi", WINDOWS).0.unwrap().path,
        npm.join("pi.exe")
    );

    let powershell = temp.path().join("powershell");
    file(&powershell.join("pi.ps1"), "fixture");
    file(&powershell.join("pi"), "fixture");
    let (found, rejected) = match_in_dir(&powershell, "pi", WINDOWS);
    assert!(found.is_none());
    assert_eq!(
        rejected,
        [
            Rejected {
                path: powershell.join("pi.ps1"),
                reason: RejectReason::PowerShellScript
            },
            Rejected {
                path: powershell.join("pi"),
                reason: RejectReason::NotExecutable
            }
        ]
    );
    let (found, rejected) = search_in(&[powershell.clone(), npm.clone()], "pi", WINDOWS);
    assert_eq!(found.unwrap().path, npm.join("pi.exe"));
    assert_eq!(rejected.len(), 2);
    let native = MatchRules {
        native_only: true,
        ..WINDOWS
    };
    std::fs::remove_file(npm.join("pi.exe")).unwrap();
    assert!(match_in_dir(&npm, "pi", native).0.is_none());
    assert!(match_in_dir(&powershell, "pi", native).1.is_empty());
}

#[test]
fn store_python_placeholders_are_skipped() {
    let temp = tempfile::tempdir().unwrap();
    let apps = temp.path().join("WindowsApps");
    file(&apps.join("python.exe"), "placeholder");
    file(&apps.join("hermes.exe"), "alias");
    assert!(match_in_dir(&apps, "python", WINDOWS).0.is_none());
    assert!(match_in_dir(&apps, "hermes", WINDOWS).0.is_some());
}

#[cfg(unix)]
#[test]
fn unix_folders_need_an_executable_file() {
    let temp = tempfile::tempdir().unwrap();
    let rules = MatchRules {
        windows: false,
        native_only: false,
        pathext: None,
    };
    file(&temp.path().join("pi"), "not executable");
    let (found, rejected) = match_in_dir(temp.path(), "pi", rules);
    assert!(found.is_none());
    assert_eq!(rejected[0].reason, RejectReason::NotExecutable);
    executable(&temp.path().join("pi"));
    assert_eq!(
        match_in_dir(temp.path(), "pi", rules).0,
        Some(Located {
            path: temp.path().join("pi"),
            kind: ProgramKind::Native
        })
    );
    std::fs::create_dir(temp.path().join("folder")).unwrap();
    assert_eq!(
        match_in_dir(temp.path(), "folder", rules),
        (None, Vec::new())
    );
}

#[cfg(unix)]
#[test]
fn located_paths_keep_symlinks_as_found() {
    let temp = tempfile::tempdir().unwrap();
    let target = temp.path().join("lib/cli.js");
    executable(&target);
    std::fs::create_dir(temp.path().join("bin")).unwrap();
    std::os::unix::fs::symlink(&target, temp.path().join("bin/pi")).unwrap();
    let rules = MatchRules {
        windows: false,
        native_only: false,
        pathext: None,
    };
    assert_eq!(
        match_in_dir(&temp.path().join("bin"), "pi", rules)
            .0
            .unwrap()
            .path,
        temp.path().join("bin/pi")
    );
}

#[test]
fn registry_path_is_machine_then_user_and_expands_once_from_process_user_then_machine() {
    let blocks = EnvironmentBlocks {
        machine: vec![
            (
                "Path".into(),
                r"%SystemRoot%\system32;%ProgramFiles%\nodejs;%UNKNOWN%\bin;;".into(),
            ),
            ("SystemRoot".into(), r"C:\WINDOWS".into()),
            ("NVM_SYMLINK".into(), r"C:\machine-nvm".into()),
        ],
        user: vec![
            (
                "PATH".into(),
                r#"%NVM_SYMLINK%;"D:\Tools; Agents\Pi";%LOCALAPPDATA%\pnpm;%%"#.into(),
            ),
            ("nvm_symlink".into(), r"D:\nvm\nodejs".into()),
            ("PNPM_HOME".into(), r"%LOCALAPPDATA%\pnpm".into()),
        ],
    };
    let process = env(&[
        ("ProgramFiles", r"C:\Program Files"),
        ("LOCALAPPDATA", r"C:\Users\r\AppData\Local"),
    ]);
    let entries: Vec<String> = blocks
        .path_entries(&process)
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        entries,
        [
            r"C:\WINDOWS\system32",
            r"C:\Program Files\nodejs",
            r"%UNKNOWN%\bin",
            r"D:\nvm\nodejs",
            r"D:\Tools; Agents\Pi",
            r"C:\Users\r\AppData\Local\pnpm",
            "%%",
        ]
    );
    assert_eq!(
        blocks.lookup(&process, "pnpm_home"),
        Some(OsString::from(r"%LOCALAPPDATA%\pnpm"))
    );
    assert_eq!(
        blocks.lookup(&env(&[("NVM_SYMLINK", r"E:\process")]), "NVM_SYMLINK"),
        Some(OsString::from(r"E:\process"))
    );
    assert_eq!(blocks.lookup(&env(&[]), "MISSING"), None);
    assert!(EnvironmentBlocks::default()
        .path_entries(&process)
        .is_empty());
}

#[test]
fn percent_expansion_leaves_unknown_and_unterminated_names_literal() {
    let lookup = env(&[("A", "one"), ("B", "two")]);
    assert_eq!(expand_percent("%A%\\%B%", &lookup), "one\\two");
    assert_eq!(expand_percent("x%Z%y%A%", &lookup), "x%Z%yone");
    assert_eq!(expand_percent("100% sure", &lookup), "100% sure");
    assert_eq!(expand_percent("%%A%", &lookup), "%one");
    assert_eq!(expand_percent("%a%", &lookup), "one");
}

#[test]
fn windows_path_lists_split_on_semicolons_outside_quotes() {
    assert_eq!(
        split_windows_path_list(r#"C:\a;"C:\b;c";;  ;D:\d"#),
        [r"C:\a", r"C:\b;c", r"D:\d"]
    );
    assert!(split_windows_path_list("").is_empty());
}

#[test]
fn known_windows_folders_cover_installers_version_managers_and_agents() {
    let lookup = env(&[
        ("USERPROFILE", r"C:\Users\r"),
        ("HOME", r"C:\msys\home\r"),
        ("ProgramFiles", r"C:\Program Files"),
        ("ProgramFiles(x86)", r"C:\Program Files (x86)"),
        ("APPDATA", r"C:\Users\r\AppData\Roaming"),
        ("LOCALAPPDATA", r"C:\Users\r\AppData\Local"),
        ("NVM_SYMLINK", r"D:\nvm\nodejs"),
        ("PNPM_HOME", r"D:\pnpm"),
        ("ProgramData", r"C:\ProgramData"),
        ("HERMES_HOME", r"E:\hermes"),
        ("PI_CODING_AGENT_DIR", r"D:\Tools\Agents\Pi"),
        ("npm_config_prefix", r"D:\npm-prefix"),
    ]);
    let dirs = known_dirs(&lookup, true);
    let home = PathBuf::from(r"C:\Users\r");
    let local = PathBuf::from(r"C:\Users\r\AppData\Local");
    let roaming = PathBuf::from(r"C:\Users\r\AppData\Roaming");
    for expected in [
        home.join(".local").join("bin"),
        home.join(".cargo").join("bin"),
        home.join(".bun").join("bin"),
        home.join(".pi").join("agent").join("bin"),
        home.join(".volta").join("bin"),
        home.join("bin"),
        PathBuf::from(r"D:\Tools\Agents\Pi").join("bin"),
        PathBuf::from(r"C:\Program Files").join("nodejs"),
        PathBuf::from(r"C:\Program Files (x86)").join("nodejs"),
        roaming.join("npm"),
        PathBuf::from(r"D:\nvm\nodejs"),
        local.join("nvm").join("current"),
        local.join("Programs").join("nodejs"),
        PathBuf::from(r"D:\pnpm"),
        local.join("pnpm"),
        local.join("Yarn").join("bin"),
        local.join("Volta").join("bin"),
        roaming.join("fnm").join("aliases").join("default"),
        home.join("scoop").join("shims"),
        PathBuf::from(r"C:\ProgramData")
            .join("chocolatey")
            .join("bin"),
        local.join("Microsoft").join("WinGet").join("Links"),
        local.join("hermes").join("bin"),
        PathBuf::from(r"E:\hermes").join("bin"),
        local.join("pi-node").join("current"),
        home.join(".npm-global"),
        PathBuf::from(r"D:\npm-prefix"),
    ] {
        assert!(dirs.contains(&expected), "{}", expected.display());
    }
    assert!(!dirs.iter().any(|dir| dir.starts_with(r"C:\msys\home\r")));
    assert!(!dirs.contains(&PathBuf::from("/usr/local/bin")));
    assert!(known_dirs(&env(&[]), true).is_empty());
}

#[test]
fn known_unix_folders_cover_version_managers_and_system_prefixes() {
    let lookup = env(&[
        ("HOME", "/home/r"),
        ("FNM_DIR", "/opt/fnm"),
        ("npm_config_prefix", "/opt/npm"),
    ]);
    let dirs = known_dirs(&lookup, false);
    for expected in [
        "/home/r/.local/bin",
        "/home/r/.npm-global/bin",
        "/home/r/.pi/agent/bin",
        "/home/r/.opencode/bin",
        "/home/r/bin",
        "/home/r/.local/share/mise/shims",
        "/home/r/.asdf/shims",
        "/home/r/.nodenv/shims",
        "/home/r/.local/share/fnm/aliases/default/bin",
        "/opt/fnm/aliases/default/bin",
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/opt/local/bin",
        "/usr/bin",
        "/home/linuxbrew/.linuxbrew/bin",
        "/opt/npm/bin",
    ] {
        assert!(dirs.contains(&PathBuf::from(expected)), "{expected}");
    }
}

// nvm is the unix version manager; it keeps an alias in a file named
// `lts/*`, which Windows can't create. nvm-windows is found through
// NVM_SYMLINK instead.
#[cfg(unix)]
#[test]
fn nvm_default_alias_resolves_to_the_newest_matching_install() {
    let temp = tempfile::tempdir().unwrap();
    let nvm = temp.path();
    for version in ["v20.19.0", "v22.9.0", "v22.19.1", "v22.19.0", "v24.1.0"] {
        std::fs::create_dir_all(nvm.join("versions/node").join(version).join("bin")).unwrap();
    }
    assert_eq!(nvm_default_bin(nvm), None);
    file(&nvm.join("alias/default"), "22\n");
    assert_eq!(
        nvm_default_bin(nvm),
        Some(nvm.join("versions/node/v22.19.1/bin"))
    );
    file(&nvm.join("alias/default"), "lts/*");
    file(&nvm.join("alias/lts/*"), "lts/jod");
    file(&nvm.join("alias/lts/jod"), "v20.19.0");
    assert_eq!(
        nvm_default_bin(nvm),
        Some(nvm.join("versions/node/v20.19.0/bin"))
    );
    file(&nvm.join("alias/default"), "node");
    assert_eq!(
        nvm_default_bin(nvm),
        Some(nvm.join("versions/node/v24.1.0/bin"))
    );
    for alias in ["system", "../../etc", "18"] {
        file(&nvm.join("alias/default"), alias);
        assert_eq!(nvm_default_bin(nvm), None, "{alias}");
    }
}

#[test]
fn npmrc_prefix_is_the_last_absolute_setting() {
    assert_eq!(
        npmrc_prefix("registry=https://x\nprefix=D:\\npm\n; prefix=E:\\old\n"),
        Some("D:\\npm".into())
    );
    assert_eq!(
        npmrc_prefix("prefix = \"/opt/npm\"\nPREFIX=/home/r/.npm-global\n"),
        Some("/home/r/.npm-global".into())
    );
    assert_eq!(npmrc_prefix("prefix=relative\n# prefix=/x"), None);
}

#[test]
fn search_folders_are_absolute_unique_and_never_empty() {
    let windows: Vec<PathBuf> = [
        r"C:\Tools",
        r"c:\tools\",
        r"C:/tools",
        "",
        "   ",
        r"relative\bin",
        r#"C:\Quoted"Name"#,
        r"\\server\share\bin",
        r"D:\Missing",
    ]
    .into_iter()
    .map(PathBuf::from)
    .collect();
    let kept = normalize_dirs(windows, true, |path| {
        !path.to_string_lossy().contains("Missing")
    });
    assert_eq!(
        kept,
        [
            PathBuf::from(r"C:\Tools"),
            PathBuf::from(r"\\server\share\bin")
        ]
    );

    let unix: Vec<PathBuf> = [
        "/usr/bin",
        "/usr/bin/",
        "/usr//bin",
        "",
        "relative/bin",
        "/opt/a:b",
        "/opt/tools",
    ]
    .into_iter()
    .map(PathBuf::from)
    .collect();
    assert_eq!(
        normalize_dirs(unix, false, |_| true),
        [PathBuf::from("/usr/bin"), PathBuf::from("/opt/tools")]
    );
}

#[test]
fn child_search_path_puts_prepended_folders_first_and_appends_only_new_ones() {
    let temp = tempfile::tempdir().unwrap();
    let first = temp.path().join("node");
    let last = temp.path().join("cli");
    std::fs::create_dir_all(&first).unwrap();
    std::fs::create_dir_all(&last).unwrap();
    let value = child_search_path(&[first.clone(), first.clone()], std::slice::from_ref(&last));
    let entries: Vec<PathBuf> = std::env::split_paths(&value).collect();
    assert_eq!(entries[0], first);
    assert_eq!(entries.last(), Some(&last));
    assert_eq!(entries.iter().filter(|entry| **entry == first).count(), 1);
    assert!(entries.iter().all(|entry| !entry.as_os_str().is_empty()));
    let missing = temp.path().join("missing");
    let value = child_search_path(std::slice::from_ref(&missing), &[]);
    assert!(!std::env::split_paths(&value).any(|entry| entry == missing));
}

#[test]
fn child_env_carries_the_search_path() {
    let env = child_env(&[], &[]);
    assert_eq!(env[0].0, "PATH");
    #[cfg(windows)]
    assert!(env
        .iter()
        .any(|(name, value)| name == "NoDefaultCurrentDirectoryInExePath" && value == "1"));
    #[cfg(not(windows))]
    assert_eq!(env.len(), 1);
}

#[test]
fn child_paths_are_never_verbatim() {
    let temp = tempfile::tempdir().unwrap();
    let canonical = temp.path().canonicalize().unwrap();
    let plain = child_path(&canonical);
    assert!(!plain.to_string_lossy().starts_with(r"\\?\"));
    assert_eq!(plain.canonicalize().unwrap(), canonical);
    #[cfg(windows)]
    {
        assert_eq!(
            child_path(Path::new(r"\\?\D:\Tools\node.exe")),
            PathBuf::from(r"D:\Tools\node.exe")
        );
        assert_eq!(
            child_path(Path::new(r"\\?\UNC\server\share\x")),
            PathBuf::from(r"\\server\share\x")
        );
    }
}

#[test]
fn a_tilde_expands_to_the_home_folder() {
    let home = Path::new("/home/r");
    assert_eq!(expand_tilde(Path::new("~"), Some(home)), home);
    assert_eq!(
        expand_tilde(Path::new("~/.local/bin/pi"), Some(home)),
        home.join(".local").join("bin").join("pi")
    );
    assert_eq!(
        expand_tilde(Path::new("~\\bin\\pi.cmd"), Some(home)),
        home.join("bin").join("pi.cmd")
    );
    assert_eq!(
        expand_tilde(Path::new("~other/pi"), Some(home)),
        PathBuf::from("~other/pi")
    );
    assert_eq!(expand_tilde(Path::new("~/pi"), None), PathBuf::from("~/pi"));
}

fn pe_image(subsystem: u16) -> Vec<u8> {
    let mut bytes = vec![0u8; 0x200];
    bytes[..2].copy_from_slice(b"MZ");
    bytes[0x3C..0x40].copy_from_slice(&0x80u32.to_le_bytes());
    bytes[0x80..0x84].copy_from_slice(b"PE\0\0");
    let field = 0x80 + 4 + 20 + 68;
    bytes[field..field + 2].copy_from_slice(&subsystem.to_le_bytes());
    bytes
}

#[test]
fn pe_subsystem_tells_console_programs_from_windowed_ones() {
    assert_eq!(pe_subsystem(&pe_image(3)), Some(3));
    assert_eq!(pe_subsystem(&pe_image(2)), Some(2));
    assert_eq!(pe_subsystem(b"#!/bin/sh"), None);
    let mut truncated = pe_image(3);
    truncated.truncate(0x90);
    assert_eq!(pe_subsystem(&truncated), None);
    let mut far = pe_image(3);
    far[0x3C..0x40].copy_from_slice(&u32::MAX.to_le_bytes());
    assert_eq!(pe_subsystem(&far), None);
}

#[test]
fn app_bundle_programs_are_recognised() {
    assert!(inside_app_bundle(Path::new(
        "/Applications/Claude.app/Contents/MacOS/claude"
    )));
    assert!(!inside_app_bundle(Path::new("/usr/local/bin/claude")));
    assert!(!inside_app_bundle(Path::new("/opt/app/Contents/MacOS/x")));
}

const WINDOWS_PLATFORM: Platform = Platform {
    windows: true,
    macos: false,
};
#[cfg(unix)]
const UNIX_PLATFORM: Platform = Platform {
    windows: false,
    macos: false,
};

#[test]
fn chosen_programs_on_windows_must_be_local_console_programs_or_scripts() {
    for network in [
        r"\\server\share\claude.exe",
        r"\\?\C:\Tools\claude.exe",
        r"\\.\C:\Tools\claude.exe",
        "//server/share/claude.exe",
    ] {
        assert_eq!(
            inspect_on(Path::new(network), WINDOWS_PLATFORM),
            Err(RejectReason::NetworkPath),
            "{network}"
        );
    }
    assert_eq!(
        inspect_on(Path::new(r"tools\pi.cmd"), WINDOWS_PLATFORM),
        Err(RejectReason::NotFound)
    );
    #[cfg(windows)]
    {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        std::fs::write(root.join("claude.exe"), pe_image(3)).unwrap();
        std::fs::write(root.join("Claude Desktop.exe"), pe_image(2)).unwrap();
        std::fs::write(root.join("fake.exe"), b"not a program").unwrap();
        std::fs::write(root.join("pi.cmd"), b"@echo off").unwrap();
        std::fs::write(root.join("pi.ps1"), b"echo").unwrap();
        std::fs::write(root.join("pi"), b"#!/bin/sh").unwrap();
        std::fs::write(root.join("node.exe"), pe_image(3)).unwrap();
        std::fs::write(root.join("PowerShell.EXE"), pe_image(3)).unwrap();
        let check = |name: &str| inspect_on(&root.join(name), WINDOWS_PLATFORM);
        assert_eq!(check("claude.exe").unwrap().kind, ProgramKind::Native);
        assert_eq!(check("pi.cmd").unwrap().kind, ProgramKind::Script);
        assert_eq!(check("Claude Desktop.exe"), Err(RejectReason::GuiProgram));
        assert_eq!(check("fake.exe"), Err(RejectReason::NotExecutable));
        assert_eq!(check("pi.ps1"), Err(RejectReason::PowerShellScript));
        assert_eq!(check("pi"), Err(RejectReason::NotExecutable));
        assert_eq!(check("node.exe"), Err(RejectReason::Interpreter));
        assert_eq!(check("PowerShell.EXE"), Err(RejectReason::Interpreter));
        assert_eq!(check("missing.exe"), Err(RejectReason::NotFound));
        assert_eq!(
            inspect_on(root, WINDOWS_PLATFORM),
            Err(RejectReason::Directory)
        );
        let canonical = root.join("claude.exe").canonicalize().unwrap();
        assert_eq!(
            inspect_on(&canonical, WINDOWS_PLATFORM),
            Err(RejectReason::NetworkPath)
        );
    }
}

#[cfg(unix)]
#[test]
fn chosen_programs_on_unix_must_be_executable_files_outside_app_bundles() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    executable(&root.join("pi"));
    executable(&root.join("python3"));
    executable(&root.join("Claude.app/Contents/MacOS/claude"));
    file(&root.join("plain"), "data");
    std::fs::set_permissions(root.join("plain"), std::fs::Permissions::from_mode(0o644)).unwrap();
    let check = |name: &str, platform| inspect_on(&root.join(name), platform);
    assert_eq!(check("pi", UNIX_PLATFORM).unwrap().path, root.join("pi"));
    assert_eq!(
        check("python3", UNIX_PLATFORM),
        Err(RejectReason::Interpreter)
    );
    assert_eq!(
        check("plain", UNIX_PLATFORM),
        Err(RejectReason::NotExecutable)
    );
    assert_eq!(check("missing", UNIX_PLATFORM), Err(RejectReason::NotFound));
    assert_eq!(check("", UNIX_PLATFORM), Err(RejectReason::Directory));
    let macos = Platform {
        windows: false,
        macos: true,
    };
    assert_eq!(
        check("Claude.app/Contents/MacOS/claude", macos),
        Err(RejectReason::GuiProgram)
    );
    assert!(check("Claude.app/Contents/MacOS/claude", UNIX_PLATFORM).is_ok());
    assert_eq!(
        inspect_on(Path::new("relative/pi"), UNIX_PLATFORM),
        Err(RejectReason::NotFound)
    );
}

#[test]
fn a_nonexistent_absolute_program_is_not_found() {
    let temp = tempfile::tempdir().unwrap();
    let missing = temp.path().join("missing-agent");
    assert_eq!(inspect(&missing), Err(RejectReason::NotFound));
    assert_eq!(locate_path(&missing), Err(RejectReason::NotFound));
    assert_eq!(locate_path(temp.path()), Err(RejectReason::Directory));
    assert_eq!(
        locate_path(Path::new("relative-agent")),
        Err(RejectReason::NotFound)
    );
}

#[test]
fn probe_folders_start_empty_and_disappear_when_dropped() {
    let temp = tempfile::tempdir().unwrap();
    let probe = probe_dir_in(&temp.path().join("probe")).unwrap();
    let path = probe.path().to_path_buf();
    assert!(path.is_dir());
    assert_eq!(std::fs::read_dir(&path).unwrap().count(), 0);
    assert!(!path.to_string_lossy().starts_with(r"\\?\"));
    let other = probe_dir_in(&temp.path().join("probe")).unwrap();
    assert_ne!(other.path(), path);
    drop(probe);
    assert!(!path.exists());
}

#[test]
fn invalid_program_names_are_never_searched() {
    for name in [
        "",
        ".hidden",
        "../agent",
        "agent --acp",
        "agent;other",
        "a/b",
        "a\\b",
    ] {
        assert_eq!(locate(name), (None, Vec::new()), "{name}");
        assert!(locate_native(name).is_none(), "{name}");
    }
}

// --- Windows package-manager shims -----------------------------------------

/// npm's cmd-shim 9 template, with optional shebang arguments.
fn npm_shim(target: &str, args: &str, variables: &str) -> String {
    format!(
        "@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n{variables}\r\nIF EXIST \"%dp0%\\node.exe\" (\r\n  SET \"_prog=%dp0%\\node.exe\"\r\n) ELSE (\r\n  SET \"_prog=node\"\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & \"%_prog%\" {args} \"%dp0%\\{target}\" %*\r\n"
    )
}

/// The older npm cmd-shim template (npm 6), which pnpm's shim resembles.
fn old_npm_shim(target: &str) -> String {
    format!(
        "@IF EXIST \"%~dp0\\node.exe\" (\r\n  \"%~dp0\\node.exe\"  \"%~dp0\\{target}\" %*\r\n) ELSE (\r\n  @SETLOCAL\r\n  @SET PATHEXT=%PATHEXT:;.JS;=;%\r\n  node  \"%~dp0\\{target}\" %*\r\n)\r\n"
    )
}

fn pnpm_shim(target: &str) -> String {
    format!("@SETLOCAL\r\n{}", old_npm_shim(target))
}

const NPM_CMD: &str = "@ECHO OFF\r\n\r\nSETLOCAL\r\n\r\nSET \"NODE_EXE=%~dp0\\node.exe\"\r\nIF NOT EXIST \"%NODE_EXE%\" (\r\n  SET \"NODE_EXE=node\"\r\n)\r\n\r\nSET \"NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js\"\r\nSET \"NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js\"\r\nFOR /F \"delims=\" %%F IN ('CALL \"%NODE_EXE%\" \"%NPM_PREFIX_JS%\"') DO (\r\n  SET \"NPM_PREFIX_NPM_CLI_JS=%%F\\node_modules\\npm\\bin\\npm-cli.js\"\r\n)\r\nIF EXIST \"%NPM_PREFIX_NPM_CLI_JS%\" (\r\n  SET \"NPM_CLI_JS=%NPM_PREFIX_NPM_CLI_JS%\"\r\n)\r\n\r\n\"%NODE_EXE%\" \"%NPM_CLI_JS%\" %*\r\n";

const PI_LAUNCHER: &str = "@ECHO off\r\nnode \"%~dp0pi-launcher.js\" %*\r\n";

#[test]
fn the_known_shim_templates_parse_to_their_script() {
    let target = r"node_modules\pi-acp\dist\index.js";
    let expected = ParsedShim {
        relative: target.into(),
        node: None,
    };
    assert_eq!(parse_shim(&npm_shim(target, "", "")), Some(expected));
    assert_eq!(
        parse_shim(&old_npm_shim(target)).map(|shim| shim.relative),
        Some(target.into())
    );
    assert_eq!(
        parse_shim(&pnpm_shim(target)).map(|shim| shim.relative),
        Some(target.into())
    );
    assert_eq!(
        parse_shim(&format!("@SETLOCAL\r\n@node  \"%~dp0\\{target}\" %*\r\n"))
            .map(|shim| shim.relative),
        Some(target.into())
    );
    assert_eq!(
        parse_shim(&format!(
            "@SETLOCAL\r\n@\"C:\\Program Files\\nodejs\\node.exe\"  \"%~dp0\\{target}\" %*\r\n"
        )),
        Some(ParsedShim {
            relative: target.into(),
            node: Some(r"C:\Program Files\nodejs\node.exe".into())
        })
    );
    assert_eq!(
        parse_shim(PI_LAUNCHER),
        Some(ParsedShim {
            relative: "pi-launcher.js".into(),
            node: None
        })
    );
}

#[test]
fn shims_with_arguments_settings_or_other_programs_are_not_parsed() {
    let target = r"node_modules\agent\cli.js";
    for text in [
        NPM_CMD.to_string(),
        npm_shim(target, "--experimental-vm-modules", ""),
        npm_shim(target, "", "SET \"NODE_OPTIONS=--inspect\"\r\n"),
        npm_shim(target, "", "").replace("_prog=node\"", "_prog=bun\""),
        npm_shim(target, "", "").replace("\\node.exe\" (", "\\bun.exe\" ("),
        format!("@SETLOCAL\r\n@SET \"PATH=C:\\x:%PATH%\"\r\n{}", old_npm_shim(target)),
        format!(
            "@SETLOCAL\r\n@IF NOT DEFINED NODE_PATH (\r\n  @SET \"NODE_PATH=C:\\x\"\r\n) ELSE (\r\n  @SET \"NODE_PATH=C:\\x;%NODE_PATH%\"\r\n)\r\n{}",
            old_npm_shim(target)
        ),
        "@\"%~dp0\\hermes.exe\" %*\r\n".into(),
        "@python \"%~dp0\\agent.py\" %*\r\n".into(),
        format!("node \"%~dp0\\{target}\" --acp %*\r\n"),
        format!("node \"%~dp0\\{target}\"\r\n"),
        format!("calc.exe & node \"%~dp0\\{target}\" %*\r\n"),
        "node \"%~dp0\\a.js\" %*\r\nnode \"%~dp0\\b.js\" %*\r\n".into(),
        "@ECHO off\r\n".into(),
        String::new(),
    ] {
        assert_eq!(parse_shim(&text), None, "{text}");
    }
}

fn shim_fixture(root: &Path, shim: &str, text: &str) -> PathBuf {
    let path = root.join(shim);
    file(&path, text);
    path
}

#[test]
fn shim_targets_resolve_inside_the_shim_folder_and_pick_node() {
    let temp = tempfile::tempdir().unwrap();
    let prefix = temp.path().join("npm prefix (x86) & more");
    let script = prefix.join("node_modules/pi-acp/dist/index.js");
    file(&script, "console.log(1)");
    let target = r"node_modules\pi-acp\dist\index.js";
    let shim = shim_fixture(&prefix, "pi-acp.cmd", &npm_shim(target, "", ""));
    let resolved = npm_shim_target(&shim).unwrap();
    assert_eq!(
        resolved.script,
        prefix
            .join("node_modules")
            .join("pi-acp")
            .join("dist")
            .join("index.js")
    );
    assert_eq!(resolved.node, None);
    file(&prefix.join("node.exe"), "node");
    assert_eq!(
        npm_shim_target(&shim).unwrap().node,
        Some(prefix.join("node.exe"))
    );

    let pnpm = temp.path().join("pnpm");
    file(&pnpm.join("global/5/node_modules/pi/cli.mjs"), "");
    // Joined part by part: a `/` inside one part stays a `/` on Windows, and
    // a shim names Node.js with backslashes.
    let named = temp.path().join("runtime").join("node.exe");
    file(&named, "node");
    let text = format!(
        "@SETLOCAL\r\n@\"{}\"  \"%~dp0\\global\\5\\node_modules\\pi\\cli.mjs\" %*\r\n",
        named.to_string_lossy()
    );
    if windows_drive_absolute(&named.to_string_lossy()) {
        let resolved = npm_shim_target(&shim_fixture(&pnpm, "pi.cmd", &text)).unwrap();
        assert_eq!(resolved.node, Some(named.clone()));
    }
    let resolved = npm_shim_target(&shim_fixture(
        &pnpm,
        "pi.cmd",
        &pnpm_shim(r"global\5\node_modules\pi\cli.mjs"),
    ))
    .unwrap();
    assert!(resolved.script.ends_with("cli.mjs"));

    let pi = temp.path().join(".pi/agent/bin");
    file(&pi.join("pi-launcher.js"), "");
    let resolved = npm_shim_target(&shim_fixture(&pi, "pi.cmd", PI_LAUNCHER)).unwrap();
    assert_eq!(resolved.script, pi.join("pi-launcher.js"));
}

#[test]
fn shim_targets_that_escape_or_are_not_scripts_are_refused() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("prefix");
    file(&root.join("node.exe"), "node");
    file(&root.join("node_modules/agent/cli.py"), "");
    file(&temp.path().join("outside.js"), "");
    file(&root.join("node_modules/agent/cli.js"), "");
    for target in [
        r"..\outside.js",
        r"node_modules\..\..\outside.js",
        "node.exe",
        r"node_modules\agent\cli.py",
        r"node_modules\agent\missing.js",
        r"C:\outside.js",
        r"\outside.js",
        r"node_modules\agent",
    ] {
        let shim = shim_fixture(&root, "agent.cmd", &npm_shim(target, "", ""));
        assert_eq!(npm_shim_target(&shim), None, "{target}");
    }
    let yarn = temp.path().join("Yarn/bin");
    file(
        &temp.path().join("Yarn/Data/global/node_modules/pi/cli.js"),
        "",
    );
    let shim = shim_fixture(
        &yarn,
        "pi.cmd",
        &old_npm_shim(r"..\Data\global\node_modules\pi\cli.js"),
    );
    assert_eq!(npm_shim_target(&shim), None);
    let npm = shim_fixture(&root, "npm.cmd", NPM_CMD);
    assert_eq!(npm_shim_target(&npm), None);
    let big = shim_fixture(&root, "big.cmd", &"x".repeat(SHIM_LIMIT as usize + 1));
    assert_eq!(npm_shim_target(&big), None);
    assert_eq!(npm_shim_target(&root.join("missing.cmd")), None);
}

#[cfg(unix)]
#[test]
fn shim_targets_behind_symlinks_must_stay_inside_the_shim_folder() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("prefix");
    file(&temp.path().join("outside/cli.js"), "");
    std::fs::create_dir_all(root.join("node_modules")).unwrap();
    std::os::unix::fs::symlink(temp.path().join("outside"), root.join("node_modules/agent"))
        .unwrap();
    let shim = shim_fixture(
        &root,
        "agent.cmd",
        &npm_shim(r"node_modules\agent\cli.js", "", ""),
    );
    assert_eq!(npm_shim_target(&shim), None);
}

#[test]
fn cmd_launches_refuse_network_folders_and_long_paths() {
    let temp = tempfile::tempdir().unwrap();
    assert!(script_launch_check(&temp.path().join("pi.cmd"), temp.path()).is_ok());
    let long = temp.path().join("x".repeat(270)).join("pi.cmd");
    let error = script_launch_check(&long, temp.path()).unwrap_err();
    assert!(error.contains("too long"), "{error}");
    let percent = temp.path().join("100%").join("pi.cmd");
    let error = script_launch_check(&percent, temp.path()).unwrap_err();
    assert!(error.contains("contains %"), "{error}");
    #[cfg(windows)]
    {
        let error = script_launch_check(
            &temp.path().join("pi.cmd"),
            Path::new(r"\\server\share\thesis"),
        )
        .unwrap_err();
        assert!(error.contains("network folder"), "{error}");
        assert!(network_folder(Path::new(r"\\?\UNC\server\share\thesis")));
        assert!(!network_folder(Path::new(r"\\?\C:\thesis")));
    }
    #[cfg(not(windows))]
    assert!(!network_folder(Path::new("//server/share")));
}

// --- Windows-only process behaviour (runs on the Windows CI job) ------------

#[cfg(windows)]
mod windows_processes {
    use super::*;
    use std::process::Command;

    fn node() -> Option<PathBuf> {
        locate_native("node").map(|located| located.path)
    }

    fn python() -> PathBuf {
        crate::acp::tests::fixture_python()
    }

    /// Node.js 22.20+ crashes with `EISDIR: lstat 'C:'` when its main script
    /// is a `\\?\` path; the plain path must start.
    #[test]
    fn node_starts_a_script_from_a_canonicalized_fixture_through_its_plain_path() {
        let Some(node) = node() else {
            eprintln!("Node.js is not installed; skipping");
            return;
        };
        let temp = tempfile::tempdir().unwrap();
        let script = temp.path().join("agent script.js");
        std::fs::write(
            &script,
            "process.stdout.write('started ' + process.argv[2])",
        )
        .unwrap();
        let canonical = script.canonicalize().unwrap();
        assert!(canonical.to_string_lossy().starts_with(r"\\?\"));
        let output = Command::new(child_path(&node))
            .arg(child_path(&canonical))
            .arg("ok")
            .current_dir(child_path(&temp.path().canonicalize().unwrap()))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&output.stdout), "started ok");
    }

    /// cmd.exe scripts in awkward folders receive their arguments literally.
    #[test]
    fn cmd_scripts_in_awkward_folders_receive_arguments_literally() {
        let python = python();
        let temp = tempfile::tempdir().unwrap();
        let printer = temp.path().join("print_args.py");
        std::fs::write(
            &printer,
            "import json, sys\nsys.stdout.write(json.dumps(sys.argv[1:]))\n",
        )
        .unwrap();
        let arguments = [
            "%PATH%",
            "quote\"inside",
            "a & b",
            "caret^",
            "two words",
            "100%",
        ];
        for folder in [
            "with space",
            "Program Files (x86)",
            "a & b",
            "caret^",
            "résumé ünï",
        ] {
            let dir = temp.path().join(folder);
            std::fs::create_dir_all(&dir).unwrap();
            let script = dir.join("agent.cmd");
            std::fs::write(
                &script,
                format!(
                    "@ECHO off\r\n\"{}\" \"{}\" %*\r\n",
                    python.display(),
                    printer.display()
                ),
            )
            .unwrap();
            let located = inspect(&script).unwrap();
            assert_eq!(located.kind, ProgramKind::Script);
            let probe = probe_dir_in(&temp.path().join("probe")).unwrap();
            script_launch_check(&located.path, probe.path()).unwrap();
            let output = Command::new(&located.path)
                .args(arguments)
                .current_dir(probe.path())
                .envs(child_env(&[], &[]))
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{folder}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            let received: Vec<String> =
                serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
                    panic!("{folder}: {}", String::from_utf8_lossy(&output.stdout))
                });
            assert_eq!(received, arguments, "{folder}");
        }
    }

    /// A `node.cmd` planted in the working folder (a downloaded project, or
    /// the folder Oleafly was started from) never runs when a shim calls a
    /// bare `node`.
    #[test]
    fn a_planted_node_in_the_working_folder_never_runs() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        std::fs::create_dir_all(&project).unwrap();
        let marker = temp.path().join("planted-ran.txt");
        std::fs::write(
            project.join("node.cmd"),
            format!("@echo planted> \"{}\"\r\n", marker.display()),
        )
        .unwrap();
        std::fs::write(
            project.join("node.bat"),
            format!("@echo planted> \"{}\"\r\n", marker.display()),
        )
        .unwrap();
        let tools = temp.path().join("tools");
        std::fs::create_dir_all(&tools).unwrap();
        let launcher = tools.join("pi.cmd");
        std::fs::write(&launcher, PI_LAUNCHER).unwrap();
        std::fs::write(tools.join("pi-launcher.js"), "").unwrap();
        let _ = Command::new(&launcher)
            .arg("--version")
            .current_dir(&project)
            .envs(child_env(&[], &[]))
            .output()
            .unwrap();
        assert!(!marker.exists(), "the planted node ran");
    }

    fn process_alive(pid: u32) -> bool {
        use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
        use windows_sys::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        // SAFETY: plain Win32 calls on a handle this function owns.
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return false;
            }
            let mut code = 0u32;
            let ok = GetExitCodeProcess(handle, &mut code);
            CloseHandle(handle);
            ok != 0 && code == STILL_ACTIVE as u32
        }
    }

    /// Dropping the containment guard ends a `.cmd → python → sleeper` tree.
    #[tokio::test]
    async fn containment_ends_a_script_launched_grandchild() {
        let python = python();
        let temp = tempfile::tempdir().unwrap();
        let pid_file = temp.path().join("sleeper.pid");
        let sleeper = temp.path().join("sleeper.py");
        std::fs::write(
            &sleeper,
            format!(
                "import os, subprocess, sys, time\nchild = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'])\nopen(r'{}', 'w').write(str(child.pid))\ntime.sleep(120)\n",
                pid_file.display()
            ),
        )
        .unwrap();
        let script = temp.path().join("agent.cmd");
        std::fs::write(
            &script,
            format!("@\"{}\" \"{}\" %*\r\n", python.display(), sleeper.display()),
        )
        .unwrap();
        let mut command = tokio::process::Command::new(&script);
        command
            .current_dir(temp.path())
            .envs(child_env(&[], &[]))
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        crate::proc::isolate_process_tree(&mut command);
        let mut child = command.spawn().unwrap();
        let guard = crate::proc::contain_process_tree(child.id().unwrap()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        let pid = loop {
            if let Some(pid) = std::fs::read_to_string(&pid_file)
                .ok()
                .and_then(|text| text.trim().parse::<u32>().ok())
            {
                break pid;
            }
            assert!(Instant::now() < deadline, "the sleeper never started");
            tokio::time::sleep(Duration::from_millis(100)).await;
        };
        assert!(process_alive(pid));
        drop(guard);
        let _ = child.kill().await;
        let deadline = Instant::now() + Duration::from_secs(10);
        while process_alive(pid) {
            assert!(
                Instant::now() < deadline,
                "the grandchild outlived its tree"
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    #[test]
    fn the_registry_environment_is_readable() {
        let blocks = super::super::windows::read_environment();
        assert!(blocks
            .machine
            .iter()
            .any(|(name, _)| name.eq_ignore_ascii_case("Path")));
        assert!(search_dirs()
            .iter()
            .all(|dir| !dir.to_string_lossy().starts_with(r"\\?\")));
    }
}
