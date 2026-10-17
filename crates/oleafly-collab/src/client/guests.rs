use oleafly_collab_protocol::guests::{
    GuestInvitation, GuestInviteResult, NewGuestInvitation, ProjectGuestInvitations,
};
use oleafly_collab_protocol::ids::SharedProjectId;
use reqwest::RequestBuilder;

use super::http::{check_status, json, network_error};
use super::ServerClient;
use crate::CollabError;

async fn done(request: RequestBuilder) -> Result<(), CollabError> {
    check_status(request.send().await.map_err(network_error)?)
        .await
        .map(|_| ())
}

impl ServerClient {
    fn invitations_url(&self, project: SharedProjectId, extra: &[&str]) -> ::url::Url {
        let mut url = self.url().endpoint("api/v1/projects");
        if let Ok(mut segments) = url.path_segments_mut() {
            segments.push(&project.to_string());
            segments.push("invitations");
            segments.extend(extra);
        }
        url
    }

    fn pending_url(&self, extra: &[&str]) -> ::url::Url {
        let mut url = self.url().endpoint("api/v1/admin/guest-invitations");
        if let Ok(mut segments) = url.path_segments_mut() {
            segments.extend(extra);
        }
        url
    }

    pub async fn guest_invitations(
        &self,
        access: &str,
        project: SharedProjectId,
    ) -> Result<ProjectGuestInvitations, CollabError> {
        json(
            self.http()
                .get(self.invitations_url(project, &[]))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn invite_guest(
        &self,
        access: &str,
        project: SharedProjectId,
        invitation: &NewGuestInvitation,
    ) -> Result<GuestInviteResult, CollabError> {
        json(
            self.http()
                .post(self.invitations_url(project, &[]))
                .bearer_auth(access)
                .json(invitation),
        )
        .await
    }

    pub async fn revoke_guest_invitation(
        &self,
        access: &str,
        project: SharedProjectId,
        invitation: &str,
    ) -> Result<(), CollabError> {
        done(
            self.http()
                .delete(self.invitations_url(project, &[invitation]))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn admin_guest_invitations(
        &self,
        access: &str,
    ) -> Result<Vec<GuestInvitation>, CollabError> {
        json(self.http().get(self.pending_url(&[])).bearer_auth(access)).await
    }

    pub async fn admin_approve_guest(
        &self,
        access: &str,
        invitation: &str,
    ) -> Result<GuestInvitation, CollabError> {
        json(
            self.http()
                .post(self.pending_url(&[invitation, "approve"]))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn admin_decline_guest(
        &self,
        access: &str,
        invitation: &str,
    ) -> Result<GuestInvitation, CollabError> {
        json(
            self.http()
                .post(self.pending_url(&[invitation, "decline"]))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn admin_revoke_guest(
        &self,
        access: &str,
        invitation: &str,
    ) -> Result<(), CollabError> {
        done(
            self.http()
                .delete(self.pending_url(&[invitation]))
                .bearer_auth(access),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use oleafly_collab_protocol::admin::RuntimeSettingsPatch;
    use oleafly_collab_protocol::guests::{GuestInvitationStatus, NewGuestInvitation};
    use oleafly_collab_protocol::ids::SharedProjectId;
    use oleafly_collab_protocol::projects::{ProjectRole, ProjectStatus};
    use oleafly_collab_protocol::roles::ServerRole;
    use oleafly_server::projects;
    use oleafly_server::test_support::{test_config, SeededMember, TestServer};

    use crate::client::test_util::{seed, server_url};
    use crate::client::ServerClient;
    use crate::CollabError;

    async fn stage() -> (TestServer, ServerClient, SeededMember, SeededMember) {
        let server = TestServer::start(test_config()).await;
        let admin = seed(&server, ServerRole::Admin).await;
        let member = seed(&server, ServerRole::Member).await;
        let client = ServerClient::new(server_url(&server)).expect("client");
        (server, client, admin, member)
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
                Ok(id)
            })
            .await
            .expect("project")
    }

    fn request(email: &str) -> NewGuestInvitation {
        NewGuestInvitation {
            email: email.to_string(),
            role: ProjectRole::Viewer,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_owner_invites_lists_and_revokes_guests() {
        let (server, client, admin, member) = stage().await;
        let project = shared(&server, &member).await;
        let before = client
            .guest_invitations(&member.access_token, project)
            .await
            .expect("list");
        assert!(!before.guests_enabled);
        assert!(before.add_link.starts_with("oleafly://server/add?url="));
        client
            .admin_patch_settings(
                &admin.access_token,
                &RuntimeSettingsPatch {
                    guests_enabled: Some(true),
                    guest_approval_required: Some(false),
                    ..RuntimeSettingsPatch::default()
                },
            )
            .await
            .expect("guests on");
        let made = client
            .invite_guest(&member.access_token, project, &request("dana@field.org"))
            .await
            .expect("invite");
        assert_eq!(made.invitation.status, GuestInvitationStatus::Invited);
        assert!(!made.emailed);
        let listed = client
            .guest_invitations(&member.access_token, project)
            .await
            .expect("list");
        assert_eq!(listed.invitations.len(), 1);
        let refused = client.guest_invitations(&admin.access_token, project).await;
        assert!(matches!(refused, Err(CollabError::Api { status: 404, .. })));
        client
            .revoke_guest_invitation(&member.access_token, project, &made.invitation.id)
            .await
            .expect("revoke");
        let after = client
            .guest_invitations(&member.access_token, project)
            .await
            .expect("list");
        assert!(after.invitations.is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn staff_approve_decline_and_withdraw_pending_guests() {
        let (server, client, admin, member) = stage().await;
        let project = shared(&server, &member).await;
        client
            .admin_patch_settings(
                &admin.access_token,
                &RuntimeSettingsPatch {
                    guests_enabled: Some(true),
                    ..RuntimeSettingsPatch::default()
                },
            )
            .await
            .expect("guests on");
        let mut ids = Vec::new();
        for email in ["a@field.org", "b@field.org", "c@field.org"] {
            let made = client
                .invite_guest(&member.access_token, project, &request(email))
                .await
                .expect("invite");
            assert_eq!(
                made.invitation.status,
                GuestInvitationStatus::AwaitingApproval
            );
            ids.push(made.invitation.id);
        }
        let pending = client
            .admin_guest_invitations(&admin.access_token)
            .await
            .expect("pending");
        assert_eq!(pending.len(), 3);
        assert!(matches!(
            client.admin_guest_invitations(&member.access_token).await,
            Err(CollabError::Api { status: 403, .. })
        ));
        let approved = client
            .admin_approve_guest(&admin.access_token, &ids[0])
            .await
            .expect("approve");
        assert_eq!(approved.status, GuestInvitationStatus::Invited);
        let declined = client
            .admin_decline_guest(&admin.access_token, &ids[1])
            .await
            .expect("decline");
        assert_eq!(declined.status, GuestInvitationStatus::Declined);
        client
            .admin_revoke_guest(&admin.access_token, &ids[2])
            .await
            .expect("withdraw");
        let left = client
            .admin_guest_invitations(&admin.access_token)
            .await
            .expect("pending");
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, ids[0]);
    }
}
