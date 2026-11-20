pub mod archive;
pub mod browser_cookies;
pub mod browser_signin;
pub mod client;
pub mod error;
pub mod git;
pub mod html;
pub mod live;
pub mod projects;
pub mod realtime;
pub mod service;
pub mod session;
pub mod sync;
#[cfg(any(test, feature = "test-support"))]
pub mod test_support;

pub use error::{OnlineError, OnlineErrorKind};

pub(crate) fn locked<T>(mutex: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests;
