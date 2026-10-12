use std::time::Duration;

use ::url::Url;
use oleafly_collab_protocol::admin::{
    AllowlistEntry, DomainRule, MemberPatch, MemberSummary, NewAllowlistEntry, NewDomainRule, Page,
    RuntimeSettings, RuntimeSettingsPatch, SecurityEvent,
};
use oleafly_collab_protocol::auth::{
    AccountSummary, ApiError, AuthStartQuery, ChallengeResponse, DeviceSummary, RefreshRequest,
    SessionTokens, TokenRequest,
};
use oleafly_collab_protocol::capabilities::{CapabilityManifest, WELL_KNOWN_PATH};
use oleafly_collab_protocol::ids::{AccountId, DeviceId, SharedProjectId};
use oleafly_collab_protocol::projects::{
    MemberGrant, NewProject, PersonSummary, ProjectMember, ProjectPatch, ProjectRole,
    ProjectSummary,
};
use reqwest::header::LOCATION;
use reqwest::{RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;

use super::{ServerUrl, CONNECT_TIMEOUT};
use crate::CollabError;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(600);
pub const SNAPSHOT_SEQ_HEADER: &str = "x-oleafly-snapshot-seq";
const USER_AGENT: &str = concat!("oleafly-collab/", env!("CARGO_PKG_VERSION"));

pub struct ServerClient {
    url: ServerUrl,
    http: reqwest::Client,
}

impl ServerClient {
    pub fn new(url: ServerUrl) -> Result<ServerClient, CollabError> {
        let http = match build_http(&url, true) {
            Ok(http) => http,
            Err(_) => build_http(&url, false).map_err(network_error)?,
        };
        Ok(ServerClient { url, http })
    }

    pub fn url(&self) -> &ServerUrl {
        &self.url
    }

    pub(crate) fn http(&self) -> &reqwest::Client {
        &self.http
    }

    pub(crate) fn auth_start_url(&self, query: &AuthStartQuery) -> Result<Url, CollabError> {
        let request = self
            .http
            .get(self.url.endpoint("auth/start"))
            .query(query)
            .build()
            .map_err(network_error)?;
        Ok(request.url().clone())
    }

    pub async fn capabilities(&self) -> Result<CapabilityManifest, CollabError> {
        json(self.http.get(self.url.endpoint(WELL_KNOWN_PATH))).await
    }

    pub async fn challenge(&self) -> Result<ChallengeResponse, CollabError> {
        json(self.http.post(self.url.endpoint("auth/challenge"))).await
    }

    pub async fn exchange_token(
        &self,
        request: &TokenRequest,
    ) -> Result<SessionTokens, CollabError> {
        json(
            self.http
                .post(self.url.endpoint("auth/token"))
                .json(request),
        )
        .await
    }

    pub async fn refresh(&self, request: &RefreshRequest) -> Result<SessionTokens, CollabError> {
        json(
            self.http
                .post(self.url.endpoint("auth/refresh"))
                .json(request),
        )
        .await
    }

    pub async fn sign_out(&self, access: &str) -> Result<(), CollabError> {
        empty(
            self.http
                .post(self.url.endpoint("auth/sign-out"))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn me(&self, access: &str) -> Result<AccountSummary, CollabError> {
        json(
            self.http
                .get(self.url.endpoint("api/v1/me"))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn devices(&self, access: &str) -> Result<Vec<DeviceSummary>, CollabError> {
        json(
            self.http
                .get(self.url.endpoint("api/v1/devices"))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn sign_out_device(&self, access: &str, device: DeviceId) -> Result<(), CollabError> {
        empty(
            self.http
                .delete(self.item("api/v1/devices", &device.to_string()))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn admin_members(&self, access: &str) -> Result<Vec<MemberSummary>, CollabError> {
        json(
            self.http
                .get(self.url.endpoint("api/v1/admin/members"))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn admin_patch_member(
        &self,
        access: &str,
        account: AccountId,
        patch: &MemberPatch,
    ) -> Result<MemberSummary, CollabError> {
        json(
            self.http
                .patch(self.item("api/v1/admin/members", &account.to_string()))
                .bearer_auth(access)
                .json(patch),
        )
        .await
    }

    pub async fn admin_remove_member(
        &self,
        access: &str,
        account: AccountId,
    ) -> Result<(), CollabError> {
        empty(
            self.http
                .delete(self.item("api/v1/admin/members", &account.to_string()))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn admin_member_devices(
        &self,
        access: &str,
        account: AccountId,
    ) -> Result<Vec<DeviceSummary>, CollabError> {
        let mut url = self.item("api/v1/admin/members", &account.to_string());
        if let Ok(mut segments) = url.path_segments_mut() {
            segments.push("devices");
        }
        json(self.http.get(url).bearer_auth(access)).await
    }

    pub async fn admin_sign_out_device(
        &self,
        access: &str,
        device: DeviceId,
    ) -> Result<(), CollabError> {
        empty(
            self.http
                .delete(self.item("api/v1/admin/devices", &device.to_string()))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn admin_allowlist(&self, access: &str) -> Result<Vec<AllowlistEntry>, CollabError> {
        json(
            self.http
                .get(self.url.endpoint("api/v1/admin/allowlist"))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn admin_add_allowlist(
        &self,
        access: &str,
        entry: &NewAllowlistEntry,
    ) -> Result<AllowlistEntry, CollabError> {
        json(
            self.http
                .post(self.url.endpoint("api/v1/admin/allowlist"))
                .bearer_auth(access)
                .json(entry),
        )
        .await
    }

    pub async fn admin_remove_allowlist(&self, access: &str, id: &str) -> Result<(), CollabError> {
        empty(
            self.http
                .delete(self.item("api/v1/admin/allowlist", id))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn admin_domain_rules(&self, access: &str) -> Result<Vec<DomainRule>, CollabError> {
        json(
            self.http
                .get(self.url.endpoint("api/v1/admin/domains"))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn admin_add_domain_rule(
        &self,
        access: &str,
        rule: &NewDomainRule,
    ) -> Result<DomainRule, CollabError> {
        json(
            self.http
                .post(self.url.endpoint("api/v1/admin/domains"))
                .bearer_auth(access)
                .json(rule),
        )
        .await
    }

    pub async fn admin_remove_domain_rule(
        &self,
        access: &str,
        id: &str,
    ) -> Result<(), CollabError> {
        empty(
            self.http
                .delete(self.item("api/v1/admin/domains", id))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn admin_settings(&self, access: &str) -> Result<RuntimeSettings, CollabError> {
        json(
            self.http
                .get(self.url.endpoint("api/v1/admin/settings"))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn admin_patch_settings(
        &self,
        access: &str,
        patch: &RuntimeSettingsPatch,
    ) -> Result<RuntimeSettings, CollabError> {
        json(
            self.http
                .patch(self.url.endpoint("api/v1/admin/settings"))
                .bearer_auth(access)
                .json(patch),
        )
        .await
    }

    pub async fn admin_security_log(
        &self,
        access: &str,
        cursor: Option<&str>,
    ) -> Result<Page<SecurityEvent>, CollabError> {
        let mut url = self.url.endpoint("api/v1/admin/security-log");
        if let Some(cursor) = cursor {
            url.query_pairs_mut().append_pair("cursor", cursor);
        }
        json(self.http.get(url).bearer_auth(access)).await
    }

    fn project_url(&self, project: SharedProjectId, rest: &[&str]) -> Url {
        let mut url = self.url.endpoint("api/v1/projects");
        if let Ok(mut segments) = url.path_segments_mut() {
            segments.push(&project.to_string());
            for segment in rest {
                segments.push(segment);
            }
        }
        url
    }

    pub async fn create_project(
        &self,
        access: &str,
        title: &str,
    ) -> Result<ProjectSummary, CollabError> {
        let body = NewProject {
            title: title.to_owned(),
        };
        json(
            self.http
                .post(self.url.endpoint("api/v1/projects"))
                .bearer_auth(access)
                .json(&body),
        )
        .await
    }

    pub async fn projects(&self, access: &str) -> Result<Vec<ProjectSummary>, CollabError> {
        json(
            self.http
                .get(self.url.endpoint("api/v1/projects"))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn project(
        &self,
        access: &str,
        project: SharedProjectId,
    ) -> Result<ProjectSummary, CollabError> {
        json(
            self.http
                .get(self.project_url(project, &[]))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn patch_project(
        &self,
        access: &str,
        project: SharedProjectId,
        patch: &ProjectPatch,
    ) -> Result<ProjectSummary, CollabError> {
        json(
            self.http
                .patch(self.project_url(project, &[]))
                .bearer_auth(access)
                .json(patch),
        )
        .await
    }

    pub async fn commit_project(
        &self,
        access: &str,
        project: SharedProjectId,
    ) -> Result<ProjectSummary, CollabError> {
        json(
            self.http
                .post(self.project_url(project, &["commit"]))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn archive_project(
        &self,
        access: &str,
        project: SharedProjectId,
    ) -> Result<(), CollabError> {
        empty(
            self.http
                .post(self.project_url(project, &["archive"]))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn join_project(
        &self,
        access: &str,
        project: SharedProjectId,
    ) -> Result<ProjectSummary, CollabError> {
        json(
            self.http
                .post(self.project_url(project, &["join"]))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn put_blob(
        &self,
        access: &str,
        project: SharedProjectId,
        hash: &str,
        bytes: Vec<u8>,
    ) -> Result<(), CollabError> {
        empty(
            self.http
                .put(self.project_url(project, &["blobs", hash]))
                .bearer_auth(access)
                .timeout(TRANSFER_TIMEOUT)
                .body(bytes),
        )
        .await
    }

    pub async fn get_blob(
        &self,
        access: &str,
        project: SharedProjectId,
        hash: &str,
    ) -> Result<Vec<u8>, CollabError> {
        bytes(
            self.http
                .get(self.project_url(project, &["blobs", hash]))
                .bearer_auth(access)
                .timeout(TRANSFER_TIMEOUT),
        )
        .await
        .map(|(_, body)| body)
    }

    pub async fn put_snapshot(
        &self,
        access: &str,
        project: SharedProjectId,
        seq: u64,
        snapshot: Vec<u8>,
    ) -> Result<(), CollabError> {
        let mut url = self.project_url(project, &["snapshot"]);
        url.query_pairs_mut().append_pair("seq", &seq.to_string());
        empty(
            self.http
                .put(url)
                .bearer_auth(access)
                .timeout(TRANSFER_TIMEOUT)
                .body(snapshot),
        )
        .await
    }

    pub async fn get_snapshot(
        &self,
        access: &str,
        project: SharedProjectId,
    ) -> Result<(u64, Vec<u8>), CollabError> {
        let (headers, body) = bytes(
            self.http
                .get(self.project_url(project, &["snapshot"]))
                .bearer_auth(access)
                .timeout(TRANSFER_TIMEOUT),
        )
        .await?;
        let seq = headers
            .get(SNAPSHOT_SEQ_HEADER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or_else(|| CollabError::Api {
                status: 200,
                code: "invalid_response".to_string(),
                message: "the snapshot has no sequence number".to_string(),
            })?;
        Ok((seq, body))
    }

    pub async fn members(
        &self,
        access: &str,
        project: SharedProjectId,
    ) -> Result<Vec<ProjectMember>, CollabError> {
        json(
            self.http
                .get(self.project_url(project, &["members"]))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn grant_member(
        &self,
        access: &str,
        project: SharedProjectId,
        account: AccountId,
        role: ProjectRole,
    ) -> Result<ProjectMember, CollabError> {
        json(
            self.http
                .put(self.project_url(project, &["members", &account.to_string()]))
                .bearer_auth(access)
                .json(&MemberGrant { role }),
        )
        .await
    }

    pub async fn remove_member(
        &self,
        access: &str,
        project: SharedProjectId,
        account: AccountId,
    ) -> Result<(), CollabError> {
        empty(
            self.http
                .delete(self.project_url(project, &["members", &account.to_string()]))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn directory(
        &self,
        access: &str,
        query: &str,
    ) -> Result<Vec<PersonSummary>, CollabError> {
        let mut url = self.url.endpoint("api/v1/directory");
        url.query_pairs_mut().append_pair("q", query);
        json(self.http.get(url).bearer_auth(access)).await
    }

    fn item(&self, collection: &str, id: &str) -> Url {
        let mut url = self.url.endpoint(collection);
        if let Ok(mut segments) = url.path_segments_mut() {
            segments.push(id);
        }
        url
    }
}

pub(crate) fn build_http(
    url: &ServerUrl,
    os_roots: bool,
) -> Result<reqwest::Client, reqwest::Error> {
    let builder = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .tls_built_in_native_certs(os_roots);
    let builder = if url.is_loopback() {
        builder.no_proxy()
    } else {
        builder.https_only(true)
    };
    builder.build()
}

async fn json<T: DeserializeOwned>(request: RequestBuilder) -> Result<T, CollabError> {
    let response = check_status(request.send().await.map_err(network_error)?).await?;
    let status = response.status().as_u16();
    let body = response.bytes().await.map_err(network_error)?;
    serde_json::from_slice(&body).map_err(|error| CollabError::Api {
        status,
        code: "invalid_response".to_string(),
        message: error.to_string(),
    })
}

async fn bytes(
    request: RequestBuilder,
) -> Result<(reqwest::header::HeaderMap, Vec<u8>), CollabError> {
    let response = check_status(request.send().await.map_err(network_error)?).await?;
    let headers = response.headers().clone();
    let body = response.bytes().await.map_err(network_error)?;
    Ok((headers, body.to_vec()))
}

async fn empty(request: RequestBuilder) -> Result<(), CollabError> {
    check_status(request.send().await.map_err(network_error)?)
        .await
        .map(|_| ())
}

pub(crate) async fn check_status(response: Response) -> Result<Response, CollabError> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    if status.is_redirection() {
        let location = response
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        if location.starts_with("http://") {
            return Err(CollabError::NotHttps);
        }
        return Err(CollabError::Api {
            status: status.as_u16(),
            code: "redirect".to_string(),
            message: location,
        });
    }
    if status == StatusCode::UNAUTHORIZED {
        return Err(CollabError::Unauthorized);
    }
    let numeric = status.as_u16();
    let body = response.bytes().await.unwrap_or_default();
    Err(match serde_json::from_slice::<ApiError>(&body) {
        Ok(error) => CollabError::Api {
            status: numeric,
            code: error.code,
            message: error.message,
        },
        Err(_) => CollabError::Api {
            status: numeric,
            code: format!("http_{numeric}"),
            message: String::from_utf8_lossy(&body).chars().take(200).collect(),
        },
    })
}

pub(crate) fn network_error(error: reqwest::Error) -> CollabError {
    let mut message = error.to_string();
    let mut source = std::error::Error::source(&error);
    while let Some(cause) = source {
        message.push_str(": ");
        message.push_str(&cause.to_string());
        source = cause.source();
    }
    CollabError::Network(message)
}

#[cfg(test)]
mod tests {
    use oleafly_collab_protocol::admin::{AllowlistMatcher, SecurityEventKind};
    use oleafly_collab_protocol::roles::ServerRole;
    use oleafly_server::test_support::{test_config, SeededMember, TestServer};

    use super::*;
    use crate::client::test_util::{canned, closed_url, http_response, seed, server_url};

    async fn admin_and_member() -> (TestServer, ServerClient, SeededMember, SeededMember) {
        let server = TestServer::start(test_config()).await;
        let admin = seed(&server, ServerRole::Admin).await;
        let member = seed(&server, ServerRole::Member).await;
        let client = ServerClient::new(server_url(&server)).expect("client");
        (server, client, admin, member)
    }

    fn guests_on() -> RuntimeSettingsPatch {
        RuntimeSettingsPatch {
            guests_enabled: Some(true),
            guest_approval_required: None,
            directory_visible: None,
            directory_shows_email: None,
            link_sharing_allowed: None,
            access_logs_allowed: None,
            email_notifications: None,
            comments_allowed: None,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn reads_the_manifest_of_a_fresh_server() {
        let server = TestServer::start(test_config()).await;
        let client = ServerClient::new(server_url(&server)).expect("client");
        let manifest = client.capabilities().await.expect("manifest");
        assert_eq!(manifest.server_id, server.state().server_id);
        assert!(manifest.needs_setup);
        assert_eq!(client.url(), &server_url(&server));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn challenges_are_fresh_each_time() {
        let server = TestServer::start(test_config()).await;
        let client = ServerClient::new(server_url(&server)).expect("client");
        let first = client.challenge().await.expect("challenge");
        let second = client.challenge().await.expect("challenge");
        assert!(!first.nonce.is_empty());
        assert_ne!(first.nonce, second.nonce);
        assert!(first.expires_at > 0);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn me_and_devices_describe_the_calling_device() {
        let (_server, client, _admin, member) = admin_and_member().await;
        let me = client.me(&member.access_token).await.expect("me");
        assert_eq!(me.account_id, member.account_id);
        assert!(matches!(me.server_role, ServerRole::Member));
        let devices = client.devices(&member.access_token).await.expect("devices");
        assert!(devices
            .iter()
            .any(|device| device.device_id == member.device_id && device.current));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn signing_out_ends_this_session() {
        let (_server, client, _admin, member) = admin_and_member().await;
        client
            .sign_out(&member.access_token)
            .await
            .expect("sign out");
        assert!(matches!(
            client.me(&member.access_token).await,
            Err(CollabError::Unauthorized)
        ));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn signing_out_a_device_by_id_ends_its_session() {
        let (_server, client, _admin, member) = admin_and_member().await;
        client
            .sign_out_device(&member.access_token, member.device_id)
            .await
            .expect("sign out device");
        assert!(matches!(
            client.me(&member.access_token).await,
            Err(CollabError::Unauthorized)
        ));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn admin_changes_a_role_and_removes_a_member() {
        let (_server, client, admin, member) = admin_and_member().await;
        let members = client
            .admin_members(&admin.access_token)
            .await
            .expect("members");
        assert!(members
            .iter()
            .any(|item| item.account.account_id == member.account_id));
        let patch = MemberPatch {
            role: Some(ServerRole::Maintainer),
            status: None,
        };
        let updated = client
            .admin_patch_member(&admin.access_token, member.account_id, &patch)
            .await
            .expect("patch");
        assert!(matches!(
            updated.account.server_role,
            ServerRole::Maintainer
        ));
        client
            .admin_remove_member(&admin.access_token, member.account_id)
            .await
            .expect("remove");
        assert!(matches!(
            client.me(&member.access_token).await,
            Err(CollabError::Unauthorized)
        ));
        let members = client
            .admin_members(&admin.access_token)
            .await
            .expect("members");
        assert!(members
            .iter()
            .all(|item| item.account.account_id != member.account_id));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn admin_lists_a_members_devices_and_members_cannot() {
        let (_server, client, admin, member) = admin_and_member().await;
        let devices = client
            .admin_member_devices(&admin.access_token, member.account_id)
            .await
            .expect("devices");
        assert!(devices
            .iter()
            .any(|device| device.device_id == member.device_id));
        assert!(matches!(
            client
                .admin_member_devices(&member.access_token, admin.account_id)
                .await,
            Err(CollabError::Api { status: 403, .. })
        ));
    }

    #[test]
    fn clients_build_with_and_without_os_roots() {
        let url = ServerUrl::parse("https://uni.edu/oleafly").expect("address");
        assert!(build_http(&url, true).is_ok());
        assert!(build_http(&url, false).is_ok());
        assert!(ServerClient::new(url).is_ok());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn admin_signs_out_another_device() {
        let (_server, client, admin, member) = admin_and_member().await;
        client
            .admin_sign_out_device(&admin.access_token, member.device_id)
            .await
            .expect("sign out");
        assert!(matches!(
            client.me(&member.access_token).await,
            Err(CollabError::Unauthorized)
        ));
        assert!(client.me(&admin.access_token).await.is_ok());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn admin_manages_the_allowlist_and_domain_rules() {
        let (_server, client, admin, _member) = admin_and_member().await;
        let access = admin.access_token.as_str();
        let entry = client
            .admin_add_allowlist(
                access,
                &NewAllowlistEntry {
                    matcher: AllowlistMatcher::Email {
                        email: "Alice@Uni.EDU".to_string(),
                    },
                    role: ServerRole::Member,
                },
            )
            .await
            .expect("add entry");
        let listed = client.admin_allowlist(access).await.expect("allowlist");
        assert!(listed.iter().any(|item| item.id == entry.id));
        client
            .admin_remove_allowlist(access, &entry.id)
            .await
            .expect("remove entry");
        let listed = client.admin_allowlist(access).await.expect("allowlist");
        assert!(listed.iter().all(|item| item.id != entry.id));
        let rule = client
            .admin_add_domain_rule(
                access,
                &NewDomainRule {
                    domain: "cs.uni.edu".to_string(),
                    role: ServerRole::Member,
                },
            )
            .await
            .expect("add rule");
        let rules = client.admin_domain_rules(access).await.expect("rules");
        assert!(rules
            .iter()
            .any(|item| item.id == rule.id && item.domain == "cs.uni.edu"));
        client
            .admin_remove_domain_rule(access, &rule.id)
            .await
            .expect("remove rule");
        let rules = client.admin_domain_rules(access).await.expect("rules");
        assert!(rules.iter().all(|item| item.id != rule.id));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn admin_reads_and_patches_runtime_settings() {
        let (_server, client, admin, _member) = admin_and_member().await;
        let before = client
            .admin_settings(&admin.access_token)
            .await
            .expect("settings");
        assert!(!before.guests_enabled);
        let after = client
            .admin_patch_settings(&admin.access_token, &guests_on())
            .await
            .expect("patch");
        assert!(after.guests_enabled);
        assert_eq!(after.directory_visible, before.directory_visible);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn admin_reads_the_security_log() {
        let (_server, client, admin, _member) = admin_and_member().await;
        client
            .admin_add_allowlist(
                &admin.access_token,
                &NewAllowlistEntry {
                    matcher: AllowlistMatcher::Email {
                        email: "alice@uni.edu".to_string(),
                    },
                    role: ServerRole::Member,
                },
            )
            .await
            .expect("add entry");
        let page = client
            .admin_security_log(&admin.access_token, None)
            .await
            .expect("log");
        assert!(page
            .items
            .iter()
            .any(|event| matches!(event.kind, SecurityEventKind::AllowlistAdded)));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn members_are_forbidden_from_admin_routes() {
        let (_server, client, _admin, member) = admin_and_member().await;
        assert!(matches!(
            client.admin_members(&member.access_token).await,
            Err(CollabError::Api { status: 403, .. })
        ));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn unknown_member_is_not_found() {
        let (_server, client, admin, _member) = admin_and_member().await;
        let patch = MemberPatch {
            role: Some(ServerRole::Member),
            status: None,
        };
        assert!(matches!(
            client
                .admin_patch_member(&admin.access_token, AccountId::new_v7(), &patch)
                .await,
            Err(CollabError::Api { status: 404, .. })
        ));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn bogus_token_is_unauthorized() {
        let server = TestServer::start(test_config()).await;
        let client = ServerClient::new(server_url(&server)).expect("client");
        assert!(matches!(
            client.me("not-a-token").await,
            Err(CollabError::Unauthorized)
        ));
    }

    #[tokio::test]
    async fn closed_port_is_a_network_error() {
        let client = ServerClient::new(closed_url().await).expect("client");
        assert!(matches!(
            client.capabilities().await,
            Err(CollabError::Network(_))
        ));
    }

    #[tokio::test]
    async fn redirect_to_plain_http_is_refused() {
        let response = http_response(
            "302 Found",
            &[(
                "Location",
                "http://uni.edu/oleafly/.well-known/oleafly-server",
            )],
            "",
        );
        let client = ServerClient::new(canned(response).await).expect("client");
        assert!(matches!(
            client.capabilities().await,
            Err(CollabError::NotHttps)
        ));
    }

    #[tokio::test]
    async fn html_error_page_keeps_its_status() {
        let response = http_response(
            "502 Bad Gateway",
            &[("Content-Type", "text/html")],
            "<h1>Bad Gateway</h1>",
        );
        let client = ServerClient::new(canned(response).await).expect("client");
        assert!(matches!(
            client.capabilities().await,
            Err(CollabError::Api { status: 502, ref code, .. }) if code == "http_502"
        ));
    }

    #[tokio::test]
    async fn api_error_body_is_kept() {
        let response = http_response(
            "409 Conflict",
            &[("Content-Type", "application/json")],
            "{\"code\":\"conflict\",\"message\":\"already listed\"}",
        );
        let client = ServerClient::new(canned(response).await).expect("client");
        assert!(matches!(
            client.capabilities().await,
            Err(CollabError::Api { status: 409, ref code, ref message })
                if code == "conflict" && message == "already listed"
        ));
    }
}
