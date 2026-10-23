//! Which shell a terminal starts. Windows offers PowerShell 7, Windows
//! PowerShell, Command Prompt, Git Bash, WSL and a custom program; macOS and
//! Linux start the login shell or a custom program. Path handling for Windows
//! is plain string work, so every case is tested on every host.

use crate::app_error::AppError;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ShellId {
    #[default]
    Auto,
    Pwsh,
    Powershell,
    Cmd,
    GitBash,
    Wsl,
    Custom,
}

/// How a shell quotes the commands Oleafly types into it.
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ShellKind {
    Posix,
    Fish,
    Powershell,
    Cmd,
}

/// The shell setting as the frontend sends it.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellChoice {
    #[serde(default)]
    pub id: ShellId,
    #[serde(default)]
    pub path: Option<String>,
}

/// A resolved shell: what to start and how.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ShellSpec {
    pub id: ShellId,
    pub program: String,
    pub args: Vec<String>,
    pub kind: ShellKind,
    pub name: String,
    pub env: Vec<(String, String)>,
}

/// One entry of the shell picker in Settings.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellOption {
    pub id: ShellId,
    /// What `auto` starts on this computer; the id itself otherwise.
    pub resolved: ShellId,
    pub name: Option<String>,
    pub path: Option<String>,
    pub available: bool,
}

/// What shell resolution needs from the system, so tests can describe a
/// Windows computer on any host.
pub(crate) trait ShellProbe {
    fn is_file(&self, path: &str) -> bool;
    fn locate(&self, name: &str) -> Option<String>;
    fn var(&self, name: &str) -> Option<String>;
    fn wsl_has_distro(&self) -> bool;
    fn login_shell(&self) -> String;
}

/// The real computer.
pub(crate) struct SystemProbe;

impl ShellProbe for SystemProbe {
    fn is_file(&self, path: &str) -> bool {
        Path::new(path).is_file()
    }

    fn locate(&self, name: &str) -> Option<String> {
        crate::program_locator::locate_native(name)
            .map(|located| located.path.display().to_string())
    }

    fn var(&self, name: &str) -> Option<String> {
        std::env::var(name).ok().filter(|value| !value.is_empty())
    }

    #[cfg(windows)]
    fn wsl_has_distro(&self) -> bool {
        windows_registry::CURRENT_USER
            .open(r"Software\Microsoft\Windows\CurrentVersion\Lxss")
            .and_then(|key| key.keys().map(|mut keys| keys.next().is_some()))
            .unwrap_or(false)
    }

    #[cfg(not(windows))]
    fn wsl_has_distro(&self) -> bool {
        false
    }

    #[cfg(unix)]
    fn login_shell(&self) -> String {
        crate::program_locator::user_shell().display().to_string()
    }

    #[cfg(not(unix))]
    fn login_shell(&self) -> String {
        String::new()
    }
}

// Start failures are app errors, so the terminal can show them in the user's
// language; the English texts are `errors.terminal.*` in the errors catalog.
const NO_PWSH: &str = "terminal.pwsh_missing";
const NO_GIT_BASH: &str = "terminal.git_bash_missing";
const NO_WSL: &str = "terminal.wsl_missing";
const NO_WSL_DISTRO: &str = "terminal.wsl_no_distro";
const NO_CUSTOM_PATH: &str = "terminal.shell_path_empty";
const NO_CUSTOM_PROGRAM: &str = "terminal.shell_path_missing";

/// Shells that take `-l` to run as a login shell on macOS and Linux, so they
/// read the profile that sets up PATH. On Windows the same names mark MSYS2
/// and Cygwin shells, which get `CHERE_INVOKING` instead.
const LOGIN_SHELLS: &[&str] = &["bash", "zsh", "sh", "dash", "ksh", "mksh", "fish"];

/// Variables WSL forwards to Linux on top of the user's own `WSLENV`.
const WSL_FORWARDED: &[&str] = &["COLORTERM", "TERM_PROGRAM", "TERM_PROGRAM_VERSION"];

pub(crate) fn resolve_shell(
    choice: &ShellChoice,
    windows: bool,
    probe: &dyn ShellProbe,
) -> Result<ShellSpec, AppError> {
    if !windows {
        // A shell picked on Windows (synced settings) means nothing here.
        return match choice.id {
            ShellId::Custom => custom_shell(choice.path.as_deref(), false, probe),
            _ => Ok(login_shell_spec(probe)),
        };
    }
    match choice.id {
        ShellId::Auto => Ok(auto_windows_shell(probe)),
        ShellId::Pwsh => pwsh_path(probe)
            .map(|program| powershell_spec(ShellId::Pwsh, program))
            .ok_or_else(|| AppError::new(NO_PWSH)),
        ShellId::Powershell => Ok(powershell_spec(
            ShellId::Powershell,
            windows_powershell_path(probe),
        )),
        ShellId::Cmd => Ok(cmd_spec(probe)),
        ShellId::GitBash => git_bash_path(probe)
            .map(git_bash_spec)
            .ok_or_else(|| AppError::new(NO_GIT_BASH)),
        ShellId::Wsl => wsl_spec(probe),
        ShellId::Custom => custom_shell(choice.path.as_deref(), true, probe),
    }
}

/// Every shell the picker can offer on this platform, with what is
/// installed marked available.
pub(crate) fn shell_options(windows: bool, probe: &dyn ShellProbe) -> Vec<ShellOption> {
    if !windows {
        let login = probe.login_shell();
        return vec![
            ShellOption {
                id: ShellId::Auto,
                resolved: ShellId::Auto,
                name: (!login.is_empty()).then(|| program_name(&login)),
                path: (!login.is_empty()).then_some(login),
                available: true,
            },
            custom_option(),
        ];
    }
    let pwsh = pwsh_path(probe);
    let windows_powershell = windows_powershell_path(probe);
    let auto = auto_windows_shell(probe);
    let git_bash = git_bash_path(probe);
    let wsl = wsl_path(probe);
    let wsl_ready = wsl.is_some() && probe.wsl_has_distro();
    vec![
        ShellOption {
            id: ShellId::Auto,
            resolved: auto.id,
            name: Some(auto.name),
            path: Some(auto.program),
            available: true,
        },
        ShellOption {
            id: ShellId::Pwsh,
            resolved: ShellId::Pwsh,
            name: pwsh.as_deref().map(program_name),
            available: pwsh.is_some(),
            path: pwsh,
        },
        ShellOption {
            id: ShellId::Powershell,
            resolved: ShellId::Powershell,
            name: Some(program_name(&windows_powershell)),
            path: Some(windows_powershell),
            available: true,
        },
        ShellOption {
            id: ShellId::Cmd,
            resolved: ShellId::Cmd,
            name: Some("cmd".to_string()),
            path: Some(cmd_path(probe)),
            available: true,
        },
        ShellOption {
            id: ShellId::GitBash,
            resolved: ShellId::GitBash,
            name: git_bash.as_ref().map(|_| "bash".to_string()),
            available: git_bash.is_some(),
            path: git_bash,
        },
        ShellOption {
            id: ShellId::Wsl,
            resolved: ShellId::Wsl,
            name: wsl.as_ref().map(|_| "wsl".to_string()),
            path: wsl,
            available: wsl_ready,
        },
        custom_option(),
    ]
}

fn custom_option() -> ShellOption {
    ShellOption {
        id: ShellId::Custom,
        resolved: ShellId::Custom,
        name: None,
        path: None,
        available: true,
    }
}

/// How a shell quotes, from its program name (Windows or Unix path).
pub(crate) fn shell_kind_for(program: &str) -> ShellKind {
    match program_name(program).to_ascii_lowercase().as_str() {
        "cmd" => ShellKind::Cmd,
        "pwsh" | "pwsh-preview" | "powershell" => ShellKind::Powershell,
        "fish" => ShellKind::Fish,
        _ => ShellKind::Posix,
    }
}

/// `bash.exe` for Git Bash, found from the Git install that `git` runs
/// from, then the usual install folders. Never the WSL launcher in
/// System32, which is also called `bash.exe`.
pub(crate) fn git_bash_path(probe: &dyn ShellProbe) -> Option<String> {
    let system_root = system_root(probe);
    let mut roots = Vec::new();
    if let Some(root) = probe.locate("git").as_deref().and_then(git_root_from_exe) {
        roots.push(root);
    }
    for var in ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(base) = probe.var(var) {
            roots.push(win_join(&base, "Git"));
        }
    }
    if let Some(local) = probe.var("LOCALAPPDATA") {
        roots.push(win_join(&local, r"Programs\Git"));
    }
    if let Some(home) = probe.var("USERPROFILE") {
        roots.push(win_join(&home, r"scoop\apps\git\current"));
    }
    roots
        .into_iter()
        .map(|root| win_join(&root, r"bin\bash.exe"))
        .filter(|candidate| !inside_windows_folder(candidate, &system_root))
        .find(|candidate| probe.is_file(candidate))
}

/// Join a Windows path and a relative part with exactly one backslash.
pub(crate) fn win_join(base: &str, rel: &str) -> String {
    let base = base.trim_end_matches(['\\', '/']);
    let rel = rel.trim_start_matches(['\\', '/']);
    format!("{base}\\{rel}")
}

/// File name without the folder or a `.exe` ending, keeping its case.
pub(crate) fn program_name(program: &str) -> String {
    let file = program.rsplit(['\\', '/']).next().unwrap_or(program);
    let lower = file.to_ascii_lowercase();
    match lower.strip_suffix(".exe") {
        Some(stem) => file[..stem.len()].to_string(),
        None => file.to_string(),
    }
}

fn system_root(probe: &dyn ShellProbe) -> String {
    probe
        .var("SystemRoot")
        .unwrap_or_else(|| r"C:\Windows".to_string())
}

fn inside_windows_folder(path: &str, folder: &str) -> bool {
    let path = path.replace('/', "\\").to_ascii_lowercase();
    let folder = folder
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase();
    path.starts_with(&format!("{folder}\\"))
}

fn git_root_from_exe(git: &str) -> Option<String> {
    let git = git.replace('/', "\\");
    let lower = git.to_ascii_lowercase();
    // The longer ending first: `\mingw64\bin\git.exe` also ends in `\bin\git.exe`.
    [r"\mingw64\bin\git.exe", r"\cmd\git.exe", r"\bin\git.exe"]
        .into_iter()
        .find(|suffix| lower.ends_with(suffix))
        .map(|suffix| git[..git.len() - suffix.len()].to_string())
        .filter(|root| !root.is_empty())
}

fn pwsh_path(probe: &dyn ShellProbe) -> Option<String> {
    probe.locate("pwsh").or_else(|| {
        let program_files = probe
            .var("ProgramFiles")
            .unwrap_or_else(|| r"C:\Program Files".to_string());
        let candidate = win_join(&program_files, r"PowerShell\7\pwsh.exe");
        probe.is_file(&candidate).then_some(candidate)
    })
}

fn windows_powershell_path(probe: &dyn ShellProbe) -> String {
    let candidate = win_join(
        &system_root(probe),
        r"System32\WindowsPowerShell\v1.0\powershell.exe",
    );
    if probe.is_file(&candidate) {
        candidate
    } else {
        "powershell.exe".to_string()
    }
}

fn cmd_path(probe: &dyn ShellProbe) -> String {
    probe
        .var("ComSpec")
        .filter(|comspec| probe.is_file(comspec))
        .unwrap_or_else(|| win_join(&system_root(probe), r"System32\cmd.exe"))
}

fn wsl_path(probe: &dyn ShellProbe) -> Option<String> {
    let candidate = win_join(&system_root(probe), r"System32\wsl.exe");
    probe.is_file(&candidate).then_some(candidate)
}

fn auto_windows_shell(probe: &dyn ShellProbe) -> ShellSpec {
    match pwsh_path(probe) {
        Some(pwsh) => powershell_spec(ShellId::Pwsh, pwsh),
        None => powershell_spec(ShellId::Powershell, windows_powershell_path(probe)),
    }
}

fn powershell_spec(id: ShellId, program: String) -> ShellSpec {
    ShellSpec {
        id,
        name: program_name(&program),
        program,
        args: vec!["-NoLogo".to_string()],
        kind: ShellKind::Powershell,
        env: Vec::new(),
    }
}

fn cmd_spec(probe: &dyn ShellProbe) -> ShellSpec {
    ShellSpec {
        id: ShellId::Cmd,
        program: cmd_path(probe),
        args: Vec::new(),
        kind: ShellKind::Cmd,
        name: "cmd".to_string(),
        env: Vec::new(),
    }
}

fn git_bash_spec(program: String) -> ShellSpec {
    ShellSpec {
        id: ShellId::GitBash,
        program,
        args: vec!["--login".to_string(), "-i".to_string()],
        kind: ShellKind::Posix,
        name: "bash".to_string(),
        // MSYS profiles cd to HOME unless this is set; keep the start folder.
        env: vec![("CHERE_INVOKING".to_string(), "1".to_string())],
    }
}

fn wsl_spec(probe: &dyn ShellProbe) -> Result<ShellSpec, AppError> {
    let program = wsl_path(probe).ok_or_else(|| AppError::new(NO_WSL))?;
    if !probe.wsl_has_distro() {
        return Err(AppError::new(NO_WSL_DISTRO));
    }
    // WSL starts in the working folder of the process, so no --cd.
    Ok(ShellSpec {
        id: ShellId::Wsl,
        program,
        args: Vec::new(),
        kind: ShellKind::Posix,
        name: "wsl".to_string(),
        env: vec![("WSLENV".to_string(), wslenv(probe.var("WSLENV").as_deref()))],
    })
}

/// The user's `WSLENV` plus the terminal identity variables it lacks.
fn wslenv(existing: Option<&str>) -> String {
    let mut entries: Vec<String> = existing
        .unwrap_or_default()
        .split(':')
        .filter(|entry| !entry.is_empty())
        .map(str::to_string)
        .collect();
    for name in WSL_FORWARDED {
        let present = entries
            .iter()
            .any(|entry| entry.split('/').next() == Some(*name));
        if !present {
            entries.push((*name).to_string());
        }
    }
    entries.join(":")
}

fn login_shell_spec(probe: &dyn ShellProbe) -> ShellSpec {
    let program = probe.login_shell();
    let program = if program.is_empty() {
        "/bin/sh".to_string()
    } else {
        program
    };
    ShellSpec {
        id: ShellId::Auto,
        name: program_name(&program),
        kind: shell_kind_for(&program),
        program,
        args: vec!["-l".to_string()],
        env: Vec::new(),
    }
}

fn custom_shell(
    path: Option<&str>,
    windows: bool,
    probe: &dyn ShellProbe,
) -> Result<ShellSpec, AppError> {
    let path = path.map(str::trim).unwrap_or_default();
    if path.is_empty() {
        return Err(AppError::new(NO_CUSTOM_PATH));
    }
    if !probe.is_file(path) {
        return Err(AppError::new(NO_CUSTOM_PROGRAM).param("path", path));
    }
    let name = program_name(path);
    let login = LOGIN_SHELLS.contains(&name.to_ascii_lowercase().as_str());
    let args = if login && !windows {
        vec!["-l".to_string()]
    } else {
        Vec::new()
    };
    // MSYS2 and Cygwin shells on Windows cd to HOME without this.
    let env = if login && windows {
        vec![("CHERE_INVOKING".to_string(), "1".to_string())]
    } else {
        Vec::new()
    };
    Ok(ShellSpec {
        id: ShellId::Custom,
        program: path.to_string(),
        args,
        kind: shell_kind_for(path),
        name,
        env,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    #[derive(Default)]
    struct FakeProbe {
        files: HashSet<String>,
        located: HashMap<String, String>,
        vars: HashMap<String, String>,
        distro: bool,
        login: String,
    }

    impl FakeProbe {
        fn windows() -> Self {
            let mut probe = Self::default();
            probe.vars.insert("SystemRoot".into(), r"C:\Windows".into());
            let powershell = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";
            probe
                .vars
                .insert("ProgramFiles".into(), r"C:\Program Files".into());
            probe.files.insert(powershell.into());
            probe
        }

        fn file(mut self, path: &str) -> Self {
            self.files.insert(path.into());
            self
        }

        fn located(mut self, name: &str, path: &str) -> Self {
            self.located.insert(name.into(), path.into());
            self
        }

        fn var(mut self, name: &str, value: &str) -> Self {
            self.vars.insert(name.into(), value.into());
            self
        }
    }

    impl ShellProbe for FakeProbe {
        fn is_file(&self, path: &str) -> bool {
            self.files.contains(path)
        }
        fn locate(&self, name: &str) -> Option<String> {
            self.located.get(name).cloned()
        }
        fn var(&self, name: &str) -> Option<String> {
            self.vars.get(name).cloned()
        }
        fn wsl_has_distro(&self) -> bool {
            self.distro
        }
        fn login_shell(&self) -> String {
            self.login.clone()
        }
    }

    fn choice(id: ShellId) -> ShellChoice {
        ShellChoice { id, path: None }
    }

    fn custom(path: &str) -> ShellChoice {
        ShellChoice {
            id: ShellId::Custom,
            path: Some(path.into()),
        }
    }

    #[test]
    fn auto_prefers_pwsh_with_nologo_on_windows() {
        let pwsh = r"C:\Program Files\PowerShell\7\pwsh.exe";
        let probe = FakeProbe::windows().located("pwsh", pwsh);
        let spec = resolve_shell(&choice(ShellId::Auto), true, &probe).unwrap();
        assert_eq!(spec.program, pwsh);
        assert_eq!(spec.args, ["-NoLogo"]);
        assert_eq!(spec.kind, ShellKind::Powershell);
        assert_eq!(spec.id, ShellId::Pwsh);
        assert_eq!(spec.name, "pwsh");
    }

    #[test]
    fn auto_finds_pwsh_in_program_files_when_it_is_not_on_path() {
        let pwsh = r"D:\Apps\PowerShell\7\pwsh.exe";
        let probe = FakeProbe::windows()
            .var("ProgramFiles", r"D:\Apps")
            .file(pwsh);
        let spec = resolve_shell(&choice(ShellId::Auto), true, &probe).unwrap();
        assert_eq!(spec.program, pwsh);
        assert_eq!(spec.id, ShellId::Pwsh);
    }

    #[test]
    fn auto_falls_back_to_windows_powershell() {
        let probe = FakeProbe::windows();
        let spec = resolve_shell(&choice(ShellId::Auto), true, &probe).unwrap();
        assert_eq!(
            spec.program,
            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
        );
        assert_eq!(spec.args, ["-NoLogo"]);
        assert_eq!(spec.id, ShellId::Powershell);
        assert_eq!(spec.name, "powershell");
    }

    #[test]
    fn pwsh_is_refused_when_it_is_missing() {
        let error = resolve_shell(&choice(ShellId::Pwsh), true, &FakeProbe::windows()).unwrap_err();
        assert_eq!(error.code, "terminal.pwsh_missing");
        assert_eq!(
            crate::app_error::english_error(&error.to_string()),
            "PowerShell 7 isn't installed."
        );
    }

    #[test]
    fn cmd_uses_comspec() {
        let comspec = r"C:\Windows\system32\cmd.exe";
        let probe = FakeProbe::windows().var("ComSpec", comspec).file(comspec);
        let spec = resolve_shell(&choice(ShellId::Cmd), true, &probe).unwrap();
        assert_eq!(spec.program, comspec);
        assert!(spec.args.is_empty());
        assert_eq!(spec.kind, ShellKind::Cmd);
    }

    #[test]
    fn git_bash_comes_from_the_git_install() {
        let probe = FakeProbe::windows()
            .located("git", r"D:\Tools\Git\cmd\git.exe")
            .file(r"D:\Tools\Git\bin\bash.exe");
        let spec = resolve_shell(&choice(ShellId::GitBash), true, &probe).unwrap();
        assert_eq!(spec.program, r"D:\Tools\Git\bin\bash.exe");
        assert_eq!(spec.args, ["--login", "-i"]);
        assert!(spec
            .env
            .contains(&("CHERE_INVOKING".to_string(), "1".to_string())));
        assert_eq!(spec.kind, ShellKind::Posix);
    }

    #[test]
    fn git_bash_is_found_from_a_mingw_git_and_from_program_files() {
        let mingw = FakeProbe::windows()
            .located("git", r"E:\Git\mingw64\bin\git.exe")
            .file(r"E:\Git\bin\bash.exe");
        assert_eq!(
            git_bash_path(&mingw).as_deref(),
            Some(r"E:\Git\bin\bash.exe")
        );
        let installed = FakeProbe::windows().file(r"C:\Program Files\Git\bin\bash.exe");
        assert_eq!(
            git_bash_path(&installed).as_deref(),
            Some(r"C:\Program Files\Git\bin\bash.exe")
        );
    }

    #[test]
    fn git_bash_never_picks_the_wsl_launcher_in_system32() {
        let probe = FakeProbe::windows()
            .file(r"C:\Windows\System32\bash.exe")
            .located("git", r"C:\Windows\System32\git.exe");
        assert_eq!(git_bash_path(&probe), None);
        let error = resolve_shell(&choice(ShellId::GitBash), true, &probe).unwrap_err();
        assert_eq!(error.code, "terminal.git_bash_missing");
    }

    #[test]
    fn wsl_needs_a_distribution() {
        let wsl = r"C:\Windows\System32\wsl.exe";
        let mut probe = FakeProbe::windows().file(wsl);
        let error = resolve_shell(&choice(ShellId::Wsl), true, &probe).unwrap_err();
        assert_eq!(error.code, "terminal.wsl_no_distro");

        probe.distro = true;
        let probe = probe.var("WSLENV", "USERPROFILE/p");
        let spec = resolve_shell(&choice(ShellId::Wsl), true, &probe).unwrap();
        assert_eq!(spec.program, wsl);
        assert!(spec.args.is_empty());
        assert_eq!(spec.kind, ShellKind::Posix);
        let wslenv = spec
            .env
            .iter()
            .find(|(name, _)| name == "WSLENV")
            .map(|(_, value)| value.as_str());
        assert_eq!(
            wslenv,
            Some("USERPROFILE/p:COLORTERM:TERM_PROGRAM:TERM_PROGRAM_VERSION")
        );
    }

    #[test]
    fn wsl_is_refused_when_it_is_not_installed() {
        let mut probe = FakeProbe::windows();
        probe.distro = true;
        let error = resolve_shell(&choice(ShellId::Wsl), true, &probe).unwrap_err();
        assert_eq!(error.code, "terminal.wsl_missing");
    }

    #[test]
    fn wslenv_keeps_entries_the_user_already_forwards() {
        assert_eq!(
            wslenv(Some("COLORTERM/u:FOO")),
            "COLORTERM/u:FOO:TERM_PROGRAM:TERM_PROGRAM_VERSION"
        );
        assert_eq!(wslenv(None), "COLORTERM:TERM_PROGRAM:TERM_PROGRAM_VERSION");
    }

    #[test]
    fn custom_path_with_spaces_and_non_ascii() {
        let nu = r"C:\Users\Zoë\My Shells\nu.exe";
        let probe = FakeProbe::windows().file(nu);
        let spec = resolve_shell(&custom(nu), true, &probe).unwrap();
        assert_eq!(spec.program, nu);
        assert!(spec.args.is_empty());
        assert_eq!(spec.kind, ShellKind::Posix);
        assert_eq!(spec.name, "nu");

        let missing = r"C:\Users\Zoë\My Shells\elvish.exe";
        let error = resolve_shell(&custom(missing), true, &probe).unwrap_err();
        assert_eq!(error.code, "terminal.shell_path_missing");
        assert_eq!(
            crate::app_error::english_error(&error.to_string()),
            format!("There's no program at {missing}.")
        );
        for empty in [custom("   "), choice(ShellId::Custom)] {
            let error = resolve_shell(&empty, true, &probe).unwrap_err();
            assert_eq!(error.code, "terminal.shell_path_empty");
        }
    }

    #[test]
    fn custom_msys_shells_keep_their_start_folder_on_windows() {
        let zsh = r"C:\msys64\usr\bin\zsh.exe";
        let probe = FakeProbe::windows().file(zsh);
        let spec = resolve_shell(&custom(zsh), true, &probe).unwrap();
        assert!(spec.args.is_empty());
        assert!(spec
            .env
            .contains(&("CHERE_INVOKING".to_string(), "1".to_string())));
    }

    #[test]
    fn unix_auto_is_the_login_shell() {
        let probe = FakeProbe {
            login: "/bin/zsh".into(),
            ..FakeProbe::default()
        };
        let spec = resolve_shell(&choice(ShellId::Auto), false, &probe).unwrap();
        assert_eq!(spec.program, "/bin/zsh");
        assert_eq!(spec.args, ["-l"]);
        assert_eq!(spec.kind, ShellKind::Posix);
        assert_eq!(spec.name, "zsh");

        let fish = FakeProbe {
            login: "/usr/local/bin/fish".into(),
            ..FakeProbe::default()
        };
        let spec = resolve_shell(&choice(ShellId::Auto), false, &fish).unwrap();
        assert_eq!(spec.kind, ShellKind::Fish);
    }

    #[test]
    fn custom_login_shells_run_with_dash_l_on_unix() {
        let probe = FakeProbe::default()
            .file("/opt/homebrew/bin/bash")
            .file("/usr/bin/xonsh");
        let bash = resolve_shell(&custom("/opt/homebrew/bin/bash"), false, &probe).unwrap();
        assert_eq!(bash.args, ["-l"]);
        let xonsh = resolve_shell(&custom("/usr/bin/xonsh"), false, &probe).unwrap();
        assert!(xonsh.args.is_empty());
    }

    #[test]
    fn windows_shells_fall_back_to_auto_on_unix() {
        let probe = FakeProbe {
            login: "/bin/bash".into(),
            ..FakeProbe::default()
        };
        for id in [
            ShellId::Wsl,
            ShellId::GitBash,
            ShellId::Pwsh,
            ShellId::Powershell,
            ShellId::Cmd,
        ] {
            let spec = resolve_shell(&choice(id), false, &probe).unwrap();
            assert_eq!(spec.program, "/bin/bash");
            assert_eq!(spec.id, ShellId::Auto);
        }
    }

    #[test]
    fn shell_kind_reads_windows_and_unix_names() {
        assert_eq!(
            shell_kind_for(r"C:\Windows\System32\cmd.exe"),
            ShellKind::Cmd
        );
        assert_eq!(
            shell_kind_for(r"C:\Windows\System32\CMD.EXE"),
            ShellKind::Cmd
        );
        assert_eq!(shell_kind_for("pwsh.exe"), ShellKind::Powershell);
        assert_eq!(shell_kind_for("/usr/bin/fish"), ShellKind::Fish);
        assert_eq!(
            shell_kind_for(r"C:\msys64\usr\bin\zsh.exe"),
            ShellKind::Posix
        );
        assert_eq!(
            shell_kind_for("/opt/homebrew/bin/pwsh"),
            ShellKind::Powershell
        );
    }

    #[test]
    fn program_names_drop_the_folder_and_exe_ending() {
        assert_eq!(program_name(r"C:\Python312\PYTHON.EXE"), "PYTHON");
        assert_eq!(program_name("/bin/zsh"), "zsh");
        assert_eq!(program_name("nu"), "nu");
        assert_eq!(
            win_join(r"C:\Program Files\", r"\Git"),
            r"C:\Program Files\Git"
        );
    }

    #[test]
    fn shell_options_list_only_what_is_installed() {
        let probe = FakeProbe::windows();
        let options = shell_options(true, &probe);
        let ids: Vec<ShellId> = options.iter().map(|option| option.id).collect();
        assert_eq!(
            ids,
            [
                ShellId::Auto,
                ShellId::Pwsh,
                ShellId::Powershell,
                ShellId::Cmd,
                ShellId::GitBash,
                ShellId::Wsl,
                ShellId::Custom,
            ]
        );
        let available: Vec<ShellId> = options
            .iter()
            .filter(|option| option.available)
            .map(|option| option.id)
            .collect();
        assert_eq!(
            available,
            [
                ShellId::Auto,
                ShellId::Powershell,
                ShellId::Cmd,
                ShellId::Custom,
            ]
        );
        assert_eq!(options[0].resolved, ShellId::Powershell);

        let unix = FakeProbe {
            login: "/bin/zsh".into(),
            ..FakeProbe::default()
        };
        let options = shell_options(false, &unix);
        let ids: Vec<ShellId> = options.iter().map(|option| option.id).collect();
        assert_eq!(ids, [ShellId::Auto, ShellId::Custom]);
        assert_eq!(options[0].name.as_deref(), Some("zsh"));
        assert_eq!(options[0].resolved, ShellId::Auto);
    }

    #[test]
    fn shell_options_resolve_auto_to_pwsh_when_it_is_installed() {
        let probe = FakeProbe::windows().located("pwsh", r"C:\Program Files\PowerShell\7\pwsh.exe");
        let options = shell_options(true, &probe);
        assert_eq!(options[0].resolved, ShellId::Pwsh);
        assert!(options[1].available);
    }

    #[test]
    fn shell_ids_use_the_frontend_names() {
        let ids: Vec<String> = [
            ShellId::Auto,
            ShellId::Pwsh,
            ShellId::Powershell,
            ShellId::Cmd,
            ShellId::GitBash,
            ShellId::Wsl,
            ShellId::Custom,
        ]
        .iter()
        .map(|id| serde_json::to_string(id).unwrap())
        .collect();
        assert_eq!(
            ids,
            [
                "\"auto\"",
                "\"pwsh\"",
                "\"powershell\"",
                "\"cmd\"",
                "\"gitBash\"",
                "\"wsl\"",
                "\"custom\"",
            ]
        );
        let parsed: ShellChoice =
            serde_json::from_str(r#"{"id":"gitBash","path":"D:\\x.exe"}"#).unwrap();
        assert_eq!(parsed.id, ShellId::GitBash);
        assert_eq!(parsed.path.as_deref(), Some(r"D:\x.exe"));
        let empty: ShellChoice = serde_json::from_str("{}").unwrap();
        assert_eq!(empty.id, ShellId::Auto);
    }
}
