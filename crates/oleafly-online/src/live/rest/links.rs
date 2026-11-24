#[cfg(test)]
mod tests;

use std::time::Duration;

use reqwest::header::{ACCEPT, LOCATION};
use reqwest::{RequestBuilder, Response};
use serde_json::{json, Value};

use super::{answered, json_of, sent_error, RestError, CSRF_HEADER};
use crate::client::{project_id_in, valid_project_id, Http};
use crate::error::{OnlineError, OnlineErrorKind};
use crate::service::DEFAULT_SERVER;
use crate::session;

pub const LINK_DEADLINE: Duration = Duration::from_secs(30);
const MAX_TOKEN: usize = 128;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SplitLink {
    pub base: String,
    pub path: String,
    pub fragment: Option<String>,
}

fn overleaf_host(host: &str) -> bool {
    host == "overleaf.com" || host.ends_with(".overleaf.com")
}

pub fn split_link(input: &str, server: &str) -> Result<Option<SplitLink>, OnlineError> {
    let raw = input.trim();
    let with_scheme = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };
    let Ok(url) = url::Url::parse(&with_scheme) else {
        return Ok(None);
    };
    if !matches!(url.scheme(), "https" | "http") {
        return Ok(None);
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let fragment = url
        .fragment()
        .map(str::to_string)
        .filter(|fragment| !fragment.is_empty());
    if overleaf_host(&host) {
        return Ok(Some(SplitLink {
            base: DEFAULT_SERVER.to_string(),
            path: url.path().to_string(),
            fragment,
        }));
    }
    let base = session::normalize_server(Some(server))?;
    let origin = session::origin_of(&base);
    if url.origin().ascii_serialization() != origin {
        return Ok(None);
    }
    let base_path = base.strip_prefix(&origin).unwrap_or_default();
    Ok(url
        .path()
        .strip_prefix(base_path)
        .filter(|rest| rest.starts_with('/'))
        .map(|path| SplitLink {
            base: base.clone(),
            path: path.to_string(),
            fragment,
        }))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProjectLink {
    Project {
        id: String,
    },
    Read {
        token: String,
        fragment: Option<String>,
    },
    Edit {
        token: String,
        fragment: Option<String>,
    },
    Invite {
        project: String,
        token: String,
    },
}

fn read_token(token: &str) -> bool {
    token.len() == 12 && token.bytes().all(|byte| byte.is_ascii_lowercase())
}

fn edit_token(token: &str) -> bool {
    let letters = token.trim_start_matches(|character: char| character.is_ascii_digit());
    letters.len() < token.len()
        && (6..=12).contains(&letters.len())
        && letters.bytes().all(|byte| byte.is_ascii_lowercase())
}

fn invite_token(token: &str) -> bool {
    !token.is_empty()
        && token.len() <= MAX_TOKEN
        && token.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

impl ProjectLink {
    pub fn parse(path: &str, fragment: Option<String>) -> Option<ProjectLink> {
        let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
        match parts.as_slice() {
            ["project", id] if valid_project_id(id) => Some(ProjectLink::Project {
                id: (*id).to_string(),
            }),
            ["project", project, "invite", "token", token]
                if valid_project_id(project) && invite_token(token) =>
            {
                Some(ProjectLink::Invite {
                    project: (*project).to_string(),
                    token: (*token).to_string(),
                })
            }
            ["read", token] if read_token(token) => Some(ProjectLink::Read {
                token: (*token).to_string(),
                fragment,
            }),
            [token] if edit_token(token) => Some(ProjectLink::Edit {
                token: (*token).to_string(),
                fragment,
            }),
            _ => None,
        }
    }

    fn grant_route(&self) -> Option<(String, &Option<String>)> {
        match self {
            ProjectLink::Read { token, fragment } => {
                Some((format!("/read/{token}/grant"), fragment))
            }
            ProjectLink::Edit { token, fragment } => Some((format!("/{token}/grant"), fragment)),
            ProjectLink::Project { .. } | ProjectLink::Invite { .. } => None,
        }
    }

    pub fn read_only(&self) -> bool {
        matches!(self, ProjectLink::Read { .. })
    }
}

pub fn parse_link(input: &str, server: &str) -> Result<(String, ProjectLink), OnlineError> {
    split_link(input, server)?
        .and_then(|split| {
            ProjectLink::parse(&split.path, split.fragment).map(|link| (split.base, link))
        })
        .ok_or_else(|| OnlineError::new(OnlineErrorKind::LinkInvalid))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TokenReply {
    RequireAccept { project_name: String },
    Granted { project_id: String, read_only: bool },
    Already { project_id: String },
    Unsupported,
}

fn token_reply(reply: &Value) -> TokenReply {
    if let Some(name) = reply
        .get("requireAccept")
        .and_then(|accept| accept.get("projectName"))
        .and_then(Value::as_str)
    {
        return TokenReply::RequireAccept {
            project_name: name.trim().to_string(),
        };
    }
    let Some(project_id) = reply
        .get("redirect")
        .and_then(Value::as_str)
        .and_then(project_id_in)
    else {
        return TokenReply::Unsupported;
    };
    if reply.get("higherAccess").and_then(Value::as_bool) == Some(true) {
        return TokenReply::Already { project_id };
    }
    TokenReply::Granted {
        read_only: reply.get("tokenAccessGranted").and_then(Value::as_str) == Some("readOnly"),
        project_id,
    }
}

async fn bounded(request: RequestBuilder) -> Result<Response, RestError> {
    match tokio::time::timeout(LINK_DEADLINE, request.send()).await {
        Ok(sent) => sent.map_err(|error| sent_error(&error)),
        Err(_) => Err(RestError::Lost(format!(
            "no reply within {} s",
            LINK_DEADLINE.as_secs()
        ))),
    }
}

async fn post_grant(
    http: &Http,
    cookie: &str,
    csrf: &str,
    link: &ProjectLink,
    confirmed: bool,
) -> Result<TokenReply, RestError> {
    let Some((route, fragment)) = link.grant_route() else {
        return Err(RestError::Refused {
            status: 400,
            message: "not a share link".into(),
        });
    };
    let mut body = json!({
        "tokenHashPrefix": fragment.as_ref().map(|fragment| format!("#{fragment}")).unwrap_or_default(),
    });
    if confirmed {
        body["confirmedByUser"] = Value::Bool(true);
    }
    let response = bounded(
        http.post(&route, cookie)
            .header(CSRF_HEADER, csrf)
            .header(ACCEPT, "application/json")
            .json(&body),
    )
    .await?;
    Ok(token_reply(
        &json_of(answered(http, response).await?).await?,
    ))
}

pub async fn preview_token(
    http: &Http,
    cookie: &str,
    csrf: &str,
    link: &ProjectLink,
) -> Result<TokenReply, RestError> {
    post_grant(http, cookie, csrf, link, false).await
}

pub async fn grant_token(
    http: &Http,
    cookie: &str,
    csrf: &str,
    link: &ProjectLink,
) -> Result<TokenReply, RestError> {
    post_grant(http, cookie, csrf, link, true).await
}

pub async fn accept_invite(
    http: &Http,
    cookie: &str,
    csrf: &str,
    project: &str,
    token: &str,
) -> Result<(), RestError> {
    if !valid_project_id(project) || !invite_token(token) {
        return Err(RestError::Refused {
            status: 400,
            message: "not an invite".into(),
        });
    }
    let route = format!("/project/{project}/invite/token/{token}/accept");
    let response = bounded(
        http.post(&route, cookie)
            .header(CSRF_HEADER, csrf)
            .header("X-Requested-With", "XMLHttpRequest")
            .header(ACCEPT, "application/json")
            .json(&json!({})),
    )
    .await?;
    let location = response
        .headers()
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if response.status().is_redirection() && project_id_in(location).as_deref() == Some(project) {
        return Ok(());
    }
    let refused = match answered(http, response).await {
        Ok(_) => return Ok(()),
        Err(error) => error,
    };
    if matches!(refused, RestError::Refused { status: 404, .. })
        && can_open(http, cookie, project).await?
    {
        return Ok(());
    }
    Err(refused)
}

async fn can_open(http: &Http, cookie: &str, project: &str) -> Result<bool, RestError> {
    let route = format!("/project/{project}/entities");
    let response = bounded(http.get(&route, cookie).header(ACCEPT, "application/json")).await?;
    Ok(response.status().is_success())
}
