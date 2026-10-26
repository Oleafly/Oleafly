use crate::cloud::store::{
    BatchCopy, Changes, CloudStore, Copied, DropboxContentHasher, Fetched, RemoteEntry, RemoteMeta,
    StoreError, StoreResult, Uploaded, WriteMode,
};
use oleafly_core::content::ContentHash;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::Mutex;

#[derive(Clone)]
struct Stored {
    path: String,
    bytes: Vec<u8>,
    rev: String,
}

#[derive(Default)]
pub(crate) struct Inner {
    files: BTreeMap<String, Stored>,
    pub(crate) history: BTreeMap<String, Vec<u8>>,
    next_rev: u64,
    log: Vec<String>,
    pub(crate) rejected: BTreeSet<String>,
    pub(crate) quota: Option<u64>,
    pub(crate) race_next_version: bool,
    pub(crate) offline: bool,
    pub(crate) calls: usize,
    pub(crate) upload_bytes: u64,
    pub(crate) downloads: usize,
    pub(crate) purged: BTreeSet<String>,
    pub(crate) zips: usize,
    pub(crate) broken_zip: bool,
    pub(crate) copies: usize,
    pub(crate) corrupt_copies: bool,
}

#[derive(Default)]
pub(crate) struct MemoryStore {
    pub(crate) inner: Mutex<Inner>,
}

impl Inner {
    fn used(&self) -> u64 {
        self.files
            .values()
            .map(|stored| stored.bytes.len() as u64)
            .sum()
    }

    pub(crate) fn write(&mut self, path: &str, bytes: Vec<u8>) -> String {
        self.next_rev += 1;
        let rev = format!("{:012x}", 0x0a00_0000_0000_u64 + self.next_rev);
        self.history.insert(rev.clone(), bytes.clone());
        self.files.insert(
            path.to_lowercase(),
            Stored {
                path: path.to_string(),
                bytes,
                rev: rev.clone(),
            },
        );
        self.log.push(path.to_lowercase());
        rev
    }
}

pub(crate) fn zip_of(top: &str, entries: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    writer.add_directory(format!("{top}/"), options).unwrap();
    for (name, bytes) in entries {
        writer.start_file(format!("{top}/{name}"), options).unwrap();
        std::io::Write::write_all(&mut writer, bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

impl MemoryStore {
    pub(crate) fn with<T>(&self, change: impl FnOnce(&mut Inner) -> T) -> T {
        change(&mut self.inner.lock().unwrap())
    }

    pub(crate) fn read(&self, path: &str) -> Option<Vec<u8>> {
        self.with(|inner| {
            inner
                .files
                .get(&path.to_lowercase())
                .map(|stored| stored.bytes.clone())
        })
    }

    pub(crate) fn overwrite(&self, path: &str, bytes: &[u8]) {
        self.with(|inner| {
            inner.write(path, bytes.to_vec());
        });
    }

    pub(crate) fn remove(&self, path: &str) {
        self.with(|inner| {
            let lower = path.to_lowercase();
            let prefix = format!("{lower}/");
            inner
                .files
                .retain(|stored, _| stored != &lower && !stored.starts_with(&prefix));
            inner.log.push(lower);
        });
    }

    fn copy_one(&self, item: &BatchCopy) -> StoreResult<Copied> {
        self.enter()?;
        self.with(|inner| {
            inner.copies += 1;
            let source = inner
                .files
                .get(&item.from.to_lowercase())
                .cloned()
                .ok_or_else(|| StoreError::Server("from_lookup/not_found".into()))?;
            if inner.files.contains_key(&item.to.to_lowercase()) {
                return Err(StoreError::Conflict);
            }
            let bytes = if inner.corrupt_copies {
                b"changed while copying".to_vec()
            } else {
                source.bytes
            };
            let mut hasher = DropboxContentHasher::default();
            hasher.update(&bytes);
            let size = bytes.len() as u64;
            let rev = inner.write(&item.to, bytes);
            Ok(Copied {
                rev,
                size,
                content_hash: Some(hasher.finish()),
            })
        })
    }

    fn enter(&self) -> StoreResult<()> {
        self.with(|inner| {
            inner.calls += 1;
            if inner.offline {
                Err(StoreError::Network("offline".into()))
            } else {
                Ok(())
            }
        })
    }
}

impl CloudStore for MemoryStore {
    // Copies here report Dropbox's content hash, so they're checked the same way.
    async fn copy_check_hash(&self, local: &std::path::Path) -> Option<String> {
        crate::cloud::store::dropbox_hash_of(local).await
    }

    async fn get(&self, remote: &str, cap: usize) -> StoreResult<Option<(Vec<u8>, String)>> {
        self.enter()?;
        self.with(|inner| match inner.files.get(&remote.to_lowercase()) {
            Some(stored) if stored.bytes.len() > cap => {
                Err(StoreError::Server("dropbox response is too large".into()))
            }
            Some(stored) => Ok(Some((stored.bytes.clone(), stored.rev.clone()))),
            None => Ok(None),
        })
    }

    async fn metadata(&self, remote: &str) -> StoreResult<Option<RemoteMeta>> {
        self.enter()?;
        Ok(self.with(|inner| {
            inner
                .files
                .get(&remote.to_lowercase())
                .map(|stored| RemoteMeta {
                    rev: stored.rev.clone(),
                    size: stored.bytes.len() as u64,
                })
        }))
    }

    async fn fetch_to(
        &self,
        remote: &str,
        rev: Option<&str>,
        local: &Path,
        limit: u64,
    ) -> StoreResult<Option<Fetched>> {
        self.enter()?;
        let bytes = self.with(|inner| {
            inner.downloads += 1;
            rev.filter(|rev| !inner.purged.contains(*rev))
                .and_then(|rev| inner.history.get(rev).cloned())
                .or_else(|| {
                    inner
                        .files
                        .get(&remote.to_lowercase())
                        .map(|stored| stored.bytes.clone())
                })
        });
        let Some(bytes) = bytes else {
            return Ok(None);
        };
        if bytes.len() as u64 > limit {
            return Err(StoreError::Verify(
                "a file from dropbox is larger than its record".into(),
            ));
        }
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(local)
            .map_err(|error| StoreError::Io(error.to_string()))?;
        std::io::Write::write_all(&mut file, &bytes)
            .map_err(|error| StoreError::Io(error.to_string()))?;
        Ok(Some(Fetched {
            hash: ContentHash::digest(&bytes),
            size: bytes.len() as u64,
        }))
    }

    async fn fetch_zip(
        &self,
        remote_dir: &str,
        local: &Path,
        limit: u64,
        received: &(dyn Fn(u64) + Sync),
    ) -> StoreResult<bool> {
        self.enter()?;
        let prefix = format!("{}/", remote_dir.to_lowercase());
        let top = remote_dir.rsplit('/').next().unwrap_or_default();
        let (entries, broken) = self.with(|inner| {
            inner.zips += 1;
            let entries: Vec<(String, Vec<u8>)> = inner
                .files
                .values()
                .filter(|stored| stored.path.to_lowercase().starts_with(&prefix))
                .map(|stored| {
                    (
                        stored.path[prefix.len()..].to_string(),
                        stored.bytes.clone(),
                    )
                })
                .collect();
            (entries, inner.broken_zip)
        });
        if entries.is_empty() {
            return Ok(false);
        }
        let bytes = if broken {
            b"not a zip archive".to_vec()
        } else {
            zip_of(top, &entries)
        };
        if bytes.len() as u64 > limit {
            return Ok(false);
        }
        std::fs::write(local, &bytes).map_err(|error| StoreError::Io(error.to_string()))?;
        received(bytes.len() as u64);
        Ok(true)
    }

    async fn copy_paths(&self, items: &[BatchCopy]) -> Vec<StoreResult<Copied>> {
        items.iter().map(|item| self.copy_one(item)).collect()
    }

    async fn put(&self, remote: &str, bytes: Vec<u8>, mode: WriteMode) -> StoreResult<String> {
        self.enter()?;
        self.with(|inner| {
            if !remote.to_lowercase().ends_with("version.json") {
                inner.upload_bytes += bytes.len() as u64;
            }
            if inner.rejected.contains(remote) {
                return Err(StoreError::Rejected("path/disallowed_name/".into()));
            }
            let lower = remote.to_lowercase();
            if inner.race_next_version && lower.ends_with("version.json") {
                inner.race_next_version = false;
                if let Some(stored) = inner.files.get(&lower).cloned() {
                    inner.write(&stored.path, stored.bytes);
                }
            }
            let current = inner.files.get(&lower).map(|stored| stored.rev.clone());
            match (&mode, &current) {
                (WriteMode::Add, Some(_)) => return Err(StoreError::Conflict),
                (WriteMode::Update(expected), Some(current)) if expected != current => {
                    return Err(StoreError::Conflict)
                }
                (WriteMode::Update(_), None) => return Err(StoreError::Conflict),
                _ => {}
            }
            if let Some(quota) = inner.quota {
                let replaced = inner
                    .files
                    .get(&lower)
                    .map_or(0, |stored| stored.bytes.len() as u64);
                if inner.used() - replaced + bytes.len() as u64 > quota {
                    return Err(StoreError::QuotaFull);
                }
            }
            Ok(inner.write(remote, bytes))
        })
    }

    async fn put_path(&self, remote: &str, local: &Path) -> StoreResult<Uploaded> {
        let bytes = std::fs::read(local).map_err(|error| StoreError::Io(error.to_string()))?;
        let hash = ContentHash::digest(&bytes);
        let size = bytes.len() as u64;
        let rev = self.put(remote, bytes, WriteMode::Overwrite).await?;
        Ok(Uploaded { rev, hash, size })
    }

    async fn delete(&self, remote: &str, parent_rev: Option<&str>) -> StoreResult<()> {
        self.enter()?;
        let current = self.with(|inner| {
            inner
                .files
                .get(&remote.to_lowercase())
                .map(|stored| stored.rev.clone())
        });
        if parent_rev.is_some_and(|expected| current.as_deref().is_some_and(|rev| rev != expected))
        {
            return Ok(());
        }
        self.remove(remote);
        Ok(())
    }

    async fn list(&self, remote_dir: &str) -> StoreResult<Vec<RemoteEntry>> {
        self.enter()?;
        let prefix = format!("{}/", remote_dir.to_lowercase());
        let mut seen: Vec<RemoteEntry> = Vec::new();
        self.with(|inner| {
            for stored in inner.files.values() {
                let lower = stored.path.to_lowercase();
                if !lower.starts_with(&prefix) {
                    continue;
                }
                let rest = &stored.path[prefix.len()..];
                let (name, folder) = match rest.split_once('/') {
                    Some((head, _)) => (head.to_string(), true),
                    None => (rest.to_string(), false),
                };
                if !seen.iter().any(|entry| entry.name == name) {
                    seen.push(RemoteEntry { name, folder });
                }
            }
        });
        Ok(seen)
    }

    async fn latest_cursor(&self, _remote_dir: &str) -> StoreResult<Option<String>> {
        self.enter()?;
        Ok(Some(self.with(|inner| inner.log.len().to_string())))
    }

    async fn changes(&self, cursor: &str) -> StoreResult<Changes> {
        self.enter()?;
        let from: usize = cursor.parse().map_err(|_| StoreError::Reset)?;
        self.with(|inner| {
            if from > inner.log.len() {
                return Err(StoreError::Reset);
            }
            Ok(Changes {
                paths: inner.log[from..]
                    .iter()
                    .filter(|path| path.starts_with("/projects/"))
                    .cloned()
                    .collect(),
                cursor: inner.log.len().to_string(),
            })
        })
    }
}
