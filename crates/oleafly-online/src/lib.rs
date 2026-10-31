pub mod archive;
pub mod browser_cookies;
pub mod client;
pub mod error;
pub mod git;
pub mod html;
pub mod projects;
pub mod service;
pub mod session;
pub mod socket;
pub mod sync;
#[cfg(any(test, feature = "test-support"))]
pub mod test_support;

pub use error::{OnlineError, OnlineErrorKind};

#[cfg(test)]
mod tests;
