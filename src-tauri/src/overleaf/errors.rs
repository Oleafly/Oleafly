//! Errors from `oleafly-online` in the app's format, with the codes
//! `errors.json` has had since 0.4.7.
use oleafly_online::{OnlineError, OnlineErrorKind};

use crate::app_error::AppError;

/// The app's code for `kind`. The kinds only the CLI meets (a folder that
/// already exists, a busy worktree lock) read as a failed sync.
pub(crate) fn legacy_code(kind: OnlineErrorKind) -> &'static str {
    use OnlineErrorKind as Kind;
    match kind {
        Kind::InvalidServer => "overleaf.invalid_server",
        Kind::SignedOut => "overleaf.signed_out",
        Kind::SessionExpired => "overleaf.session_expired",
        Kind::SignInFailed => "overleaf.sign_in_failed",
        Kind::SignInCancelled => "overleaf.sign_in_cancelled",
        Kind::RateLimited => "overleaf.rate_limited",
        Kind::Unreachable => "overleaf.unreachable",
        Kind::Unrecognized => "overleaf.unrecognized",
        Kind::ProjectUnavailable => "overleaf.project_unavailable",
        Kind::TooLarge => "overleaf.too_large",
        Kind::NotAnArchive => "overleaf.not_an_archive",
        Kind::TemplateUnavailable => "overleaf.template_unavailable",
        Kind::TemplateLinkInvalid => "overleaf.template_link_invalid",
        Kind::GitTokenInvalid => "overleaf.git_token_invalid",
        Kind::GitTokenMissing => "overleaf.git_token_missing",
        Kind::GitTokenRejected => "overleaf.git_token_rejected",
        Kind::GitUnavailable => "overleaf.git_unavailable",
        Kind::GitNotInstalled => "git.not_installed",
        Kind::SyncBusy => "overleaf.sync_busy",
        Kind::SyncNotLinked => "overleaf.sync_not_linked",
        Kind::SyncAlreadyLinked => "overleaf.sync_already_linked",
        Kind::SyncNeedsRelink => "overleaf.sync_needs_relink",
        Kind::SyncOffline => "overleaf.sync_offline",
        Kind::SyncFailed | Kind::FolderExists | Kind::WorktreeBusy | Kind::Io => {
            "overleaf.sync_failed"
        }
        Kind::SyncKeptChanging => "overleaf.sync_kept_changing",
        Kind::SyncCaseClash => "overleaf.sync_case_clash",
        Kind::SyncInvalidNames => "overleaf.sync_invalid_names",
        Kind::SyncFileTooLarge => "overleaf.sync_file_too_large",
        Kind::SyncTooLarge => "overleaf.sync_too_large",
        Kind::SyncPathBlocked => "overleaf.sync_path_blocked",
    }
}

/// A local failure keeps its message (the app's Git runner already reports
/// in the app's format); everything else becomes an app error.
pub(crate) fn app_error(error: OnlineError) -> String {
    if error.kind == OnlineErrorKind::Io {
        return error.detail.unwrap_or_default();
    }
    let mut app = AppError::new(legacy_code(error.kind));
    for (name, value) in &error.params {
        app = app.param(name, value);
    }
    if let Some(detail) = error.detail {
        app = app.detail(detail);
    }
    app.into()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_KINDS: [OnlineErrorKind; 30] = [
        OnlineErrorKind::InvalidServer,
        OnlineErrorKind::SignedOut,
        OnlineErrorKind::SessionExpired,
        OnlineErrorKind::SignInFailed,
        OnlineErrorKind::SignInCancelled,
        OnlineErrorKind::RateLimited,
        OnlineErrorKind::Unreachable,
        OnlineErrorKind::Unrecognized,
        OnlineErrorKind::ProjectUnavailable,
        OnlineErrorKind::TooLarge,
        OnlineErrorKind::NotAnArchive,
        OnlineErrorKind::TemplateUnavailable,
        OnlineErrorKind::TemplateLinkInvalid,
        OnlineErrorKind::GitTokenInvalid,
        OnlineErrorKind::GitTokenMissing,
        OnlineErrorKind::GitTokenRejected,
        OnlineErrorKind::GitUnavailable,
        OnlineErrorKind::SyncBusy,
        OnlineErrorKind::SyncNotLinked,
        OnlineErrorKind::SyncAlreadyLinked,
        OnlineErrorKind::SyncNeedsRelink,
        OnlineErrorKind::SyncOffline,
        OnlineErrorKind::SyncFailed,
        OnlineErrorKind::SyncKeptChanging,
        OnlineErrorKind::SyncCaseClash,
        OnlineErrorKind::SyncInvalidNames,
        OnlineErrorKind::SyncFileTooLarge,
        OnlineErrorKind::SyncTooLarge,
        OnlineErrorKind::SyncPathBlocked,
        OnlineErrorKind::FolderExists,
    ];

    #[test]
    fn every_online_error_maps_to_an_existing_english_key() {
        let catalog: serde_json::Value =
            serde_json::from_str(include_str!("../../../src/i18n/locales/en/errors.json")).unwrap();
        let has = |code: &str| {
            code.split('.')
                .try_fold(&catalog, |node, part| node.get(part))
                .is_some_and(serde_json::Value::is_string)
        };
        for kind in ALL_KINDS.into_iter().chain([
            OnlineErrorKind::WorktreeBusy,
            OnlineErrorKind::GitNotInstalled,
        ]) {
            assert!(has(legacy_code(kind)), "{kind:?}");
        }
        let passed_on = "@oleafly/error:{\"code\":\"git.not_installed\"}";
        assert_eq!(app_error(OnlineError::io(passed_on)), passed_on);
    }

    #[test]
    fn app_errors_keep_params_and_detail() {
        let text = app_error(
            OnlineError::new(OnlineErrorKind::Unreachable)
                .param("server", "https://latex.example.edu")
                .detail("timed out"),
        );
        assert!(text.contains("\"overleaf.unreachable\""), "{text}");
        assert!(text.contains("https://latex.example.edu"), "{text}");
        assert!(text.contains("timed out"), "{text}");
    }
}
