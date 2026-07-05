use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

use crate::config;
use crate::paths;

fn project_root(project_id: &str) -> Result<PathBuf, String> {
    paths::project_dir(project_id)
}

fn run_git(root: &PathBuf, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))
}

/// Initialize a git repo in the project (idempotent) with a sensible identity.
fn ensure_repo(project_id: &str) -> Result<PathBuf, String> {
    let root = project_root(project_id)?;
    if !root.join(".git").exists() {
        run_git(&root, &["init", "--quiet"])?;
        // Put the (still unborn) default branch on `main` regardless of the
        // user's git `init.defaultBranch`, so the first commit and push agree.
        let _ = run_git(&root, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        std::fs::write(root.join(".gitignore"), ".openleaf/\n.localleaf/\n")
            .map_err(|e| e.to_string())?;
        // Set a local identity if none is configured.
        let email = run_git(&root, &["config", "user.email"])?;
        if String::from_utf8_lossy(&email.stdout).trim().is_empty() {
            let _ = run_git(&root, &["config", "user.email", "openleaf@local"]);
            let _ = run_git(&root, &["config", "user.name", "OpenLeaf"]);
        }
    }
    Ok(root)
}

#[derive(Serialize)]
pub struct GitCommit {
    pub oid: String,
    pub short: String,
    pub time: f64,
    pub message: String,
}

#[tauri::command]
pub fn git_auto_commit(project_id: String, message: String) -> Result<bool, String> {
    let root = ensure_repo(&project_id)?;
    run_git(&root, &["add", "-A"])?;
    let out = run_git(&root, &["commit", "--quiet", "-m", &message])?;
    Ok(out.status.success())
}

#[tauri::command]
pub fn git_log(project_id: String) -> Result<Vec<GitCommit>, String> {
    let root = ensure_repo(&project_id)?;
    let out = run_git(&root, &["log", "--pretty=format:%H%x09%h%x09%ct%x09%s"])?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut commits = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 4 {
            continue;
        }
        commits.push(GitCommit {
            oid: parts[0].to_string(),
            short: parts[1].to_string(),
            time: parts[2].parse().unwrap_or(0.0),
            message: parts[3..].join("\t"),
        });
    }
    Ok(commits)
}

#[tauri::command]
pub fn git_restore(project_id: String, oid: String) -> Result<(), String> {
    let root = ensure_repo(&project_id)?;
    // Restore all tracked files from the given commit into the working tree.
    run_git(&root, &["checkout", &oid, "--", "."])?;
    Ok(())
}

// --- Remotes, push, pull ---

fn out_to_string(out: &std::process::Output) -> String {
    let mut s = String::new();
    s.push_str(&String::from_utf8_lossy(&out.stdout));
    if !out.stderr.is_empty() {
        if !s.is_empty() {
            s.push('\n');
        }
        s.push_str(&String::from_utf8_lossy(&out.stderr));
    }
    s.trim().to_string()
}

/// Strip any embedded credentials from a remote URL for display.
fn sanitize_url(u: &str) -> String {
    if let Some(idx) = u.find("://") {
        let (scheme, rest) = u.split_at(idx + 3);
        if let Some(at) = rest.find('@') {
            return format!("{scheme}{}", &rest[at + 1..]);
        }
    }
    u.to_string()
}

/// Whether a remote URL uses a transport we're willing to configure. Blocks
/// git's `ext::`/`fd::` "transport helper" syntax, which can execute arbitrary
/// commands on fetch/push. Allows the normal network transports and scp-style
/// `git@host:path` shorthand.
fn is_allowed_remote_url(url: &str) -> bool {
    let u = url.trim();
    if u.is_empty() {
        return false;
    }
    // Reject the transport-helper form `<helper>::<address>` (e.g. `ext::sh -c`).
    // A `::` before any `/` is the tell; real URLs use `://` or `host:path`.
    if let Some(dcolon) = u.find("::") {
        let before = &u[..dcolon];
        if !before.contains('/') {
            return false;
        }
    }
    if let Some(scheme_end) = u.find("://") {
        let scheme = u[..scheme_end].to_ascii_lowercase();
        return matches!(scheme.as_str(), "https" | "http" | "ssh" | "git");
    }
    // scp-like shorthand: `user@host:path` (no scheme). Require an `@` and a `:`.
    u.contains('@') && u.contains(':')
}

/// One-time hardening: strip any embedded credentials from existing `origin`
/// remotes across all projects. Earlier builds baked a token into the remote
/// URL (`https://x-access-token:TOKEN@github.com/...`), which persisted to
/// `.git/config` in cleartext. Auth now flows through the env-backed credential
/// helper, so a clean URL is sufficient. Best-effort; never fails startup.
pub fn scrub_remote_credentials() {
    let root = match paths::projects_root() {
        Ok(r) => r,
        Err(_) => return,
    };
    let entries = match std::fs::read_dir(&root) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.join(".git").exists() {
            continue;
        }
        let out = match run_git(&dir, &["remote", "get-url", "origin"]) {
            Ok(o) if o.status.success() => o,
            _ => continue,
        };
        let url = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let clean = sanitize_url(&url);
        if clean != url && !clean.is_empty() {
            let _ = run_git(&dir, &["remote", "set-url", "origin", &clean]);
        }
    }
}

/// Run a git command that may need GitHub auth, supplying the token via an
/// inline credential helper that reads it from the child process's environment.
///
/// The token is passed in `OPENLEAF_GH_TOKEN` (env), NOT embedded in the remote
/// URL or any argument - so it never shows up in `ps`/argv and never lands in a
/// tracking ref or the reflog. The helper only runs for HTTPS remotes; SSH
/// remotes fall through to the user's SSH keys.
fn run_git_authed(
    root: &PathBuf,
    token: &str,
    args: &[&str],
) -> Result<std::process::Output, String> {
    // `!f() { ... }; f` is git's inline shell-helper form. It prints credentials
    // only for a `get` request, reading the secret from the environment.
    let helper = "credential.helper=!f() { test \"$1\" = get && \
        printf 'username=x-access-token\\npassword=%s\\n' \"$OPENLEAF_GH_TOKEN\"; }; f";
    // `credential.helper` is multi-valued: helpers from the machine's config
    // (macOS keychain, a global `~/.gitconfig` helper, etc.) run BEFORE a helper
    // added with `-c`. A stale or different-account github.com credential cached
    // there would then win over our token and fail auth - which GitHub reports
    // as a misleading "Repository not found" (404). Reset the list with an empty
    // value FIRST so only our env-backed helper is consulted.
    let mut full: Vec<&str> = vec![
        "-c",
        "credential.helper=",
        "-c",
        helper,
        "-c",
        "credential.useHttpPath=false",
    ];
    full.extend_from_slice(args);
    Command::new("git")
        .args(&full)
        .current_dir(root)
        .env("OPENLEAF_GH_TOKEN", token)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))
}

#[tauri::command]
pub fn git_set_remote(project_id: String, url: String) -> Result<(), String> {
    if !is_allowed_remote_url(&url) {
        return Err(format!("unsupported remote URL: {url}"));
    }
    let root = ensure_repo(&project_id)?;
    let check = run_git(&root, &["remote", "get-url", "origin"])?;
    if check.status.success() {
        run_git(&root, &["remote", "set-url", "origin", &url])?;
    } else {
        run_git(&root, &["remote", "add", "origin", &url])?;
    }
    Ok(())
}

/// Remove the `origin` remote (unlink a project from GitHub).
#[tauri::command]
pub fn git_remove_remote(project_id: String) -> Result<(), String> {
    let root = ensure_repo(&project_id)?;
    let check = run_git(&root, &["remote", "get-url", "origin"])?;
    if check.status.success() {
        run_git(&root, &["remote", "remove", "origin"])?;
    }
    Ok(())
}

#[tauri::command]
pub fn git_get_remote(project_id: String) -> Result<Option<String>, String> {
    let root = project_root(&project_id)?;
    if !root.join(".git").exists() {
        return Ok(None);
    }
    let out = run_git(&root, &["remote", "get-url", "origin"])?;
    if out.status.success() {
        let s = sanitize_url(String::from_utf8_lossy(&out.stdout).trim());
        Ok(if s.is_empty() { None } else { Some(s) })
    } else {
        Ok(None)
    }
}

fn current_branch(root: &PathBuf) -> Result<String, String> {
    let out = run_git(root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let b = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Ok(if b.is_empty() || b == "HEAD" {
        "main".to_string()
    } else {
        b
    })
}

#[tauri::command]
pub fn git_current_branch(project_id: String) -> Result<String, String> {
    let root = ensure_repo(&project_id)?;
    current_branch(&root)
}

#[derive(Serialize)]
pub struct AheadBehind {
    pub ahead: u32,
    pub behind: u32,
    pub has_upstream: bool,
}

/// How many commits the local branch is ahead/behind `origin/<branch>` (based
/// on the locally-known remote-tracking ref; refreshes after a push or pull).
#[tauri::command]
pub fn git_ahead_behind(project_id: String) -> Result<AheadBehind, String> {
    let root = ensure_repo(&project_id)?;
    let branch = current_branch(&root)?;
    let upstream = format!("origin/{branch}");
    let has_upstream = run_git(&root, &["rev-parse", "--verify", &upstream])?
        .status
        .success();
    if !has_upstream {
        return Ok(AheadBehind {
            ahead: 0,
            behind: 0,
            has_upstream: false,
        });
    }
    let out = run_git(
        &root,
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("{upstream}...{branch}"),
        ],
    )?;
    if !out.status.success() {
        return Ok(AheadBehind {
            ahead: 0,
            behind: 0,
            has_upstream: false,
        });
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut parts = text.split_whitespace();
    // left = commits on upstream not in branch (behind); right = ahead.
    let behind: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let ahead: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    Ok(AheadBehind {
        ahead,
        behind,
        has_upstream: true,
    })
}

#[tauri::command]
pub async fn git_push(project_id: String) -> Result<String, String> {
    let root = ensure_repo(&project_id)?;
    let cfg = config::read_config()?;
    if cfg.github_token.is_empty() {
        return Err("No GitHub token set. Add one in Settings → GitHub.".into());
    }
    let remote_out = run_git(&root, &["remote", "get-url", "origin"])?;
    let remote = String::from_utf8_lossy(&remote_out.stdout)
        .trim()
        .to_string();
    if remote.is_empty() {
        return Err("No remote 'origin' set for this project.".into());
    }
    let branch = current_branch(&root)?;
    // Push to the named `origin` remote (credentials come from the env-backed
    // helper), so git updates the `origin/<branch>` tracking ref itself.
    let out = run_git_authed(&root, &cfg.github_token, &["push", "-u", "origin", &branch])?;
    if !out.status.success() {
        return Err(out_to_string(&out));
    }
    Ok(format!("Pushed to origin/{branch}"))
}

#[tauri::command]
pub async fn git_pull(project_id: String) -> Result<String, String> {
    let root = ensure_repo(&project_id)?;
    let cfg = config::read_config()?;
    let remote_out = run_git(&root, &["remote", "get-url", "origin"])?;
    let remote = String::from_utf8_lossy(&remote_out.stdout)
        .trim()
        .to_string();
    if remote.is_empty() {
        return Err("No remote 'origin' set for this project.".into());
    }
    let branch = current_branch(&root)?;
    // Pull from `origin` directly. With a token, auth comes from the env-backed
    // credential helper; without one, this still works for public repos (and
    // SSH remotes use the user's keys). Either way git updates the tracking ref.
    let pull_args = ["pull", "--no-rebase", "origin", branch.as_str()];
    let out = if cfg.github_token.is_empty() {
        run_git(&root, &pull_args)?
    } else {
        run_git_authed(&root, &cfg.github_token, &pull_args)?
    };
    if !out.status.success() {
        return Err(out_to_string(&out));
    }
    Ok(format!("Pulled origin/{branch}"))
}

// --- Working-tree inspection & changes (VS Code-style source control) ---

#[derive(Serialize)]
pub struct GitFileChange {
    pub path: String,
    /// Short status code: "M", "A", "D", "R", "??", etc.
    pub status: String,
    pub staged: bool,
}

#[tauri::command]
pub fn git_status(project_id: String) -> Result<Vec<GitFileChange>, String> {
    let root = ensure_repo(&project_id)?;
    let out = run_git(&root, &["status", "--porcelain"])?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut changes = Vec::new();
    for line in text.lines() {
        // Porcelain status codes (the first two columns) are always ASCII, so
        // index the bytes directly - avoids a panic on a multi-byte first char.
        let bytes = line.as_bytes();
        if bytes.len() < 3 {
            continue;
        }
        let x = bytes[0] as char;
        let y = bytes[1] as char;
        // porcelain "XY path" or "XY orig -> path"
        let rest = &line[3..];
        let path = rest.split(" -> ").last().unwrap_or(rest).trim().to_string();
        if path.is_empty() {
            continue;
        }
        let (code, staged) = if x == '?' || x == '!' {
            (x.to_string(), false)
        } else if x != ' ' {
            (x.to_string(), true)
        } else {
            (y.to_string(), false)
        };
        changes.push(GitFileChange {
            path,
            status: code,
            staged,
        });
    }
    Ok(changes)
}

#[tauri::command]
pub fn git_diff(project_id: String, path: Option<String>, staged: bool) -> Result<String, String> {
    let root = ensure_repo(&project_id)?;

    // Untracked files aren't shown by `git diff` (returns empty). Detect an
    // untracked path and synthesize a full-file addition diff via --no-index so
    // the viewer shows the whole file as additions (all green).
    if let Some(p) = &path {
        if !staged {
            let is_tracked = match run_git(&root, &["ls-files", "--error-unmatch", p.as_str()]) {
                Ok(o) => o.status.success(),
                Err(_) => false,
            };
            if !is_tracked {
                let devnull = if cfg!(windows) { "NUL" } else { "/dev/null" };
                let out = run_git(&root, &["diff", "--no-index", "--", devnull, p.as_str()])?;
                return Ok(String::from_utf8_lossy(&out.stdout).to_string());
            }
        }
    }

    let out = match (staged, &path) {
        (false, None) => run_git(&root, &["diff"]),
        (true, None) => run_git(&root, &["diff", "--cached"]),
        (false, Some(p)) => run_git(&root, &["diff", "--", p.as_str()]),
        (true, Some(p)) => run_git(&root, &["diff", "--cached", "--", p.as_str()]),
    }?;
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
pub fn git_discard(project_id: String, path: String) -> Result<(), String> {
    let root = ensure_repo(&project_id)?;
    run_git(&root, &["checkout", "--", &path])?;
    Ok(())
}

#[tauri::command]
pub fn git_head_oid(project_id: String) -> Result<Option<String>, String> {
    let root = project_root(&project_id)?;
    if !root.join(".git").exists() {
        return Ok(None);
    }
    let out = run_git(&root, &["rev-parse", "HEAD"])?;
    if !out.status.success() {
        return Ok(None);
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Ok(if s.is_empty() { None } else { Some(s) })
}

#[cfg(test)]
mod tests {
    use super::{is_allowed_remote_url, sanitize_url};

    #[test]
    fn blocks_transport_helpers_and_bad_schemes() {
        assert!(!is_allowed_remote_url("ext::sh -c 'touch /tmp/pwned'"));
        assert!(!is_allowed_remote_url("fd::17/foo"));
        assert!(!is_allowed_remote_url("file:///etc/passwd"));
        assert!(!is_allowed_remote_url(""));
        assert!(!is_allowed_remote_url("   "));
    }

    #[test]
    fn allows_normal_remotes() {
        assert!(is_allowed_remote_url("https://github.com/u/repo.git"));
        assert!(is_allowed_remote_url("http://example.com/u/repo.git"));
        assert!(is_allowed_remote_url("ssh://git@github.com/u/repo.git"));
        assert!(is_allowed_remote_url("git@github.com:u/repo.git"));
    }

    #[test]
    fn sanitize_strips_credentials() {
        assert_eq!(
            sanitize_url("https://x-access-token:ghp_secret@github.com/u/repo.git"),
            "https://github.com/u/repo.git"
        );
        assert_eq!(
            sanitize_url("https://github.com/u/repo.git"),
            "https://github.com/u/repo.git"
        );
    }
}
