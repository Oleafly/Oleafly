//! Cross-platform "owner-only" hardening for on-disk secret files.
//!
//! GitHub tokens and AI keys prefer the OS keychain, but a few files still hold
//! secrets on disk: `config.json` (keychain fallback), `mcp.json` (the live MCP
//! bearer token), and per-project chat history. On unix these are created at
//! mode `0600`. On Windows there is no mode bit; a file under `%USERPROFILE%` is
//! already hidden from other standard users, but inherited NTFS ACLs can still
//! expose it to Administrators/SYSTEM and other processes in the session. This
//! module tightens that to the current user only, mirroring `0600`.

use std::path::Path;

/// Restrict `path` so only the current user can read/write it (the unix `0600`
/// equivalent). Best-effort: never fails the caller. On unix sets `0600`; on
/// Windows resets inherited ACLs and grants only the current user Full control
/// via `icacls`; on other targets it is a no-op.
pub fn harden_file(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(windows)]
    {
        use crate::proc::NoConsole;
        // Resolve "the current user" for icacls. Prefer DOMAIN\USER so the ACE
        // resolves for both local and domain accounts; fall back to the bare
        // name. If we can't determine it, skip (leaves the inherited ACLs; the
        // file is still under the user-scoped %USERPROFILE%).
        let name = match std::env::var("USERNAME") {
            Ok(n) if !n.is_empty() => n,
            _ => return,
        };
        let principal = match std::env::var("USERDOMAIN") {
            Ok(dom) if !dom.is_empty() => format!("{dom}\\{name}"),
            _ => name,
        };
        // /inheritance:r  -> drop inherited ACEs (removes any broader grant)
        // /grant:r USER:(F) -> replace USER's ACE with Full control, so the
        //                      current user is the only principal with access.
        let _ = std::process::Command::new("icacls")
            .no_console()
            .arg(path)
            .arg("/inheritance:r")
            .arg("/grant:r")
            .arg(format!("{principal}:(F)"))
            .output();
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
    }
}
