use std::fmt;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

const API_BASE: &str = "https://api.dropboxapi.com/2";
const CONTENT_BASE: &str = "https://content.dropboxapi.com/2";
const SINGLE_UPLOAD_LIMIT: u64 = 32 * 1024 * 1024;
const SESSION_CHUNK: u64 = 8 * 1024 * 1024;
const MAX_SMALL_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug)]
pub(crate) enum StoreError {
    Revoked,
    Network(String),
    Server(String),
    Io(String),
}

impl fmt::Display for StoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Revoked => formatter.write_str("dropbox access was revoked"),
            Self::Network(message) | Self::Server(message) | Self::Io(message) => {
                formatter.write_str(message)
            }
        }
    }
}

impl std::error::Error for StoreError {}

pub(crate) type StoreResult<T> = std::result::Result<T, StoreError>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RemoteEntry {
    pub(crate) name: String,
    pub(crate) folder: bool,
}

pub(crate) trait CloudStore: Send + Sync {
    async fn get(&self, remote: &str) -> StoreResult<Option<Vec<u8>>>;
    async fn get_to_path(&self, remote: &str, local: &Path) -> StoreResult<bool>;
    async fn put(&self, remote: &str, bytes: Vec<u8>) -> StoreResult<()>;
    async fn put_path(&self, remote: &str, local: &Path) -> StoreResult<()>;
    async fn delete(&self, remote: &str) -> StoreResult<()>;
    async fn list(&self, remote_dir: &str) -> StoreResult<Vec<RemoteEntry>>;
}

pub(crate) struct DropboxStore {
    http: reqwest::Client,
    api_base: String,
    content_base: String,
    token: String,
}

fn arg_header(value: &serde_json::Value) -> String {
    value
        .to_string()
        .chars()
        .map(|c| {
            if (c as u32) > 0x7f {
                format!("\\u{:04x}", c as u32)
            } else {
                c.to_string()
            }
        })
        .collect()
}

fn is_not_found(status: reqwest::StatusCode, body: &serde_json::Value) -> bool {
    status.as_u16() == 409
        && body
            .get("error_summary")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|summary| summary.contains("not_found"))
}

impl DropboxStore {
    pub(crate) fn new(token: String) -> StoreResult<Self> {
        let http = reqwest::Client::builder()
            .user_agent("Oleafly")
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|error| StoreError::Network(error.to_string()))?;
        Ok(Self {
            http,
            api_base: API_BASE.into(),
            content_base: CONTENT_BASE.into(),
            token,
        })
    }

    async fn read_capped(
        &self,
        mut response: reqwest::Response,
        cap: usize,
    ) -> StoreResult<Vec<u8>> {
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| StoreError::Network(error.to_string()))?
        {
            if bytes.len() + chunk.len() > cap {
                return Err(StoreError::Server("dropbox response is too large".into()));
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }

    async fn rpc(&self, route: &str, arg: serde_json::Value) -> StoreResult<serde_json::Value> {
        let response = self
            .http
            .post(format!("{}/files/{route}", self.api_base))
            .bearer_auth(&self.token)
            .json(&arg)
            .send()
            .await
            .map_err(|error| StoreError::Network(error.to_string()))?;
        let status = response.status();
        let bytes = self.read_capped(response, MAX_SMALL_BYTES).await?;
        if status.as_u16() == 401 {
            return Err(StoreError::Revoked);
        }
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or_default();
        if !status.is_success() {
            if is_not_found(status, &value) {
                return Ok(serde_json::json!({ "not_found": true }));
            }
            return Err(StoreError::Server(format!(
                "dropbox {route} failed with status {status}"
            )));
        }
        Ok(value)
    }

    async fn content_post(
        &self,
        route: &str,
        arg: serde_json::Value,
        body: reqwest::Body,
    ) -> StoreResult<(reqwest::StatusCode, Vec<u8>)> {
        let response = self
            .http
            .post(format!("{}/files/{route}", self.content_base))
            .bearer_auth(&self.token)
            .header("Dropbox-API-Arg", arg_header(&arg))
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .body(body)
            .send()
            .await
            .map_err(|error| StoreError::Network(error.to_string()))?;
        let status = response.status();
        let bytes = self.read_capped(response, MAX_SMALL_BYTES).await?;
        Ok((status, bytes))
    }

    fn check(
        route: &str,
        status: reqwest::StatusCode,
        bytes: &[u8],
    ) -> StoreResult<Option<serde_json::Value>> {
        if status.as_u16() == 401 {
            return Err(StoreError::Revoked);
        }
        let value: serde_json::Value = serde_json::from_slice(bytes).unwrap_or_default();
        if status.is_success() {
            return Ok(Some(value));
        }
        if is_not_found(status, &value) {
            return Ok(None);
        }
        Err(StoreError::Server(format!(
            "dropbox {route} failed with status {status}"
        )))
    }

    async fn upload_bytes(&self, remote: &str, bytes: Vec<u8>) -> StoreResult<()> {
        let (status, body) = self
            .content_post(
                "upload",
                serde_json::json!({"path": remote, "mode": "overwrite", "mute": true, "strict_conflict": false}),
                reqwest::Body::from(bytes),
            )
            .await?;
        Self::check("upload", status, &body)?;
        Ok(())
    }

    async fn upload_session(&self, remote: &str, local: &Path, len: u64) -> StoreResult<()> {
        let mut file =
            std::fs::File::open(local).map_err(|error| StoreError::Io(error.to_string()))?;
        let read_chunk =
            |file: &mut std::fs::File, offset: u64, take: u64| -> StoreResult<Vec<u8>> {
                file.seek(SeekFrom::Start(offset))
                    .map_err(|error| StoreError::Io(error.to_string()))?;
                let mut buffer = vec![0_u8; usize::try_from(take).unwrap_or(usize::MAX)];
                file.read_exact(&mut buffer)
                    .map_err(|error| StoreError::Io(error.to_string()))?;
                Ok(buffer)
            };
        let first_take = SESSION_CHUNK.min(len);
        let (status, body) = self
            .content_post(
                "upload_session/start",
                serde_json::json!({"close": false}),
                reqwest::Body::from(read_chunk(&mut file, 0, first_take)?),
            )
            .await?;
        let started = Self::check("upload_session/start", status, &body)?
            .ok_or_else(|| StoreError::Server("dropbox upload session start was refused".into()))?;
        let session_id = started
            .get("session_id")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                StoreError::Server("dropbox upload session reply was unreadable".into())
            })?
            .to_string();
        let mut offset = first_take;
        while len - offset > SESSION_CHUNK {
            let (status, body) = self
                .content_post(
                    "upload_session/append_v2",
                    serde_json::json!({"cursor": {"session_id": session_id, "offset": offset}, "close": false}),
                    reqwest::Body::from(read_chunk(&mut file, offset, SESSION_CHUNK)?),
                )
                .await?;
            Self::check("upload_session/append_v2", status, &body)?;
            offset += SESSION_CHUNK;
        }
        let (status, body) = self
            .content_post(
                "upload_session/finish",
                serde_json::json!({
                    "cursor": {"session_id": session_id, "offset": offset},
                    "commit": {"path": remote, "mode": "overwrite", "mute": true, "strict_conflict": false}
                }),
                reqwest::Body::from(read_chunk(&mut file, offset, len - offset)?),
            )
            .await?;
        Self::check("upload_session/finish", status, &body)?;
        Ok(())
    }
}

impl CloudStore for DropboxStore {
    async fn get(&self, remote: &str) -> StoreResult<Option<Vec<u8>>> {
        let response = self
            .http
            .post(format!("{}/files/download", self.content_base))
            .bearer_auth(&self.token)
            .header(
                "Dropbox-API-Arg",
                arg_header(&serde_json::json!({"path": remote})),
            )
            .send()
            .await
            .map_err(|error| StoreError::Network(error.to_string()))?;
        let status = response.status();
        if status.as_u16() == 401 {
            return Err(StoreError::Revoked);
        }
        if status.as_u16() == 409 {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(StoreError::Server(format!(
                "dropbox download failed with status {status}"
            )));
        }
        Ok(Some(self.read_capped(response, MAX_SMALL_BYTES).await?))
    }

    async fn get_to_path(&self, remote: &str, local: &Path) -> StoreResult<bool> {
        let mut response = self
            .http
            .post(format!("{}/files/download", self.content_base))
            .bearer_auth(&self.token)
            .header(
                "Dropbox-API-Arg",
                arg_header(&serde_json::json!({"path": remote})),
            )
            .send()
            .await
            .map_err(|error| StoreError::Network(error.to_string()))?;
        let status = response.status();
        if status.as_u16() == 401 {
            return Err(StoreError::Revoked);
        }
        if status.as_u16() == 409 {
            return Ok(false);
        }
        if !status.is_success() {
            return Err(StoreError::Server(format!(
                "dropbox download failed with status {status}"
            )));
        }
        let parent = local
            .parent()
            .ok_or_else(|| StoreError::Io("download path has no parent".into()))?;
        std::fs::create_dir_all(parent).map_err(|error| StoreError::Io(error.to_string()))?;
        let temp = parent.join(format!(".{}.oleafly-cloud.tmp", std::process::id()));
        let write = async {
            let mut out =
                std::fs::File::create(&temp).map_err(|error| StoreError::Io(error.to_string()))?;
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|error| StoreError::Network(error.to_string()))?
            {
                out.write_all(&chunk)
                    .map_err(|error| StoreError::Io(error.to_string()))?;
            }
            out.sync_all()
                .map_err(|error| StoreError::Io(error.to_string()))?;
            Ok::<(), StoreError>(())
        }
        .await;
        if let Err(error) = write {
            let _ = std::fs::remove_file(&temp);
            return Err(error);
        }
        std::fs::rename(&temp, local).map_err(|error| {
            let _ = std::fs::remove_file(&temp);
            StoreError::Io(error.to_string())
        })?;
        Ok(true)
    }

    async fn put(&self, remote: &str, bytes: Vec<u8>) -> StoreResult<()> {
        self.upload_bytes(remote, bytes).await
    }

    async fn put_path(&self, remote: &str, local: &Path) -> StoreResult<()> {
        let len = std::fs::metadata(local)
            .map_err(|error| StoreError::Io(error.to_string()))?
            .len();
        if len <= SINGLE_UPLOAD_LIMIT {
            let bytes = std::fs::read(local).map_err(|error| StoreError::Io(error.to_string()))?;
            return self.upload_bytes(remote, bytes).await;
        }
        self.upload_session(remote, local, len).await
    }

    async fn delete(&self, remote: &str) -> StoreResult<()> {
        self.rpc("delete_v2", serde_json::json!({"path": remote}))
            .await?;
        Ok(())
    }

    async fn list(&self, remote_dir: &str) -> StoreResult<Vec<RemoteEntry>> {
        let mut page = self
            .rpc(
                "list_folder",
                serde_json::json!({"path": remote_dir, "recursive": false, "limit": 2000}),
            )
            .await?;
        if page.get("not_found").and_then(serde_json::Value::as_bool) == Some(true) {
            return Ok(Vec::new());
        }
        let mut entries = Vec::new();
        loop {
            if let Some(list) = page.get("entries").and_then(serde_json::Value::as_array) {
                for entry in list {
                    let Some(name) = entry.get("name").and_then(serde_json::Value::as_str) else {
                        continue;
                    };
                    let tag = entry
                        .get(".tag")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    if tag == "deleted" {
                        continue;
                    }
                    entries.push(RemoteEntry {
                        name: name.to_string(),
                        folder: tag == "folder",
                    });
                }
            }
            if page.get("has_more").and_then(serde_json::Value::as_bool) != Some(true) {
                break;
            }
            let cursor = page
                .get("cursor")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| StoreError::Server("dropbox list reply was unreadable".into()))?
                .to_string();
            page = self
                .rpc(
                    "list_folder/continue",
                    serde_json::json!({"cursor": cursor}),
                )
                .await?;
        }
        Ok(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::arg_header;

    #[test]
    fn api_arg_escapes_non_ascii_for_the_header() {
        let value = serde_json::json!({"path": "/projects/x/files/café.tex"});
        let header = arg_header(&value);
        assert!(header.is_ascii());
        assert!(header.contains("\\u00e9"));
    }
}
