//! Owner-only file hardening, now shared with the CLI through the
//! `oleafly-secrets` crate.
pub use oleafly_secrets::fsperm::harden_file;
#[cfg(windows)]
pub use oleafly_secrets::fsperm::harden_file_checked;
