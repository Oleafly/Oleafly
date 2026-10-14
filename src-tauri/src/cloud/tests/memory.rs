use crate::cloud::store::{
    Changes, CloudStore, Fetched, RemoteEntry, RemoteMeta, StoreError, StoreResult, Uploaded,
    WriteMode,
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
    history: BTreeMap<String, Vec<u8>>,
    next_rev: u64,
    log: Vec<String>,
    pub(crate) rejected: BTreeSet<String>,
    pub(crate) quota: Option<u64>,
    pub(crate) race_next_version: bool,
    pub(crate) offline: bool,
    pub(crate) calls: usize,
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

    fn write(&mut self, path: &str, bytes: Vec<u8>) -> String {
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
            rev.and_then(|rev| inner.history.get(rev).cloned())
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

    async fn put(&self, remote: &str, bytes: Vec<u8>, mode: WriteMode) -> StoreResult<String> {
        self.enter()?;
        self.with(|inner| {
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

    async fn delete(&self, remote: &str) -> StoreResult<()> {
        self.enter()?;
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
