//! Which sync state a folder uses. A project in the Oleafly app's library
//! shares the app's private mirror and link record, so the app and the
//! command line agree; any other folder keeps its own inside itself
//! (`.oleafly/online/`), so a copied folder can never pair a base with the
//! wrong files.
use std::path::{Path, PathBuf};

use oleafly_online::client::{project_id_in, valid_project_id};
use oleafly_online::projects::{imported_from, ImportedFrom};
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
    Library { project_id: String, root: PathBuf },
    Folder { root: PathBuf },
}

/// The scope of `folder`, which must be a folder.
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
        _ => RemoteScope::Folder { root },
    })
}

impl RemoteScope {
    pub(crate) fn root(&self) -> &Path {
        match self {
            Self::Library { root, .. } | Self::Folder { root } => root,
        }
    }

    pub(crate) fn kind(&self) -> &'static str {
        match self {
            Self::Library { .. } => "library",
            Self::Folder { .. } => "folder",
        }
    }

    pub(crate) fn project_id(&self) -> Option<&str> {
        match self {
            Self::Library { project_id, .. } => Some(project_id),
            Self::Folder { .. } => None,
        }
    }

    pub(crate) fn sync_paths(&self, data_root: &Path) -> Result<SyncPaths, CliError> {
        match self {
            Self::Library { project_id, .. } => SyncPaths::for_app_project(data_root, project_id)
                .map_err(|error| from_online(&error)),
            Self::Folder { root } => Ok(SyncPaths::for_folder(root)),
        }
    }

    /// The app's lock on a library project's files, held while the
    /// command line writes them.
    pub(crate) fn worktree_lock(&self, data_root: &Path) -> Option<WorktreeLock> {
        match self {
            Self::Library { project_id, .. } => Some(WorktreeLock::new(
                data_root
                    .join("project-worktree-locks")
                    .join(format!("{project_id}.lock")),
            )),
            Self::Folder { .. } => None,
        }
    }

    /// Where the project came from (`project.json` `importedFrom`).
    pub(crate) fn imported_from(&self) -> Option<ImportedFrom> {
        let raw = std::fs::read_to_string(self.root().join("project.json")).ok()?;
        let meta: Value = serde_json::from_str(&raw).ok()?;
        imported_from(meta.get("importedFrom")?)
    }

    /// The folder's link. A library project's counts only when it matches
    /// where the project came from, as in the app.
    pub(crate) fn current_link(&self, data_root: &Path) -> Result<Option<SyncLink>, CliError> {
        let link = read_link(&self.sync_paths(data_root)?).map_err(|error| from_online(&error))?;
        Ok(match self {
            Self::Library { .. } => link.filter(|link| {
                self.imported_from()
                    .is_some_and(|origin| origin.project_id == link.remote_id)
            }),
            Self::Folder { .. } => link,
        })
    }
}

/// An online project named by its ID or its address.
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

/// `64a1f0` (with `--server` or the default server) or
/// `https://latex.example.edu/project/64a1f0`.
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

/// Where a Git token came from.
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

/// The Git token for `server`: `OLEAFLY_ONLINE_GIT_TOKEN` first.
pub(crate) fn git_token_for(
    env: &Env,
    server: &str,
) -> Result<(Zeroizing<String>, TokenSource), CliError> {
    if let Some(token) = &env.online_git_token {
        return Ok((token.clone(), TokenSource::Env));
    }
    match session::git_token(&env.store, server).map_err(|error| from_online(&error))? {
        Some(token) => Ok((Zeroizing::new(token), TokenSource::Store)),
        None => Err(crate::auth::online::online_error(
            OnlineError::new(OnlineErrorKind::GitTokenMissing),
            server,
        )),
    }
}

/// The project's page on the service.
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

    #[test]
    fn the_env_token_wins_and_a_missing_token_says_how_to_add_one() {
        let dir = tempfile::tempdir().unwrap();
        let mut env = env_at(dir.path());
        let error = git_token_for(&env, "https://latex.example.edu").unwrap_err();
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
            git_token_for(&env, "https://latex.example.edu").unwrap().1,
            TokenSource::Store
        );
        env.online_git_token = Some(Zeroizing::new("env_TOKEN44".into()));
        assert_eq!(
            git_token_for(&env, "https://latex.example.edu").unwrap().1,
            TokenSource::Env
        );
    }
}
