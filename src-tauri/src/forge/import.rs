//! Import a repository from a Git hosting account: the server's archive of
//! one commit goes through the guarded ZIP import, then the repository's
//! history is attached at that same commit.
use super::cancel::{cancel_on_event, ImportCancel};
use super::remote_auth::credential_for;
use super::{account_and_token, app_error, host_label};
use crate::git::{HistorySource, RemoteAuth};
use oleafly_forge::address;
use oleafly_forge::api::{self, Session, ARCHIVE_MAX_BYTES};
use oleafly_forge::repo_path::RepoPath;
use oleafly_forge::ForgeError;

/// Import a repository of an account as a new project. The webview can
/// cancel it by emitting the import-cancel event with `cancel_id`: the
/// download or the Git fetch stops and no project is created.
#[tauri::command]
pub async fn forge_import_repo(
    app: tauri::AppHandle,
    base: String,
    full_name: String,
    cancel_id: Option<String>,
) -> Result<String, String> {
    let (cancel, _listener) = cancel_on_event(&app, cancel_id);
    let (account, token, http) = account_and_token(&base).await?;
    let host = host_label(&account.base);
    let fail = |error: ForgeError| app_error(&error, &host);
    let path = RepoPath::parse(account.kind, full_name.trim()).map_err(fail)?;
    let session = Session {
        http: &http,
        kind: account.kind,
        base: &account.base,
        token: &token.token,
    };
    let download = async {
        let info = api::repo_info(&session, &path).await.map_err(fail)?;
        let branch = match info.default_branch {
            Some(branch) if !info.empty => branch,
            _ => return Err(fail(ForgeError::RepositoryEmpty)),
        };
        // The archive and the history come from this one commit, even when
        // the branch moves while the import runs.
        let commit = api::branch_commit(&session, &path, &branch)
            .await
            .map_err(fail)?;
        let archive = api::download_archive(&session, &path, &commit, ARCHIVE_MAX_BYTES)
            .await
            .map_err(fail)?;
        Ok((branch, commit, archive))
    };
    // Dropping the download stops it; the cancel event ends it at once.
    let (branch, commit, archive) = tokio::select! {
        downloaded = download => downloaded?,
        () = cancel.cancelled() => return Err(ImportCancel::error()),
    };
    let remote_url = address::clone_url(&account.base, &path.full_name());
    let auth = RemoteAuth::Account(credential_for(&account, &token)?);
    let name = path.name().to_string();
    let work = cancel.clone();
    let project_id = tauri::async_runtime::spawn_blocking(move || {
        work.check()?;
        crate::project::import_project_zip_bytes_with(name, &archive, |project_id| {
            crate::git::attach_imported_repository_history_lock_held(
                project_id,
                &remote_url,
                &branch,
                Some(&commit),
                HistorySource::Remote(&auth),
                Some(&work),
            )
        })
    })
    .await
    .map_err(|error| error.to_string())??;
    crate::project::record_tex_spec_for_new_project(&app, &project_id);
    Ok(project_id)
}
