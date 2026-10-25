//! Stored-data and wire values Oleafly 0.4.7 already wrote. They name the
//! service and must never change: saved sessions, Git tokens, project
//! records and the app's error codes depend on them.

/// The default server.
pub const DEFAULT_SERVER: &str = "https://www.overleaf.com";
/// Secret-store account holding `{base: Session}`.
pub const SESSIONS_ACCOUNT: &str = "overleaf_sessions";
/// Secret-store account holding `{base: git token}`.
pub const GIT_TOKENS_ACCOUNT: &str = "overleaf_git_tokens";
/// `project.json` `importedFrom.service`.
pub const SERVICE_ID: &str = "overleaf";
/// `<data>/overleaf-sync/<project id>`: the app's private mirrors.
pub const APP_SYNC_DIR: &str = "overleaf-sync";
/// The app's error code prefix (`errors.json` `overleaf.*`).
pub(crate) const ERROR_PREFIX: &str = "overleaf";
/// `normalize_server` maps the bare host to the `www.` host.
pub(crate) const BARE_HOST: &str = "overleaf.com";
pub(crate) const WWW_HOST: &str = "www.overleaf.com";
pub(crate) const DEFAULT_GIT_ORIGIN: &str = "https://git.overleaf.com";
pub(crate) const REMOTE_PREFIX: &str = "refs/remotes/overleaf/";
pub(crate) const REMOTE_BRANCHES: &str = "+refs/heads/*:refs/remotes/overleaf/*";
pub(crate) const MERGE_MESSAGE: &str = "Merge changes from Overleaf";
