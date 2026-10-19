//! `remote list`, `import`, `status`, `unlink` and `open`.
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use oleafly_online::archive::{
    folder_name_for, import_into_folder, unique_folder, ImportLimits, ImportProgress,
};
use oleafly_online::client::Http;
use oleafly_online::projects::{imported_projects, list_projects};
use oleafly_online::session;
use oleafly_online::sync::{claim, probe, remove_link};
use oleafly_online::{OnlineError, OnlineErrorKind};
use serde_json::{json, Value};

use super::scope::{git_token_for, parse_remote_ref, project_url, resolve_scope};
use super::{ImportArgs, RemoteDeps, StatusArgs};
use crate::auth::online::{online_error, server_for};
use crate::auth::shared::{from_online, user_agent, Env, Report};
use crate::contract::{CliError, Context, ErrorKind, Exit};

/// Called with a project's name as its download goes.
pub(crate) type Progress<'a> = dyn Fn(&str, ImportProgress) + Send + Sync + 'a;

/// Download progress for people (every 10%) or as `download` events.
pub(crate) fn progress_reporter(ctx: &Context) -> impl Fn(&str, ImportProgress) + Send + Sync + '_ {
    let shown = AtomicU64::new(u64::MAX);
    move |name: &str, progress: ImportProgress| {
        if let ImportProgress::Downloading { received, total } = progress {
            let _ = ctx.event(
                "download",
                json!({"name": name, "received": received, "total": total}),
            );
            if let Some(total) = total.filter(|total| *total > 0) {
                let percent = received.saturating_mul(100) / total;
                let step = percent / 10;
                if shown.swap(step, Ordering::Relaxed) != step {
                    ctx.note(format!("Downloading {name}: {percent}%"));
                }
            }
        }
    }
}

fn http_for(server: &str) -> Result<Http, CliError> {
    Http::new(server, &user_agent()).map_err(|error| online_error(error, server))
}

/// `remote list`: the account's projects, with the ones the app already
/// imported marked.
pub(crate) async fn list(env: &Env, server: Option<&str>) -> Result<Report, CliError> {
    let server = server_for(env, server)?;
    let http = http_for(&server)?;
    let (session, mut projects) = list_projects(&http, &env.store)
        .await
        .map_err(|error| online_error(error, &server))?;
    let imported = imported_projects(&env.projects_root(), &server);
    for project in &mut projects {
        project.imported_as = imported.get(&project.id).cloned();
    }
    let count = if projects.len() == 1 {
        "1 project".to_string()
    } else {
        format!("{} projects", projects.len())
    };
    let mut lines = vec![format!(
        "{count} in {}'s account on {server}",
        session.email
    )];
    for project in &projects {
        let mut line = format!("  {}  {}", project.id, project.name);
        if let Some(owner) = project.owner_name.as_deref().filter(|_| !project.owned) {
            line.push_str(&format!(" (shared by {owner})"));
        }
        if project.archived {
            line.push_str(" [archived]");
        }
        if let Some(local) = &project.imported_as {
            line.push_str(&format!(" — in the Oleafly app as {local}"));
        }
        lines.push(line);
    }
    Ok(
        Report::new(json!({"server": server, "email": session.email, "projects": projects}))
            .lines(lines),
    )
}

/// `remote import`: each project into a new folder of its own. One failure
/// doesn't stop the others; the exit code is the first failure's.
pub(crate) async fn import(
    env: &Env,
    args: ImportArgs,
    progress: &Progress<'_>,
) -> Result<Report, CliError> {
    let mut wanted: Vec<super::scope::RemoteRef> = Vec::new();
    for input in &args.projects {
        let reference = parse_remote_ref(input, args.server.as_deref(), &env.store)?;
        if !wanted.contains(&reference) {
            wanted.push(reference);
        }
    }
    let servers: BTreeSet<&str> = wanted
        .iter()
        .map(|reference| reference.server.as_str())
        .collect();
    if servers.len() > 1 {
        return Err(CliError::new(
            ErrorKind::Usage,
            "remote.mixed_servers",
            "Import from one server at a time.",
        ));
    }
    let server = wanted[0].server.clone();
    let into = match args.into {
        Some(into) => into,
        None => std::env::current_dir().map_err(CliError::from)?,
    };
    let http = http_for(&server)?;
    let (session, projects) = list_projects(&http, &env.store)
        .await
        .map_err(|error| online_error(error, &server))?;
    let mut imported = Vec::new();
    let mut planned = Vec::new();
    let mut failed = Vec::new();
    let mut lines = Vec::new();
    let mut first_failure: Option<Exit> = None;
    let mut fail = |remote_id: &str, error: CliError, lines: &mut Vec<String>| {
        first_failure.get_or_insert(error.exit());
        lines.push(format!("{remote_id}: {}", error.message));
        json!({"remoteId": remote_id, "error": {"code": error.code, "message": error.message}})
    };
    for reference in &wanted {
        let Some(project) = projects
            .iter()
            .find(|project| project.id == reference.project_id)
        else {
            let error = online_error(
                OnlineError::new(OnlineErrorKind::ProjectUnavailable),
                &server,
            );
            failed.push(fail(&reference.project_id, error, &mut lines));
            continue;
        };
        let target = unique_folder(&into, &folder_name_for(&project.name));
        if args.dry_run {
            lines.push(format!(
                "Would import {} into {}.",
                project.name,
                target.display()
            ));
            planned.push(json!({"remoteId": project.id, "name": project.name, "folder": target}));
            continue;
        }
        let name = project.name.clone();
        let report = move |step: ImportProgress| progress(&name, step);
        match import_into_folder(
            &http,
            &session.cookie,
            project,
            &target,
            &ImportLimits::default(),
            &report,
        )
        .await
        {
            Ok(folder) => {
                lines.push(format!(
                    "Imported {} into {}.",
                    folder.name,
                    folder.folder.display()
                ));
                lines.push(format!(
                    "Open it in Oleafly: oleafly open {}",
                    quoted_path(&folder.folder)
                ));
                imported.push(folder);
            }
            Err(error) => failed.push(fail(&project.id, online_error(error, &server), &mut lines)),
        }
    }
    let mut data = json!({"imported": imported, "failed": failed, "dryRun": args.dry_run});
    if args.dry_run {
        data["planned"] = Value::Array(planned);
    }
    let report = Report::new(data).lines(lines);
    Ok(match first_failure {
        Some(exit) => report.exit(exit),
        None => report,
    })
}

/// A path as people would type it in a shell.
fn quoted_path(path: &Path) -> String {
    let text = path.display().to_string();
    if text.contains(char::is_whitespace) {
        format!("\"{text}\"")
    } else {
        text
    }
}

fn session_state(env: &Env, server: &str) -> Result<&'static str, CliError> {
    Ok(
        if session::load(&env.store, server)
            .map_err(|error| from_online(&error))?
            .is_some()
        {
            "signed-in"
        } else {
            "signed-out"
        },
    )
}

/// `remote status`: the link, which token sync would use (never the
/// token), and with `--fetch` whether either side changed.
pub(crate) fn status(
    env: &Env,
    deps_for: &dyn Fn(&Path) -> Result<RemoteDeps, CliError>,
    folder: &Path,
    args: &StatusArgs,
) -> Result<Report, CliError> {
    let scope = resolve_scope(folder, &env.data_root)?;
    let link = scope.current_link(&env.data_root)?;
    let server = match (&link, scope.imported_from()) {
        (Some(link), _) => link.server.clone(),
        (None, Some(origin)) => origin.server,
        (None, None) => server_for(env, None)?,
    };
    let token = match git_token_for(env, &server) {
        Ok((_, source)) => source.as_str(),
        Err(_) => "missing",
    };
    let mut data = json!({
        "scope": scope.kind(),
        "folder": scope.root(),
        "linked": link.is_some(),
        "gitToken": token,
        "session": session_state(env, &server)?,
    });
    if let Some(project_id) = scope.project_id() {
        data["projectId"] = json!(project_id);
    }
    let mut lines = Vec::new();
    match &link {
        Some(link) => {
            data["server"] = json!(link.server);
            data["remoteId"] = json!(link.remote_id);
            data["auto"] = json!(link.auto);
            data["lastSyncAt"] = json!(link.last_sync_at);
            lines.push(format!(
                "Linked to {}.",
                project_url(&link.server, &link.remote_id)
            ));
        }
        None => lines.push("This folder isn't linked to an online project.".into()),
    }
    lines.push(match token {
        "env" => format!(
            "Git token: from {}",
            crate::auth::shared::ONLINE_GIT_TOKEN_VARIABLE
        ),
        "store" => "Git token: saved".into(),
        _ => format!("Git token: none saved for {server}"),
    });
    if let (true, Some(link)) = (args.fetch, &link) {
        let deps = deps_for(scope.root())?;
        let (token, _) = git_token_for(env, &link.server)?;
        let url = (deps.url_for)(&link.server, &link.remote_id)
            .map_err(|error| online_error(error, &link.server))?;
        let paths = scope.sync_paths(&env.data_root)?;
        let _claim = claim(&paths).map_err(|error| online_error(error, &link.server))?;
        let found = probe(
            deps.git.as_ref(),
            &paths,
            scope.root(),
            &url,
            &token,
            scope.worktree_lock(&env.data_root).as_ref(),
        )
        .map_err(|error| online_error(error, &link.server))?;
        let yes_no = |changed: bool| if changed { "yes" } else { "no" };
        lines.push(format!(
            "Changed online since the last sync: {}",
            yes_no(found.remote_changed)
        ));
        lines.push(format!(
            "Changed here since the last sync: {}",
            yes_no(found.local_changed)
        ));
        data["probe"] = json!(found);
    }
    Ok(Report::new(data).lines(lines))
}

/// `remote unlink`: removes the private copy and the link record. The
/// folder's files stay as they are.
pub(crate) fn unlink(env: &Env, folder: &Path, dry_run: bool) -> Result<Report, CliError> {
    let scope = resolve_scope(folder, &env.data_root)?;
    let paths = scope.sync_paths(&env.data_root)?;
    let linked = paths.dir.exists();
    if !linked {
        return Ok(Report::new(json!({"unlinked": false, "dryRun": dry_run}))
            .line("This folder isn't linked to an online project."));
    }
    if dry_run {
        return Ok(Report::new(json!({"unlinked": false, "dryRun": true}))
            .line("Dry run: would unlink this folder. Your files would stay as they are."));
    }
    let _claim = claim(&paths).map_err(|error| from_online(&error))?;
    remove_link(&paths).map_err(|error| from_online(&error))?;
    Ok(Report::new(json!({"unlinked": true, "dryRun": false}))
        .line("Unlinked this folder. Your files are unchanged."))
}

/// Whether a browser can be opened here (Linux needs a display).
fn can_open_browser() -> bool {
    if cfg!(any(windows, target_os = "macos")) {
        return true;
    }
    ["DISPLAY", "WAYLAND_DISPLAY"]
        .iter()
        .any(|name| std::env::var_os(name).is_some_and(|value| !value.is_empty()))
}

/// `remote open`: the linked (or imported-from) project's page.
pub(crate) fn open(env: &Env, folder: &Path, print: bool) -> Result<Report, CliError> {
    let scope = resolve_scope(folder, &env.data_root)?;
    let (server, remote_id) = match (scope.current_link(&env.data_root)?, scope.imported_from()) {
        (Some(link), _) => (link.server, link.remote_id),
        (None, Some(origin)) => (origin.server, origin.project_id),
        (None, None) => {
            return Err(from_online(&OnlineError::new(
                OnlineErrorKind::SyncNotLinked,
            )))
        }
    };
    let url = project_url(&server, &remote_id);
    let opened = !print && can_open_browser() && open::that_detached(&url).is_ok();
    let line = if opened {
        format!("Opened {url}.")
    } else {
        url.clone()
    };
    Ok(Report::new(json!({"url": url, "opened": opened})).line(line))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use oleafly_online::test_support::{
        dashboard_page, remote_project_json, zip_bytes, FixtureServer, Reply, Request,
    };

    use super::super::scope::RemoteScope;
    use super::*;
    use crate::auth::test_env::{assert_secret_free, env_at};

    fn signed_in(env: &Env, server: &str) {
        session::save(
            &env.store,
            server,
            &session::Session {
                cookie: "site_session=good".into(),
                user_id: "user-1".into(),
                email: "ada@uni.edu".into(),
                saved_by: Some("cli".into()),
            },
        )
        .unwrap();
    }

    /// A dashboard with two projects; `/download/zip` serves `p1` and fails
    /// for anything else.
    async fn fixture() -> FixtureServer {
        let page = dashboard_page(&json!([
            remote_project_json("p1", "Thesis"),
            remote_project_json("p2", "Paper")
        ]));
        FixtureServer::start(Arc::new(move |request: &Request| {
            match request.path.as_str() {
                "/project" => Reply::ok(page.clone()),
                path if path.starts_with("/project/p1/download/zip") => {
                    Reply::ok(zip_bytes(&[("main.tex", "\\documentclass{article}")]))
                }
                _ => Reply::status(404),
            }
        }))
        .await
    }

    fn no_progress(_: &str, _: ImportProgress) {}

    #[tokio::test]
    async fn list_marks_projects_the_app_already_imported() {
        let server = fixture().await;
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        signed_in(&env, &server.base);
        let local = env.projects_root().join("x");
        std::fs::create_dir_all(&local).unwrap();
        let record = json!({"importedFrom": {"service": oleafly_online::service::SERVICE_ID, "server": server.base, "projectId": "p2"}});
        std::fs::write(local.join("project.json"), record.to_string()).unwrap();
        let report = list(&env, Some(&server.base)).await.unwrap();
        let projects = report.data["projects"].as_array().unwrap();
        let p2 = projects
            .iter()
            .find(|project| project["id"] == "p2")
            .unwrap();
        assert_eq!(p2["importedAs"], "x");
        assert_secret_free(&format!("{report:?}"), &["site_session=good"]);
    }

    #[tokio::test]
    async fn import_dry_run_downloads_nothing() {
        let server = fixture().await;
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        signed_in(&env, &server.base);
        let args = ImportArgs {
            projects: vec!["p1".into()],
            into: Some(dir.path().join("out")),
            server: Some(server.base.clone()),
            dry_run: true,
        };
        let report = import(&env, args, &no_progress).await.unwrap();
        assert_eq!(report.data["dryRun"], true);
        assert!(report.data["planned"][0]["folder"]
            .as_str()
            .unwrap()
            .ends_with("Thesis"));
        assert!(server.requests("/project/p1/download").is_empty());
        assert!(!dir.path().join("out").exists());
    }

    #[tokio::test]
    async fn import_reports_each_project_and_keeps_going_after_a_failure() {
        let server = fixture().await;
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        signed_in(&env, &server.base);
        let args = ImportArgs {
            projects: vec!["p2".into(), "p1".into()],
            into: Some(dir.path().join("out")),
            server: Some(server.base.clone()),
            dry_run: false,
        };
        let report = import(&env, args, &no_progress).await.unwrap();
        assert_eq!(report.data["imported"].as_array().unwrap().len(), 1);
        assert_eq!(report.data["failed"][0]["remoteId"], "p2");
        assert_eq!(report.exit, Exit::Project);
        assert!(dir.path().join("out/Thesis/main.tex").is_file());
    }

    #[test]
    fn unlink_removes_only_the_private_copy() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let folder = dir.path().join("paper");
        std::fs::create_dir_all(folder.join(".oleafly/online/repo")).unwrap();
        std::fs::write(folder.join(".oleafly/online/link.json"), "{}").unwrap();
        std::fs::write(folder.join("main.tex"), "hello").unwrap();
        let dry = unlink(&env, &folder, true).unwrap();
        assert_eq!(dry.data["unlinked"], false);
        assert!(folder.join(".oleafly/online").exists());
        unlink(&env, &folder, false).unwrap();
        assert!(!folder.join(".oleafly/online").exists());
        assert_eq!(
            std::fs::read_to_string(folder.join("main.tex")).unwrap(),
            "hello"
        );
    }

    #[test]
    fn open_prints_the_project_address() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let folder = dir.path().join("paper");
        std::fs::create_dir_all(&folder).unwrap();
        let record = json!({"importedFrom": {"service": oleafly_online::service::SERVICE_ID, "server": "https://latex.example.edu", "projectId": "p9"}});
        std::fs::write(folder.join("project.json"), record.to_string()).unwrap();
        let report = open(&env, &folder, true).unwrap();
        assert_eq!(
            report.data,
            json!({"url": "https://latex.example.edu/project/p9", "opened": false})
        );
        let empty = dir.path().join("empty");
        std::fs::create_dir_all(&empty).unwrap();
        assert_eq!(
            open(&env, &empty, true).unwrap_err().code,
            "remote.not_linked"
        );
    }

    #[test]
    fn status_reports_the_token_source_without_the_token() {
        let dir = tempfile::tempdir().unwrap();
        let mut env = env_at(dir.path());
        env.online_git_token = Some(zeroize::Zeroizing::new("env_TOKEN44".into()));
        let folder = dir.path().join("paper");
        std::fs::create_dir_all(&folder).unwrap();
        let no_git = |_: &Path| -> Result<RemoteDeps, CliError> {
            unreachable!("status without --fetch runs no Git")
        };
        let report = status(&env, &no_git, &folder, &StatusArgs::default()).unwrap();
        assert_eq!(report.data["gitToken"], "env");
        assert_eq!(report.data["linked"], false);
        assert_secret_free(&format!("{report:?}"), &["env_TOKEN44"]);
    }

    #[test]
    fn library_projects_report_their_id() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let project = env.projects_root().join("lib-1");
        std::fs::create_dir_all(&project).unwrap();
        let no_git = |_: &Path| -> Result<RemoteDeps, CliError> { unreachable!() };
        let report = status(&env, &no_git, &project, &StatusArgs::default()).unwrap();
        assert_eq!(
            (
                report.data["scope"].clone(),
                report.data["projectId"].clone()
            ),
            (json!("library"), json!("lib-1"))
        );
        let _ = matches!(
            resolve_scope(&project, &env.data_root).unwrap(),
            RemoteScope::Library { .. }
        );
    }
}
