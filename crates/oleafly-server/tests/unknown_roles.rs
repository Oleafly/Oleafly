mod people;

use oleafly_collab_protocol::admin::{AllowlistEntry, DomainRule, MemberSummary};
use oleafly_collab_protocol::projects::{ProjectMember, ProjectSummary};
use oleafly_collab_protocol::roles::ServerRole;
use people::{call, read, share_project, stage};
use reqwest::{Method, StatusCode};
use serde_json::{json, Value};

async fn refused(response: reqwest::Response, what: &str) {
    assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{what}");
    let body: Value = response.json().await.expect("json body");
    assert_eq!(body["code"], "bad_request", "{what}: {body}");
}

#[tokio::test]
async fn a_role_this_server_does_not_know_is_refused_and_nothing_is_stored() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, bob, "Thesis").await.project_id;
    let alice_id = alice.tokens.account_id;
    let requests = [
        (
            Method::PATCH,
            format!("/api/v1/admin/members/{alice_id}"),
            json!({ "role": "auditor" }),
        ),
        (
            Method::POST,
            "/api/v1/admin/allowlist".to_owned(),
            json!({ "matcher": { "kind": "email", "email": "carol@uni.edu" }, "role": "auditor" }),
        ),
        (
            Method::POST,
            "/api/v1/admin/domains".to_owned(),
            json!({ "domain": "cs.uni.edu", "role": "auditor" }),
        ),
        (
            Method::PUT,
            format!("/api/v1/projects/{project}/members/{alice_id}"),
            json!({ "role": "auditor" }),
        ),
        (
            Method::PATCH,
            format!("/api/v1/projects/{project}"),
            json!({ "link_sharing": true, "link_role": "auditor" }),
        ),
        (
            Method::POST,
            format!("/api/v1/projects/{project}/invitations"),
            json!({ "email": "carol@uni.edu", "role": "auditor" }),
        ),
    ];
    for (method, path, body) in requests {
        let what = format!("{method} {path}");
        refused(
            call(server, method, &path, bob.token(), Some(body)).await,
            &what,
        )
        .await;
    }

    let people: Vec<MemberSummary> = read(
        call(
            server,
            Method::GET,
            "/api/v1/admin/members",
            bob.token(),
            None,
        )
        .await,
    )
    .await;
    let alice_now = people
        .iter()
        .find(|member| member.account.account_id == alice_id)
        .expect("alice is listed");
    assert_eq!(alice_now.account.server_role, ServerRole::Member);
    let allowlist: Vec<AllowlistEntry> = read(
        call(
            server,
            Method::GET,
            "/api/v1/admin/allowlist",
            bob.token(),
            None,
        )
        .await,
    )
    .await;
    assert!(allowlist
        .iter()
        .all(|entry| entry.role != ServerRole::Unknown));
    let domains: Vec<DomainRule> = read(
        call(
            server,
            Method::GET,
            "/api/v1/admin/domains",
            bob.token(),
            None,
        )
        .await,
    )
    .await;
    assert!(domains.is_empty());
    let shown: ProjectSummary = read(
        call(
            server,
            Method::GET,
            &format!("/api/v1/projects/{project}"),
            bob.token(),
            None,
        )
        .await,
    )
    .await;
    assert!(!shown.link_sharing);
    let members: Vec<ProjectMember> = read(
        call(
            server,
            Method::GET,
            &format!("/api/v1/projects/{project}/members"),
            bob.token(),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(members.len(), 1);
    let invitations: i64 = server
        .state()
        .db
        .call(|conn| {
            Ok(
                conn.query_row("SELECT COUNT(*) FROM guest_invitations", [], |row| {
                    row.get(0)
                })?,
            )
        })
        .await
        .expect("count guest invitations");
    assert_eq!(invitations, 0);
}
