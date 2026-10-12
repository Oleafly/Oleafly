pub mod s3;
pub mod sigv4;

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Bytes;
use ring::digest::{digest, SHA256};

use crate::blobs::s3::{S3Blobs, S3Timeouts};
use crate::clock::{Clock, SystemClock};
use crate::config::{BlobStoreConfig, S3Config, ServerConfig};
use crate::error::ServerError;

pub fn sha256_hex(bytes: &[u8]) -> String {
    digest(&SHA256, bytes)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn valid_hash(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[derive(Clone)]
pub enum BlobStore {
    Filesystem(FilesystemBlobs),
    S3(S3Blobs),
}

#[derive(Clone)]
pub struct FilesystemBlobs {
    root: PathBuf,
}

impl BlobStore {
    pub fn filesystem(data_dir: &Path) -> BlobStore {
        BlobStore::Filesystem(FilesystemBlobs {
            root: data_dir.join("blobs"),
        })
    }

    pub fn s3(
        config: &S3Config,
        max_blob_bytes: u64,
        clock: Arc<dyn Clock>,
        timeouts: S3Timeouts,
    ) -> Result<BlobStore, ServerError> {
        Ok(BlobStore::S3(S3Blobs::new(
            config,
            max_blob_bytes,
            clock,
            timeouts,
        )?))
    }

    pub fn from_config(config: &ServerConfig) -> Result<BlobStore, ServerError> {
        match &config.blob_store {
            BlobStoreConfig::Filesystem => Ok(BlobStore::filesystem(&config.data_dir)),
            BlobStoreConfig::S3(s3) => BlobStore::s3(
                s3,
                config.limits.max_file_mb.saturating_mul(1024 * 1024),
                Arc::new(SystemClock),
                S3Timeouts::default(),
            ),
        }
    }

    pub async fn put(&self, hash: &str, bytes: Bytes) -> Result<(), ServerError> {
        if !valid_hash(hash) {
            return Err(ServerError::BadRequest(
                "A file hash must be 64 lowercase hex digits.".to_string(),
            ));
        }
        let expected = hash.to_string();
        let bytes = blocking(move || {
            if sha256_hex(&bytes) == expected {
                Ok(bytes)
            } else {
                Err(ServerError::BadRequest(
                    "The file does not match its hash.".to_string(),
                ))
            }
        })
        .await?;
        match self {
            BlobStore::Filesystem(store) => {
                let store = store.clone();
                let hash = hash.to_string();
                blocking(move || store.put(&hash, &bytes)).await
            }
            BlobStore::S3(store) => store.put(hash, bytes).await,
        }
    }

    pub async fn get(&self, hash: &str) -> Result<Option<Bytes>, ServerError> {
        if !valid_hash(hash) {
            return Ok(None);
        }
        let found = match self {
            BlobStore::Filesystem(store) => {
                let store = store.clone();
                let hash = hash.to_string();
                blocking(move || store.get(&hash)).await?
            }
            BlobStore::S3(store) => store.get(hash).await?,
        };
        let Some(bytes) = found else {
            return Ok(None);
        };
        let expected = hash.to_string();
        blocking(move || {
            if sha256_hex(&bytes) == expected {
                Ok(Some(bytes))
            } else {
                Err(ServerError::Internal(format!(
                    "the stored file {expected} does not match its hash"
                )))
            }
        })
        .await
    }

    pub async fn remove(&self, hash: &str) -> Result<(), ServerError> {
        if !valid_hash(hash) {
            return Ok(());
        }
        match self {
            BlobStore::Filesystem(store) => {
                let store = store.clone();
                let hash = hash.to_string();
                blocking(move || store.remove(&hash)).await
            }
            BlobStore::S3(store) => store.remove(hash).await,
        }
    }
}

impl FilesystemBlobs {
    fn path_of(&self, hash: &str) -> PathBuf {
        self.root.join(&hash[..2]).join(hash)
    }

    fn put(&self, hash: &str, bytes: &[u8]) -> Result<(), ServerError> {
        let target = self.path_of(hash);
        if target.exists() {
            return Ok(());
        }
        write_atomically(&target, bytes)
    }

    fn get(&self, hash: &str) -> Result<Option<Bytes>, ServerError> {
        match fs::read(self.path_of(hash)) {
            Ok(bytes) => Ok(Some(Bytes::from(bytes))),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(ServerError::Internal(format!(
                "could not read a stored file: {error}"
            ))),
        }
    }

    fn remove(&self, hash: &str) -> Result<(), ServerError> {
        match fs::remove_file(self.path_of(hash)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(ServerError::Internal(format!(
                "could not remove a stored file: {error}"
            ))),
        }
    }
}

async fn blocking<T, F>(task: F) -> Result<T, ServerError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, ServerError> + Send + 'static,
{
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|error| ServerError::Internal(format!("a file storage task failed: {error}")))?
}

pub fn write_atomically(target: &Path, bytes: &[u8]) -> Result<(), ServerError> {
    let internal =
        |error: std::io::Error| ServerError::Internal(format!("could not store a file: {error}"));
    let parent = target
        .parent()
        .ok_or_else(|| ServerError::Internal("a stored file has no parent folder".to_string()))?;
    fs::create_dir_all(parent).map_err(internal)?;
    let temporary = parent.join(format!(
        ".{}.{}",
        target
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
        crate::tokens::random_token()
    ));
    let mut file = fs::File::create(&temporary).map_err(internal)?;
    file.write_all(bytes).map_err(internal)?;
    file.sync_all().map_err(internal)?;
    drop(file);
    fs::rename(&temporary, target).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        internal(error)
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::MockS3;

    async fn keeps_files_under_their_hash(store: &BlobStore) {
        let hash = sha256_hex(b"figure bytes");
        store
            .put(&hash, Bytes::from_static(b"figure bytes"))
            .await
            .expect("put");
        store
            .put(&hash, Bytes::from_static(b"figure bytes"))
            .await
            .expect("second put is a no-op");
        assert_eq!(
            store.get(&hash).await.expect("get"),
            Some(Bytes::from_static(b"figure bytes"))
        );
        store.remove(&hash).await.expect("remove");
        assert_eq!(store.get(&hash).await.expect("get"), None);
        store
            .remove(&hash)
            .await
            .expect("removing a missing file is fine");
    }

    async fn refuses_bytes_that_do_not_match_their_hash(store: &BlobStore) {
        let hash = sha256_hex(b"one");
        assert!(matches!(
            store.put(&hash, Bytes::from_static(b"two")).await,
            Err(ServerError::BadRequest(_))
        ));
        assert!(matches!(
            store
                .put("../../etc/passwd", Bytes::from_static(b"x"))
                .await,
            Err(ServerError::BadRequest(_))
        ));
        assert_eq!(store.get("../x").await.expect("get"), None);
        store.remove("../x").await.expect("remove");
        assert_eq!(store.get(&hash).await.expect("nothing was stored"), None);
    }

    #[tokio::test]
    async fn the_filesystem_store_keeps_files_under_their_hash() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = BlobStore::filesystem(dir.path());
        keeps_files_under_their_hash(&store).await;
        refuses_bytes_that_do_not_match_their_hash(&store).await;
    }

    #[tokio::test]
    async fn the_s3_store_keeps_files_under_their_hash() {
        let mock = MockS3::start().await;
        let store = mock.store("oleafly");
        keeps_files_under_their_hash(&store).await;
        refuses_bytes_that_do_not_match_their_hash(&store).await;
        assert!(mock.keys().is_empty());
        assert_eq!(mock.rejections(), Vec::<String>::new());
    }

    #[tokio::test]
    async fn a_file_changed_on_disk_is_an_error_rather_than_a_download() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = BlobStore::filesystem(dir.path());
        let hash = sha256_hex(b"figure bytes");
        store
            .put(&hash, Bytes::from_static(b"figure bytes"))
            .await
            .expect("put");
        fs::write(
            dir.path().join("blobs").join(&hash[..2]).join(&hash),
            b"changed",
        )
        .expect("overwrite");
        match store.get(&hash).await {
            Err(ServerError::Internal(detail)) => assert!(detail.contains("does not match")),
            other => panic!("expected an internal error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn the_configured_store_is_the_one_built() {
        let mut config = crate::test_support::test_config();
        assert!(matches!(
            BlobStore::from_config(&config),
            Ok(BlobStore::Filesystem(_))
        ));
        config.blob_store = BlobStoreConfig::S3(Box::new(S3Config {
            bucket: "lab-bucket".to_string(),
            prefix: String::new(),
            endpoint: None,
            region: "us-east-1".to_string(),
            access_key_id: "AKIDEXAMPLE".to_string(),
            secret_access_key: "secret".to_string(),
        }));
        assert!(matches!(
            BlobStore::from_config(&config),
            Ok(BlobStore::S3(_))
        ));
    }
}
