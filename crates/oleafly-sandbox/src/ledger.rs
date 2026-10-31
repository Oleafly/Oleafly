#![cfg_attr(not(windows), allow(dead_code))]

use std::collections::BTreeMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::process::identity::ProcessIdentity;
use crate::roots::comparable;
use crate::SandboxError;

const LEDGER_FILE: &str = "windows-grants.json";
const LOCK_FILE: &str = "windows-sandbox.lock";
const LEDGER_VERSION: u8 = 1;

pub(crate) const TASK_OWNER_PREFIX: &str = "task:";

fn is_task_owner(owner: &str) -> bool {
    owner.starts_with(TASK_OWNER_PREFIX)
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Ledger {
    pub version: u8,
    pub containers: BTreeMap<String, ContainerRecord>,
    pub grants: Vec<GrantRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContainerRecord {
    pub owner: String,
    pub created_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub process: Option<ProcessIdentity>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GrantRecord {
    pub path: PathBuf,
    pub sid: String,
    pub scope: GrantScope,
    pub access: GrantAccess,
    /// False until the Windows call finished. A record that is still false
    /// the next time the grant is wanted was interrupted, and the call is
    /// made again in full (an entry on the folder says nothing about the
    /// files below it).
    pub applied: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original: Option<String>,
}

impl GrantRecord {
    pub(crate) fn same_grant(&self, other: &GrantRecord) -> bool {
        self.path == other.path && self.sid == other.sid && self.access == other.access
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum GrantScope {
    Task { owner: String },
    Runtimes,
    Project { project: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum GrantAccess {
    Read,
    ReadWrite,
    Traverse,
    Excluded,
    DenyWrite,
    DenyAll,
    DenyDeleteChild,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum SharedScope {
    Runtimes,
    Project(String),
    Path(PathBuf),
    All,
}

pub(crate) struct LedgerLock {
    _file: std::fs::File,
    path: PathBuf,
}

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Begin {
    Done,
    Apply { force: bool },
}

impl Ledger {
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

    pub(crate) fn complete(&mut self, record: &GrantRecord) {
        match self
            .grants
            .iter_mut()
            .find(|grant| grant.same_grant(record))
        {
            Some(grant) => {
                grant.applied = true;
                if grant.original.is_none() {
                    grant.original = record.original.clone();
                }
            }
            None => self.grants.push(GrantRecord {
                applied: true,
                ..record.clone()
            }),
        }
    }

    pub(crate) fn forget_unapplied(&mut self, record: &GrantRecord) {
        self.grants
            .retain(|grant| !(grant.same_grant(record) && !grant.applied));
    }

    pub(crate) fn forget(&mut self, done: &[GrantRecord]) {
        self.grants
            .retain(|grant| !done.iter().any(|record| grant.same_grant(record)));
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Presence {
    Present,
    Absent,
    Unknown,
}

pub(crate) trait GrantOps {
    fn delete_container(&self, name: &str) -> Result<(), SandboxError>;
    fn revoke(&self, record: &GrantRecord) -> Result<(), SandboxError>;
    fn present(&self, record: &GrantRecord) -> Presence;
    fn process_is_live(&self, process: Option<ProcessIdentity>) -> bool;
}

fn hand_over_originals(ledger: &mut Ledger, leaving: &mut [GrantRecord]) {
    let position = |ledger: &Ledger, record: &GrantRecord| {
        ledger
            .grants
            .iter()
            .position(|grant| grant.same_grant(record))
            .unwrap_or(usize::MAX)
    };
    let mut paths: Vec<PathBuf> = leaving
        .iter()
        .filter(|record| record.access == GrantAccess::Excluded)
        .map(|record| record.path.clone())
        .collect();
    paths.sort();
    paths.dedup();
    for path in paths {
        let is_here =
            |grant: &GrantRecord| grant.access == GrantAccess::Excluded && grant.path == path;
        let mut going: Vec<usize> = (0..leaving.len())
            .filter(|&index| is_here(&leaving[index]))
            .collect();
        going.sort_by_key(|&index| position(ledger, &leaving[index]));
        let staying = ledger
            .grants
            .iter()
            .enumerate()
            .filter(|(_, grant)| {
                is_here(grant) && !leaving.iter().any(|record| record.same_grant(grant))
            })
            .map(|(index, _)| index)
            .next();
        let oldest_going = going
            .iter()
            .find_map(|&index| leaving[index].original.clone().map(|text| (index, text)));
        for &index in &going {
            leaving[index].original = None;
        }
        let Some((index, original)) = oldest_going else {
            continue;
        };
        match staying {
            Some(stay) => {
                if position(ledger, &leaving[index]) < stay
                    || ledger.grants[stay].original.is_none()
                {
                    ledger.grants[stay].original = Some(original);
                }
            }
            None => leaving[index].original = Some(original),
        }
    }
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
    let mut leaving: Vec<GrantRecord> = ledger
        .grants
        .iter()
        .filter(|grant| owned(grant))
        .cloned()
        .collect();
    hand_over_originals(ledger, &mut leaving);
    Ok(leaving)
}

pub(crate) fn orphan_revocations(ledger: &mut Ledger) -> Vec<GrantRecord> {
    let live: Vec<String> = ledger
        .containers
        .values()
        .map(|record| record.owner.clone())
        .collect();
    let mut leaving: Vec<GrantRecord> = ledger
        .grants
        .iter()
        .filter(|grant| {
            matches!(&grant.scope, GrantScope::Task { owner }
                if !is_task_owner(owner) && !live.contains(owner))
        })
        .cloned()
        .collect();
    hand_over_originals(ledger, &mut leaving);
    leaving
}

fn abandoned_owners(ops: &dyn GrantOps, ledger: &Ledger) -> Vec<String> {
    let mut owners: Vec<String> = ledger
        .containers
        .values()
        .filter(|record| !is_task_owner(&record.owner) && !ops.process_is_live(record.process))
        .map(|record| record.owner.clone())
        .collect();
    owners.sort();
    owners.dedup();
    owners
}

pub(crate) fn release_abandoned_with(
    ops: &dyn GrantOps,
    ledger: &mut Ledger,
) -> Result<usize, SandboxError> {
    let owners = abandoned_owners(ops, ledger);
    for owner in &owners {
        release_begin(ops, ledger, owner)?;
    }
    Ok(owners.len())
}

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
    owners.extend(abandoned_owners(ops, ledger));
    owners.sort();
    owners.dedup();
    for owner in &owners {
        release_begin(ops, ledger, owner)?;
    }
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
        failing: BTreeSet<PathBuf>,
        presence: BTreeMap<PathBuf, Presence>,
        dead: BTreeSet<u32>,
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
        fn process_is_live(&self, process: Option<ProcessIdentity>) -> bool {
            process.is_some_and(|process| !self.dead.contains(&process.pid))
        }
    }

    fn grant(path: &str, scope: GrantScope, access: GrantAccess) -> GrantRecord {
        GrantRecord {
            path: PathBuf::from(path),
            sid: "S-1-15-2-1".into(),
            scope,
            access,
            applied: true,
            original: None,
        }
    }

    fn process(pid: u32) -> Option<ProcessIdentity> {
        Some(ProcessIdentity {
            pid,
            started: Some(1),
        })
    }

    fn ledger() -> Ledger {
        let mut ledger = Ledger::default();
        for owner in ["task:a", "task:b"] {
            ledger.containers.insert(
                format!("Oleafly.Task.{owner}"),
                ContainerRecord {
                    owner: owner.into(),
                    created_at: 1,
                    process: process(10),
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

    fn with_cli_run_in(ledger: &mut Ledger, owner: &str, pid: u32) {
        ledger.containers.insert(
            format!("Oleafly.Task.{owner}"),
            ContainerRecord {
                owner: owner.into(),
                created_at: 1,
                process: process(pid),
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

    fn with_cli_run(ledger: &mut Ledger, owner: &str) {
        with_cli_run_in(ledger, owner, 20);
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
        std::fs::create_dir(state.path().join(LEDGER_FILE)).unwrap();
        let guard = lock(state.path()).unwrap();
        let error = guard.load().unwrap_err().to_string();
        assert!(error.contains("can't be read"), "{error}");
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
        ledger.containers.remove("Oleafly.Task.agent:gone");
        let orphans = orphan_revocations(&mut ledger);
        assert_eq!(orphans.len(), 3);
        assert!(orphans
            .iter()
            .all(|grant| is_task_grant_of(grant, "agent:gone")));
        ledger.containers.remove("Oleafly.Task.task:a");
        assert!(orphan_revocations(&mut ledger)
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
                process: process(7),
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
        assert!(ledger.containers.contains_key("Oleafly.Task.agent:run1"));
        assert!(ledger.containers.contains_key("Oleafly.Task.selftest:7"));
        assert!(ledger
            .grants
            .iter()
            .any(|grant| is_task_grant_of(grant, "agent:run1")));
    }

    #[test]
    fn the_sweep_releases_a_cli_run_whose_process_is_gone() {
        let ops = FakeOps {
            dead: [30].into(),
            ..FakeOps::default()
        };
        let mut ledger = ledger();
        with_cli_run(&mut ledger, "agent:live");
        with_cli_run_in(&mut ledger, "agent:killed", 30);
        assert_eq!(
            release_stale_with(&ops, &mut ledger, &["task:a".into(), "task:b".into()]).unwrap(),
            1
        );
        assert_eq!(
            ops.deleted.lock().unwrap().as_slice(),
            ["Oleafly.Task.agent:killed"]
        );
        assert!(ledger.containers.contains_key("Oleafly.Task.agent:live"));
        let orphans = orphan_revocations(&mut ledger);
        assert_eq!(orphans.len(), 3);
        assert!(orphans
            .iter()
            .all(|grant| is_task_grant_of(grant, "agent:killed")));
    }

    #[test]
    fn releasing_abandoned_runs_leaves_research_tasks_to_the_app() {
        let ops = FakeOps {
            dead: [30].into(),
            ..FakeOps::default()
        };
        let mut ledger = ledger();
        with_cli_run(&mut ledger, "agent:live");
        with_cli_run_in(&mut ledger, "agent:killed", 30);
        ledger.containers.insert(
            "Oleafly.Task.selftest:9".into(),
            ContainerRecord {
                owner: "selftest:9".into(),
                created_at: 1,
                process: None,
            },
        );
        assert_eq!(release_abandoned_with(&ops, &mut ledger).unwrap(), 2);
        let mut deleted = ops.deleted.lock().unwrap().clone();
        deleted.sort();
        assert_eq!(
            deleted,
            ["Oleafly.Task.agent:killed", "Oleafly.Task.selftest:9"]
        );
        for kept in [
            "Oleafly.Task.task:a",
            "Oleafly.Task.task:b",
            "Oleafly.Task.agent:live",
        ] {
            assert!(ledger.containers.contains_key(kept), "{kept}");
        }
    }

    #[test]
    fn container_records_without_a_process_still_load() {
        let old = r#"{"version":1,"containers":{"Oleafly.Task.agent:r":{"owner":"agent:r","createdAt":5}},"grants":[]}"#;
        let ledger: Ledger = serde_json::from_str(old).unwrap();
        assert_eq!(ledger.containers["Oleafly.Task.agent:r"].process, None);
        let record = ContainerRecord {
            owner: "agent:r".into(),
            created_at: 5,
            process: process(42),
        };
        let text = serde_json::to_string(&record).unwrap();
        assert_eq!(
            serde_json::from_str::<ContainerRecord>(&text).unwrap(),
            record
        );
    }

    fn excluded_env(owner: &str, sid: &str, original: &str) -> GrantRecord {
        GrantRecord {
            path: PathBuf::from("/work/project/.env"),
            sid: sid.into(),
            scope: GrantScope::Task {
                owner: owner.into(),
            },
            access: GrantAccess::Excluded,
            applied: true,
            original: Some(original.into()),
        }
    }

    #[test]
    fn an_excluded_file_gets_its_list_back_only_from_the_last_run_that_excludes_it() {
        let ops = FakeOps::default();
        let mut ledger = ledger();
        with_cli_run(&mut ledger, "agent:first");
        with_cli_run(&mut ledger, "agent:second");
        ledger
            .grants
            .push(excluded_env("agent:first", "S-1-15-2-11", "D:AI(original)"));
        ledger
            .grants
            .push(excluded_env("agent:second", "S-1-15-2-22", "D:P(first's)"));
        let first = release_begin(&ops, &mut ledger, "agent:first").unwrap();
        let first_env = first
            .iter()
            .find(|grant| grant.access == GrantAccess::Excluded)
            .unwrap();
        assert_eq!(first_env.original, None);
        ledger.forget(&first);
        let second_env = ledger
            .grants
            .iter()
            .find(|grant| grant.access == GrantAccess::Excluded)
            .unwrap();
        assert_eq!(second_env.original.as_deref(), Some("D:AI(original)"));
        let second = release_begin(&ops, &mut ledger, "agent:second").unwrap();
        let second_env = second
            .iter()
            .find(|grant| grant.access == GrantAccess::Excluded)
            .unwrap();
        assert_eq!(second_env.original.as_deref(), Some("D:AI(original)"));
    }

    #[test]
    fn a_newer_run_leaving_first_keeps_the_older_runs_original() {
        let ops = FakeOps::default();
        let mut ledger = ledger();
        with_cli_run(&mut ledger, "agent:first");
        with_cli_run(&mut ledger, "agent:second");
        ledger
            .grants
            .push(excluded_env("agent:first", "S-1-15-2-11", "D:AI(original)"));
        ledger
            .grants
            .push(excluded_env("agent:second", "S-1-15-2-22", "D:P(first's)"));
        let second = release_begin(&ops, &mut ledger, "agent:second").unwrap();
        assert!(second
            .iter()
            .all(|grant| grant.access != GrantAccess::Excluded || grant.original.is_none()));
        let first_env = ledger
            .grants
            .iter()
            .find(|grant| grant.access == GrantAccess::Excluded && grant.sid == "S-1-15-2-11")
            .unwrap();
        assert_eq!(first_env.original.as_deref(), Some("D:AI(original)"));
    }

    #[test]
    fn of_two_runs_cut_off_together_only_the_oldest_writes_the_list_back() {
        let mut ledger = ledger();
        with_cli_run(&mut ledger, "agent:first");
        with_cli_run(&mut ledger, "agent:second");
        ledger
            .grants
            .push(excluded_env("agent:first", "S-1-15-2-11", "D:AI(original)"));
        ledger
            .grants
            .push(excluded_env("agent:second", "S-1-15-2-22", "D:P(first's)"));
        ledger.containers.remove("Oleafly.Task.agent:first");
        ledger.containers.remove("Oleafly.Task.agent:second");
        let orphans = orphan_revocations(&mut ledger);
        let originals: Vec<Option<&str>> = orphans
            .iter()
            .filter(|grant| grant.access == GrantAccess::Excluded)
            .map(|grant| grant.original.as_deref())
            .collect();
        assert_eq!(originals.len(), 2);
        assert_eq!(
            originals
                .iter()
                .filter(|original| original.is_some())
                .count(),
            1
        );
        assert!(originals.contains(&Some("D:AI(original)")));
    }

    #[test]
    fn completing_an_exclusion_keeps_the_first_original() {
        let mut ledger = Ledger::default();
        let mut record = excluded_env("agent:r", "S-1-15-2-11", "D:AI(original)");
        record.applied = false;
        record.original = None;
        assert_eq!(ledger.begin(&record), Begin::Apply { force: false });
        record.original = Some("D:AI(original)".into());
        ledger.complete(&record);
        record.original = Some("D:P(retry)".into());
        ledger.complete(&record);
        assert_eq!(ledger.grants[0].original.as_deref(), Some("D:AI(original)"));
    }

    #[test]
    fn the_sweep_keeps_shared_grants_it_cannot_prove_are_gone() {
        let mut ops = FakeOps::default();
        ops.presence.insert("/conda".into(), Presence::Unknown);
        ops.presence.insert("/data/p2".into(), Presence::Absent);
        let mut ledger = ledger();
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
        assert_eq!(ledger.grants.len(), 1);
        assert!(!ledger.grants[0].applied);
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
