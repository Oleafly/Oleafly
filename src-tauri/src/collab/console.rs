use oleafly_collab::CollabError;
use oleafly_collab_protocol::console::{
    AdminOverview, AdminProject, AdminProjectsPage, AdminProjectsQuery,
};
use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};

use super::commands::{authed, parse_id, AppHost, CollabCommandError, CollabHost};
use super::state::CollabState;

fn parse_project(text: &str) -> Result<SharedProjectId, CollabCommandError> {
    parse_id(text, "project")
}

pub async fn admin_overview(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
) -> Result<AdminOverview, CollabError> {
    authed(state, host, server, |client, access| {
        Box::pin(client.admin_overview(access))
    })
    .await
}

pub async fn admin_projects(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    query: AdminProjectsQuery,
) -> Result<AdminProjectsPage, CollabError> {
    authed(state, host, server, move |client, access| {
        let query = query.clone();
        Box::pin(async move { client.admin_projects(access, &query).await })
    })
    .await
}

pub async fn admin_archive_project(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    project: SharedProjectId,
) -> Result<AdminProject, CollabError> {
    authed(state, host, server, move |client, access| {
        Box::pin(client.admin_archive_project(access, project))
    })
    .await
}

pub async fn admin_unarchive_project(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    project: SharedProjectId,
) -> Result<AdminProject, CollabError> {
    authed(state, host, server, move |client, access| {
        Box::pin(client.admin_unarchive_project(access, project))
    })
    .await
}

#[tauri::command]
pub async fn collab_admin_overview(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
) -> Result<AdminOverview, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    admin_overview(state.inner(), &AppHost::new(app), server)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_projects(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    query: AdminProjectsQuery,
) -> Result<AdminProjectsPage, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    admin_projects(state.inner(), &AppHost::new(app), server, query)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_archive_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    project_id: String,
) -> Result<AdminProject, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    let project = parse_project(&project_id)?;
    admin_archive_project(state.inner(), &AppHost::new(app), server, project)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_unarchive_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    project_id: String,
) -> Result<AdminProject, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    let project = parse_project(&project_id)?;
    admin_unarchive_project(state.inner(), &AppHost::new(app), server, project)
        .await
        .map_err(CollabCommandError::from)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use oleafly_collab::{CollabPaths, MemorySecrets, ServerEntry};
    use oleafly_collab_protocol::auth::SessionTokens;
    use oleafly_collab_protocol::console::AdminProjectsQuery;
    use oleafly_collab_protocol::projects::ProjectStatus;
    use oleafly_collab_protocol::roles::ServerRole;
    use oleafly_server::clock::{Clock, ManualClock};
    use oleafly_server::projects;
    use oleafly_server::test_support::{
        seed_member, test_config, SeededMember, TestApp, TestServer,
    };

    use super::*;

    struct QuietHost;

    impl CollabHost for QuietHost {
        fn open_browser(&self, _url: &str) -> Result<(), CollabError> {
            Ok(())
        }

        fn server_changed(&self, _server: ServerId) {}

        fn signed_in(&self) {}

        fn device_name(&self) -> String {
            "Test Mac".to_string()
        }

        fn platform(&self) -> String {
            "macos".to_string()
        }
    }

    async fn seeded(server: &TestServer, role: ServerRole) -> SeededMember {
        let state = server.state().clone();
        let app = TestApp {
            router: oleafly_server::build_router(state.clone()),
            clock: ManualClock::new(Clock::now_ms(state.clock.as_ref())),
            state,
        };
        seed_member(&app, role).await
    }

    async fn signed_in_as(
        dir: &tempfile::TempDir,
        server: &TestServer,
        role: ServerRole,
    ) -> (CollabState, ServerId, SeededMember) {
        let state = CollabState::new(
            CollabPaths::new(dir.path().join("collab")),
            Arc::new(MemorySecrets::default()),
        );
        let caller = seeded(server, role).await;
        let server_id = server.state().server_id;
        state
            .update_registry(|registry| {
                registry.upsert(ServerEntry {
                    server_id,
                    url: server.url(),
                    name: "Smith Lab".to_string(),
                    icon_url: None,
                    account: None,
                    added_at: 0,
                })
            })
            .expect("registry");
        state
            .keys()
            .await
            .expect("keys")
            .sessions
            .store(
                server_id,
                &SessionTokens {
                    account_id: caller.account_id,
                    device_id: caller.device_id,
                    access_token: caller.access_token.clone(),
                    access_expires_at: i64::MAX,
                    refresh_token: "unused".to_string(),
                },
            )
            .expect("session");
        (state, server_id, caller)
    }

    async fn shared(server: &TestServer, owner: &SeededMember) -> SharedProjectId {
        let owner = owner.account_id;
        server
            .state()
            .db
            .call(move |conn| {
                let id = projects::create_pending(conn, owner, "Thesis", 1)?;
                projects::record_snapshot(conn, id, 0, "snapshots/test.bin", 10, owner, 1)?;
                projects::set_status(conn, id, ProjectStatus::Active, 1)?;
                Ok(id)
            })
            .await
            .expect("project")
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn console_commands_reach_the_server() {
        let server = TestServer::start(test_config()).await;
        let dir = tempfile::tempdir().expect("tempdir");
        let (state, id, admin) = signed_in_as(&dir, &server, ServerRole::Admin).await;
        let project = shared(&server, &admin).await;
        let host = QuietHost;
        let overview = admin_overview(&state, &host, id).await.expect("overview");
        assert_eq!(overview.counts.projects, 1);
        let listed = admin_projects(&state, &host, id, AdminProjectsQuery::default())
            .await
            .expect("projects");
        assert_eq!(listed.items[0].project_id, project);
        let archived = admin_archive_project(&state, &host, id, project)
            .await
            .expect("archive");
        assert_eq!(archived.status, ProjectStatus::Archived);
        let restored = admin_unarchive_project(&state, &host, id, project)
            .await
            .expect("unarchive");
        assert_eq!(restored.status, ProjectStatus::Active);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_member_is_refused_and_the_error_code_is_forbidden() {
        let server = TestServer::start(test_config()).await;
        let dir = tempfile::tempdir().expect("tempdir");
        let (state, id, _member) = signed_in_as(&dir, &server, ServerRole::Member).await;
        let refused = admin_overview(&state, &QuietHost, id)
            .await
            .expect_err("members are refused");
        assert_eq!(CollabCommandError::from(refused).code, "forbidden");
    }

    #[test]
    fn ids_from_the_window_are_checked_before_any_request() {
        assert_eq!(
            parse_project("not-an-id").expect_err("bad id").code,
            "not_found"
        );
        assert!(parse_project("0192f0c4-7c00-7000-8000-000000000000").is_ok());
    }
}
