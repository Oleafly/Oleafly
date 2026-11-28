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

use super::doc::ReviewOp;
use super::format::{Accepted, SentComment};
use super::session::now_ms;
use super::tree_queue::Queued;
use super::{DocId, PublicId};
use crate::error::{OnlineError, OnlineErrorKind};
use crate::realtime::events::plain_id;
use crate::sync::FOLDER_STATE;

pub const LIVE_DIR: &str = "overleaf-live";
pub const SCHEMA: u64 = 1;
pub const WRITE_EVERY: Duration = Duration::from_millis(250);
const MANIFEST: &str = "project.json";
const JOINED: &str = "project-join.json";
const TREE: &str = "tree-queue.json";
const LOCK: &str = "lock";
const OWNER: &str = "lock.owner";
const KEPT: &str = "kept";
const FOLDER_LOCK: &str = "live.lock";
const LOCK_PATIENCE: Duration = Duration::from_secs(5);
const FOLDER_PATIENCE: Duration = Duration::from_millis(100);

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
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub unbased: BTreeMap<String, String>,
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
            unbased: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct InflightRecord {
    pub op: TextOperation,
    #[serde(default)]
    pub raw: Option<Value>,
    #[serde(default)]
    pub tracked_by: Option<String>,
    pub public_ids: Vec<PublicId>,
    pub base_version: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ts: Option<i64>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub undo: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub comments: Vec<SentComment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edits: Option<Value>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub fixed: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub accepts: Vec<Accepted>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided: Option<ReviewOp>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub queued: Vec<ReviewOp>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HolderKind {
    App,
    Cli,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Holder {
    pub by: HolderKind,
    pub pid: u32,
    pub since_ms: u64,
}

fn live_where(holder: Option<&Holder>) -> String {
    match holder {
        Some(Holder {
            by: HolderKind::App,
            ..
        }) => "in the Oleafly app".to_string(),
        Some(Holder {
            by: HolderKind::Cli,
            pid,
            ..
        }) => format!("on the command line (process {pid})"),
        None => "in another Oleafly window or on the command line".to_string(),
    }
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum JournalError {
    #[error("this project is live {}", live_where(None))]
    Busy,
    #[error("this project is live {}", live_where(.0.as_ref()))]
    LiveElsewhere(Option<Holder>),
    #[error("the journal location is not usable: {0}")]
    Invalid(String),
    #[error("the journal could not be read or written: {0}")]
    Io(String),
}

impl From<JournalError> for OnlineError {
    fn from(error: JournalError) -> OnlineError {
        let kind = match error {
            JournalError::Busy | JournalError::LiveElsewhere(_) => OnlineErrorKind::LiveElsewhere,
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
    locks: Option<(File, Option<File>)>,
    owned: bool,
    manifest: ProjectManifest,
    docs: BTreeMap<DocId, DocRecord>,
    #[cfg(test)]
    kept: Vec<PathBuf>,
    dirty_docs: BTreeSet<DocId>,
    dirty_manifest: bool,
    joined: Option<Value>,
    dirty_joined: bool,
    tree: Vec<Queued>,
    dirty_tree: bool,
}

#[derive(Serialize, Deserialize)]
struct JoinSnapshot {
    schema: u64,
    response: Value,
}

#[derive(Serialize, Deserialize)]
struct TreeSnapshot {
    schema: u64,
    changes: Vec<Queued>,
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

pub(crate) fn plain_doc_id(id: &str) -> bool {
    plain_id(id)
        && !id.bytes().any(|byte| byte.is_ascii_uppercase())
        && MANIFEST.strip_suffix(".json") != Some(id)
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

fn take_lock(path: &Path, patience: Duration) -> Result<File, JournalError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(path)?;
    match oleafly_core::locking::lock_file(&file, true, patience) {
        Ok(()) => Ok(file),
        Err(error) if error.kind() == io::ErrorKind::TimedOut => Err(JournalError::Busy),
        Err(error) => Err(error.into()),
    }
}

pub fn folder_lock_path(folder: &Path) -> PathBuf {
    FOLDER_STATE
        .iter()
        .fold(folder.to_path_buf(), |path, part| path.join(part))
        .join(FOLDER_LOCK)
}

fn held(lock: &Path) -> bool {
    let Ok(file) = OpenOptions::new().read(true).open(lock) else {
        return false;
    };
    matches!(
        oleafly_core::locking::lock_file(&file, false, Duration::ZERO),
        Err(error) if error.kind() == io::ErrorKind::TimedOut
    )
}

pub fn live_in(folder: &Path) -> bool {
    held(&folder_lock_path(folder))
}

pub fn holder(data_root: &Path, base: &str, project_id: &str) -> Option<Holder> {
    let dir = journal_dir(data_root, base, project_id).ok()?;
    if !held(&dir.join(LOCK)) {
        return None;
    }
    serde_json::from_slice(&std::fs::read(dir.join(OWNER)).ok()?).ok()
}

pub fn manifest_of(data_root: &Path, base: &str, project_id: &str) -> Option<ProjectManifest> {
    let dir = journal_dir(data_root, base, project_id).ok()?;
    match read_json::<ProjectManifest>(&dir.join(MANIFEST)) {
        Some((SCHEMA, found)) => found,
        _ => None,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StandDown {
    Live(Option<Holder>),
    Unsent(Vec<String>),
}

pub fn stands_down(
    data_root: &Path,
    base: &str,
    project_id: &str,
    folder: Option<&Path>,
) -> Option<StandDown> {
    if folder.is_some_and(live_in) {
        return Some(StandDown::Live(holder(data_root, base, project_id)));
    }
    let paths = unsent_paths(&journal_dir(data_root, base, project_id).ok()?);
    (!paths.is_empty()).then_some(StandDown::Unsent(paths))
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<(u64, Option<T>)> {
    let bytes = std::fs::read(path).ok()?;
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let schema = value.get("schema").and_then(Value::as_u64).unwrap_or(0);
    Some((schema, serde_json::from_value(value).ok()))
}

fn placed(
    data_root: &Path,
    base: &str,
    project_id: &str,
    folder: Option<&Path>,
) -> Result<PathBuf, JournalError> {
    let dir = journal_dir(data_root, base, project_id)?;
    if folder.is_some_and(|folder| dir.starts_with(folder)) {
        return Err(JournalError::Invalid(
            "the journal would be inside the project".into(),
        ));
    }
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

impl Journal {
    pub fn open(
        data_root: &Path,
        base: &str,
        project_id: &str,
        folder: Option<&Path>,
    ) -> Result<Journal, JournalError> {
        let dir = placed(data_root, base, project_id, folder)?;
        let folder_lock = folder
            .map(|folder| take_lock(&folder_lock_path(folder), LOCK_PATIENCE))
            .transpose()?;
        let lock = take_lock(&dir.join(LOCK), LOCK_PATIENCE)?;
        Journal::assembled(dir, lock, folder_lock, false)
    }

    pub fn open_live(
        data_root: &Path,
        base: &str,
        project_id: &str,
        folder: &Path,
        by: HolderKind,
    ) -> Result<Journal, JournalError> {
        let dir = placed(data_root, base, project_id, Some(folder))?;
        let elsewhere = |error| match error {
            JournalError::Busy => JournalError::LiveElsewhere(holder(data_root, base, project_id)),
            other => other,
        };
        let folder_lock =
            take_lock(&folder_lock_path(folder), FOLDER_PATIENCE).map_err(elsewhere)?;
        let lock = take_lock(&dir.join(LOCK), LOCK_PATIENCE).map_err(elsewhere)?;
        let owner = Holder {
            by,
            pid: std::process::id(),
            since_ms: now_ms(),
        };
        write_json(&dir.join(OWNER), &owner).map_err(JournalError::Io)?;
        Journal::assembled(dir, lock, Some(folder_lock), true)
    }

    fn assembled(
        dir: PathBuf,
        lock: File,
        folder_lock: Option<File>,
        owned: bool,
    ) -> Result<Journal, JournalError> {
        let mut journal = Journal {
            dir,
            locks: Some((lock, folder_lock)),
            owned,
            manifest: ProjectManifest::default(),
            docs: BTreeMap::new(),
            #[cfg(test)]
            kept: Vec::new(),
            dirty_docs: BTreeSet::new(),
            dirty_manifest: false,
            joined: None,
            dirty_joined: false,
            tree: Vec::new(),
            dirty_tree: false,
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
        if let Some((SCHEMA, Some(snapshot))) = read_json::<JoinSnapshot>(&self.dir.join(JOINED)) {
            self.joined = Some(snapshot.response);
        }
        let tree = self.dir.join(TREE);
        match read_json::<TreeSnapshot>(&tree) {
            Some((SCHEMA, Some(snapshot))) => self.tree = snapshot.changes,
            Some(_) => self.keep(&tree)?,
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
        #[cfg(test)]
        self.kept.push(target);
        Ok(())
    }

    #[cfg(test)]
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

    #[cfg(test)]
    pub fn kept(&self) -> &[PathBuf] {
        &self.kept
    }

    pub fn put(&mut self, doc: &DocId, record: Option<DocRecord>) {
        if !plain_doc_id(&doc.0) {
            return;
        }
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

    #[cfg(test)]
    pub fn is_dirty(&self) -> bool {
        self.dirty_manifest || self.dirty_joined || self.dirty_tree || !self.dirty_docs.is_empty()
    }

    pub fn tree_queue(&self) -> &[Queued] {
        &self.tree
    }

    pub fn set_tree_queue(&mut self, changes: Vec<Queued>) {
        if changes != self.tree {
            self.tree = changes;
            self.dirty_tree = true;
        }
    }

    pub fn joined(&self) -> Option<&Value> {
        self.joined.as_ref()
    }

    pub fn remember_join(&mut self, response: Value) {
        self.joined = Some(response);
        self.dirty_joined = true;
    }

    pub fn release(&mut self) {
        let Some((lock, folder_lock)) = self.locks.take() else {
            return;
        };
        if let Some(folder_lock) = folder_lock {
            let _ = oleafly_core::locking::unlock_file(&folder_lock);
        }
        if std::mem::take(&mut self.owned) {
            let _ = remove(&self.dir.join(OWNER));
        }
        let _ = oleafly_core::locking::unlock_file(&lock);
    }

    pub fn released(&self) -> bool {
        self.locks.is_none()
    }

    pub fn flush(&mut self) -> Result<(), String> {
        if self.released() {
            return Err("live editing already let go of its journal".into());
        }
        if self.dirty_joined {
            if let Some(response) = &self.joined {
                let snapshot = JoinSnapshot {
                    schema: SCHEMA,
                    response: response.clone(),
                };
                write_json(&self.dir.join(JOINED), &snapshot)?;
            }
            self.dirty_joined = false;
        }
        if self.dirty_manifest {
            write_json(&self.dir.join(MANIFEST), &self.manifest)?;
            self.dirty_manifest = false;
        }
        if self.dirty_tree {
            let path = self.dir.join(TREE);
            if self.tree.is_empty() {
                remove(&path)?;
            } else {
                let snapshot = TreeSnapshot {
                    schema: SCHEMA,
                    changes: self.tree.clone(),
                };
                write_json(&path, &snapshot)?;
            }
            self.dirty_tree = false;
        }
        while let Some(doc) = self.dirty_docs.first().cloned() {
            if plain_doc_id(&doc.0) {
                let path = self.dir.join(format!("{}.json", doc.0));
                match self.docs.get(&doc) {
                    Some(record) => write_json(&path, record)?,
                    None => remove(&path)?,
                }
            }
            self.dirty_docs.remove(&doc);
        }
        Ok(())
    }
}

impl Drop for Journal {
    fn drop(&mut self) {
        self.release();
    }
}

pub fn unsent_on(data_root: &Path, base: &str, user: Option<&str>) -> Vec<(String, Vec<String>)> {
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
            if user.is_some_and(|user| !kept_by(&entry.path(), user)) {
                return None;
            }
            let paths = unsent_paths(&entry.path());
            (!paths.is_empty()).then_some((project, paths))
        })
        .collect();
    found.sort();
    found
}

fn kept_by(dir: &Path, user: &str) -> bool {
    match read_json::<ProjectManifest>(&dir.join(MANIFEST)) {
        Some((_, Some(manifest))) => manifest.user_id.is_empty() || manifest.user_id == user,
        _ => true,
    }
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
    if let Some((SCHEMA, Some(snapshot))) = read_json::<TreeSnapshot>(&dir.join(TREE)) {
        paths.extend(
            snapshot
                .changes
                .into_iter()
                .map(|queued| queued.change.path().to_string()),
        );
    }
    paths.sort();
    paths.dedup();
    paths
}

fn doc_of(path: &Path) -> Option<DocId> {
    let name = path.file_name()?.to_str()?;
    let id = name.strip_suffix(".json")?;
    (plain_doc_id(id) && path.is_file()).then(|| DocId(id.to_string()))
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
