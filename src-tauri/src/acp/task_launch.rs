use super::{
    catalog::Launch,
    redact::{clear_value, Redactor},
    types::AgentDefinition,
};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    io::Write,
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;

/// Variables a sandboxed agent keeps from its launch: the CLI hand-offs the
/// bridges read, Windows search hardening and the Claude v2 switch.
const TASK_ENV: [&str; 6] = [
    "PI_ACP_PI_COMMAND",
    "CLAUDE_CODE_EXECUTABLE",
    "CODEX_PATH",
    "NoDefaultCurrentDirectoryInExePath",
    "LC_ALL",
    "CLAUDE_AGENT_ACP_EXPERIMENTAL_V2",
];

/// The environment a sandboxed agent starts with on top of the sandbox's
/// fixed one: [`TASK_ENV`] from the launch and the project's Git hardening.
/// Never a reserved variable (`PATH`, `HOME`, …).
pub(super) fn task_env(
    launch: &Launch,
    project_id: &str,
    root: &Path,
) -> Result<BTreeMap<String, String>, String> {
    let mut env = BTreeMap::new();
    for (name, value) in &launch.env {
        if !TASK_ENV.iter().any(|kept| kept.eq_ignore_ascii_case(name)) {
            continue;
        }
        if let Some(value) = value.to_str() {
            env.insert(name.clone(), value.to_owned());
        }
    }
    if let Some(hardening) = crate::trust::git_restriction(project_id, root)? {
        for (name, value) in hardening {
            if let Some(value) = value.to_str() {
                env.insert(name, value.to_owned());
            }
        }
    }
    env.retain(|name, _| {
        !oleafly_sandbox::RESERVED_ENV
            .iter()
            .any(|reserved| reserved.eq_ignore_ascii_case(name))
    });
    Ok(env)
}

/// The root of the Python virtual environment `executable` runs from: its
/// `bin` (`Scripts` on Windows) folder sits next to `pyvenv.cfg`.
fn python_venv_root(executable: &Path) -> Option<PathBuf> {
    let folder = executable.parent()?;
    let name = folder.file_name()?.to_str()?;
    if !(name == "bin" || name.eq_ignore_ascii_case("Scripts")) {
        return None;
    }
    let root = folder.parent()?;
    root.join("pyvenv.cfg")
        .is_file()
        .then(|| root.to_path_buf())
}

/// The package folder of the Pi CLI a bridge is handed: the nearest
/// ancestor with a `package.json`, else the CLI's own folder.
fn pi_package_root(command: &Path) -> Option<PathBuf> {
    let real = command
        .canonicalize()
        .unwrap_or_else(|_| command.to_path_buf());
    real.ancestors()
        .skip(1)
        .take(6)
        .find(|folder| folder.join("package.json").is_file())
        .map(Path::to_path_buf)
        .or_else(|| real.parent().map(Path::to_path_buf))
}

pub fn runtime_reads(root: &Path, definition: &AgentDefinition, launch: &Launch) -> Vec<PathBuf> {
    let mut paths = vec![launch.executable.clone()];
    if launch.managed {
        paths.push(
            root.join("agents")
                .join(&definition.id)
                .join(&definition.version),
        );
    }
    let mut candidates = vec![launch.executable.clone()];
    let executable_name = launch
        .executable
        .file_stem()
        .and_then(std::ffi::OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if executable_name == "node" || executable_name.starts_with("python") {
        if let Some(script) = launch
            .args
            .iter()
            .find(|argument| !argument.starts_with('-'))
        {
            let script = Path::new(script);
            if script.is_absolute()
                && script.is_file()
                && script.extension().is_some_and(|extension| {
                    matches!(extension.to_str(), Some("py" | "js" | "mjs" | "cjs"))
                })
            {
                candidates.push(script.to_path_buf());
            }
        }
    }
    for candidate in &candidates {
        paths.push(candidate.clone());
        for ancestor in candidate.ancestors() {
            if ancestor
                .file_name()
                .is_some_and(|name| name == "node_modules")
            {
                paths.push(ancestor.to_path_buf());
                break;
            }
        }
        let interpreter = candidate
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            .map(str::to_ascii_lowercase)
            .is_some_and(|name| name == "node" || name == "node.exe" || name.starts_with("python"));
        if interpreter {
            if let Some(prefix) = candidate
                .parent()
                .filter(|parent| parent.file_name().is_some_and(|name| name == "bin"))
                .and_then(Path::parent)
            {
                paths.push(prefix.join("lib"));
            }
        }
    }
    paths.extend(python_venv_root(&launch.executable));
    if let Some((_, pi)) = launch
        .env
        .iter()
        .find(|(name, _)| name == "PI_ACP_PI_COMMAND")
    {
        paths.extend(pi_package_root(Path::new(pi)));
    }
    paths.sort();
    paths.dedup();
    paths.retain(|path| path.exists());
    paths
}

pub fn prepare_credentials(
    home: &Path,
    temporary: &Path,
    agent_id: &str,
    mcp: &[Value],
) -> Result<Redactor, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(temporary, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "The task credential directory could not be protected.")?;
    }
    let home = home
        .canonicalize()
        .map_err(|_| "The CLI account directory could not be resolved.")?;
    let files: &[&str] = match agent_id {
        "claude" => &[".claude/.credentials.json"],
        "codex" => &[".codex/auth.json"],
        "gemini" => &[".gemini/oauth_creds.json", ".gemini/google_accounts.json"],
        "pi" => &[
            ".pi/agent/auth.json",
            ".pi/agent/settings.json",
            ".pi/agent/models.json",
        ],
        _ => &[],
    };
    let mut secrets = Vec::new();
    for relative in files {
        let source = home.join(relative);
        let metadata = match source.symlink_metadata() {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err("A CLI credential file could not be inspected.".into()),
        };
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > 256 * 1024
            || !source
                .canonicalize()
                .is_ok_and(|path| path.starts_with(&home))
        {
            return Err(
                "A CLI credential file is outside its account directory or too large.".into(),
            );
        }
        let bytes = Zeroizing::new(
            std::fs::read(&source).map_err(|_| "A CLI credential file could not be read.")?,
        );
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| {
            "The CLI credential file is invalid. Sign in through the official CLI again."
        })?;
        let destination = temporary.join(relative);
        write_private(&destination, &bytes)?;
        secrets.push(value);
    }
    if agent_id == "gemini" && temporary.join(".gemini/oauth_creds.json").is_file() {
        write_private(
            &temporary.join(".gemini/settings.json"),
            br#"{"security":{"auth":{"selectedType":"oauth-personal"}}}"#,
        )?;
    }
    secrets.push(json!({"mcp":mcp}));
    let redactor = Redactor::new(&secrets);
    for value in &mut secrets {
        clear_value(value);
    }
    Ok(redactor)
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|_| "The private CLI account directory could not be created.")?;
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "The private CLI credential file could not be created.")?;
    file.write_all(bytes)
        .map_err(|_| "The private CLI credential file could not be written.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    fn launch(executable: &Path, env: Vec<(&str, &str)>) -> Launch {
        Launch {
            executable: executable.to_path_buf(),
            args: Vec::new(),
            version: None,
            managed: false,
            batch: false,
            entry: None,
            needs_local_folder: false,
            env: env
                .into_iter()
                .map(|(name, value)| (name.to_string(), OsString::from(value)))
                .collect(),
        }
    }

    #[test]
    fn task_env_keeps_only_the_hand_off_variables() {
        let temp = tempfile::tempdir().unwrap();
        let env = task_env(
            &launch(
                Path::new("/bin/agent"),
                vec![
                    ("PI_ACP_PI_COMMAND", "/outside/pi"),
                    ("HOME", "/home/a"),
                    ("PATH", "/usr/bin"),
                    ("LANG", "C"),
                    ("OPENAI_API_KEY", "sk-secret-123456789"),
                ],
            ),
            "project",
            temp.path(),
        )
        .unwrap();
        assert_eq!(
            env.get("PI_ACP_PI_COMMAND").map(String::as_str),
            Some("/outside/pi")
        );
        for dropped in ["HOME", "PATH", "LANG", "OPENAI_API_KEY"] {
            assert!(!env.contains_key(dropped), "{dropped}");
        }
    }

    #[test]
    fn runtime_reads_include_a_python_venv_root() {
        let temp = tempfile::tempdir().unwrap();
        let venv = temp.path().join("venv");
        let folder = venv.join(if cfg!(windows) { "Scripts" } else { "bin" });
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(venv.join("pyvenv.cfg"), "home = /usr").unwrap();
        let python = folder.join(if cfg!(windows) {
            "python.exe"
        } else {
            "python"
        });
        std::fs::write(&python, "").unwrap();
        let definition = crate::acp::catalog::builtins().remove(0);
        let reads = runtime_reads(temp.path(), &definition, &launch(&python, Vec::new()));
        assert!(reads.contains(&venv));
    }

    #[test]
    fn runtime_reads_include_the_pi_package_root() {
        let temp = tempfile::tempdir().unwrap();
        let package = temp.path().join("pi-cli");
        std::fs::create_dir_all(package.join("dist")).unwrap();
        std::fs::write(package.join("package.json"), "{}").unwrap();
        let cli = package.join("dist").join("cli.js");
        std::fs::write(&cli, "").unwrap();
        let definition = crate::acp::catalog::builtins().remove(0);
        let reads = runtime_reads(
            temp.path(),
            &definition,
            &launch(
                Path::new("/bin/sh"),
                vec![("PI_ACP_PI_COMMAND", cli.to_str().unwrap())],
            ),
        );
        let package = package.canonicalize().unwrap();
        assert!(reads.iter().any(|path| path == &package));
    }

    #[test]
    fn pi_credentials_are_copied_into_the_task_home() {
        let home = tempfile::tempdir().unwrap();
        let task = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".pi/agent")).unwrap();
        std::fs::write(
            home.path().join(".pi/agent/auth.json"),
            r#"{"token":"pi-token-1234567"}"#,
        )
        .unwrap();
        std::fs::write(
            home.path().join(".pi/agent/settings.json"),
            r#"{"model":"x"}"#,
        )
        .unwrap();
        let redactor = prepare_credentials(home.path(), task.path(), "pi", &[]).unwrap();
        assert!(task.path().join(".pi/agent/auth.json").is_file());
        assert!(task.path().join(".pi/agent/settings.json").is_file());
        assert!(!task.path().join(".pi/agent/models.json").exists());
        assert_eq!(redactor.text("pi-token-1234567"), "[credential omitted]");
    }
}
