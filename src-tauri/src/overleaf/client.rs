//! The online service's HTTP client (in `oleafly-online`), with the app's
//! user agent and errors in the app's format.
use std::path::Path;

use serde_json::Value;

#[cfg(test)]
pub(crate) use oleafly_online::client::project_id_in;
pub(crate) use oleafly_online::client::Dashboard;

use super::errors::app_error;

pub(crate) const USER_AGENT: &str = concat!("Oleafly/", env!("CARGO_PKG_VERSION"));

#[derive(Clone)]
pub(crate) struct Http {
    inner: oleafly_online::client::Http,
    pub base: String,
}

impl Http {
    pub(crate) fn new(base: &str) -> Result<Self, String> {
        let inner = oleafly_online::client::Http::new(base, USER_AGENT).map_err(app_error)?;
        Ok(Self {
            base: inner.base.clone(),
            inner,
        })
    }

    /// The crate's client, for the crate's own operations.
    pub(crate) fn online(&self) -> &oleafly_online::client::Http {
        &self.inner
    }

    pub(crate) fn url(&self, path: &str) -> String {
        self.inner.url(path)
    }

    /// A request for a public page, sent without the account's cookie.
    pub(crate) fn public_get(&self, path: &str) -> reqwest::RequestBuilder {
        self.inner.public_get(path)
    }

    pub(crate) async fn send_public(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<reqwest::Response, String> {
        self.inner.send_public(request).await.map_err(app_error)
    }

    pub(crate) async fn dashboard(&self, cookie: &str) -> Result<Dashboard, String> {
        self.inner.dashboard(cookie).await.map_err(app_error)
    }

    pub(crate) async fn create_from_template(
        &self,
        cookie: &str,
        csrf: &str,
        body: &Value,
    ) -> Result<String, String> {
        self.inner
            .create_from_template(cookie, csrf, body)
            .await
            .map_err(app_error)
    }

    pub(crate) async fn download_zip(
        &self,
        cookie: &str,
        project_id: &str,
        destination: &Path,
        progress: impl FnMut(u64, Option<u64>),
    ) -> Result<u64, String> {
        self.inner
            .download_zip(cookie, project_id, destination, progress)
            .await
            .map_err(app_error)
    }
}

pub(crate) fn is_expired(error: &str) -> bool {
    error.contains("\"overleaf.session_expired\"")
}
