use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;

use crate::config;
use crate::paths;
use crate::proc::NoConsole;

fn project_root(project_id: &str) -> Result<PathBuf, String> {
    paths::project_dir(project_id)
}

fn run_git(root: &PathBuf, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .no_console()
        .args(args)
        .current_dir(root)
        // A caller invoked from inside a git hook (e.g. this crate's own
        // pre-commit test run) inherits GIT_DIR/GIT_INDEX_FILE/GIT_WORK_TREE
        // from the hook's git process. Without clearing them, every `git`
        // subprocess spawned here targets the hook's repository instead of
        // `root`, regardless of `current_dir` - which let a test's throwaway
        // repo operations land on the real repository during `cargo test`.
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
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
        std::fs::write(root.join(".gitignore"), ".oleafly/\n").map_err(|e| e.to_string())?;
        let email = run_git(&root, &["config", "user.email"])?;
        if String::from_utf8_lossy(&email.stdout).trim().is_empty() {
            let _ = run_git(&root, &["config", "user.email", "oleafly@local"]);
            let _ = run_git(&root, &["config", "user.name", "Oleafly"]);
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
pub async fn git_auto_commit(project_id: String, message: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        let root = ensure_repo(&project_id)?;
        run_git(&root, &["add", "-A"])?;
        let out = run_git(&root, &["commit", "--quiet", "-m", &message])?;
        Ok(out.status.success())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Build the auto-commit message from the changed paths: "Update: a.tex, b.bib",
/// capped so a big import doesn't produce a novel of a subject line.
fn update_message(paths: &[String]) -> String {
    const MAX_LISTED: usize = 5;
    let listed = paths
        .iter()
        .take(MAX_LISTED)
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(", ");
    if paths.len() > MAX_LISTED {
        format!("Update: {listed} +{} more", paths.len() - MAX_LISTED)
    } else {
        format!("Update: {listed}")
    }
}

/// Commit everything outstanding under a generated "Update: <files>" message.
/// Returns false when the tree is clean.
fn auto_commit_update_in(root: &PathBuf) -> Result<bool, String> {
    let out = run_git(root, &["status", "--porcelain"])?;
    let changed = parse_status_porcelain(&String::from_utf8_lossy(&out.stdout));
    if changed.is_empty() {
        return Ok(false);
    }
    let paths: Vec<String> = changed.into_iter().map(|c| c.path).collect();
    let message = update_message(&paths);
    run_git(root, &["add", "-A"])?;
    let out = run_git(root, &["commit", "--quiet", "-m", &message])?;
    Ok(out.status.success())
}

#[tauri::command]
pub async fn git_auto_commit_update(project_id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        // A background convenience must never resurrect a deleted project:
        // project_dir() creates missing dirs, so check existence first and
        // treat a gone project as a silent no-op (a debounced commit can
        // legitimately fire after the user deleted the project).
        paths::validate_project_id(&project_id)?;
        if !paths::projects_root()?.join(&project_id).is_dir() {
            return Ok(false);
        }
        let root = ensure_repo(&project_id)?;
        auto_commit_update_in(&root)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn version_labels_path(project_id: &str) -> Result<PathBuf, String> {
    Ok(project_root(project_id)?
        .join(".oleafly")
        .join("version-labels.json"))
}

fn read_version_labels_at(path: &PathBuf) -> Result<HashMap<String, String>, String> {
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(serde_json::from_str(&text).unwrap_or_default())
}

#[tauri::command]
pub async fn git_read_version_labels(
    project_id: String,
) -> Result<HashMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<HashMap<String, String>, String> {
        read_version_labels_at(&version_labels_path(&project_id)?)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_set_version_label(
    project_id: String,
    oid: String,
    label: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let path = version_labels_path(&project_id)?;
        let mut labels = read_version_labels_at(&path)?;
        if label.trim().is_empty() {
            labels.remove(&oid);
        } else {
            labels.insert(oid, label);
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(&labels).map_err(|e| e.to_string())?;
        std::fs::write(&path, json).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_log(project_id: String) -> Result<Vec<GitCommit>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<GitCommit>, String> {
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
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_restore(project_id: String, oid: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let root = ensure_repo(&project_id)?;
        run_git(&root, &["checkout", &oid, "--", "."])?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

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
/// The token is passed in `OLEAFLY_GH_TOKEN` (env), NOT embedded in the remote
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
        printf 'username=x-access-token\\npassword=%s\\n' \"$OLEAFLY_GH_TOKEN\"; }; f";
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
        .no_console()
        .args(&full)
        .current_dir(root)
        .env("OLEAFLY_GH_TOKEN", token)
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
pub async fn git_ahead_behind(project_id: String) -> Result<AheadBehind, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<AheadBehind, String> {
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
    })
    .await
    .map_err(|e| e.to_string())?
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

#[derive(Serialize)]
pub struct GitFileChange {
    pub path: String,
    /// Short status code: "M", "A", "D", "R", "??", etc.
    pub status: String,
    pub staged: bool,
}

/// Parse `git status --porcelain` output into structured changes. Pure (no repo
/// or process needed), so the status/staged classification is unit-testable.
fn parse_status_porcelain(text: &str) -> Vec<GitFileChange> {
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
    changes
}

#[tauri::command]
pub async fn git_status(project_id: String) -> Result<Vec<GitFileChange>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<GitFileChange>, String> {
        let root = ensure_repo(&project_id)?;
        let out = run_git(&root, &["status", "--porcelain"])?;
        let text = String::from_utf8_lossy(&out.stdout);
        Ok(parse_status_porcelain(&text))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_diff(
    project_id: String,
    path: Option<String>,
    staged: bool,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let root = ensure_repo(&project_id)?;

        // Untracked files aren't shown by `git diff` (returns empty). Detect an
        // untracked path and synthesize a full-file addition diff via --no-index so
        // the viewer shows the whole file as additions (all green).
        if let Some(p) = &path {
            if !staged {
                let is_tracked = match run_git(&root, &["ls-files", "--error-unmatch", p.as_str()])
                {
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
    })
    .await
    .map_err(|e| e.to_string())?
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

/// Whether the repo has a HEAD commit yet (false on a fresh repo).
fn has_head(root: &PathBuf) -> bool {
    run_git(root, &["rev-parse", "--verify", "--quiet", "HEAD"])
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Whether the index holds anything different from HEAD (i.e. staged changes).
fn has_staged_changes(root: &PathBuf) -> bool {
    if has_head(root) {
        // `diff --cached --quiet` exits non-zero when there ARE staged changes.
        run_git(root, &["diff", "--cached", "--quiet"])
            .map(|o| !o.status.success())
            .unwrap_or(false)
    } else {
        // No commit yet: any entry in the index counts as staged.
        run_git(root, &["ls-files", "--cached"])
            .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
            .unwrap_or(false)
    }
}

fn ok_or_err(out: std::process::Output) -> Result<(), String> {
    if out.status.success() {
        Ok(())
    } else {
        Err(out_to_string(&out))
    }
}

fn stage(root: &PathBuf, path: &str) -> Result<(), String> {
    ok_or_err(run_git(root, &["add", "--", path])?)
}

fn unstage(root: &PathBuf, path: &str) -> Result<(), String> {
    // With a HEAD, reset the path back to HEAD in the index. Without one (initial
    // commit), there's nothing to reset to, so drop it from the index instead.
    let out = if has_head(root) {
        run_git(root, &["reset", "-q", "HEAD", "--", path])?
    } else {
        run_git(
            root,
            &["rm", "--cached", "-q", "--ignore-unmatch", "--", path],
        )?
    };
    ok_or_err(out)
}

fn stage_all(root: &PathBuf) -> Result<(), String> {
    ok_or_err(run_git(root, &["add", "-A"])?)
}

fn unstage_all(root: &PathBuf) -> Result<(), String> {
    let out = if has_head(root) {
        run_git(root, &["reset", "-q", "HEAD", "--", "."])?
    } else {
        run_git(
            root,
            &["rm", "-r", "--cached", "-q", "--ignore-unmatch", "--", "."],
        )?
    };
    ok_or_err(out)
}

/// Commit the staged index only. Returns false (no-op) when nothing is staged.
fn commit_index(root: &PathBuf, message: &str) -> Result<bool, String> {
    if !has_staged_changes(root) {
        return Ok(false);
    }
    let out = run_git(root, &["commit", "--quiet", "-m", message])?;
    if out.status.success() {
        Ok(true)
    } else {
        Err(out_to_string(&out))
    }
}

/// Content of `path` at a revision: `rev = "HEAD"` for the last commit, `"INDEX"`
/// for the staged version. Missing in that revision (added/deleted/untracked)
/// yields an empty string rather than an error.
fn show(root: &PathBuf, rev: &str, path: &str) -> Result<String, String> {
    let object = if rev == "INDEX" {
        format!(":{path}")
    } else {
        format!("{rev}:{path}")
    };
    let out = run_git(root, &["show", &object])?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
pub async fn git_stage(project_id: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let root = ensure_repo(&project_id)?;
        stage(&root, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_unstage(project_id: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let root = ensure_repo(&project_id)?;
        unstage(&root, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_stage_all(project_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let root = ensure_repo(&project_id)?;
        stage_all(&root)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_unstage_all(project_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let root = ensure_repo(&project_id)?;
        unstage_all(&root)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_commit(project_id: String, message: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        let root = ensure_repo(&project_id)?;
        commit_index(&root, &message)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_show(project_id: String, rev: String, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let root = ensure_repo(&project_id)?;
        show(&root, &rev, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{
        auto_commit_update_in, commit_index, is_allowed_remote_url, parse_status_porcelain,
        read_version_labels_at, run_git, sanitize_url, show, stage, stage_all, unstage,
        unstage_all, update_message,
    };
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// Create a throwaway git repo in a temp dir with a fixed identity.
    fn temp_repo() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("oleafly-git-test-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        run_git(&dir, &["init", "--quiet"]).unwrap();
        run_git(&dir, &["symbolic-ref", "HEAD", "refs/heads/main"]).unwrap();
        run_git(&dir, &["config", "user.email", "t@t"]).unwrap();
        run_git(&dir, &["config", "user.name", "t"]).unwrap();
        dir
    }

    fn write(root: &Path, name: &str, content: &str) {
        std::fs::write(root.join(name), content).unwrap();
    }

    fn status(root: &PathBuf) -> Vec<super::GitFileChange> {
        let out = run_git(root, &["status", "--porcelain"]).unwrap();
        parse_status_porcelain(&String::from_utf8_lossy(&out.stdout))
    }

    #[test]
    fn stage_and_unstage_roundtrip_for_untracked() {
        let r = temp_repo();
        write(&r, "a.txt", "hi\n");
        assert!(!status(&r)[0].staged);
        stage(&r, "a.txt").unwrap();
        let s = status(&r);
        assert!(s[0].staged);
        assert_eq!(s[0].status, "A");
        // No HEAD yet: unstage must fall back to `rm --cached`.
        unstage(&r, "a.txt").unwrap();
        let s = status(&r);
        assert!(!s[0].staged);
        assert_eq!(s[0].status, "?");
    }

    #[test]
    fn update_message_lists_files_and_caps() {
        let p = |s: &str| s.to_string();
        assert_eq!(update_message(&[p("main.tex")]), "Update: main.tex");
        assert_eq!(
            update_message(&[p("a.tex"), p("b.bib")]),
            "Update: a.tex, b.bib"
        );
        let many: Vec<String> = (0..7).map(|i| format!("f{i}.tex")).collect();
        assert_eq!(
            update_message(&many),
            "Update: f0.tex, f1.tex, f2.tex, f3.tex, f4.tex +2 more"
        );
    }

    #[test]
    fn auto_commit_update_commits_everything_and_noops_when_clean() {
        let r = temp_repo();
        write(&r, "main.tex", "hello\n");
        write(&r, "refs.bib", "@misc{x}\n");
        assert!(auto_commit_update_in(&r).unwrap());
        assert!(status(&r).is_empty());
        let out = run_git(&r, &["log", "--format=%s", "-1"]).unwrap();
        assert_eq!(
            String::from_utf8_lossy(&out.stdout).trim(),
            "Update: main.tex, refs.bib"
        );
        // Clean tree: a second call is a no-op returning false.
        assert!(!auto_commit_update_in(&r).unwrap());
    }

    #[test]
    fn commit_index_commits_only_staged_files() {
        let r = temp_repo();
        write(&r, "a.txt", "one\n");
        write(&r, "b.txt", "two\n");
        stage(&r, "a.txt").unwrap(); // b.txt left unstaged
        assert!(commit_index(&r, "first").unwrap());
        let s = status(&r);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].path, "b.txt");
        // Nothing staged now -> commit is a no-op returning false.
        assert!(!commit_index(&r, "noop").unwrap());
    }

    #[test]
    fn show_reads_head_index_and_empty_for_missing() {
        let r = temp_repo();
        write(&r, "a.txt", "v1\n");
        stage(&r, "a.txt").unwrap();
        commit_index(&r, "c1").unwrap();
        write(&r, "a.txt", "v2\n");
        stage(&r, "a.txt").unwrap(); // index = v2
        write(&r, "a.txt", "v3\n"); // worktree = v3, index = v2, HEAD = v1
        assert_eq!(show(&r, "HEAD", "a.txt").unwrap(), "v1\n");
        assert_eq!(show(&r, "INDEX", "a.txt").unwrap(), "v2\n");
        assert_eq!(show(&r, "HEAD", "missing.txt").unwrap(), "");
    }

    #[test]
    fn stage_all_and_unstage_all_toggle_every_file() {
        let r = temp_repo();
        write(&r, "a.txt", "a\n");
        write(&r, "b.txt", "b\n");
        stage_all(&r).unwrap();
        assert!(status(&r).iter().all(|c| c.staged));
        unstage_all(&r).unwrap();
        assert!(status(&r).iter().all(|c| !c.staged));
    }

    #[test]
    fn porcelain_classifies_staged_vs_unstaged() {
        let out = " M work.tex\nM  staged.tex\nMM both.tex\nA  added.tex\n?? new.tex";
        let c = parse_status_porcelain(out);
        assert_eq!(c.len(), 5);
        // " M" = modified in working tree only (unstaged)
        assert_eq!(c[0].path, "work.tex");
        assert_eq!(c[0].status, "M");
        assert!(!c[0].staged);
        // "M " = staged modification
        assert_eq!(c[1].status, "M");
        assert!(c[1].staged);
        // "MM" = staged + unstaged; the staged (index) side wins
        assert!(c[2].staged);
        // "A " = staged add
        assert_eq!(c[3].status, "A");
        assert!(c[3].staged);
        // "??" = untracked, never staged
        assert_eq!(c[4].path, "new.tex");
        assert_eq!(c[4].status, "?");
        assert!(!c[4].staged);
    }

    #[test]
    fn porcelain_uses_the_destination_of_a_rename() {
        let c = parse_status_porcelain("R  old/a.tex -> new/b.tex");
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].path, "new/b.tex");
        assert_eq!(c[0].status, "R");
        assert!(c[0].staged);
    }

    #[test]
    fn porcelain_skips_blank_and_short_lines() {
        assert!(parse_status_porcelain("\n\nx").is_empty());
    }

    #[test]
    fn version_labels_missing_file_reads_as_empty() {
        let path = temp_repo().join("no-such-file.json");
        assert!(read_version_labels_at(&path).unwrap().is_empty());
    }

    #[test]
    fn version_labels_round_trip_through_json() {
        let path = temp_repo().join(".oleafly").join("version-labels.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut labels = std::collections::HashMap::new();
        labels.insert("abc123".to_string(), "Submission draft".to_string());
        std::fs::write(&path, serde_json::to_string_pretty(&labels).unwrap()).unwrap();
        let back = read_version_labels_at(&path).unwrap();
        assert_eq!(back.get("abc123").unwrap(), "Submission draft");
    }

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
