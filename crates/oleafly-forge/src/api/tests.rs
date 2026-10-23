use super::*;
use crate::test_support::{MockResponse, MockServer};

const SHA: &str = "0123456789abcdef0123456789abcdef01234567";

fn session<'a>(http: &'a ForgeHttp, kind: ForgeKind, base: &'a str, token: &'a str) -> Session<'a> {
    Session {
        http,
        kind,
        base,
        token,
    }
}

fn body_json(server: &MockServer, index: usize) -> serde_json::Value {
    serde_json::from_str(&server.requests()[index].body).unwrap()
}

#[tokio::test]
async fn github_user_and_repositories_map_to_forge_types() {
    let server = MockServer::start(vec![
        MockResponse::json(
            200,
            r#"{"login":"octo","name":"Octo Cat","avatar_url":"https://avatars.example/o.png"}"#,
        ),
        MockResponse::raw(
            200,
            &[(
                "link",
                r#"<https://api.example/user/repos?page=2&per_page=100>; rel="next", <https://api.example/user/repos?page=5>; rel="last""#,
            )],
            br#"[{"id":7,"full_name":"octo/paper","private":true,"default_branch":"main","clone_url":"https://elsewhere.example/octo/paper.git"}]"#,
        ),
    ]);
    let http = ForgeHttp::new(None).unwrap();
    let base = server.url();
    let s = session(&http, ForgeKind::GitHub, &base, "gho_test1234");
    let user = current_user(&s).await.unwrap();
    assert_eq!(
        user,
        ForgeUser {
            login: "octo".into(),
            name: Some("Octo Cat".into()),
            avatar_url: Some("https://avatars.example/o.png".into()),
        }
    );
    let page = list_repos(&s, 1, Some("ignored")).await.unwrap();
    assert_eq!(page.next_page, Some(2));
    assert!(!page.searched);
    assert_eq!(
        page.repos,
        vec![ForgeRepo {
            id: "7".into(),
            full_name: "octo/paper".into(),
            name: "paper".into(),
            web_url: format!("{base}/octo/paper"),
            clone_url: format!("{base}/octo/paper.git"),
            private: true,
            default_branch: Some("main".into()),
        }]
    );
    let requests = server.requests();
    assert_eq!(requests[0].path, "/api/v3/user");
    assert!(
        requests[1].path.starts_with("/api/v3/user/repos?"),
        "{}",
        requests[1].path
    );
    assert!(requests[1]
        .path
        .contains("affiliation=owner%2Ccollaborator%2Corganization_member"));
    assert!(!requests[1].path.contains("ignored"));
    assert_eq!(
        requests[1].header("x-github-api-version").as_deref(),
        Some("2022-11-28")
    );
    assert_eq!(
        requests[1].header("accept").as_deref(),
        Some("application/vnd.github+json")
    );
}

#[tokio::test]
async fn gitlab_searches_on_the_server_and_pages_by_header() {
    let project = r#"[{"id":12,"path_with_namespace":"lab/thesis","visibility":"internal","default_branch":"main"}]"#;
    let server = MockServer::start(vec![
        MockResponse::raw(200, &[("x-next-page", "3")], project.as_bytes()),
        MockResponse::raw(200, &[("x-next-page", "")], project.as_bytes()),
    ]);
    let http = ForgeHttp::new(None).unwrap();
    let base = server.url();
    let s = session(&http, ForgeKind::GitLab, &base, "glpat-test1234");
    let page = list_repos(&s, 2, Some(" thesis ")).await.unwrap();
    assert_eq!(page.next_page, Some(3));
    assert!(page.searched);
    assert!(page.repos[0].private, "internal projects are not public");
    let last = list_repos(&s, 3, None).await.unwrap();
    assert_eq!(last.next_page, None);
    let requests = server.requests();
    assert!(requests[0].path.starts_with("/api/v4/projects?"));
    assert!(
        requests[0].path.contains("search=thesis"),
        "{}",
        requests[0].path
    );
    assert!(requests[0].path.contains("membership=true"));
    assert!(!requests[1].path.contains("search="));
}

#[tokio::test]
async fn gitea_follows_the_link_header_when_the_server_caps_the_page_size() {
    // `MAX_RESPONSE_ITEMS = 30`: 100 repositories come in pages of 30, so a
    // count taken against the 50 asked for would stop after page 2.
    let repos = r#"[{"id":1,"full_name":"me/paper","private":false}]"#;
    let server = MockServer::start(vec![
        MockResponse::raw(
            200,
            &[
                ("x-total-count", "100"),
                (
                    "link",
                    r#"<http://git.example/api/v1/user/repos?limit=50&page=3>; rel="next", <http://git.example/api/v1/user/repos?limit=50&page=4>; rel="last""#,
                ),
            ],
            repos.as_bytes(),
        ),
        MockResponse::raw(
            200,
            &[
                ("x-total-count", "100"),
                (
                    "link",
                    r#"<http://git.example/api/v1/user/repos?limit=50&page=3>; rel="prev", <http://git.example/api/v1/user/repos?limit=50&page=1>; rel="first""#,
                ),
            ],
            repos.as_bytes(),
        ),
    ]);
    let http = ForgeHttp::new(None).unwrap();
    let base = server.url();
    let s = session(&http, ForgeKind::Gitea, &base, "gitea-token-1234");
    assert_eq!(list_repos(&s, 2, None).await.unwrap().next_page, Some(3));
    assert_eq!(list_repos(&s, 4, None).await.unwrap().next_page, None);
}

#[tokio::test]
async fn gitea_pages_by_total_count() {
    let repos = r#"[{"id":1,"full_name":"me/paper","private":false}]"#;
    let server = MockServer::start(vec![
        MockResponse::raw(200, &[("x-total-count", "120")], repos.as_bytes()),
        MockResponse::raw(200, &[("x-total-count", "120")], repos.as_bytes()),
    ]);
    let http = ForgeHttp::new(None).unwrap();
    let base = server.url();
    let s = session(&http, ForgeKind::Gitea, &base, "gitea-token-1234");
    assert_eq!(list_repos(&s, 2, None).await.unwrap().next_page, Some(3));
    assert_eq!(list_repos(&s, 3, None).await.unwrap().next_page, None);
    assert!(server.requests()[0].path.contains("limit=50"));
}

#[tokio::test]
async fn creating_a_repository_sends_each_servers_fields() {
    let http = ForgeHttp::new(None).unwrap();

    let github = MockServer::start(vec![MockResponse::json(
        201,
        r#"{"id":1,"full_name":"octo/paper","private":true}"#,
    )]);
    let base = github.url();
    let repo = create_repo(
        &session(&http, ForgeKind::GitHub, &base, "gho_test1234"),
        "paper",
        true,
    )
    .await
    .unwrap();
    assert_eq!(repo.clone_url, format!("{base}/octo/paper.git"));
    assert_eq!(
        body_json(&github, 0),
        serde_json::json!({ "name": "paper", "private": true, "auto_init": false })
    );
    assert_eq!(github.requests()[0].path, "/api/v3/user/repos");

    let gitlab = MockServer::start(vec![MockResponse::json(
        201,
        r#"{"id":2,"path_with_namespace":"octo/paper","visibility":"public"}"#,
    )]);
    let base = gitlab.url();
    let gitlab_session = session(&http, ForgeKind::GitLab, &base, "glpat-test1234");
    let repo = create_repo(&gitlab_session, "paper", false).await.unwrap();
    assert!(!repo.private);
    assert_eq!(
        body_json(&gitlab, 0),
        serde_json::json!({
            "name": "paper",
            "path": "paper",
            "visibility": "public",
            "initialize_with_readme": false
        })
    );

    let gitea = MockServer::start(vec![MockResponse::json(
        201,
        r#"{"id":3,"full_name":"octo/paper","private":true}"#,
    )]);
    let base = gitea.url();
    create_repo(
        &session(&http, ForgeKind::Gitea, &base, "gitea-token-1234"),
        "paper",
        true,
    )
    .await
    .unwrap();
    assert_eq!(
        body_json(&gitea, 0),
        serde_json::json!({ "name": "paper", "private": true, "auto_init": false })
    );
    assert_eq!(gitea.requests()[0].path, "/api/v1/user/repos");

    assert_eq!(
        create_repo(
            &session(&http, ForgeKind::Gitea, &base, "gitea-token-1234"),
            "my paper",
            true
        )
        .await,
        Err(ForgeError::InvalidRepositoryName)
    );
}

#[tokio::test]
async fn an_existing_name_is_a_conflict_on_every_server() {
    let http = ForgeHttp::new(None).unwrap();
    for (kind, reply) in [
        (
            ForgeKind::GitHub,
            MockResponse::json(
                422,
                r#"{"message":"Repository creation failed.","errors":[{"message":"name already exists on this account"}]}"#,
            ),
        ),
        (
            ForgeKind::GitLab,
            MockResponse::json(400, r#"{"message":{"name":["has already been taken"]}}"#),
        ),
        (
            ForgeKind::Gitea,
            MockResponse::json(
                409,
                r#"{"message":"The repository with the same name already exists."}"#,
            ),
        ),
    ] {
        let server = MockServer::start(vec![reply]);
        let base = server.url();
        let s = session(&http, kind, &base, "token-12345678");
        let result = create_repo(&s, "paper", true).await;
        assert_eq!(result, Err(ForgeError::Conflict), "{kind:?}");
    }
}

#[tokio::test]
async fn gitlab_encodes_nested_group_paths() {
    let server = MockServer::start(vec![MockResponse::raw(
        200,
        &[("content-type", "application/zip")],
        b"PK\x03\x04rest",
    )]);
    let http = ForgeHttp::new(None).unwrap();
    let base = server.url();
    let repo = RepoPath::parse(ForgeKind::GitLab, "group/sub/paper").unwrap();
    download_archive(
        &session(&http, ForgeKind::GitLab, &base, "glpat-test1234"),
        &repo,
        SHA,
        ARCHIVE_MAX_BYTES,
    )
    .await
    .unwrap();
    assert_eq!(
        server.requests()[0].path,
        format!("/api/v4/projects/group%2Fsub%2Fpaper/repository/archive.zip?sha={SHA}")
    );
}

#[tokio::test]
async fn gitea_uses_token_authorization_and_github_bearer() {
    let http = ForgeHttp::new(None).unwrap();
    let gitea = MockServer::start(vec![MockResponse::json(200, r#"{"login":"me"}"#)]);
    let base = gitea.url();
    current_user(&session(&http, ForgeKind::Gitea, &base, "glpat-like-token"))
        .await
        .unwrap();
    assert_eq!(
        gitea.requests()[0].header("authorization").as_deref(),
        Some("token glpat-like-token")
    );
    let github = MockServer::start(vec![MockResponse::json(200, r#"{"login":"me"}"#)]);
    let base = github.url();
    current_user(&session(&http, ForgeKind::GitHub, &base, "gho_test1234"))
        .await
        .unwrap();
    assert_eq!(
        github.requests()[0].header("authorization").as_deref(),
        Some("Bearer gho_test1234")
    );
}

#[tokio::test]
async fn archives_are_size_capped_and_checked_for_zip_magic() {
    let http = ForgeHttp::new(None).unwrap();
    let repo = RepoPath::parse(ForgeKind::Gitea, "me/paper").unwrap();

    let declared = MockServer::start(vec![MockResponse::declared(200, 4096)]);
    let base = declared.url();
    let s = session(&http, ForgeKind::Gitea, &base, "gitea-token-1234");
    assert!(matches!(
        download_archive(&s, &repo, SHA, 1024).await,
        Err(ForgeError::TooLarge { .. })
    ));

    let not_zip = MockServer::start(vec![MockResponse::raw(200, &[], b"not a zip")]);
    let base = not_zip.url();
    let s = session(&http, ForgeKind::Gitea, &base, "gitea-token-1234");
    assert!(matches!(
        download_archive(&s, &repo, SHA, 1024).await,
        Err(ForgeError::InvalidResponse { .. })
    ));

    let zip = MockServer::start(vec![MockResponse::raw(200, &[], b"PK\x03\x04")]);
    let base = zip.url();
    let s = session(&http, ForgeKind::Gitea, &base, "gitea-token-1234");
    assert_eq!(
        download_archive(&s, &repo, SHA, 1024).await.unwrap(),
        b"PK\x03\x04"
    );
    assert_eq!(
        zip.requests()[0].path,
        format!("/api/v1/repos/me/paper/archive/{SHA}.zip")
    );

    assert!(download_archive(&s, &repo, "main", 1024).await.is_err());
}

#[tokio::test]
async fn an_empty_repository_is_reported_as_empty() {
    let http = ForgeHttp::new(None).unwrap();
    let server = MockServer::start(vec![
        MockResponse::json(
            200,
            r#"{"id":1,"path_with_namespace":"g/p","default_branch":null,"empty_repo":true}"#,
        ),
        MockResponse::json(404, r#"{"message":"404 Branch Not Found"}"#),
    ]);
    let base = server.url();
    let s = session(&http, ForgeKind::GitLab, &base, "glpat-test1234");
    let repo = RepoPath::parse(ForgeKind::GitLab, "g/p").unwrap();
    assert_eq!(
        repo_info(&s, &repo).await.unwrap(),
        RepoInfo {
            default_branch: None,
            empty: true
        }
    );
    assert_eq!(
        branch_commit(&s, &repo, "main").await,
        Err(ForgeError::RepositoryEmpty)
    );
}

#[tokio::test]
async fn branch_commits_are_checked_and_branch_paths_follow_each_server() {
    let http = ForgeHttp::new(None).unwrap();
    let github = MockServer::start(vec![MockResponse::json(
        200,
        &format!(r#"{{"commit":{{"sha":"{SHA}"}}}}"#),
    )]);
    let base = github.url();
    let repo = RepoPath::parse(ForgeKind::GitHub, "octo/paper").unwrap();
    assert_eq!(
        branch_commit(
            &session(&http, ForgeKind::GitHub, &base, "gho_test1234"),
            &repo,
            "release/v2"
        )
        .await
        .unwrap(),
        SHA
    );
    assert_eq!(
        github.requests()[0].path,
        "/api/v3/repos/octo/paper/branches/release/v2"
    );

    let gitlab = MockServer::start(vec![MockResponse::json(
        200,
        r#"{"commit":{"id":"not-a-sha"}}"#,
    )]);
    let base = gitlab.url();
    let repo = RepoPath::parse(ForgeKind::GitLab, "g/p").unwrap();
    assert!(matches!(
        branch_commit(
            &session(&http, ForgeKind::GitLab, &base, "glpat-test1234"),
            &repo,
            "release/v2"
        )
        .await,
        Err(ForgeError::InvalidResponse { .. })
    ));
    assert_eq!(
        gitlab.requests()[0].path,
        "/api/v4/projects/g%2Fp/repository/branches/release%2Fv2"
    );
}

#[tokio::test]
async fn gitlab_token_scopes_come_from_the_self_endpoint() {
    let http = ForgeHttp::new(None).unwrap();
    let server = MockServer::start(vec![MockResponse::json(
        200,
        r#"{"id":4,"scopes":["read_api","read_user"]}"#,
    )]);
    let base = server.url();
    let s = session(&http, ForgeKind::GitLab, &base, "glpat-test1234");
    assert_eq!(
        token_scopes(&s).await.unwrap(),
        Some(vec!["read_api".to_string(), "read_user".to_string()])
    );
    assert_eq!(
        server.requests()[0].path,
        "/api/v4/personal_access_tokens/self"
    );

    let oauth = MockServer::start(vec![MockResponse::json(401, "{}")]);
    let base = oauth.url();
    let s = session(&http, ForgeKind::GitLab, &base, "oauth-token-1234");
    assert_eq!(token_scopes(&s).await.unwrap(), None);
}

#[test]
fn next_pages_come_from_the_link_header() {
    assert_eq!(
        next_page_from_link(
            r#"<https://x.org/r?page=4&per_page=100>; rel="next", <https://x.org/r?page=9>; rel="last""#
        ),
        Some(4)
    );
    assert_eq!(
        next_page_from_link(r#"<https://x.org/r?page=1>; rel="prev""#),
        None
    );
    assert_eq!(next_page_from_link(""), None);
}

#[test]
fn commits_and_branches_are_validated_before_they_reach_a_url() {
    assert!(valid_commit(SHA));
    assert!(valid_commit(&"a".repeat(64)));
    assert!(!valid_commit(&SHA.to_uppercase()));
    assert!(!valid_commit("abc123"));
    for good in ["main", "release/v2", "feature-x_1.2"] {
        assert!(valid_branch(good), "{good}");
    }
    for bad in [
        "",
        "../main",
        "a..b",
        "/main",
        "main/",
        "a b",
        "main.lock",
        ".hidden",
        "a:b",
        "@",
    ] {
        assert!(!valid_branch(bad), "{bad}");
    }
}
