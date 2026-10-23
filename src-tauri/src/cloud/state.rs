use oleafly_core::ids::ProjectId;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

const MAX_STATE_BYTES: usize = 128 * 1024 * 1024;

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub(crate) struct BaseEntry {
    pub(crate) hash: String,
    #[serde(default)]
    pub(crate) size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) stamp: Option<String>,
}

impl<'de> Deserialize<'de> for BaseEntry {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Stored {
            Hash(String),
            Entry {
                hash: String,
                #[serde(default)]
                size: u64,
                #[serde(default)]
                stamp: Option<String>,
            },
        }
        Ok(match Stored::deserialize(deserializer)? {
            Stored::Hash(hash) => Self {
                hash,
                size: 0,
                stamp: None,
            },
            Stored::Entry { hash, size, stamp } => Self { hash, size, stamp },
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(crate) struct PendingDelete {
    pub(crate) path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) rev: Option<String>,
}

impl<'de> Deserialize<'de> for PendingDelete {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Stored {
            Path(String),
            Entry {
                path: String,
                #[serde(default)]
                rev: Option<String>,
            },
        }
        Ok(match Stored::deserialize(deserializer)? {
            Stored::Path(path) => Self { path, rev: None },
            Stored::Entry { path, rev } => Self { path, rev },
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct Failure {
    pub(crate) hash: String,
    pub(crate) at_ms: u64,
    /// The file downloaded but could not be put in place, for example because
    /// another program had it open. That clears up sooner than a download.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub(crate) applying: bool,
}

impl Failure {
    /// Whether sync still waits before trying this file again. A clock set
    /// back ends the wait instead of stretching it.
    pub(crate) fn waiting(&self, now: u64) -> bool {
        let wait = if self.applying {
            crate::cloud::engine::RETRY_APPLY_MS
        } else {
            crate::cloud::engine::RETRY_FAILED_MS
        };
        now >= self.at_ms && now - self.at_ms < wait
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct SkippedFile {
    pub(crate) path: String,
    pub(crate) reason: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(crate) enum Hold {
    /// Files deleted on this computer that would be deleted from the cloud.
    MassDelete { count: usize, total: usize },
    /// Files missing from the cloud that would be deleted on this computer.
    RemoteDelete { count: usize, total: usize },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct ProjectState {
    #[serde(default)]
    pub(crate) cloud: Option<ProjectId>,
    #[serde(default)]
    pub(crate) paused: bool,
    #[serde(default)]
    pub(crate) base: BTreeMap<String, BaseEntry>,
    #[serde(default)]
    pub(crate) meta_base: Option<serde_json::Value>,
    #[serde(default)]
    pub(crate) remote_rev: Option<String>,
    #[serde(default = "dirty_by_default")]
    pub(crate) remote_dirty: bool,
    #[serde(default)]
    pub(crate) last_synced_ms: u64,
    #[serde(default)]
    pub(crate) last_error: Option<String>,
    #[serde(default)]
    pub(crate) conflicts: usize,
    #[serde(default)]
    pub(crate) skipped: usize,
    #[serde(default)]
    pub(crate) hold: Option<Hold>,
    #[serde(default)]
    pub(crate) removed_by: Option<String>,
    #[serde(default)]
    pub(crate) pending_deletes: Vec<PendingDelete>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) conflict_copies: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) skipped_files: Vec<SkippedFile>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub(crate) failed: BTreeMap<String, Failure>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub(crate) remove_pending: bool,
    /// The sync rules last read from the project's `project.json`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) policy: Option<crate::cloud::engine::OwnedPolicy>,
}

fn dirty_by_default() -> bool {
    true
}

impl Default for ProjectState {
    fn default() -> Self {
        Self {
            cloud: None,
            paused: false,
            base: BTreeMap::new(),
            meta_base: None,
            remote_rev: None,
            remote_dirty: true,
            last_synced_ms: 0,
            last_error: None,
            conflicts: 0,
            skipped: 0,
            hold: None,
            removed_by: None,
            pending_deletes: Vec::new(),
            conflict_copies: Vec::new(),
            skipped_files: Vec::new(),
            failed: BTreeMap::new(),
            remove_pending: false,
            policy: None,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct SettingsState {
    #[serde(default)]
    pub(crate) stamp: u64,
    #[serde(default)]
    pub(crate) base: Option<serde_json::Value>,
    #[serde(default)]
    pub(crate) offered: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) rev: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) deferred: Option<u64>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct EngineState {
    #[serde(default)]
    pub(crate) account: Option<String>,
    #[serde(default)]
    pub(crate) hlc: u64,
    #[serde(default)]
    pub(crate) projects: BTreeMap<String, ProjectState>,
    #[serde(default)]
    pub(crate) settings: SettingsState,
    #[serde(default)]
    pub(crate) cursor: Option<String>,
    #[serde(default)]
    pub(crate) last_synced_ms: u64,
    #[serde(default)]
    pub(crate) last_error: Option<String>,
    #[serde(default)]
    pub(crate) quota_full: bool,
}

impl EngineState {
    pub(crate) fn adopt_account(&mut self, account_id: &str) {
        match self.account.as_deref() {
            Some(current) if current == account_id => return,
            None => {
                self.account = Some(account_id.to_string());
                return;
            }
            Some(_) => {}
        }
        self.account = Some(account_id.to_string());
        self.cursor = None;
        self.settings = SettingsState::default();
        self.quota_full = false;
        self.last_error = None;
        self.last_synced_ms = 0;
        for project in self.projects.values_mut() {
            let paused = project.paused;
            *project = ProjectState {
                paused,
                ..ProjectState::default()
            };
        }
    }
}

struct Cached {
    path: PathBuf,
    stamp: Option<(SystemTime, u64)>,
    state: EngineState,
}

fn state_lock() -> &'static Mutex<Option<Cached>> {
    static LOCK: OnceLock<Mutex<Option<Cached>>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(None))
}

fn state_path() -> Result<PathBuf, String> {
    Ok(crate::paths::oleafly_root()?
        .join("cloud")
        .join("state.json"))
}

fn file_stamp(path: &Path) -> Option<(SystemTime, u64)> {
    let metadata = std::fs::metadata(path).ok()?;
    Some((metadata.modified().ok()?, metadata.len()))
}

/// Moves a record that can't be read out of the way, kept beside it for a look
/// later, so sync starts over instead of failing on it every time.
pub(crate) fn set_aside(path: &Path) {
    let Some(name) = path.file_name().and_then(std::ffi::OsStr::to_str) else {
        return;
    };
    let aside = path.with_file_name(format!(
        "{name}.unreadable-{}",
        crate::cloud::engine::now_ms()
    ));
    let _ = std::fs::rename(path, aside);
}

/// Reads the sync state. One that can't be read is set aside and sync starts
/// from nothing agreed: every file is compared again, and files that differ
/// get conflict copies, so nothing is lost.
pub(crate) fn read_at(path: &Path) -> Result<EngineState, String> {
    match std::fs::read(path) {
        Ok(bytes) => {
            let parsed = (bytes.len() <= MAX_STATE_BYTES)
                .then(|| serde_json::from_slice(&bytes).ok())
                .flatten();
            Ok(parsed.unwrap_or_else(|| {
                set_aside(path);
                EngineState::default()
            }))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(EngineState::default()),
        Err(error) => Err(error.to_string()),
    }
}

pub(crate) fn write_at(path: &Path, state: &EngineState) -> Result<(), String> {
    let parent = path.parent().ok_or("cloud sync state path has no parent")?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec(state).map_err(|error| error.to_string())?;
    crate::sandbox::atomic_write(path, &bytes)
}

fn loaded(slot: &mut Option<Cached>) -> Result<&mut Cached, String> {
    let path = state_path()?;
    let stamp = file_stamp(&path);
    let fresh = slot
        .as_ref()
        .is_some_and(|cached| cached.path == path && cached.stamp == stamp);
    if !fresh {
        let state = read_at(&path)?;
        *slot = Some(Cached { path, stamp, state });
    }
    slot.as_mut()
        .ok_or_else(|| "cloud sync state is unavailable".to_string())
}

pub(crate) fn read<T>(view: impl FnOnce(&EngineState) -> T) -> Result<T, String> {
    let mut slot = state_lock()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let cached = loaded(&mut slot)?;
    Ok(view(&cached.state))
}

pub(crate) fn snapshot() -> Result<EngineState, String> {
    read(EngineState::clone)
}

pub(crate) fn update<T>(change: impl FnOnce(&mut EngineState) -> T) -> Result<T, String> {
    let mut slot = state_lock()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let cached = loaded(&mut slot)?;
    let mut state = cached.state.clone();
    let value = change(&mut state);
    if state != cached.state {
        write_at(&cached.path, &state)?;
        cached.stamp = file_stamp(&cached.path);
        cached.state = state;
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::{read_at, write_at, BaseEntry, EngineState, PendingDelete, ProjectState};

    #[test]
    fn older_state_files_with_plain_hashes_still_load() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.json");
        std::fs::write(
            &path,
            r#"{"hlc":5,"projects":{"thesis":{"paused":true,"base":{"main.tex":"abc"},"base_stamp":3}},"settings_stamp":9}"#,
        )
        .unwrap();
        let state = read_at(&path).unwrap();
        let project = &state.projects["thesis"];
        assert!(project.paused);
        assert_eq!(
            project.base["main.tex"],
            BaseEntry {
                hash: "abc".into(),
                size: 0,
                stamp: None,
            }
        );
        assert!(project.remote_dirty);
        write_at(&path, &state).unwrap();
        assert_eq!(read_at(&path).unwrap(), state);
    }

    #[test]
    fn pending_deletes_load_from_plain_paths_and_keep_their_revisions() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.json");
        std::fs::write(
            &path,
            r#"{"projects":{"thesis":{"pending_deletes":["old.tex",{"path":"new.tex","rev":"0123456789a"}]}}}"#,
        )
        .unwrap();
        let state = read_at(&path).unwrap();
        assert_eq!(
            state.projects["thesis"].pending_deletes,
            vec![
                PendingDelete {
                    path: "old.tex".into(),
                    rev: None
                },
                PendingDelete {
                    path: "new.tex".into(),
                    rev: Some("0123456789a".into())
                }
            ]
        );
    }

    #[test]
    fn the_cached_state_reloads_when_the_file_changes_underneath() {
        let _env = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        super::update(|state| state.hlc = 7).unwrap();
        assert_eq!(super::read(|state| state.hlc).unwrap(), 7);
        let path = directory.path().join("cloud").join("state.json");
        std::fs::write(&path, r#"{"hlc":12345678}"#).unwrap();
        assert_eq!(super::read(|state| state.hlc).unwrap(), 12_345_678);
        super::update(|state| assert_eq!(state.hlc, 12_345_678)).unwrap();
        std::fs::remove_file(&path).unwrap();
        assert_eq!(super::snapshot().unwrap().hlc, 0);
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_different_account_starts_from_scratch_but_keeps_pauses() {
        let mut state = EngineState {
            account: Some("dbid:a".into()),
            cursor: Some("c".into()),
            ..EngineState::default()
        };
        let mut project = ProjectState {
            paused: true,
            ..ProjectState::default()
        };
        project.base.insert(
            "main.tex".into(),
            BaseEntry {
                hash: "h".into(),
                size: 1,
                stamp: None,
            },
        );
        state.projects.insert("thesis".into(), project);
        let mut legacy = state.clone();
        legacy.account = None;
        legacy.adopt_account("dbid:a");
        assert_eq!(legacy.projects["thesis"].base.len(), 1);
        state.adopt_account("dbid:a");
        assert_eq!(state.projects["thesis"].base.len(), 1);
        state.adopt_account("dbid:b");
        assert!(state.projects["thesis"].base.is_empty());
        assert!(state.projects["thesis"].paused);
        assert!(state.cursor.is_none());
        assert_eq!(state.account.as_deref(), Some("dbid:b"));
    }
}
