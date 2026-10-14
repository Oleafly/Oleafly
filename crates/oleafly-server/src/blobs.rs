pub mod cleanup;
pub mod s3;
pub mod sigv4;

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Bytes;
use oleafly_collab_protocol::ids::SharedProjectId;
use ring::digest::{digest, SHA256};
use tokio::sync::{Mutex, MutexGuard};

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

pub const SNAPSHOT_FOLDER: &str = "snapshots";
const LOCK_STRIPES: usize = 256;

pub fn snapshot_key(project: SharedProjectId, hash: &str) -> String {
    format!("{SNAPSHOT_FOLDER}/{project}/{hash}")
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
    locks: Arc<[Mutex<()>]>,
}

pub(crate) fn lock_stripes() -> Arc<[Mutex<()>]> {
    (0..LOCK_STRIPES).map(|_| Mutex::new(())).collect()
}

fn stripe_of(hash: &str, stripes: usize) -> usize {
    let prefix = hash.get(..4).unwrap_or(hash);
    usize::from_str_radix(prefix, 16).unwrap_or(0) % stripes.max(1)
}

impl BlobStore {
    pub fn filesystem(data_dir: &Path) -> BlobStore {
        BlobStore::Filesystem(FilesystemBlobs {
            root: data_dir.join("blobs"),
            locks: lock_stripes(),
        })
    }

    pub async fn hold(&self, hash: &str) -> MutexGuard<'_, ()> {
        let locks = match self {
            BlobStore::Filesystem(store) => &store.locks,
            BlobStore::S3(store) => store.locks(),
        };
        locks[stripe_of(hash, locks.len())].lock().await
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
            BlobStoreConfig::S3(s3) => Ok(BlobStore::s3(
                s3,
                config.limits.max_file_mb.saturating_mul(1024 * 1024),
                Arc::new(SystemClock),
                S3Timeouts::default(),
            )?
            .with_snapshot_limit(config.limits.max_project_mb.saturating_mul(1024 * 1024))),
        }
    }

    pub fn with_snapshot_limit(self, bytes: u64) -> BlobStore {
        match self {
            BlobStore::S3(store) => BlobStore::S3(store.with_snapshot_limit(bytes)),
            other => other,
        }
    }

    pub fn is_s3(&self) -> bool {
        matches!(self, BlobStore::S3(_))
    }

    pub async fn probe(&self) -> Result<(), ServerError> {
        match self {
            BlobStore::Filesystem(_) => Ok(()),
            BlobStore::S3(store) => store.probe().await,
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
        verified(hash, "file", found).await
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

    pub async fn put_snapshot(
        &self,
        project: SharedProjectId,
        bytes: Bytes,
    ) -> Result<String, ServerError> {
        let (hash, bytes) = blocking(move || Ok((sha256_hex(&bytes), bytes))).await?;
        self.put_snapshot_as(project, &hash, bytes).await?;
        Ok(hash)
    }

    pub async fn put_snapshot_as(
        &self,
        project: SharedProjectId,
        hash: &str,
        bytes: Bytes,
    ) -> Result<(), ServerError> {
        if !valid_hash(hash) {
            return Err(ServerError::Internal(format!(
                "{hash} is not a snapshot hash"
            )));
        }
        match self {
            BlobStore::Filesystem(store) => {
                let target = store.snapshot_path(project, hash);
                blocking(move || write_atomically(&target, &bytes)).await
            }
            BlobStore::S3(store) => store.put_snapshot(project, hash, bytes).await,
        }
    }

    pub async fn get_snapshot(
        &self,
        project: SharedProjectId,
        hash: &str,
    ) -> Result<Option<Bytes>, ServerError> {
        if !valid_hash(hash) {
            return Ok(None);
        }
        let found = match self {
            BlobStore::Filesystem(store) => {
                let path = store.snapshot_path(project, hash);
                blocking(move || read_file(&path)).await?
            }
            BlobStore::S3(store) => store.get_snapshot(project, hash).await?,
        };
        verified(hash, "snapshot", found).await
    }

    pub async fn snapshot_size(
        &self,
        project: SharedProjectId,
        hash: &str,
    ) -> Result<Option<u64>, ServerError> {
        if !valid_hash(hash) {
            return Ok(None);
        }
        match self {
            BlobStore::Filesystem(store) => {
                let path = store.snapshot_path(project, hash);
                blocking(move || file_size(&path)).await
            }
            BlobStore::S3(store) => store.snapshot_size(project, hash).await,
        }
    }

    pub async fn remove_snapshot(
        &self,
        project: SharedProjectId,
        hash: &str,
    ) -> Result<(), ServerError> {
        if !valid_hash(hash) {
            return Ok(());
        }
        match self {
            BlobStore::Filesystem(store) => {
                let path = store.snapshot_path(project, hash);
                blocking(move || remove_file_and_empty_folder(&path)).await
            }
            BlobStore::S3(store) => store.remove_snapshot(project, hash).await,
        }
    }
}

async fn verified(
    hash: &str,
    kind: &'static str,
    found: Option<Bytes>,
) -> Result<Option<Bytes>, ServerError> {
    let Some(bytes) = found else {
        return Ok(None);
    };
    let expected = hash.to_string();
    blocking(move || {
        if sha256_hex(&bytes) == expected {
            Ok(Some(bytes))
        } else {
            Err(ServerError::Internal(format!(
                "the stored {kind} {expected} does not match its hash"
            )))
        }
    })
    .await
}

impl FilesystemBlobs {
    fn path_of(&self, hash: &str) -> PathBuf {
        self.root.join(&hash[..2]).join(hash)
    }

    fn snapshot_path(&self, project: SharedProjectId, hash: &str) -> PathBuf {
        self.root
            .join(SNAPSHOT_FOLDER)
            .join(project.to_string())
            .join(hash)
    }

    fn put(&self, hash: &str, bytes: &[u8]) -> Result<(), ServerError> {
        let target = self.path_of(hash);
        if target.exists() {
            return Ok(());
        }
        write_atomically(&target, bytes)
    }

    fn get(&self, hash: &str) -> Result<Option<Bytes>, ServerError> {
        read_file(&self.path_of(hash))
    }

    fn remove(&self, hash: &str) -> Result<(), ServerError> {
        remove_file(&self.path_of(hash))
    }
}

fn read_file(path: &Path) -> Result<Option<Bytes>, ServerError> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(Bytes::from(bytes))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(ServerError::Internal(format!(
            "could not read a stored file: {error}"
        ))),
    }
}

fn file_size(path: &Path) -> Result<Option<u64>, ServerError> {
    match fs::metadata(path) {
        Ok(found) => Ok(Some(found.len())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(ServerError::Internal(format!(
            "could not read a stored file: {error}"
        ))),
    }
}

fn remove_file_and_empty_folder(path: &Path) -> Result<(), ServerError> {
    remove_file(path)?;
    if let Some(folder) = path.parent() {
        let _ = fs::remove_dir(folder);
    }
    Ok(())
}

fn remove_file(path: &Path) -> Result<(), ServerError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ServerError::Internal(format!(
            "could not remove a stored file: {error}"
        ))),
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

    async fn keeps_snapshots_under_their_project(store: &BlobStore) -> (SharedProjectId, String) {
        let project = SharedProjectId::new_v7();
        let other = SharedProjectId::new_v7();
        let hash = store
            .put_snapshot(project, Bytes::from_static(b"project state"))
            .await
            .expect("put");
        assert_eq!(hash, sha256_hex(b"project state"));
        assert_eq!(
            store
                .put_snapshot(project, Bytes::from_static(b"project state"))
                .await
                .expect("a second put of the same bytes is fine"),
            hash
        );
        assert_eq!(
            store.get_snapshot(project, &hash).await.expect("get"),
            Some(Bytes::from_static(b"project state"))
        );
        assert_eq!(store.get_snapshot(other, &hash).await.expect("get"), None);
        assert_eq!(
            store.get(&hash).await.expect("a snapshot is not a file"),
            None
        );
        assert_eq!(
            store.get_snapshot(project, "../x").await.expect("get"),
            None
        );
        store
            .remove_snapshot(project, "../x")
            .await
            .expect("remove");
        let kept = store
            .put_snapshot(project, Bytes::from_static(b"kept state"))
            .await
            .expect("put");
        store.remove_snapshot(project, &hash).await.expect("remove");
        assert_eq!(store.get_snapshot(project, &hash).await.expect("get"), None);
        store
            .remove_snapshot(project, &hash)
            .await
            .expect("removing a missing snapshot is fine");
        (project, kept)
    }

    #[tokio::test]
    async fn the_filesystem_store_keeps_snapshots_apart_from_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = BlobStore::filesystem(dir.path());
        let (project, kept) = keeps_snapshots_under_their_project(&store).await;
        assert_eq!(
            fs::read(
                dir.path()
                    .join("blobs")
                    .join("snapshots")
                    .join(project.to_string())
                    .join(&kept)
            )
            .expect("the snapshot is under blobs/snapshots/<project>"),
            b"kept state"
        );
    }

    #[tokio::test]
    async fn the_s3_store_keeps_snapshots_apart_from_files() {
        let mock = MockS3::start().await;
        let store = mock.store("oleafly");
        let (project, kept) = keeps_snapshots_under_their_project(&store).await;
        assert_eq!(
            mock.keys(),
            vec![format!("oleafly/snapshots/{project}/{kept}")]
        );
        assert_eq!(
            snapshot_key(project, &kept),
            format!("snapshots/{project}/{kept}")
        );
        assert_eq!(mock.rejections(), Vec::<String>::new());
    }

    #[tokio::test]
    async fn a_snapshot_changed_in_either_store_is_an_error_rather_than_a_download() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mock = MockS3::start().await;
        for store in [BlobStore::filesystem(dir.path()), mock.store("")] {
            let project = SharedProjectId::new_v7();
            let hash = store
                .put_snapshot(project, Bytes::from_static(b"project state"))
                .await
                .expect("put");
            match &store {
                BlobStore::Filesystem(_) => fs::write(
                    dir.path().join("blobs").join(snapshot_key(project, &hash)),
                    b"tampered",
                )
                .expect("overwrite"),
                BlobStore::S3(_) => mock.insert_object(&snapshot_key(project, &hash), b"tampered"),
            }
            match store.get_snapshot(project, &hash).await {
                Err(ServerError::Internal(detail)) => assert!(detail.contains("does not match")),
                other => panic!("expected an internal error, got {other:?}"),
            }
        }
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
