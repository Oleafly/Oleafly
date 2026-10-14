use oleafly_core::ids::ProjectId;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const MAX_STATE_BYTES: usize = 128 * 1024 * 1024;

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub(crate) struct BaseEntry {
    pub(crate) hash: String,
    #[serde(default)]
    pub(crate) size: u64,
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
            },
        }
        Ok(match Stored::deserialize(deserializer)? {
            Stored::Hash(hash) => Self { hash, size: 0 },
            Stored::Entry { hash, size } => Self { hash, size },
        })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(crate) enum Hold {
    MassDelete { count: usize, total: usize },
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
    pub(crate) pending_deletes: Vec<String>,
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

fn state_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn state_path() -> Result<PathBuf, String> {
    Ok(crate::paths::oleafly_root()?
        .join("cloud")
        .join("state.json"))
}

pub(crate) fn read_at(path: &Path) -> Result<EngineState, String> {
    match std::fs::read(path) {
        Ok(bytes) => {
            if bytes.len() > MAX_STATE_BYTES {
                return Err("cloud sync state is too large".into());
            }
            serde_json::from_slice(&bytes)
                .map_err(|error| format!("cloud sync state is unreadable: {error}"))
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

pub(crate) fn snapshot() -> Result<EngineState, String> {
    let _guard = state_lock()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    read_at(&state_path()?)
}

pub(crate) fn update<T>(change: impl FnOnce(&mut EngineState) -> T) -> Result<T, String> {
    let _guard = state_lock()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let path = state_path()?;
    let before = read_at(&path)?;
    let mut state = before.clone();
    let value = change(&mut state);
    if state != before {
        write_at(&path, &state)?;
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::{read_at, write_at, BaseEntry, EngineState, ProjectState};

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
                size: 0
            }
        );
        assert!(project.remote_dirty);
        write_at(&path, &state).unwrap();
        assert_eq!(read_at(&path).unwrap(), state);
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
