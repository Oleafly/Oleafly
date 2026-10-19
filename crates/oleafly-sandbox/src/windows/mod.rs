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

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::ledger::{
    self, ContainerRecord, GrantAccess, GrantOps, GrantRecord, GrantScope, Ledger, SharedScope,
};
use crate::{config, Availability, ResolvedSpec, SandboxError, SharedGrantView};
use acl::Access;
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
/// profile can be created and deleted. Checked once per process.
pub(crate) fn availability() -> Availability {
    static CACHED: OnceLock<Availability> = OnceLock::new();
    CACHED
        .get_or_init(|| {
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
                Err(error) => Availability::Unavailable(format!(
                    "The Windows sandbox is unavailable: {error}"
                )),
            }
        })
        .clone()
}

/// What a prepared task launch needs.
pub(crate) struct Prepared {
    pub container: String,
    /// Capability SIDs (SDDL) for the task's token.
    pub capabilities: Vec<String>,
}

struct Granter<'a> {
    ledger: &'a mut Ledger,
    lock: &'a ledger::LedgerLock,
}

impl Granter<'_> {
    /// Records the grant, applies it, and marks it applied.
    fn apply(
        &mut self,
        path: &Path,
        sid: &OwnedSid,
        scope: GrantScope,
        access: GrantAccess,
        call: impl FnOnce() -> Result<(), SandboxError>,
    ) -> Result<(), SandboxError> {
        let sddl = sid.to_sddl()?;
        let existing =
            self.ledger.grants.iter().position(|grant| {
                grant.path == path && grant.sid == sddl && grant.access == access
            });
        if let Some(index) = existing {
            if self.ledger.grants[index].applied {
                return Ok(());
            }
        } else {
            self.ledger.grants.push(GrantRecord {
                path: path.to_path_buf(),
                sid: sddl.clone(),
                scope,
                access,
                applied: false,
            });
            self.lock.save(self.ledger)?;
        }
        call()?;
        if let Some(grant) = self
            .ledger
            .grants
            .iter_mut()
            .find(|grant| grant.path == path && grant.sid == sddl && grant.access == access)
        {
            grant.applied = true;
        }
        self.lock.save(self.ledger)
    }

    /// Traverse entries for `sid` on the ancestors of `root`, up to the
    /// first folder whose access list the user cannot change.
    fn traverse_ancestors(&mut self, root: &Path, sid: &OwnedSid) -> Result<(), SandboxError> {
        let mut current = root.parent();
        while let Some(folder) = current {
            if folder.parent().is_none() {
                break;
            }
            let folder_owned = folder.to_path_buf();
            let result = self.apply(
                &folder_owned,
                sid,
                GrantScope::Runtimes,
                GrantAccess::Traverse,
                || acl::grant_traverse(&folder_owned, sid),
            );
            if result.is_err() {
                // An access-denied folder ends the climb; the rest above it
                // is the user's own business.
                self.ledger.grants.retain(|grant| {
                    !(grant.path == folder_owned
                        && grant.access == GrantAccess::Traverse
                        && !grant.applied)
                });
                self.lock.save(self.ledger)?;
                break;
            }
            current = folder.parent();
        }
        Ok(())
    }
}

/// Creates the task's profile and grants it what `spec` allows.
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
    let lock = ledger::lock(&state)?;
    let mut ledger_state = lock.load();
    let name = container_name(&spec.owner);
    ledger_state
        .containers
        .entry(name.clone())
        .or_insert_with(|| ContainerRecord {
            owner: spec.owner.clone(),
            created_at: now_ms(),
        });
    lock.save(&ledger_state)?;
    let package = container::ensure(&name)?;
    let runtime = capability_sid(RUNTIME_CAPABILITY)?;
    let mut granter = Granter {
        ledger: &mut ledger_state,
        lock: &lock,
    };
    let task_scope = || GrantScope::Task {
        owner: spec.owner.clone(),
    };

    granter.apply(
        &spec.workspace,
        &package,
        task_scope(),
        GrantAccess::Read,
        || acl::grant(&spec.workspace, &package, Access::Read),
    )?;
    let mut writes = spec.read_write.clone();
    writes.sort_by_key(|path| path.components().count());
    for path in &writes {
        let parent_writable = path.parent().is_some_and(|parent| {
            writes
                .iter()
                .any(|other| other != path && parent.starts_with(other))
        });
        if path.is_file() && parent_writable {
            continue;
        }
        granter.apply(path, &package, task_scope(), GrantAccess::ReadWrite, || {
            acl::grant(path, &package, Access::ReadWrite)
        })?;
    }
    granter.apply(
        &spec.home,
        &package,
        task_scope(),
        GrantAccess::ReadWrite,
        || acl::grant(&spec.home, &package, Access::ReadWrite),
    )?;
    for file in spec.protected.iter().filter(|path| path.is_file()) {
        granter.apply(file, &package, task_scope(), GrantAccess::Excluded, || {
            acl::exclude_file(file, &package)
        })?;
    }
    for root in &spec.read_only {
        granter.apply(
            root,
            &runtime,
            GrantScope::Runtimes,
            GrantAccess::Read,
            || acl::grant(root, &runtime, Access::Read),
        )?;
        granter.traverse_ancestors(root, &runtime)?;
    }
    let mut capabilities = vec![runtime.to_sddl()?];
    if let Some(project) = &spec.project {
        if !spec.project_read_only.is_empty() {
            let project_sid = capability_sid(&project_capability(project))?;
            for root in &spec.project_read_only {
                granter.apply(
                    root,
                    &project_sid,
                    GrantScope::Project {
                        project: project.clone(),
                    },
                    GrantAccess::Read,
                    || acl::grant(root, &project_sid, Access::Read),
                )?;
                granter.traverse_ancestors(root, &runtime)?;
            }
            capabilities.push(project_sid.to_sddl()?);
        }
    }
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

/// Writes the Python temp-folder shim into the home when missing or old.
pub(crate) fn write_python_shim(home: &Path) -> std::io::Result<PathBuf> {
    let folder = env::python_shim_dir(home);
    std::fs::create_dir_all(&folder)?;
    let file = folder.join("sitecustomize.py");
    if std::fs::read_to_string(&file).ok().as_deref() != Some(PYTHON_SHIM) {
        std::fs::write(&file, PYTHON_SHIM)?;
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
        let _ = std::fs::create_dir_all(spec.home.join(folder));
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
        let sid = OwnedSid::from_sddl(&record.sid)?;
        match record.access {
            GrantAccess::Traverse => acl::revoke_traverse(&record.path, &sid),
            GrantAccess::Excluded => Ok(()),
            _ => acl::revoke(&record.path, &sid),
        }
    }

    fn present(&self, record: &GrantRecord) -> bool {
        let Ok(sid) = OwnedSid::from_sddl(&record.sid) else {
            return false;
        };
        let access = match record.access {
            GrantAccess::Read | GrantAccess::Excluded => Access::Read,
            GrantAccess::ReadWrite => Access::ReadWrite,
            GrantAccess::Traverse => Access::Traverse,
        };
        record.path.exists() && acl::has_allow(&record.path, &sid, access).unwrap_or(false)
    }
}

fn with_ledger<T>(
    call: impl FnOnce(&mut Ledger) -> Result<T, SandboxError>,
) -> Result<T, SandboxError> {
    let state = state_dir()?;
    let lock = ledger::lock(&state)?;
    let mut ledger_state = lock.load();
    let result = call(&mut ledger_state);
    lock.save(&ledger_state)?;
    result
}

pub(crate) fn release(owner: &str) -> Result<(), SandboxError> {
    with_ledger(|state| ledger::release_with(&RealOps, state, owner))
}

pub(crate) fn release_stale(active: &[String]) -> Result<usize, SandboxError> {
    with_ledger(|state| ledger::release_stale_with(&RealOps, state, active))
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
    let mut views: Vec<SharedGrantView> = lock
        .load()
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
