use std::path::Path;

use oleafly_collab::{load_binding, ServerEntry};
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::roles::ProjectRole;

use super::account::CliCollab;
use super::ProjectArgs;
use crate::app_paths::ProjectIdentity;
use crate::auth::shared::Env;
use crate::contract::{CliError, ErrorKind};

pub(crate) struct SharedTarget {
    pub entry: ServerEntry,
    pub shared: SharedProjectId,
    pub local_project_id: Option<String>,
    pub saved_role: Option<ProjectRole>,
}

fn not_shared() -> CliError {
    CliError::new(
        ErrorKind::InvalidInput,
        "server.not_shared",
        "This folder isn't a shared project.",
    )
    .hint("Pass --shared and --server, or share it from the Oleafly app.")
}

fn local_for(collab: &CliCollab, shared: SharedProjectId) -> Option<String> {
    let entries = std::fs::read_dir(collab.app_paths.root()).ok()?;
    entries.flatten().find_map(|entry| {
        let id = entry.file_name().to_str()?.to_string();
        let binding = load_binding(&collab.app_paths, &id).ok()??;
        (binding.shared_project_id == shared).then_some(id)
    })
}

pub(crate) fn resolve_target(
    collab: &CliCollab,
    env: &Env,
    folder: &Path,
    args: &ProjectArgs,
) -> Result<SharedTarget, CliError> {
    if let Some(shared) = &args.shared {
        let server = args.server.as_deref().ok_or_else(|| {
            CliError::new(
                ErrorKind::Usage,
                "server.shared_needs_server",
                "Pass --server with --shared.",
            )
            .hint("Run oleafly server projects to see both.")
        })?;
        let shared: SharedProjectId = shared.trim().parse().map_err(|_| {
            CliError::new(
                ErrorKind::Usage,
                "server.invalid_project",
                format!("\"{shared}\" isn't a shared project ID."),
            )
        })?;
        let entry = collab.find_server(server)?;
        return Ok(SharedTarget {
            local_project_id: local_for(collab, shared),
            entry,
            shared,
            saved_role: None,
        });
    }
    let local = match crate::app_paths::project_identity(folder, &env.data_root) {
        Some(ProjectIdentity::Library { id } | ProjectIdentity::Linked { id, .. }) => id,
        None => return Err(not_shared()),
    };
    let binding = load_binding(&collab.app_paths, &local)
        .map_err(|error| collab.local(&error))?
        .ok_or_else(not_shared)?;
    let entry = collab
        .registry()?
        .get(binding.server_id)
        .cloned()
        .ok_or_else(|| {
            CliError::new(
                ErrorKind::Auth,
                "server.signed_out",
                format!(
                    "This command line isn't signed in to {}.",
                    binding.server_url
                ),
            )
            .hint(format!(
                "Run oleafly server sign-in {}.",
                binding.server_url
            ))
        })?;
    Ok(SharedTarget {
        entry,
        shared: binding.shared_project_id,
        local_project_id: Some(local),
        saved_role: Some(binding.role),
    })
}

#[cfg(test)]
mod tests {
    use oleafly_collab::{save_binding, ServerRegistry, ShareBinding};
    use oleafly_collab_protocol::ids::ServerId;

    use super::*;
    use crate::auth::test_env::env_at;

    fn seed(env: &Env, local: &str) -> (CliCollab, ServerId, SharedProjectId) {
        let collab = CliCollab::open(env);
        let server = ServerId::new_v7();
        let shared = SharedProjectId::new_v7();
        save_binding(
            &collab.app_paths,
            local,
            &ShareBinding {
                server_url: "https://collab.uni.edu".into(),
                server_id: server,
                shared_project_id: shared,
                role: ProjectRole::Owner,
                created_at: 1,
            },
        )
        .unwrap();
        (collab, server, shared)
    }

    fn sign_in_cli(collab: &CliCollab, server: ServerId) {
        let mut registry = ServerRegistry::default();
        registry.upsert(ServerEntry {
            server_id: server,
            url: "https://collab.uni.edu".into(),
            name: "Lab".into(),
            icon_url: None,
            account: None,
            added_at: 1,
        });
        registry.save(&collab.paths).unwrap();
    }

    #[test]
    fn a_library_folder_finds_its_share_binding() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let folder = env.projects_root().join("abc");
        std::fs::create_dir_all(&folder).unwrap();
        let (collab, server, shared) = seed(&env, "abc");
        let error = resolve_target(&collab, &env, &folder, &ProjectArgs::default())
            .err()
            .unwrap();
        assert_eq!(
            (error.code.as_ref(), error.exit() as u8),
            ("server.signed_out", 6)
        );
        sign_in_cli(&collab, server);
        let target = resolve_target(&collab, &env, &folder, &ProjectArgs::default()).unwrap();
        assert_eq!(
            (target.shared, target.local_project_id.as_deref()),
            (shared, Some("abc"))
        );
        let by_id = ProjectArgs {
            shared: Some(shared.to_string()),
            server: Some("Lab".into()),
        };
        assert_eq!(
            resolve_target(&collab, &env, dir.path(), &by_id)
                .unwrap()
                .local_project_id
                .as_deref(),
            Some("abc")
        );
    }

    #[test]
    fn an_unshared_folder_says_to_share_from_the_app() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let collab = CliCollab::open(&env);
        let error = resolve_target(&collab, &env, dir.path(), &ProjectArgs::default())
            .err()
            .unwrap();
        assert_eq!(
            (error.code.as_ref(), error.exit() as u8),
            ("server.not_shared", 3)
        );
        let half = ProjectArgs {
            shared: Some("x".into()),
            server: None,
        };
        assert_eq!(
            resolve_target(&collab, &env, dir.path(), &half)
                .err()
                .unwrap()
                .code,
            "server.shared_needs_server"
        );
    }
}
