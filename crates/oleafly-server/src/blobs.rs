use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use ring::digest::{digest, SHA256};

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

pub struct BlobStore {
    root: PathBuf,
}

impl BlobStore {
    pub fn new(data_dir: &Path) -> BlobStore {
        BlobStore {
            root: data_dir.join("blobs"),
        }
    }

    fn path_of(&self, hash: &str) -> PathBuf {
        self.root.join(&hash[..2]).join(hash)
    }

    pub fn put(&self, hash: &str, bytes: &[u8]) -> Result<(), ServerError> {
        if !valid_hash(hash) {
            return Err(ServerError::BadRequest(
                "A file hash must be 64 lowercase hex digits.".to_string(),
            ));
        }
        if sha256_hex(bytes) != hash {
            return Err(ServerError::BadRequest(
                "The file does not match its hash.".to_string(),
            ));
        }
        let target = self.path_of(hash);
        if target.exists() {
            return Ok(());
        }
        write_atomically(&target, bytes)
    }

    pub fn get(&self, hash: &str) -> Result<Option<Vec<u8>>, ServerError> {
        if !valid_hash(hash) {
            return Ok(None);
        }
        match fs::read(self.path_of(hash)) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(ServerError::Internal(format!(
                "could not read a stored file: {error}"
            ))),
        }
    }

    pub fn remove(&self, hash: &str) -> Result<(), ServerError> {
        if !valid_hash(hash) {
            return Ok(());
        }
        match fs::remove_file(self.path_of(hash)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(ServerError::Internal(format!(
                "could not remove a stored file: {error}"
            ))),
        }
    }
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

    #[test]
    fn a_blob_is_stored_under_its_hash_and_read_back() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = BlobStore::new(dir.path());
        let hash = sha256_hex(b"figure bytes");
        store.put(&hash, b"figure bytes").expect("put");
        store
            .put(&hash, b"figure bytes")
            .expect("second put is a no-op");
        assert_eq!(
            store.get(&hash).expect("get"),
            Some(b"figure bytes".to_vec())
        );
        store.remove(&hash).expect("remove");
        assert_eq!(store.get(&hash).expect("get"), None);
    }

    #[test]
    fn bytes_that_do_not_match_their_hash_are_refused() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = BlobStore::new(dir.path());
        let hash = sha256_hex(b"one");
        assert!(matches!(
            store.put(&hash, b"two"),
            Err(ServerError::BadRequest(_))
        ));
        assert!(matches!(
            store.put("../../etc/passwd", b"x"),
            Err(ServerError::BadRequest(_))
        ));
        assert_eq!(store.get("../x").expect("get"), None);
    }
}
