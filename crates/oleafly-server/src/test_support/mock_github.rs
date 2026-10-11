use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use axum::extract::{Form, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use oleafly_collab_protocol::crypto::pkce_s256;
use serde_json::{json, Value};
use tokio::task::JoinHandle;
use url::Url;

use crate::config::ProviderConfig;
use crate::tokens::random_token;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MockGithubUser {
    pub id: u64,
    pub login: String,
    pub name: String,
    pub emails: Vec<(String, bool)>,
}

pub struct MockGithub {
    addr: SocketAddr,
    task: JoinHandle<()>,
}

struct Grant {
    user: usize,
    challenge: String,
    redirect_uri: String,
}

struct GithubState {
    users: Vec<MockGithubUser>,
    grants: Mutex<HashMap<String, Grant>>,
    tokens: Mutex<HashMap<String, usize>>,
}

impl GithubState {
    fn grants(&self) -> MutexGuard<'_, HashMap<String, Grant>> {
        self.grants.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn tokens(&self) -> MutexGuard<'_, HashMap<String, usize>> {
        self.tokens.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl MockGithub {
    pub async fn start(users: Vec<MockGithubUser>) -> MockGithub {
        let state = Arc::new(GithubState {
            users,
            grants: Mutex::new(HashMap::new()),
            tokens: Mutex::new(HashMap::new()),
        });
        let router = Router::new()
            .route("/login/oauth/authorize", get(authorize))
            .route("/login/oauth/access_token", post(access_token))
            .route("/api/v3/user", get(user))
            .route("/api/v3/user/emails", get(emails))
            .with_state(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind the mock GitHub");
        let addr = listener.local_addr().expect("mock GitHub address");
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        MockGithub { addr, task }
    }

    pub fn web_url(&self) -> Url {
        Url::parse(&format!("http://{}/", self.addr)).expect("mock GitHub web url")
    }

    pub fn api_url(&self) -> Url {
        Url::parse(&format!("http://{}/api/v3", self.addr)).expect("mock GitHub api url")
    }
}

impl Drop for MockGithub {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub fn github_provider(id: &str, mock: &MockGithub) -> ProviderConfig {
    ProviderConfig::Github {
        id: id.to_owned(),
        label: "GitHub".to_owned(),
        client_id: format!("{id}-client"),
        client_secret: format!("{id}-secret"),
        web_url: mock.web_url(),
        api_url: mock.api_url(),
    }
}

pub async fn authorization_code(authorize: &Url) -> String {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("http client");
    let response = client
        .get(authorize.clone())
        .send()
        .await
        .expect("authorize request");
    let location = response
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .expect("the provider redirected back")
        .to_owned();
    let target = Url::parse(&location).expect("redirect target");
    target
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.into_owned())
        .expect("the redirect carries a code")
}

fn redirect(target: &Url) -> Response {
    (StatusCode::FOUND, [(header::LOCATION, target.to_string())]).into_response()
}

async fn authorize(
    State(state): State<Arc<GithubState>>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let field = |name: &str| query.get(name).filter(|value| !value.is_empty()).cloned();
    let (Some(_client_id), Some(redirect_uri), Some(client_state), Some(challenge)) = (
        field("client_id"),
        field("redirect_uri"),
        field("state"),
        field("code_challenge"),
    ) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if query.get("code_challenge_method").map(String::as_str) != Some("S256") {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Ok(mut target) = Url::parse(&redirect_uri) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if state.users.is_empty() {
        target
            .query_pairs_mut()
            .append_pair("error", "access_denied")
            .append_pair("state", &client_state);
    } else {
        let code = random_token();
        state.grants().insert(
            code.clone(),
            Grant {
                user: 0,
                challenge,
                redirect_uri,
            },
        );
        target
            .query_pairs_mut()
            .append_pair("code", &code)
            .append_pair("state", &client_state);
    }
    redirect(&target)
}

async fn access_token(
    State(state): State<Arc<GithubState>>,
    Form(form): Form<HashMap<String, String>>,
) -> Json<Value> {
    let refused = Json(json!({
        "error": "bad_verification_code",
        "error_description": "The code passed is incorrect or expired."
    }));
    let Some(grant) = form
        .get("code")
        .and_then(|code| state.grants().remove(code))
    else {
        return refused;
    };
    let verifier_matches = form
        .get("code_verifier")
        .is_some_and(|verifier| pkce_s256(verifier) == grant.challenge);
    let redirect_matches = form.get("redirect_uri") == Some(&grant.redirect_uri);
    let client_present = ["client_id", "client_secret"]
        .iter()
        .all(|key| form.get(*key).is_some_and(|value| !value.is_empty()));
    if !(verifier_matches && redirect_matches && client_present) {
        return refused;
    }
    let token = random_token();
    state.tokens().insert(token.clone(), grant.user);
    Json(json!({ "access_token": token, "token_type": "bearer", "scope": "read:user,user:email" }))
}

fn signed_in_user(state: &GithubState, headers: &HeaderMap) -> Result<usize, StatusCode> {
    if !headers.contains_key(header::USER_AGENT) {
        return Err(StatusCode::FORBIDDEN);
    }
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .strip_prefix("Bearer ")
                .or_else(|| value.strip_prefix("token "))
        })
        .ok_or(StatusCode::UNAUTHORIZED)?;
    state
        .tokens()
        .get(token)
        .copied()
        .ok_or(StatusCode::UNAUTHORIZED)
}

async fn user(State(state): State<Arc<GithubState>>, headers: HeaderMap) -> Response {
    match signed_in_user(&state, &headers) {
        Ok(index) => {
            let person = &state.users[index];
            Json(json!({
                "login": person.login,
                "id": person.id,
                "name": person.name,
                "avatar_url": format!("https://avatars.example.test/u/{}", person.id)
            }))
            .into_response()
        }
        Err(status) => status.into_response(),
    }
}

async fn emails(State(state): State<Arc<GithubState>>, headers: HeaderMap) -> Response {
    match signed_in_user(&state, &headers) {
        Ok(index) => {
            let listed: Vec<Value> = state.users[index]
                .emails
                .iter()
                .enumerate()
                .map(|(position, (email, verified))| {
                    json!({
                        "email": email,
                        "verified": verified,
                        "primary": position == 0,
                        "visibility": null
                    })
                })
                .collect();
            Json(Value::Array(listed)).into_response()
        }
        Err(status) => status.into_response(),
    }
}
