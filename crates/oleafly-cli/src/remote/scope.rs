use std::path::{Path, PathBuf};

use oleafly_online::client::{project_id_in, valid_project_id};
use oleafly_online::projects::{imported_from, ImportedFrom};
use oleafly_online::service::DEFAULT_SERVER;
use oleafly_online::session;
use oleafly_online::sync::{read_link, SyncLink, SyncPaths, WorktreeLock};
use oleafly_online::{OnlineError, OnlineErrorKind};
use oleafly_secrets::SecretStore;
use serde_json::Value;
use zeroize::Zeroizing;

use crate::app_paths::ProjectIdentity;
use crate::auth::shared::{from_online, Env};
use crate::contract::{CliError, ErrorKind};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum RemoteScope {
    Library {
        project_id: String,
        root: PathBuf,
    },
    Linked {
        project_id: String,
        state_dir: PathBuf,
        root: PathBuf,
    },
    Folder {
        root: PathBuf,
    },
}

pub(crate) fn resolve_scope(folder: &Path, data_root: &Path) -> Result<RemoteScope, CliError> {
    let not_a_folder = || {
        CliError::new(
            ErrorKind::InvalidInput,
            "remote.not_a_folder",
            format!("{} isn't a folder.", folder.display()),
        )
    };
    let root = dunce::canonicalize(folder).map_err(|_| not_a_folder())?;
    if !root.is_dir() {
        return Err(not_a_folder());
    }
    Ok(match crate::app_paths::project_identity(&root, data_root) {
        Some(ProjectIdentity::Library { id }) => RemoteScope::Library {
            project_id: id,
            root,
        },
        Some(ProjectIdentity::Linked { id, state_dir }) => RemoteScope::Linked {
            project_id: id,
            state_dir,
            root,
        },
        None => RemoteScope::Folder { root },
    })
}

impl RemoteScope {
    pub(crate) fn root(&self) -> &Path {
        match self {
            Self::Library { root, .. } | Self::Linked { root, .. } | Self::Folder { root } => root,
        }
    }

    pub(crate) fn kind(&self) -> &'static str {
        match self {
            Self::Library { .. } => "library",
            Self::Linked { .. } | Self::Folder { .. } => "folder",
        }
    }

    fn app_identity(&self) -> Option<ProjectIdentity> {
        match self {
            Self::Library { project_id, .. } => Some(ProjectIdentity::Library {
                id: project_id.clone(),
            }),
            Self::Linked {
                project_id,
                state_dir,
                ..
            } => Some(ProjectIdentity::Linked {
                id: project_id.clone(),
                state_dir: state_dir.clone(),
            }),
            Self::Folder { .. } => None,
        }
    }

    pub(crate) fn ensure_no_pending_restore(&self) -> Result<(), CliError> {
        match self.app_identity() {
            Some(identity) if crate::app_paths::restore_pending(self.root(), &identity) => {
                Err(CliError::new(
                    ErrorKind::Conflict,
                    "conflict.restore_pending",
                    "The app is restoring a checkpoint of this project.",
                )
                .hint("Open the project in Oleafly to finish the restore, then try again.")
                .retryable())
            }
            _ => Ok(()),
        }
    }

    pub(crate) fn revoke_shell_escape_trust(&self, data_root: &Path) -> Result<(), CliError> {
        match self.app_identity() {
            Some(identity) => crate::app_paths::revoke_shell_escape_trust(data_root, identity.id()),
            None => Ok(()),
        }
    }

    pub(crate) fn project_id(&self) -> Option<&str> {
        match self {
            Self::Library { project_id, .. } => Some(project_id),
            Self::Linked { .. } | Self::Folder { .. } => None,
        }
    }

    pub(crate) fn sync_paths(&self, data_root: &Path) -> Result<SyncPaths, CliError> {
        match self {
            Self::Library { project_id, .. } => SyncPaths::for_app_project(data_root, project_id)
                .map_err(|error| from_online(&error)),
            Self::Linked { root, .. } | Self::Folder { root } => Ok(SyncPaths::for_folder(root)),
        }
    }

    pub(crate) fn worktree_lock(&self, data_root: &Path) -> Option<WorktreeLock> {
        match self {
            Self::Library { project_id, .. } | Self::Linked { project_id, .. } => {
                Some(WorktreeLock::new(
                    data_root
                        .join("project-worktree-locks")
                        .join(format!("{project_id}.lock")),
                ))
            }
            Self::Folder { .. } => None,
        }
    }

    pub(crate) fn imported_from(&self) -> Option<ImportedFrom> {
        let raw = std::fs::read_to_string(self.root().join("project.json")).ok()?;
        let meta: Value = serde_json::from_str(&raw).ok()?;
        let origin = imported_from(meta.get("importedFrom")?)?;
        Some(ImportedFrom {
            server: session::normalize_server(Some(&origin.server)).ok()?,
            project_id: valid_project_id(&origin.project_id).then_some(origin.project_id)?,
        })
    }

    pub(crate) fn current_link(&self, data_root: &Path) -> Result<Option<SyncLink>, CliError> {
        let link = read_link(&self.sync_paths(data_root)?).map_err(|error| from_online(&error))?;
        let link = link
            .map(|link| {
                let server = session::normalize_server(Some(&link.server))
                    .map_err(|error| from_online(&error))?;
                if !valid_project_id(&link.remote_id) {
                    return Err(from_online(&OnlineError::new(
                        OnlineErrorKind::ProjectUnavailable,
                    )));
                }
                Ok(SyncLink { server, ..link })
            })
            .transpose()?;
        Ok(match self {
            Self::Library { .. } => link.filter(|link| {
                self.imported_from()
                    .is_some_and(|origin| origin.project_id == link.remote_id)
            }),
            Self::Linked { .. } | Self::Folder { .. } => link,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RemoteRef {
    pub server: String,
    pub project_id: String,
}

fn invalid_ref(input: &str) -> CliError {
    CliError::new(
        ErrorKind::Usage,
        "remote.invalid_project",
        format!("\"{input}\" isn't an online project ID or address."),
    )
    .hint("Use the project's ID or its address, such as https://latex.example.edu/project/64a1f0.")
}

pub(crate) fn parse_remote_ref(
    input: &str,
    server_flag: Option<&str>,
    store: &SecretStore,
) -> Result<RemoteRef, CliError> {
    let input = input.trim();
    if input.contains("://") {
        let url = url::Url::parse(input).map_err(|_| invalid_ref(input))?;
        let path = url.path();
        let at = path.rfind("/project/").ok_or_else(|| invalid_ref(input))?;
        let project_id = project_id_in(input).ok_or_else(|| invalid_ref(input))?;
        let mut base = url.clone();
        base.set_path(&path[..at]);
        base.set_query(None);
        base.set_fragment(None);
        let server =
            session::normalize_server(Some(base.as_str())).map_err(|error| from_online(&error))?;
        if let Some(flag) = server_flag {
            let flag =
                session::normalize_server(Some(flag)).map_err(|error| from_online(&error))?;
            if flag != server {
                return Err(CliError::new(
                    ErrorKind::Usage,
                    "remote.server_mismatch",
                    format!("The project address is on {server}, not {flag}."),
                ));
            }
        }
        return Ok(RemoteRef { server, project_id });
    }
    if !valid_project_id(input) {
        return Err(invalid_ref(input));
    }
    let server = match server_flag {
        Some(flag) => session::normalize_server(Some(flag)),
        None => session::default_server(store),
    }
    .map_err(|error| from_online(&error))?;
    Ok(RemoteRef {
        server,
        project_id: input.to_string(),
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TokenSource {
    Env,
    Store,
}

impl TokenSource {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Env => "env",
            Self::Store => "store",
        }
    }
}

pub(crate) fn server_is_known(env: &Env, server: &str) -> Result<bool, CliError> {
    if server == DEFAULT_SERVER {
        return Ok(true);
    }
    let signed_in = |servers: Result<Vec<String>, OnlineError>| {
        servers
            .map(|servers| servers.iter().any(|known| known == server))
            .map_err(|error| from_online(&error))
    };
    Ok(signed_in(session::session_servers(&env.store))?
        || signed_in(session::git_token_servers(&env.store))?)
}

fn env_token_allowed(env: &Env, server: &str, named_by_user: bool) -> Result<bool, CliError> {
    Ok(named_by_user || server_is_known(env, server)?)
}

pub(crate) fn git_token_for(
    env: &Env,
    server: &str,
    named_by_user: bool,
) -> Result<(Zeroizing<String>, TokenSource), CliError> {
    if let Some(token) = &env.online_git_token {
        if env_token_allowed(env, server, named_by_user)? {
            return Ok((token.clone(), TokenSource::Env));
        }
    }
    match session::git_token(&env.store, server).map_err(|error| from_online(&error))? {
        Some(token) => Ok((Zeroizing::new(token), TokenSource::Store)),
        None => Err(crate::auth::online::online_error(
            OnlineError::new(OnlineErrorKind::GitTokenMissing),
            server,
        )),
    }
}

pub(crate) fn project_url(server: &str, project_id: &str) -> String {
    format!("{server}/project/{project_id}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::test_env::env_at;

    fn write_link(paths: &SyncPaths, remote: &str) {
        oleafly_online::sync::write_link(
            paths,
            &SyncLink {
                server: "https://latex.example.edu".into(),
                remote_id: remote.into(),
                linked_at: 1,
                auto: true,
                last_sync_at: None,
            },
        )
        .unwrap();
    }

    #[test]
    fn a_folder_inside_the_app_library_uses_the_app_sync_state() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let project = data.join("projects").join("abc-123");
        std::fs::create_dir_all(&project).unwrap();
        let scope = resolve_scope(&project, &data).unwrap();
        assert_eq!(scope.project_id(), Some("abc-123"));
        let paths = scope.sync_paths(&data).unwrap();
        assert!(
            paths
                .dir
                .ends_with(Path::new(oleafly_online::service::APP_SYNC_DIR).join("abc-123")),
            "{}",
            paths.dir.display()
        );
        assert!(scope
            .worktree_lock(&data)
            .unwrap()
            .path
            .ends_with("project-worktree-locks/abc-123.lock"));
    }

    #[test]
    fn any_other_folder_keeps_its_state_inside() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let elsewhere = dir.path().join("elsewhere").join("abc-123");
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::fs::create_dir_all(data.join("projects")).unwrap();
        let scope = resolve_scope(&elsewhere, &data).unwrap();
        assert_eq!(scope.kind(), "folder");
        assert!(scope
            .sync_paths(&data)
            .unwrap()
            .dir
            .ends_with(".oleafly/online"));
        assert!(scope.worktree_lock(&data).is_none());
        let file = dir.path().join("note.txt");
        std::fs::write(&file, "x").unwrap();
        assert_eq!(
            resolve_scope(&file, &data).unwrap_err().code,
            "remote.not_a_folder"
        );
    }

    #[test]
    fn a_library_link_counts_only_when_it_matches_where_the_project_came_from() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let project = data.join("projects").join("p1");
        std::fs::create_dir_all(&project).unwrap();
        let record = |remote: &str| {
            serde_json::json!({"importedFrom": {"service": oleafly_online::service::SERVICE_ID, "server": "https://latex.example.edu", "projectId": remote}})
                .to_string()
        };
        std::fs::write(project.join("project.json"), record("b2")).unwrap();
        let scope = resolve_scope(&project, &data).unwrap();
        write_link(&scope.sync_paths(&data).unwrap(), "a1");
        assert_eq!(scope.current_link(&data).unwrap(), None);
        std::fs::write(project.join("project.json"), record("a1")).unwrap();
        assert_eq!(scope.current_link(&data).unwrap().unwrap().remote_id, "a1");
    }

    #[test]
    fn remote_refs_accept_ids_and_project_urls() {
        let dir = tempfile::tempdir().unwrap();
        let store = SecretStore::at(dir.path());
        assert_eq!(
            parse_remote_ref("64a1f0", Some("https://latex.example.edu"), &store)
                .unwrap()
                .project_id,
            "64a1f0"
        );
        let parsed = parse_remote_ref(
            "https://latex.example.edu/sub/project/64a1f0?x=1",
            None,
            &store,
        )
        .unwrap();
        assert_eq!(
            (parsed.server.as_str(), parsed.project_id.as_str()),
            ("https://latex.example.edu/sub", "64a1f0")
        );
        assert_eq!(
            parse_remote_ref("https://a.edu/project/1", Some("https://b.edu"), &store)
                .unwrap_err()
                .kind,
            ErrorKind::Usage
        );
        assert_eq!(
            parse_remote_ref("../x", None, &store).unwrap_err().kind,
            ErrorKind::Usage
        );
        assert_eq!(
            parse_remote_ref("https://a.edu/dashboard", None, &store)
                .unwrap_err()
                .code,
            "remote.invalid_project"
        );
    }

    fn linked_scope(data: &Path, folder: &Path) -> (RemoteScope, PathBuf) {
        let state_dir = data.join("linked").join("l-1");
        std::fs::create_dir_all(state_dir.join("state")).unwrap();
        let scope = RemoteScope::Linked {
            project_id: "l-1".into(),
            state_dir: state_dir.clone(),
            root: folder.to_path_buf(),
        };
        (scope, state_dir)
    }

    #[test]
    fn a_folder_the_app_opened_in_place_shares_the_apps_lock_and_restore_marker() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let folder = dir.path().join("paper");
        std::fs::create_dir_all(&folder).unwrap();
        let (scope, state_dir) = linked_scope(&data, &folder);
        assert_eq!(scope.kind(), "folder");
        assert_eq!(scope.project_id(), None);
        assert!(scope
            .sync_paths(&data)
            .unwrap()
            .dir
            .ends_with(".oleafly/online"));
        assert!(scope
            .worktree_lock(&data)
            .unwrap()
            .path
            .ends_with("project-worktree-locks/l-1.lock"));
        scope.ensure_no_pending_restore().unwrap();
        std::fs::write(
            state_dir.join("state").join("checkpoint-restore-pending"),
            "",
        )
        .unwrap();
        let error = scope.ensure_no_pending_restore().unwrap_err();
        assert_eq!(
            (error.code.as_ref(), error.exit() as u8, error.retryable),
            ("conflict.restore_pending", 8, true)
        );
        let trust = data.join("device-trust").join("latex-shell-escape");
        std::fs::create_dir_all(&trust).unwrap();
        std::fs::write(trust.join("l-1.json"), "{}").unwrap();
        scope.revoke_shell_escape_trust(&data).unwrap();
        assert!(!trust.join("l-1.json").exists());
        let plain = RemoteScope::Folder { root: folder };
        plain.ensure_no_pending_restore().unwrap();
        plain.revoke_shell_escape_trust(&data).unwrap();
        assert!(plain.worktree_lock(&data).is_none());
    }

    #[test]
    fn where_a_folder_says_it_came_from_is_only_believed_when_it_is_usable() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("paper");
        std::fs::create_dir_all(&folder).unwrap();
        let scope = RemoteScope::Folder {
            root: folder.clone(),
        };
        let origin = |server: &str, project_id: &str| {
            let record = serde_json::json!({"importedFrom": {
                "service": oleafly_online::service::SERVICE_ID,
                "server": server,
                "projectId": project_id,
            }});
            std::fs::write(folder.join("project.json"), record.to_string()).unwrap();
            scope.imported_from()
        };
        let good = origin("https://LaTeX.Example.edu/", "64a1f0").unwrap();
        assert_eq!(
            (good.server.as_str(), good.project_id.as_str()),
            ("https://latex.example.edu", "64a1f0")
        );
        let unc = origin("\\\\attacker\\share", "64a1f0").unwrap();
        assert!(unc.server.starts_with("https://"), "{}", unc.server);
        for server in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "http://latex.example.edu",
            "https://user:pw@latex.example.edu",
        ] {
            assert_eq!(origin(server, "64a1f0"), None, "{server}");
        }
        assert_eq!(origin("https://latex.example.edu", "../x"), None);
        assert_eq!(origin("https://latex.example.edu", "a b"), None);
    }

    #[test]
    fn a_link_record_in_the_folder_is_checked_before_it_is_used() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let folder = dir.path().join("paper");
        std::fs::create_dir_all(&folder).unwrap();
        let scope = RemoteScope::Folder { root: folder };
        let paths = scope.sync_paths(&data).unwrap();
        write_link(&paths, "64a1f0");
        assert_eq!(
            scope.current_link(&data).unwrap().unwrap().server,
            "https://latex.example.edu"
        );
        for (server, remote) in [
            ("http://latex.example.edu", "64a1f0"),
            ("file:///etc", "64a1f0"),
            ("https://latex.example.edu", "../x"),
        ] {
            oleafly_online::sync::write_link(
                &paths,
                &SyncLink {
                    server: server.into(),
                    remote_id: remote.into(),
                    linked_at: 1,
                    auto: true,
                    last_sync_at: None,
                },
            )
            .unwrap();
            assert!(scope.current_link(&data).is_err(), "{server} {remote}");
        }
    }

    #[test]
    fn the_env_token_only_goes_to_servers_the_user_chose_or_signed_in_to() {
        let dir = tempfile::tempdir().unwrap();
        let mut env = env_at(dir.path());
        env.online_git_token = Some(Zeroizing::new("env_TOKEN44".into()));
        let planted = "https://evil.example";
        let error = git_token_for(&env, planted, false).unwrap_err();
        assert_eq!(error.code, "online.git_token_missing");
        assert_eq!(
            git_token_for(&env, planted, true).unwrap().1,
            TokenSource::Env
        );
        assert_eq!(
            git_token_for(&env, DEFAULT_SERVER, false).unwrap().1,
            TokenSource::Env
        );
        let known = "https://latex.example.edu";
        assert!(git_token_for(&env, known, false).is_err());
        session::save(
            &env.store,
            known,
            &session::Session {
                cookie: "s=1".into(),
                user_id: "u".into(),
                email: "a@b.c".into(),
                saved_by: None,
            },
        )
        .unwrap();
        assert_eq!(
            git_token_for(&env, known, false).unwrap().1,
            TokenSource::Env
        );
        session::save_git_token(&env.store, planted, "olp_GITTOKEN88").unwrap();
        assert_eq!(
            git_token_for(&env, planted, false).unwrap().1,
            TokenSource::Env
        );
    }

    #[test]
    fn the_env_token_wins_and_a_missing_token_says_how_to_add_one() {
        let dir = tempfile::tempdir().unwrap();
        let mut env = env_at(dir.path());
        let error = git_token_for(&env, "https://latex.example.edu", false).unwrap_err();
        assert_eq!(
            (error.code.as_ref(), error.kind),
            ("online.git_token_missing", ErrorKind::Auth)
        );
        assert!(error
            .hint
            .unwrap()
            .contains("oleafly auth login online --with-token"));
        session::save_git_token(&env.store, "https://latex.example.edu", "olp_GITTOKEN88").unwrap();
        assert_eq!(
            git_token_for(&env, "https://latex.example.edu", false)
                .unwrap()
                .1,
            TokenSource::Store
        );
        env.online_git_token = Some(Zeroizing::new("env_TOKEN44".into()));
        assert_eq!(
            git_token_for(&env, "https://latex.example.edu", false)
                .unwrap()
                .1,
            TokenSource::Env
        );
    }
}
