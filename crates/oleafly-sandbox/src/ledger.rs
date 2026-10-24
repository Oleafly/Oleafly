//! The Windows sandbox's write-ahead record of what it changed: AppContainer
//! profiles and folder access entries. Each record is saved before the
//! Windows call it describes and marked applied after, so a crash in between
//! never leaves an access entry Oleafly does not know about. Platform-neutral
//! so the release logic is tested everywhere.
// Only the Windows backend uses the ledger outside tests.
#![cfg_attr(not(windows), allow(dead_code))]

use std::collections::BTreeMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::roots::comparable;
use crate::SandboxError;

const LEDGER_FILE: &str = "windows-grants.json";
const LOCK_FILE: &str = "windows-sandbox.lock";
const LEDGER_VERSION: u8 = 1;

/// Owners that start with this are research tasks: their folders are copies
/// that go with the task. Any other owner (a CLI run, a self-test) works on
/// folders that stay, and belongs to whoever made it.
pub(crate) const TASK_OWNER_PREFIX: &str = "task:";

fn is_task_owner(owner: &str) -> bool {
    owner.starts_with(TASK_OWNER_PREFIX)
}

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
    /// False until the Windows call finished. A record that is still false
    /// the next time the grant is wanted was interrupted, and the call is
    /// made again in full (an entry on the folder says nothing about the
    /// files below it).
    pub applied: bool,
}

impl GrantRecord {
    /// Whether both describe the same entry (the scope and progress aside).
    pub(crate) fn same_grant(&self, other: &GrantRecord) -> bool {
        self.path == other.path && self.sid == other.sid && self.access == other.access
    }
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
    /// A protected folder: the task can read it, not write or delete in it.
    DenyWrite,
    /// A hidden folder: the task can't read or change anything in it.
    DenyAll,
    /// The folder holding a protected or hidden entry: the task can't delete
    /// or rename the entry through the folder and put another in its place.
    DenyDeleteChild,
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

fn empty_ledger() -> Ledger {
    Ledger {
        version: LEDGER_VERSION,
        ..Ledger::default()
    }
}

impl LedgerLock {
    /// The saved ledger; empty when there is none. A file that is there but
    /// can't be read is an error: an empty ledger would be saved over the
    /// only record of the access entries on the user's folders. A file that
    /// is not a ledger (cut short, damaged) is kept aside as
    /// `windows-grants.json.bad`.
    pub(crate) fn load(&self) -> Result<Ledger, SandboxError> {
        let text = match std::fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(empty_ledger()),
            Err(error) if error.kind() != std::io::ErrorKind::InvalidData => {
                return Err(SandboxError::Io(format!(
                    "The sandbox's record of folder access can't be read: {error}"
                )))
            }
            Err(_) => String::new(),
        };
        match serde_json::from_str::<Ledger>(&text) {
            Ok(ledger) => Ok(ledger),
            Err(_) => {
                let _ = std::fs::rename(&self.path, self.path.with_extension("json.bad"));
                Ok(empty_ledger())
            }
        }
    }

    /// Saves the ledger: written and flushed to disk under another name,
    /// then moved over the old file, so a crash leaves one whole ledger.
    pub(crate) fn save(&self, ledger: &Ledger) -> Result<(), SandboxError> {
        let text = serde_json::to_vec_pretty(ledger)
            .map_err(|error| SandboxError::Io(error.to_string()))?;
        let temporary = self.path.with_extension("json.tmp");
        let write = || -> std::io::Result<()> {
            let mut file = std::fs::File::create(&temporary)?;
            file.write_all(&text)?;
            file.sync_all()
        };
        write().map_err(|error| SandboxError::Io(error.to_string()))?;
        std::fs::rename(&temporary, &self.path).map_err(|error| SandboxError::Io(error.to_string()))
    }
}

/// What a grant needs before its Windows call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Begin {
    /// Applied already.
    Done,
    /// The call has to be made. `force` when an earlier attempt left a
    /// record that never finished: the whole folder is walked again.
    Apply { force: bool },
}

impl Ledger {
    /// Write-ahead: records that `wanted` is about to be applied, unless it
    /// is on file already. Save the ledger before making the call.
    pub(crate) fn begin(&mut self, wanted: &GrantRecord) -> Begin {
        match self.grants.iter().find(|grant| grant.same_grant(wanted)) {
            Some(grant) if grant.applied => Begin::Done,
            Some(_) => Begin::Apply { force: true },
            None => {
                self.grants.push(GrantRecord {
                    applied: false,
                    ..wanted.clone()
                });
                Begin::Apply { force: false }
            }
        }
    }

    pub(crate) fn is_applied(&self, record: &GrantRecord) -> bool {
        self.grants
            .iter()
            .any(|grant| grant.applied && grant.same_grant(record))
    }

    /// Marks `record` applied. A record that was forgotten in the meantime
    /// (the task was released) is put back, so the entry is not unknown.
    pub(crate) fn complete(&mut self, record: &GrantRecord) {
        match self
            .grants
            .iter_mut()
            .find(|grant| grant.same_grant(record))
        {
            Some(grant) => grant.applied = true,
            None => self.grants.push(GrantRecord {
                applied: true,
                ..record.clone()
            }),
        }
    }

    /// Drops `record` when its call never finished and its entry is not
    /// needed (a traverse entry on a folder that refused it).
    pub(crate) fn forget_unapplied(&mut self, record: &GrantRecord) {
        self.grants
            .retain(|grant| !(grant.same_grant(record) && !grant.applied));
    }

    /// Drops the records of entries that were revoked.
    pub(crate) fn forget(&mut self, done: &[GrantRecord]) {
        self.grants
            .retain(|grant| !done.iter().any(|record| grant.same_grant(record)));
    }
}

/// Whether an access entry is still on its folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Presence {
    Present,
    /// The folder was read and the entry isn't there.
    Absent,
    /// The folder is missing or can't be read now (an unplugged drive, a
    /// locked file): nothing is known.
    Unknown,
}

/// The Windows operations release needs (faked in tests).
pub(crate) trait GrantOps {
    fn delete_container(&self, name: &str) -> Result<(), SandboxError>;
    /// Removes the entry. A folder that is gone counts as done.
    fn revoke(&self, record: &GrantRecord) -> Result<(), SandboxError>;
    fn present(&self, record: &GrantRecord) -> Presence;
}

/// Deletes `owner`'s profile and settles its task grants. A research task's
/// folders (`task:` owners) are copies that go with the task, and an entry
/// for a deleted profile grants nothing, so those records are dropped
/// without walking the folders. Any other owner worked on folders that stay
/// (the user's project): its records are kept until the entries are revoked,
/// and returned for the caller to revoke, outside the ledger lock (a walk
/// can take minutes), then [`Ledger::forget`]. Shared grants stay.
pub(crate) fn release_begin(
    ops: &dyn GrantOps,
    ledger: &mut Ledger,
    owner: &str,
) -> Result<Vec<GrantRecord>, SandboxError> {
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
    let owned = |grant: &GrantRecord| matches!(&grant.scope, GrantScope::Task { owner: task } if task == owner);
    if is_task_owner(owner) {
        ledger.grants.retain(|grant| !owned(grant));
        return Ok(Vec::new());
    }
    Ok(ledger
        .grants
        .iter()
        .filter(|grant| owned(grant))
        .cloned()
        .collect())
}

/// Task grants whose owner has no profile any more and is not a research
/// task: entries left on folders that stay, to be revoked.
pub(crate) fn orphan_revocations(ledger: &Ledger) -> Vec<GrantRecord> {
    let live: Vec<&str> = ledger
        .containers
        .values()
        .map(|record| record.owner.as_str())
        .collect();
    ledger
        .grants
        .iter()
        .filter(|grant| {
            matches!(&grant.scope, GrantScope::Task { owner }
                if !is_task_owner(owner) && !live.contains(&owner.as_str()))
        })
        .cloned()
        .collect()
}

/// Releases every research task not in `active`; returns how many were
/// released. Other owners (a CLI run that is working right now) are not this
/// sweep's to release.
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
        .filter(|owner| is_task_owner(owner) && !active.contains(owner))
        .collect();
    owners.sort();
    owners.dedup();
    for owner in &owners {
        release_begin(ops, ledger, owner)?;
    }
    // A shared entry is forgotten only once it is known to be gone (a
    // reinstall removed it). One on a folder that can't be read right now (an
    // unplugged drive) stays on record, and so does one whose call never
    // finished: the folder may hold part of it.
    ledger.grants.retain(|grant| {
        matches!(grant.scope, GrantScope::Task { .. }) || ops.present(grant) != Presence::Absent
    });
    Ok(owners.len())
}

fn shared_matches(grant: &GrantRecord, scope: &SharedScope, fold_case: bool) -> bool {
    match (&grant.scope, scope) {
        (GrantScope::Task { .. }, _) => false,
        (_, SharedScope::All) => true,
        (GrantScope::Runtimes, SharedScope::Runtimes) => true,
        (GrantScope::Project { project }, SharedScope::Project(wanted)) => project == wanted,
        // The ledger keeps plain paths; the folder to unlink may come from
        // `canonicalize`, which adds `\\?\` on Windows.
        (_, SharedScope::Path(path)) => {
            comparable(&grant.path, fold_case).starts_with(comparable(path, fold_case))
        }
        _ => false,
    }
}

/// Revokes and forgets shared grants in `scope`; returns how many. A grant
/// that can't be revoked stays on record and the rest go on; the first
/// failure is reported at the end.
pub(crate) fn remove_shared_with(
    ops: &dyn GrantOps,
    ledger: &mut Ledger,
    scope: SharedScope,
) -> Result<usize, SandboxError> {
    let fold_case = cfg!(windows);
    let mut removed = 0;
    let mut failed = 0;
    let mut first_error = None;
    let mut kept = Vec::with_capacity(ledger.grants.len());
    for grant in &ledger.grants {
        if !shared_matches(grant, &scope, fold_case) {
            kept.push(grant.clone());
            continue;
        }
        match ops.revoke(grant) {
            Ok(()) => removed += 1,
            Err(error) => {
                failed += 1;
                first_error.get_or_insert(error);
                kept.push(grant.clone());
            }
        }
    }
    ledger.grants = kept;
    match first_error {
        None => Ok(removed),
        Some(error) => Err(SandboxError::Io(format!(
            "{removed} folders were changed and {failed} could not be: {error}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeOps {
        deleted: Mutex<Vec<String>>,
        revoked: Mutex<Vec<PathBuf>>,
        /// Revoking these paths fails.
        failing: BTreeSet<PathBuf>,
        /// What `present` says; `Present` when a path isn't listed.
        presence: BTreeMap<PathBuf, Presence>,
    }

    impl GrantOps for FakeOps {
        fn delete_container(&self, name: &str) -> Result<(), SandboxError> {
            self.deleted.lock().unwrap().push(name.to_owned());
            Ok(())
        }
        fn revoke(&self, record: &GrantRecord) -> Result<(), SandboxError> {
            if self.failing.contains(&record.path) {
                return Err(SandboxError::Io(format!(
                    "Windows error 5 on {}.",
                    record.path.display()
                )));
            }
            self.revoked.lock().unwrap().push(record.path.clone());
            Ok(())
        }
        fn present(&self, record: &GrantRecord) -> Presence {
            self.presence
                .get(&record.path)
                .copied()
                .unwrap_or(Presence::Present)
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

    /// A CLI run's profile and its grants on the user's own project.
    fn with_cli_run(ledger: &mut Ledger, owner: &str) {
        ledger.containers.insert(
            format!("Oleafly.Task.{owner}"),
            ContainerRecord {
                owner: owner.into(),
                created_at: 1,
            },
        );
        for (path, access) in [
            ("/work/project", GrantAccess::Read),
            ("/work/project", GrantAccess::ReadWrite),
            ("/work/project/.git", GrantAccess::DenyWrite),
        ] {
            ledger.grants.push(grant(
                path,
                GrantScope::Task {
                    owner: owner.into(),
                },
                access,
            ));
        }
    }

    fn is_task_grant_of(grant: &GrantRecord, wanted: &str) -> bool {
        matches!(&grant.scope, GrantScope::Task { owner } if owner == wanted)
    }

    #[test]
    fn ledger_write_ahead_survives_a_crash() {
        let state = tempfile::tempdir().unwrap();
        {
            let guard = lock(state.path()).unwrap();
            let mut ledger = guard.load().unwrap();
            let mut pending = grant("/x", GrantScope::Runtimes, GrantAccess::Read);
            pending.applied = false;
            ledger.grants.push(pending);
            guard.save(&ledger).unwrap();
        }
        let guard = lock(state.path()).unwrap();
        let ledger = guard.load().unwrap();
        assert_eq!(ledger.grants.len(), 1);
        assert!(!ledger.grants[0].applied);
        // Saving leaves no temporary file behind.
        assert!(!state.path().join("windows-grants.json.tmp").exists());
    }

    #[test]
    fn corrupt_ledger_is_set_aside() {
        let state = tempfile::tempdir().unwrap();
        std::fs::write(state.path().join(LEDGER_FILE), "{").unwrap();
        let guard = lock(state.path()).unwrap();
        assert!(guard.load().unwrap().grants.is_empty());
        assert!(state.path().join("windows-grants.json.bad").exists());
    }

    #[test]
    fn a_missing_ledger_is_empty() {
        let state = tempfile::tempdir().unwrap();
        let guard = lock(state.path()).unwrap();
        let ledger = guard.load().unwrap();
        assert!(ledger.grants.is_empty() && ledger.containers.is_empty());
        assert_eq!(ledger.version, LEDGER_VERSION);
    }

    #[test]
    fn an_unreadable_ledger_is_an_error_not_an_empty_one() {
        let state = tempfile::tempdir().unwrap();
        // A folder where the file belongs can't be read as a file.
        std::fs::create_dir(state.path().join(LEDGER_FILE)).unwrap();
        let guard = lock(state.path()).unwrap();
        let error = guard.load().unwrap_err().to_string();
        assert!(error.contains("can't be read"), "{error}");
        // Nothing was moved aside or replaced.
        assert!(state.path().join(LEDGER_FILE).is_dir());
        assert!(!state.path().join("windows-grants.json.bad").exists());
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
                        let mut ledger = guard.load().unwrap();
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
        assert_eq!(lock(&root).unwrap().load().unwrap().grants.len(), 100);
    }

    #[test]
    fn release_deletes_the_container_and_keeps_shared_grants() {
        let ops = FakeOps::default();
        let mut ledger = ledger();
        let to_revoke = release_begin(&ops, &mut ledger, "task:a").unwrap();
        assert_eq!(
            ops.deleted.lock().unwrap().as_slice(),
            ["Oleafly.Task.task:a"]
        );
        // A task's folders are copies that go with it: nothing is walked.
        assert!(to_revoke.is_empty());
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
    fn release_keeps_the_entries_on_folders_that_outlive_a_cli_run() {
        let ops = FakeOps::default();
        let mut ledger = ledger();
        with_cli_run(&mut ledger, "agent:run1");
        let to_revoke = release_begin(&ops, &mut ledger, "agent:run1").unwrap();
        assert_eq!(
            ops.deleted.lock().unwrap().as_slice(),
            ["Oleafly.Task.agent:run1"]
        );
        assert_eq!(to_revoke.len(), 3);
        // The records stay until the entries are really gone.
        assert_eq!(
            ledger
                .grants
                .iter()
                .filter(|grant| is_task_grant_of(grant, "agent:run1"))
                .count(),
            3
        );
        ledger.forget(&to_revoke);
        assert!(!ledger
            .grants
            .iter()
            .any(|grant| is_task_grant_of(grant, "agent:run1")));
        // Other owners' records are untouched.
        assert!(ledger
            .grants
            .iter()
            .any(|grant| is_task_grant_of(grant, "task:b")));
    }

    #[test]
    fn an_unfinished_release_is_picked_up_as_an_orphan() {
        let mut ledger = ledger();
        with_cli_run(&mut ledger, "agent:live");
        with_cli_run(&mut ledger, "agent:gone");
        // The second run's profile is deleted; the first one is still working.
        ledger.containers.remove("Oleafly.Task.agent:gone");
        let orphans = orphan_revocations(&ledger);
        assert_eq!(orphans.len(), 3);
        assert!(orphans
            .iter()
            .all(|grant| is_task_grant_of(grant, "agent:gone")));
        // Research tasks without a profile are not orphans: stale release
        // drops those records.
        ledger.containers.remove("Oleafly.Task.task:a");
        assert!(orphan_revocations(&ledger)
            .iter()
            .all(|grant| !is_task_grant_of(grant, "task:a")));
    }

    #[test]
    fn release_stale_releases_only_inactive_research_tasks() {
        let ops = FakeOps::default();
        let mut ledger = ledger();
        with_cli_run(&mut ledger, "agent:run1");
        ledger.containers.insert(
            "Oleafly.Task.selftest:7".into(),
            ContainerRecord {
                owner: "selftest:7".into(),
                created_at: 1,
            },
        );
        assert_eq!(
            release_stale_with(&ops, &mut ledger, &["task:a".into()]).unwrap(),
            1
        );
        assert_eq!(
            ops.deleted.lock().unwrap().as_slice(),
            ["Oleafly.Task.task:b"]
        );
        assert!(ledger.containers.contains_key("Oleafly.Task.task:a"));
        // A CLI run or a self-test that is working keeps its profile.
        assert!(ledger.containers.contains_key("Oleafly.Task.agent:run1"));
        assert!(ledger.containers.contains_key("Oleafly.Task.selftest:7"));
        assert!(ledger
            .grants
            .iter()
            .any(|grant| is_task_grant_of(grant, "agent:run1")));
    }

    #[test]
    fn the_sweep_keeps_shared_grants_it_cannot_prove_are_gone() {
        let mut ops = FakeOps::default();
        ops.presence.insert("/conda".into(), Presence::Unknown);
        ops.presence.insert("/data/p2".into(), Presence::Absent);
        let mut ledger = ledger();
        // An unfinished grant whose entry is on the folder is kept to be
        // finished; one whose entry is not there goes.
        let mut partial = grant("/data/partial", GrantScope::Runtimes, GrantAccess::Read);
        partial.applied = false;
        ledger.grants.push(partial);
        let mut never = grant("/data/never", GrantScope::Runtimes, GrantAccess::Read);
        never.applied = false;
        ledger.grants.push(never);
        ops.presence.insert("/data/never".into(), Presence::Absent);
        release_stale_with(&ops, &mut ledger, &["task:a".into(), "task:b".into()]).unwrap();
        let kept: Vec<&Path> = ledger
            .grants
            .iter()
            .map(|grant| grant.path.as_path())
            .collect();
        assert!(kept.contains(&Path::new("/conda")), "{kept:?}");
        assert!(kept.contains(&Path::new("/data/p1")), "{kept:?}");
        assert!(kept.contains(&Path::new("/data/partial")), "{kept:?}");
        assert!(!kept.contains(&Path::new("/data/p2")), "{kept:?}");
        assert!(!kept.contains(&Path::new("/data/never")), "{kept:?}");
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

    #[test]
    fn remove_shared_keeps_what_it_could_not_revoke_and_goes_on() {
        let ops = FakeOps {
            failing: ["/conda".into()].into(),
            ..FakeOps::default()
        };
        let mut ledger = ledger();
        let before = ledger.grants.len();
        let error = remove_shared_with(&ops, &mut ledger, SharedScope::All).unwrap_err();
        assert!(error
            .to_string()
            .contains("2 folders were changed and 1 could not"));
        assert!(error.to_string().contains("/conda"));
        // Both project grants went; the one that failed is still on record,
        // and so are the tasks' own.
        assert_eq!(ledger.grants.len(), before - 2);
        assert!(ledger
            .grants
            .iter()
            .any(|grant| grant.path == Path::new("/conda")));
        assert!(!ledger
            .grants
            .iter()
            .any(|grant| grant.path.starts_with("/data")));
        assert_eq!(
            ledger
                .grants
                .iter()
                .filter(
                    |grant| is_task_grant_of(grant, "task:a") || is_task_grant_of(grant, "task:b")
                )
                .count(),
            2
        );
    }

    #[test]
    fn remove_shared_revokes_an_entry_that_never_finished() {
        let ops = FakeOps::default();
        let mut ledger = ledger();
        let mut partial = grant("/data/partial", GrantScope::Runtimes, GrantAccess::Read);
        partial.applied = false;
        ledger.grants.push(partial);
        remove_shared_with(&ops, &mut ledger, SharedScope::Runtimes).unwrap();
        assert!(ops
            .revoked
            .lock()
            .unwrap()
            .contains(&PathBuf::from("/data/partial")));
    }

    #[test]
    fn unlinking_a_folder_matches_verbatim_and_plain_paths() {
        // The ledger holds plain paths; `canonicalize` hands back the
        // verbatim form on Windows.
        let record = grant(
            r"C:\Data\survey",
            GrantScope::Project {
                project: "p1".into(),
            },
            GrantAccess::Read,
        );
        for (path, fold, expected) in [
            (r"\\?\C:\Data\survey", false, true),
            (r"C:\Data\survey", false, true),
            (r"\\?\c:\data\SURVEY", true, true),
            (r"\\?\c:\data\SURVEY", false, false),
            (r"\\?\C:\Data\other", true, false),
        ] {
            assert_eq!(
                shared_matches(&record, &SharedScope::Path(PathBuf::from(path)), fold),
                expected,
                "{path} fold={fold}"
            );
        }
    }

    #[test]
    fn unlinking_a_folder_matches_what_is_below_it() {
        let ops = FakeOps::default();
        let mut ledger = ledger();
        assert_eq!(
            remove_shared_with(&ops, &mut ledger, SharedScope::Path("/data".into())).unwrap(),
            2
        );
        assert_eq!(
            remove_shared_with(&ops, &mut ledger, SharedScope::Path("/data".into())).unwrap(),
            0
        );
    }

    #[test]
    fn begin_records_before_the_call_and_forces_a_retry() {
        let mut ledger = Ledger::default();
        let wanted = grant("/data", GrantScope::Runtimes, GrantAccess::Read);
        assert_eq!(ledger.begin(&wanted), Begin::Apply { force: false });
        // The intent is on file, not applied.
        assert_eq!(ledger.grants.len(), 1);
        assert!(!ledger.grants[0].applied);
        // Wanted again after an interruption: the folder is walked again in full.
        assert_eq!(ledger.begin(&wanted), Begin::Apply { force: true });
        assert_eq!(ledger.grants.len(), 1);
        ledger.complete(&wanted);
        assert!(ledger.is_applied(&wanted));
        assert_eq!(ledger.begin(&wanted), Begin::Done);
    }

    #[test]
    fn complete_puts_back_a_record_that_went_missing() {
        let mut ledger = Ledger::default();
        let record = grant("/data", GrantScope::Runtimes, GrantAccess::Read);
        ledger.complete(&record);
        assert!(ledger.is_applied(&record));
        let mut unfinished = grant("/more", GrantScope::Runtimes, GrantAccess::Traverse);
        unfinished.applied = false;
        ledger.grants.push(unfinished.clone());
        ledger.forget_unapplied(&unfinished);
        assert!(!ledger
            .grants
            .iter()
            .any(|grant| grant.same_grant(&unfinished)));
        // An applied entry stays when asked to forget unfinished ones.
        ledger.forget_unapplied(&record);
        assert!(ledger.is_applied(&record));
    }

    #[test]
    fn old_ledgers_still_load_and_new_entries_round_trip() {
        let old = r#"{"version":1,"containers":{},"grants":[{"path":"C:\\x","sid":"S-1","scope":{"kind":"runtimes"},"access":"excluded","applied":true}]}"#;
        let ledger: Ledger = serde_json::from_str(old).unwrap();
        assert_eq!(ledger.grants[0].access, GrantAccess::Excluded);
        for access in [
            GrantAccess::DenyWrite,
            GrantAccess::DenyAll,
            GrantAccess::DenyDeleteChild,
        ] {
            let text = serde_json::to_string(&access).unwrap();
            assert_eq!(serde_json::from_str::<GrantAccess>(&text).unwrap(), access);
        }
    }
}
