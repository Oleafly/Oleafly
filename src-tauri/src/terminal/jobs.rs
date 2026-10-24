//! Whether a terminal is busy: a program other than the shell runs in it,
//! so closing the terminal, the project or the app would stop that program.

use serde::Serialize;

/// A terminal with a running program, and that program's name when known.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalJob {
    pub id: String,
    pub process: Option<String>,
}

/// Console helpers that live in a terminal's job object but are not
/// programs the user started.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) const WINDOWS_TERMINAL_HELPERS: &[&str] = &[
    "conhost.exe",
    "openconsole.exe",
    "wslhost.exe",
    "wslrelay.exe",
];

/// The foreground process group of a Unix terminal when it is not the
/// shell's own (a shell without job control never looks busy).
#[cfg_attr(not(unix), allow(dead_code))]
pub(crate) fn unix_foreground_group(shell_pid: i32, foreground: Option<i32>) -> Option<i32> {
    foreground.filter(|group| *group > 0 && *group != shell_pid)
}

/// The first process in a Windows terminal's job that the user started:
/// not the shell, not a second process with the shell's image (Git Bash's
/// launcher starts another `bash.exe`) and not a console helper. Programs
/// running inside WSL are invisible here.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn windows_foreground_process(
    shell_pid: u32,
    processes: &[(u32, String)],
) -> Option<String> {
    let image = |path: &str| file_name(path).to_ascii_lowercase();
    let shell_image = processes
        .iter()
        .find(|(pid, _)| *pid == shell_pid)
        .map(|(_, path)| image(path))
        .filter(|name| !name.is_empty());
    processes
        .iter()
        .filter(|(pid, _)| *pid != shell_pid)
        .filter(|(_, path)| {
            let name = image(path);
            !WINDOWS_TERMINAL_HELPERS.contains(&name.as_str())
                && shell_image.as_deref() != Some(name.as_str())
        })
        .map(|(_, path)| path.clone())
        .next()
}

/// A program's name for the confirmation dialog: the file name without
/// its folder or `.exe` ending.
pub(crate) fn display_process_name(image: &str) -> String {
    super::shell::program_name(image)
}

fn file_name(path: &str) -> &str {
    path.rsplit(['\\', '/']).next().unwrap_or(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn processes(list: &[(u32, &str)]) -> Vec<(u32, String)> {
        list.iter()
            .map(|(pid, name)| (*pid, (*name).to_string()))
            .collect()
    }

    #[test]
    fn unix_shells_are_busy_only_with_another_foreground_group() {
        assert_eq!(unix_foreground_group(100, Some(100)), None);
        assert_eq!(unix_foreground_group(100, Some(250)), Some(250));
        assert_eq!(unix_foreground_group(100, None), None);
        assert_eq!(unix_foreground_group(100, Some(0)), None);
    }

    #[test]
    fn windows_terminals_are_busy_with_a_program_other_than_the_shell() {
        let node = processes(&[(4120, "pwsh.exe"), (5000, "node.exe")]);
        assert_eq!(
            windows_foreground_process(4120, &node).as_deref(),
            Some("node.exe")
        );

        let helpers = processes(&[(4120, "pwsh.exe"), (77, "OpenConsole.exe")]);
        assert_eq!(windows_foreground_process(4120, &helpers), None);

        let git_bash = processes(&[(10, "bash.exe"), (11, "bash.exe")]);
        assert_eq!(windows_foreground_process(10, &git_bash), None);

        let python = processes(&[(10, "bash.exe"), (11, "bash.exe"), (12, "python.exe")]);
        assert_eq!(
            windows_foreground_process(10, &python).as_deref(),
            Some("python.exe")
        );

        let full_paths = processes(&[
            (8, r"C:\Windows\System32\cmd.exe"),
            (9, r"C:\Windows\System32\conhost.exe"),
            (12, r"D:\Tools\Python 3.12\python.exe"),
        ]);
        assert_eq!(
            windows_foreground_process(8, &full_paths).as_deref(),
            Some(r"D:\Tools\Python 3.12\python.exe")
        );
    }

    #[test]
    fn process_names_drop_folders_and_the_exe_ending() {
        assert_eq!(display_process_name(r"C:\Python312\PYTHON.EXE"), "PYTHON");
        assert_eq!(display_process_name("vim"), "vim");
        assert_eq!(display_process_name("/usr/bin/node"), "node");
    }

    #[test]
    fn terminal_jobs_serialize_for_the_frontend() {
        let job = TerminalJob {
            id: "term-a".into(),
            process: Some("node".into()),
        };
        assert_eq!(
            serde_json::to_value(job).unwrap(),
            serde_json::json!({ "id": "term-a", "process": "node" })
        );
    }
}
