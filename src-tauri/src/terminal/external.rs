use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use tauri::{Runtime, Webview};

use crate::app_error::AppError;

const FALLBACK_CODE: &str = "terminal.external_fallback";
const WORDS_VARIABLE: &str = "OLEAFLY_TERMINAL_WORDS";
const COMMAND_TITLE: &str = "oleafly-terminal";
const KEEP_OPEN_SCRIPT: &str = r#""$@"; exec "${SHELL:-/bin/sh}""#;
const MAC_RUNNER: &str = r#"#!/bin/bash
folder="${0%/*}"
words=()
while IFS= read -r -d '' word; do words+=("$word"); done < "$folder/words"
rm -rf -- "$folder"
cd -- "${words[0]}" && "${words[@]:1}"
exec "${SHELL:-/bin/zsh}" -l
"#;
const POWERSHELL_RUNNER: &str = "$words = $env:OLEAFLY_TERMINAL_WORDS | ConvertFrom-Json; \
Remove-Item Env:OLEAFLY_TERMINAL_WORDS; $program, $rest = $words; & $program @rest";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ExternalTerminal {
    MacTerminal,
    Iterm,
    WindowsTerminal,
    Powershell,
    Cmd,
    XTerminalEmulator,
    GnomeTerminal,
    Konsole,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HostPlatform {
    Mac,
    Windows,
    Linux,
}

impl HostPlatform {
    fn current() -> Self {
        if cfg!(target_os = "macos") {
            Self::Mac
        } else if cfg!(windows) {
            Self::Windows
        } else {
            Self::Linux
        }
    }

    fn terminals(self) -> &'static [ExternalTerminal] {
        match self {
            Self::Mac => &[ExternalTerminal::MacTerminal, ExternalTerminal::Iterm],
            Self::Windows => &[
                ExternalTerminal::WindowsTerminal,
                ExternalTerminal::Powershell,
                ExternalTerminal::Cmd,
            ],
            Self::Linux => &[
                ExternalTerminal::XTerminalEmulator,
                ExternalTerminal::GnomeTerminal,
                ExternalTerminal::Konsole,
            ],
        }
    }
}

impl ExternalTerminal {
    fn name(self) -> &'static str {
        match self {
            Self::MacTerminal => "Terminal",
            Self::Iterm => "iTerm",
            Self::WindowsTerminal => "Windows Terminal",
            Self::Powershell => "PowerShell",
            Self::Cmd => "Command Prompt",
            Self::XTerminalEmulator => "x-terminal-emulator",
            Self::GnomeTerminal => "GNOME Terminal",
            Self::Konsole => "Konsole",
        }
    }

    fn mac_bundle(self) -> Option<&'static str> {
        match self {
            Self::MacTerminal => Some("com.apple.Terminal"),
            Self::Iterm => Some("com.googlecode.iterm2"),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalTerminalOption {
    pub id: ExternalTerminal,
    pub name: String,
    pub detail: Option<String>,
    pub available: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalCommand {
    #[serde(rename = "command")]
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct LaunchPlan {
    program: OsString,
    args: Vec<OsString>,
    raw_args: Vec<String>,
    env: Vec<(String, String)>,
    new_console: bool,
    prepare_runner: Option<Vec<u8>>,
}

fn fallback_to_builtin() -> String {
    AppError::new(FALLBACK_CODE).into()
}

fn command_words(
    command: &ExternalCommand,
    env: &[(String, String)],
    env_program: &Path,
) -> Vec<String> {
    let mut words = Vec::with_capacity(command.args.len() + env.len() + 2);
    if !env.is_empty() {
        words.push(env_program.to_string_lossy().into_owned());
        words.extend(env.iter().map(|(name, value)| format!("{name}={value}")));
    }
    words.push(command.program.clone());
    words.extend(command.args.iter().cloned());
    words
}

fn nul_separated(words: &[String]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for word in words {
        bytes.extend_from_slice(word.as_bytes());
        bytes.push(0);
    }
    bytes
}

fn os(value: &str) -> OsString {
    OsString::from(value)
}

fn mac_plan(
    terminal: ExternalTerminal,
    cwd: &Path,
    command: Option<&ExternalCommand>,
    env: &[(String, String)],
) -> LaunchPlan {
    let bundle = terminal.mac_bundle().unwrap_or_default();
    let mut plan = LaunchPlan {
        program: os("/usr/bin/open"),
        args: vec![os("-b"), os(bundle)],
        ..LaunchPlan::default()
    };
    match command {
        None => plan.args.push(cwd.as_os_str().to_os_string()),
        Some(command) => {
            let mut words = vec![cwd.to_string_lossy().into_owned()];
            words.extend(command_words(command, env, Path::new("/usr/bin/env")));
            plan.prepare_runner = Some(nul_separated(&words));
        }
    }
    plan
}

fn keep_open_args(command: &ExternalCommand) -> Vec<OsString> {
    let mut args = vec![
        os("/bin/sh"),
        os("-c"),
        os(KEEP_OPEN_SCRIPT),
        os(COMMAND_TITLE),
        OsString::from(&command.program),
    ];
    args.extend(command.args.iter().map(OsString::from));
    args
}

fn linux_plan(
    terminal: ExternalTerminal,
    program: &Path,
    cwd: &Path,
    command: Option<&ExternalCommand>,
    env: &[(String, String)],
) -> LaunchPlan {
    let mut args: Vec<OsString> = Vec::new();
    match terminal {
        ExternalTerminal::GnomeTerminal => {
            let mut folder = OsString::from("--working-directory=");
            folder.push(cwd);
            args.push(folder);
        }
        ExternalTerminal::Konsole => {
            args.push(os("--workdir"));
            args.push(cwd.as_os_str().to_os_string());
        }
        _ => {}
    }
    if let Some(command) = command {
        args.push(os(match terminal {
            ExternalTerminal::GnomeTerminal => "--",
            _ => "-e",
        }));
        args.extend(keep_open_args(command));
    }
    LaunchPlan {
        program: program.as_os_str().to_os_string(),
        args,
        env: env.to_vec(),
        ..LaunchPlan::default()
    }
}

fn windows_terminal_word(word: &str) -> OsString {
    OsString::from(word.replace(';', "\\;"))
}

fn runs_through_cmd(program: &str) -> bool {
    Path::new(program)
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat")
        })
}

fn windows_words_pass_through(words: &[String]) -> bool {
    let batch = words
        .first()
        .is_some_and(|program| runs_through_cmd(program));
    words.iter().all(|word| {
        !word.is_empty()
            && !word.contains('"')
            && !(word.contains(' ') && word.ends_with('\\'))
            && !(batch
                && word.chars().any(|character| {
                    matches!(
                        character,
                        '&' | '|' | '<' | '>' | '^' | '%' | '!' | '(' | ')'
                    )
                }))
    })
}

fn cmd_command_line(words: &[String]) -> Result<String, String> {
    let unsafe_word = |word: &String| {
        word.is_empty()
            || word
                .chars()
                .any(|character| matches!(character, '"' | '%' | '\n' | '\r'))
    };
    if words.iter().any(unsafe_word) {
        return Err(fallback_to_builtin());
    }
    let quoted: Vec<String> = words.iter().map(|word| format!("\"{word}\"")).collect();
    Ok(format!("\"{}\"", quoted.join(" ")))
}

fn windows_plan(
    terminal: ExternalTerminal,
    program: &Path,
    command: Option<&ExternalCommand>,
    env: &[(String, String)],
) -> Result<LaunchPlan, String> {
    let mut plan = LaunchPlan {
        program: program.as_os_str().to_os_string(),
        env: env
            .iter()
            .cloned()
            .chain(super::env::launch_command_env(command.is_some(), true))
            .collect(),
        ..LaunchPlan::default()
    };
    let words = command.map(|command| {
        let mut words = vec![command.program.clone()];
        words.extend(command.args.iter().cloned());
        words
    });
    let passed_as_words = matches!(
        terminal,
        ExternalTerminal::WindowsTerminal | ExternalTerminal::Powershell
    );
    if passed_as_words
        && words
            .as_deref()
            .is_some_and(|words| !windows_words_pass_through(words))
    {
        return Err(fallback_to_builtin());
    }
    match terminal {
        ExternalTerminal::WindowsTerminal => {
            plan.args = vec![os("-d"), os(".")];
            if let Some(words) = words {
                plan.args.push(os("--"));
                plan.args
                    .extend(words.iter().map(|word| windows_terminal_word(word)));
            }
        }
        ExternalTerminal::Powershell => {
            plan.new_console = true;
            plan.args = vec![os("-NoLogo"), os("-NoExit")];
            if let Some(words) = words {
                let encoded = serde_json::to_string(&words).map_err(|error| error.to_string())?;
                plan.env.push((WORDS_VARIABLE.to_string(), encoded));
                plan.args.push(os("-Command"));
                plan.args.push(os(POWERSHELL_RUNNER));
            }
        }
        _ => {
            plan.new_console = true;
            plan.raw_args = vec!["/D".into(), "/V:OFF".into()];
            if let Some(words) = words {
                plan.raw_args.push("/K".into());
                plan.raw_args.push(cmd_command_line(&words)?);
            }
        }
    }
    Ok(plan)
}

fn locate(name: &str) -> Option<PathBuf> {
    crate::program_locator::locate_native(name).map(|located| located.path.clone())
}

fn windows_terminal_alias() -> Option<PathBuf> {
    let alias = PathBuf::from(std::env::var_os("LOCALAPPDATA")?)
        .join("Microsoft")
        .join("WindowsApps")
        .join("wt.exe");
    std::fs::symlink_metadata(&alias).is_ok().then_some(alias)
}

fn resolve_program(terminal: ExternalTerminal) -> Option<PathBuf> {
    match terminal {
        ExternalTerminal::MacTerminal => Some(PathBuf::from("/usr/bin/open")),
        ExternalTerminal::Iterm => installed_iterm(),
        ExternalTerminal::WindowsTerminal => windows_terminal_alias().or_else(|| locate("wt")),
        ExternalTerminal::Powershell => locate("pwsh").or_else(|| locate("powershell")),
        ExternalTerminal::Cmd => std::env::var_os("ComSpec")
            .map(PathBuf::from)
            .or_else(|| locate("cmd")),
        ExternalTerminal::XTerminalEmulator => locate("x-terminal-emulator"),
        ExternalTerminal::GnomeTerminal => locate("gnome-terminal"),
        ExternalTerminal::Konsole => locate("konsole"),
    }
}

fn installed_iterm() -> Option<PathBuf> {
    let mut folders = vec![PathBuf::from("/Applications")];
    if let Ok(home) = crate::paths::home_dir() {
        folders.push(home.join("Applications"));
    }
    folders
        .into_iter()
        .map(|folder| folder.join("iTerm.app"))
        .find(|bundle| bundle.is_dir())
}

fn program_detail(terminal: ExternalTerminal, program: Option<&Path>) -> Option<String> {
    if terminal != ExternalTerminal::XTerminalEmulator {
        return None;
    }
    let target = program?.canonicalize().ok()?;
    let name = target.file_stem()?.to_string_lossy().into_owned();
    (name != "x-terminal-emulator").then_some(name)
}

fn terminal_options(platform: HostPlatform) -> Vec<ExternalTerminalOption> {
    platform
        .terminals()
        .iter()
        .map(|terminal| {
            let program = resolve_program(*terminal);
            ExternalTerminalOption {
                id: *terminal,
                name: terminal.name().to_string(),
                detail: program_detail(*terminal, program.as_deref()),
                available: program.is_some(),
            }
        })
        .collect()
}

fn launch_plan(
    terminal: ExternalTerminal,
    program: &Path,
    cwd: &Path,
    command: Option<&ExternalCommand>,
    env: &[(String, String)],
    platform: HostPlatform,
) -> Result<LaunchPlan, String> {
    match platform {
        HostPlatform::Mac => Ok(mac_plan(terminal, cwd, command, env)),
        HostPlatform::Windows => windows_plan(terminal, program, command, env),
        HostPlatform::Linux => Ok(linux_plan(terminal, program, cwd, command, env)),
    }
}

fn write_mac_runner(words: &[u8]) -> Result<PathBuf, std::io::Error> {
    let folder = tempfile::Builder::new()
        .prefix("oleafly-terminal-")
        .tempdir()?
        .keep();
    std::fs::write(folder.join("words"), words)?;
    let runner = folder.join("run.command");
    std::fs::write(&runner, MAC_RUNNER)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&runner, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(runner)
}

fn apply_host_env(command: &mut Command) {
    #[cfg(target_os = "linux")]
    {
        use super::env::EnvEdit;
        for edit in super::env::appimage_env_edits(&|name| std::env::var_os(name)) {
            match edit {
                EnvEdit::Remove(name) => {
                    command.env_remove(name);
                }
                EnvEdit::Set(name, value) => {
                    command.env(name, value);
                }
            }
        }
        command.env("PATH", super::env::session_search_path(None));
    }
    crate::proc::clear_appimage_env(command);
}

fn silences_stdio(plan: &LaunchPlan) -> bool {
    !plan.new_console
}

fn build_command(plan: &LaunchPlan, cwd: &Path) -> Command {
    let mut command = Command::new(&plan.program);
    command.args(&plan.args).current_dir(cwd);
    if silences_stdio(plan) {
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        for arg in &plan.raw_args {
            command.raw_arg(arg);
        }
        if plan.new_console {
            command.creation_flags(CREATE_NEW_CONSOLE);
        }
    }
    apply_host_env(&mut command);
    for (name, value) in &plan.env {
        command.env(name, value);
    }
    command
}

fn launch_failed(terminal: ExternalTerminal, detail: impl ToString) -> String {
    AppError::new("terminal.external_failed")
        .param("name", terminal.name())
        .detail(detail)
        .into()
}

fn spawn_plan(terminal: ExternalTerminal, plan: &mut LaunchPlan, cwd: &Path) -> Result<(), String> {
    if let Some(words) = plan.prepare_runner.take() {
        let runner = write_mac_runner(&words).map_err(|error| launch_failed(terminal, error))?;
        plan.args.push(runner.into_os_string());
    }
    let mut command = build_command(plan, cwd);
    if terminal.mac_bundle().is_some() {
        let status = command
            .status()
            .map_err(|error| launch_failed(terminal, error))?;
        return if status.success() {
            Ok(())
        } else {
            Err(launch_failed(terminal, status))
        };
    }
    #[cfg(windows)]
    {
        command
            .spawn()
            .map(drop)
            .map_err(|error| launch_failed(terminal, error))
    }
    #[cfg(not(windows))]
    {
        crate::proc::spawn_contained(&mut command).map_err(|error| launch_failed(terminal, error))
    }
}

#[tauri::command]
pub async fn external_terminals() -> Vec<ExternalTerminalOption> {
    tauri::async_runtime::spawn_blocking(|| terminal_options(HostPlatform::current()))
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn open_external_terminal<R: Runtime>(
    webview: Webview<R>,
    project_id: String,
    terminal: ExternalTerminal,
    cwd: Option<String>,
    command: Option<ExternalCommand>,
    env: Option<BTreeMap<String, String>>,
) -> Result<(), String> {
    super::webview_command_owner(&webview, &project_id)?;
    let platform = HostPlatform::current();
    if !platform.terminals().contains(&terminal) {
        return Err(AppError::new("terminal.external_missing")
            .param("name", terminal.name())
            .into());
    }
    let root = crate::paths::project_dir(&project_id)?;
    let folder = super::env::terminal_cwd(&root, cwd.as_deref())?;
    let env = super::env::validate_launch_env(&env.unwrap_or_default(), cfg!(windows))?;
    if let Some(words) = &command {
        let has_nul = |word: &String| word.contains('\0');
        if has_nul(&words.program) || words.args.iter().any(has_nul) {
            return Err(fallback_to_builtin());
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        if crate::trust::git_restriction(&project_id, &root)
            .map_err(String::from)?
            .is_some()
        {
            return Err(fallback_to_builtin());
        }
        let program = resolve_program(terminal).ok_or_else(|| {
            String::from(AppError::new("terminal.external_missing").param("name", terminal.name()))
        })?;
        let mut plan = launch_plan(
            terminal,
            &program,
            &folder,
            command.as_ref(),
            &env,
            platform,
        )?;
        spawn_plan(terminal, &mut plan, &folder)
    })
    .await
    .map_err(|error| format!("failed to open the terminal: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(args: &[OsString]) -> Vec<String> {
        args.iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    fn sign_in() -> ExternalCommand {
        ExternalCommand {
            program: "/opt/my tools/agent".into(),
            args: vec!["log;in".into(), "$(whoami)".into()],
        }
    }

    #[test]
    fn terminals_use_the_ids_the_settings_store_saves() {
        let id = serde_json::to_value(ExternalTerminal::XTerminalEmulator).unwrap();
        assert_eq!(id, "x-terminal-emulator");
        let parsed: ExternalTerminal = serde_json::from_value("mac-terminal".into()).unwrap();
        assert_eq!(parsed, ExternalTerminal::MacTerminal);
    }

    #[test]
    fn each_platform_offers_only_its_own_terminals() {
        assert!(HostPlatform::Mac
            .terminals()
            .contains(&ExternalTerminal::Iterm));
        assert!(!HostPlatform::Linux
            .terminals()
            .contains(&ExternalTerminal::Iterm));
        assert!(HostPlatform::Windows
            .terminals()
            .contains(&ExternalTerminal::Cmd));
    }

    #[test]
    fn macos_opens_a_folder_by_bundle_id_with_the_path_as_one_argument() {
        let cwd = Path::new("/Users/ada lovelace/论文 $(rm)/");
        let plan = launch_plan(
            ExternalTerminal::Iterm,
            Path::new("/usr/bin/open"),
            cwd,
            None,
            &[],
            HostPlatform::Mac,
        )
        .unwrap();
        assert_eq!(plan.program, "/usr/bin/open");
        assert_eq!(
            text(&plan.args),
            vec![
                "-b",
                "com.googlecode.iterm2",
                "/Users/ada lovelace/论文 $(rm)/"
            ]
        );
        assert_eq!(plan.prepare_runner, None);
    }

    #[test]
    fn macos_runs_a_command_from_a_word_file_and_a_fixed_script() {
        let env = vec![("TOKEN_FILE".to_string(), "/tmp/a b".to_string())];
        let plan = launch_plan(
            ExternalTerminal::MacTerminal,
            Path::new("/usr/bin/open"),
            Path::new("/work/it's here"),
            Some(&sign_in()),
            &env,
            HostPlatform::Mac,
        )
        .unwrap();
        let words = plan
            .prepare_runner
            .expect("the command goes in a word file");
        let words: Vec<&str> = std::str::from_utf8(&words)
            .unwrap()
            .trim_end_matches('\0')
            .split('\0')
            .collect();
        assert_eq!(
            words,
            vec![
                "/work/it's here",
                "/usr/bin/env",
                "TOKEN_FILE=/tmp/a b",
                "/opt/my tools/agent",
                "log;in",
                "$(whoami)",
            ]
        );
        assert!(!MAC_RUNNER.contains("whoami"));
    }

    #[cfg(unix)]
    #[test]
    fn the_macos_runner_passes_every_word_through_unchanged() {
        let folder = tempfile::tempdir().unwrap();
        let cwd = folder.path().join("it's a $(folder)");
        std::fs::create_dir(&cwd).unwrap();
        let record = folder.path().join("record");
        let words = nul_separated(&[
            cwd.to_string_lossy().into_owned(),
            "/bin/sh".into(),
            "-c".into(),
            r#"pwd > "$0"; for word in "$@"; do printf '%s\n' "$word" >> "$0"; done"#.into(),
            record.to_string_lossy().into_owned(),
            "a b".into(),
            "$(whoami); echo no".into(),
            "quote'\"".into(),
        ]);
        let runner = write_mac_runner(&words).unwrap();
        let output = Command::new("/bin/bash")
            .arg(&runner)
            .env("SHELL", "/usr/bin/true")
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        let recorded = std::fs::read_to_string(&record).unwrap();
        let lines: Vec<&str> = recorded.lines().collect();
        assert!(lines[0].ends_with("it's a $(folder)"), "{recorded}");
        assert_eq!(&lines[1..], ["a b", "$(whoami); echo no", "quote'\""]);
        assert!(!runner.exists());
    }

    #[test]
    fn linux_terminals_take_the_folder_and_command_as_separate_arguments() {
        let cwd = Path::new("/home/ada/my paper");
        let gnome = launch_plan(
            ExternalTerminal::GnomeTerminal,
            Path::new("/usr/bin/gnome-terminal"),
            cwd,
            Some(&sign_in()),
            &[],
            HostPlatform::Linux,
        )
        .unwrap();
        assert_eq!(
            text(&gnome.args),
            vec![
                "--working-directory=/home/ada/my paper",
                "--",
                "/bin/sh",
                "-c",
                KEEP_OPEN_SCRIPT,
                COMMAND_TITLE,
                "/opt/my tools/agent",
                "log;in",
                "$(whoami)",
            ]
        );
        let konsole = launch_plan(
            ExternalTerminal::Konsole,
            Path::new("/usr/bin/konsole"),
            cwd,
            None,
            &[],
            HostPlatform::Linux,
        )
        .unwrap();
        assert_eq!(text(&konsole.args), vec!["--workdir", "/home/ada/my paper"]);
        let fallback = launch_plan(
            ExternalTerminal::XTerminalEmulator,
            Path::new("/usr/bin/x-terminal-emulator"),
            cwd,
            Some(&sign_in()),
            &[],
            HostPlatform::Linux,
        )
        .unwrap();
        assert_eq!(text(&fallback.args)[0], "-e");
        assert_eq!(text(&fallback.args)[1], "/bin/sh");
    }

    #[cfg(unix)]
    #[test]
    fn the_keep_open_script_runs_the_words_as_given() {
        let folder = tempfile::tempdir().unwrap();
        let record = folder.path().join("record");
        let status = Command::new("/bin/sh")
            .args(["-c", KEEP_OPEN_SCRIPT, COMMAND_TITLE, "/bin/sh", "-c"])
            .arg(r#"printf '%s' "$1" > "$0""#)
            .arg(&record)
            .arg("a;b $(whoami)")
            .env("SHELL", "/usr/bin/true")
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(std::fs::read_to_string(&record).unwrap(), "a;b $(whoami)");
    }

    #[test]
    fn windows_terminal_starts_in_its_working_folder_and_escapes_semicolons() {
        let plan = launch_plan(
            ExternalTerminal::WindowsTerminal,
            Path::new(r"C:\Users\Ada\AppData\Local\Microsoft\WindowsApps\wt.exe"),
            Path::new(r"C:\Users\Ada\my;paper"),
            Some(&sign_in()),
            &[],
            HostPlatform::Windows,
        )
        .unwrap();
        assert_eq!(
            text(&plan.args),
            vec![
                "-d",
                ".",
                "--",
                "/opt/my tools/agent",
                r"log\;in",
                "$(whoami)",
            ]
        );
        assert!(!plan.new_console);
    }

    #[test]
    fn powershell_reads_the_command_from_a_variable() {
        let plan = launch_plan(
            ExternalTerminal::Powershell,
            Path::new(r"C:\Windows\powershell.exe"),
            Path::new(r"C:\work"),
            Some(&sign_in()),
            &[("KEY".to_string(), "value".to_string())],
            HostPlatform::Windows,
        )
        .unwrap();
        assert!(plan.new_console);
        assert_eq!(
            text(&plan.args),
            vec!["-NoLogo", "-NoExit", "-Command", POWERSHELL_RUNNER]
        );
        assert!(!POWERSHELL_RUNNER.contains("whoami"));
        let (name, words) = plan.env.last().unwrap();
        assert_eq!(name, WORDS_VARIABLE);
        assert_eq!(
            serde_json::from_str::<Vec<String>>(words).unwrap(),
            vec!["/opt/my tools/agent", "log;in", "$(whoami)"]
        );
        assert_eq!(plan.env[0], ("KEY".to_string(), "value".to_string()));
    }

    #[test]
    fn windows_terminal_and_powershell_leave_risky_words_to_the_built_in_terminal() {
        let command = |program: &str, word: &str| ExternalCommand {
            program: program.into(),
            args: vec![word.to_string()],
        };
        let shim = r"C:\Users\Ada\AppData\Roaming\npm\claude.cmd";
        let plan = |terminal, command: &ExternalCommand| {
            launch_plan(
                terminal,
                Path::new(r"C:\Windows\System32\tool.exe"),
                Path::new(r"C:\work"),
                Some(command),
                &[],
                HostPlatform::Windows,
            )
        };
        for terminal in [
            ExternalTerminal::WindowsTerminal,
            ExternalTerminal::Powershell,
        ] {
            for risky in [
                command(shim, "--url=https://x/?a=1&b=2"),
                command(r"C:\tools\SETUP.BAT", "100%"),
                command(shim, "(x)"),
                command("agent.exe", "say \"hi\""),
                command("agent.exe", r"C:\My Dir\"),
                command("agent.exe", ""),
            ] {
                let error = plan(terminal, &risky).unwrap_err();
                assert!(error.contains(FALLBACK_CODE), "{terminal:?} {risky:?}");
            }
            for safe in [
                command("agent.exe", "a&b"),
                command(shim, "--login"),
                command("agent.exe", r"C:\out\"),
            ] {
                assert!(plan(terminal, &safe).is_ok(), "{terminal:?} {safe:?}");
            }
        }
    }

    #[test]
    fn command_prompt_quotes_words_and_leaves_risky_ones_to_the_built_in_terminal() {
        let safe = ExternalCommand {
            program: r"C:\Program Files\agent.cmd".into(),
            args: vec!["login".into()],
        };
        let plan = launch_plan(
            ExternalTerminal::Cmd,
            Path::new(r"C:\Windows\System32\cmd.exe"),
            Path::new(r"C:\work"),
            Some(&safe),
            &[],
            HostPlatform::Windows,
        )
        .unwrap();
        assert_eq!(
            plan.raw_args,
            vec![
                "/D".to_string(),
                "/V:OFF".to_string(),
                "/K".to_string(),
                r#"""C:\Program Files\agent.cmd" "login"""#.to_string(),
            ]
        );
        for risky in ["100%", "say \"hi\"", ""] {
            let command = ExternalCommand {
                program: "agent".into(),
                args: vec![risky.to_string()],
            };
            let error = launch_plan(
                ExternalTerminal::Cmd,
                Path::new(r"C:\Windows\System32\cmd.exe"),
                Path::new(r"C:\work"),
                Some(&command),
                &[],
                HostPlatform::Windows,
            )
            .unwrap_err();
            assert!(error.contains(FALLBACK_CODE), "{error}");
        }
    }

    #[test]
    fn opening_a_folder_on_windows_relies_on_the_working_folder_alone() {
        let plan = launch_plan(
            ExternalTerminal::Cmd,
            Path::new(r"C:\Windows\System32\cmd.exe"),
            Path::new(r"C:\Users\Ada & Bob\paper"),
            None,
            &[],
            HostPlatform::Windows,
        )
        .unwrap();
        assert!(plan.args.is_empty());
        assert_eq!(plan.raw_args, vec!["/D".to_string(), "/V:OFF".to_string()]);
    }

    #[test]
    fn only_windows_plans_with_their_own_console_keep_their_stdio() {
        let windows = |terminal, command| {
            launch_plan(
                terminal,
                Path::new(r"C:\Windows\System32\tool.exe"),
                Path::new(r"C:\work"),
                command,
                &[],
                HostPlatform::Windows,
            )
            .unwrap()
        };
        let safe = ExternalCommand {
            program: "agent".into(),
            args: vec!["login".into()],
        };
        for terminal in [ExternalTerminal::Powershell, ExternalTerminal::Cmd] {
            assert!(!silences_stdio(&windows(terminal, None)), "{terminal:?}");
            assert!(
                !silences_stdio(&windows(terminal, Some(&safe))),
                "{terminal:?}"
            );
        }
        assert!(silences_stdio(&windows(
            ExternalTerminal::WindowsTerminal,
            Some(&safe)
        )));
        let mac = launch_plan(
            ExternalTerminal::MacTerminal,
            Path::new("/usr/bin/open"),
            Path::new("/work"),
            Some(&safe),
            &[],
            HostPlatform::Mac,
        )
        .unwrap();
        assert!(silences_stdio(&mac));
        let linux = launch_plan(
            ExternalTerminal::Konsole,
            Path::new("/usr/bin/konsole"),
            Path::new("/work"),
            Some(&safe),
            &[],
            HostPlatform::Linux,
        )
        .unwrap();
        assert!(silences_stdio(&linux));
    }

    #[test]
    fn a_windows_launch_command_never_runs_a_program_from_the_project_folder() {
        let guard = (
            "NoDefaultCurrentDirectoryInExePath".to_string(),
            "1".to_string(),
        );
        let key = ("KEY".to_string(), "value".to_string());
        let installer = ExternalCommand {
            program: "powershell.exe".into(),
            args: vec!["-File".into(), "install.ps1".into()],
        };
        let plan = |terminal, command| {
            launch_plan(
                terminal,
                Path::new(r"C:\Windows\System32\tool.exe"),
                Path::new(r"C:\work"),
                command,
                std::slice::from_ref(&key),
                HostPlatform::Windows,
            )
            .unwrap()
        };
        assert_eq!(
            plan(ExternalTerminal::Cmd, Some(&installer)).env,
            vec![key.clone(), guard.clone()]
        );
        assert!(plan(ExternalTerminal::Powershell, Some(&installer))
            .env
            .contains(&guard));
        assert!(plan(ExternalTerminal::WindowsTerminal, Some(&installer))
            .env
            .contains(&guard));
        assert_eq!(plan(ExternalTerminal::Cmd, None).env, vec![key.clone()]);
    }

    #[test]
    fn linux_launch_variables_stay_out_of_the_command_line() {
        let env = vec![("TOKEN_FILE".to_string(), "/home/ada/secret".to_string())];
        for (terminal, program) in [
            (ExternalTerminal::GnomeTerminal, "/usr/bin/gnome-terminal"),
            (ExternalTerminal::Konsole, "/usr/bin/konsole"),
            (
                ExternalTerminal::XTerminalEmulator,
                "/usr/bin/x-terminal-emulator",
            ),
        ] {
            let plan = launch_plan(
                terminal,
                Path::new(program),
                Path::new("/home/ada/paper"),
                Some(&sign_in()),
                &env,
                HostPlatform::Linux,
            )
            .unwrap();
            assert_eq!(plan.env, env);
            let words = text(&plan.args);
            assert!(
                !words
                    .iter()
                    .any(|word| word.contains("TOKEN_FILE") || word.contains("secret")),
                "{words:?}"
            );
            assert!(
                !words.iter().any(|word| word == "/usr/bin/env"),
                "{words:?}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn launch_variables_win_over_host_env_cleaning() {
        let _appimage = crate::proc::SimulatedAppImage::start();
        let plan = LaunchPlan {
            program: os("/bin/sh"),
            env: vec![("PYTHONPATH".to_string(), "/opt/mine".to_string())],
            ..LaunchPlan::default()
        };
        let command = build_command(&plan, Path::new("/"));
        let value = command
            .get_envs()
            .find(|(name, _)| *name == "PYTHONPATH")
            .and_then(|(_, value)| value);
        assert_eq!(value, Some(std::ffi::OsStr::new("/opt/mine")));
    }

    #[cfg(unix)]
    #[test]
    fn host_env_cleaning_drops_appimage_library_paths() {
        let appimage = crate::proc::SimulatedAppImage::start();
        let plan = LaunchPlan {
            program: os("/bin/sh"),
            ..LaunchPlan::default()
        };
        let command = build_command(&plan, Path::new("/"));
        let library_path = command
            .get_envs()
            .find(|(name, _)| *name == "LD_LIBRARY_PATH")
            .and_then(|(_, value)| value)
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_default();
        assert!(
            !library_path.contains(&appimage.root.to_string_lossy().into_owned()),
            "{library_path}"
        );
    }
}
