use super::{
    catalog::Launch,
    redact::{clear_value, Redactor},
    types::AgentDefinition,
};
use serde_json::{json, Value};
use std::{
    io::Write,
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;

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
        .and_then(|value| value.to_str())
        .unwrap_or_default();
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
        if candidate
            .file_name()
            .is_some_and(|name| name == "node" || name == "node.exe")
        {
            if let Some(prefix) = candidate
                .parent()
                .filter(|parent| parent.file_name().is_some_and(|name| name == "bin"))
                .and_then(Path::parent)
            {
                paths.push(prefix.join("lib"));
            }
        }
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
