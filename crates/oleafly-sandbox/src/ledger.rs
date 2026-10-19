//! The Windows sandbox's write-ahead record of what it changed: AppContainer
//! profiles and folder access entries. Each record is saved before the
//! Windows call it describes and marked applied after, so a crash in between
//! never leaves an access entry Oleafly does not know about. Platform-neutral
//! so the release logic is tested everywhere.
// Only the Windows backend uses the ledger outside tests.
#![cfg_attr(not(windows), allow(dead_code))]

use std::collections::BTreeMap;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::SandboxError;

const LEDGER_FILE: &str = "windows-grants.json";
const LOCK_FILE: &str = "windows-sandbox.lock";
const LEDGER_VERSION: u8 = 1;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Ledger {
    pub version: u8,
    /// AppContainer profile name → who it belongs to.
    pub containers: BTreeMap<String, ContainerRecord>,
    pub grants: Vec<GrantRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContainerRecord {
    pub owner: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GrantRecord {
    pub path: PathBuf,
    /// The SID the entry is for, as SDDL text.
    pub sid: String,
    pub scope: GrantScope,
    pub access: GrantAccess,
    /// False until the Windows call succeeded.
    pub applied: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum GrantScope {
    /// One task's own folders (its workspace and home).
    Task { owner: String },
    /// Interpreters and skill folders, shared by every task.
    Runtimes,
    /// One project's linked data folders.
    Project { project: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum GrantAccess {
    Read,
    ReadWrite,
    Traverse,
    /// A protected file whose access list no longer includes the task.
    Excluded,
}

/// Shared read access that can be removed from Settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum SharedScope {
    /// Interpreter and skill folders.
    Runtimes,
    /// One project's linked data folders.
    Project(String),
    /// One folder (an unlinked data folder).
    Path(PathBuf),
    /// Everything shared.
    All,
}

/// The ledger's file lock, held while the ledger is read and changed.
pub(crate) struct LedgerLock {
    _file: std::fs::File,
    path: PathBuf,
}

/// Takes the cross-process lock on the ledger in `state_dir`.
pub(crate) fn lock(state_dir: &Path) -> Result<LedgerLock, SandboxError> {
    std::fs::create_dir_all(state_dir).map_err(|error| SandboxError::Io(error.to_string()))?;
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(state_dir.join(LOCK_FILE))
        .map_err(|error| SandboxError::Io(error.to_string()))?;
    fs4::FileExt::lock(&file).map_err(|error| SandboxError::Io(error.to_string()))?;
    Ok(LedgerLock {
        _file: file,
        path: state_dir.join(LEDGER_FILE),
    })
}

impl LedgerLock {
    /// The saved ledger; empty when missing. A corrupt file is kept aside as
    /// `windows-grants.json.bad`.
    pub(crate) fn load(&self) -> Ledger {
        let text = match std::fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(_) => {
                return Ledger {
                    version: LEDGER_VERSION,
                    ..Ledger::default()
                }
            }
        };
        match serde_json::from_str::<Ledger>(&text) {
            Ok(ledger) => ledger,
            Err(_) => {
                let _ = std::fs::rename(&self.path, self.path.with_extension("json.bad"));
                Ledger {
                    version: LEDGER_VERSION,
                    ..Ledger::default()
                }
            }
        }
    }

    /// Saves the ledger atomically.
    pub(crate) fn save(&self, ledger: &Ledger) -> Result<(), SandboxError> {
        let text = serde_json::to_vec_pretty(ledger)
            .map_err(|error| SandboxError::Io(error.to_string()))?;
        let temporary = self.path.with_extension("json.tmp");
        std::fs::write(&temporary, text).map_err(|error| SandboxError::Io(error.to_string()))?;
        std::fs::rename(&temporary, &self.path).map_err(|error| SandboxError::Io(error.to_string()))
    }
}

/// The Windows operations release needs (faked in tests).
pub(crate) trait GrantOps {
    fn delete_container(&self, name: &str) -> Result<(), SandboxError>;
    fn revoke(&self, record: &GrantRecord) -> Result<(), SandboxError>;
    fn present(&self, record: &GrantRecord) -> bool;
}

/// Deletes `owner`'s profile and forgets its own grants. The task's
/// workspace and home entries are not revoked: the folders are deleted with
/// the task and an entry for a deleted profile grants nothing, while
/// revoking would walk the whole tree. Shared grants stay.
pub(crate) fn release_with(
    ops: &dyn GrantOps,
    ledger: &mut Ledger,
    owner: &str,
) -> Result<(), SandboxError> {
    let names: Vec<String> = ledger
        .containers
        .iter()
        .filter(|(_, record)| record.owner == owner)
        .map(|(name, _)| name.clone())
        .collect();
    for name in &names {
        ops.delete_container(name)?;
        ledger.containers.remove(name);
    }
    ledger
        .grants
        .retain(|grant| !matches!(&grant.scope, GrantScope::Task { owner: task } if task == owner));
    Ok(())
}

/// Releases every owner not in `active`; returns how many were released.
pub(crate) fn release_stale_with(
    ops: &dyn GrantOps,
    ledger: &mut Ledger,
    active: &[String],
) -> Result<usize, SandboxError> {
    let mut owners: Vec<String> = ledger
        .containers
        .values()
        .map(|record| record.owner.clone())
        .chain(ledger.grants.iter().filter_map(|grant| match &grant.scope {
            GrantScope::Task { owner } => Some(owner.clone()),
            _ => None,
        }))
        .filter(|owner| !active.contains(owner))
        .collect();
    owners.sort();
    owners.dedup();
    for owner in &owners {
        release_with(ops, ledger, owner)?;
    }
    // Shared grants written but never applied are dropped; applied ones
    // whose entry is gone (a reinstall) are forgotten.
    ledger.grants.retain(|grant| {
        matches!(grant.scope, GrantScope::Task { .. }) || (grant.applied && ops.present(grant))
    });
    Ok(owners.len())
}

fn shared_matches(grant: &GrantRecord, scope: &SharedScope) -> bool {
    match (&grant.scope, scope) {
        (GrantScope::Task { .. }, _) => false,
        (_, SharedScope::All) => true,
        (GrantScope::Runtimes, SharedScope::Runtimes) => true,
        (GrantScope::Project { project }, SharedScope::Project(wanted)) => project == wanted,
        (_, SharedScope::Path(path)) => grant.path.starts_with(path),
        _ => false,
    }
}

/// Revokes and forgets shared grants in `scope`; returns how many.
pub(crate) fn remove_shared_with(
    ops: &dyn GrantOps,
    ledger: &mut Ledger,
    scope: SharedScope,
) -> Result<usize, SandboxError> {
    let mut removed = 0;
    let mut kept = Vec::with_capacity(ledger.grants.len());
    for grant in std::mem::take(&mut ledger.grants) {
        if shared_matches(&grant, &scope) {
            if grant.applied {
                ops.revoke(&grant)?;
            }
            removed += 1;
        } else {
            kept.push(grant);
        }
    }
    ledger.grants = kept;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeOps {
        deleted: Mutex<Vec<String>>,
        revoked: Mutex<Vec<PathBuf>>,
    }

    impl GrantOps for FakeOps {
        fn delete_container(&self, name: &str) -> Result<(), SandboxError> {
            self.deleted.lock().unwrap().push(name.to_owned());
            Ok(())
        }
        fn revoke(&self, record: &GrantRecord) -> Result<(), SandboxError> {
            self.revoked.lock().unwrap().push(record.path.clone());
            Ok(())
        }
        fn present(&self, _record: &GrantRecord) -> bool {
            true
        }
    }

    fn grant(path: &str, scope: GrantScope, access: GrantAccess) -> GrantRecord {
        GrantRecord {
            path: PathBuf::from(path),
            sid: "S-1-15-2-1".into(),
            scope,
            access,
            applied: true,
        }
    }

    fn ledger() -> Ledger {
        let mut ledger = Ledger::default();
        for owner in ["task:a", "task:b"] {
            ledger.containers.insert(
                format!("Oleafly.Task.{owner}"),
                ContainerRecord {
                    owner: owner.into(),
                    created_at: 1,
                },
            );
            ledger.grants.push(grant(
                &format!("/tasks/{owner}"),
                GrantScope::Task {
                    owner: owner.into(),
                },
                GrantAccess::ReadWrite,
            ));
        }
        ledger
            .grants
            .push(grant("/conda", GrantScope::Runtimes, GrantAccess::Read));
        ledger.grants.push(grant(
            "/data/p1",
            GrantScope::Project {
                project: "p1".into(),
            },
            GrantAccess::Read,
        ));
        ledger.grants.push(grant(
            "/data/p2",
            GrantScope::Project {
                project: "p2".into(),
            },
            GrantAccess::Read,
        ));
        ledger
    }

    #[test]
    fn ledger_write_ahead_survives_a_crash() {
        let state = tempfile::tempdir().unwrap();
        {
            let guard = lock(state.path()).unwrap();
            let mut ledger = guard.load();
            let mut pending = grant("/x", GrantScope::Runtimes, GrantAccess::Read);
            pending.applied = false;
            ledger.grants.push(pending);
            guard.save(&ledger).unwrap();
        }
        let guard = lock(state.path()).unwrap();
        let ledger = guard.load();
        assert_eq!(ledger.grants.len(), 1);
        assert!(!ledger.grants[0].applied);
    }

    #[test]
    fn corrupt_ledger_is_set_aside() {
        let state = tempfile::tempdir().unwrap();
        std::fs::write(state.path().join(LEDGER_FILE), "{").unwrap();
        let guard = lock(state.path()).unwrap();
        assert!(guard.load().grants.is_empty());
        assert!(state.path().join("windows-grants.json.bad").exists());
    }

    #[test]
    fn ledger_lock_serializes_two_threads() {
        let state = tempfile::tempdir().unwrap();
        let root = state.path().to_path_buf();
        let workers: Vec<_> = (0..2)
            .map(|worker| {
                let root = root.clone();
                std::thread::spawn(move || {
                    for index in 0..50 {
                        let guard = lock(&root).unwrap();
                        let mut ledger = guard.load();
                        ledger.grants.push(grant(
                            &format!("/{worker}/{index}"),
                            GrantScope::Runtimes,
                            GrantAccess::Read,
                        ));
                        guard.save(&ledger).unwrap();
                    }
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        assert_eq!(lock(&root).unwrap().load().grants.len(), 100);
    }

    #[test]
    fn release_deletes_the_container_and_keeps_shared_grants() {
        let ops = FakeOps::default();
        let mut ledger = ledger();
        release_with(&ops, &mut ledger, "task:a").unwrap();
        assert_eq!(
            ops.deleted.lock().unwrap().as_slice(),
            ["Oleafly.Task.task:a"]
        );
        assert!(ops.revoked.lock().unwrap().is_empty());
        assert!(!ledger
            .grants
            .iter()
            .any(|grant| grant.path == Path::new("/tasks/task:a")));
        assert!(ledger
            .grants
            .iter()
            .any(|grant| grant.scope == GrantScope::Runtimes));
    }

    #[test]
    fn release_stale_releases_only_inactive_owners() {
        let ops = FakeOps::default();
        let mut ledger = ledger();
        assert_eq!(
            release_stale_with(&ops, &mut ledger, &["task:a".into()]).unwrap(),
            1
        );
        assert_eq!(
            ops.deleted.lock().unwrap().as_slice(),
            ["Oleafly.Task.task:b"]
        );
        assert!(ledger.containers.contains_key("Oleafly.Task.task:a"));
    }

    #[test]
    fn remove_shared_revokes_and_forgets() {
        let ops = FakeOps::default();
        let mut ledger = ledger();
        assert_eq!(
            remove_shared_with(&ops, &mut ledger, SharedScope::Project("p1".into())).unwrap(),
            1
        );
        assert_eq!(
            ops.revoked.lock().unwrap().as_slice(),
            [PathBuf::from("/data/p1")]
        );
        assert!(ledger
            .grants
            .iter()
            .any(|grant| grant.path == Path::new("/data/p2")));
    }
}
