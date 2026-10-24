//! Errors from `oleafly-online` in the app's format, with the codes
//! `errors.json` has had since 0.4.7.
use oleafly_online::sync::FILES_MAY_HAVE_CHANGED;
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

/// A failure the app's Git runner reported keeps its message (it is already
/// in the app's format); everything else becomes an app error. A sync that
/// may have changed files here never says they are unchanged.
pub(crate) fn app_error(error: OnlineError) -> String {
    if error.kind == OnlineErrorKind::Io
        && error
            .detail
            .as_deref()
            .is_some_and(|detail| detail.starts_with(crate::app_error::PREFIX))
    {
        return error.detail.unwrap_or_default();
    }
    let changed = error.params.contains_key(FILES_MAY_HAVE_CHANGED);
    let code = match legacy_code(error.kind) {
        "overleaf.sync_failed" if changed => SYNC_INCOMPLETE,
        code => code,
    };
    let mut app = AppError::new(code);
    for (name, value) in &error.params {
        app = app.param(name, value);
    }
    if let Some(detail) = error.detail.filter(|detail| !detail.is_empty()) {
        app = app.detail(detail);
    }
    app.into()
}

/// The code of a sync that stopped after it had changed files here.
const SYNC_INCOMPLETE: &str = "overleaf.sync_incomplete";

/// The code, parameters and detail of an app error envelope.
fn envelope(error: &str) -> Option<serde_json::Value> {
    serde_json::from_str(error.strip_prefix(crate::app_error::PREFIX)?).ok()
}

/// Whether a failed sync reported that files here may have changed.
pub(crate) fn files_may_have_changed(error: &str) -> bool {
    envelope(error).is_some_and(|found| {
        found["code"] == SYNC_INCOMPLETE || found["params"][FILES_MAY_HAVE_CHANGED] == "true"
    })
}

/// `error` for a sync that had already written files here when it failed:
/// a failure that would say the files are unchanged says they changed. A
/// more specific reason (offline, a refused token) is kept.
pub(crate) fn after_files_changed(error: String) -> String {
    let Some(found) = envelope(&error) else {
        return AppError::new(SYNC_INCOMPLETE)
            .param(FILES_MAY_HAVE_CHANGED, "true")
            .detail(error)
            .into();
    };
    if found["code"] != "overleaf.sync_failed" {
        return error;
    }
    let mut app = AppError::new(SYNC_INCOMPLETE).param(FILES_MAY_HAVE_CHANGED, "true");
    if let Some(params) = found["params"].as_object() {
        for (name, value) in params {
            if let Some(value) = value.as_str() {
                app = app.param(name, value);
            }
        }
    }
    if let Some(detail) = found["detail"].as_str().filter(|detail| !detail.is_empty()) {
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
    fn the_sync_s_own_failures_reach_the_app_as_translatable_errors() {
        let failed = app_error(OnlineError::io("could not write /p/main.tex: denied"));
        assert!(failed.contains("\"overleaf.sync_failed\""), "{failed}");
        assert!(failed.contains("could not write /p/main.tex"), "{failed}");
        assert!(!files_may_have_changed(&failed));

        let stuck = app_error(
            OnlineError::io("The sync stopped partway and could not put back every file.")
                .param(FILES_MAY_HAVE_CHANGED, "true"),
        );
        assert!(stuck.contains("\"overleaf.sync_incomplete\""), "{stuck}");
        assert!(
            stuck.contains("\"filesMayHaveChanged\":\"true\""),
            "{stuck}"
        );
        assert!(stuck.contains("stopped partway"), "{stuck}");
        assert!(files_may_have_changed(&stuck));

        let catalog: serde_json::Value =
            serde_json::from_str(include_str!("../../../src/i18n/locales/en/errors.json")).unwrap();
        assert!(catalog["overleaf"]["sync_incomplete"].is_string());
    }

    #[test]
    fn a_failure_after_files_were_written_never_says_they_are_unchanged() {
        let failed: String = AppError::new("overleaf.sync_failed")
            .detail("! [remote rejected] master -> master")
            .into();
        let changed = after_files_changed(failed);
        assert!(
            changed.contains("\"overleaf.sync_incomplete\""),
            "{changed}"
        );
        assert!(changed.contains("remote rejected"), "{changed}");
        assert!(files_may_have_changed(&changed));

        let offline: String = AppError::new("overleaf.sync_offline").into();
        assert_eq!(after_files_changed(offline.clone()), offline);

        let raw = after_files_changed("failed to run git: gone".to_string());
        assert!(raw.contains("\"overleaf.sync_incomplete\""), "{raw}");
        assert!(raw.contains("failed to run git: gone"), "{raw}");
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
