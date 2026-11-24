#[cfg(test)]
mod tests;

use reqwest::header::{ACCEPT, CONTENT_TYPE};
use serde_json::{json, Value};

use super::{
    answered, json_of, refusal_message, sent_error, ProjectRest, RestError, CSRF_HEADER,
    MAX_UPLOAD_BYTES,
};
use crate::client::{boundary, multipart, Http};
use crate::session::SessionHandle;

pub const CREATE_ROUTE: &str = "/project/new/upload";
pub const CREATE_LIMIT_BYTES: u64 = MAX_UPLOAD_BYTES;

pub async fn create_project(
    http: &Http,
    cookie: &str,
    csrf: &str,
    name: &str,
    bytes: Vec<u8>,
) -> Result<String, RestError> {
    if bytes.len() as u64 > CREATE_LIMIT_BYTES {
        return Err(RestError::TooLarge);
    }
    let boundary = boundary();
    let body = multipart(&boundary, &format!("{name}.zip"), &bytes);
    drop(bytes);
    let size = body.len() as u64;
    let response = http
        .post_upload(CREATE_ROUTE, cookie, size)
        .header(CSRF_HEADER, csrf)
        .header(ACCEPT, "application/json")
        .header(
            CONTENT_TYPE,
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(body)
        .send()
        .await
        .map_err(|error| sent_error(&error))?;
    let status = response.status();
    let reply = json_of(answered(http, response).await?).await?;
    let created = reply.get("success").and_then(Value::as_bool) == Some(true);
    match reply.get("project_id").and_then(Value::as_str) {
        Some(id) if created && crate::client::valid_project_id(id) => Ok(id.to_owned()),
        _ => Err(RestError::Refused {
            status: status.as_u16(),
            message: refusal_message(&reply.to_string()),
        }),
    }
}

impl ProjectRest {
    pub async fn rename_project(
        &self,
        session: &SessionHandle,
        name: &str,
    ) -> Result<(), RestError> {
        let route = self.route("/rename");
        let body = json!({ "newProjectName": name });
        self.write(session, |cookie| self.http.post(&route, cookie).json(&body))
            .await
            .map(drop)
    }
}
