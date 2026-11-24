use serde_json::json;

use super::{
    accept_invite, grant_token, parse_link, preview_token, split_link, ProjectLink, TokenReply,
};
use crate::client::{parse_dashboard, Http};
use crate::error::OnlineErrorKind;
use crate::live::rest::RestError;
use crate::service::DEFAULT_SERVER;
use crate::test_support::mock_overleaf::{
    MockOverleaf, MockProject, MockUser, Privilege, MOCK_CSRF,
};

const SERVER: &str = "https://latex.uni.edu/overleaf";
const ID: &str = "6af9a1b2c3d4e5f6a7b8c9d0";

#[test]
fn pasted_links_are_told_apart() {
    let cases: [(&str, Option<(&str, ProjectLink)>); 9] = [
        (
            "https://www.overleaf.com/project/6af9a1b2c3d4e5f6a7b8c9d0",
            Some((DEFAULT_SERVER, ProjectLink::Project { id: ID.into() })),
        ),
        (
            "overleaf.com/read/qwertyuiopas",
            Some((
                DEFAULT_SERVER,
                ProjectLink::Read {
                    token: "qwertyuiopas".into(),
                    fragment: None,
                },
            )),
        ),
        (
            " https://www.overleaf.com/4815162342asdfghjklzxc#a1b2c3 ",
            Some((
                DEFAULT_SERVER,
                ProjectLink::Edit {
                    token: "4815162342asdfghjklzxc".into(),
                    fragment: Some("a1b2c3".into()),
                },
            )),
        ),
        (
            "https://latex.uni.edu/overleaf/project/6af9a1b2c3d4e5f6a7b8c9d0/invite/token/abc123",
            Some((
                SERVER,
                ProjectLink::Invite {
                    project: ID.into(),
                    token: "abc123".into(),
                },
            )),
        ),
        (
            "https://latex.uni.edu/overleaf/read/qwertyuiopas",
            Some((
                SERVER,
                ProjectLink::Read {
                    token: "qwertyuiopas".into(),
                    fragment: None,
                },
            )),
        ),
        ("https://evil.example/read/qwertyuiopas", None),
        ("https://latex.uni.edu/elsewhere/read/qwertyuiopas", None),
        ("https://www.overleaf.com/learn", None),
        ("ftp://www.overleaf.com/read/qwertyuiopas", None),
    ];
    for (input, expected) in cases {
        let found = parse_link(input, SERVER);
        match expected {
            Some((base, link)) => assert_eq!(found, Ok((base.to_string(), link)), "{input}"),
            None => assert_eq!(
                found.map_err(|error| error.kind),
                Err(OnlineErrorKind::LinkInvalid),
                "{input}"
            ),
        }
    }
    assert!(split_link("https://www.overleaf.com/read/x", "not a server").is_ok());
    assert!(split_link("https://latex.uni.edu/read/x", "::").is_err());
}

#[test]
fn the_dashboard_lists_only_invites() {
    let notifications = json!([
        {"_id": "n1", "key": "project-invite-6af9000000000000000000aa", "templateKey": "notification_project_invite",
         "expires": "2026-12-23T10:00:00.000Z",
         "messageOpts": {"userName": "Alice", "projectName": "Grant &amp; Paper", "projectId": ID, "token": "f00d"}},
        {"_id": "n2", "key": "wfh-2020", "templateKey": "notification_wfh", "messageOpts": {}},
        {"_id": "n3", "key": "project-invite-x", "templateKey": "notification_project_invite", "messageOpts": {"projectId": "../evil", "token": "t"}}
    ]);
    let escaped = notifications.to_string().replace('"', "&quot;");
    let page = format!(
        "<meta name=\"ol-user_id\" content=\"u1\"><meta name=\"ol-notifications\" data-type=\"json\" content=\"{escaped}\">"
    );
    let dashboard = parse_dashboard(&page).unwrap();
    assert_eq!(dashboard.invites.len(), 1);
    let invite = &dashboard.invites[0];
    assert_eq!(invite.id, "6af9000000000000000000aa");
    assert_eq!(invite.project_id, ID);
    assert_eq!(invite.project_name, "Grant & Paper");
    assert_eq!(invite.inviter.as_deref(), Some("Alice"));
    assert_eq!(invite.token, "f00d");
    let shown = serde_json::to_value(invite).unwrap();
    assert!(shown.get("token").is_none(), "{shown}");
}

fn link_project() -> MockProject {
    MockProject::new("Shared paper")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .outsider(MockUser::named("erin"))
        .outsider(MockUser::named("dave"))
        .doc("main.tex", "Hello")
}

fn http(mock: &MockOverleaf) -> Http {
    Http::new(&mock.base, "Oleafly/test").unwrap()
}

fn link_of(mock: &MockOverleaf, raw: &str) -> ProjectLink {
    parse_link(raw, &mock.base).unwrap().1
}

#[tokio::test]
async fn joining_by_link_grants_nothing_before_it_is_confirmed() {
    let mock = MockOverleaf::start(link_project()).await;
    let (read, edit) = mock.share_by_link();
    let client = http(&mock);
    let erin = mock.user("erin").cookie();
    let read = link_of(&mock, &read);
    let shown = preview_token(&client, &erin, MOCK_CSRF, &read)
        .await
        .unwrap();
    assert_eq!(
        shown,
        TokenReply::RequireAccept {
            project_name: "Shared paper".into()
        }
    );
    assert_eq!(mock.privilege_of("erin"), None);
    assert_eq!(mock.grants(), [json!({ "tokenHashPrefix": "" })]);

    let granted = grant_token(&client, &erin, MOCK_CSRF, &read).await.unwrap();
    assert_eq!(
        granted,
        TokenReply::Granted {
            project_id: mock.project_id(),
            read_only: true
        }
    );
    assert_eq!(mock.privilege_of("erin"), Some(Privilege::ReadOnly));
    let again = preview_token(&client, &erin, MOCK_CSRF, &read)
        .await
        .unwrap();
    assert_eq!(
        again,
        TokenReply::Already {
            project_id: mock.project_id()
        }
    );

    let edit = link_of(&mock, &edit);
    let dave = mock.user("dave").cookie();
    assert!(matches!(
        preview_token(&client, &dave, MOCK_CSRF, &edit)
            .await
            .unwrap(),
        TokenReply::RequireAccept { .. }
    ));
    let joined = grant_token(&client, &dave, MOCK_CSRF, &edit).await.unwrap();
    assert_eq!(
        joined,
        TokenReply::Granted {
            project_id: mock.project_id(),
            read_only: false
        }
    );
    assert_eq!(mock.privilege_of("dave"), Some(Privilege::ReadAndWrite));
    assert_eq!(
        mock.grants().last(),
        Some(&json!({ "tokenHashPrefix": "#a1b2c3", "confirmedByUser": true }))
    );
    let bob = mock.user("bob").cookie();
    assert_eq!(
        grant_token(&client, &bob, MOCK_CSRF, &edit).await.unwrap(),
        TokenReply::Already {
            project_id: mock.project_id()
        }
    );
}

#[tokio::test]
async fn a_link_that_no_longer_opens_anything_is_refused() {
    let mock = MockOverleaf::start(link_project()).await;
    let client = http(&mock);
    let erin = mock.user("erin").cookie();
    let unknown = ProjectLink::Read {
        token: "abcdefghijkl".into(),
        fragment: None,
    };
    let refused = preview_token(&client, &erin, MOCK_CSRF, &unknown).await;
    assert!(
        matches!(refused, Err(RestError::Refused { status: 404, .. })),
        "{refused:?}"
    );
    let signed_out = preview_token(&client, "overleaf.sid=nobody", MOCK_CSRF, &unknown).await;
    assert_eq!(signed_out, Err(RestError::SignedOut));
}

#[tokio::test]
async fn accepting_an_invite_says_it_comes_from_the_page_and_a_used_one_is_done() {
    let mock =
        MockOverleaf::start(link_project().invited("erin@example.test", Privilege::ReadAndWrite))
            .await;
    let client = http(&mock);
    let erin = mock.user("erin");
    let dashboard = client.dashboard(&erin.cookie()).await.unwrap();
    assert_eq!(dashboard.invites.len(), 1);
    let invite = dashboard.invites[0].clone();
    assert_eq!(invite.project_id, mock.project_id());
    assert_eq!(invite.project_name, "Shared paper");
    assert_eq!(invite.inviter.as_deref(), Some("Alice"));
    for (project, token) in [
        (invite.project_id.as_str(), "revokedorneverissued"),
        (ID, invite.token.as_str()),
    ] {
        let unknown = accept_invite(&client, &erin.cookie(), MOCK_CSRF, project, token).await;
        assert!(
            matches!(unknown, Err(RestError::Refused { status: 404, .. })),
            "{project} {token}: {unknown:?}"
        );
    }
    assert_eq!(mock.privilege_of("erin"), None);
    accept_invite(
        &client,
        &erin.cookie(),
        MOCK_CSRF,
        &invite.project_id,
        &invite.token,
    )
    .await
    .unwrap();
    assert_eq!(mock.privilege_of("erin"), Some(Privilege::ReadAndWrite));
    let route = format!(
        "/project/{}/invite/token/{}/accept",
        invite.project_id, invite.token
    );
    let sent = mock.requests(&route);
    assert_eq!(
        sent[0].headers.get("x-requested-with").map(String::as_str),
        Some("XMLHttpRequest")
    );
    accept_invite(
        &client,
        &erin.cookie(),
        MOCK_CSRF,
        &invite.project_id,
        &invite.token,
    )
    .await
    .unwrap();
    assert_eq!(mock.requests(&route).len(), 2);
    assert!(client
        .dashboard(&erin.cookie())
        .await
        .unwrap()
        .invites
        .is_empty());
}
