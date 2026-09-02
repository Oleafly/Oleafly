use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

use crate::config;
use crate::paths;
use crate::proc::{output_contained, NoConsole};

fn project_root(project_id: &str) -> Result<PathBuf, String> {
    paths::project_dir(project_id)
}

fn run_git(root: &PathBuf, args: &[&str]) -> Result<std::process::Output, String> {
    run_git_with_optional_locks(root, args, true)
}

/// Run an observational Git command without letting Git refresh the index or
/// take optional repository locks. Background UI refreshes must not mutate a
/// user's repository merely by looking at it.
fn run_git_read_only(root: &PathBuf, args: &[&str]) -> Result<std::process::Output, String> {
    run_git_with_optional_locks(root, args, false)
}

fn run_git_with_optional_locks(
    root: &PathBuf,
    args: &[&str],
    optional_locks: bool,
) -> Result<std::process::Output, String> {
    let mut command = Command::new("git");
    command
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
        .env("GIT_OPTIONAL_LOCKS", if optional_locks { "1" } else { "0" });
    output_contained(&mut command).map_err(|e| format!("failed to run git: {e}"))
}

fn ensure_git_identity(root: &PathBuf) -> Result<(), String> {
    let email = run_git(root, &["config", "user.email"])?;
    if String::from_utf8_lossy(&email.stdout).trim().is_empty() {
        ok_or_err(run_git(root, &["config", "user.email", "oleafly@local"])?)?;
        ok_or_err(run_git(root, &["config", "user.name", "Oleafly"])?)?;
    }
    Ok(())
}

fn default_branch(root: &PathBuf) -> String {
    let configured = run_git(root, &["config", "--get", "init.defaultBranch"])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|branch| !branch.is_empty());

    configured
        .filter(|branch| {
            run_git(root, &["check-ref-format", "--branch", branch])
                .is_ok_and(|output| output.status.success())
        })
        .unwrap_or_else(|| "main".to_string())
}

fn initialize_repo(root: &PathBuf, branch: &str) -> Result<(), String> {
    ok_or_err(run_git(
        root,
        &["init", "--quiet", "--initial-branch", branch],
    )?)?;
    ensure_git_identity(root)?;
    ensure_private_exclude(root)
}

fn ensure_private_exclude(root: &PathBuf) -> Result<(), String> {
    let output = run_git_read_only(root, &["rev-parse", "--git-path", "info/exclude"])?;
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    ok_or_err(output)?;
    if value.is_empty() {
        return Err("Git did not return its repository exclude path".into());
    }
    let path = PathBuf::from(value);
    let exclude = if path.is_absolute() {
        path
    } else {
        root.join(path)
    };
    if let Some(parent) = exclude.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("could not prepare repository excludes: {error}"))?;
    }
    if let Ok(metadata) = std::fs::symlink_metadata(&exclude) {
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("repository exclude path is not a regular file".into());
        }
    }
    let current = std::fs::read_to_string(&exclude).unwrap_or_default();
    if !current.lines().any(|line| line.trim() == ".oleafly/") {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&exclude)
            .map_err(|error| format!("could not update repository excludes: {error}"))?;
        if !current.is_empty() && !current.ends_with('\n') {
            writeln!(file).map_err(|error| error.to_string())?;
        }
        writeln!(file, ".oleafly/").map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn existing_repo(project_id: &str) -> Result<PathBuf, String> {
    let root = project_root(project_id)?;
    if !root.join(".git").exists() {
        return Err("Git repository is not initialized. Initialize Source Control first.".into());
    }
    Ok(root)
}

fn initialized_repo(project_id: &str) -> Result<Option<PathBuf>, String> {
    let root = project_root(project_id)?;
    Ok(root.join(".git").exists().then_some(root))
}

#[derive(Serialize)]
pub struct GitCommit {
    pub oid: String,
    pub short: String,
    pub time: f64,
    pub message: String,
}

#[tauri::command]
pub async fn git_is_initialized(project_id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || git_is_initialized_sync(project_id))
        .await
        .map_err(|error| error.to_string())?
}

fn git_is_initialized_sync(project_id: String) -> Result<bool, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
    Ok(initialized_repo(&project_id)?.is_some())
}

/// Initialize Source Control only in response to a direct user action.
#[tauri::command]
pub async fn git_initialize(project_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_initialize_sync(project_id))
        .await
        .map_err(|error| error.to_string())?
}

fn git_initialize_sync(project_id: String) -> Result<String, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
    let root = project_root(&project_id)?;
    if !root.join(".git").exists() {
        let branch = default_branch(&root);
        initialize_repo(&root, &branch)?;
    }
    current_branch(&root)
}

/// Prepare the project for the explicit Publish to GitHub action. This is the
/// sole convenience that initializes and commits all files in one operation;
/// background save, compile, and assistant flows never call it.
#[tauri::command]
pub async fn git_prepare_publish(project_id: String, message: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
        let root = project_root(&project_id)?;
        if !root.join(".git").exists() {
            let branch = default_branch(&root);
            initialize_repo(&root, &branch)?;
        }
        stage_all(&root)?;
        commit_index(&root, &message)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_log(project_id: String) -> Result<Vec<GitCommit>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<GitCommit>, String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
        let Some(root) = initialized_repo(&project_id)? else {
            return Ok(Vec::new());
        };
        let out = run_git_read_only(&root, &["log", "--pretty=format:%H%x09%h%x09%ct%x09%s"])?;
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
pub async fn git_restore(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    oid: String,
    expected_generation: Option<u64>,
) -> Result<crate::project::ProjectStateChanged, String> {
    validate_git_oid(&oid)?;
    let operation_id = project_id.clone();
    let mutation = crate::project::mutate_project_worktree(
        &state,
        project_id.clone(),
        expected_generation,
        move |_| {
            let root = existing_repo(&operation_id)?;
            restore_worktree(&root, &oid)?;
            Ok(((), true))
        },
    )
    .await?;
    let outcome = mutation.value;
    let event = crate::project::publish_project_state_changed(
        &app,
        &state,
        &project_id,
        mutation.project,
        "git-restore",
        true,
        Some(mutation.generation),
    );
    outcome?;
    event
}

fn validate_git_oid(oid: &str) -> Result<(), String> {
    if (4..=64).contains(&oid.len()) && oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("invalid Git commit id".into())
    }
}

fn restore_worktree(root: &PathBuf, oid: &str) -> Result<(), String> {
    validate_git_oid(oid)?;
    // Make the index and working tree exactly match the checkpoint without
    // moving HEAD: restore modified files, bring back deleted ones, AND remove
    // files created after the checkpoint. `checkout <oid> -- .` only touched
    // paths present in <oid>, so files a later response added were left behind
    // and "restore to before this response" did not actually undo them. A later
    // user-authored commit can record the restored state without moving HEAD.
    ok_or_err(run_git(root, &["read-tree", "--reset", "-u", oid])?)
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
        if !scheme.eq_ignore_ascii_case("http://") && !scheme.eq_ignore_ascii_case("https://") {
            return u.to_string();
        }
        let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
        let (authority, suffix) = rest.split_at(authority_end);
        if let Some(at) = authority.rfind('@') {
            return format!("{scheme}{}{suffix}", &authority[at + 1..]);
        }
    }
    u.to_string()
}

fn origin_url(root: &PathBuf) -> Result<Option<String>, String> {
    let output = run_git_read_only(root, &["remote", "get-url", "origin"])?;
    if !output.status.success() {
        return Ok(None);
    }
    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok((!url.is_empty()).then_some(url))
}

fn remote_credentials_need_cleanup(root: &PathBuf) -> Result<bool, String> {
    Ok(origin_url(root)?.is_some_and(|url| sanitize_url(&url) != url))
}

fn clean_remote_credentials(root: &PathBuf) -> Result<bool, String> {
    let Some(url) = origin_url(root)? else {
        return Ok(false);
    };
    let clean = sanitize_url(&url);
    if clean == url {
        return Ok(false);
    }
    if clean.is_empty() || !is_allowed_remote_url(&clean) {
        return Err("The saved Git remote could not be cleaned safely.".into());
    }
    ok_or_err(run_git(root, &["remote", "set-url", "origin", &clean])?)?;
    Ok(true)
}

#[tauri::command]
pub async fn git_remote_credentials_need_cleanup(project_id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_remote_credentials_need_cleanup_sync(project_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn git_remote_credentials_need_cleanup_sync(project_id: String) -> Result<bool, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
    let Some(root) = initialized_repo(&project_id)? else {
        return Ok(false);
    };
    remote_credentials_need_cleanup(&root)
}

/// Removes cleartext credentials left in origin URLs by older Oleafly builds.
/// This writes Git config only after the user chooses the repair action.
#[tauri::command]
pub async fn git_clean_remote_credentials(project_id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || git_clean_remote_credentials_sync(project_id))
        .await
        .map_err(|error| error.to_string())?
}

fn git_clean_remote_credentials_sync(project_id: String) -> Result<bool, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
    let root = existing_repo(&project_id)?;
    clean_remote_credentials(&root)
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
    let mut command = Command::new("git");
    command
        .no_console()
        .args(&full)
        .current_dir(root)
        .env("OLEAFLY_GH_TOKEN", token)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE");
    output_contained(&mut command).map_err(|e| format!("failed to run git: {e}"))
}

/// Attach the authenticated repository history to content imported through the
/// guarded archive path. Resetting only the index keeps the archive import's
/// path and symlink protections intact while placing the worktree on top of the
/// real remote history. The caller must hold the imported project's exclusive
/// worktree lock for the full archive-import transaction.
pub(crate) fn attach_imported_repository_history_lock_held(
    project_id: &str,
    remote_url: &str,
    default_branch: &str,
    token: &str,
) -> Result<(), String> {
    if !is_allowed_remote_url(remote_url) {
        return Err("GitHub returned an unsupported repository URL.".into());
    }
    let root = project_root(project_id)?;
    attach_imported_repository_history_at(&root, remote_url, default_branch, |root, refspec| {
        ok_or_err(run_git_authed(
            root,
            token,
            &["fetch", "--no-tags", "origin", refspec],
        )?)
    })
}

fn attach_imported_repository_history_at<F>(
    root: &PathBuf,
    remote_url: &str,
    default_branch: &str,
    fetch: F,
) -> Result<(), String>
where
    F: FnOnce(&PathBuf, &str) -> Result<(), String>,
{
    if root.join(".git").exists() {
        return Err("The imported project already has repository history.".into());
    }

    let local_ref = format!("refs/heads/{default_branch}");
    let remote_ref = format!("refs/remotes/origin/{default_branch}");
    let refspec = format!("+refs/heads/{default_branch}:{remote_ref}");
    if !run_git(root, &["check-ref-format", &local_ref])?
        .status
        .success()
    {
        return Err("GitHub returned an invalid default branch.".into());
    }

    ok_or_err(run_git(root, &["init", "--quiet"])?)?;
    let result = (|| -> Result<(), String> {
        ensure_git_identity(root)?;
        ok_or_err(run_git(root, &["remote", "add", "origin", remote_url])?)?;
        fetch(root, &refspec)?;
        ok_or_err(run_git(root, &["symbolic-ref", "HEAD", &local_ref])?)?;
        ok_or_err(run_git(root, &["reset", "--mixed", &remote_ref, "--"])?)?;
        let upstream = format!("--set-upstream-to={remote_ref}");
        ok_or_err(run_git(root, &["branch", &upstream, "--", default_branch])?)?;

        ensure_private_exclude(root)?;

        // project.json and any archive-safety normalization become one local
        // commit above the imported branch, leaving future pulls mergeable.
        let status = run_git(root, &["status", "--porcelain"])?;
        if !status.stdout.is_empty() {
            ok_or_err(run_git(root, &["add", "-A"])?)?;
            ok_or_err(run_git(
                root,
                &["commit", "--quiet", "-m", "Prepare project for Oleafly"],
            )?)?;
        }
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_dir_all(root.join(".git"));
    }
    result
}

#[tauri::command]
pub async fn git_set_remote(project_id: String, url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git_set_remote_sync(project_id, url))
        .await
        .map_err(|error| error.to_string())?
}

fn git_set_remote_sync(project_id: String, url: String) -> Result<(), String> {
    if !is_allowed_remote_url(&url) {
        return Err(format!("unsupported remote URL: {url}"));
    }
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
    let root = existing_repo(&project_id)?;
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
pub async fn git_remove_remote(project_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git_remove_remote_sync(project_id))
        .await
        .map_err(|error| error.to_string())?
}

fn git_remove_remote_sync(project_id: String) -> Result<(), String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
    let root = existing_repo(&project_id)?;
    let check = run_git(&root, &["remote", "get-url", "origin"])?;
    if check.status.success() {
        run_git(&root, &["remote", "remove", "origin"])?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_get_remote(project_id: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || git_get_remote_sync(project_id))
        .await
        .map_err(|error| error.to_string())?
}

fn git_get_remote_sync(project_id: String) -> Result<Option<String>, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
    let Some(root) = initialized_repo(&project_id)? else {
        return Ok(None);
    };
    let out = run_git_read_only(&root, &["remote", "get-url", "origin"])?;
    if out.status.success() {
        let s = sanitize_url(String::from_utf8_lossy(&out.stdout).trim());
        Ok(if s.is_empty() { None } else { Some(s) })
    } else {
        Ok(None)
    }
}

fn current_branch(root: &PathBuf) -> Result<String, String> {
    let out = run_git_read_only(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
    let branch = String::from_utf8_lossy(&out.stdout).trim().to_string();
    ok_or_err(out)?;
    if branch.is_empty() {
        Err("The repository does not have a current branch.".to_string())
    } else {
        Ok(branch)
    }
}

#[tauri::command]
pub async fn git_current_branch(project_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_current_branch_sync(project_id))
        .await
        .map_err(|error| error.to_string())?
}

fn git_current_branch_sync(project_id: String) -> Result<String, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
    let root = existing_repo(&project_id)?;
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
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
        let Some(root) = initialized_repo(&project_id)? else {
            return Ok(AheadBehind {
                ahead: 0,
                behind: 0,
                has_upstream: false,
            });
        };
        let branch = current_branch(&root)?;
        let upstream = format!("origin/{branch}");
        let has_upstream = run_git_read_only(&root, &["rev-parse", "--verify", &upstream])?
            .status
            .success();
        if !has_upstream {
            return Ok(AheadBehind {
                ahead: 0,
                behind: 0,
                has_upstream: false,
            });
        }
        let out = run_git_read_only(
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
    tauri::async_runtime::spawn_blocking(move || git_push_sync(project_id))
        .await
        .map_err(|error| error.to_string())?
}

fn git_push_sync(project_id: String) -> Result<String, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
    let root = existing_repo(&project_id)?;
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
pub async fn git_pull(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    expected_generation: Option<u64>,
) -> Result<GitPullResult, String> {
    let cfg = config::read_config()?;
    let token = cfg.github_token;
    let operation_id = project_id.clone();
    let mutation = crate::project::mutate_project_worktree(
        &state,
        project_id.clone(),
        expected_generation,
        move |_| {
            let root = existing_repo(&operation_id)?;
            Ok((pull_origin(&root, &token)?, true))
        },
    )
    .await?;
    let outcome = mutation.value;
    let event = crate::project::publish_project_state_changed(
        &app,
        &state,
        &project_id,
        mutation.project,
        "git-pull",
        true,
        Some(mutation.generation),
    )?;
    Ok(GitPullResult {
        message: outcome?,
        state: event,
    })
}

fn pull_origin(root: &PathBuf, token: &str) -> Result<String, String> {
    let remote_out = run_git(root, &["remote", "get-url", "origin"])?;
    if String::from_utf8_lossy(&remote_out.stdout)
        .trim()
        .is_empty()
    {
        return Err("No remote 'origin' set for this project.".into());
    }
    let branch = current_branch(root)?;
    let pull_args = ["pull", "--no-rebase", "origin", branch.as_str()];
    let output = if token.is_empty() {
        run_git(root, &pull_args)?
    } else {
        run_git_authed(root, token, &pull_args)?
    };
    ok_or_err(output)?;
    Ok(format!("Pulled origin/{branch}"))
}

#[derive(Serialize)]
pub struct GitPullResult {
    pub message: String,
    pub state: crate::project::ProjectStateChanged,
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
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
        let Some(root) = initialized_repo(&project_id)? else {
            return Ok(Vec::new());
        };
        let out = run_git_read_only(&root, &["status", "--porcelain"])?;
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
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
        let Some(root) = initialized_repo(&project_id)? else {
            return Ok(String::new());
        };

        // Untracked files aren't shown by `git diff` (returns empty). Detect an
        // untracked path and synthesize a full-file addition diff via --no-index so
        // the viewer shows the whole file as additions (all green).
        if let Some(p) = &path {
            if !staged {
                let is_tracked =
                    match run_git_read_only(&root, &["ls-files", "--error-unmatch", p.as_str()]) {
                        Ok(o) => o.status.success(),
                        Err(_) => false,
                    };
                if !is_tracked {
                    let devnull = if cfg!(windows) { "NUL" } else { "/dev/null" };
                    let out = run_git_read_only(
                        &root,
                        &["diff", "--no-index", "--", devnull, p.as_str()],
                    )?;
                    return Ok(String::from_utf8_lossy(&out.stdout).to_string());
                }
            }
        }

        let out = match (staged, &path) {
            (false, None) => run_git_read_only(&root, &["diff"]),
            (true, None) => run_git_read_only(&root, &["diff", "--cached"]),
            (false, Some(p)) => run_git_read_only(&root, &["diff", "--", p.as_str()]),
            (true, Some(p)) => run_git_read_only(&root, &["diff", "--cached", "--", p.as_str()]),
        }?;
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_discard(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    path: String,
    expected_generation: Option<u64>,
) -> Result<crate::project::ProjectStateChanged, String> {
    let operation_id = project_id.clone();
    let mutation = crate::project::mutate_project_worktree(
        &state,
        project_id.clone(),
        expected_generation,
        move |_| {
            let root = existing_repo(&operation_id)?;
            ok_or_err(run_git(
                &root,
                &["--literal-pathspecs", "checkout", "--", &path],
            )?)?;
            Ok(((), true))
        },
    )
    .await?;
    let outcome = mutation.value;
    let event = crate::project::publish_project_state_changed(
        &app,
        &state,
        &project_id,
        mutation.project,
        "git-discard",
        true,
        Some(mutation.generation),
    );
    outcome?;
    event
}

#[tauri::command]
pub async fn git_head_oid(project_id: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || git_head_oid_sync(project_id))
        .await
        .map_err(|error| error.to_string())?
}

fn git_head_oid_sync(project_id: String) -> Result<Option<String>, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
    let Some(root) = initialized_repo(&project_id)? else {
        return Ok(None);
    };
    let out = run_git_read_only(&root, &["rev-parse", "HEAD"])?;
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
    ensure_private_exclude(root)?;
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
    ensure_private_exclude(root)?;
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
    let out = run_git_read_only(root, &["show", &object])?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
pub async fn git_stage(project_id: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
        let root = existing_repo(&project_id)?;
        stage(&root, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_unstage(project_id: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
        let root = existing_repo(&project_id)?;
        unstage(&root, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_stage_all(project_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
        let root = existing_repo(&project_id)?;
        stage_all(&root)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_unstage_all(project_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
        let root = existing_repo(&project_id)?;
        unstage_all(&root)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_commit(project_id: String, message: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
        let root = existing_repo(&project_id)?;
        commit_index(&root, &message)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_show(project_id: String, rev: String, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
        let Some(root) = initialized_repo(&project_id)? else {
            return Ok(String::new());
        };
        show(&root, &rev, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{
        attach_imported_repository_history_at, clean_remote_credentials, commit_index,
        current_branch, initialize_repo, is_allowed_remote_url, ok_or_err, parse_status_porcelain,
        remote_credentials_need_cleanup, restore_worktree, run_git, run_git_read_only,
        sanitize_url, show, stage, stage_all, unstage, unstage_all, validate_git_oid,
    };
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::mpsc;
    use std::time::Duration;

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// Create a throwaway git repo in a temp dir with a fixed identity.
    fn temp_repo() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("oleafly-git-test-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        run_git(&dir, &["init", "--quiet"]).unwrap();
        run_git(&dir, &["config", "core.autocrlf", "false"]).unwrap();
        run_git(&dir, &["symbolic-ref", "HEAD", "refs/heads/main"]).unwrap();
        run_git(&dir, &["config", "user.email", "t@t"]).unwrap();
        run_git(&dir, &["config", "user.name", "t"]).unwrap();
        dir
    }

    fn temp_dir(label: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "oleafly-git-{label}-test-{}-{n}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(root: &Path, name: &str, content: &str) {
        std::fs::write(root.join(name), content).unwrap();
    }

    #[test]
    fn initialized_repository_uses_the_selected_default_branch() {
        let root = temp_dir("default-branch");
        initialize_repo(&root, "trunk").unwrap();

        assert_eq!(current_branch(&root).unwrap(), "trunk");
        assert!(
            std::fs::read_to_string(root.join(".git/info/exclude"))
                .unwrap()
                .lines()
                .any(|line| line == ".oleafly/"),
            "Oleafly's private build directory belongs in the repository-local exclude file"
        );
        assert!(
            !root.join(".gitignore").exists(),
            "initializing Source Control must not add a project file"
        );
    }

    #[test]
    fn observing_an_uninitialized_project_does_not_create_a_repository() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let previous_data_dir = std::env::var_os("OLEAFLY_DATA_DIR");
        let data = temp_dir("observe-uninitialized");
        let project_id = "plain-project";
        std::fs::create_dir_all(data.join("projects").join(project_id)).unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", &data);

        let branch = super::git_current_branch_sync(project_id.to_string());
        let repository_was_created = data.join("projects").join(project_id).join(".git").exists();

        if let Some(previous) = previous_data_dir {
            std::env::set_var("OLEAFLY_DATA_DIR", previous);
        } else {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }
        assert!(
            branch.is_err(),
            "an uninitialized project has no Git branch"
        );
        assert!(
            !repository_was_created,
            "observing Source Control must not initialize Git"
        );
    }

    #[test]
    fn pushing_reads_the_worktree_and_never_takes_the_exclusive_lock() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let previous_data_dir = std::env::var_os("OLEAFLY_DATA_DIR");
        let data = temp_dir("push-shared-worktree");
        let project_id = "plain-project";
        std::fs::create_dir_all(data.join("projects").join(project_id)).unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", &data);

        let reader = crate::worktree_lock::ProjectWorktreeLock::shared(project_id).unwrap();
        let (finished_tx, finished_rx) = mpsc::channel();
        let pusher = std::thread::spawn(move || {
            let result = tokio::runtime::Builder::new_current_thread()
                .build()
                .unwrap()
                .block_on(super::git_push(project_id.to_string()));
            let _ = finished_tx.send(());
            result
        });
        let finished = finished_rx.recv_timeout(Duration::from_secs(5)).is_ok();
        drop(reader);
        let result = pusher.join().unwrap();

        if let Some(previous) = previous_data_dir {
            std::env::set_var("OLEAFLY_DATA_DIR", previous);
        } else {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }
        assert!(
            finished,
            "pushing waited for the exclusive worktree lock a reader already held"
        );
        assert!(result.is_err(), "an uninitialized project cannot be pushed");
    }

    #[tokio::test(flavor = "current_thread")]
    #[allow(clippy::await_holding_lock)]
    async fn every_background_git_observation_is_neutral_for_an_uninitialized_project() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let previous_data_dir = std::env::var_os("OLEAFLY_DATA_DIR");
        let data = temp_dir("observe-all-uninitialized");
        let project_id = "plain-project";
        let project = data.join("projects").join(project_id);
        std::fs::create_dir_all(&project).unwrap();
        write(&project, "main.tex", "unchanged\n");
        std::env::set_var("OLEAFLY_DATA_DIR", &data);

        let branch = super::git_current_branch_sync(project_id.to_string());
        let log = super::git_log(project_id.to_string()).await.unwrap();
        let status = super::git_status(project_id.to_string()).await.unwrap();
        let diff = super::git_diff(project_id.to_string(), None, false)
            .await
            .unwrap();
        let ahead_behind = super::git_ahead_behind(project_id.to_string())
            .await
            .unwrap();
        let shown = super::git_show(
            project_id.to_string(),
            "HEAD".to_string(),
            "main.tex".to_string(),
        )
        .await
        .unwrap();
        let repository_was_created = project.join(".git").exists();
        let source = std::fs::read_to_string(project.join("main.tex")).unwrap();

        if let Some(previous) = previous_data_dir {
            std::env::set_var("OLEAFLY_DATA_DIR", previous);
        } else {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }

        assert!(branch.is_err());
        assert!(log.is_empty());
        assert!(status.is_empty());
        assert!(diff.is_empty());
        assert!(!ahead_behind.has_upstream);
        assert!(shown.is_empty());
        assert!(!repository_was_created);
        assert_eq!(source, "unchanged\n");
    }

    #[test]
    fn background_status_does_not_refresh_the_git_index() {
        let root = temp_repo();
        write(&root, "main.tex", "unchanged\n");
        stage_all(&root).unwrap();
        assert!(commit_index(&root, "initial").unwrap());

        // Rewriting identical bytes changes filesystem metadata. A regular
        // `git status` may refresh that stat cache in the index; the background
        // runner must keep the repository byte-for-byte untouched.
        write(&root, "main.tex", "unchanged\n");
        let index = root.join(".git").join("index");
        let before = std::fs::read(&index).unwrap();

        let output = run_git_read_only(&root, &["status", "--porcelain"]).unwrap();
        assert!(output.status.success());

        assert_eq!(std::fs::read(index).unwrap(), before);
    }

    #[test]
    fn current_branch_reports_the_repository_branch_after_a_rename() {
        let root = temp_repo();
        run_git(&root, &["branch", "--move", "topic/reader-view"]).unwrap();

        assert_eq!(current_branch(&root).unwrap(), "topic/reader-view");
    }

    #[test]
    fn commit_ids_accept_hex_and_reject_revision_syntax() {
        assert!(validate_git_oid("a1b2").is_ok());
        assert!(validate_git_oid(&"f".repeat(64)).is_ok());
        for invalid in ["abc", "HEAD", "abcd^", "abcd:path", "../abcd"] {
            assert!(validate_git_oid(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn restore_replaces_tracked_content_without_interpreting_revision_syntax() {
        let root = temp_repo();
        write(&root, "main.tex", "first\n");
        stage_all(&root).unwrap();
        assert!(commit_index(&root, "first").unwrap());
        let first =
            String::from_utf8_lossy(&run_git(&root, &["rev-parse", "HEAD"]).unwrap().stdout)
                .trim()
                .to_string();
        write(&root, "main.tex", "second\n");
        restore_worktree(&root, &first).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("main.tex")).unwrap(),
            "first\n"
        );
    }

    #[test]
    fn restore_removes_files_added_after_the_checkpoint_and_brings_back_deleted_ones() {
        let root = temp_repo();
        write(&root, "keep.tex", "base\n");
        write(&root, "removed-later.tex", "here at checkpoint\n");
        stage_all(&root).unwrap();
        assert!(commit_index(&root, "checkpoint").unwrap());
        let checkpoint =
            String::from_utf8_lossy(&run_git(&root, &["rev-parse", "HEAD"]).unwrap().stdout)
                .trim()
                .to_string();

        // A later explicit commit adds a file, deletes one, and modifies one.
        write(&root, "added-later.tex", "created by the response\n");
        std::fs::remove_file(root.join("removed-later.tex")).unwrap();
        write(&root, "keep.tex", "changed by the response\n");
        stage_all(&root).unwrap();
        assert!(commit_index(&root, "response edits").unwrap());

        restore_worktree(&root, &checkpoint).unwrap();

        assert!(
            !root.join("added-later.tex").exists(),
            "a file created after the checkpoint must be removed on restore"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("keep.tex")).unwrap(),
            "base\n"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("removed-later.tex")).unwrap(),
            "here at checkpoint\n",
            "a file deleted after the checkpoint must be restored"
        );
    }

    #[test]
    fn imported_repository_history_keeps_the_remote_lineage_and_a_clean_worktree() {
        let remote = temp_repo();
        write(&remote, "main.tex", "remote content\n");
        stage_all(&remote).unwrap();
        assert!(commit_index(&remote, "Remote base").unwrap());

        let imported = temp_dir("history-import");
        write(&imported, "main.tex", "remote content\n");
        write(&imported, "project.json", "{}\n");
        let remote_url = remote.to_string_lossy().into_owned();
        attach_imported_repository_history_at(&imported, &remote_url, "main", |root, refspec| {
            ok_or_err(run_git(root, &["fetch", "--no-tags", "origin", refspec])?)
        })
        .unwrap();

        let messages = run_git(&imported, &["log", "--reverse", "--format=%s"]).unwrap();
        assert_eq!(
            String::from_utf8_lossy(&messages.stdout)
                .lines()
                .collect::<Vec<_>>(),
            ["Remote base", "Prepare project for Oleafly"]
        );
        let upstream = run_git(
            &imported,
            &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
        )
        .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&upstream.stdout).trim(),
            "origin/main"
        );
        assert!(status(&imported).is_empty());
        assert!(std::fs::read_to_string(imported.join(".git/info/exclude"))
            .unwrap()
            .lines()
            .any(|line| line == ".oleafly/"));
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
    fn staging_an_existing_repository_adds_the_private_local_exclude() {
        let r = temp_repo();
        std::fs::create_dir(r.join(".oleafly")).unwrap();
        write(&r, ".oleafly/state", "private\n");
        write(&r, "main.tex", "source\n");

        stage_all(&r).unwrap();

        let tracked = run_git(&r, &["ls-files", ".oleafly"]).unwrap();
        assert!(tracked.stdout.is_empty());
        assert!(std::fs::read_to_string(r.join(".git/info/exclude"))
            .unwrap()
            .lines()
            .any(|line| line.trim() == ".oleafly/"));
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
        assert_eq!(
            sanitize_url("https://example.com/repos/user@domain/project.git?owner=a@b"),
            "https://example.com/repos/user@domain/project.git?owner=a@b"
        );
        assert_eq!(
            sanitize_url("ssh://git@github.com/u/repo.git"),
            "ssh://git@github.com/u/repo.git"
        );
    }

    #[test]
    fn legacy_remote_credentials_are_only_removed_by_the_explicit_repair() {
        let root = temp_repo();
        run_git(
            &root,
            &[
                "remote",
                "add",
                "origin",
                "https://x-access-token:legacy-secret@github.com/u/repo.git",
            ],
        )
        .unwrap();

        assert!(remote_credentials_need_cleanup(&root).unwrap());
        assert!(clean_remote_credentials(&root).unwrap());
        assert!(!remote_credentials_need_cleanup(&root).unwrap());
        let remote = run_git_read_only(&root, &["remote", "get-url", "origin"]).unwrap();
        assert_eq!(
            String::from_utf8_lossy(&remote.stdout).trim(),
            "https://github.com/u/repo.git"
        );
    }

    #[test]
    fn ssh_remote_usernames_are_not_treated_as_embedded_credentials() {
        let root = temp_repo();
        run_git(
            &root,
            &["remote", "add", "origin", "ssh://git@github.com/u/repo.git"],
        )
        .unwrap();

        assert!(!remote_credentials_need_cleanup(&root).unwrap());
        assert!(!clean_remote_credentials(&root).unwrap());
        let remote = run_git_read_only(&root, &["remote", "get-url", "origin"]).unwrap();
        assert_eq!(
            String::from_utf8_lossy(&remote.stdout).trim(),
            "ssh://git@github.com/u/repo.git"
        );
    }
}
