use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use portable_pty::CommandBuilder;

use super::shell::ShellSpec;

const OUTSIDE_PROJECT: &str = "That folder is not in this project.";
const MAX_LAUNCH_ENV: usize = 32;
const MAX_LAUNCH_ENV_VALUE: usize = 8 * 1024;
const MAX_LAUNCH_ENV_NAME: usize = 128;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct CliEnv {
    pub dir: Option<PathBuf>,
    pub exe: Option<PathBuf>,
}

impl CliEnv {
    pub(crate) fn current() -> Self {
        Self::from_program(crate::acp::cli_program())
    }

    pub(crate) fn from_program(program: Option<PathBuf>) -> Self {
        let Some(program) = program else {
            return Self::default();
        };
        let program = crate::program_locator::child_path(&program);
        let dir = program
            .parent()
            .filter(|dir| !dir.as_os_str().is_empty())
            .map(Path::to_path_buf);
        Self {
            dir,
            exe: Some(program),
        }
    }
}

pub(crate) fn prepend_path(current: Option<&OsStr>, dir: &Path) -> OsString {
    let mut entries = vec![dir.to_path_buf()];
    if let Some(current) = current {
        entries.extend(
            std::env::split_paths(current)
                .filter(|entry| !entry.as_os_str().is_empty() && entry.as_path() != dir),
        );
    }
    std::env::join_paths(&entries)
        .unwrap_or_else(|_| current.map(OsStr::to_os_string).unwrap_or_default())
}

/// Variables a launch may set: plain names, never PATH (any case on
/// Windows, where names are case-insensitive), no NUL, at most 32 of them
/// and 8 KiB each.
pub(crate) fn validate_launch_env(
    env: &BTreeMap<String, String>,
    windows: bool,
) -> Result<Vec<(String, String)>, String> {
    if env.len() > MAX_LAUNCH_ENV {
        return Err(format!(
            "A terminal launch can set at most {MAX_LAUNCH_ENV} variables."
        ));
    }
    env.iter()
        .map(|(name, value)| {
            let path = if windows {
                name.eq_ignore_ascii_case("PATH")
            } else {
                name == "PATH"
            };
            if !valid_env_name(name) || path {
                return Err(format!("A terminal launch can't set {name:?}."));
            }
            if value.contains('\0') || value.len() > MAX_LAUNCH_ENV_VALUE {
                return Err(format!("The value of {name} is not allowed."));
            }
            Ok((name.clone(), value.clone()))
        })
        .collect()
}

/// What a session opened to run a launch command (an installer, a sign-in)
/// adds on Windows: cmd.exe then never runs a program of that name from the
/// project folder in place of the one on PATH (a `powershell.exe` in a
/// downloaded project, say). Applied after the launch's own variables.
pub(crate) fn launch_command_env(launch: bool, windows: bool) -> Option<(String, String)> {
    (launch && windows).then(|| ("NoDefaultCurrentDirectoryInExePath".into(), "1".into()))
}

fn valid_env_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    name.len() <= MAX_LAUNCH_ENV_NAME
        && (first.is_ascii_alphabetic() || first == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub(crate) fn terminal_cwd(root: &Path, rel: Option<&str>) -> Result<PathBuf, String> {
    let rel = rel.map(str::trim).unwrap_or_default();
    if rel.is_empty() || rel == "." {
        return Ok(crate::program_locator::child_path(root));
    }
    let path =
        crate::sandbox::resolve_within(root, rel).map_err(|_| OUTSIDE_PROJECT.to_string())?;
    if !path.is_dir() {
        return Err(OUTSIDE_PROJECT.to_string());
    }
    Ok(crate::program_locator::child_path(&path))
}

pub(crate) fn apply_session_env(
    cmd: &mut CommandBuilder,
    spec: &ShellSpec,
    cli: &CliEnv,
    extra: &[(String, String)],
) {
    cmd.env("PATH", session_search_path(cli.dir.as_deref()));
    if let Some(exe) = &cli.exe {
        cmd.env("OLEAFLY_CLI", exe);
    }
    #[cfg(target_os = "linux")]
    for edit in appimage_env_edits(&|name| std::env::var_os(name)) {
        match edit {
            EnvEdit::Remove(name) => cmd.env_remove(name),
            EnvEdit::Set(name, value) => cmd.env(name, value),
        }
    }
    for (name, value) in &spec.env {
        cmd.env(name, value);
    }
    for (name, value) in extra {
        cmd.env(name, value);
    }
}

fn session_search_path(cli_dir: Option<&Path>) -> OsString {
    let prepend: Vec<PathBuf> = cli_dir.map(Path::to_path_buf).into_iter().collect();
    let path = crate::program_locator::child_search_path(&prepend, &[]);
    #[cfg(target_os = "linux")]
    if let Some(appdir) = std::env::var_os("APPDIR")
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute())
    {
        let kept: Vec<PathBuf> = std::env::split_paths(&path)
            .filter(|entry| !entry.starts_with(&appdir))
            .collect();
        if let Ok(joined) = std::env::join_paths(kept) {
            return joined;
        }
    }
    path
}

#[cfg(unix)]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum EnvEdit {
    Remove(String),
    Set(String, OsString),
}

/// Variables the AppImage runtime sets for Oleafly itself.
#[cfg(unix)]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const APPIMAGE_MARKERS: &[&str] = &["APPDIR", "APPIMAGE", "ARGV0", "OWD"];

#[cfg(unix)]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const APPIMAGE_HOOK_VARIABLES: &[&str] = &[
    "GTK_DATA_PREFIX",
    "GTK_EXE_PREFIX",
    "GTK_PATH",
    "GTK_IM_MODULE_FILE",
    "GDK_PIXBUF_MODULE_FILE",
    "GDK_PIXBUF_MODULEDIR",
    "GIO_MODULE_DIR",
    "GIO_EXTRA_MODULES",
    "GSETTINGS_SCHEMA_DIR",
    "GST_PLUGIN_SCANNER",
    "PYTHONHOME",
];

#[cfg(unix)]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const APPIMAGE_PATH_LISTS: &[&str] = &[
    "LD_LIBRARY_PATH",
    "XDG_DATA_DIRS",
    "PYTHONPATH",
    "PERLLIB",
    "QT_PLUGIN_PATH",
    "GST_PLUGIN_PATH",
    "GST_PLUGIN_SYSTEM_PATH",
    "GST_PLUGIN_SYSTEM_PATH_1_0",
];

#[cfg(unix)]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn appimage_env_edits(lookup: &dyn Fn(&str) -> Option<OsString>) -> Vec<EnvEdit> {
    let Some(appdir) = lookup("APPDIR")
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute())
    else {
        return Vec::new();
    };
    let mut edits: Vec<EnvEdit> = APPIMAGE_MARKERS
        .iter()
        .map(|name| EnvEdit::Remove((*name).to_string()))
        .collect();
    for name in APPIMAGE_HOOK_VARIABLES {
        if lookup(name).is_some_and(|value| Path::new(&value).starts_with(&appdir)) {
            edits.push(EnvEdit::Remove((*name).to_string()));
        }
    }
    for name in APPIMAGE_PATH_LISTS {
        let Some(value) = lookup(name) else {
            continue;
        };
        let entries: Vec<PathBuf> = std::env::split_paths(&value).collect();
        let kept: Vec<&PathBuf> = entries
            .iter()
            .filter(|entry| !entry.as_os_str().is_empty() && !entry.starts_with(&appdir))
            .collect();
        if kept.len() == entries.len() {
            continue;
        }
        match std::env::join_paths(kept) {
            Ok(joined) if !joined.is_empty() => {
                edits.push(EnvEdit::Set((*name).to_string(), joined));
            }
            _ => edits.push(EnvEdit::Remove((*name).to_string())),
        }
    }
    edits
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::shell::{ShellId, ShellKind};

    fn spec(env: &[(&str, &str)]) -> ShellSpec {
        ShellSpec {
            id: ShellId::Auto,
            program: "/bin/sh".into(),
            args: Vec::new(),
            kind: ShellKind::Posix,
            name: "sh".into(),
            env: env
                .iter()
                .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
                .collect(),
        }
    }

    fn env_of(cmd: &CommandBuilder, name: &str) -> Option<String> {
        cmd.get_env(name)
            .map(|value| value.to_string_lossy().into_owned())
    }

    #[cfg(unix)]
    #[test]
    fn appimage_scrub_removes_bundle_variables_and_appdir_entries() {
        let vars: BTreeMap<&str, &str> = [
            ("APPDIR", "/tmp/.mount_Oleafly"),
            ("APPIMAGE", "/home/u/Oleafly.AppImage"),
            ("ARGV0", "x"),
            ("OWD", "/home/u"),
            ("GTK_PATH", "/tmp/.mount_Oleafly/usr/lib/gtk-3.0"),
            ("GIO_MODULE_DIR", "/tmp/.mount_Oleafly/usr/lib/gio/modules"),
            ("GSETTINGS_SCHEMA_DIR", "/usr/share/glib-2.0/schemas"),
            (
                "LD_LIBRARY_PATH",
                "/tmp/.mount_Oleafly/usr/lib:/opt/cuda/lib64",
            ),
            ("XDG_DATA_DIRS", "/tmp/.mount_Oleafly/usr/share:/usr/share"),
            ("PYTHONPATH", "/tmp/.mount_Oleafly/usr/lib/python3"),
        ]
        .into_iter()
        .collect();
        let edits = appimage_env_edits(&|name| vars.get(name).map(OsString::from));
        for removed in [
            "APPDIR",
            "APPIMAGE",
            "ARGV0",
            "OWD",
            "GTK_PATH",
            "GIO_MODULE_DIR",
        ] {
            assert!(
                edits.contains(&EnvEdit::Remove(removed.into())),
                "{removed} stays: {edits:?}"
            );
        }
        assert!(edits.contains(&EnvEdit::Set(
            "LD_LIBRARY_PATH".into(),
            "/opt/cuda/lib64".into()
        )));
        assert!(edits.contains(&EnvEdit::Set("XDG_DATA_DIRS".into(), "/usr/share".into())));
        assert!(edits.contains(&EnvEdit::Remove("PYTHONPATH".into())));
        assert!(!edits
            .iter()
            .any(|edit| matches!(edit, EnvEdit::Remove(name) if name == "GSETTINGS_SCHEMA_DIR")));
    }

    #[cfg(unix)]
    #[test]
    fn appimage_scrub_is_a_no_op_outside_an_appimage() {
        let lookup = |name: &str| (name == "LD_LIBRARY_PATH").then(|| OsString::from("/opt/lib"));
        assert!(appimage_env_edits(&lookup).is_empty());
        let relative = |name: &str| (name == "APPDIR").then(|| OsString::from("squashfs-root"));
        assert!(appimage_env_edits(&relative).is_empty());
    }

    #[test]
    fn launch_sessions_on_windows_never_run_programs_from_the_project_folder() {
        assert_eq!(
            launch_command_env(true, true),
            Some(("NoDefaultCurrentDirectoryInExePath".into(), "1".into()))
        );
        assert_eq!(launch_command_env(false, true), None);
        assert_eq!(launch_command_env(true, false), None);
    }

    #[test]
    fn launch_env_rejects_path_and_malformed_keys() {
        let one = |name: &str, value: &str| BTreeMap::from([(name.to_string(), value.to_string())]);
        assert!(validate_launch_env(&one("PATH", "/x"), false).is_err());
        assert!(validate_launch_env(&one("Path", r"C:\x"), true).is_err());
        assert!(validate_launch_env(&one("path", r"C:\x"), true).is_err());
        assert!(validate_launch_env(&one("Path", "/x"), false).is_ok());
        for bad in ["A=B", "9X", "", "A-B", "ÄB"] {
            assert!(
                validate_launch_env(&one(bad, "x"), false).is_err(),
                "{bad:?}"
            );
        }
        assert!(validate_launch_env(&one(&"A".repeat(129), "x"), false).is_err());
        assert!(validate_launch_env(&one("A", "x\0y"), false).is_err());
        assert!(validate_launch_env(&one("A", &"x".repeat(8 * 1024 + 1)), false).is_err());
        let many: BTreeMap<String, String> = (0..33)
            .map(|index| (format!("V{index}"), "x".to_string()))
            .collect();
        assert!(validate_launch_env(&many, false).is_err());
        assert_eq!(
            validate_launch_env(&one("CLAUDE_CONFIG_DIR", r"C:\Users\me\.claude"), true),
            Ok(vec![(
                "CLAUDE_CONFIG_DIR".to_string(),
                r"C:\Users\me\.claude".to_string()
            )])
        );
    }

    #[test]
    fn terminal_cwd_stays_inside_the_project() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path();
        std::fs::create_dir_all(root.join("chapters/intro")).unwrap();
        std::fs::write(root.join("main.tex"), "x").unwrap();
        let plain_root = crate::program_locator::child_path(root);
        for start in [None, Some(""), Some("."), Some("  ")] {
            assert_eq!(terminal_cwd(root, start).unwrap(), plain_root, "{start:?}");
        }
        assert_eq!(
            terminal_cwd(root, Some("chapters/intro")).unwrap(),
            crate::program_locator::child_path(&root.join("chapters/intro"))
        );
        for outside in [
            "../x",
            "/etc",
            r"chapters\intro",
            r"C:\x",
            "missing",
            "main.tex",
        ] {
            assert_eq!(
                terminal_cwd(root, Some(outside)),
                Err("That folder is not in this project.".to_string()),
                "{outside}"
            );
        }
        #[cfg(windows)]
        assert!(!terminal_cwd(root, Some("chapters"))
            .unwrap()
            .to_string_lossy()
            .starts_with(r"\\?\"));
    }

    #[cfg(unix)]
    #[test]
    fn terminal_cwd_refuses_a_symlink_out_of_the_project() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("elsewhere")).unwrap();
        assert!(terminal_cwd(root.path(), Some("elsewhere")).is_err());
    }

    #[test]
    fn cli_env_comes_from_the_cli_program() {
        assert_eq!(CliEnv::from_program(None), CliEnv::default());
        let dir = std::env::temp_dir().join("Oleafly Tools");
        let program = dir.join(if cfg!(windows) {
            "oleafly.exe"
        } else {
            "oleafly"
        });
        let cli = CliEnv::from_program(Some(program.clone()));
        assert_eq!(cli.dir.as_deref(), Some(dir.as_path()));
        assert_eq!(cli.exe.as_deref(), Some(program.as_path()));
    }

    #[test]
    fn prepend_path_puts_the_cli_folder_first() {
        let dir = Path::new("/opt/My Tools/oleafly");
        let current = std::env::join_paths(["/usr/bin", "/bin"]).unwrap();
        let joined = prepend_path(Some(&current), dir);
        let entries: Vec<PathBuf> = std::env::split_paths(&joined).collect();
        assert_eq!(
            entries,
            [
                dir.to_path_buf(),
                PathBuf::from("/usr/bin"),
                PathBuf::from("/bin")
            ]
        );
        let again = prepend_path(Some(&joined), dir);
        assert_eq!(std::env::split_paths(&again).count(), 3);
        let alone: Vec<PathBuf> = std::env::split_paths(&prepend_path(None, dir)).collect();
        assert_eq!(alone, [dir.to_path_buf()]);
    }

    #[test]
    fn session_env_puts_the_cli_first_and_the_launch_variables_last() {
        let tools = tempfile::tempdir().unwrap();
        let exe = tools.path().join("oleafly");
        let cli = CliEnv {
            dir: Some(tools.path().to_path_buf()),
            exe: Some(exe.clone()),
        };
        let mut cmd = CommandBuilder::new("sh");
        let extra = vec![
            ("CHERE_INVOKING".to_string(), "0".to_string()),
            ("CLAUDE_CONFIG_DIR".to_string(), "/cfg".to_string()),
        ];
        apply_session_env(&mut cmd, &spec(&[("CHERE_INVOKING", "1")]), &cli, &extra);
        let path = cmd.get_env("PATH").expect("a search path");
        assert_eq!(
            std::env::split_paths(path).next().as_deref(),
            Some(tools.path())
        );
        assert_eq!(
            env_of(&cmd, "OLEAFLY_CLI"),
            Some(exe.to_string_lossy().into_owned())
        );
        assert_eq!(env_of(&cmd, "CHERE_INVOKING").as_deref(), Some("0"));
        assert_eq!(env_of(&cmd, "CLAUDE_CONFIG_DIR").as_deref(), Some("/cfg"));
    }

    #[test]
    fn session_env_without_a_cli_leaves_oleafly_cli_alone() {
        let mut cmd = CommandBuilder::new("sh");
        cmd.env_remove("OLEAFLY_CLI");
        apply_session_env(&mut cmd, &spec(&[]), &CliEnv::default(), &[]);
        assert!(cmd.get_env("PATH").is_some_and(|path| !path.is_empty()));
        assert_eq!(env_of(&cmd, "OLEAFLY_CLI"), None);
    }
}
