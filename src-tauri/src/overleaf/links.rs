use oleafly_online::live::rest::{
    accept_invite, grant_token, parse_link, preview_token, ProjectLink, RestError, TokenReply,
};
use serde::Serialize;

use super::client::Http;
use oleafly_online::{OnlineError, OnlineErrorKind};

use super::errors::{app_error, legacy_code, rest_error};
use super::import::{self, Listing};
use super::session;
use crate::app_error::AppError;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Grants {
    Edit,
    View,
    Already,
    Invite,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinkPreview {
    pub server: String,
    pub project_name: Option<String>,
    pub grants: Grants,
    pub project_id: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinkJoined {
    pub server: String,
    pub project_id: String,
}

fn link_unavailable() -> String {
    app_error(OnlineError::new(OnlineErrorKind::LinkUnavailable))
}

fn parsed(link: &str, server: &str) -> Result<(String, ProjectLink), String> {
    parse_link(link, server).map_err(app_error)
}

async fn failed(base: &str, user_id: &str, error: &RestError) -> String {
    let failure = rest_error(base, error, |_| {
        AppError::new(legacy_code(OnlineErrorKind::LinkUnavailable))
    });
    session::forget_if_expired(base, user_id, &failure).await;
    if !matches!(error, RestError::Refused { .. } | RestError::RateLimited(_)) {
        let _ = crate::project::append_app_log(format!(
            "An Overleaf project link did not answer as expected: {error}"
        ));
    }
    failure
}

fn name_of(listing: &Listing, project_id: &str) -> Option<String> {
    listing
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .map(|project| project.name.clone())
}

fn csrf_of(listing: &Listing) -> Result<&str, String> {
    listing
        .csrf
        .as_deref()
        .ok_or_else(|| AppError::new("overleaf.unrecognized").into())
}

async fn signed(
    server: Option<String>,
    account: Option<String>,
    link: &str,
) -> Result<(String, ProjectLink, Listing), String> {
    let server = session::normalize_server(server.as_deref())?;
    let (base, link) = parsed(link, &server)?;
    let account = account.filter(|_| base == server);
    let listing = import::list(&base, account.as_deref()).await?;
    Ok((base, link, listing))
}

pub(crate) async fn preview(
    base: &str,
    link: &ProjectLink,
    listing: &Listing,
) -> Result<LinkPreview, String> {
    let shown = |grants: Grants, project_name: Option<String>, project_id: Option<String>| {
        Ok(LinkPreview {
            server: base.to_owned(),
            project_name,
            grants,
            project_id,
        })
    };
    match link {
        ProjectLink::Project { id } => match name_of(listing, id) {
            Some(name) => shown(Grants::Already, Some(name), Some(id.clone())),
            None => Err(link_unavailable()),
        },
        ProjectLink::Invite { project, .. } | ProjectLink::Share { project, .. } => {
            if let Some(name) = name_of(listing, project) {
                return shown(Grants::Already, Some(name), Some(project.clone()));
            }
            let invited = listing
                .invites
                .iter()
                .find(|invite| invite.project_id == *project)
                .map(|invite| invite.project_name.clone());
            shown(Grants::Invite, invited, Some(project.clone()))
        }
        ProjectLink::Read { .. } | ProjectLink::Edit { .. } => {
            let http = Http::new(base)?;
            let account = &listing.session;
            match preview_token(http.online(), &account.cookie, csrf_of(listing)?, link).await {
                Ok(TokenReply::RequireAccept { project_name }) => {
                    let grants = if link.read_only() {
                        Grants::View
                    } else {
                        Grants::Edit
                    };
                    shown(grants, Some(project_name), None)
                }
                Ok(TokenReply::Already { project_id } | TokenReply::Granted { project_id, .. }) => {
                    shown(
                        Grants::Already,
                        name_of(listing, &project_id),
                        Some(project_id),
                    )
                }
                Ok(TokenReply::Unsupported) => Err(link_unavailable()),
                Err(error) => Err(failed(base, &account.user_id, &error).await),
            }
        }
    }
}

pub(crate) async fn join(
    base: &str,
    link: &ProjectLink,
    listing: &Listing,
) -> Result<LinkJoined, String> {
    let joined = |project_id: String| {
        Ok(LinkJoined {
            server: base.to_owned(),
            project_id,
        })
    };
    let http = Http::new(base)?;
    let account = &listing.session;
    match link {
        ProjectLink::Project { id } => match name_of(listing, id) {
            Some(_) => joined(id.clone()),
            None => Err(link_unavailable()),
        },
        ProjectLink::Invite { project, .. } | ProjectLink::Share { project, .. } => {
            if name_of(listing, project).is_some() {
                return joined(project.clone());
            }
            match accept_invite(http.online(), &account.cookie, csrf_of(listing)?, link).await {
                Ok(()) => joined(project.clone()),
                Err(error) => Err(failed(base, &account.user_id, &error).await),
            }
        }
        ProjectLink::Read { .. } | ProjectLink::Edit { .. } => {
            match grant_token(http.online(), &account.cookie, csrf_of(listing)?, link).await {
                Ok(TokenReply::Granted { project_id, .. } | TokenReply::Already { project_id }) => {
                    joined(project_id)
                }
                Ok(TokenReply::RequireAccept { .. } | TokenReply::Unsupported) => {
                    Err(link_unavailable())
                }
                Err(error) => Err(failed(base, &account.user_id, &error).await),
            }
        }
    }
}

#[tauri::command]
pub async fn overleaf_link_preview(
    server: Option<String>,
    account: Option<String>,
    link: String,
) -> Result<LinkPreview, String> {
    let (base, link, listing) = signed(server, account, &link).await?;
    preview(&base, &link, &listing).await
}

#[tauri::command]
pub async fn overleaf_link_join(
    server: Option<String>,
    account: Option<String>,
    link: String,
) -> Result<LinkJoined, String> {
    let (base, link, listing) = signed(server, account, &link).await?;
    join(&base, &link, &listing).await
}

pub(crate) async fn accept(
    base: &str,
    account: Option<&str>,
    invite_id: &str,
) -> Result<LinkJoined, String> {
    let listing = import::list(base, account).await?;
    let Some(invite) = listing
        .invites
        .iter()
        .find(|invite| invite.id == invite_id)
        .cloned()
    else {
        return Err(link_unavailable());
    };
    let link = ProjectLink::Invite {
        project: invite.project_id,
        token: invite.token,
    };
    join(base, &link, &listing).await
}

#[tauri::command]
pub async fn overleaf_invite_accept(
    server: Option<String>,
    account: Option<String>,
    invite: String,
) -> Result<LinkJoined, String> {
    let base = session::normalize_server(server.as_deref())?;
    accept(&base, account.as_deref(), &invite).await
}
