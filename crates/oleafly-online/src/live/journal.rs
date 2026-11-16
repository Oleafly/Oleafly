#[cfg(test)]
mod tests;

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use oleafly_ot::TextOperation;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{DocId, PublicId};
use crate::error::{OnlineError, OnlineErrorKind};

pub const LIVE_DIR: &str = "overleaf-live";
pub const SCHEMA: u64 = 1;
pub const WRITE_EVERY: Duration = Duration::from_millis(250);
const MANIFEST: &str = "project.json";
const LOCK: &str = "lock";
const KEPT: &str = "kept";
const FOLDER_LOCK: [&str; 3] = [".oleafly", "online", "live.lock"];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectManifest {
    pub schema: u64,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub user_email: String,
    #[serde(default)]
    pub history_version: Option<u64>,
    #[serde(default)]
    pub paused: bool,
    #[serde(default)]
    pub kept_away: Vec<String>,
}

impl Default for ProjectManifest {
    fn default() -> ProjectManifest {
        ProjectManifest {
            schema: SCHEMA,
            user_id: String::new(),
            user_email: String::new(),
            history_version: None,
            paused: false,
            kept_away: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct InflightRecord {
    pub op: TextOperation,
    #[serde(default)]
    pub raw: Option<Value>,
    #[serde(default)]
    pub tracked_by: Option<String>,
    pub public_ids: Vec<PublicId>,
    pub base_version: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DocRecord {
    pub schema: u64,
    pub format: String,
    pub base_text: String,
    #[serde(default)]
    pub base_raw: Option<Value>,
    pub base_version: u64,
    pub local_text: String,
    #[serde(default)]
    pub inflight: Option<InflightRecord>,
    #[serde(default)]
    pub provisional: bool,
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum JournalError {
    #[error("this project is live in another Oleafly window")]
    Busy,
    #[error("the journal location is not usable: {0}")]
    Invalid(String),
    #[error("the journal could not be read or written: {0}")]
    Io(String),
}

impl From<JournalError> for OnlineError {
    fn from(error: JournalError) -> OnlineError {
        let kind = match error {
            JournalError::Busy => OnlineErrorKind::LiveElsewhere,
            JournalError::Invalid(_) | JournalError::Io(_) => OnlineErrorKind::Io,
        };
        OnlineError::new(kind).detail(error)
    }
}

impl From<io::Error> for JournalError {
    fn from(error: io::Error) -> JournalError {
        JournalError::Io(error.to_string())
    }
}

#[derive(Debug)]
pub struct Journal {
    dir: PathBuf,
    _lock: File,
    _folder_lock: Option<File>,
    manifest: ProjectManifest,
    docs: BTreeMap<DocId, DocRecord>,
    kept: Vec<PathBuf>,
    dirty_docs: BTreeSet<DocId>,
    dirty_manifest: bool,
}

pub fn origin_dir(base: &str) -> Result<String, JournalError> {
    let parsed = url::Url::parse(base).map_err(|error| JournalError::Invalid(error.to_string()))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| JournalError::Invalid(format!("{base} has no host")))?;
    let mut origin = format!("{}_{host}", parsed.scheme());
    if let Some(port) = parsed.port() {
        origin.push_str(&format!("_{port}"));
    }
    Ok(origin
        .chars()
        .map(|character| match character {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' => character,
            _ => '_',
        })
        .collect())
}

fn plain_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

pub fn journal_dir(
    data_root: &Path,
    base: &str,
    project_id: &str,
) -> Result<PathBuf, JournalError> {
    if !plain_id(project_id) {
        return Err(JournalError::Invalid(format!(
            "invalid project id {project_id}"
        )));
    }
    Ok(data_root
        .join(LIVE_DIR)
        .join(origin_dir(base)?)
        .join(project_id))
}

fn take_lock(path: &Path) -> Result<File, JournalError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(path)?;
    match oleafly_core::locking::lock_file(&file, true, Duration::ZERO) {
        Ok(()) => Ok(file),
        Err(error) if error.kind() == io::ErrorKind::TimedOut => Err(JournalError::Busy),
        Err(error) => Err(error.into()),
    }
}

fn folder_lock(folder: &Path) -> PathBuf {
    FOLDER_LOCK
        .iter()
        .fold(folder.to_path_buf(), |path, part| path.join(part))
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<(u64, Option<T>)> {
    let bytes = std::fs::read(path).ok()?;
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let schema = value.get("schema").and_then(Value::as_u64).unwrap_or(0);
    Some((schema, serde_json::from_value(value).ok()))
}

impl Journal {
    pub fn open(
        data_root: &Path,
        base: &str,
        project_id: &str,
        folder: Option<&Path>,
    ) -> Result<Journal, JournalError> {
        let dir = journal_dir(data_root, base, project_id)?;
        if let Some(folder) = folder {
            if dir.starts_with(folder) {
                return Err(JournalError::Invalid(
                    "the journal would be inside the project".into(),
                ));
            }
        }
        std::fs::create_dir_all(&dir)?;
        let lock = take_lock(&dir.join(LOCK))?;
        let folder_lock = folder
            .map(|folder| take_lock(&folder_lock(folder)))
            .transpose()?;
        let mut journal = Journal {
            dir,
            _lock: lock,
            _folder_lock: folder_lock,
            manifest: ProjectManifest::default(),
            docs: BTreeMap::new(),
            kept: Vec::new(),
            dirty_docs: BTreeSet::new(),
            dirty_manifest: false,
        };
        journal.load()?;
        Ok(journal)
    }

    fn load(&mut self) -> Result<(), JournalError> {
        let manifest = self.dir.join(MANIFEST);
        match read_json::<ProjectManifest>(&manifest) {
            Some((SCHEMA, Some(found))) => self.manifest = found,
            Some(_) => self.keep(&manifest)?,
            None => {}
        }
        for entry in std::fs::read_dir(&self.dir)? {
            let path = entry?.path();
            let Some(doc) = doc_of(&path) else {
                continue;
            };
            match read_json::<DocRecord>(&path) {
                Some((SCHEMA, Some(record))) => {
                    self.docs.insert(doc, record);
                }
                Some(_) => self.keep(&path)?,
                None => {}
            }
        }
        Ok(())
    }

    fn keep(&mut self, path: &Path) -> Result<(), JournalError> {
        let kept = self.dir.join(KEPT);
        std::fs::create_dir_all(&kept)?;
        let name = path.file_name().unwrap_or_default();
        let target = kept.join(name);
        std::fs::rename(path, &target)?;
        self.kept.push(target);
        Ok(())
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn manifest(&self) -> &ProjectManifest {
        &self.manifest
    }

    pub fn set_manifest(&mut self, manifest: ProjectManifest) {
        if manifest != self.manifest {
            self.manifest = manifest;
            self.dirty_manifest = true;
        }
    }

    pub fn docs(&self) -> &BTreeMap<DocId, DocRecord> {
        &self.docs
    }

    pub fn kept(&self) -> &[PathBuf] {
        &self.kept
    }

    pub fn put(&mut self, doc: &DocId, record: Option<DocRecord>) {
        let changed = match &record {
            Some(record) => self.docs.get(doc) != Some(record),
            None => self.docs.contains_key(doc),
        };
        if !changed {
            return;
        }
        match record {
            Some(record) => self.docs.insert(doc.clone(), record),
            None => self.docs.remove(doc),
        };
        self.dirty_docs.insert(doc.clone());
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty_manifest || !self.dirty_docs.is_empty()
    }

    pub fn flush(&mut self) -> Result<(), String> {
        if self.dirty_manifest {
            write_json(&self.dir.join(MANIFEST), &self.manifest)?;
            self.dirty_manifest = false;
        }
        while let Some(doc) = self.dirty_docs.first().cloned() {
            let path = self.dir.join(format!("{}.json", doc.0));
            match self.docs.get(&doc) {
                Some(record) => write_json(&path, record)?,
                None => remove(&path)?,
            }
            self.dirty_docs.remove(&doc);
        }
        Ok(())
    }
}

pub fn unsent_on(data_root: &Path, base: &str) -> Vec<(String, Vec<String>)> {
    let Ok(origin) = origin_dir(base) else {
        return Vec::new();
    };
    let Ok(projects) = std::fs::read_dir(data_root.join(LIVE_DIR).join(origin)) else {
        return Vec::new();
    };
    let mut found: Vec<(String, Vec<String>)> = projects
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let project = entry
                .file_name()
                .to_str()
                .filter(|id| plain_id(id))?
                .to_string();
            let paths = unsent_paths(&entry.path());
            (!paths.is_empty()).then_some((project, paths))
        })
        .collect();
    found.sort();
    found
}

fn unsent_paths(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut paths: Vec<String> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let doc = doc_of(&path)?;
            match read_json::<DocRecord>(&path) {
                Some((SCHEMA, Some(record))) => Some(record.path.unwrap_or(doc.0)),
                _ => None,
            }
        })
        .collect();
    paths.sort();
    paths
}

fn doc_of(path: &Path) -> Option<DocId> {
    let name = path.file_name()?.to_str()?;
    let id = name.strip_suffix(".json")?;
    (plain_id(id) && name != MANIFEST && path.is_file()).then(|| DocId(id.to_string()))
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    oleafly_core::atomic::write_atomic_private(path, &bytes).map_err(|error| error.to_string())
}

fn remove(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
