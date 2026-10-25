//! Errors from the online LaTeX service, its Git bridge and local sync.
//! The app turns them into its own localized errors; the CLI maps kinds to
//! exit codes.
use std::collections::BTreeMap;

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum OnlineErrorKind {
    InvalidServer,
    SignedOut,
    SessionExpired,
    SignInFailed,
    SignInCancelled,
    RateLimited,
    Unreachable,
    Unrecognized,
    ProjectUnavailable,
    TooLarge,
    NotAnArchive,
    TemplateUnavailable,
    TemplateLinkInvalid,
    GitTokenInvalid,
    GitTokenMissing,
    GitTokenRejected,
    GitUnavailable,
    GitNotInstalled,
    SyncBusy,
    SyncNotLinked,
    SyncAlreadyLinked,
    SyncNeedsRelink,
    SyncOffline,
    SyncFailed,
    SyncKeptChanging,
    SyncCaseClash,
    SyncInvalidNames,
    SyncFileTooLarge,
    SyncTooLarge,
    SyncPathBlocked,
    FolderExists,
    WorktreeBusy,
    Io,
}

impl OnlineErrorKind {
    /// The snake_case name, which is also the app's error code suffix.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidServer => "invalid_server",
            Self::SignedOut => "signed_out",
            Self::SessionExpired => "session_expired",
            Self::SignInFailed => "sign_in_failed",
            Self::SignInCancelled => "sign_in_cancelled",
            Self::RateLimited => "rate_limited",
            Self::Unreachable => "unreachable",
            Self::Unrecognized => "unrecognized",
            Self::ProjectUnavailable => "project_unavailable",
            Self::TooLarge => "too_large",
            Self::NotAnArchive => "not_an_archive",
            Self::TemplateUnavailable => "template_unavailable",
            Self::TemplateLinkInvalid => "template_link_invalid",
            Self::GitTokenInvalid => "git_token_invalid",
            Self::GitTokenMissing => "git_token_missing",
            Self::GitTokenRejected => "git_token_rejected",
            Self::GitUnavailable => "git_unavailable",
            Self::GitNotInstalled => "git_not_installed",
            Self::SyncBusy => "sync_busy",
            Self::SyncNotLinked => "sync_not_linked",
            Self::SyncAlreadyLinked => "sync_already_linked",
            Self::SyncNeedsRelink => "sync_needs_relink",
            Self::SyncOffline => "sync_offline",
            Self::SyncFailed => "sync_failed",
            Self::SyncKeptChanging => "sync_kept_changing",
            Self::SyncCaseClash => "sync_case_clash",
            Self::SyncInvalidNames => "sync_invalid_names",
            Self::SyncFileTooLarge => "sync_file_too_large",
            Self::SyncTooLarge => "sync_too_large",
            Self::SyncPathBlocked => "sync_path_blocked",
            Self::FolderExists => "folder_exists",
            Self::WorktreeBusy => "worktree_busy",
            Self::Io => "io",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OnlineError {
    pub kind: OnlineErrorKind,
    pub params: BTreeMap<String, String>,
    pub detail: Option<String>,
}

impl OnlineError {
    pub fn new(kind: OnlineErrorKind) -> Self {
        Self {
            kind,
            params: BTreeMap::new(),
            detail: None,
        }
    }

    pub fn param(mut self, name: &str, value: impl ToString) -> Self {
        self.params.insert(name.to_string(), value.to_string());
        self
    }

    pub fn detail(mut self, detail: impl ToString) -> Self {
        self.detail = Some(detail.to_string());
        self
    }

    /// A local failure (a file, a process) whose message is shown as is.
    pub fn io(message: impl Into<String>) -> Self {
        Self::new(OnlineErrorKind::Io).detail(message.into())
    }
}

impl std::fmt::Display for OnlineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match (&self.kind, &self.detail) {
            (OnlineErrorKind::Io, Some(detail)) => write!(f, "{detail}"),
            (kind, Some(detail)) => write!(f, "{}: {detail}", kind.as_str()),
            (kind, None) => write!(f, "{}", kind.as_str()),
        }
    }
}

impl std::error::Error for OnlineError {}

/// The app's error text: `@oleafly/error:{"code":"<service>.<kind>",…}`,
/// the same shape the app's own errors serialize to, so the webview
/// translates it. Local failures keep their plain message.
impl From<OnlineError> for String {
    fn from(error: OnlineError) -> Self {
        #[derive(Serialize)]
        struct Envelope<'a> {
            code: String,
            params: &'a BTreeMap<String, String>,
            detail: &'a Option<String>,
        }
        if error.kind == OnlineErrorKind::Io {
            return error.detail.unwrap_or_default();
        }
        let envelope = Envelope {
            code: format!("{}.{}", crate::service::ERROR_PREFIX, error.kind.as_str()),
            params: &error.params,
            detail: &error.detail,
        };
        match serde_json::to_string(&envelope) {
            Ok(json) => format!("@oleafly/error:{json}"),
            Err(_) => error.kind.as_str().to_string(),
        }
    }
}

impl From<std::io::Error> for OnlineError {
    fn from(error: std::io::Error) -> Self {
        Self::io(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_app_error_text_keeps_its_code_params_and_detail() {
        let text = String::from(
            OnlineError::new(OnlineErrorKind::Unreachable)
                .param("server", "https://latex.example.edu")
                .detail("timed out"),
        );
        let json: serde_json::Value =
            serde_json::from_str(text.strip_prefix("@oleafly/error:").unwrap()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"code": "overleaf.unreachable", "params": {"server": "https://latex.example.edu"}, "detail": "timed out"})
        );
        assert_eq!(String::from(OnlineError::io("disk full")), "disk full");
    }
}
