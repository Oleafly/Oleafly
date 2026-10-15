use oleafly_collab::{load_binding, CollabError, ServerClient};
use oleafly_collab_protocol::guests::{
    GuestInvitation, GuestInviteResult, NewGuestInvitation, ProjectGuestInvitations,
};
use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};
use oleafly_collab_protocol::projects::ProjectRole;

use super::commands::{authed, parse_id, ApiCall, AppHost, CollabCommandError, CollabHost};
use super::state::CollabState;

async fn with_project<T, F>(
    state: &CollabState,
    host: &dyn CollabHost,
    project_id: &str,
    call: F,
) -> Result<T, CollabError>
where
    F: for<'a> Fn(&'a ServerClient, &'a str, SharedProjectId) -> ApiCall<'a, T>,
{
    let binding = load_binding(state.paths()?, project_id)?.ok_or_else(|| CollabError::Api {
        status: 404,
        code: "not_found".to_owned(),
        message: "this project is not shared".to_owned(),
    })?;
    let shared = binding.shared_project_id;
    authed(state, host, binding.server_id, |client, access| {
        call(client, access, shared)
    })
    .await
}

pub async fn project_invitations(
    state: &CollabState,
    host: &dyn CollabHost,
    project_id: &str,
) -> Result<ProjectGuestInvitations, CollabError> {
    with_project(state, host, project_id, |client, access, shared| {
        Box::pin(client.guest_invitations(access, shared))
    })
    .await
}

pub async fn invite_guest(
    state: &CollabState,
    host: &dyn CollabHost,
    project_id: &str,
    email: String,
    role: ProjectRole,
) -> Result<GuestInviteResult, CollabError> {
    let request = NewGuestInvitation { email, role };
    with_project(state, host, project_id, move |client, access, shared| {
        let request = request.clone();
        Box::pin(async move { client.invite_guest(access, shared, &request).await })
    })
    .await
}

pub async fn revoke_guest_invitation(
    state: &CollabState,
    host: &dyn CollabHost,
    project_id: &str,
    invitation: &str,
) -> Result<(), CollabError> {
    let invitation = invitation.to_owned();
    with_project(state, host, project_id, move |client, access, shared| {
        let invitation = invitation.clone();
        Box::pin(async move {
            client
                .revoke_guest_invitation(access, shared, &invitation)
                .await
        })
    })
    .await
}

pub async fn admin_guest_invitations(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
) -> Result<Vec<GuestInvitation>, CollabError> {
    authed(state, host, server, |client, access| {
        Box::pin(client.admin_guest_invitations(access))
    })
    .await
}

pub async fn admin_approve_guest(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    invitation: &str,
) -> Result<GuestInvitation, CollabError> {
    let invitation = invitation.to_owned();
    authed(state, host, server, move |client, access| {
        let invitation = invitation.clone();
        Box::pin(async move { client.admin_approve_guest(access, &invitation).await })
    })
    .await
}

pub async fn admin_decline_guest(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    invitation: &str,
) -> Result<GuestInvitation, CollabError> {
    let invitation = invitation.to_owned();
    authed(state, host, server, move |client, access| {
        let invitation = invitation.clone();
        Box::pin(async move { client.admin_decline_guest(access, &invitation).await })
    })
    .await
}

pub async fn admin_revoke_guest(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    invitation: &str,
) -> Result<(), CollabError> {
    let invitation = invitation.to_owned();
    authed(state, host, server, move |client, access| {
        let invitation = invitation.clone();
        Box::pin(async move { client.admin_revoke_guest(access, &invitation).await })
    })
    .await
}

#[tauri::command]
pub async fn collab_guest_invitations(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
) -> Result<ProjectGuestInvitations, CollabCommandError> {
    project_invitations(state.inner(), &AppHost::new(app), &project_id)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_guest_invite(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    email: String,
    role: ProjectRole,
) -> Result<GuestInviteResult, CollabCommandError> {
    invite_guest(state.inner(), &AppHost::new(app), &project_id, email, role)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_guest_invitation_revoke(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    invitation_id: String,
) -> Result<(), CollabCommandError> {
    revoke_guest_invitation(
        state.inner(),
        &AppHost::new(app),
        &project_id,
        &invitation_id,
    )
    .await
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_guest_invitations(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
) -> Result<Vec<GuestInvitation>, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    admin_guest_invitations(state.inner(), &AppHost::new(app), server)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_guest_approve(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    invitation_id: String,
) -> Result<GuestInvitation, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    admin_approve_guest(state.inner(), &AppHost::new(app), server, &invitation_id)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_guest_decline(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    invitation_id: String,
) -> Result<GuestInvitation, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    admin_decline_guest(state.inner(), &AppHost::new(app), server, &invitation_id)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_guest_revoke(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    invitation_id: String,
) -> Result<(), CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    admin_revoke_guest(state.inner(), &AppHost::new(app), server, &invitation_id)
        .await
        .map_err(CollabCommandError::from)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use oleafly_collab::{CollabPaths, MemorySecrets, ServerEntry, ShareBinding};
    use oleafly_collab_protocol::admin::RuntimeSettingsPatch;
    use oleafly_collab_protocol::auth::SessionTokens;
    use oleafly_collab_protocol::guests::GuestInvitationStatus;
    use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};
    use oleafly_collab_protocol::projects::{ProjectRole, ProjectStatus};
    use oleafly_collab_protocol::roles::ServerRole;
    use oleafly_server::clock::{Clock, ManualClock};
    use oleafly_server::projects;
    use oleafly_server::settings;
    use oleafly_server::test_support::{
        seed_member, test_config, SeededMember, TestApp, TestServer,
    };

    use super::*;

    const LOCAL: &str = "reef-survey";

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
        caller: &SeededMember,
    ) -> (CollabState, ServerId) {
        let state = CollabState::new(
            CollabPaths::new(dir.path().join("collab")),
            Arc::new(MemorySecrets::default()),
        );
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
        (state, server_id)
    }

    async fn shared(server: &TestServer, owner: &SeededMember) -> SharedProjectId {
        let owner = owner.account_id;
        server
            .state()
            .db
            .call(move |conn| {
                let id = projects::create_pending(conn, owner, "Reef survey", 1)?;
                projects::record_snapshot(conn, id, 0, "snapshots/test.bin", 10, owner, 1)?;
                projects::set_status(conn, id, ProjectStatus::Active, 1)?;
                settings::patch(
                    conn,
                    &RuntimeSettingsPatch {
                        guests_enabled: Some(true),
                        ..RuntimeSettingsPatch::default()
                    },
                )?;
                Ok(id)
            })
            .await
            .expect("project")
    }

    fn bind(state: &CollabState, server: &TestServer, project: SharedProjectId) {
        oleafly_collab::save_binding(
            state.paths().expect("paths"),
            LOCAL,
            &ShareBinding {
                server_url: server.url(),
                server_id: server.state().server_id,
                shared_project_id: project,
                role: ProjectRole::Owner,
                created_at: 0,
            },
        )
        .expect("binding");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_owner_invites_a_guest_and_staff_answer_it() {
        let server = TestServer::start(test_config()).await;
        let owner = seeded(&server, ServerRole::Member).await;
        let admin = seeded(&server, ServerRole::Admin).await;
        let project = shared(&server, &owner).await;
        let owner_dir = tempfile::tempdir().expect("tempdir");
        let (owner_state, _) = signed_in_as(&owner_dir, &server, &owner).await;
        bind(&owner_state, &server, project);
        let host = QuietHost;
        let made = invite_guest(
            &owner_state,
            &host,
            LOCAL,
            "dana@field.org".to_string(),
            ProjectRole::Editor,
        )
        .await
        .expect("invite");
        assert_eq!(
            made.invitation.status,
            GuestInvitationStatus::AwaitingApproval
        );
        let listed = project_invitations(&owner_state, &host, LOCAL)
            .await
            .expect("list");
        assert_eq!(listed.invitations.len(), 1);
        assert!(listed.approval_required);
        let admin_dir = tempfile::tempdir().expect("tempdir");
        let (admin_state, server_id) = signed_in_as(&admin_dir, &server, &admin).await;
        let pending = admin_guest_invitations(&admin_state, &host, server_id)
            .await
            .expect("pending");
        assert_eq!(pending.len(), 1);
        let approved = admin_approve_guest(&admin_state, &host, server_id, &pending[0].id)
            .await
            .expect("approve");
        assert_eq!(approved.status, GuestInvitationStatus::Invited);
        revoke_guest_invitation(&owner_state, &host, LOCAL, &made.invitation.id)
            .await
            .expect("revoke");
        let second = invite_guest(
            &owner_state,
            &host,
            LOCAL,
            "eve@field.org".to_string(),
            ProjectRole::Viewer,
        )
        .await
        .expect("invite");
        let declined = admin_decline_guest(&admin_state, &host, server_id, &second.invitation.id)
            .await
            .expect("decline");
        assert_eq!(declined.status, GuestInvitationStatus::Declined);
        let third = invite_guest(
            &owner_state,
            &host,
            LOCAL,
            "finn@field.org".to_string(),
            ProjectRole::Viewer,
        )
        .await
        .expect("invite");
        admin_revoke_guest(&admin_state, &host, server_id, &third.invitation.id)
            .await
            .expect("withdraw");
        assert!(admin_guest_invitations(&admin_state, &host, server_id)
            .await
            .expect("pending")
            .is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_project_that_is_not_shared_or_a_member_is_refused() {
        let server = TestServer::start(test_config()).await;
        let member = seeded(&server, ServerRole::Member).await;
        let dir = tempfile::tempdir().expect("tempdir");
        let (state, server_id) = signed_in_as(&dir, &server, &member).await;
        let host = QuietHost;
        let unshared = project_invitations(&state, &host, "never-shared")
            .await
            .expect_err("no binding");
        assert_eq!(CollabCommandError::from(unshared).code, "not_found");
        let refused = admin_guest_invitations(&state, &host, server_id)
            .await
            .expect_err("members are refused");
        assert_eq!(CollabCommandError::from(refused).code, "forbidden");
    }
}
