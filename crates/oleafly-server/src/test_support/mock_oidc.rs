use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use axum::extract::{Form, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use oleafly_collab_protocol::crypto::{b64url_encode, pkce_s256};
use ring::rand::SystemRandom;
use ring::signature::{EcdsaKeyPair, KeyPair, ECDSA_P256_SHA256_FIXED_SIGNING};
use serde_json::{json, Value};
use tokio::task::JoinHandle;
use url::Url;

use crate::auth::jws::unix_seconds;
use crate::config::ProviderConfig;
use crate::tokens::random_token;

#[derive(Debug, Clone, PartialEq)]
pub struct MockOidcUser {
    pub subject: String,
    pub name: String,
    pub email: Option<String>,
    pub email_verified: Option<Value>,
}

pub struct TestSigner {
    key: EcdsaKeyPair,
    kid: String,
    rng: SystemRandom,
}

impl TestSigner {
    pub fn generate(kid: &str) -> TestSigner {
        let rng = SystemRandom::new();
        let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &rng)
            .expect("generate a signing key");
        let key = EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, pkcs8.as_ref(), &rng)
            .expect("load the signing key");
        TestSigner {
            key,
            kid: kid.to_owned(),
            rng,
        }
    }

    pub fn jwk(&self) -> Value {
        let point = self.key.public_key().as_ref();
        json!({
            "kty": "EC",
            "crv": "P-256",
            "use": "sig",
            "alg": "ES256",
            "kid": self.kid,
            "x": b64url_encode(&point[1..33]),
            "y": b64url_encode(&point[33..65])
        })
    }

    pub fn jwks(&self) -> Value {
        json!({ "keys": [self.jwk()] })
    }

    pub fn sign(&self, claims: &Value) -> String {
        self.sign_with_header(
            &json!({ "alg": "ES256", "typ": "JWT", "kid": self.kid }),
            claims,
        )
    }

    pub fn sign_with_header(&self, header: &Value, claims: &Value) -> String {
        let input = format!(
            "{}.{}",
            b64url_encode(header.to_string().as_bytes()),
            b64url_encode(claims.to_string().as_bytes())
        );
        let signature = self
            .key
            .sign(&self.rng, input.as_bytes())
            .expect("sign the test token");
        format!("{input}.{}", b64url_encode(signature.as_ref()))
    }
}

pub struct MockOidc {
    addr: SocketAddr,
    task: JoinHandle<()>,
}

struct OidcGrant {
    user: usize,
    client_id: String,
    nonce: String,
    challenge: String,
    redirect_uri: String,
}

struct OidcState {
    issuer: String,
    base: String,
    users: Vec<MockOidcUser>,
    signer: TestSigner,
    grants: Mutex<HashMap<String, OidcGrant>>,
}

impl OidcState {
    fn grants(&self) -> MutexGuard<'_, HashMap<String, OidcGrant>> {
        self.grants.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl MockOidc {
    pub async fn start(users: Vec<MockOidcUser>) -> MockOidc {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind the mock issuer");
        let addr = listener.local_addr().expect("mock issuer address");
        let state = Arc::new(OidcState {
            issuer: format!("http://{addr}/"),
            base: format!("http://{addr}"),
            users,
            signer: TestSigner::generate("mock-oidc-key"),
            grants: Mutex::new(HashMap::new()),
        });
        let router = Router::new()
            .route("/.well-known/openid-configuration", get(discovery))
            .route("/jwks", get(jwks))
            .route("/authorize", get(authorize))
            .route("/token", post(token))
            .with_state(state);
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        MockOidc { addr, task }
    }

    pub fn issuer(&self) -> Url {
        Url::parse(&format!("http://{}/", self.addr)).expect("mock issuer url")
    }
}

impl Drop for MockOidc {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub fn oidc_provider(id: &str, mock: &MockOidc, trust_email: bool) -> ProviderConfig {
    ProviderConfig::Oidc {
        id: id.to_owned(),
        label: "University login".to_owned(),
        issuer: mock.issuer().to_string(),
        client_id: format!("{id}-client"),
        client_secret: format!("{id}-secret"),
        trust_email,
    }
}

async fn discovery(State(state): State<Arc<OidcState>>) -> Json<Value> {
    Json(json!({
        "issuer": state.issuer,
        "authorization_endpoint": format!("{}/authorize", state.base),
        "token_endpoint": format!("{}/token", state.base),
        "jwks_uri": format!("{}/jwks", state.base),
        "response_types_supported": ["code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["ES256"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"]
    }))
}

async fn jwks(State(state): State<Arc<OidcState>>) -> Json<Value> {
    Json(state.signer.jwks())
}

async fn authorize(
    State(state): State<Arc<OidcState>>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let field = |name: &str| query.get(name).filter(|value| !value.is_empty()).cloned();
    let (Some(client_id), Some(redirect_uri), Some(client_state), Some(nonce), Some(challenge)) = (
        field("client_id"),
        field("redirect_uri"),
        field("state"),
        field("nonce"),
        field("code_challenge"),
    ) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let openid = query
        .get("scope")
        .is_some_and(|scope| scope.split(' ').any(|item| item == "openid"));
    let code_flow = query.get("response_type").map(String::as_str) == Some("code");
    let s256 = query.get("code_challenge_method").map(String::as_str) == Some("S256");
    if !(openid && code_flow && s256) {
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
            OidcGrant {
                user: 0,
                client_id,
                nonce,
                challenge,
                redirect_uri,
            },
        );
        target
            .query_pairs_mut()
            .append_pair("code", &code)
            .append_pair("state", &client_state);
    }
    (StatusCode::FOUND, [(header::LOCATION, target.to_string())]).into_response()
}

async fn token(
    State(state): State<Arc<OidcState>>,
    headers: HeaderMap,
    Form(form): Form<HashMap<String, String>>,
) -> Response {
    let refused = (
        StatusCode::BAD_REQUEST,
        Json(json!({ "error": "invalid_grant" })),
    )
        .into_response();
    if form.get("grant_type").map(String::as_str) != Some("authorization_code") {
        return refused;
    }
    let Some(grant) = form
        .get("code")
        .and_then(|code| state.grants().remove(code))
    else {
        return refused;
    };
    let basic = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("Basic "));
    let posted = form.get("client_id") == Some(&grant.client_id)
        && form
            .get("client_secret")
            .is_some_and(|secret| !secret.is_empty());
    let verifier = form
        .get("code_verifier")
        .is_some_and(|verifier| pkce_s256(verifier) == grant.challenge);
    let redirect = form.get("redirect_uri") == Some(&grant.redirect_uri);
    if !((basic || posted) && verifier && redirect) {
        return refused;
    }
    let user = &state.users[grant.user];
    let now = unix_seconds();
    let mut claims = json!({
        "iss": state.issuer,
        "sub": user.subject,
        "aud": grant.client_id,
        "exp": now + 600,
        "iat": now,
        "nonce": grant.nonce,
        "name": user.name
    });
    if let Some(email) = &user.email {
        claims["email"] = json!(email);
    }
    if let Some(verified) = &user.email_verified {
        claims["email_verified"] = verified.clone();
    }
    Json(json!({
        "access_token": random_token(),
        "token_type": "Bearer",
        "expires_in": 600,
        "id_token": state.signer.sign(&claims)
    }))
    .into_response()
}
