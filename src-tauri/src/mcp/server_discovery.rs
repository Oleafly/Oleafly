use super::{json, paths, AtomicU64, Ordering};

pub(super) fn ensure_token() -> Result<String, String> {
    let cfg = crate::config::read_config()?;
    if !cfg.mcp_token.is_empty() {
        return Ok(cfg.mcp_token);
    }
    let generated = crate::secrets::generate_mcp_token();
    let mut token = generated.clone();
    crate::config::update_config(|config| {
        if config.mcp_token.is_empty() {
            config.mcp_token = generated;
        } else {
            token = config.mcp_token.clone();
        }
        Ok(())
    })?;
    Ok(token)
}

pub(super) fn write_discovery_file(port: u16, token: &str) -> Result<(), String> {
    let path = paths::oleafly_root()?.join("mcp.json");
    write_discovery_file_at(&path, port, token)
}

pub(super) fn write_discovery_file_at(
    path: &std::path::Path,
    port: u16,
    token: &str,
) -> Result<(), String> {
    let body = serde_json::to_string_pretty(&json!({
        "url": format!("http://127.0.0.1:{port}/mcp"),
        "token": token,
    }))
    .map_err(|e| e.to_string())?;
    write_private_discovery(path, body.as_bytes())
}

fn write_private_discovery(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "MCP discovery path has no parent directory".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("failed to create MCP discovery directory: {e}"))?;
    let (temp_path, file) = reserve_discovery_file(parent)?;
    let publish = publish_discovery_contents(file, &temp_path, path, parent, bytes);
    if publish.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }
    publish
}

fn reserve_discovery_file(
    parent: &std::path::Path,
) -> Result<(std::path::PathBuf, std::fs::File), String> {
    static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    (0..32)
        .find_map(|_| {
            let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let candidate =
                parent.join(format!(".mcp.json.{}.{}.tmp", std::process::id(), sequence));
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt as _;
                options.mode(0o600);
            }
            match options.open(&candidate) {
                Ok(file) => Some(Ok((candidate, file))),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => None,
                Err(error) => Some(Err(format!(
                    "failed to create MCP discovery staging file: {error}"
                ))),
            }
        })
        .transpose()?
        .ok_or_else(|| "failed to reserve an MCP discovery staging file".to_string())
}

fn publish_discovery_contents(
    mut file: std::fs::File,
    temp_path: &std::path::Path,
    path: &std::path::Path,
    parent: &std::path::Path,
    bytes: &[u8],
) -> Result<(), String> {
    use std::io::Write as _;

    harden_empty_discovery_file(temp_path)?;
    file.write_all(bytes)
        .map_err(|e| format!("failed to write MCP discovery file: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("failed to sync MCP discovery file: {e}"))?;
    drop(file);
    crate::sandbox::replace_file(temp_path, path)
        .map_err(|e| format!("failed to publish MCP discovery file: {e}"))?;
    if let Ok(directory) = std::fs::File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

#[cfg(unix)]
fn harden_empty_discovery_file(path: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt as _;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| format!("failed to harden MCP discovery file permissions: {e}"))?;
    let mode = std::fs::metadata(path)
        .map_err(|e| format!("failed to verify MCP discovery file permissions: {e}"))?
        .permissions()
        .mode()
        & 0o777;
    if mode != 0o600 {
        return Err(format!(
            "MCP discovery file permissions are {mode:o}, expected 600"
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn harden_empty_discovery_file(path: &std::path::Path) -> Result<(), String> {
    crate::fsperm::harden_file_checked(path)
        .map_err(|error| format!("failed to harden MCP discovery file ACL: {error}"))
}

#[cfg(not(any(unix, windows)))]
fn harden_empty_discovery_file(_path: &std::path::Path) -> Result<(), String> {
    Err("owner-only MCP discovery files are unsupported on this platform".into())
}

pub fn rewrite_discovery_file(port: u16, token: &str) -> Result<(), String> {
    write_discovery_file(port, token)
}

pub fn remove_discovery_file() -> Result<(), String> {
    remove_discovery_file_checked()
}

pub(super) fn remove_discovery_file_checked() -> Result<(), String> {
    let path = paths::oleafly_root()?.join("mcp.json");
    remove_discovery_file_at(&path)
}

pub(super) fn remove_discovery_file_at(path: &std::path::Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "failed to remove MCP discovery file {}: {error}",
            path.display()
        )),
    }
}
