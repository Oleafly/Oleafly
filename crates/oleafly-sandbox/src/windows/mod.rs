//! The Windows sandbox: every task runs in its own AppContainer profile
//! inside a kill-on-close job. Writes are allowed where a task's write grants
//! say; interpreters and skill folders are readable through one capability
//! shared by all tasks; linked data folders through one capability per
//! project. All access changes go through the write-ahead ledger.
//!
//! std cannot pass the AppContainer attribute to `CreateProcessW`, so a
//! confined command runs the calling binary itself as a small launcher
//! (`--oleafly-sandbox-launch`), which starts the real program.
pub(crate) mod acl;
pub mod cmdline;
pub(crate) mod container;
pub mod env;
pub mod launcher;
pub(crate) mod sid;

use std::collections::{BTreeMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use crate::ledger::{
    self, Begin, ContainerRecord, GrantAccess, GrantOps, GrantRecord, GrantScope, Ledger, Presence,
    SharedScope,
};
use crate::plan::{self, Sids, Step};
use crate::probe::ProbeCache;
use crate::process::identity::{self, ProcessIdentity};
use crate::{config, safe_fs, Availability, ResolvedSpec, SandboxError, SharedGrantView};
use acl::{Access, Deny};
use sid::{
    capability_sid, container_name, project_capability, OwnedSid, INTERNET_CLIENT, PRIVATE_NETWORK,
    RUNTIME_CAPABILITY,
};

const PROBE_NAME: &str = "Oleafly.Probe";
const PYTHON_SHIM: &str = include_str!("sitecustomize.py");
const BATCH_REFUSED: &str =
    "A .cmd or .bat script can't run in the Windows sandbox. Start its program directly.";

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

fn state_dir() -> Result<PathBuf, SandboxError> {
    config()
        .map(|config| config.state_dir.clone())
        .ok_or_else(|| {
            SandboxError::Unsupported("The Windows sandbox is not set up in this program.".into())
        })
}

/// The binary that relaunches into the sandbox.
fn launcher_path() -> Result<PathBuf, SandboxError> {
    let path = match config().and_then(|config| config.launcher.clone()) {
        Some(path) => path,
        None => std::env::current_exe().map_err(|error| SandboxError::Io(error.to_string()))?,
    };
    Ok(crate::plain_path(&path))
}

/// Whether the sandbox works here: configured, the launcher present, and a
/// profile can be created and deleted. A success is remembered for the life
/// of the process, a failure for a short while (a busy profile service or a
/// locked ledger is not a reason to stay off until the app restarts).
pub(crate) fn availability() -> Availability {
    static CACHE: ProbeCache = ProbeCache::new();
    CACHE.get(probe)
}

fn probe() -> Availability {
    let Ok(state) = state_dir() else {
        return Availability::Unavailable(
            "The Windows sandbox is not set up in this program.".into(),
        );
    };
    match launcher_path() {
        Ok(path) if path.is_file() => {}
        _ => return Availability::Unavailable("The sandbox launcher is missing.".into()),
    }
    let probe = (|| {
        let _lock = ledger::lock(&state)?;
        container::ensure(PROBE_NAME)?;
        container::delete(PROBE_NAME)
    })();
    match probe {
        Ok(()) => Availability::Available,
        Err(error) => {
            Availability::Unavailable(format!("The Windows sandbox is unavailable: {error}"))
        }
    }
}

/// What a prepared task launch needs.
pub(crate) struct Prepared {
    pub container: String,
    /// Capability SIDs (SDDL) for the task's token.
    pub capabilities: Vec<String>,
}

type WalkLocks = Mutex<BTreeMap<String, Arc<Mutex<()>>>>;

fn walk_locks() -> &'static WalkLocks {
    static LOCKS: WalkLocks = Mutex::new(BTreeMap::new());
    &LOCKS
}

/// One lock per access entry in this process: a second command that needs
/// the same folder waits for the first one's walk instead of repeating it.
/// The entry leaves the map when the last command that wanted it is done.
struct WalkLock {
    key: String,
    lock: Arc<Mutex<()>>,
}

impl Drop for WalkLock {
    fn drop(&mut self) {
        let mut locks = walk_locks().lock().unwrap_or_else(PoisonError::into_inner);
        // This handle and the map's own: nobody else holds or waits for it,
        // and nobody can take it without the map's lock.
        if Arc::strong_count(&self.lock) == 2 {
            locks.remove(&self.key);
        }
    }
}

fn walk_lock(record: &GrantRecord) -> WalkLock {
    let key = format!(
        "{}|{}|{:?}",
        record.path.display(),
        record.sid,
        record.access
    );
    let mut locks = walk_locks().lock().unwrap_or_else(PoisonError::into_inner);
    let lock = Arc::clone(locks.entry(key.clone()).or_default());
    WalkLock { key, lock }
}

/// Writes the entry `record` describes. `force` walks the folder again even
/// when its own entry is there. An exclusion returns the file's access list
/// from before (SDDL).
fn apply(record: &GrantRecord, force: bool) -> Result<Option<String>, SandboxError> {
    let sid = OwnedSid::from_sddl(&record.sid)?;
    let path = record.path.as_path();
    let none = |result: Result<(), SandboxError>| result.map(|()| None);
    match record.access {
        GrantAccess::Read => none(acl::grant(path, &sid, Access::Read, force)),
        GrantAccess::ReadWrite => none(acl::grant(path, &sid, Access::ReadWrite, force)),
        GrantAccess::Traverse => none(acl::grant_traverse(path, &sid)),
        GrantAccess::Excluded => acl::exclude_file(path, &sid).map(Some),
        GrantAccess::DenyWrite => none(acl::deny(path, &sid, Deny::Write)),
        GrantAccess::DenyAll => none(acl::deny(path, &sid, Deny::All)),
        GrantAccess::DenyDeleteChild => none(acl::deny_delete_child(path, &sid)),
    }
}

/// Entries on one folder alone, with no walk below it. They are quick, so
/// they skip the ledger round trip of [`run_step`] and their marks are saved
/// together at the end of [`prepare`].
fn is_quick(access: GrantAccess) -> bool {
    matches!(access, GrantAccess::Traverse | GrantAccess::DenyDeleteChild)
}

/// Makes one entry, outside the ledger lock: the walk below a folder can
/// take minutes, and everything else that needs the ledger (other tasks,
/// the Settings page, the startup sweep) must not wait for it. The record
/// was saved before; it is marked applied afterwards.
fn run_step(state: &Path, step: &Step, force: bool) -> Result<(), SandboxError> {
    let walk = walk_lock(&step.record);
    let _held = walk.lock.lock().unwrap_or_else(PoisonError::into_inner);
    // Another command may have finished this entry while this one waited.
    if ledger::lock(state)?.load()?.is_applied(&step.record) {
        return Ok(());
    }
    let original = apply(&step.record, force)?;
    let lock = ledger::lock(state)?;
    let mut ledger_state = lock.load()?;
    ledger_state.complete(&GrantRecord {
        original,
        ..step.record.clone()
    });
    lock.save(&ledger_state)
}

/// Makes a quick entry (see [`is_quick`]) without touching the ledger.
fn run_quick_step(step: &Step, force: bool) -> Result<(), SandboxError> {
    let walk = walk_lock(&step.record);
    let _held = walk.lock.lock().unwrap_or_else(PoisonError::into_inner);
    apply(&step.record, force).map(|_| ())
}

/// Saves the marks of the quick entries of one [`prepare`] in one go: the
/// ones made, and the traverse entries a folder refused (not needed).
fn settle_quick_steps(
    state: &Path,
    finished: &[GrantRecord],
    refused: &[GrantRecord],
) -> Result<(), SandboxError> {
    if finished.is_empty() && refused.is_empty() {
        return Ok(());
    }
    let lock = ledger::lock(state)?;
    let mut ledger_state = lock.load()?;
    for record in finished {
        ledger_state.complete(record);
    }
    for record in refused {
        ledger_state.forget_unapplied(record);
    }
    lock.save(&ledger_state)
}

/// Creates the task's profile and grants it what `spec` allows. The ledger
/// lock is held to record what is about to be written and to mark it done,
/// never during the writes themselves.
pub(crate) fn prepare(spec: &ResolvedSpec) -> Result<Prepared, SandboxError> {
    if spec.owner.trim().is_empty() {
        return Err(SandboxError::Invalid(
            "A sandboxed command needs an owner.".into(),
        ));
    }
    if !spec.project_read_only.is_empty() && spec.project.is_none() {
        return Err(SandboxError::Invalid(
            "Linked data folders need a project.".into(),
        ));
    }
    let state = state_dir()?;
    // A deny entry needs something to sit on: a protected folder that isn't
    // there yet is created empty first.
    crate::resolve::create_missing_protected(spec)?;
    let name = container_name(&spec.owner);
    let (steps, pending, capabilities) = {
        let lock = ledger::lock(&state)?;
        let mut ledger_state = lock.load()?;
        // The process that uses the profile is on record, so a sweep can
        // tell a run that was killed from one that is working.
        let process = Some(identity::current());
        match ledger_state.containers.get_mut(&name) {
            None => {
                ledger_state.containers.insert(
                    name.clone(),
                    ContainerRecord {
                        owner: spec.owner.clone(),
                        created_at: now_ms(),
                        process,
                    },
                );
                lock.save(&ledger_state)?;
            }
            Some(record) if record.process != process => {
                record.process = process;
                lock.save(&ledger_state)?;
            }
            Some(_) => {}
        }
        let package = container::ensure(&name)?;
        let runtime = capability_sid(RUNTIME_CAPABILITY)?;
        let project = match (&spec.project, spec.project_read_only.is_empty()) {
            (Some(project), false) => Some(capability_sid(&project_capability(project))?),
            _ => None,
        };
        let package_sddl = package.to_sddl()?;
        let runtime_sddl = runtime.to_sddl()?;
        let project_sddl = project.as_ref().map(OwnedSid::to_sddl).transpose()?;
        let steps = plan::plan(
            spec,
            &Sids {
                package: &package_sddl,
                runtime: &runtime_sddl,
                project: project_sddl.as_deref(),
            },
        );
        let mut pending = Vec::new();
        let mut recorded = false;
        for (index, step) in steps.iter().enumerate() {
            if let Begin::Apply { force } = ledger_state.begin(&step.record) {
                // A new record is written ahead of its call; one found
                // unfinished is already on file.
                recorded |= !force;
                pending.push((index, force));
            }
        }
        if recorded {
            lock.save(&ledger_state)?;
        }
        let mut capabilities = vec![runtime_sddl];
        capabilities.extend(project_sddl);
        (steps, pending, capabilities)
    };
    let mut refused: HashSet<usize> = HashSet::new();
    let mut quick_finished = Vec::new();
    let mut quick_refused = Vec::new();
    let mut outcome = Ok(());
    for (index, force) in pending {
        let step = &steps[index];
        if step.chain.is_some_and(|chain| refused.contains(&chain)) {
            continue;
        }
        let result = if is_quick(step.record.access) {
            run_quick_step(step, force).map(|()| quick_finished.push(step.record.clone()))
        } else {
            run_step(&state, step, force)
        };
        if let Err(error) = result {
            match step.chain {
                // A folder that refuses a traverse entry ends that climb; the
                // rest above it is the user's own business.
                Some(chain) => {
                    refused.insert(chain);
                    quick_refused.push(step.record.clone());
                }
                None => {
                    outcome = Err(error);
                    break;
                }
            }
        }
    }
    // The quick entries made so far are on record even when a later one
    // failed.
    let settled = settle_quick_steps(&state, &quick_finished, &quick_refused);
    outcome?;
    settled?;
    Ok(Prepared {
        container: name,
        capabilities,
    })
}

/// `%SystemRoot%\System32\cmd.exe`.
pub(crate) fn cmd_exe() -> PathBuf {
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| OsString::from(r"C:\Windows"));
    PathBuf::from(root).join("System32").join("cmd.exe")
}

/// Writes the Python temp-folder shim into the home when missing or old. The
/// task can write in its home and turn a folder there into a junction, so
/// the folder is created without following links (a link is an error) and
/// the file is replaced, never written through.
pub(crate) fn write_python_shim(home: &Path) -> std::io::Result<PathBuf> {
    let shim_dir = env::python_shim_dir(home);
    let relative = shim_dir.strip_prefix(home).map_err(std::io::Error::other)?;
    let folder = safe_fs::create_folders_below(home, relative)?;
    let file = folder.join("sitecustomize.py");
    let current = match std::fs::symlink_metadata(&file) {
        Ok(metadata) if metadata.is_file() && !safe_fs::is_link(&metadata) => {
            std::fs::read_to_string(&file).ok()
        }
        _ => None,
    };
    if current.as_deref() != Some(PYTHON_SHIM) {
        safe_fs::replace_file(&file, PYTHON_SHIM.as_bytes())?;
    }
    Ok(file)
}

/// A confined command for `program args`.
pub(crate) fn command(
    spec: &ResolvedSpec,
    program: &Path,
    args: &[OsString],
) -> Result<std::process::Command, SandboxError> {
    use std::os::windows::ffi::OsStrExt;
    let program_wide: Vec<u16> = program.as_os_str().encode_wide().collect();
    let args_wide: Vec<Vec<u16>> = args.iter().map(|arg| arg.encode_wide().collect()).collect();
    command_raw(
        spec,
        program,
        cmdline::command_line(&program_wide, &args_wide),
    )
}

/// A confined command with a ready command line.
pub(crate) fn command_raw(
    spec: &ResolvedSpec,
    program: &Path,
    command_line: Vec<u16>,
) -> Result<std::process::Command, SandboxError> {
    if !program.is_absolute() {
        return Err(SandboxError::Invalid(
            "The sandboxed program needs an absolute path.".into(),
        ));
    }
    let extension = program
        .extension()
        .map(|extension| extension.to_string_lossy().to_ascii_lowercase());
    if matches!(extension.as_deref(), Some("cmd") | Some("bat")) {
        return Err(SandboxError::Invalid(BATCH_REFUSED.into()));
    }
    let prepared = prepare(spec)?;
    write_python_shim(&spec.home).map_err(|error| SandboxError::Io(error.to_string()))?;
    for folder in ["tmp", "AppData/Roaming", "AppData/Local"] {
        let _ = safe_fs::create_folders_below(&spec.home, Path::new(folder));
    }
    let mut capabilities = prepared.capabilities;
    if spec.network {
        capabilities.push(INTERNET_CLIENT.into());
        capabilities.push(PRIVATE_NETWORK.into());
    }
    let launch = launcher::LaunchArgs {
        container: prepared.container,
        capabilities,
        application: crate::plain_path(program),
        command_line: OsString::from(String::from_utf16_lossy(&command_line)),
    };
    let mut env = env::base_env(
        &|name| std::env::var_os(name),
        &spec.home,
        &spec.path_prepend,
    );
    for (name, value) in &spec.env {
        if name == crate::SANDBOX_ENV {
            continue;
        }
        if name.eq_ignore_ascii_case("PYTHONPATH") {
            // The shim folder stays first.
            let shim = env::python_shim_dir(&spec.home);
            let mut joined = shim.into_os_string();
            joined.push(";");
            joined.push(value);
            env.insert("PYTHONPATH".into(), joined);
            continue;
        }
        env.insert(name.clone(), OsString::from(value));
    }
    let mut command = std::process::Command::new(launcher_path()?);
    command
        .arg(launcher::LAUNCH_FLAG)
        .args(launcher::encode(&launch))
        .env_clear()
        .envs(env)
        .current_dir(crate::plain_path(&spec.workspace));
    Ok(command)
}

/// The real Windows operations for the ledger's release logic.
struct RealOps;

impl GrantOps for RealOps {
    fn delete_container(&self, name: &str) -> Result<(), SandboxError> {
        container::delete(name)
    }

    fn revoke(&self, record: &GrantRecord) -> Result<(), SandboxError> {
        // A folder that is gone has nothing to revoke. Any other failure to
        // reach it is reported, and the record stays.
        if let Err(error) = std::fs::symlink_metadata(&record.path) {
            if error.kind() == std::io::ErrorKind::NotFound {
                return Ok(());
            }
        }
        let sid = OwnedSid::from_sddl(&record.sid)?;
        match record.access {
            GrantAccess::Traverse | GrantAccess::DenyDeleteChild => {
                acl::revoke_traverse(&record.path, &sid)
            }
            // Only the last run that excludes the file carries its original
            // list (see `ledger::hand_over_originals`).
            GrantAccess::Excluded => match &record.original {
                Some(original) => acl::restore_file(&record.path, &sid, original),
                None => Ok(()),
            },
            GrantAccess::Read
            | GrantAccess::ReadWrite
            | GrantAccess::DenyWrite
            | GrantAccess::DenyAll => acl::revoke(&record.path, &sid),
        }
    }

    fn present(&self, record: &GrantRecord) -> Presence {
        let Ok(sid) = OwnedSid::from_sddl(&record.sid) else {
            return Presence::Unknown;
        };
        let access = match record.access {
            GrantAccess::Read => Access::Read,
            GrantAccess::ReadWrite => Access::ReadWrite,
            GrantAccess::Traverse => Access::Traverse,
            // Only shared read entries are checked, and these belong to a
            // task.
            _ => return Presence::Unknown,
        };
        // A folder that is missing or can't be reached (an unplugged drive,
        // a locked file) proves nothing about its entry.
        if std::fs::symlink_metadata(&record.path).is_err() {
            return Presence::Unknown;
        }
        match acl::has_allow(&record.path, &sid, access) {
            Ok(true) => Presence::Present,
            Ok(false) => Presence::Absent,
            Err(_) => Presence::Unknown,
        }
    }

    fn process_is_live(&self, process: Option<ProcessIdentity>) -> bool {
        let current = identity::current();
        // This process's own runs are working; a record with this pid and
        // another start time is from an earlier process.
        process == Some(current) || identity::owner_is_live(process, current, identity::probe)
    }
}

fn with_ledger<T>(
    call: impl FnOnce(&mut Ledger) -> Result<T, SandboxError>,
) -> Result<T, SandboxError> {
    let state = state_dir()?;
    let lock = ledger::lock(&state)?;
    // A ledger that can't be read stops here, before anything is saved over it.
    let mut ledger_state = lock.load()?;
    let result = call(&mut ledger_state);
    lock.save(&ledger_state)?;
    result
}

/// Revokes `records` with the ledger unlocked (a walk below a project can
/// take minutes), then forgets the ones that went. The ones that failed stay
/// on record for the next sweep; the first failure is returned.
fn revoke_and_forget(records: &[GrantRecord]) -> Result<(), SandboxError> {
    let mut done = Vec::new();
    let mut first_error = None;
    for record in records {
        match RealOps.revoke(record) {
            Ok(()) => done.push(record.clone()),
            Err(error) => {
                first_error.get_or_insert(error);
            }
        }
    }
    if !done.is_empty() {
        with_ledger(|state| {
            state.forget(&done);
            Ok(())
        })?;
    }
    first_error.map_or(Ok(()), Err)
}

/// Deletes `owner`'s profile and, for a run that worked on folders that
/// stay, takes its entries off them. Walks the folders, so call it off the
/// UI and async threads.
pub(crate) fn release(owner: &str) -> Result<(), SandboxError> {
    let to_revoke = with_ledger(|state| ledger::release_begin(&RealOps, state, owner))?;
    revoke_and_forget(&to_revoke)
}

/// Releases the runs other than research tasks whose process is gone.
pub(crate) fn release_abandoned() -> Result<usize, SandboxError> {
    let (released, orphans) = with_ledger(|state| {
        let released = ledger::release_abandoned_with(&RealOps, state)?;
        Ok((released, ledger::orphan_revocations(state)))
    })?;
    revoke_and_forget(&orphans)?;
    Ok(released)
}

pub(crate) fn release_stale(active: &[String]) -> Result<usize, SandboxError> {
    let (released, orphans) = with_ledger(|state| {
        let released = ledger::release_stale_with(&RealOps, state, active)?;
        Ok((released, ledger::orphan_revocations(state)))
    })?;
    // Entries an earlier run left behind (it was cut off before it could
    // take them off its folders).
    revoke_and_forget(&orphans)?;
    Ok(released)
}

pub(crate) fn remove_shared_access(scope: SharedScope) -> Result<usize, SandboxError> {
    with_ledger(|state| ledger::remove_shared_with(&RealOps, state, scope))
}

pub(crate) fn shared_grants() -> Vec<SharedGrantView> {
    let Ok(state) = state_dir() else {
        return Vec::new();
    };
    let Ok(lock) = ledger::lock(&state) else {
        return Vec::new();
    };
    let Ok(ledger_state) = lock.load() else {
        return Vec::new();
    };
    let mut views: Vec<SharedGrantView> = ledger_state
        .grants
        .into_iter()
        .filter(|grant| grant.applied && grant.access != GrantAccess::Traverse)
        .filter_map(|grant| match grant.scope {
            GrantScope::Runtimes => Some(SharedGrantView {
                path: grant.path,
                scope: "runtimes".into(),
                project: None,
            }),
            GrantScope::Project { project } => Some(SharedGrantView {
                path: grant.path,
                scope: "project".into(),
                project: Some(project),
            }),
            GrantScope::Task { .. } => None,
        })
        .collect();
    views.sort_by(|left, right| left.path.cmp(&right.path));
    views.dedup_by(|left, right| left.path == right.path && left.project == right.project);
    views
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_python_shim_is_written_and_refreshed() {
        let home = tempfile::tempdir().unwrap();
        let file = write_python_shim(home.path()).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), PYTHON_SHIM);
        std::fs::write(&file, "old").unwrap();
        write_python_shim(home.path()).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), PYTHON_SHIM);
    }

    #[test]
    fn the_python_shim_is_not_written_through_a_junction() {
        let home = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let link = env::python_shim_dir(home.path());
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(elsewhere.path())
            .output()
            .unwrap();
        assert!(
            made.status.success(),
            "{}",
            String::from_utf8_lossy(&made.stdout)
        );
        let error = write_python_shim(home.path()).unwrap_err();
        assert!(safe_fs::is_link_error(&error), "{error}");
        assert!(!elsewhere.path().join("sitecustomize.py").exists());
    }

    #[test]
    fn a_folder_that_is_gone_has_nothing_to_revoke() {
        let gone = tempfile::tempdir().unwrap().path().join("deleted");
        let record = GrantRecord {
            path: gone,
            sid: "S-1-15-3-1024-1".into(),
            scope: GrantScope::Runtimes,
            access: GrantAccess::Read,
            applied: true,
            original: None,
        };
        assert!(RealOps.revoke(&record).is_ok());
        // Missing says nothing about whether the entry is still there.
        assert_eq!(RealOps.present(&record), Presence::Unknown);
    }

    #[test]
    fn a_walk_lock_leaves_the_map_when_the_last_holder_is_done() {
        let record = GrantRecord {
            path: PathBuf::from(r"C:\walk-lock-test"),
            sid: "S-1-15-2-99".into(),
            scope: GrantScope::Runtimes,
            access: GrantAccess::Read,
            applied: false,
            original: None,
        };
        let key = |lock: &WalkLock| lock.key.clone();
        let first = walk_lock(&record);
        let second = walk_lock(&record);
        let name = key(&first);
        assert!(Arc::ptr_eq(&first.lock, &second.lock));
        drop(first);
        // Someone still holds it.
        assert!(walk_locks()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains_key(&name));
        drop(second);
        assert!(!walk_locks()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains_key(&name));
    }

    #[test]
    fn this_process_and_its_own_runs_are_live_and_a_gone_one_is_not() {
        let current = identity::current();
        assert!(RealOps.process_is_live(Some(current)));
        assert!(!RealOps.process_is_live(None));
        // An earlier process with this pid.
        assert!(!RealOps.process_is_live(Some(ProcessIdentity {
            pid: current.pid,
            started: current.started.map(|started| started.wrapping_add(1)),
        })));
    }
}
