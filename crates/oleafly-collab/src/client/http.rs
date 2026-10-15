use std::sync::Arc;
use std::time::Duration;

use ::url::Url;
use oleafly_collab_protocol::admin::{
    AllowlistEntry, DomainRule, MemberPatch, MemberSummary, NewAllowlistEntry, NewDomainRule, Page,
    RuntimeSettings, RuntimeSettingsPatch, SecurityEvent,
};
use oleafly_collab_protocol::auth::{
    AccountSummary, ApiError, AuthStartQuery, ChallengeResponse, DeviceSummary, RefreshRequest,
    SessionEndReason, SessionTokens, SetupClaimRequest, SetupClaimResponse, TokenRequest,
};
use oleafly_collab_protocol::capabilities::{CapabilityManifest, WELL_KNOWN_PATH};
use oleafly_collab_protocol::email::{
    EmailPreferences, EmailPreferencesPatch, EmailStatus, EmailTestResult,
};
use oleafly_collab_protocol::ids::{AccountId, DeviceId, SharedProjectId};
use oleafly_collab_protocol::projects::{
    MemberGrant, NewProject, PersonSummary, ProjectDevice, ProjectMember, ProjectPatch,
    ProjectRole, ProjectSummary,
};
use oleafly_collab_protocol::snapshots::{
    snapshot_signing_bytes, ProjectPeer, SNAPSHOT_DEVICE_HEADER, SNAPSHOT_SIGNATURE_HEADER,
};
use reqwest::header::{LOCATION, RETRY_AFTER};
use reqwest::{RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;

use super::{ServerUrl, CONNECT_TIMEOUT};
use crate::{CollabError, DeviceKey};

pub const PEERS_PER_REQUEST: usize = 200;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnapshotSignature {
    pub device_id: DeviceId,
    pub signature: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnapshotDownload {
    pub seq: u64,
    pub bytes: Vec<u8>,
    pub signed: Option<SnapshotSignature>,
}

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(600);
const SLOWEST_TRANSFER_BYTES_PER_SECOND: u64 = 32 * 1024;
const STALLED_AFTER: Duration = Duration::from_secs(60);
const NO_DEADLINE: Duration = Duration::from_secs(24 * 60 * 60);
const LARGEST_PREALLOCATION: u64 = 64 * 1024 * 1024;
// The most the app reads of a JSON answer, the same as for long-poll, and of
// an error answer, which only needs room for the server's code and message.
const JSON_ANSWER_BYTES: usize = 32 * 1024 * 1024;
const ERROR_ANSWER_BYTES: usize = 64 * 1024;

// Figures and snapshots get ten minutes, or the time a slow link needs for
// their size when that is longer, so a large one on a slow link still fits.
pub(crate) fn transfer_timeout(bytes: u64) -> Duration {
    TRANSFER_TIMEOUT.max(Duration::from_secs(
        bytes / SLOWEST_TRANSFER_BYTES_PER_SECOND,
    ))
}
pub const SNAPSHOT_SEQ_HEADER: &str = "x-oleafly-snapshot-seq";
const USER_AGENT: &str = concat!("oleafly-collab/", env!("CARGO_PKG_VERSION"));

#[derive(Clone)]
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

    // How much longer the server asked the app to stay away, if it did.
    pub fn asked_wait(&self) -> Option<Duration> {
        asked_wait_for(&self.url.endpoint(""))
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

    pub async fn setup_claim(
        &self,
        request: &SetupClaimRequest,
    ) -> Result<SetupClaimResponse, CollabError> {
        json(
            self.http
                .post(self.url.endpoint("auth/setup-claim"))
                .json(request),
        )
        .await
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

    pub async fn join_preview(
        &self,
        access: &str,
        project: SharedProjectId,
    ) -> Result<ProjectSummary, CollabError> {
        json(
            self.http
                .get(self.project_url(project, &["join"]))
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
        self.put_blob_with(access, project, hash, bytes, None).await
    }

    // `progress` hears the bytes sent so far and the total as the upload
    // goes.
    pub async fn put_blob_with(
        &self,
        access: &str,
        project: SharedProjectId,
        hash: &str,
        bytes: Vec<u8>,
        progress: Option<TransferProgress>,
    ) -> Result<(), CollabError> {
        let request = self
            .http
            .put(self.project_url(project, &["blobs", hash]))
            .bearer_auth(access);
        upload(request, bytes, progress, STALLED_AFTER)
            .await
            .map(|_| ())
    }

    pub async fn get_blob(
        &self,
        access: &str,
        project: SharedProjectId,
        hash: &str,
    ) -> Result<Vec<u8>, CollabError> {
        self.get_blob_with(access, project, hash, None).await
    }

    // `progress` hears the bytes received so far and the total the server
    // gave, 0 when it gave none, as the download goes.
    pub async fn get_blob_with(
        &self,
        access: &str,
        project: SharedProjectId,
        hash: &str,
        progress: Option<TransferProgress>,
    ) -> Result<Vec<u8>, CollabError> {
        let request = self
            .http
            .get(self.project_url(project, &["blobs", hash]))
            .bearer_auth(access);
        let sent = tokio::time::timeout(STALLED_AFTER, request.timeout(NO_DEADLINE).send())
            .await
            .map_err(|_| CollabError::Network("the server did not start the transfer".to_string()))?
            .map_err(network_error)?;
        let response = check_status(sent).await?;
        read_steadily_with(response, STALLED_AFTER, progress.as_deref()).await
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
                .timeout(transfer_timeout(snapshot.len() as u64))
                .body(snapshot),
        )
        .await
    }

    pub async fn put_first_snapshot(
        &self,
        access: &str,
        project: SharedProjectId,
        snapshot: Vec<u8>,
        key: &DeviceKey,
    ) -> Result<(), CollabError> {
        let digest = ring::digest::digest(&ring::digest::SHA256, &snapshot);
        let signature = key.sign_b64(&snapshot_signing_bytes(project, 0, digest.as_ref()));
        let mut url = self.project_url(project, &["snapshot"]);
        url.query_pairs_mut().append_pair("seq", "0");
        empty(
            self.http
                .put(url)
                .bearer_auth(access)
                .header(SNAPSHOT_SIGNATURE_HEADER, signature)
                .timeout(transfer_timeout(snapshot.len() as u64))
                .body(snapshot),
        )
        .await
    }

    pub async fn snapshot_hint(
        &self,
        access: &str,
        project: SharedProjectId,
        seq: u64,
    ) -> Result<(), CollabError> {
        let mut url = self.project_url(project, &["snapshot"]);
        url.query_pairs_mut().append_pair("seq", &seq.to_string());
        empty(self.http.put(url).bearer_auth(access)).await
    }

    pub async fn download_snapshot(
        &self,
        access: &str,
        project: SharedProjectId,
        before: Option<u64>,
    ) -> Result<SnapshotDownload, CollabError> {
        let mut url = self.project_url(project, &["snapshot"]);
        if let Some(before) = before {
            url.query_pairs_mut()
                .append_pair("before", &before.to_string());
        }
        let (headers, bytes) = download(self.http.get(url).bearer_auth(access)).await?;
        let header = |name: &str| {
            headers
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned)
        };
        let seq = header(SNAPSHOT_SEQ_HEADER)
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or_else(|| CollabError::Api {
                status: 200,
                code: "invalid_response".to_string(),
                message: "the snapshot has no sequence number".to_string(),
            })?;
        let signed = match (
            header(SNAPSHOT_DEVICE_HEADER).and_then(|value| value.parse::<DeviceId>().ok()),
            header(SNAPSHOT_SIGNATURE_HEADER)
                .and_then(|value| oleafly_collab_protocol::crypto::b64url_decode(&value).ok()),
        ) {
            (Some(device_id), Some(signature)) => Some(SnapshotSignature {
                device_id,
                signature,
            }),
            _ => None,
        };
        Ok(SnapshotDownload { seq, bytes, signed })
    }

    pub async fn project_peers(
        &self,
        access: &str,
        project: SharedProjectId,
    ) -> Result<Vec<ProjectPeer>, CollabError> {
        json(
            self.http
                .get(self.project_url(project, &["peers"]))
                .bearer_auth(access),
        )
        .await
    }

    // Only the rows for these writer ids, at most PEERS_PER_REQUEST to a
    // request. A server that does not filter yet sends every row, which
    // merges the same way.
    pub async fn project_peers_among(
        &self,
        access: &str,
        project: SharedProjectId,
        peers: &[u64],
    ) -> Result<Vec<ProjectPeer>, CollabError> {
        let mut listed = Vec::new();
        for chunk in peers.chunks(PEERS_PER_REQUEST) {
            let ids: Vec<String> = chunk.iter().map(u64::to_string).collect();
            let mut url = self.project_url(project, &["peers"]);
            url.set_query(Some(&format!("ids={}", ids.join(","))));
            listed.extend(json::<Vec<ProjectPeer>>(self.http.get(url).bearer_auth(access)).await?);
        }
        Ok(listed)
    }

    pub async fn snapshot_seq(
        &self,
        access: &str,
        project: SharedProjectId,
    ) -> Result<Option<u64>, CollabError> {
        let response = self
            .http
            .head(self.project_url(project, &["snapshot"]))
            .bearer_auth(access)
            .send()
            .await
            .map_err(network_error)?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let response = check_status(response).await?;
        Ok(response
            .headers()
            .get(SNAPSHOT_SEQ_HEADER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok()))
    }

    pub async fn get_snapshot(
        &self,
        access: &str,
        project: SharedProjectId,
    ) -> Result<(u64, Vec<u8>), CollabError> {
        let (headers, body) = download(
            self.http
                .get(self.project_url(project, &["snapshot"]))
                .bearer_auth(access),
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

    pub async fn project_devices(
        &self,
        access: &str,
        project: SharedProjectId,
    ) -> Result<Vec<ProjectDevice>, CollabError> {
        json(
            self.http
                .get(self.project_url(project, &["devices"]))
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

    pub async fn admin_email_status(&self, access: &str) -> Result<EmailStatus, CollabError> {
        json(
            self.http
                .get(self.url.endpoint("api/v1/admin/email"))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn admin_email_test(&self, access: &str) -> Result<EmailTestResult, CollabError> {
        json(
            self.http
                .post(self.url.endpoint("api/v1/admin/email/test"))
                .bearer_auth(access)
                .json(&serde_json::json!({})),
        )
        .await
    }

    pub async fn email_preferences(&self, access: &str) -> Result<EmailPreferences, CollabError> {
        json(
            self.http
                .get(self.url.endpoint("api/v1/me/email-preferences"))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn set_email_preferences(
        &self,
        access: &str,
        patch: &EmailPreferencesPatch,
    ) -> Result<EmailPreferences, CollabError> {
        json(
            self.http
                .patch(self.url.endpoint("api/v1/me/email-preferences"))
                .bearer_auth(access)
                .json(patch),
        )
        .await
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
    #[cfg(feature = "e2e-hooks")]
    let builder = match url.endpoint("").host_str().and_then(|host| {
        super::e2e_route::route_for(host).map(|address| (host.to_owned(), address))
    }) {
        Some((host, address)) => builder.no_proxy().resolve(&host, address),
        None => builder,
    };
    builder.build()
}

// The wait a server asks for with Retry-After on a 429 or 503, in seconds
// or as a date. It never counts for more than ten minutes, so a wrong value
// can't keep the app away for long. It is kept by the server's address for
// whatever tries that server next.
const LONGEST_ASKED_WAIT: Duration = Duration::from_secs(600);

static ASKED_WAITS: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, std::time::Instant>>,
> = std::sync::LazyLock::new(Default::default);

pub(crate) fn asked_wait(value: &str) -> Option<Duration> {
    let value = value.trim();
    let wait = match value.parse::<u64>() {
        Ok(seconds) => Duration::from_secs(seconds),
        Err(_) => httpdate::parse_http_date(value)
            .ok()?
            .duration_since(std::time::SystemTime::now())
            .unwrap_or(Duration::ZERO),
    };
    Some(wait.min(LONGEST_ASKED_WAIT))
}

pub(crate) fn note_asked_wait(at: &Url, status: u16, retry_after: Option<&str>) {
    if !matches!(status, 429 | 503) {
        return;
    }
    let Some(wait) = retry_after.and_then(asked_wait) else {
        return;
    };
    let until = std::time::Instant::now() + wait;
    let mut waits = ASKED_WAITS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let kept = waits
        .entry(at.origin().ascii_serialization())
        .or_insert(until);
    *kept = (*kept).max(until);
}

pub(crate) fn asked_wait_for(at: &Url) -> Option<Duration> {
    let waits = ASKED_WAITS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let until = *waits.get(&at.origin().ascii_serialization())?;
    let left = until.saturating_duration_since(std::time::Instant::now());
    (!left.is_zero()).then_some(left)
}

pub(super) async fn json<T: DeserializeOwned>(request: RequestBuilder) -> Result<T, CollabError> {
    let response = check_status(request.send().await.map_err(network_error)?).await?;
    let status = response.status().as_u16();
    let body = body_within(response, JSON_ANSWER_BYTES).await?;
    serde_json::from_slice(&body).map_err(|error| CollabError::Api {
        status,
        code: "invalid_response".to_string(),
        message: error.to_string(),
    })
}

// Reads an answer up to `limit` bytes, refusing a larger one as soon as its
// length or the bytes so far show it.
pub(crate) async fn body_within(
    mut response: Response,
    limit: usize,
) -> Result<Vec<u8>, CollabError> {
    let too_large = || {
        CollabError::Network(format!(
            "the server's answer is larger than {} MiB",
            limit / (1024 * 1024)
        ))
    };
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(too_large());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if body.len() + chunk.len() > limit {
            return Err(too_large());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

// A download fails when no bytes move for a minute, not at a deadline: a
// large figure on a slow link finishes however long it takes while it
// keeps moving, and a dead connection is noticed within a minute.
async fn download(
    request: RequestBuilder,
) -> Result<(reqwest::header::HeaderMap, Vec<u8>), CollabError> {
    let sent = tokio::time::timeout(STALLED_AFTER, request.timeout(NO_DEADLINE).send())
        .await
        .map_err(|_| CollabError::Network("the server did not start the transfer".to_string()))?
        .map_err(network_error)?;
    let response = check_status(sent).await?;
    let headers = response.headers().clone();
    let body = read_steadily(response, STALLED_AFTER).await?;
    Ok((headers, body))
}

pub(crate) async fn read_steadily(
    response: Response,
    stalled_after: Duration,
) -> Result<Vec<u8>, CollabError> {
    read_steadily_with(response, stalled_after, None).await
}

pub type TransferProgress = Arc<dyn Fn(u64, u64) + Send + Sync>;

async fn read_steadily_with(
    mut response: Response,
    stalled_after: Duration,
    progress: Option<&(dyn Fn(u64, u64) + Send + Sync)>,
) -> Result<Vec<u8>, CollabError> {
    let total = response.content_length().unwrap_or(0);
    let expected = total.min(LARGEST_PREALLOCATION);
    let mut body = Vec::with_capacity(usize::try_from(expected).unwrap_or(0));
    loop {
        let chunk = tokio::time::timeout(stalled_after, response.chunk())
            .await
            .map_err(|_| CollabError::Network("the transfer stopped moving".to_string()))?
            .map_err(network_error)?;
        let Some(chunk) = chunk else {
            return Ok(body);
        };
        body.extend_from_slice(&chunk);
        if let Some(progress) = progress {
            progress(body.len() as u64, total);
        }
    }
}

const UPLOAD_PIECE: usize = 64 * 1024;

// An upload goes up in pieces. Like a download it has no deadline: it
// fails when no piece has gone up, and no answer has come, for
// `stalled_after`, so a large figure on a slow link finishes however long
// it takes while it keeps moving.
async fn upload(
    request: RequestBuilder,
    bytes: Vec<u8>,
    progress: Option<TransferProgress>,
    stalled_after: Duration,
) -> Result<Response, CollabError> {
    use std::sync::atomic::{AtomicU64, Ordering};
    let started = std::time::Instant::now();
    let since_start = move || u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let moved = Arc::new(AtomicU64::new(0));
    let total = bytes.len() as u64;
    let pieces = {
        let moved = Arc::clone(&moved);
        futures_util::stream::unfold((bytes, 0usize), move |(bytes, at)| {
            let moved = Arc::clone(&moved);
            let progress = progress.clone();
            async move {
                if at >= bytes.len() {
                    return None;
                }
                let end = (at + UPLOAD_PIECE).min(bytes.len());
                let piece = bytes[at..end].to_vec();
                moved.store(since_start(), Ordering::Relaxed);
                if let Some(progress) = &progress {
                    progress(end as u64, total);
                }
                Some((Ok::<_, std::io::Error>(piece), (bytes, end)))
            }
        })
    };
    let sending = request
        .timeout(NO_DEADLINE)
        .header(reqwest::header::CONTENT_LENGTH, total)
        .body(reqwest::Body::wrap_stream(pieces))
        .send();
    let stalled = async {
        let every = stalled_after.min(Duration::from_secs(1));
        loop {
            tokio::time::sleep(every).await;
            let idle = since_start().saturating_sub(moved.load(Ordering::Relaxed));
            if Duration::from_millis(idle) >= stalled_after {
                return;
            }
        }
    };
    tokio::select! {
        sent = sending => check_status(sent.map_err(network_error)?).await,
        () = stalled => Err(CollabError::Network("the upload stopped moving".to_string())),
    }
}

// An error answer is read for its code and message only: a small part, in
// at most the time of an ordinary request, even when the request itself has
// no deadline.
async fn error_answer(mut response: Response) -> Vec<u8> {
    let mut body = Vec::new();
    let reading = async {
        while let Ok(Some(chunk)) = response.chunk().await {
            let room = ERROR_ANSWER_BYTES.saturating_sub(body.len());
            body.extend_from_slice(&chunk[..chunk.len().min(room)]);
            if body.len() >= ERROR_ANSWER_BYTES {
                break;
            }
        }
    };
    let _ = tokio::time::timeout(REQUEST_TIMEOUT, reading).await;
    body
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
    let numeric = status.as_u16();
    note_asked_wait(
        response.url(),
        numeric,
        response
            .headers()
            .get(RETRY_AFTER)
            .and_then(|value| value.to_str().ok()),
    );
    let body = error_answer(response).await;
    if status == StatusCode::UNAUTHORIZED {
        return Err(match serde_json::from_slice::<ApiError>(&body) {
            Ok(error) => unauthorized(error),
            Err(_) => CollabError::Network(
                "a 401 came back without the server's own error, so something in front of the \
                 server turned the request away"
                    .to_owned(),
            ),
        });
    }
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

// The 401 codes that mean the session is gone and the person has to sign in
// again. Any other 401 the server explains, such as a sign-in check that
// expired while the laptop slept, keeps its code so the caller can try
// again.
pub(crate) const SESSION_GONE: [&str; 4] = [
    "unauthorized",
    "revoked",
    "refresh_reused",
    "invalid_signature",
];

pub(crate) fn unauthorized(error: ApiError) -> CollabError {
    if let Some(reason) = SessionEndReason::from_code(&error.code) {
        return CollabError::SessionEnded(reason);
    }
    if SESSION_GONE.contains(&error.code.as_str()) {
        return CollabError::Unauthorized;
    }
    CollabError::Api {
        status: 401,
        code: error.code,
        message: error.message,
    }
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

    #[test]
    fn a_retry_after_is_read_as_seconds_or_a_date_and_kept_to_ten_minutes() {
        assert_eq!(asked_wait("120"), Some(Duration::from_secs(120)));
        assert_eq!(asked_wait(" 5 "), Some(Duration::from_secs(5)));
        assert_eq!(asked_wait("86400"), Some(Duration::from_secs(600)));
        let soon = httpdate::fmt_http_date(std::time::SystemTime::now() + Duration::from_secs(90));
        let read = asked_wait(&soon).expect("a date");
        assert!(read > Duration::from_secs(80) && read <= Duration::from_secs(90));
        assert_eq!(
            asked_wait("Wed, 21 Oct 2015 07:28:00 GMT"),
            Some(Duration::ZERO)
        );
        assert_eq!(asked_wait("soon"), None);
    }

    #[tokio::test]
    async fn a_busy_answer_with_retry_after_is_kept_for_that_server_and_others_are_not() {
        let busy = canned(http_response(
            "503 Service Unavailable",
            &[("Retry-After", "5"), ("Content-Type", "application/json")],
            r#"{"code":"server_busy","message":"Busy."}"#,
        ))
        .await;
        let client = ServerClient::new(busy).expect("client");
        assert!(client.capabilities().await.is_err());
        let left = client.asked_wait().expect("the wait was kept");
        assert!(left > Duration::from_secs(4) && left <= Duration::from_secs(5));
        let failing = canned(http_response(
            "500 Internal Server Error",
            &[("Retry-After", "5")],
            "",
        ))
        .await;
        let other = ServerClient::new(failing).expect("client");
        assert!(other.capabilities().await.is_err());
        assert_eq!(other.asked_wait(), None);
    }

    #[tokio::test]
    async fn a_figure_sent_in_pieces_is_stored_by_the_server_and_comes_back_whole() {
        let (_server, client, admin, _member) = admin_and_member().await;
        let access = &admin.access_token;
        let project = client
            .create_project(access, "Figures")
            .await
            .expect("project")
            .project_id;
        let figure: Vec<u8> = (0..300 * 1024).map(|at| (at % 253) as u8).collect();
        let digest = ring::digest::digest(&ring::digest::SHA256, &figure);
        let hash: String = digest
            .as_ref()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        client
            .put_blob(access, project, &hash, figure.clone())
            .await
            .expect("stored");
        assert_eq!(
            client
                .get_blob(access, project, &hash)
                .await
                .expect("fetched"),
            figure
        );
    }

    #[tokio::test]
    async fn an_upload_that_stops_moving_fails_instead_of_waiting_forever() {
        use tokio::io::AsyncReadExt;
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind");
        let port = listener.local_addr().expect("address").port();
        tokio::spawn(async move {
            let mut held = Vec::new();
            while let Ok((mut stream, _)) = listener.accept().await {
                let mut buffer = [0u8; 4096];
                let _ = stream.read(&mut buffer).await;
                held.push(stream);
            }
        });
        let url = crate::ServerUrl::parse(&format!("http://127.0.0.1:{port}")).expect("url");
        let client = ServerClient::new(url).expect("client");
        let request = client.http().put(client.url().endpoint("blobs/stuck"));
        let started = std::time::Instant::now();
        let sent = upload(
            request,
            vec![7u8; 48 * 1024 * 1024],
            None,
            Duration::from_millis(300),
        )
        .await;
        assert!(
            matches!(sent, Err(CollabError::Network(ref message)) if message.contains("stopped moving")),
            "{sent:?}"
        );
        assert!(started.elapsed() < Duration::from_secs(20));
    }

    #[tokio::test]
    async fn figure_transfers_say_how_far_they_got() {
        use crate::client::test_util::routed;
        let project = SharedProjectId::new_v7();
        let figure: Vec<u8> = (0..150 * 1024).map(|at| (at % 251) as u8).collect();
        let path = format!("/api/v1/projects/{project}/blobs/h1");
        let answer = http_response(
            "200 OK",
            &[("Content-Type", "application/octet-stream")],
            &String::from_utf8_lossy(&figure),
        );
        let stored = http_response("204 No Content", &[], "");
        let leaked: &'static str = Box::leak(path.into_boxed_str());
        let (url, heard) = routed(move |_| vec![(leaked, vec![stored, answer])]).await;
        let client = ServerClient::new(url).expect("client");
        let seen: Arc<std::sync::Mutex<Vec<(u64, u64)>>> = Arc::default();
        let hearing = Arc::clone(&seen);
        let progress: TransferProgress = Arc::new(move |done, total| {
            hearing.lock().expect("seen").push((done, total));
        });
        let upload_bytes = vec![3u8; 200 * 1024];
        client
            .put_blob_with(
                "access",
                project,
                "h1",
                upload_bytes,
                Some(Arc::clone(&progress)),
            )
            .await
            .expect("stored");
        let uploaded = std::mem::take(&mut *seen.lock().expect("seen"));
        assert!(uploaded.len() > 1, "{uploaded:?}");
        assert!(uploaded.windows(2).all(|pair| pair[0].0 < pair[1].0));
        assert_eq!(uploaded.last(), Some(&(200 * 1024, 200 * 1024)));
        assert!(
            heard.lock().expect("heard")[0].contains(&format!("content-length: {}", 200 * 1024))
                || heard.lock().expect("heard")[0]
                    .contains(&format!("Content-Length: {}", 200 * 1024))
        );
        let downloaded = client
            .get_blob_with("access", project, "h1", Some(progress))
            .await
            .expect("fetched");
        let total = downloaded.len() as u64;
        assert_eq!(seen.lock().expect("seen").last(), Some(&(total, total)));
    }

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
            email_link_sign_in: None,
        }
    }

    fn first_snapshot() -> Vec<u8> {
        crate::doc::ProjectDoc::create()
            .and_then(|doc| doc.snapshot())
            .expect("a snapshot")
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn asks_which_snapshot_the_server_holds_without_downloading_it() {
        let (_server, client, _admin, member) = admin_and_member().await;
        let token = &member.access_token;
        let project = client
            .create_project(token, "Thesis")
            .await
            .expect("project")
            .project_id;
        assert_eq!(
            client
                .snapshot_seq(token, project)
                .await
                .expect("no snapshot yet"),
            None
        );
        client
            .put_snapshot(token, project, 0, first_snapshot())
            .await
            .expect("upload");
        assert_eq!(
            client.snapshot_seq(token, project).await.expect("held"),
            Some(0)
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn previews_a_project_link_without_joining_it() {
        let (_server, client, admin, member) = admin_and_member().await;
        let owner = &admin.access_token;
        let project = client
            .create_project(owner, "Thesis")
            .await
            .expect("project")
            .project_id;
        client
            .put_snapshot(owner, project, 0, first_snapshot())
            .await
            .expect("upload");
        client.commit_project(owner, project).await.expect("commit");
        let link = ProjectPatch {
            link_sharing: Some(true),
            link_role: Some(ProjectRole::Editor),
            ..ProjectPatch::default()
        };
        client
            .patch_project(owner, project, &link)
            .await
            .expect("link on");
        let shown = client
            .join_preview(&member.access_token, project)
            .await
            .expect("preview");
        assert_eq!(shown.title, "Thesis");
        assert_eq!(shown.role, ProjectRole::Editor);
        assert!(matches!(
            client.project(&member.access_token, project).await,
            Err(CollabError::Api { status: 404, .. })
        ));
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

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn email_status_test_email_and_preferences_reach_the_server() {
        let smtp = oleafly_server::test_support::MockSmtp::start().await;
        let server = TestServer::start(oleafly_server::test_support::mail_config(&smtp)).await;
        let admin = seed(&server, ServerRole::Admin).await;
        let member = seed(&server, ServerRole::Member).await;
        let account = admin.account_id;
        server
            .state()
            .db
            .call(move |conn| {
                oleafly_server::members::add_verified_emails(
                    conn,
                    account,
                    &["admin@uni.edu".to_string()],
                )
            })
            .await
            .expect("admin email");
        let client = ServerClient::new(server_url(&server)).expect("client");
        let status = client
            .admin_email_status(&admin.access_token)
            .await
            .expect("status");
        assert!(status.configured);
        assert!(status.notifications);
        let result = client
            .admin_email_test(&admin.access_token)
            .await
            .expect("test email");
        assert!(result.delivered);
        assert_eq!(result.sent_to, ["admin@uni.edu"]);
        assert_eq!(smtp.messages().len(), 1);
        assert!(matches!(
            client.admin_email_test(&member.access_token).await,
            Err(CollabError::Api { status: 403, .. })
        ));
        let preferences = client
            .email_preferences(&member.access_token)
            .await
            .expect("preferences");
        assert!(preferences.shared_with_you && preferences.mail_configured);
        let changed = client
            .set_email_preferences(
                &member.access_token,
                &EmailPreferencesPatch {
                    shared_with_you: Some(false),
                    ..EmailPreferencesPatch::default()
                },
            )
            .await
            .expect("change");
        assert!(!changed.shared_with_you);
    }

    #[test]
    fn a_large_transfer_gets_the_time_a_slow_link_needs() {
        assert_eq!(transfer_timeout(1024), TRANSFER_TIMEOUT);
        assert_eq!(
            transfer_timeout(50 * 1024 * 1024),
            Duration::from_secs(1600)
        );
    }

    async fn trickling(pauses: Vec<Duration>, chunk: usize) -> ServerUrl {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind");
        let port = listener.local_addr().expect("address").port();
        tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut head = [0u8; 4096];
                let _ = stream.read(&mut head).await;
                let total = pauses.len() * chunk;
                let answer = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {total}\r\nConnection: close\r\n\r\n"
                );
                if stream.write_all(answer.as_bytes()).await.is_err() {
                    return;
                }
                for pause in pauses {
                    tokio::time::sleep(pause).await;
                    if stream.write_all(&vec![b'x'; chunk]).await.is_err() {
                        return;
                    }
                }
            }
        });
        ServerUrl::parse(&format!("http://127.0.0.1:{port}")).expect("address")
    }

    // Answers with `head`, then keeps sending filler and never finishes.
    async fn endless(head: &'static str) -> ServerUrl {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind");
        let port = listener.local_addr().expect("address").port();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let mut request = [0u8; 4096];
                    let _ = stream.read(&mut request).await;
                    if stream.write_all(head.as_bytes()).await.is_err() {
                        return;
                    }
                    let filler = vec![b'x'; 16 * 1024];
                    while stream.write_all(&filler).await.is_ok() {
                        tokio::time::sleep(Duration::from_millis(10)).await;
                    }
                });
            }
        });
        ServerUrl::parse(&format!("http://127.0.0.1:{port}")).expect("address")
    }

    #[tokio::test]
    async fn an_error_answer_that_never_ends_is_read_only_in_part() {
        let url =
            endless("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 100000000\r\n\r\n")
                .await;
        let client = reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("client");
        let response = client
            .get(url.endpoint("blob"))
            .timeout(NO_DEADLINE)
            .send()
            .await
            .expect("response");
        let checked = tokio::time::timeout(Duration::from_secs(10), check_status(response))
            .await
            .expect("the error answer was read in part");
        assert!(
            matches!(checked, Err(CollabError::Api { status: 500, ref code, .. }) if code == "http_500"),
            "{checked:?}"
        );
    }

    #[tokio::test]
    async fn a_json_answer_larger_than_the_limit_is_refused_before_it_is_read() {
        let url = endless(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 40000000\r\n\r\n",
        )
        .await;
        let client = ServerClient::new(url).expect("client");
        let answered = tokio::time::timeout(Duration::from_secs(10), client.capabilities())
            .await
            .expect("refused at once");
        assert!(
            matches!(answered, Err(CollabError::Network(ref message)) if message.contains("larger than 32 MiB")),
            "{answered:?}"
        );
    }

    #[tokio::test]
    async fn a_download_that_keeps_moving_finishes_and_one_that_stops_fails_soon() {
        let client = reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("client");
        let moving = trickling(vec![Duration::from_millis(60); 10], 1000).await;
        let response = client
            .get(moving.endpoint("blob"))
            .send()
            .await
            .expect("response");
        let body = read_steadily(response, Duration::from_millis(400))
            .await
            .expect("a download that keeps moving finishes");
        assert_eq!(body.len(), 10_000);
        let stopping = trickling(
            vec![Duration::ZERO, Duration::ZERO, Duration::from_secs(5)],
            1000,
        )
        .await;
        let response = client
            .get(stopping.endpoint("blob"))
            .send()
            .await
            .expect("response");
        let started = tokio::time::Instant::now();
        let read = read_steadily(response, Duration::from_millis(400)).await;
        assert!(
            matches!(read, Err(CollabError::Network(ref message)) if message.contains("stopped moving")),
            "{read:?}"
        );
        assert!(started.elapsed() < Duration::from_secs(3));
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

    #[tokio::test]
    async fn a_401_that_says_why_the_session_ended_keeps_the_reason() {
        for (code, expected) in [
            (
                "account_suspended",
                CollabError::SessionEnded(SessionEndReason::AccountSuspended),
            ),
            (
                "access_ended",
                CollabError::SessionEnded(SessionEndReason::AccessEnded),
            ),
            ("revoked", CollabError::Unauthorized),
            ("refresh_reused", CollabError::Unauthorized),
            ("unauthorized", CollabError::Unauthorized),
            (
                "expired_nonce",
                CollabError::Api {
                    status: 401,
                    code: "expired_nonce".to_owned(),
                    message: "m".to_owned(),
                },
            ),
        ] {
            let response = http_response(
                "401 Unauthorized",
                &[("Content-Type", "application/json")],
                &format!("{{\"code\":\"{code}\",\"message\":\"m\"}}"),
            );
            let client = ServerClient::new(canned(response).await).expect("client");
            assert_eq!(client.me("token").await.err(), Some(expected), "{code}");
        }
        let bare = http_response("401 Unauthorized", &[], "");
        let client = ServerClient::new(canned(bare).await).expect("client");
        assert!(matches!(
            client.me("token").await.err(),
            Some(CollabError::Network(_))
        ));
    }
}
