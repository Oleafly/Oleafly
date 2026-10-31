pub mod accounts;
pub mod address;
pub mod api;
pub mod detect;
pub mod error;
pub mod git;
pub mod http;
pub mod kind;
pub mod oauth;
pub mod repo_path;
pub mod store;
#[cfg(any(test, feature = "test-support"))]
pub mod test_support;

pub use error::ForgeError;
pub use kind::{AuthMethod, ForgeKind, ServerFlavor};
pub use oleafly_secrets::accounts::ForgeToken;
pub use store::{ForgeAccount, ForgeStore};

pub(crate) async fn blocking<T, F>(work: F) -> Result<T, ForgeError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, ForgeError> + Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| ForgeError::Store {
            detail: format!("the account store worker stopped: {error}"),
        })?
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}
