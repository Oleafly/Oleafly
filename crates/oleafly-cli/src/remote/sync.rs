//! `remote link`, `sync` and `diff`, through the service's Git bridge and
//! the folder's private mirror.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use oleafly_online::git::SystemGit;
use oleafly_online::sync::{
    self as online_sync, claim, diff_project, export_link_backups, link_project, remove_link,
    sync_project, DiffOptions, LinkOutcome, Mode, Side, SyncOptions, SyncOutcome,
    FILES_MAY_HAVE_CHANGED,
};
use oleafly_online::{OnlineError, OnlineErrorKind};
use serde_json::json;

use super::scope::{
    git_token_for, parse_remote_ref, project_url, resolve_scope, RemoteRef, RemoteScope,
};
use super::{DiffArgs, LinkArgs, RemoteDeps, SideArg, SyncArgs};
use crate::auth::online::online_error;
use crate::auth::shared::{from_online, Env, Report};
use crate::contract::{CliError, ErrorKind, Exit};
use crate::native::{executable_name, resolve_executable, CandidateResolution};

/// Patches are cut here; `--name-only` lists every file.
pub(crate) const MAX_PATCH_BYTES: usize = 8 << 20;

/// "1 file", "3 files".
pub(crate) fn files(count: usize) -> String {
    if count == 1 {
        "1 file".to_string()
    } else {
        format!("{count} files")
    }
}

/// "1 file differs", "3 files differ".
fn files_differ(count: usize) -> String {
    if count == 1 {
        "1 file differs".to_string()
    } else {
        format!("{count} files differ")
    }
}

/// The system's Git, found outside the project.
pub(crate) fn system_deps(folder: &Path) -> Result<RemoteDeps, CliError> {
    Ok(RemoteDeps {
        git: Arc::new(SystemGit::new(locate_git(folder)?)),
        url_for: online_sync::remote_url,
    })
}

/// `name` from `PATH` (then `extra`), never from inside the project.
pub(crate) fn locate_tool_in(
    name: &str,
    project_root: &Path,
    path: Option<&std::ffi::OsStr>,
    extra: &[PathBuf],
) -> Option<PathBuf> {
    let root = project_root
        .canonicalize()
        .unwrap_or_else(|_| project_root.to_path_buf());
    let on_path: Vec<PathBuf> = path
        .map(|path| {
            std::env::split_paths(path)
                .filter(|folder| folder.is_absolute())
                .map(|folder| folder.join(executable_name(name)))
                .collect()
        })
        .unwrap_or_default();
    on_path
        .into_iter()
        .chain(extra.iter().cloned())
        .find_map(|candidate| match resolve_executable(candidate, &root) {
            CandidateResolution::Safe(found) => Some(found),
            CandidateResolution::Missing | CandidateResolution::ProjectLocal(_) => None,
        })
}

fn locate_tool(name: &str, project_root: &Path, extra: &[PathBuf]) -> Option<PathBuf> {
    let path = std::env::var_os("PATH");
    locate_tool_in(name, project_root, path.as_deref(), extra)
}

/// Git's usual homes when it isn't on `PATH`.
fn git_homes() -> Vec<PathBuf> {
    let mut homes = Vec::new();
    if cfg!(windows) {
        for variable in ["ProgramW6432", "ProgramFiles", "LOCALAPPDATA"] {
            if let Some(base) = std::env::var_os(variable).filter(|value| !value.is_empty()) {
                let base = PathBuf::from(base);
                homes.push(base.join("Git").join("cmd").join("git.exe"));
                homes.push(
                    base.join("Programs")
                        .join("Git")
                        .join("cmd")
                        .join("git.exe"),
                );
            }
        }
    } else {
        homes.push(PathBuf::from("/usr/bin/git"));
        homes.push(PathBuf::from("/usr/local/bin/git"));
        homes.push(PathBuf::from("/opt/homebrew/bin/git"));
    }
    homes
}

pub(crate) fn locate_git(project_root: &Path) -> Result<PathBuf, CliError> {
    locate_tool("git", project_root, &git_homes())
        .ok_or_else(|| from_online(&OnlineError::new(OnlineErrorKind::GitNotInstalled)))
}

/// Where the files a link replaced are saved: beside the private copy, so
/// unlinking keeps them.
pub(crate) fn backups_folder(root: &Path) -> PathBuf {
    root.join(".oleafly").join("online-backups")
}

fn side_of(side: SideArg) -> Side {
    match side {
        SideArg::Local => Side::Local,
        SideArg::Remote => Side::Remote,
    }
}

/// `PATH=local` and `PATH=remote`, with project-relative paths.
pub(crate) fn parse_resolutions(values: &[String]) -> Result<BTreeMap<String, Side>, CliError> {
    let mut resolutions = BTreeMap::new();
    for value in values {
        let invalid = || {
            CliError::new(
                ErrorKind::Usage,
                "remote.invalid_resolution",
                format!("\"{value}\" isn't PATH=local or PATH=remote."),
            )
            .hint("Use a path inside the project, such as --resolve sections/intro.tex=local.")
        };
        let (path, side) = value.rsplit_once('=').ok_or_else(invalid)?;
        let side = match side.trim() {
            "local" => Side::Local,
            "remote" => Side::Remote,
            _ => return Err(invalid()),
        };
        let path = path.trim().replace('\\', "/");
        let path = path.strip_prefix("./").unwrap_or(&path).to_string();
        let unsafe_path = path.is_empty()
            || path.starts_with('/')
            || path.contains(':')
            || path.chars().any(char::is_control)
            || path
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..");
        if unsafe_path {
            return Err(invalid());
        }
        resolutions.insert(path, side);
    }
    Ok(resolutions)
}

struct Prepared {
    scope: RemoteScope,
    paths: online_sync::SyncPaths,
    server: String,
    url: String,
    token: zeroize::Zeroizing<String>,
}

/// The linked folder's mirror, token and address.
fn prepare_linked(env: &Env, deps: &RemoteDeps, folder: &Path) -> Result<Prepared, CliError> {
    let scope = resolve_scope(folder, &env.data_root)?;
    scope.ensure_no_pending_restore()?;
    let link = scope
        .current_link(&env.data_root)?
        .ok_or_else(|| from_online(&OnlineError::new(OnlineErrorKind::SyncNotLinked)))?;
    // The link record is in the folder, so the server is not one the user
    // named.
    let (token, _) = git_token_for(env, &link.server, false)?;
    let url = (deps.url_for)(&link.server, &link.remote_id)
        .map_err(|error| online_error(error, &link.server))?;
    let paths = scope.sync_paths(&env.data_root)?;
    Ok(Prepared {
        scope,
        paths,
        server: link.server,
        url,
        token,
    })
}

/// `remote link`: fetches the online project and, when the two copies
/// agree (or `--prefer` says which wins), records the link.
pub(crate) fn link(
    env: &Env,
    deps: &RemoteDeps,
    folder: &Path,
    args: LinkArgs,
) -> Result<Report, CliError> {
    let scope = resolve_scope(folder, &env.data_root)?;
    scope.ensure_no_pending_restore()?;
    let origin = scope.imported_from();
    let target = match &args.target {
        Some(input) => parse_remote_ref(input, args.server.as_deref(), &env.store)?,
        None => match &origin {
            Some(origin) => RemoteRef {
                server: origin.server.clone(),
                project_id: origin.project_id.clone(),
            },
            None => {
                return Err(CliError::new(
                    ErrorKind::Usage,
                    "remote.link_target_missing",
                    "Name the online project to link, by ID or address.",
                )
                .hint("Run oleafly remote list to see your projects."))
            }
        },
    };
    let library = matches!(scope, RemoteScope::Library { .. });
    if library
        && !origin.as_ref().is_some_and(|origin| {
            origin.project_id == target.project_id && origin.server == target.server
        })
    {
        return Err(CliError::new(ErrorKind::InvalidInput, "remote.not_imported", "This Oleafly app project didn't come from the online service.")
            .hint("Link it from the Oleafly app, or import the online project with oleafly remote import."));
    }
    // The project named on the command line (or its server) is the user's
    // choice; where a folder says it came from is not.
    let named_by_user = args.target.is_some() || args.server.is_some();
    let (token, _) = git_token_for(env, &target.server, named_by_user)?;
    let url = (deps.url_for)(&target.server, &target.project_id)
        .map_err(|error| online_error(error, &target.server))?;
    let paths = scope.sync_paths(&env.data_root)?;
    let existed = paths.dir.exists();
    let _claim = claim(&paths).map_err(|error| online_error(error, &target.server))?;
    let mode = if args.dry_run {
        Mode::Plan
    } else {
        Mode::Apply
    };
    let outcome = link_project(
        deps.git.as_ref(),
        &paths,
        scope.root(),
        &target.server,
        &target.project_id,
        &url,
        &token,
        args.prefer.map(side_of),
        mode,
        scope.worktree_lock(&env.data_root).as_ref(),
        library,
    );
    let linked = matches!(outcome, Ok(LinkOutcome::Linked { .. }));
    // Files here changed (or may have): the app's shell-escape trust was for
    // what was there before.
    let files_changed = match &outcome {
        Ok(LinkOutcome::Linked { written }) => !written.is_empty(),
        Ok(LinkOutcome::NeedsChoice(_)) => false,
        Err(error) => error.params.contains_key(FILES_MAY_HAVE_CHANGED),
    };
    let revoked = if files_changed && !args.dry_run {
        scope.revoke_shell_escape_trust(&env.data_root)
    } else {
        Ok(())
    };
    // A copy of what the online version replaced is put where it stays.
    let backups = if linked && !args.dry_run && args.prefer == Some(SideArg::Remote) {
        export_link_backups(deps.git.as_ref(), &paths, &backups_folder(scope.root()))
            .map_err(|error| online_error(error, &target.server))
    } else {
        Ok(Vec::new())
    };
    if !existed && (args.dry_run || !linked) {
        // A check or a refused link leaves no private copy behind.
        let _ = remove_link(&paths);
    }
    let outcome = outcome.map_err(|error| online_error(error, &target.server))?;
    revoked?;
    let backups = backups?;
    match outcome {
        LinkOutcome::NeedsChoice(differing) => Err(CliError::new(
            ErrorKind::Conflict,
            "remote.link_choice",
            format!(
                "{} between this folder and the online project.",
                files_differ(differing.len())
            ),
        )
        .hint("Run oleafly remote link again with --prefer local or --prefer remote.")
        .details(json!({"differing": differing}))),
        LinkOutcome::Linked { written } => {
            let address = project_url(&target.server, &target.project_id);
            let line = if args.dry_run {
                format!(
                    "Dry run: linking would write {} here. Nothing was changed.",
                    files(written.len())
                )
            } else {
                format!("Linked this folder to {address}.")
            };
            let saved: Vec<_> = backups
                .iter()
                .map(|backup| {
                    json!({
                        "folder": backups_folder(scope.root()).join(&backup.name),
                        "files": backup.files,
                    })
                })
                .collect();
            let mut report = Report::new(json!({
                "scope": scope.kind(),
                "server": target.server,
                "remoteId": target.project_id,
                "written": written,
                "dryRun": args.dry_run,
                "backups": saved,
            }))
            .line(line);
            for backup in &backups {
                report = report.line(format!(
                    "Your versions of {} are saved in {}.",
                    files(backup.files.len()),
                    backups_folder(scope.root()).join(&backup.name).display()
                ));
            }
            Ok(report)
        }
    }
}

/// `remote sync`: merges online changes here and sends local ones.
pub(crate) fn sync(
    env: &Env,
    deps: &RemoteDeps,
    folder: &Path,
    args: SyncArgs,
) -> Result<Report, CliError> {
    let resolutions = parse_resolutions(&args.resolve)?;
    let prepared = prepare_linked(env, deps, folder)?;
    let _claim = claim(&prepared.paths).map_err(|error| online_error(error, &prepared.server))?;
    let options = SyncOptions {
        resolutions,
        mode: if args.dry_run {
            Mode::Plan
        } else {
            Mode::Apply
        },
        push: !args.no_push,
        worktree: prepared.scope.worktree_lock(&env.data_root),
    };
    let summary = sync_project(
        deps.git.as_ref(),
        &prepared.paths,
        prepared.scope.root(),
        &prepared.url,
        &prepared.token,
        &options,
    );
    // Files here changed (or may have): the app's shell-escape trust was for
    // what was there before. The app does the same for every change it
    // didn't make in its editor.
    let files_changed = match &summary {
        Ok(summary) => !(summary.written.is_empty() && summary.removed.is_empty()),
        Err(error) => error.params.contains_key(FILES_MAY_HAVE_CHANGED),
    };
    let revoked = if files_changed && !args.dry_run {
        prepared.scope.revoke_shell_escape_trust(&env.data_root)
    } else {
        Ok(())
    };
    let summary = summary.map_err(|error| online_error(error, &prepared.server))?;
    revoked?;
    let changed = summary.written.len() + summary.removed.len();
    let line = match summary.outcome {
        SyncOutcome::Conflicts => {
            return Err(CliError::new(
                ErrorKind::Conflict,
                "remote.conflicts",
                format!(
                    "{} changed both here and online.",
                    files(summary.conflicts.len())
                ),
            )
            .hint(
                "Pick a side with --resolve PATH=local or --resolve PATH=remote, then sync again.",
            )
            .details(json!({"conflicts": summary.conflicts})))
        }
        SyncOutcome::UpToDate => "Up to date.".to_string(),
        SyncOutcome::Synced => format!(
            "Synced. {} came from online and your changes were sent.",
            files(changed)
        ),
        SyncOutcome::Pulled if args.no_push => format!(
            "Merged {} from online. Your changes weren't sent (--no-push).",
            files(changed)
        ),
        SyncOutcome::Pulled => format!("Merged {} from online.", files(changed)),
        SyncOutcome::LocalOnly => {
            "Your changes are ready to send. Run oleafly remote sync without --no-push.".to_string()
        }
        SyncOutcome::Planned if summary.would_push => format!(
            "Dry run: {} would change here, and your changes would be sent online. Nothing was changed.",
            files(changed)
        ),
        SyncOutcome::Planned => format!(
            "Dry run: {} would change here. Nothing was changed.",
            files(changed)
        ),
    };
    let data =
        serde_json::to_value(&summary).map_err(|error| CliError::internal(error.to_string()))?;
    Ok(Report::new(data).line(line))
}

/// `remote diff`: what differs from the online project, and which files
/// changed on both sides since the last sync.
pub(crate) fn diff(
    env: &Env,
    deps: &RemoteDeps,
    folder: &Path,
    args: DiffArgs,
) -> Result<Report, CliError> {
    let prepared = prepare_linked(env, deps, folder)?;
    let _claim = claim(&prepared.paths).map_err(|error| online_error(error, &prepared.server))?;
    let worktree = prepared.scope.worktree_lock(&env.data_root);
    let options = DiffOptions {
        fetch: !args.no_fetch,
        patch: !args.name_only && !args.latexdiff,
        max_patch_bytes: MAX_PATCH_BYTES,
    };
    let summary = diff_project(
        deps.git.as_ref(),
        &prepared.paths,
        prepared.scope.root(),
        &prepared.url,
        &prepared.token,
        &options,
        worktree.as_ref(),
    )
    .map_err(|error| online_error(error, &prepared.server))?;
    if args.latexdiff {
        return super::latexdiff::latexdiff_report(deps, &prepared.scope, &prepared.paths, &args)
            .inspect_err(|_| {
                let _ = online_sync::restore_base(deps.git.as_ref(), &prepared.paths);
            });
    }
    let mut lines = Vec::new();
    if summary.changes.is_empty() {
        lines.push("No differences.".to_string());
    } else {
        lines.push(format!("{}.", files_differ(summary.changes.len())));
        for change in &summary.changes {
            let kind = serde_json::to_value(change.change)
                .ok()
                .and_then(|value| value.as_str().map(str::to_string))
                .unwrap_or_default();
            let both = if summary.conflicts.contains(&change.path) {
                " (changed on both sides)"
            } else {
                ""
            };
            lines.push(format!("  {kind:<8} {}{both}", change.path));
        }
        if !summary.conflicts.is_empty() {
            lines.push(format!(
                "{} changed on both sides: {}",
                files(summary.conflicts.len()),
                summary.conflicts.join(", ")
            ));
        }
    }
    if let Some(patch) = summary.patch.as_deref().filter(|patch| !patch.is_empty()) {
        lines.push(patch.trim_end_matches('\n').to_string());
    }
    if summary.truncated {
        lines.push("The patch was cut at 8 MB. Use --name-only to list every file.".to_string());
    }
    let exit = match (
        args.exit_code,
        summary.conflicts.is_empty(),
        summary.changes.is_empty(),
    ) {
        (false, _, _) => Exit::Ok,
        (true, false, _) => Exit::Conflict,
        (true, true, false) => Exit::Findings,
        (true, true, true) => Exit::Ok,
    };
    let data =
        serde_json::to_value(&summary).map_err(|error| CliError::internal(error.to_string()))?;
    Ok(Report::new(data).lines(lines).exit(exit))
}

#[cfg(test)]
pub(crate) mod tests {
    use std::process::Command;

    use oleafly_online::sync::read_link;

    use super::*;
    use crate::auth::test_env::env_at;

    /// A bare repository standing in for the online project, reached
    /// through a `file://` address.
    pub(crate) struct World {
        pub dir: tempfile::TempDir,
        pub env: Env,
        pub remote: PathBuf,
        pub project: PathBuf,
    }

    pub(crate) fn git(dir: &Path, args: &[&str]) {
        let mut command = Command::new("git");
        // Under the pre-commit hook GIT_DIR names the real repository.
        crate::process::clear_inherited_git_env(&mut command);
        let status = command
            .args([
                "-c",
                "user.name=T",
                "-c",
                "user.email=t@example.com",
                "-c",
                "init.defaultBranch=master",
            ])
            .args(args)
            .current_dir(dir)
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&status.stderr)
        );
    }

    /// Test servers are `http://localhost/<folder>`; their Git remotes are
    /// bare repositories in that folder.
    fn file_url(server: &str, remote_id: &str) -> Result<String, OnlineError> {
        let folder = server
            .strip_prefix("http://localhost")
            .expect("a test server");
        Ok(format!("file://{folder}/{remote_id}"))
    }

    fn url_path(path: &Path) -> String {
        let text = path.to_string_lossy().replace('\\', "/");
        if text.starts_with('/') {
            text
        } else {
            format!("/{text}")
        }
    }

    pub(crate) fn deps() -> RemoteDeps {
        let program = locate_tool("git", Path::new("/nonexistent-project"), &git_homes())
            .expect("git on PATH");
        RemoteDeps {
            git: Arc::new(SystemGit::new(program)),
            url_for: file_url,
        }
    }

    impl World {
        /// `remote.git` holds `main.tex` = "Hello\n"; the folder `paper`
        /// holds the same file and is linked.
        pub(crate) fn linked() -> World {
            let dir = tempfile::tempdir().unwrap();
            let mut env = env_at(dir.path());
            env.online_git_token = Some(zeroize::Zeroizing::new("tok-unused-1".into()));
            let seed = dir.path().join("seed");
            std::fs::create_dir_all(&seed).unwrap();
            git(&seed, &["init", "-q"]);
            std::fs::write(seed.join("main.tex"), "Hello\n").unwrap();
            git(&seed, &["add", "."]);
            git(&seed, &["commit", "-q", "-m", "seed"]);
            let remote = dir.path().join("server").join("remote");
            std::fs::create_dir_all(remote.parent().unwrap()).unwrap();
            git(
                dir.path(),
                &[
                    "clone",
                    "-q",
                    "--bare",
                    seed.to_str().unwrap(),
                    remote.to_str().unwrap(),
                ],
            );
            let project = dir.path().join("paper");
            std::fs::create_dir_all(&project).unwrap();
            std::fs::write(project.join("main.tex"), "Hello\n").unwrap();
            let world = World {
                env,
                remote,
                project,
                dir,
            };
            // As after `oleafly auth login online --with-token`: a server the
            // environment's token may go to when only a folder names it.
            oleafly_online::session::save_git_token(
                &world.env.store,
                &world.server(),
                "tok-unused-1",
            )
            .unwrap();
            let args = LinkArgs {
                target: Some(world.reference()),
                ..LinkArgs::default()
            };
            link(&world.env, &deps(), &world.project, args).unwrap();
            world
        }

        /// An app library project that came from the world's online
        /// project, with `main.tex` = `text`. Not linked yet.
        pub(crate) fn library_project(&self, id: &str, text: &str) -> PathBuf {
            let project = self.env.projects_root().join(id);
            std::fs::create_dir_all(&project).unwrap();
            std::fs::write(project.join("main.tex"), text).unwrap();
            let record = json!({"importedFrom": {
                "service": oleafly_online::service::SERVICE_ID,
                "server": self.server(),
                "projectId": "remote",
            }});
            std::fs::write(project.join("project.json"), record.to_string()).unwrap();
            project
        }

        /// The app's shell-escape trust record for a project.
        pub(crate) fn trust_record(&self, id: &str) -> PathBuf {
            self.env
                .data_root
                .join("device-trust")
                .join("latex-shell-escape")
                .join(format!("{id}.json"))
        }

        pub(crate) fn trust(&self, id: &str) {
            let record = self.trust_record(id);
            std::fs::create_dir_all(record.parent().unwrap()).unwrap();
            std::fs::write(record, "{}").unwrap();
        }

        pub(crate) fn server(&self) -> String {
            format!(
                "http://localhost{}",
                url_path(&self.dir.path().join("server"))
            )
        }

        fn reference(&self) -> String {
            format!("{}/project/remote", self.server())
        }

        /// Commits `text` as `main.tex` online.
        pub(crate) fn edit_online(&self, text: &str) {
            let work = self.dir.path().join("online-work");
            if !work.exists() {
                git(
                    self.dir.path(),
                    &[
                        "clone",
                        "-q",
                        self.remote.to_str().unwrap(),
                        work.to_str().unwrap(),
                    ],
                );
            }
            git(&work, &["pull", "-q"]);
            std::fs::write(work.join("main.tex"), text).unwrap();
            git(&work, &["commit", "-q", "-am", "online edit"]);
            git(&work, &["push", "-q"]);
        }
    }

    fn read(path: &Path) -> String {
        std::fs::read_to_string(path).unwrap()
    }

    fn link_library(world: &World, project: &Path, prefer: Option<SideArg>) -> Report {
        let args = LinkArgs {
            prefer,
            ..LinkArgs::default()
        };
        link(&world.env, &deps(), project, args).unwrap()
    }

    #[test]
    fn a_sync_that_changes_a_library_project_takes_its_shell_escape_trust_away() {
        let world = World::linked();
        let project = world.library_project("lib-1", "Hello\n");
        link_library(&world, &project, None);
        assert!(world
            .env
            .data_root
            .join("project-worktree-locks/lib-1.lock")
            .exists());
        world.trust("lib-1");
        world.trust("bystander");

        // Nothing to pull, and a dry run: the trust stays.
        sync(&world.env, &deps(), &project, SyncArgs::default()).unwrap();
        world.edit_online("Changed online\n");
        let dry = SyncArgs {
            dry_run: true,
            ..SyncArgs::default()
        };
        sync(&world.env, &deps(), &project, dry).unwrap();
        assert!(world.trust_record("lib-1").exists());

        sync(&world.env, &deps(), &project, SyncArgs::default()).unwrap();
        assert_eq!(read(&project.join("main.tex")), "Changed online\n");
        assert!(!world.trust_record("lib-1").exists());
        assert!(world.trust_record("bystander").exists());
    }

    #[test]
    fn a_folder_the_app_does_not_know_has_no_trust_to_take_away() {
        let world = World::linked();
        world.trust("paper");
        world.edit_online("Changed online\n");
        sync(&world.env, &deps(), &world.project, SyncArgs::default()).unwrap();
        assert_eq!(read(&world.project.join("main.tex")), "Changed online\n");
        assert!(world.trust_record("paper").exists());
    }

    #[test]
    fn linking_with_the_online_copy_takes_the_trust_away_and_keeps_what_it_replaced() {
        let world = World::linked();
        let project = world.library_project("lib-2", "My own text\n");
        world.trust("lib-2");
        let report = link_library(&world, &project, Some(SideArg::Remote));
        assert_eq!(read(&project.join("main.tex")), "Hello\n");
        assert!(!world.trust_record("lib-2").exists());
        let saved = report.data["backups"].as_array().unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0]["files"], json!(["main.tex"]));
        let folder = PathBuf::from(saved[0]["folder"].as_str().unwrap());
        assert!(folder.starts_with(backups_folder(&project.canonicalize().unwrap())));
        assert_eq!(read(&folder.join("main.tex")), "My own text\n");
        assert!(report
            .lines
            .iter()
            .any(|line| line.starts_with("Your versions of 1 file are saved in")));

        // Unlinking removes the private copy but not the saved files.
        let no_git = |_: &Path| -> Result<RemoteDeps, CliError> { Ok(deps()) };
        let unlinked = super::super::list::unlink(&world.env, &no_git, &project, false).unwrap();
        assert_eq!(unlinked.data["backups"][0]["files"], json!(["main.tex"]));
        assert_eq!(read(&folder.join("main.tex")), "My own text\n");
    }

    #[test]
    fn a_checkpoint_restore_the_app_has_not_finished_stops_every_command_that_reads_the_files() {
        let world = World::linked();
        let project = world.library_project("lib-3", "Hello\n");
        link_library(&world, &project, None);
        world.edit_online("Changed online\n");
        let marker = project.join(".oleafly").join("checkpoint-restore-pending");
        std::fs::create_dir_all(marker.parent().unwrap()).unwrap();
        std::fs::write(&marker, "").unwrap();
        world.trust("lib-3");

        let pending = |error: CliError| {
            assert_eq!(error.code, "conflict.restore_pending");
            assert_eq!(error.exit() as u8, 8);
        };
        pending(sync(&world.env, &deps(), &project, SyncArgs::default()).unwrap_err());
        pending(diff(&world.env, &deps(), &project, DiffArgs::default()).unwrap_err());
        pending(link(&world.env, &deps(), &project, LinkArgs::default()).unwrap_err());
        let fetch = super::super::StatusArgs { fetch: true };
        let status = |_: &Path| -> Result<RemoteDeps, CliError> { Ok(deps()) };
        pending(super::super::list::status(&world.env, &status, &project, &fetch).unwrap_err());
        // Nothing was read or written, and the trust is as it was.
        assert_eq!(read(&project.join("main.tex")), "Hello\n");
        assert!(world.trust_record("lib-3").exists());

        std::fs::remove_file(&marker).unwrap();
        sync(&world.env, &deps(), &project, SyncArgs::default()).unwrap();
        assert_eq!(read(&project.join("main.tex")), "Changed online\n");
    }

    #[test]
    fn the_environments_git_token_only_goes_to_a_server_the_user_chose() {
        let world = World::linked();
        // A link record planted in the folder names another server.
        let record = world.project.join(".oleafly/online/link.json");
        let planted = read(&record).replace(&world.server(), "https://evil.example");
        std::fs::write(&record, planted).unwrap();
        for failure in [
            sync(&world.env, &deps(), &world.project, SyncArgs::default()).unwrap_err(),
            diff(&world.env, &deps(), &world.project, DiffArgs::default()).unwrap_err(),
        ] {
            assert_eq!(failure.code, "online.git_token_missing");
        }

        // So does a `project.json` that says where the folder came from.
        let other = world.dir.path().join("other");
        std::fs::create_dir_all(&other).unwrap();
        let record = json!({"importedFrom": {
            "service": oleafly_online::service::SERVICE_ID,
            "server": "https://evil.example",
            "projectId": "abc",
        }});
        std::fs::write(other.join("project.json"), record.to_string()).unwrap();
        let failure = link(&world.env, &deps(), &other, LinkArgs::default()).unwrap_err();
        assert_eq!(failure.code, "online.git_token_missing");
        assert!(!other.join(".oleafly/online").exists());
    }

    #[test]
    fn a_link_record_naming_a_server_nobody_may_use_is_refused() {
        let world = World::linked();
        let record = world.project.join(".oleafly/online/link.json");
        let planted = read(&record).replace(&world.server(), "http://latex.example.edu");
        std::fs::write(&record, planted).unwrap();
        let failure = sync(&world.env, &deps(), &world.project, SyncArgs::default()).unwrap_err();
        assert_eq!(failure.code, "online.invalid_server");
    }

    #[test]
    fn a_dry_run_with_only_local_changes_says_the_changes_would_be_sent() {
        let world = World::linked();
        std::fs::write(world.project.join("main.tex"), "Local only\n").unwrap();
        let dry = SyncArgs {
            dry_run: true,
            ..SyncArgs::default()
        };
        let report = sync(&world.env, &deps(), &world.project, dry).unwrap();
        assert_eq!(report.data["outcome"], "planned");
        assert_eq!(report.data["wouldPush"], true);
        assert!(
            report.lines[0].contains("would be sent online"),
            "{:?}",
            report.lines
        );
    }

    #[test]
    fn resolutions_parse_strictly() {
        assert_eq!(
            parse_resolutions(&["a/b.tex=local".into()]).unwrap()["a/b.tex"],
            Side::Local
        );
        assert_eq!(
            parse_resolutions(&["./c.tex=remote".into()]).unwrap()["c.tex"],
            Side::Remote
        );
        for bad in [
            "a.tex",
            "a.tex=mine",
            "=local",
            "../x=remote",
            "/etc/x=local",
            "C:/x=local",
            "a//b=local",
        ] {
            assert_eq!(
                parse_resolutions(&[bad.into()]).unwrap_err().kind,
                ErrorKind::Usage,
                "{bad}"
            );
        }
    }

    #[test]
    fn sync_conflicts_exit_8_with_the_paths_in_data_and_resolve_finishes_it() {
        let world = World::linked();
        world.edit_online("Hello from online\n");
        std::fs::write(world.project.join("main.tex"), "Hello from here\n").unwrap();
        let failure = sync(&world.env, &deps(), &world.project, SyncArgs::default()).unwrap_err();
        assert_eq!(
            (failure.code.as_ref(), failure.exit() as u8),
            ("remote.conflicts", 8)
        );
        assert_eq!(failure.details.unwrap()["conflicts"], json!(["main.tex"]));
        let resolve = SyncArgs {
            resolve: vec!["main.tex=remote".into()],
            ..SyncArgs::default()
        };
        sync(&world.env, &deps(), &world.project, resolve).unwrap();
        assert_eq!(
            std::fs::read_to_string(world.project.join("main.tex")).unwrap(),
            "Hello from online\n"
        );
    }

    #[test]
    fn a_dry_run_sync_changes_nothing() {
        let world = World::linked();
        world.edit_online("Changed online\n");
        let dry = SyncArgs {
            dry_run: true,
            ..SyncArgs::default()
        };
        let report = sync(&world.env, &deps(), &world.project, dry).unwrap();
        assert_eq!(report.data["outcome"], "planned");
        assert_eq!(
            std::fs::read_to_string(world.project.join("main.tex")).unwrap(),
            "Hello\n"
        );
    }

    #[test]
    fn link_needs_a_choice_when_files_differ_and_dry_run_writes_nothing() {
        let world = World::linked();
        let other = world.dir.path().join("other");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(other.join("main.tex"), "Different\n").unwrap();
        let args = || LinkArgs {
            target: Some(world.reference()),
            ..LinkArgs::default()
        };
        let failure = link(&world.env, &deps(), &other, args()).unwrap_err();
        assert_eq!(
            (failure.code.as_ref(), failure.exit() as u8),
            ("remote.link_choice", 8)
        );
        assert_eq!(failure.details.unwrap()["differing"], json!(["main.tex"]));
        assert!(
            !other.join(".oleafly/online").exists(),
            "a refused link leaves no private copy"
        );
        let dry = LinkArgs {
            prefer: Some(SideArg::Remote),
            dry_run: true,
            ..args()
        };
        link(&world.env, &deps(), &other, dry).unwrap();
        assert_eq!(
            std::fs::read_to_string(other.join("main.tex")).unwrap(),
            "Different\n"
        );
        assert!(read_link(&online_sync::SyncPaths::for_folder(&other))
            .unwrap()
            .is_none());
    }

    #[test]
    fn a_library_project_not_imported_by_the_app_cannot_be_linked() {
        let world = World::linked();
        let library = world.env.projects_root().join("lib-1");
        std::fs::create_dir_all(&library).unwrap();
        let args = LinkArgs {
            target: Some(world.reference()),
            ..LinkArgs::default()
        };
        let failure = link(&world.env, &deps(), &library, args).unwrap_err();
        assert_eq!(
            (failure.code.as_ref(), failure.exit() as u8),
            ("remote.not_imported", 3)
        );
    }

    #[test]
    fn diff_exit_codes_follow_the_contract() {
        let world = World::linked();
        let with_exit = || DiffArgs {
            exit_code: true,
            ..DiffArgs::default()
        };
        assert_eq!(
            diff(&world.env, &deps(), &world.project, with_exit())
                .unwrap()
                .exit,
            Exit::Ok
        );
        std::fs::write(world.project.join("main.tex"), "Local edit\n").unwrap();
        let report = diff(&world.env, &deps(), &world.project, with_exit()).unwrap();
        assert_eq!(report.exit, Exit::Findings);
        assert!(report.data["patch"]
            .as_str()
            .unwrap()
            .contains("+Local edit"));
        assert_eq!(
            diff(&world.env, &deps(), &world.project, DiffArgs::default())
                .unwrap()
                .exit,
            Exit::Ok
        );
        world.edit_online("Online edit\n");
        assert_eq!(
            diff(&world.env, &deps(), &world.project, with_exit())
                .unwrap()
                .exit,
            Exit::Conflict
        );
    }

    #[test]
    fn a_git_inside_the_project_is_never_run() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("paper");
        let outside = dir.path().join("tools");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        for folder in [&project, &outside] {
            let fake = folder.join(executable_name("git"));
            std::fs::write(&fake, "#!/bin/sh\n").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt as _;
                std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
        }
        let path = std::env::join_paths([&project, &outside]).unwrap();
        let found = locate_tool_in("git", &project, Some(&path), &[]).unwrap();
        assert!(
            found.starts_with(outside.canonicalize().unwrap()),
            "{}",
            found.display()
        );
        let only_inside = std::env::join_paths([&project]).unwrap();
        assert_eq!(
            locate_tool_in("git", &project, Some(&only_inside), &[]),
            None
        );
    }

    #[test]
    fn a_mirror_git_never_sees_the_token_in_its_arguments() {
        let git = SystemGit::new(PathBuf::from("/usr/bin/git"));
        let command = git.command(
            Path::new("/tmp/repo"),
            &["fetch", "--quiet", "origin"],
            Some(("https://latex.example.edu", "olp_SECRET_TOKEN")),
        );
        let args: Vec<String> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert!(
            !args.iter().any(|arg| arg.contains("olp_SECRET_TOKEN")),
            "{args:?}"
        );
    }
}
