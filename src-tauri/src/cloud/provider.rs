//! The cloud providers sync can use. Each one is a `CloudStore` for the
//! engine, a way to sign in, and a description the settings tab draws from.
//! The engine, the scheduler, conflicts, holds and settings sync never ask
//! which provider they talk to, so adding one (Oleafly's own server, say) is a
//! variant here, its store, and its sign-in.

use super::drive::DriveStore;
use super::oauth::OAuthConfig;
use super::s3::{S3Config, S3Store};
use super::store::{
    AccountInfo, BatchCopy, BatchDelete, BatchFile, Changes, CloudStore, Copied, DropboxStore,
    Fetched, RemoteEntry, RemoteMeta, Space, StoreResult, Uploaded, Waited, WriteMode,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ProviderKind {
    #[default]
    Dropbox,
    GoogleDrive,
    S3,
}

/// What a connection needs besides its secret, kept in `connection.json`.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum ProviderConfig {
    S3(S3Config),
}

/// How a person connects a provider.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AuthKind {
    /// Sign in through the browser.
    #[serde(rename = "oauth")]
    OAuth,
    /// Type in keys the person made at the provider.
    Credentials,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderInfo {
    kind: ProviderKind,
    auth: AuthKind,
    /// False when this build can't connect it, such as a build made without
    /// the provider's client id.
    available: bool,
    /// Whether sign-in can fall back to pasting a code.
    paste_code: bool,
    /// Whether the provider reports used and total space.
    quota: bool,
}

impl ProviderKind {
    pub(crate) const ALL: [ProviderKind; 3] = [
        ProviderKind::Dropbox,
        ProviderKind::GoogleDrive,
        ProviderKind::S3,
    ];

    pub(crate) fn info(self) -> ProviderInfo {
        match self {
            Self::Dropbox => ProviderInfo {
                kind: self,
                auth: AuthKind::OAuth,
                available: true,
                paste_code: true,
                quota: true,
            },
            Self::GoogleDrive => ProviderInfo {
                kind: self,
                auth: AuthKind::OAuth,
                available: super::oauth::google_config().is_some(),
                paste_code: false,
                quota: true,
            },
            Self::S3 => ProviderInfo {
                kind: self,
                auth: AuthKind::Credentials,
                available: true,
                paste_code: false,
                quota: false,
            },
        }
    }

    /// The browser sign-in, for providers that use one.
    pub(crate) fn oauth(self) -> Option<OAuthConfig> {
        match self {
            Self::Dropbox => Some(super::oauth::dropbox_config()),
            Self::GoogleDrive => super::oauth::google_config(),
            Self::S3 => None,
        }
    }

    /// Where the provider's long-lived secret is kept. Dropbox keeps the name
    /// it always had, so a computer already connected stays connected.
    pub(crate) fn secret_account(self) -> &'static str {
        match self {
            Self::Dropbox => "cloud/dropbox/refresh",
            Self::GoogleDrive => "cloud/google_drive/refresh",
            Self::S3 => "cloud/s3/keys",
        }
    }

    /// The account id sync state and project bindings are keyed by. Dropbox
    /// ids are kept as they were; other providers' ids carry the provider so
    /// they can never collide with one.
    pub(crate) fn account_key(self, provider_id: &str) -> String {
        match self {
            Self::Dropbox => provider_id.to_string(),
            Self::GoogleDrive => format!("gdrive:{provider_id}"),
            // Already "s3:<server>/<bucket>/<folder>".
            Self::S3 => provider_id.to_string(),
        }
    }
}

pub(crate) fn providers() -> Vec<ProviderInfo> {
    ProviderKind::ALL
        .into_iter()
        .map(ProviderKind::info)
        .collect()
}

/// The connected provider's store. The engine is generic over `CloudStore`;
/// commands hold one of these so they never name a provider.
pub(crate) enum AnyStore {
    Dropbox(DropboxStore),
    Drive(DriveStore),
    S3(S3Store),
}

macro_rules! dispatch {
    ($self:ident, $store:ident => $call:expr) => {
        match $self {
            AnyStore::Dropbox($store) => $call,
            AnyStore::Drive($store) => $call,
            AnyStore::S3($store) => $call,
        }
    };
}

impl CloudStore for AnyStore {
    async fn get(&self, remote: &str, cap: usize) -> StoreResult<Option<(Vec<u8>, String)>> {
        dispatch!(self, store => store.get(remote, cap).await)
    }

    async fn metadata(&self, remote: &str) -> StoreResult<Option<RemoteMeta>> {
        dispatch!(self, store => store.metadata(remote).await)
    }

    async fn fetch_to(
        &self,
        remote: &str,
        rev: Option<&str>,
        local: &Path,
        limit: u64,
    ) -> StoreResult<Option<Fetched>> {
        dispatch!(self, store => store.fetch_to(remote, rev, local, limit).await)
    }

    async fn put(&self, remote: &str, bytes: Vec<u8>, mode: WriteMode) -> StoreResult<String> {
        dispatch!(self, store => store.put(remote, bytes, mode).await)
    }

    async fn put_path(&self, remote: &str, local: &Path) -> StoreResult<Uploaded> {
        dispatch!(self, store => store.put_path(remote, local).await)
    }

    async fn put_paths(
        &self,
        files: &[BatchFile],
        tick: &(dyn Fn() + Sync),
    ) -> Vec<StoreResult<Uploaded>> {
        dispatch!(self, store => store.put_paths(files, tick).await)
    }

    async fn fetch_zip(
        &self,
        remote_dir: &str,
        local: &Path,
        limit: u64,
        received: &(dyn Fn(u64) + Sync),
    ) -> StoreResult<bool> {
        dispatch!(self, store => store.fetch_zip(remote_dir, local, limit, received).await)
    }

    async fn delete(&self, remote: &str, parent_rev: Option<&str>) -> StoreResult<()> {
        dispatch!(self, store => store.delete(remote, parent_rev).await)
    }

    async fn delete_paths(&self, items: &[BatchDelete]) -> Vec<StoreResult<()>> {
        dispatch!(self, store => store.delete_paths(items).await)
    }

    async fn copy_paths(&self, items: &[BatchCopy]) -> Vec<StoreResult<Copied>> {
        dispatch!(self, store => store.copy_paths(items).await)
    }

    async fn list(&self, remote_dir: &str) -> StoreResult<Vec<RemoteEntry>> {
        dispatch!(self, store => store.list(remote_dir).await)
    }

    async fn latest_cursor(&self, remote_dir: &str) -> StoreResult<Option<String>> {
        dispatch!(self, store => store.latest_cursor(remote_dir).await)
    }

    async fn changes(&self, cursor: &str) -> StoreResult<Changes> {
        dispatch!(self, store => store.changes(cursor).await)
    }

    async fn account(&self) -> StoreResult<AccountInfo> {
        dispatch!(self, store => store.account().await)
    }

    async fn space(&self) -> StoreResult<Option<Space>> {
        dispatch!(self, store => store.space().await)
    }

    async fn wait_for_changes(
        &self,
        cursor: &str,
        timeout_secs: u64,
    ) -> StoreResult<Option<Waited>> {
        dispatch!(self, store => store.wait_for_changes(cursor, timeout_secs).await)
    }

    fn valid_rev(&self, rev: &str) -> bool {
        dispatch!(self, store => store.valid_rev(rev))
    }

    async fn copy_check_hash(&self, local: &Path) -> Option<String> {
        dispatch!(self, store => store.copy_check_hash(local).await)
    }
}

#[cfg(test)]
mod tests {
    use super::{providers, ProviderKind};

    #[test]
    fn a_connection_saved_before_providers_existed_is_dropbox() {
        #[derive(serde::Deserialize)]
        struct Saved {
            #[serde(default)]
            provider: ProviderKind,
        }
        let saved: Saved = serde_json::from_str("{}").unwrap();
        assert_eq!(saved.provider, ProviderKind::Dropbox);
        assert_eq!(
            serde_json::to_value(ProviderKind::Dropbox).unwrap(),
            "dropbox"
        );
    }

    #[test]
    fn every_provider_describes_itself_and_dropbox_keeps_its_secret_and_ids() {
        let listed = serde_json::to_value(providers()).unwrap();
        assert_eq!(listed[0]["kind"], "dropbox");
        assert_eq!(listed[0]["auth"], "oauth");
        assert_eq!(
            ProviderKind::Dropbox.secret_account(),
            "cloud/dropbox/refresh"
        );
        assert_eq!(ProviderKind::Dropbox.account_key("dbid:AAH4"), "dbid:AAH4");
        assert_eq!(listed[1]["kind"], "google_drive");
        assert_eq!(listed[1]["auth"], "oauth");
        assert_eq!(listed[1]["pasteCode"], false);
        assert_eq!(listed[2]["kind"], "s3");
        assert_eq!(listed[2]["auth"], "credentials");
        assert_eq!(listed[2]["quota"], false);
        assert_eq!(ProviderKind::GoogleDrive.account_key("123"), "gdrive:123");
        assert_ne!(
            ProviderKind::S3.secret_account(),
            ProviderKind::Dropbox.secret_account()
        );
    }
}
