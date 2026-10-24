//! An online LaTeX service, shared by the Oleafly app and the `oleafly`
//! CLI: signing in (a pasted cookie or one read from a desktop browser),
//! listing and downloading projects, and two-way sync through the service's
//! Git bridge with a private mirror.
//!
//! Sessions and Git tokens live in the shared encrypted secret store, so
//! the app and the CLI see each other's sign-ins. The stored names and the
//! app's error codes come from Oleafly 0.4.7 and never change (see
//! [`service`]).
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
