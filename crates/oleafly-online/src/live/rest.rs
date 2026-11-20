#[cfg(test)]
mod tests;

use std::sync::Arc;
use std::time::Duration;

use reqwest::header::{ACCEPT, CONTENT_TYPE, RETRY_AFTER};
use reqwest::{RequestBuilder, Response, StatusCode};
use serde_json::{json, Value};

use super::tree_queue::MAX_UPLOAD_BYTES;
use crate::client::{read_counted, BodyError, Http};
use crate::error::{OnlineError, OnlineErrorKind};
use crate::realtime::events::EntityId;
use crate::realtime::tree::NodeKind;
use crate::realtime::ProjectPage;
use crate::session::SessionHandle;

const CSRF_HEADER: &str = "X-Csrf-Token";
const GET_RETRIES: u32 = 2;
const GET_PAUSE: Duration = Duration::from_millis(200);
const DOWNLOAD_TRIES: u32 = 2;
const MESSAGE_CHARS: usize = 200;

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum RestError {
    #[error("the server refused it ({status}): {message}")]
    Refused { status: u16, message: String },
    #[error("you can't change files in this project")]
    NotAllowed,
    #[error("the server asked to slow down")]
    RateLimited(Option<Duration>),
    #[error("the sign-in expired")]
    SignedOut,
    #[error("the reply was lost: {0}")]
    Lost(String),
    #[error("the server could not be reached: {0}")]
    Unreachable(String),
    #[error("the reply could not be read: {0}")]
    Unreadable(String),
    #[error("the download ended before its length")]
    Short,
    #[error("the file is larger than {} MiB", MAX_UPLOAD_BYTES >> 20)]
    TooLarge,
}

impl RestError {
    pub fn is_temporary(&self) -> bool {
        matches!(
            self,
            RestError::Lost(_)
                | RestError::Unreachable(_)
                | RestError::RateLimited(_)
                | RestError::Unreadable(_)
                | RestError::Short
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Uploaded {
    pub id: EntityId,
    pub kind: NodeKind,
    pub hash: Option<String>,
}

pub struct TreeRest {
    http: Http,
    page: Arc<ProjectPage>,
    project_id: String,
}

fn entity_type(kind: NodeKind) -> &'static str {
    match kind {
        NodeKind::Doc => "doc",
        NodeKind::File => "file",
        NodeKind::Folder => "folder",
    }
}

fn sent_error(error: &reqwest::Error) -> RestError {
    if error.is_connect() {
        RestError::Unreachable(error.to_string())
    } else {
        RestError::Lost(error.to_string())
    }
}

fn page_error(error: OnlineError) -> RestError {
    match error.kind {
        OnlineErrorKind::SessionExpired | OnlineErrorKind::SignedOut => RestError::SignedOut,
        OnlineErrorKind::ProjectUnavailable => RestError::NotAllowed,
        _ => RestError::Unreachable(error.to_string()),
    }
}

fn retry_after(response: &Response) -> Option<Duration> {
    response
        .headers()
        .get(RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
        .map(Duration::from_secs)
}

fn short(text: &str) -> String {
    text.trim().chars().take(MESSAGE_CHARS).collect()
}

fn refusal_message(text: &str) -> String {
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|value| {
            ["message", "error"]
                .iter()
                .find_map(|key| value.get(*key).and_then(Value::as_str).map(str::to_string))
        })
        .unwrap_or_else(|| short(text))
}

enum Judged {
    Fine(Response),
    StaleToken,
    Failed(RestError),
}

async fn judged(response: Response) -> Judged {
    let status = response.status();
    if status.is_success() {
        return Judged::Fine(response);
    }
    let wait = retry_after(&response);
    let text = response.text().await.unwrap_or_default();
    match status {
        StatusCode::UNAUTHORIZED => Judged::Failed(RestError::SignedOut),
        StatusCode::FORBIDDEN if refusal_message(&text) == "restricted" => {
            Judged::Failed(RestError::NotAllowed)
        }
        StatusCode::FORBIDDEN => Judged::StaleToken,
        StatusCode::TOO_MANY_REQUESTS => Judged::Failed(RestError::RateLimited(wait)),
        status if status.is_server_error() => {
            Judged::Failed(RestError::Unreachable(format!("HTTP {}", status.as_u16())))
        }
        status => Judged::Failed(RestError::Refused {
            status: status.as_u16(),
            message: refusal_message(&text),
        }),
    }
}

fn boundary() -> String {
    format!(
        "----oleafly{:016x}{:016x}",
        rand::random::<u64>(),
        rand::random::<u64>()
    )
}

fn multipart(boundary: &str, name: &str, bytes: &[u8]) -> Vec<u8> {
    let quoted: String = name
        .chars()
        .map(|character| match character {
            '"' => "%22".to_string(),
            '\r' | '\n' => " ".to_string(),
            other => other.to_string(),
        })
        .collect();
    let mut body = Vec::with_capacity(bytes.len() + 512);
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\n{quoted}\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"qqfile\"; filename=\"{quoted}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

async fn json_of(response: Response) -> Result<Value, RestError> {
    response
        .json::<Value>()
        .await
        .map_err(|error| RestError::Unreadable(error.to_string()))
}

fn id_in(value: &Value, key: &str) -> Result<EntityId, RestError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(|id| EntityId(id.to_string()))
        .ok_or_else(|| RestError::Unreadable(format!("no {key} in the reply")))
}

impl TreeRest {
    pub fn new(http: Http, page: Arc<ProjectPage>, project_id: &str) -> TreeRest {
        TreeRest {
            http,
            page,
            project_id: project_id.to_string(),
        }
    }

    fn route(&self, rest: &str) -> String {
        format!("/project/{}{rest}", self.project_id)
    }

    async fn reload(&self, session: &SessionHandle) -> Result<(), RestError> {
        self.page
            .reload(&self.http, session, self.page.is_fallback())
            .await
            .map_err(page_error)
    }

    async fn token(&self, session: &SessionHandle) -> Result<String, RestError> {
        if let Some(token) = self.page.csrf() {
            return Ok(token);
        }
        self.reload(session).await?;
        self.page
            .csrf()
            .ok_or_else(|| RestError::Unreadable("the editor page has no CSRF token".into()))
    }

    async fn send(
        &self,
        session: &SessionHandle,
        request: RequestBuilder,
    ) -> Result<Response, RestError> {
        let response = request
            .header(ACCEPT, "application/json")
            .send()
            .await
            .map_err(|error| sent_error(&error))?;
        session.absorb_headers(response.headers());
        Ok(response)
    }

    async fn write(
        &self,
        session: &SessionHandle,
        mut request: impl FnMut(&str) -> RequestBuilder,
    ) -> Result<Response, RestError> {
        let mut refreshed = false;
        loop {
            let token = self.token(session).await?;
            let built = request(&session.cookie()).header(CSRF_HEADER, &token);
            match judged(self.send(session, built).await?).await {
                Judged::Fine(response) => return Ok(response),
                Judged::StaleToken if !refreshed => {
                    refreshed = true;
                    self.reload(session).await?;
                }
                Judged::StaleToken => {
                    return Err(RestError::Refused {
                        status: 403,
                        message: "Forbidden".into(),
                    })
                }
                Judged::Failed(error) => return Err(error),
            }
        }
    }

    async fn get(&self, session: &SessionHandle, path: &str) -> Result<Response, RestError> {
        let mut attempt = 0;
        loop {
            let request = self.http.get(path, &session.cookie());
            let error = match self.send(session, request).await {
                Ok(response) => match judged(response).await {
                    Judged::Fine(response) => return Ok(response),
                    Judged::StaleToken => RestError::NotAllowed,
                    Judged::Failed(error) => error,
                },
                Err(error) => error,
            };
            let again = matches!(error, RestError::Lost(_) | RestError::Unreachable(_));
            if !again || attempt >= GET_RETRIES {
                return Err(error);
            }
            attempt += 1;
            tokio::time::sleep(GET_PAUSE * attempt).await;
        }
    }

    pub async fn create_doc(
        &self,
        session: &SessionHandle,
        parent: &EntityId,
        name: &str,
    ) -> Result<EntityId, RestError> {
        let path = self.route("/doc");
        let body = json!({ "name": name, "parent_folder_id": parent.0 });
        let response = self
            .write(session, |cookie| self.http.post(&path, cookie).json(&body))
            .await?;
        id_in(&json_of(response).await?, "_id")
    }

    pub async fn create_folder(
        &self,
        session: &SessionHandle,
        parent: &EntityId,
        name: &str,
    ) -> Result<EntityId, RestError> {
        let path = self.route("/folder");
        let body = json!({ "name": name, "parent_folder_id": parent.0 });
        let response = self
            .write(session, |cookie| self.http.post(&path, cookie).json(&body))
            .await?;
        id_in(&json_of(response).await?, "_id")
    }

    pub async fn upload(
        &self,
        session: &SessionHandle,
        folder: &EntityId,
        name: &str,
        bytes: &[u8],
    ) -> Result<Uploaded, RestError> {
        let path = self.route(&format!("/upload?folder_id={}", folder.0));
        let boundary = boundary();
        let content_type = format!("multipart/form-data; boundary={boundary}");
        let mut built = Some(multipart(&boundary, name, bytes));
        let size = built.as_ref().map_or(0, |body| body.len() as u64);
        let response = self
            .write(session, |cookie| {
                let body = built
                    .take()
                    .unwrap_or_else(|| multipart(&boundary, name, bytes));
                self.http
                    .post_upload(&path, cookie, size)
                    .header(CONTENT_TYPE, &content_type)
                    .body(body)
            })
            .await?;
        let reply = json_of(response).await?;
        if reply.get("success").and_then(Value::as_bool) != Some(true) {
            return Err(RestError::Refused {
                status: 200,
                message: refusal_message(&reply.to_string()),
            });
        }
        let kind = match reply.get("entity_type").and_then(Value::as_str) {
            Some("doc") => NodeKind::Doc,
            _ => NodeKind::File,
        };
        Ok(Uploaded {
            id: id_in(&reply, "entity_id")?,
            kind,
            hash: reply
                .get("hash")
                .and_then(Value::as_str)
                .map(str::to_string),
        })
    }

    pub async fn rename(
        &self,
        session: &SessionHandle,
        kind: NodeKind,
        id: &EntityId,
        name: &str,
    ) -> Result<(), RestError> {
        let path = self.route(&format!("/{}/{}/rename", entity_type(kind), id.0));
        let body = json!({ "name": name });
        self.write(session, |cookie| self.http.post(&path, cookie).json(&body))
            .await
            .map(drop)
    }

    pub async fn move_to(
        &self,
        session: &SessionHandle,
        kind: NodeKind,
        id: &EntityId,
        folder: &EntityId,
    ) -> Result<(), RestError> {
        let path = self.route(&format!("/{}/{}/move", entity_type(kind), id.0));
        let body = json!({ "folder_id": folder.0 });
        self.write(session, |cookie| self.http.post(&path, cookie).json(&body))
            .await
            .map(drop)
    }

    pub async fn delete(
        &self,
        session: &SessionHandle,
        kind: NodeKind,
        id: &EntityId,
    ) -> Result<(), RestError> {
        let path = self.route(&format!("/{}/{}", entity_type(kind), id.0));
        match self
            .write(session, |cookie| self.http.delete(&path, cookie))
            .await
        {
            Err(RestError::Refused { status: 404, .. }) => Ok(()),
            other => other.map(drop),
        }
    }

    pub async fn entities(&self, session: &SessionHandle) -> Result<Vec<String>, RestError> {
        let response = self.get(session, &self.route("/entities")).await?;
        let reply = json_of(response).await?;
        Ok(reply
            .get("entities")
            .and_then(Value::as_array)
            .map(|entities| {
                entities
                    .iter()
                    .filter_map(|entity| entity.get("path").and_then(Value::as_str))
                    .map(|path| path.trim_start_matches('/').to_string())
                    .collect()
            })
            .unwrap_or_default())
    }

    pub async fn download(
        &self,
        session: &SessionHandle,
        id: &EntityId,
        hash: Option<&str>,
        progress: &mut (dyn FnMut(u64, Option<u64>) + Send),
    ) -> Result<Vec<u8>, RestError> {
        let mut last = RestError::Short;
        for _ in 0..DOWNLOAD_TRIES {
            match self.fetch(session, id, hash, progress).await {
                Ok(bytes) => return Ok(bytes),
                Err(error) if error.is_temporary() => last = error,
                Err(error) => return Err(error),
            }
        }
        Err(last)
    }

    async fn fetch(
        &self,
        session: &SessionHandle,
        id: &EntityId,
        hash: Option<&str>,
        progress: &mut (dyn FnMut(u64, Option<u64>) + Send),
    ) -> Result<Vec<u8>, RestError> {
        let by_file = self.route(&format!("/file/{}", id.0));
        let response = match hash {
            Some(hash) => {
                let by_hash = self.route(&format!("/blob/{hash}?fallback={}", id.0));
                match self.get(session, &by_hash).await {
                    Err(RestError::Refused { .. }) => self.get(session, &by_file).await?,
                    other => other?,
                }
            }
            None => self.get(session, &by_file).await?,
        };
        let total = response.content_length();
        let mut done: u64 = 0;
        let bytes = read_counted(response, MAX_UPLOAD_BYTES as usize, |arrived| {
            done = done.saturating_add(arrived as u64);
            progress(done, total);
        })
        .await
        .map_err(|error| match error {
            BodyError::TooLarge(_) => RestError::TooLarge,
            BodyError::Read(_) => RestError::Short,
        })?;
        if total.is_some_and(|total| total != bytes.len() as u64) {
            return Err(RestError::Short);
        }
        Ok(bytes)
    }
}
