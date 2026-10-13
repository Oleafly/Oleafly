mod people;
mod support;

use std::time::Duration;

use oleafly_collab_protocol::admin::{MemberStatus, RuntimeSettingsPatch, SecurityEventKind};
use oleafly_collab_protocol::auth::SessionEndReason;
use oleafly_collab_protocol::capabilities::CapabilityManifest;
use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::guests::{
    GuestInvitation, GuestInvitationStatus, GuestInviteResult, ProjectGuestInvitations,
};
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::projects::{
    PersonSummary, ProjectMember, ProjectPatch, ProjectRole, ProjectSummary,
};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::clock::Clock;
use oleafly_server::config::ServerConfig;
use oleafly_server::members;
use oleafly_server::state::DAY_MS;
use oleafly_server::test_support::{
    github_provider, mail_config, refresh_session, security_event_kinds, sign_in, test_config,
    MockGithub, MockGithubUser, MockSmtp, TestDevice,
};
use people::{call, connect, next_frame, read, share_project, stage_with, Person, Stage};
use reqwest::{Method, StatusCode};
use serde_json::json;

const PENDING: &str = "/api/v1/admin/guest-invitations";
const WAIT: Duration = Duration::from_secs(10);

struct Guests {
    stage: Stage,
    _mocks: Vec<MockGithub>,
}

fn user(id: u64, login: &str, emails: &[(&str, bool)]) -> MockGithubUser {
    MockGithubUser {
        id,
        login: login.to_owned(),
        name: format!("{login} Guest"),
        emails: emails
            .iter()
            .map(|(email, verified)| ((*email).to_owned(), *verified))
            .collect(),
    }
}

async fn guest_stage(mut config: ServerConfig) -> Guests {
    let dana = MockGithub::start(vec![user(
        31,
        "dana",
        &[("dana@field.org", true), ("dana@old.org", false)],
    )])
    .await;
    let mallory = MockGithub::start(vec![user(32, "mallory", &[("Dana@Field.org", true)])]).await;
    let eve = MockGithub::start(vec![user(33, "eve", &[("eve@else.org", true)])]).await;
    config.providers.push(github_provider("dana-gh", &dana));
    config
        .providers
        .push(github_provider("mallory-gh", &mallory));
    config.providers.push(github_provider("eve-gh", &eve));
    Guests {
        stage: stage_with(config).await,
        _mocks: vec![dana, mallory, eve],
    }
}

async fn guests_on(stage: &Stage, approval: bool) {
    set_guests(stage, true, approval).await;
}

async fn set_guests(stage: &Stage, enabled: bool, approval: bool) {
    let patch = RuntimeSettingsPatch {
        guests_enabled: Some(enabled),
        guest_approval_required: Some(approval),
        ..RuntimeSettingsPatch::default()
    };
    let response = call(
        &stage.server,
        Method::PATCH,
        "/api/v1/admin/settings",
        stage.bob.token(),
        Some(serde_json::to_value(patch).expect("json")),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
}

fn invitations_path(project: SharedProjectId) -> String {
    format!("/api/v1/projects/{project}/invitations")
}

async fn invite(
    stage: &Stage,
    owner: &Person,
    project: SharedProjectId,
    email: &str,
    role: ProjectRole,
) -> reqwest::Response {
    call(
        &stage.server,
        Method::POST,
        &invitations_path(project),
        owner.token(),
        Some(json!({ "email": email, "role": role })),
    )
    .await
}

async fn invited(
    stage: &Stage,
    project: SharedProjectId,
    email: &str,
    role: ProjectRole,
) -> GuestInviteResult {
    let response = invite(stage, &stage.bob, project, email, role).await;
    assert_eq!(response.status(), StatusCode::CREATED);
    response.json().await.expect("invite result")
}

async fn sign_in_as(stage: &Stage, provider: &str) -> Result<Person, String> {
    let device = TestDevice::generate();
    let tokens = sign_in(&stage.server, provider, &device, None).await?;
    Ok(Person { device, tokens })
}

async fn projects_of(stage: &Stage, person: &Person) -> Vec<ProjectSummary> {
    read(
        call(
            &stage.server,
            Method::GET,
            "/api/v1/projects",
            person.token(),
            None,
        )
        .await,
    )
    .await
}

async fn members_of(
    stage: &Stage,
    person: &Person,
    project: SharedProjectId,
) -> Vec<ProjectMember> {
    read(
        call(
            &stage.server,
            Method::GET,
            &format!("/api/v1/projects/{project}/members"),
            person.token(),
            None,
        )
        .await,
    )
    .await
}

async fn owner_list(stage: &Stage, project: SharedProjectId) -> ProjectGuestInvitations {
    read(
        call(
            &stage.server,
            Method::GET,
            &invitations_path(project),
            stage.bob.token(),
            None,
        )
        .await,
    )
    .await
}

async fn staff_list(stage: &Stage, person: &Person) -> reqwest::Response {
    call(&stage.server, Method::GET, PENDING, person.token(), None).await
}

async fn decide(stage: &Stage, person: &Person, id: &str, action: &str) -> reqwest::Response {
    call(
        &stage.server,
        Method::POST,
        &format!("{PENDING}/{id}/{action}"),
        person.token(),
        None,
    )
    .await
}

async fn status_of(stage: &Stage, person: &Person) -> Option<MemberStatus> {
    let account = person.tokens.account_id;
    stage
        .server
        .state()
        .db
        .call(move |conn| members::account_status(conn, account))
        .await
        .expect("status")
}

async fn role_of(stage: &Stage, person: &Person) -> Option<ServerRole> {
    let account = person.tokens.account_id;
    stage
        .server
        .state()
        .db
        .call(move |conn| members::account_role(conn, account))
        .await
        .expect("role")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_matching_verified_email_is_admitted_once_as_a_guest_off_the_allowlist() {
    let guests = guest_stage(test_config()).await;
    let stage = &guests.stage;
    guests_on(stage, false).await;
    let project = share_project(&stage.server, &stage.bob, "Reef survey").await;
    let other = share_project(&stage.server, &stage.bob, "Private notes").await;
    let result = invited(
        stage,
        project.project_id,
        "Dana@Field.org",
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(result.invitation.status, GuestInvitationStatus::Invited);
    assert_eq!(result.invitation.email, "dana@field.org");
    assert_eq!(result.invitation.role, ProjectRole::Viewer);
    assert_eq!(result.invitation.project_title, "Reef survey");
    assert!(result.invitation.id.len() >= 32, "{}", result.invitation.id);
    assert_eq!(
        sign_in_as(stage, "eve-gh").await.err().as_deref(),
        Some("not_admitted")
    );
    let dana = sign_in_as(stage, "dana-gh")
        .await
        .expect("dana is admitted");
    assert_eq!(role_of(stage, &dana).await, Some(ServerRole::Guest));
    let listed = projects_of(stage, &dana).await;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].project_id, project.project_id);
    assert_eq!(listed[0].role, ProjectRole::Viewer);
    assert_ne!(listed[0].project_id, other.project_id);
    let people = members_of(stage, &stage.bob, project.project_id).await;
    let marked: Vec<(String, bool)> = people
        .iter()
        .map(|member| (member.person.display_name.clone(), member.person.guest))
        .collect();
    assert_eq!(
        marked,
        [
            ("Bob Smith".to_owned(), false),
            ("dana Guest".to_owned(), true)
        ]
    );
    assert_eq!(
        owner_list(stage, project.project_id)
            .await
            .invitations
            .iter()
            .map(|entry| entry.status)
            .collect::<Vec<_>>(),
        Vec::<GuestInvitationStatus>::new()
    );
    assert_eq!(
        sign_in_as(stage, "mallory-gh").await.err().as_deref(),
        Some("not_admitted")
    );
    let again = sign_in_as(stage, "dana-gh")
        .await
        .expect("dana signs in again");
    assert_eq!(again.tokens.account_id, dana.tokens.account_id);
    let kinds = security_event_kinds(&stage.server).await;
    assert!(kinds.contains(&SecurityEventKind::GuestInvited));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_owner_can_change_a_guests_role_but_not_add_a_guest_by_account() {
    let guests = guest_stage(test_config()).await;
    let stage = &guests.stage;
    guests_on(stage, false).await;
    let project = share_project(&stage.server, &stage.bob, "Reef survey").await;
    let other = share_project(&stage.server, &stage.bob, "Field notes").await;
    invited(
        stage,
        project.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    let dana = sign_in_as(stage, "dana-gh")
        .await
        .expect("dana is admitted");
    let changed = people::grant(
        &stage.server,
        &stage.bob,
        project.project_id,
        &dana,
        ProjectRole::Editor,
    )
    .await;
    assert_eq!(changed.status(), StatusCode::OK);
    let member: ProjectMember = changed.json().await.expect("member");
    assert_eq!(member.role, ProjectRole::Editor);
    assert!(member.person.guest);
    let added = people::grant(
        &stage.server,
        &stage.bob,
        other.project_id,
        &dana,
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(added.status(), StatusCode::NOT_FOUND);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn only_a_verified_address_matches_an_invitation() {
    let guests = guest_stage(test_config()).await;
    let stage = &guests.stage;
    guests_on(stage, false).await;
    let project = share_project(&stage.server, &stage.bob, "Reef survey").await;
    invited(
        stage,
        project.project_id,
        "dana@old.org",
        ProjectRole::Editor,
    )
    .await;
    assert_eq!(
        sign_in_as(stage, "dana-gh").await.err().as_deref(),
        Some("not_admitted")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn guests_see_only_their_projects_and_cannot_share_invite_or_search() {
    let guests = guest_stage(test_config()).await;
    let stage = &guests.stage;
    guests_on(stage, false).await;
    let project = share_project(&stage.server, &stage.bob, "Reef survey").await;
    let linked = share_project(&stage.server, &stage.bob, "Open notes").await;
    let patch = ProjectPatch {
        link_sharing: Some(true),
        link_role: Some(ProjectRole::Editor),
        ..ProjectPatch::default()
    };
    read::<ProjectSummary>(
        call(
            &stage.server,
            Method::PATCH,
            &format!("/api/v1/projects/{}", linked.project_id),
            stage.bob.token(),
            Some(serde_json::to_value(patch).expect("json")),
        )
        .await,
    )
    .await;
    invited(
        stage,
        project.project_id,
        "dana@field.org",
        ProjectRole::Editor,
    )
    .await;
    let dana = sign_in_as(stage, "dana-gh")
        .await
        .expect("dana is admitted");
    let server = &stage.server;
    let directory: Vec<PersonSummary> = read(
        call(
            server,
            Method::GET,
            "/api/v1/directory?q=bob",
            dana.token(),
            None,
        )
        .await,
    )
    .await;
    assert!(directory.is_empty());
    let alice_finds: Vec<PersonSummary> = read(
        call(
            server,
            Method::GET,
            "/api/v1/directory?q=",
            stage.alice.token(),
            None,
        )
        .await,
    )
    .await;
    assert!(alice_finds
        .iter()
        .all(|person| person.account_id != dana.tokens.account_id));
    let created = call(
        server,
        Method::POST,
        "/api/v1/projects",
        dana.token(),
        Some(json!({ "title": "Mine" })),
    )
    .await;
    assert_eq!(created.status(), StatusCode::FORBIDDEN);
    let joined = call(
        server,
        Method::POST,
        &format!("/api/v1/projects/{}/join", linked.project_id),
        dana.token(),
        None,
    )
    .await;
    assert_eq!(joined.status(), StatusCode::NOT_FOUND);
    assert_eq!(projects_of(stage, &dana).await.len(), 1);
    let invite_more = invite(
        stage,
        &dana,
        project.project_id,
        "friend@field.org",
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(invite_more.status(), StatusCode::FORBIDDEN);
    let add_alice = call(
        server,
        Method::PUT,
        &format!(
            "/api/v1/projects/{}/members/{}",
            project.project_id, stage.alice.tokens.account_id
        ),
        dana.token(),
        Some(json!({ "role": "viewer" })),
    )
    .await;
    assert_eq!(add_alice.status(), StatusCode::FORBIDDEN);
    let listed = call(
        server,
        Method::GET,
        &invitations_path(project.project_id),
        dana.token(),
        None,
    )
    .await;
    assert_eq!(listed.status(), StatusCode::FORBIDDEN);
    let seen = members_of(stage, &dana, project.project_id).await;
    assert!(seen.iter().all(|member| member.person.email.is_none()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn with_approval_required_an_invitation_waits_for_staff() {
    let guests = guest_stage(test_config()).await;
    let stage = &guests.stage;
    guests_on(stage, true).await;
    let project = share_project(&stage.server, &stage.bob, "Reef survey").await;
    let result = invited(
        stage,
        project.project_id,
        "dana@field.org",
        ProjectRole::Editor,
    )
    .await;
    assert_eq!(
        result.invitation.status,
        GuestInvitationStatus::AwaitingApproval
    );
    let list = owner_list(stage, project.project_id).await;
    assert!(list.guests_enabled && list.approval_required);
    assert_eq!(list.invitations.len(), 1);
    assert_eq!(
        list.invitations[0].status,
        GuestInvitationStatus::AwaitingApproval
    );
    assert_eq!(
        sign_in_as(stage, "dana-gh").await.err().as_deref(),
        Some("not_admitted")
    );
    assert_eq!(
        staff_list(stage, &stage.alice).await.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        decide(stage, &stage.alice, &result.invitation.id, "approve")
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    let pending: Vec<GuestInvitation> = read(staff_list(stage, &stage.bob).await).await;
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].email, "dana@field.org");
    assert_eq!(pending[0].project_title, "Reef survey");
    assert_eq!(pending[0].invited_by.display_name, "Bob Smith");
    let approved: GuestInvitation =
        read(decide(stage, &stage.bob, &result.invitation.id, "approve").await).await;
    assert_eq!(approved.status, GuestInvitationStatus::Invited);
    let again = decide(stage, &stage.bob, &result.invitation.id, "approve").await;
    assert_eq!(again.status(), StatusCode::CONFLICT);
    let dana = sign_in_as(stage, "dana-gh")
        .await
        .expect("approved guest signs in");
    assert_eq!(projects_of(stage, &dana).await[0].role, ProjectRole::Editor);
    let kinds = security_event_kinds(&stage.server).await;
    assert!(kinds.contains(&SecurityEventKind::GuestInvitationApproved));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_declined_invitation_never_admits() {
    let guests = guest_stage(test_config()).await;
    let stage = &guests.stage;
    guests_on(stage, true).await;
    let project = share_project(&stage.server, &stage.bob, "Reef survey").await;
    let result = invited(
        stage,
        project.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    let declined: GuestInvitation =
        read(decide(stage, &stage.bob, &result.invitation.id, "decline").await).await;
    assert_eq!(declined.status, GuestInvitationStatus::Declined);
    let shown = owner_list(stage, project.project_id).await;
    assert_eq!(shown.invitations[0].status, GuestInvitationStatus::Declined);
    let pending: Vec<GuestInvitation> = read(staff_list(stage, &stage.bob).await).await;
    assert!(pending.is_empty());
    assert_eq!(
        sign_in_as(stage, "dana-gh").await.err().as_deref(),
        Some("not_admitted")
    );
    assert_eq!(
        decide(stage, &stage.bob, &result.invitation.id, "approve")
            .await
            .status(),
        StatusCode::CONFLICT
    );
    let kinds = security_event_kinds(&stage.server).await;
    assert!(kinds.contains(&SecurityEventKind::GuestInvitationDeclined));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_expired_invitation_never_admits_and_cannot_be_approved() {
    let guests = guest_stage(test_config()).await;
    let stage = &guests.stage;
    guests_on(stage, true).await;
    let project = share_project(&stage.server, &stage.bob, "Reef survey").await;
    let result = invited(
        stage,
        project.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(
        result.invitation.expires_at - result.invitation.created_at,
        14 * DAY_MS
    );
    stage.server.clock().advance(14 * DAY_MS + 1);
    let admin = sign_in_as(stage, "github")
        .await
        .expect("bob signs in again");
    assert_eq!(
        decide(stage, &admin, &result.invitation.id, "approve")
            .await
            .status(),
        StatusCode::CONFLICT
    );
    let pending: Vec<GuestInvitation> = read(staff_list(stage, &admin).await).await;
    assert!(pending.is_empty());
    assert_eq!(
        sign_in_as(stage, "dana-gh").await.err().as_deref(),
        Some("not_admitted")
    );
    let renewed = invite(
        stage,
        &admin,
        project.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(renewed.status(), StatusCode::CREATED);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_owner_and_staff_can_revoke_an_open_invitation_and_nobody_else_can() {
    let guests = guest_stage(test_config()).await;
    let stage = &guests.stage;
    guests_on(stage, false).await;
    let project = share_project(&stage.server, &stage.bob, "Reef survey").await;
    let response = people::grant(
        &stage.server,
        &stage.bob,
        project.project_id,
        &stage.alice,
        ProjectRole::Editor,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let first = invited(
        stage,
        project.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    let path = format!(
        "{}/{}",
        invitations_path(project.project_id),
        first.invitation.id
    );
    let by_editor = call(
        &stage.server,
        Method::DELETE,
        &path,
        stage.alice.token(),
        None,
    )
    .await;
    assert_eq!(by_editor.status(), StatusCode::FORBIDDEN);
    let duplicate = invite(
        stage,
        &stage.bob,
        project.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);
    let by_owner = call(
        &stage.server,
        Method::DELETE,
        &path,
        stage.bob.token(),
        None,
    )
    .await;
    assert_eq!(by_owner.status(), StatusCode::NO_CONTENT);
    let gone = call(
        &stage.server,
        Method::DELETE,
        &path,
        stage.bob.token(),
        None,
    )
    .await;
    assert_eq!(gone.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        sign_in_as(stage, "dana-gh").await.err().as_deref(),
        Some("not_admitted")
    );
    let second = invited(
        stage,
        project.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    let by_member = call(
        &stage.server,
        Method::DELETE,
        &format!("{PENDING}/{}", second.invitation.id),
        stage.alice.token(),
        None,
    )
    .await;
    assert_eq!(by_member.status(), StatusCode::FORBIDDEN);
    let by_admin = call(
        &stage.server,
        Method::DELETE,
        &format!("{PENDING}/{}", second.invitation.id),
        stage.bob.token(),
        None,
    )
    .await;
    assert_eq!(by_admin.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        sign_in_as(stage, "dana-gh").await.err().as_deref(),
        Some("not_admitted")
    );
    let kinds = security_event_kinds(&stage.server).await;
    assert_eq!(
        kinds
            .iter()
            .filter(|kind| **kind == SecurityEventKind::GuestInvitationRevoked)
            .count(),
        2
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn removing_a_guests_last_project_ends_their_admission() {
    let guests = guest_stage(test_config()).await;
    let stage = &guests.stage;
    guests_on(stage, false).await;
    let first = share_project(&stage.server, &stage.bob, "Reef survey").await;
    let second = share_project(&stage.server, &stage.bob, "Field notes").await;
    invited(
        stage,
        first.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    invited(
        stage,
        second.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    let dana = sign_in_as(stage, "dana-gh")
        .await
        .expect("dana is admitted");
    assert_eq!(projects_of(stage, &dana).await.len(), 2);
    let remove = |project: SharedProjectId| {
        let path = format!(
            "/api/v1/projects/{project}/members/{}",
            dana.tokens.account_id
        );
        async move {
            call(
                &stage.server,
                Method::DELETE,
                &path,
                stage.bob.token(),
                None,
            )
            .await
        }
    };
    assert_eq!(
        remove(first.project_id).await.status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(status_of(stage, &dana).await, Some(MemberStatus::Active));
    assert_eq!(projects_of(stage, &dana).await.len(), 1);
    assert_eq!(
        remove(second.project_id).await.status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(status_of(stage, &dana).await, Some(MemberStatus::Removed));
    let after = call(
        &stage.server,
        Method::GET,
        "/api/v1/projects",
        dana.token(),
        None,
    )
    .await;
    assert_eq!(after.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        sign_in_as(stage, "dana-gh").await.err().as_deref(),
        Some("not_admitted")
    );
    let kinds = security_event_kinds(&stage.server).await;
    assert!(kinds.contains(&SecurityEventKind::GuestAdmissionEnded));
    invited(
        stage,
        first.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    let back = sign_in_as(stage, "dana-gh")
        .await
        .expect("a new invitation admits again");
    assert_eq!(back.tokens.account_id, dana.tokens.account_id);
    assert_eq!(status_of(stage, &back).await, Some(MemberStatus::Active));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_guest_removed_from_their_last_project_is_told_their_access_ended() {
    let guests = guest_stage(test_config()).await;
    let stage = &guests.stage;
    guests_on(stage, false).await;
    let project = share_project(&stage.server, &stage.bob, "Reef survey").await;
    invited(
        stage,
        project.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    let dana = sign_in_as(stage, "dana-gh")
        .await
        .expect("dana is admitted");
    let mut socket = connect(&stage.server, &dana).await;
    let removed = call(
        &stage.server,
        Method::DELETE,
        &format!(
            "/api/v1/projects/{}/members/{}",
            project.project_id, dana.tokens.account_id
        ),
        stage.bob.token(),
        None,
    )
    .await;
    assert_eq!(removed.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        next_frame(&mut socket).await,
        Some(ServerFrame::SessionRevoked {
            reason: Some(SessionEndReason::AccessEnded)
        })
    );
    let refreshed = refresh_session(
        &stage.server,
        &dana.device,
        dana.tokens.device_id,
        &dana.tokens.refresh_token,
    )
    .await;
    assert_eq!(refreshed.err().as_deref(), Some("access_ended"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_existing_guest_gets_a_newly_approved_project_without_signing_in_again() {
    let guests = guest_stage(test_config()).await;
    let stage = &guests.stage;
    guests_on(stage, true).await;
    let first = share_project(&stage.server, &stage.bob, "Reef survey").await;
    let second = share_project(&stage.server, &stage.bob, "Field notes").await;
    let one = invited(
        stage,
        first.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    read::<GuestInvitation>(decide(stage, &stage.bob, &one.invitation.id, "approve").await).await;
    let dana = sign_in_as(stage, "dana-gh")
        .await
        .expect("dana is admitted");
    let two = invited(
        stage,
        second.project_id,
        "dana@field.org",
        ProjectRole::Editor,
    )
    .await;
    assert_eq!(projects_of(stage, &dana).await.len(), 1);
    let approved: GuestInvitation =
        read(decide(stage, &stage.bob, &two.invitation.id, "approve").await).await;
    assert_eq!(approved.status, GuestInvitationStatus::Accepted);
    let listed = projects_of(stage, &dana).await;
    assert_eq!(listed.len(), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn invitations_need_guests_on_a_valid_address_and_a_grantable_role() {
    let guests = guest_stage(test_config()).await;
    let stage = &guests.stage;
    let project = share_project(&stage.server, &stage.bob, "Reef survey").await;
    let off = invite(
        stage,
        &stage.bob,
        project.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(off.status(), StatusCode::BAD_REQUEST);
    let list = owner_list(stage, project.project_id).await;
    assert!(!list.guests_enabled);
    guests_on(stage, false).await;
    let owner = invite(
        stage,
        &stage.bob,
        project.project_id,
        "dana@field.org",
        ProjectRole::Owner,
    )
    .await;
    assert_eq!(owner.status(), StatusCode::BAD_REQUEST);
    let junk = invite(
        stage,
        &stage.bob,
        project.project_id,
        "not an address",
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(junk.status(), StatusCode::BAD_REQUEST);
    invited(
        stage,
        project.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    set_guests(stage, false, false).await;
    assert_eq!(
        sign_in_as(stage, "dana-gh").await.err().as_deref(),
        Some("not_admitted")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn invitations_are_limited_per_owner_per_hour() {
    let guests = guest_stage(test_config()).await;
    let stage = &guests.stage;
    guests_on(stage, true).await;
    let project = share_project(&stage.server, &stage.bob, "Reef survey").await;
    for index in 0..20 {
        let response = invite(
            stage,
            &stage.bob,
            project.project_id,
            &format!("guest{index}@field.org"),
            ProjectRole::Viewer,
        )
        .await;
        assert_eq!(response.status(), StatusCode::CREATED, "{index}");
    }
    let limited = invite(
        stage,
        &stage.bob,
        project.project_id,
        "one-more@field.org",
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
    stage.server.clock().advance(60 * 60 * 1000 + 1);
    let admin = sign_in_as(stage, "github")
        .await
        .expect("bob signs in again");
    let later = invite(
        stage,
        &admin,
        project.project_id,
        "one-more@field.org",
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(later.status(), StatusCode::CREATED);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_manifest_advertises_guests_only_when_they_are_on() {
    let guests = guest_stage(test_config()).await;
    let stage = &guests.stage;
    let manifest = || async {
        reqwest::get(format!("{}/.well-known/oleafly-server", stage.server.url()))
            .await
            .expect("manifest")
            .json::<CapabilityManifest>()
            .await
            .expect("manifest json")
    };
    assert!(!manifest().await.features.guests);
    guests_on(stage, true).await;
    assert!(manifest().await.features.guests);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_guest_gets_an_email_with_the_server_inviter_project_and_add_link() {
    let smtp = MockSmtp::start().await;
    let guests = guest_stage(mail_config(&smtp)).await;
    let stage = &guests.stage;
    guests_on(stage, false).await;
    let project = share_project(&stage.server, &stage.bob, "Reef survey").await;
    let result = invited(
        stage,
        project.project_id,
        "dana@field.org",
        ProjectRole::Editor,
    )
    .await;
    assert!(result.emailed);
    let mail = smtp.wait_for(1, WAIT).await;
    assert_eq!(mail.len(), 1);
    assert_eq!(mail[0].rcpt_to, ["dana@field.org"]);
    let subject = mail[0].subject();
    assert!(subject.contains("Bob Smith"), "{subject}");
    assert!(subject.contains("Reef survey"), "{subject}");
    let address = stage.server.url();
    for body in [mail[0].text(), mail[0].html()] {
        assert!(body.contains(&address), "{body}");
        assert!(body.contains("Bob Smith"), "{body}");
        assert!(body.contains("Reef survey"), "{body}");
        assert!(body.contains("oleafly://server/add?url="), "{body}");
        assert!(body.contains("dana@field.org"), "{body}");
    }
    assert!(result.add_link.starts_with("oleafly://server/add?url="));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn with_approval_the_email_goes_out_only_once_approved() {
    let smtp = MockSmtp::start().await;
    let guests = guest_stage(mail_config(&smtp)).await;
    let stage = &guests.stage;
    guests_on(stage, true).await;
    let project = share_project(&stage.server, &stage.bob, "Reef survey").await;
    let result = invited(
        stage,
        project.project_id,
        "dana@field.org",
        ProjectRole::Editor,
    )
    .await;
    assert!(result.emailed);
    stage.server.state().mailer.settled().await;
    assert!(smtp.messages().is_empty());
    read::<GuestInvitation>(decide(stage, &stage.bob, &result.invitation.id, "approve").await)
        .await;
    let mail = smtp.wait_for(1, WAIT).await;
    assert_eq!(mail[0].rcpt_to, ["dana@field.org"]);
    let declined = invited(
        stage,
        project.project_id,
        "nobody@field.org",
        ProjectRole::Viewer,
    )
    .await;
    read::<GuestInvitation>(decide(stage, &stage.bob, &declined.invitation.id, "decline").await)
        .await;
    stage.server.state().mailer.settled().await;
    assert_eq!(smtp.messages().len(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn without_mail_the_owner_gets_the_add_link_to_send_themselves() {
    let guests = guest_stage(test_config()).await;
    let stage = &guests.stage;
    guests_on(stage, false).await;
    let project = share_project(&stage.server, &stage.bob, "Reef survey").await;
    let result = invited(
        stage,
        project.project_id,
        "dana@field.org",
        ProjectRole::Editor,
    )
    .await;
    assert!(!result.emailed);
    let expected = format!(
        "oleafly://server/add?url={}",
        url::form_urlencoded::byte_serialize(stage.server.url().as_bytes()).collect::<String>()
    );
    assert_eq!(result.add_link, expected);
    let list = owner_list(stage, project.project_id).await;
    assert!(!list.sends_email);
    assert_eq!(list.add_link, expected);
}

fn small_projects() -> ServerConfig {
    let mut config = test_config();
    config.limits.max_members_per_project = 2;
    config
}

async fn fill(stage: &Stage, project: SharedProjectId) {
    let response = people::grant(
        &stage.server,
        &stage.bob,
        project,
        &stage.alice,
        ProjectRole::Editor,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_invitation_to_a_full_project_waits_instead_of_adding_an_existing_guest() {
    let guests = guest_stage(small_projects()).await;
    let stage = &guests.stage;
    guests_on(stage, false).await;
    let first = share_project(&stage.server, &stage.bob, "Reef survey").await;
    invited(
        stage,
        first.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    let dana = sign_in_as(stage, "dana-gh")
        .await
        .expect("dana is admitted");
    let second = share_project(&stage.server, &stage.bob, "Field notes").await;
    fill(stage, second.project_id).await;
    let result = invited(
        stage,
        second.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(result.invitation.status, GuestInvitationStatus::Invited);
    assert_eq!(projects_of(stage, &dana).await.len(), 1);
    assert_eq!(
        members_of(stage, &stage.bob, second.project_id).await.len(),
        2
    );
    let again = sign_in_as(stage, "dana-gh")
        .await
        .expect("dana signs in again");
    assert_eq!(projects_of(stage, &again).await.len(), 1);
    assert_eq!(
        members_of(stage, &stage.bob, second.project_id).await.len(),
        2
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_guest_is_not_let_into_a_project_that_filled_up_after_the_invitation() {
    let guests = guest_stage(small_projects()).await;
    let stage = &guests.stage;
    guests_on(stage, false).await;
    let project = share_project(&stage.server, &stage.bob, "Reef survey").await;
    invited(
        stage,
        project.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    fill(stage, project.project_id).await;
    assert_eq!(
        sign_in_as(stage, "dana-gh").await.err().as_deref(),
        Some("not_admitted")
    );
    assert_eq!(
        members_of(stage, &stage.bob, project.project_id)
            .await
            .len(),
        2
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_address_two_accounts_hold_waits_for_one_of_them_to_sign_in() {
    let guests = guest_stage(test_config()).await;
    let stage = &guests.stage;
    guests_on(stage, false).await;
    let first = share_project(&stage.server, &stage.bob, "Reef survey").await;
    invited(
        stage,
        first.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    let dana = sign_in_as(stage, "dana-gh")
        .await
        .expect("dana is admitted");
    let now = stage.server.clock().now_ms();
    stage
        .server
        .state()
        .db
        .call(move |conn| {
            let other = members::create_account(conn, "Other Dana", None, ServerRole::Member, now)?;
            members::add_verified_emails(conn, other, &["dana@field.org".to_owned()])?;
            Ok(())
        })
        .await
        .expect("a second account holds the address");
    let second = share_project(&stage.server, &stage.bob, "Field notes").await;
    let result = invited(
        stage,
        second.project_id,
        "dana@field.org",
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(result.invitation.status, GuestInvitationStatus::Invited);
    assert_eq!(projects_of(stage, &dana).await.len(), 1);
    assert_eq!(
        members_of(stage, &stage.bob, second.project_id).await.len(),
        1
    );
    let again = sign_in_as(stage, "dana-gh")
        .await
        .expect("dana signs in again");
    assert_eq!(projects_of(stage, &again).await.len(), 2);
}
