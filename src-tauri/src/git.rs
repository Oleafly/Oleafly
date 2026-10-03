use serde::Serialize;
use std::collections::{BTreeSet, HashMap};
use std::ffi::{OsStr, OsString};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use crate::config;
use crate::paths;
use crate::proc::{NoConsole, OutputBounds};

/// A transfer over someone's own uplink can legitimately take many minutes, so
/// judge it by silence rather than by elapsed time: a push that is slow but
/// still moving must finish. `--progress` at every remote call site is what
/// makes that measurable, because Git reports progress once stderr is a pipe
/// only when it is asked to. The total is a backstop for a process that hangs
/// while still dribbling output, not a policy on how long a push may take.
const REMOTE_IDLE: std::time::Duration = std::time::Duration::from_secs(120);
const REMOTE_TOTAL: std::time::Duration = std::time::Duration::from_secs(60 * 60);

fn remote_bounds() -> OutputBounds {
    OutputBounds::stalled_after(REMOTE_IDLE, REMOTE_TOTAL)
}

const LOCAL_DEADLINE: std::time::Duration = std::time::Duration::from_secs(120);
const WORKTREE_SCALE_DEADLINE: std::time::Duration = std::time::Duration::from_secs(600);

fn git_subcommand<'a>(args: &[&'a str]) -> Option<&'a str> {
    let mut args = args.iter().copied();
    while let Some(arg) = args.next() {
        match arg {
            "-c" | "-C" => {
                args.next();
            }
            _ if arg.starts_with('-') => {}
            _ => return Some(arg),
        }
    }
    None
}

fn walks_the_working_tree(args: &[&str]) -> bool {
    match git_subcommand(args) {
        Some(
            "add" | "checkout" | "clean" | "commit" | "gc" | "merge" | "read-tree" | "reset"
            | "restore" | "rm" | "stash" | "status" | "switch",
        ) => true,
        Some("diff") => !args
            .iter()
            .any(|arg| matches!(*arg, "--cached" | "--staged" | "--no-index")),
        _ => false,
    }
}

fn local_bounds(args: &[&str]) -> OutputBounds {
    OutputBounds::total(if walks_the_working_tree(args) {
        WORKTREE_SCALE_DEADLINE
    } else {
        LOCAL_DEADLINE
    })
}

fn project_root(project_id: &str) -> Result<PathBuf, String> {
    let root = paths::project_dir(project_id)?;
    crate::trust::require_git(project_id, &root)?;
    Ok(root)
}

pub(crate) fn null_device() -> &'static str {
    if cfg!(windows) {
        "NUL"
    } else {
        "/dev/null"
    }
}

fn run_git(root: &PathBuf, args: &[&str]) -> Result<std::process::Output, String> {
    run_git_with_optional_locks(root, args, true)
}

fn run_git_read_only(root: &PathBuf, args: &[&str]) -> Result<std::process::Output, String> {
    let mut hardened: Vec<&str> = vec!["-c", "core.fsmonitor=false"];
    hardened.extend_from_slice(args);
    run_git_with_optional_locks(root, &hardened, false)
}

fn run_git_with_optional_locks(
    root: &PathBuf,
    args: &[&str],
    optional_locks: bool,
) -> Result<std::process::Output, String> {
    run_configured_git(root, args, optional_locks, |_| {})
}

fn run_configured_git(
    root: &PathBuf,
    args: &[&str],
    optional_locks: bool,
    configure: impl FnOnce(&mut Command),
) -> Result<std::process::Output, String> {
    run_configured_git_bounded(root, args, optional_locks, local_bounds(args), configure)
}

const GIT_IDENTITY_ENV: [&str; 6] = [
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_AUTHOR_DATE",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
    "GIT_COMMITTER_DATE",
];

pub(crate) const GIT_REPOSITORY_ENV: [&str; 16] = [
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
    "GIT_OBJECT_DIRECTORY",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_IMPLICIT_WORK_TREE",
    "GIT_GRAFT_FILE",
    "GIT_INDEX_FILE",
    "GIT_NO_REPLACE_OBJECTS",
    "GIT_REPLACE_REF_BASE",
    "GIT_PREFIX",
    "GIT_SHALLOW_FILE",
    "GIT_COMMON_DIR",
    // Older Git, such as 2.34, still lists it in `rev-parse --local-env-vars`.
    "GIT_INTERNAL_SUPER_PREFIX",
];

/// Variables that change how Git reads every pathspec. Publishing passes
/// `:(exclude,literal)` pathspecs, which an inherited `GIT_LITERAL_PATHSPECS`
/// would turn into plain file names.
const GIT_PATHSPEC_ENV: [&str; 4] = [
    "GIT_LITERAL_PATHSPECS",
    "GIT_GLOB_PATHSPECS",
    "GIT_NOGLOB_PATHSPECS",
    "GIT_ICASE_PATHSPECS",
];

pub(crate) fn clear_inherited_git_env(command: &mut Command) {
    for variable in GIT_REPOSITORY_ENV
        .into_iter()
        .chain(GIT_IDENTITY_ENV)
        .chain(GIT_PATHSPEC_ENV)
    {
        command.env_remove(variable);
    }
}

fn run_configured_git_bounded(
    root: &PathBuf,
    args: &[&str],
    optional_locks: bool,
    bounds: OutputBounds,
    configure: impl FnOnce(&mut Command),
) -> Result<std::process::Output, String> {
    let program = git_program();
    if !git_available_as(&program) {
        return Err(git_not_installed());
    }
    let mut command = Command::new(&program);
    command.no_console().args(args).current_dir(root);
    #[cfg(test)]
    testing::apply_inherited_env(&mut command);
    clear_inherited_git_env(&mut command);
    command.env("GIT_OPTIONAL_LOCKS", if optional_locks { "1" } else { "0" });
    configure(&mut command);
    crate::proc::output_contained_with_bounds(command, bounds).map_err(|error| {
        // A missing working folder also fails with NotFound, so only blame
        // Git when a fresh probe agrees that it has gone.
        if error.kind() == std::io::ErrorKind::NotFound && root.is_dir() {
            forget_git_probe(&program);
            if !git_available_as(&program) {
                return git_not_installed();
            }
        }
        format!("failed to run git: {error}")
    })
}

fn git_not_installed() -> String {
    crate::app_error::AppError::new("git.not_installed").into()
}

/// A missing Git is probed again after this long, so installing it while
/// Oleafly runs is noticed without a restart. A found Git stays found until a
/// spawn cannot find it.
const MISSING_GIT_RECHECK: Duration = Duration::from_secs(5);
/// Bound for `git --version` and `xcode-select -p`.
const GIT_PROBE_DEADLINE: Duration = Duration::from_secs(10);

/// The program every Git spawn in this module runs. Tests point it at a path
/// that does not exist, because a PATH override cannot hide a program on
/// Windows.
/// The `git` program to start: the one the program locator finds (which also
/// sees installs made after Oleafly started), or a bare `git` otherwise.
pub(crate) fn git_program() -> OsString {
    #[cfg(test)]
    if let Some(program) = testing::program_override() {
        return program;
    }
    crate::program_locator::locate_native("git")
        .map(|located| located.path.into_os_string())
        .unwrap_or_else(|| OsString::from("git"))
}

struct GitProbe {
    available: bool,
    checked: Instant,
}

fn git_probes() -> &'static Mutex<HashMap<OsString, GitProbe>> {
    static PROBES: OnceLock<Mutex<HashMap<OsString, GitProbe>>> = OnceLock::new();
    PROBES.get_or_init(Default::default)
}

/// Whether a usable `git` program is installed. Cached, so callers may ask
/// before every spawn.
pub(crate) fn git_available() -> bool {
    git_available_as(&git_program())
}

fn git_available_as(program: &OsStr) -> bool {
    // Holding the lock while probing keeps concurrent callers to one probe.
    let mut probes = git_probes().lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(probe) = probes.get(program) {
        if probe.available || probe.checked.elapsed() < MISSING_GIT_RECHECK {
            return probe.available;
        }
    }
    let available = probe_git(program, developer_tools_installed);
    probes.insert(
        program.to_os_string(),
        GitProbe {
            available,
            checked: Instant::now(),
        },
    );
    drop(probes);
    if !available {
        note_missing_git(program);
    }
    available
}

fn forget_git_probe(program: &OsStr) {
    git_probes()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(program);
}

/// Write the missing program to the app log once per session.
fn note_missing_git(program: &OsStr) {
    static LOGGED: AtomicBool = AtomicBool::new(false);
    if cfg!(test) || LOGGED.swap(true, Ordering::Relaxed) {
        return;
    }
    let _ = crate::project::append_app_log(format!(
        "Git is not installed or could not start ({}). Source Control stays off until it is installed.",
        program.to_string_lossy()
    ));
}

/// Run `program --version` the way every Git spawn runs it. On macOS the
/// `/usr/bin/git` placeholder only offers to install Apple's developer tools,
/// so it counts as missing, and is never started, until they are installed.
fn probe_git(program: &OsStr, developer_tools_installed: impl FnOnce() -> bool) -> bool {
    if resolve_program(program).is_some_and(|path| is_developer_tools_placeholder(&path))
        && !developer_tools_installed()
    {
        return false;
    }
    let mut command = Command::new(program);
    command
        .no_console()
        .arg("--version")
        .current_dir(std::env::temp_dir());
    clear_inherited_git_env(&mut command);
    crate::proc::output_contained_with_bounds(command, OutputBounds::total(GIT_PROBE_DEADLINE))
        .is_ok_and(|output| output.status.success() && output.stdout.starts_with(b"git version"))
}

/// Where a spawn of `program` would look first: the path itself when it names
/// a folder, else the first match in the process PATH.
fn resolve_program(program: &OsStr) -> Option<PathBuf> {
    let path = Path::new(program);
    if path.is_absolute() || path.components().count() > 1 {
        return Some(path.to_path_buf());
    }
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|folder| folder.join(program))
        .find(|candidate| candidate.is_file())
}

fn is_developer_tools_placeholder(program: &Path) -> bool {
    cfg!(target_os = "macos") && program == Path::new("/usr/bin/git")
}

/// Whether Apple's developer tools are installed, so the `/usr/bin/git`
/// placeholder runs the real Git instead of asking to install them.
fn developer_tools_installed() -> bool {
    let mut command = Command::new("/usr/bin/xcode-select");
    command
        .no_console()
        .arg("-p")
        .current_dir(std::env::temp_dir());
    let Ok(output) =
        crate::proc::output_contained_with_bounds(command, OutputBounds::total(GIT_PROBE_DEADLINE))
    else {
        return false;
    };
    output.status.success()
        && Path::new(String::from_utf8_lossy(&output.stdout).trim())
            .join("usr")
            .join("bin")
            .join("git")
            .is_file()
}

#[cfg(test)]
pub(crate) mod testing {
    use std::cell::RefCell;
    use std::ffi::OsString;
    use std::process::Command;

    thread_local! {
        static PROGRAM: RefCell<Option<OsString>> = const { RefCell::new(None) };
        static INHERITED: RefCell<Vec<(OsString, OsString)>> = const { RefCell::new(Vec::new()) };
    }

    /// Restores this thread's inherited Git variables when dropped.
    pub(crate) struct InheritedEnvOverride(Vec<(OsString, OsString)>);

    /// Start this thread's Git spawns with these variables, as if Oleafly had
    /// inherited them, without touching the process environment. They are set
    /// before the inherited Git variables are cleared.
    pub(crate) fn inherit_git_env(variables: Vec<(OsString, OsString)>) -> InheritedEnvOverride {
        InheritedEnvOverride(INHERITED.with(|slot| slot.replace(variables)))
    }

    pub(super) fn apply_inherited_env(command: &mut Command) {
        INHERITED.with(|slot| {
            for (name, value) in slot.borrow().iter() {
                command.env(name, value);
            }
        });
    }

    impl Drop for InheritedEnvOverride {
        fn drop(&mut self) {
            let previous = std::mem::take(&mut self.0);
            INHERITED.with(|slot| *slot.borrow_mut() = previous);
        }
    }

    /// Restores this thread's Git program when dropped.
    pub(crate) struct GitProgramOverride(Option<OsString>);

    /// Run this thread's Git spawns with `program` instead of `git`.
    pub(crate) fn use_git_program(program: impl Into<OsString>) -> GitProgramOverride {
        let previous = PROGRAM.with(|slot| slot.replace(Some(program.into())));
        GitProgramOverride(previous)
    }

    pub(super) fn program_override() -> Option<OsString> {
        PROGRAM.with(|slot| slot.borrow().clone())
    }

    impl Drop for GitProgramOverride {
        fn drop(&mut self) {
            let previous = self.0.take();
            PROGRAM.with(|slot| *slot.borrow_mut() = previous);
        }
    }
}

/// Reach a remote without a token: public clones and pulls still transfer over
/// the same uplink, so they get the same silence-based bound.
fn run_git_remote(root: &PathBuf, args: &[&str]) -> Result<std::process::Output, String> {
    run_configured_git_bounded(root, args, true, remote_bounds(), |_| {})
}

pub(crate) fn ensure_repository(project_dir: &Path) -> Result<bool, String> {
    ensure_repository_with(project_dir, |_| {})
}

fn ensure_repository_with(
    project_dir: &Path,
    configure: impl Fn(&mut Command),
) -> Result<bool, String> {
    if project_dir.join(".git").exists() {
        return Ok(false);
    }
    if enclosing_repository(project_dir).is_some() {
        return Ok(false);
    }
    let root = project_dir.to_path_buf();
    let branch = default_branch(&root);
    ok_or_err(run_configured_git(
        &root,
        &["init", "--quiet", "--initial-branch", &branch],
        true,
        &configure,
    )?)?;
    ensure_private_exclude(&root, Excludes::NewRepository)?;
    ensure_git_identity_with(&root, &configure)?;
    Ok(true)
}

fn ensure_git_identity(root: &PathBuf) -> Result<(), String> {
    ensure_git_identity_with(root, |_| {})
}

fn ensure_git_identity_with(
    root: &PathBuf,
    configure: impl Fn(&mut Command),
) -> Result<(), String> {
    let email = run_configured_git(root, &["config", "user.email"], true, &configure)?;
    if String::from_utf8_lossy(&email.stdout).trim().is_empty() {
        ok_or_err(run_configured_git(
            root,
            &["config", "user.email", "oleafly@local"],
            true,
            &configure,
        )?)?;
        ok_or_err(run_configured_git(
            root,
            &["config", "user.name", "Oleafly"],
            true,
            &configure,
        )?)?;
    }
    Ok(())
}

fn default_branch(root: &PathBuf) -> String {
    let configured = run_git(root, &["config", "--get", "init.defaultBranch"])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|branch| !branch.is_empty());

    configured
        .filter(|branch| {
            run_git(root, &["check-ref-format", "--branch", branch])
                .is_ok_and(|output| output.status.success())
        })
        .unwrap_or_else(|| "main".to_string())
}

fn initialize_repo(root: &PathBuf, branch: &str) -> Result<(), String> {
    ok_or_err(run_git(
        root,
        &["init", "--quiet", "--initial-branch", branch],
    )?)?;
    ensure_git_identity(root)?;
    ensure_private_exclude(root, Excludes::NewRepository)
}

/// Which lines [`ensure_private_exclude`] makes sure are in a repository's
/// private exclude file (`.git/info/exclude`).
#[derive(Clone, Copy)]
enum Excludes {
    /// Only `.oleafly/`. Used when staging, which can happen in a repository
    /// the user made: its own build outputs stay visible and stageable, and
    /// no line written here can make Git refuse a path the user picked,
    /// because paths inside `.oleafly` are refused before Git runs.
    StateFolder,
    /// Every line of [`private_exclude_lines`]. Used only when Oleafly creates
    /// the repository itself.
    NewRepository,
}

impl Excludes {
    fn lines(self) -> Vec<&'static str> {
        match self {
            Self::StateFolder => vec![STATE_FOLDER_EXCLUDE],
            Self::NewRepository => private_exclude_lines().collect(),
        }
    }
}

fn ensure_private_exclude(root: &PathBuf, excludes: Excludes) -> Result<(), String> {
    let output = run_git_read_only(root, &["rev-parse", "--git-path", "info/exclude"])?;
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    ok_or_err(output)?;
    if value.is_empty() {
        return Err("Git did not return its repository exclude path".into());
    }
    let path = PathBuf::from(value);
    let exclude = if path.is_absolute() {
        path
    } else {
        root.join(path)
    };
    if let Some(parent) = exclude.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("could not prepare repository excludes: {error}"))?;
    }
    if let Ok(metadata) = std::fs::symlink_metadata(&exclude) {
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("repository exclude path is not a regular file".into());
        }
    }
    let current = std::fs::read(&exclude).unwrap_or_default();
    let current = String::from_utf8_lossy(&current);
    let present: std::collections::HashSet<&str> = current.lines().map(str::trim).collect();
    let mut missing = String::new();
    for line in excludes
        .lines()
        .into_iter()
        .filter(|line| !present.contains(line))
    {
        missing.push_str(line);
        missing.push('\n');
    }
    if missing.is_empty() {
        return Ok(());
    }
    if !current.is_empty() && !current.ends_with('\n') {
        missing.insert(0, '\n');
    }
    use std::io::Write;
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&exclude)
        .and_then(|mut file| file.write_all(missing.as_bytes()))
        .map_err(|error| format!("could not update repository excludes: {error}"))
}

/// Oleafly's own state folder, kept out of every repository Oleafly stages in.
const STATE_FOLDER_EXCLUDE: &str = ".oleafly/";

/// What Oleafly keeps out of a repository it creates, through the private
/// exclude file: its own state folder, operating-system clutter, minted and
/// PythonTeX caches, and TeX build output from tools run outside Oleafly.
/// `.bbl` stays visible because arXiv sources ship it as their bibliography.
/// A repository the user made only ever gets [`STATE_FOLDER_EXCLUDE`].
fn private_exclude_lines() -> impl Iterator<Item = &'static str> {
    [
        STATE_FOLDER_EXCLUDE,
        ".DS_Store",
        "Thumbs.db",
        "desktop.ini",
        "_minted-*/",
        "pythontex-files-*/",
    ]
    .into_iter()
    .chain(
        crate::build_hygiene::BUILD_ARTIFACT_PATTERNS
            .iter()
            .copied(),
    )
}

/// Message of the first commit in a repository Oleafly creates for a new
/// project.
const BASELINE_MESSAGE: &str = "Create project";
/// A new project whose files add up to more than this gets no first commit,
/// so an imported data set is not copied into `.git` on its own.
const BASELINE_SIZE_LIMIT: u64 = 100 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Baseline {
    Committed,
    /// HEAD already has a commit, or there is nothing to commit.
    NotNeeded,
    /// The files add up to this many bytes, which is above the limit.
    TooLarge(u64),
    /// These files usually hold keys, tokens or passwords, so nothing is
    /// staged or committed. Paths are as Git lists them: relative to the
    /// project, with forward slashes.
    SecretFiles(Vec<String>),
}

/// Record every file in a repository that has no commits yet as its first
/// commit. Hooks, signing and the fsmonitor are off for this one commit so a
/// global setting cannot block or prompt during project creation. Nothing is
/// staged above the size limit, or when a file looks like it holds a secret
/// (a key, token or password file an imported folder brought along): once
/// committed, it would stay in history even after the user ignores it. When
/// staging or committing fails, the index is emptied again.
pub(crate) fn commit_baseline(root: &Path) -> Result<Baseline, String> {
    commit_baseline_with_limit(root, BASELINE_SIZE_LIMIT)
}

fn commit_baseline_with_limit(root: &Path, limit: u64) -> Result<Baseline, String> {
    let root = root.to_path_buf();
    if has_head(&root) {
        return Ok(Baseline::NotNeeded);
    }
    let files = untracked_files(&root)?;
    let secrets: Vec<String> = files
        .iter()
        .filter(|path| looks_like_secret(&root, path.as_os_str().as_encoded_bytes()))
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    if !secrets.is_empty() {
        return Ok(Baseline::SecretFiles(secrets));
    }
    let size = files
        .iter()
        .filter_map(|path| std::fs::symlink_metadata(root.join(path)).ok())
        .filter(std::fs::Metadata::is_file)
        .fold(0, |total: u64, metadata| {
            total.saturating_add(metadata.len())
        });
    if size > limit {
        return Ok(Baseline::TooLarge(size));
    }
    let hooks = format!("core.hooksPath={}", null_device());
    let settings = [
        "-c",
        hooks.as_str(),
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.longpaths=true",
        "-c",
        "core.safecrlf=warn",
    ];
    let result = (|| {
        ok_or_err(run_git(&root, &[&settings[..], &["add", "-A"]].concat())?)?;
        if !has_staged_changes(&root) {
            return Ok(Baseline::NotNeeded);
        }
        let commit = ["commit", "--quiet", "--no-verify", "-m", BASELINE_MESSAGE];
        ok_or_err(run_git(&root, &[&settings[..], &commit].concat())?)?;
        Ok(Baseline::Committed)
    })();
    if result.is_err() && !has_head(&root) {
        let _ = unstage_all(&root);
    }
    result
}

/// The files `git add -A` would stage in a repository without commits
/// (untracked and not ignored), relative to `root`, listed before anything is
/// written to the object store.
fn untracked_files(root: &PathBuf) -> Result<Vec<PathBuf>, String> {
    let output = run_git_read_only(root, &["ls-files", "-z", "--others", "--exclude-standard"])?;
    let listing = output.stdout.clone();
    ok_or_err(output)?;
    Ok(listing
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(path_from_git)
        .collect())
}

/// Folders whose files are kept out wherever the folder sits in the project.
const SECRET_FOLDERS: [&[u8]; 7] = [
    b".private",
    b"secrets",
    b"credentials",
    b".ssh",
    b".gnupg",
    b".aws",
    b".kube",
];

/// File names that hold keys, tokens or passwords.
const SECRET_NAMES: [&[u8]; 23] = [
    b".env",
    b".envrc",
    b".renviron",
    b".netrc",
    b"_netrc",
    b".pgpass",
    b"pgpass.conf",
    b".my.cnf",
    b".htpasswd",
    b".git-credentials",
    b".npmrc",
    b".pypirc",
    b".s3cfg",
    b"credentials",
    b"credentials.json",
    b"secrets",
    b"secrets.json",
    b"secrets.toml",
    b"secrets.yaml",
    b"secrets.yml",
    b"kaggle.json",
    b"application_default_credentials.json",
    b"token.pickle",
];

/// Private keys, certificates with their keys, and password stores.
const SECRET_EXTENSIONS: [&[u8]; 9] = [
    b"pem",
    b"key",
    b"p12",
    b"pfx",
    b"p8",
    b"ppk",
    b"jks",
    b"keystore",
    b"kdbx",
];

/// SSH private key names. `<name>.pub` is the public half and is kept.
const SSH_KEY_PREFIXES: [&[u8]; 4] = [b"id_rsa", b"id_dsa", b"id_ecdsa", b"id_ed25519"];

/// How `.env` names with a suffix start, as in `.env.local`, `.env-prod` and
/// `.env_test`.
const ENV_PREFIXES: [&[u8]; 3] = [b".env.", b".env-", b".env_"];

/// The last part of a `.env` name that marks a template without real values,
/// as in `.env.example` or `example.env`.
const ENV_TEMPLATES: [&[u8]; 6] = [
    b"example",
    b"sample",
    b"template",
    b"dist",
    b"defaults",
    b"schema",
];

/// How a zip archive, and so a single-file Keynote document, starts.
const ZIP_SIGNATURE: &[u8; 4] = b"PK\x03\x04";

/// What the name of a project path says about whether it holds a secret.
#[derive(PartialEq)]
enum NameVerdict {
    Secret,
    NotSecret,
    /// A `.key` file, which is a key unless it is a Keynote document.
    KeyFile,
}

/// Whether a project file looks like it holds keys, tokens or passwords, so
/// publishing must not stage it. `relative` is the path inside `root` as Git
/// lists it. Names are compared case-insensitively on every system, so `.ENV`
/// and `Server.PEM` count, and a name that is not valid Unicode is still read.
///
/// - Any file inside a `.private`, `secrets`, `credentials`, `.ssh`, `.gnupg`,
///   `.aws` or `.kube` folder, wherever that folder is.
/// - The names in [`SECRET_NAMES`], such as `.env`, `.netrc` and
///   `credentials.json`.
/// - `.env.<anything>`, `.env-<anything>`, `.env_<anything>` and
///   `<name>.env`, except templates whose last part is one of
///   [`ENV_TEMPLATES`], such as `.env.example`.
/// - `client_secret*.json`, and SSH keys named `id_rsa`, `id_ed25519` and so
///   on, but not their `.pub` public keys.
/// - The extensions in [`SECRET_EXTENSIONS`]. A `.key` file that starts with a
///   zip signature is a Keynote presentation and is kept: PEM, DER, OpenSSH
///   and PuTTY keys never start with it. Any other `.key` file, one that
///   cannot be read, or a link counts.
///
/// Extension rules look only at the file name, so a `.env` virtualenv folder
/// or a `talk.key` Keynote package folder never matches by itself.
fn looks_like_secret(root: &Path, relative: &[u8]) -> bool {
    match judge_name(relative) {
        NameVerdict::Secret => true,
        NameVerdict::NotSecret => false,
        NameVerdict::KeyFile => !is_keynote_document(&root.join(path_from_git(relative))),
    }
}

/// The name rules of [`looks_like_secret`]. Git separates folders with `/` on
/// every system, so a path is judged the same everywhere.
fn judge_name(relative: &[u8]) -> NameVerdict {
    let names: Vec<Vec<u8>> = relative
        .split(|byte| *byte == b'/')
        .filter(|name| !name.is_empty())
        .map(<[u8]>::to_ascii_lowercase)
        .collect();
    let Some((name, folders)) = names.split_last() else {
        return NameVerdict::NotSecret;
    };
    if folders
        .iter()
        .any(|folder| SECRET_FOLDERS.contains(&folder.as_slice()))
    {
        return NameVerdict::Secret;
    }
    let extension = name
        .iter()
        .rposition(|byte| *byte == b'.')
        .filter(|dot| *dot > 0)
        .map(|dot| &name[dot + 1..]);
    if has_secret_name(name, extension) {
        return NameVerdict::Secret;
    }
    match extension {
        Some(b"key") => NameVerdict::KeyFile,
        Some(extension) if SECRET_EXTENSIONS.contains(&extension) => NameVerdict::Secret,
        _ => NameVerdict::NotSecret,
    }
}

/// The name rules of [`looks_like_secret`], on a lowercase file name.
fn has_secret_name(name: &[u8], extension: Option<&[u8]>) -> bool {
    let is_template = |stem: &[u8]| {
        let last = stem.rsplit(|byte| *byte == b'.').next().unwrap_or(stem);
        ENV_TEMPLATES.contains(&last)
    };
    if SECRET_NAMES.contains(&name) {
        return true;
    }
    if let Some(rest) = ENV_PREFIXES
        .iter()
        .find_map(|prefix| name.strip_prefix(*prefix))
    {
        return !is_template(rest);
    }
    if let Some(stem) = name.strip_suffix(b".env").filter(|stem| !stem.is_empty()) {
        return !is_template(stem);
    }
    (name.starts_with(b"client_secret") && matches!(extension, Some(b"json")))
        || (SSH_KEY_PREFIXES
            .iter()
            .any(|prefix| name.starts_with(prefix))
            && !matches!(extension, Some(b"pub")))
}

/// Whether `path` is a regular file that starts with a zip signature, which is
/// how a single-file Keynote document starts.
fn is_keynote_document(path: &Path) -> bool {
    if !std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_file()) {
        return false;
    }
    let mut signature = [0u8; 4];
    std::fs::File::open(path)
        .and_then(|mut file| std::io::Read::read_exact(&mut file, &mut signature))
        .is_ok()
        && &signature == ZIP_SIGNATURE
}

#[cfg(unix)]
fn path_from_git(bytes: &[u8]) -> PathBuf {
    use std::os::unix::ffi::OsStrExt;
    PathBuf::from(OsStr::from_bytes(bytes))
}

#[cfg(not(unix))]
fn path_from_git(bytes: &[u8]) -> PathBuf {
    PathBuf::from(String::from_utf8_lossy(bytes).into_owned())
}

fn is_repository_marker(candidate: &Path) -> bool {
    match std::fs::metadata(candidate) {
        Ok(metadata) if metadata.is_dir() => candidate.join("HEAD").is_file(),
        Ok(metadata) if metadata.is_file() => {
            let mut prefix = [0u8; 7];
            std::fs::File::open(candidate)
                .and_then(|mut file| std::io::Read::read_exact(&mut file, &mut prefix))
                .is_ok()
                && &prefix == b"gitdir:"
        }
        _ => false,
    }
}

fn enclosing_repository_below_home(start: &Path, home: Option<&Path>) -> Option<PathBuf> {
    let start = std::fs::canonicalize(start).unwrap_or_else(|_| start.to_path_buf());
    let home = home.map(|home| std::fs::canonicalize(home).unwrap_or_else(|_| home.to_path_buf()));
    start
        .ancestors()
        .skip(1)
        .filter(|ancestor| {
            !home
                .as_deref()
                .is_some_and(|home| home.starts_with(ancestor))
        })
        .find(|ancestor| is_repository_marker(&ancestor.join(".git")))
        .map(Path::to_path_buf)
}

pub(crate) fn enclosing_repository(start: &Path) -> Option<PathBuf> {
    enclosing_repository_below_home(start, paths::home_dir().ok().as_deref())
}

fn refuse_nested_repository(root: &Path) -> Result<(), String> {
    match enclosing_repository(root) {
        Some(_) => Err(crate::app_error::AppError::new("git.nested_repository").into()),
        None => Ok(()),
    }
}

fn initialize_new_repo(root: &PathBuf) -> Result<(), String> {
    refuse_nested_repository(root)?;
    let branch = default_branch(root);
    initialize_repo(root, &branch)
}

fn existing_repo(project_id: &str) -> Result<PathBuf, String> {
    let root = project_root(project_id)?;
    if !root.join(".git").exists() {
        return Err("Git repository is not initialized. Initialize Source Control first.".into());
    }
    Ok(root)
}

fn initialized_repo(project_id: &str) -> Result<Option<PathBuf>, String> {
    let root = project_root(project_id)?;
    Ok(root.join(".git").exists().then_some(root))
}

const GRAPH_COMMIT_LIMIT: usize = 100;

#[derive(Serialize)]
pub struct GitCommit {
    pub oid: String,
    pub short: String,
    pub time: f64,
    pub message: String,
    pub author: String,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitConflict {
    pub path: String,
    pub status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkspaceSnapshot {
    pub initialized: bool,
    pub branch: Option<String>,
    pub remote: Option<String>,
    pub ahead_behind: AheadBehind,
    pub operation: String,
    pub changes: Vec<GitFileChange>,
    pub conflicts: Vec<GitConflict>,
    pub branches: Vec<String>,
    pub commits: Vec<GitCommit>,
    /// False when no usable `git` program is installed. The other fields are
    /// then empty, and `initialized` only says whether `.git` exists.
    pub git_available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeOperationResult {
    pub message: String,
    pub outcome: String,
    pub conflicts: Vec<GitConflict>,
    pub project_state: crate::project::ProjectStateChanged,
}

fn is_reserved_repo_component(component: &std::ffi::OsStr) -> bool {
    component.to_str().is_some_and(|segment| {
        segment.eq_ignore_ascii_case(".git") || segment.eq_ignore_ascii_case(".oleafly")
    })
}

fn validate_repo_relative_path(path: &str) -> Result<(), String> {
    if path.is_empty() || path.contains('\0') || path.contains('\\') {
        return Err("Git paths must be non-empty, relative paths using forward slashes.".into());
    }
    // Accept harmless `./` aliases while still validating their normalized
    // components. The discard preflight uses that normalized destination to
    // ensure aliases cannot schedule the same deletion twice.
    let mut components = std::path::Path::new(path)
        .components()
        .filter(|component| !matches!(component, Component::CurDir));
    let Some(Component::Normal(first)) = components.next() else {
        return Err("Git paths must stay inside the project.".into());
    };
    if is_reserved_repo_component(first) {
        return Err("Git cannot change Oleafly's internal files.".into());
    }
    if components.any(|component| {
        !matches!(component, Component::Normal(segment) if !is_reserved_repo_component(segment))
    }) {
        return Err("Git paths must stay inside the project.".into());
    }
    Ok(())
}

fn validate_repo_relative_paths(paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("Choose at least one file.".into());
    }
    for path in paths {
        validate_repo_relative_path(path)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_is_initialized(project_id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || git_is_initialized_sync(project_id))
        .await
        .map_err(|error| error.to_string())?
}

fn git_is_initialized_sync(project_id: String) -> Result<bool, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
    Ok(initialized_repo(&project_id)?.is_some())
}

/// Initialize Source Control only in response to a direct user action.
#[tauri::command]
pub async fn git_initialize(project_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_initialize_sync(project_id))
        .await
        .map_err(|error| error.to_string())?
}

fn git_initialize_sync(project_id: String) -> Result<String, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
    let root = project_root(&project_id)?;
    if !root.join(".git").exists() {
        initialize_new_repo(&root)?;
    }
    current_branch(&root)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPublishPrepared {
    /// A new commit was made.
    pub committed: bool,
    /// The branch has a commit to push.
    pub has_commit: bool,
    /// Files that were not staged because they look like secrets.
    pub left_out: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPublishPreflight {
    pub tracked_secret_files: Vec<String>,
}

/// Prepare the project for the explicit Publish to GitHub action. This is the
/// sole convenience that initializes and commits all files in one operation;
/// background save, compile, and assistant flows never call it.
#[tauri::command]
pub async fn git_prepare_publish(
    project_id: String,
    message: String,
    allow_tracked_secrets: Option<Vec<String>>,
) -> Result<GitPublishPrepared, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<GitPublishPrepared, String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
        let root = project_root(&project_id)?;
        prepare_publish_at(&root, &message, &allow_tracked_secrets.unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stage and commit everything for Publish to GitHub, creating the repository
/// when the project has none. Files that [`looks_like_secret`] are never
/// staged and come back in `left_out`. When the history already holds such
/// files, pushing the branch would upload them, so nothing changes unless the
/// user approved every one of them by name.
fn prepare_publish_at(
    root: &PathBuf,
    message: &str,
    approved: &[String],
) -> Result<GitPublishPrepared, String> {
    if !root.join(".git").exists() {
        initialize_new_repo(root)?;
    } else {
        let unapproved: Vec<String> = secret_files_in_history(root)?
            .into_iter()
            .filter(|path| !approved.contains(path))
            .collect();
        if !unapproved.is_empty() {
            return Err(crate::app_error::AppError::new("git.tracked_secret_files")
                .param("files", first_files(&unapproved))
                .into());
        }
    }
    let left_out = stage_all_except_secrets(root)?;
    let committed = commit_index(root, message)?;
    Ok(GitPublishPrepared {
        committed,
        has_commit: has_head(root),
        left_out,
    })
}

/// The first five paths, then `(+N)` for the rest, so an error parameter
/// stays short and carries no English words.
fn first_files(files: &[String]) -> String {
    let mut text = files
        .iter()
        .take(5)
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(", ");
    if files.len() > 5 {
        text.push_str(&format!(" (+{})", files.len() - 5));
    }
    text
}

#[tauri::command]
pub async fn git_publish_preflight(project_id: String) -> Result<GitPublishPreflight, String> {
    tauri::async_runtime::spawn_blocking(move || git_publish_preflight_sync(&project_id))
        .await
        .map_err(|error| error.to_string())?
}

fn git_publish_preflight_sync(project_id: &str) -> Result<GitPublishPreflight, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
    let root = project_root(project_id)?;
    publish_preflight_at(&root)
}

/// What Publish to GitHub must ask about before it creates a repository on
/// GitHub: a project inside another repository is refused, and files in the
/// branch history that look like secrets are listed for the user to approve.
fn publish_preflight_at(root: &PathBuf) -> Result<GitPublishPreflight, String> {
    if !root.join(".git").exists() {
        refuse_nested_repository(root)?;
        return Ok(GitPublishPreflight {
            tracked_secret_files: Vec::new(),
        });
    }
    Ok(GitPublishPreflight {
        tracked_secret_files: secret_files_in_history(root)?,
    })
}

/// Paths added by any commit reachable from HEAD, merges included, whose names
/// look like secrets. Pushing the branch uploads all of them, even ones
/// deleted since. Only names are judged, so a Keynote `.key` file counts too.
/// Sorted and without repeats.
fn secret_files_in_history(root: &PathBuf) -> Result<Vec<String>, String> {
    if !has_head(root) {
        return Ok(Vec::new());
    }
    let output = run_git_read_only(
        root,
        &[
            "-c",
            "log.diffMerges=separate",
            "--no-replace-objects",
            "log",
            "--no-show-signature",
            "--no-renames",
            "--root",
            "-m",
            "--diff-filter=A",
            "--name-only",
            "--format=",
            "-z",
            "HEAD",
            "--",
        ],
    )?;
    let secrets: BTreeSet<String> = git_listing(output)?
        .iter()
        .filter(|path| judge_name(path) != NameVerdict::NotSecret)
        .map(|path| String::from_utf8_lossy(path).into_owned())
        .collect();
    Ok(secrets.into_iter().collect())
}

#[tauri::command]
pub async fn git_log(project_id: String) -> Result<Vec<GitCommit>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<GitCommit>, String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
        let Some(root) = initialized_repo(&project_id)? else {
            return Ok(Vec::new());
        };
        git_log_at(&root)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn git_log_at(root: &PathBuf) -> Result<Vec<GitCommit>, String> {
    if !has_head(root) {
        return Ok(Vec::new());
    }
    let out = run_git_read_only(
        root,
        &[
            "log",
            "--no-show-signature",
            "-n",
            "100",
            "-z",
            "--format=%H%x00%h%x00%ct%x00%s%x00%an%x00%P%x00%D",
        ],
    )?;
    if !out.status.success() {
        return Err(out_to_string(&out));
    }
    let fields: Vec<&[u8]> = out.stdout.split(|byte| *byte == 0).collect();
    let mut commits = Vec::new();
    for record in fields.as_chunks::<7>().0.iter().take(GRAPH_COMMIT_LIMIT) {
        let text = |field: &[u8]| String::from_utf8_lossy(field).to_string();
        commits.push(GitCommit {
            oid: text(record[0]),
            short: text(record[1]),
            time: String::from_utf8_lossy(record[2]).parse().unwrap_or(0.0),
            message: text(record[3]),
            author: text(record[4]),
            parents: String::from_utf8_lossy(record[5])
                .split_whitespace()
                .map(ToOwned::to_owned)
                .collect(),
            refs: String::from_utf8_lossy(record[6])
                .split(',')
                .map(str::trim)
                .filter(|reference| !reference.is_empty())
                .map(ToOwned::to_owned)
                .collect(),
        });
    }
    Ok(commits)
}

#[tauri::command]
pub async fn git_restore(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    oid: String,
    expected_generation: Option<u64>,
) -> Result<crate::project::ProjectStateChanged, String> {
    validate_git_oid(&oid)?;
    let operation_id = project_id.clone();
    let mutation = crate::project::mutate_project_worktree(
        &state,
        project_id.clone(),
        expected_generation,
        move |_| {
            let root = existing_repo(&operation_id)?;
            restore_worktree(&root, &oid)?;
            Ok(((), true))
        },
    )
    .await?;
    let outcome = mutation.value;
    let event = crate::project::publish_project_state_changed(
        &app,
        &state,
        &project_id,
        mutation.project,
        "git-restore",
        true,
        Some(mutation.generation),
    );
    outcome?;
    event
}

fn validate_git_oid(oid: &str) -> Result<(), String> {
    if (4..=64).contains(&oid.len()) && oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("invalid Git commit id".into())
    }
}

fn restore_worktree(root: &PathBuf, oid: &str) -> Result<(), String> {
    validate_git_oid(oid)?;
    if merge_in_progress(root)? {
        return Err("Complete or abort the current merge before restoring a version.".into());
    }
    if !conflicts_at(root)?.is_empty() {
        return Err("Resolve the current Git conflicts before restoring a version.".into());
    }
    // Make the index and working tree exactly match the checkpoint without
    // moving HEAD: restore modified files, bring back deleted ones, AND remove
    // files created after the checkpoint. `checkout <oid> -- .` only touched
    // paths present in <oid>, so files a later response added were left behind
    // and "restore to before this response" did not actually undo them. A later
    // user-authored commit can record the restored state without moving HEAD.
    ok_or_err(run_git(root, &["read-tree", "--reset", "-u", oid])?)
}

/// Collapse a progress line to the last frame it drew. `--progress` redraws in
/// place with carriage returns, so a failed transfer would otherwise report
/// every percentage it passed through instead of where it stopped.
fn last_progress_frame(line: &str) -> &str {
    let line = line.strip_suffix('\r').unwrap_or(line);
    match line.rfind('\r') {
        Some(index) => &line[index + 1..],
        None => line,
    }
}

fn out_to_string(out: &std::process::Output) -> String {
    let mut s = String::new();
    s.push_str(&String::from_utf8_lossy(&out.stdout));
    if !out.stderr.is_empty() {
        if !s.is_empty() {
            s.push('\n');
        }
        s.push_str(&String::from_utf8_lossy(&out.stderr));
    }
    s.split('\n')
        .map(last_progress_frame)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

/// Strip any embedded credentials from a remote URL for display.
fn sanitize_url(u: &str) -> String {
    if let Some(idx) = u.find("://") {
        let (scheme, rest) = u.split_at(idx + 3);
        if !scheme.eq_ignore_ascii_case("http://") && !scheme.eq_ignore_ascii_case("https://") {
            return u.to_string();
        }
        let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
        let (authority, suffix) = rest.split_at(authority_end);
        if let Some(at) = authority.rfind('@') {
            return format!("{scheme}{}{suffix}", &authority[at + 1..]);
        }
    }
    u.to_string()
}

fn origin_url(root: &PathBuf) -> Result<Option<String>, String> {
    let output = run_git_read_only(root, &["remote", "get-url", "origin"])?;
    if !output.status.success() {
        return Ok(None);
    }
    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok((!url.is_empty()).then_some(url))
}

fn remote_credentials_need_cleanup(root: &PathBuf) -> Result<bool, String> {
    Ok(origin_url(root)?.is_some_and(|url| sanitize_url(&url) != url))
}

fn clean_remote_credentials(root: &PathBuf) -> Result<bool, String> {
    let Some(url) = origin_url(root)? else {
        return Ok(false);
    };
    let clean = sanitize_url(&url);
    if clean == url {
        return Ok(false);
    }
    if clean.is_empty() || !is_allowed_remote_url(&clean) {
        return Err("The saved Git remote could not be cleaned safely.".into());
    }
    ok_or_err(run_git(root, &["remote", "set-url", "origin", &clean])?)?;
    Ok(true)
}

#[tauri::command]
pub async fn git_remote_credentials_need_cleanup(project_id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_remote_credentials_need_cleanup_sync(project_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn git_remote_credentials_need_cleanup_sync(project_id: String) -> Result<bool, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
    let Some(root) = initialized_repo(&project_id)? else {
        return Ok(false);
    };
    remote_credentials_need_cleanup(&root)
}

/// Removes cleartext credentials left in origin URLs by older Oleafly builds.
/// This writes Git config only after the user chooses the repair action.
#[tauri::command]
pub async fn git_clean_remote_credentials(project_id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || git_clean_remote_credentials_sync(project_id))
        .await
        .map_err(|error| error.to_string())?
}

fn git_clean_remote_credentials_sync(project_id: String) -> Result<bool, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
    let root = existing_repo(&project_id)?;
    clean_remote_credentials(&root)
}

/// Whether a remote URL uses a transport we're willing to configure. Blocks
/// git's `ext::`/`fd::` "transport helper" syntax, which can execute arbitrary
/// commands on fetch/push. Allows the normal network transports and scp-style
/// `git@host:path` shorthand.
fn is_allowed_remote_url(url: &str) -> bool {
    let u = url.trim();
    if u.is_empty() {
        return false;
    }
    // Reject the transport-helper form `<helper>::<address>` (e.g. `ext::sh -c`).
    // A `::` before any `/` is the tell; real URLs use `://` or `host:path`.
    if let Some(dcolon) = u.find("::") {
        let before = &u[..dcolon];
        if !before.contains('/') {
            return false;
        }
    }
    if let Some(scheme_end) = u.find("://") {
        let scheme = u[..scheme_end].to_ascii_lowercase();
        return matches!(scheme.as_str(), "https" | "http" | "ssh" | "git");
    }
    // scp-like shorthand: `user@host:path` (no scheme). Require an `@` and a `:`.
    u.contains('@') && u.contains(':')
}

const GITHUB_TOKEN_CONFIG: [&str; 6] = [
    "-c",
    "credential.https://github.com.helper=",
    "-c",
    "credential.https://github.com.helper=!f() { test \"$1\" = get && printf 'username=x-access-token\\npassword=%s\\n' \"$OLEAFLY_GH_TOKEN\"; }; f",
    "-c",
    "credential.https://github.com.useHttpPath=false",
];

fn github_authed_args<'a>(args: &[&'a str]) -> Vec<&'a str> {
    let mut full: Vec<&'a str> = GITHUB_TOKEN_CONFIG.to_vec();
    full.extend_from_slice(args);
    full
}

fn run_git_authed(
    root: &PathBuf,
    token: &str,
    args: &[&str],
) -> Result<std::process::Output, String> {
    run_configured_git_bounded(
        root,
        &github_authed_args(args),
        true,
        remote_bounds(),
        |command| {
            command.env("OLEAFLY_GH_TOKEN", token);
        },
    )
}

/// Attach the authenticated repository history to content imported through the
/// guarded archive path. Resetting only the index keeps the archive import's
/// path and symlink protections intact while placing the worktree on top of the
/// real remote history. The caller must hold the imported project's exclusive
/// worktree lock for the full archive-import transaction.
pub(crate) fn attach_imported_repository_history_lock_held(
    project_id: &str,
    remote_url: &str,
    default_branch: &str,
    token: &str,
) -> Result<(), String> {
    if !is_allowed_remote_url(remote_url) {
        return Err("GitHub returned an unsupported repository URL.".into());
    }
    let root = crate::project_location::LibraryProjectDir::resolve(project_id)?
        .path()
        .to_path_buf();
    attach_imported_repository_history_at(&root, remote_url, default_branch, |root, refspec| {
        ok_or_err(run_git_authed(
            root,
            token,
            &["fetch", "--no-tags", "--progress", "origin", refspec],
        )?)
    })
}

fn attach_imported_repository_history_at<F>(
    root: &PathBuf,
    remote_url: &str,
    default_branch: &str,
    fetch: F,
) -> Result<(), String>
where
    F: FnOnce(&PathBuf, &str) -> Result<(), String>,
{
    if root.join(".git").exists() {
        return Err("The imported project already has repository history.".into());
    }
    refuse_nested_repository(root)?;

    let local_ref = format!("refs/heads/{default_branch}");
    let remote_ref = format!("refs/remotes/origin/{default_branch}");
    let refspec = format!("+refs/heads/{default_branch}:{remote_ref}");
    if !run_git(root, &["check-ref-format", &local_ref])?
        .status
        .success()
    {
        return Err("GitHub returned an invalid default branch.".into());
    }

    ok_or_err(run_git(root, &["init", "--quiet"])?)?;
    let result = (|| -> Result<(), String> {
        ensure_git_identity(root)?;
        ok_or_err(run_git(root, &["remote", "add", "origin", remote_url])?)?;
        fetch(root, &refspec)?;
        ok_or_err(run_git(root, &["symbolic-ref", "HEAD", &local_ref])?)?;
        ok_or_err(run_git(root, &["reset", "--mixed", &remote_ref, "--"])?)?;
        let upstream = format!("--set-upstream-to={remote_ref}");
        ok_or_err(run_git(root, &["branch", &upstream, "--", default_branch])?)?;

        ensure_private_exclude(root, Excludes::NewRepository)?;

        // project.json and any archive-safety normalization become one local
        // commit above the imported branch, leaving future pulls mergeable.
        let status = run_git(root, &["status", "--porcelain"])?;
        if !status.stdout.is_empty() {
            ok_or_err(run_git(root, &["add", "-A"])?)?;
            ok_or_err(run_git(
                root,
                &["commit", "--quiet", "-m", "Prepare project for Oleafly"],
            )?)?;
        }
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_dir_all(root.join(".git"));
    }
    result
}

#[tauri::command]
pub async fn git_set_remote(
    project_id: String,
    url: String,
    replace: Option<bool>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_set_remote_sync(project_id, url, replace.unwrap_or(false))
    })
    .await
    .map_err(|error| error.to_string())?
}

fn git_set_remote_sync(project_id: String, url: String, replace: bool) -> Result<(), String> {
    if !is_allowed_remote_url(&url) {
        return Err(format!("unsupported remote URL: {url}"));
    }
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
    let root = existing_repo(&project_id)?;
    set_origin(&root, &url, replace)
}

fn set_origin(root: &PathBuf, url: &str, replace: bool) -> Result<(), String> {
    match origin_url(root)? {
        None => ok_or_err(run_git(root, &["remote", "add", "origin", url])?),
        Some(existing) if replace || sanitize_url(&existing) == sanitize_url(url) => {
            ok_or_err(run_git(root, &["remote", "set-url", "origin", url])?)
        }
        Some(existing) => Err(crate::app_error::AppError::new("git.remote_exists")
            .param("remote", sanitize_url(&existing))
            .into()),
    }
}

/// Remove the `origin` remote (unlink a project from GitHub).
#[tauri::command]
pub async fn git_remove_remote(project_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git_remove_remote_sync(project_id))
        .await
        .map_err(|error| error.to_string())?
}

fn git_remove_remote_sync(project_id: String) -> Result<(), String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
    let root = existing_repo(&project_id)?;
    let check = run_git(&root, &["remote", "get-url", "origin"])?;
    if check.status.success() {
        ok_or_err(run_git(&root, &["remote", "remove", "origin"])?)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_get_remote(project_id: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || git_get_remote_sync(project_id))
        .await
        .map_err(|error| error.to_string())?
}

fn git_get_remote_sync(project_id: String) -> Result<Option<String>, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
    let Some(root) = initialized_repo(&project_id)? else {
        return Ok(None);
    };
    let out = run_git_read_only(&root, &["remote", "get-url", "origin"])?;
    if out.status.success() {
        let s = sanitize_url(String::from_utf8_lossy(&out.stdout).trim());
        Ok(if s.is_empty() { None } else { Some(s) })
    } else {
        Ok(None)
    }
}

fn current_branch(root: &PathBuf) -> Result<String, String> {
    let out = run_git_read_only(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
    let branch = String::from_utf8_lossy(&out.stdout).trim().to_string();
    ok_or_err(out)?;
    if branch.is_empty() {
        Err("The repository does not have a current branch.".to_string())
    } else {
        Ok(branch)
    }
}

#[tauri::command]
pub async fn git_current_branch(project_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_current_branch_sync(project_id))
        .await
        .map_err(|error| error.to_string())?
}

fn git_current_branch_sync(project_id: String) -> Result<String, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
    let root = existing_repo(&project_id)?;
    current_branch(&root)
}

#[derive(Serialize)]
pub struct AheadBehind {
    pub ahead: u32,
    pub behind: u32,
    pub has_upstream: bool,
}

/// How many commits the local branch is ahead/behind `origin/<branch>` (based
/// on the locally-known remote-tracking ref; refreshes after a push or pull).
#[tauri::command]
pub async fn git_ahead_behind(project_id: String) -> Result<AheadBehind, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<AheadBehind, String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
        let Some(root) = initialized_repo(&project_id)? else {
            return Ok(no_upstream());
        };
        ahead_behind_at(&root)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn no_upstream() -> AheadBehind {
    AheadBehind {
        ahead: 0,
        behind: 0,
        has_upstream: false,
    }
}

fn ahead_behind_at(root: &PathBuf) -> Result<AheadBehind, String> {
    let Ok(branch) = current_branch(root) else {
        return Ok(no_upstream());
    };
    let upstream = format!("origin/{branch}");
    let has_upstream = run_git_read_only(root, &["rev-parse", "--verify", &upstream])?
        .status
        .success();
    if !has_upstream {
        return Ok(no_upstream());
    }
    let out = run_git_read_only(
        root,
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("{upstream}...{branch}"),
        ],
    )?;
    if !out.status.success() {
        return Ok(no_upstream());
    }
    let counts = String::from_utf8_lossy(&out.stdout);
    let mut parts = counts.split_whitespace();
    let behind: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let ahead: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    Ok(AheadBehind {
        ahead,
        behind,
        has_upstream: true,
    })
}

#[tauri::command]
pub async fn git_push(project_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_push_sync(project_id))
        .await
        .map_err(|error| error.to_string())?
}

fn git_push_sync(project_id: String) -> Result<String, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
    let root = existing_repo(&project_id)?;
    let cfg = config::read_config()?;
    if cfg.github_token.is_empty() {
        return Err("No GitHub token set. Add one in Settings → GitHub.".into());
    }
    let remote_out = run_git(&root, &["remote", "get-url", "origin"])?;
    let remote = String::from_utf8_lossy(&remote_out.stdout)
        .trim()
        .to_string();
    if remote.is_empty() {
        return Err("No remote 'origin' set for this project.".into());
    }
    let branch = current_branch(&root)?;
    // Push to the named `origin` remote (credentials come from the env-backed
    // helper), so git updates the `origin/<branch>` tracking ref itself.
    let out = run_git_authed(
        &root,
        &cfg.github_token,
        &["push", "--progress", "-u", "origin", &branch],
    )?;
    if !out.status.success() {
        return Err(out_to_string(&out));
    }
    Ok(format!("Pushed to origin/{branch}"))
}

#[tauri::command]
pub async fn git_fetch(project_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
        let root = existing_repo(&project_id)?;
        let remote = run_git_read_only(&root, &["remote", "get-url", "origin"])?;
        if !remote.status.success() || String::from_utf8_lossy(&remote.stdout).trim().is_empty() {
            return Err("No remote 'origin' set for this project.".into());
        }
        let token = config::read_config()?.github_token;
        let output = if token.is_empty() {
            run_git_remote(&root, &["fetch", "--prune", "--progress", "origin"])?
        } else {
            run_git_authed(&root, &token, &["fetch", "--prune", "--progress", "origin"])?
        };
        ok_or_err(output)?;
        Ok("Fetched origin".to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn git_pull(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    expected_generation: Option<u64>,
) -> Result<GitPullResult, String> {
    git_pull_with_runtime(app, state, project_id, expected_generation).await
}

async fn git_pull_with_runtime<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    expected_generation: Option<u64>,
) -> Result<GitPullResult, String> {
    let cfg = config::read_config()?;
    let token = cfg.github_token;
    let operation_id = project_id.clone();
    let mutation = crate::project::mutate_project_worktree(
        &state,
        project_id.clone(),
        expected_generation,
        move |_| {
            let root = existing_repo(&operation_id)?;
            pull_origin(&root, &token)
        },
    )
    .await?;
    let outcome = mutation.value?;
    let event = crate::project::publish_project_state_changed(
        &app,
        &state,
        &project_id,
        mutation.project,
        "git-pull",
        outcome.changed,
        Some(mutation.generation),
    )?;
    Ok(GitPullResult {
        message: outcome.message,
        outcome: outcome.outcome,
        conflicts: outcome.conflicts,
        state: event,
    })
}

struct GitMutationOutcome {
    message: String,
    outcome: String,
    conflicts: Vec<GitConflict>,
    changed: bool,
}

fn pull_origin(root: &PathBuf, token: &str) -> Result<(GitMutationOutcome, bool), String> {
    if merge_in_progress(root)? {
        return Err("Resolve or abort the current merge before pulling again.".into());
    }
    let remote_out = run_git(root, &["remote", "get-url", "origin"])?;
    if String::from_utf8_lossy(&remote_out.stdout)
        .trim()
        .is_empty()
    {
        return Err("No remote 'origin' set for this project.".into());
    }
    let branch = current_branch(root)?;
    let pull_args = [
        "pull",
        "--no-rebase",
        "--progress",
        "origin",
        branch.as_str(),
    ];
    let output = if token.is_empty() {
        run_git_remote(root, &pull_args)?
    } else {
        run_git_authed(root, token, &pull_args)?
    };
    if output.status.success() {
        return Ok((
            GitMutationOutcome {
                message: format!("Pulled origin/{branch}"),
                outcome: "pulled".into(),
                conflicts: Vec::new(),
                changed: true,
            },
            true,
        ));
    }
    let conflicts = conflicts_at(root)?;
    if !conflicts.is_empty() && merge_in_progress(root)? {
        return Ok((
            GitMutationOutcome {
                message: "Pull needs conflict resolution.".into(),
                outcome: "conflicts".into(),
                conflicts,
                changed: true,
            },
            true,
        ));
    }
    Err(out_to_string(&output))
}

#[derive(Serialize)]
pub struct GitPullResult {
    pub message: String,
    pub outcome: String,
    pub conflicts: Vec<GitConflict>,
    pub state: crate::project::ProjectStateChanged,
}

#[derive(Clone, Serialize)]
pub struct GitFileChange {
    pub path: String,
    /// Short status code: "M", "A", "D", "R", "??", etc.
    pub status: String,
    pub staged: bool,
    pub conflict: bool,
}

fn is_unmerged_status(x: u8, y: u8) -> bool {
    matches!(
        (x, y),
        (b'D', b'D')
            | (b'A', b'U')
            | (b'U', b'D')
            | (b'U', b'A')
            | (b'D', b'U')
            | (b'A', b'A')
            | (b'U', b'U')
    )
}

/// Parse `git status --porcelain=v1 -z` output without relying on quoting or
/// newlines in a path. A file changed in both the index and the worktree emits
/// one row per side so callers can place it in both Source Control sections.
fn parse_status_porcelain_bytes(bytes: &[u8]) -> Vec<GitFileChange> {
    let mut changes = Vec::new();
    let mut records = bytes.split(|byte| *byte == 0).peekable();
    while let Some(record) = records.next() {
        if record.len() < 4 || record[2] != b' ' {
            continue;
        }
        let x = record[0];
        let y = record[1];
        let mut path = String::from_utf8_lossy(&record[3..]).to_string();
        if matches!(x, b'R' | b'C') {
            // With -z, the destination is the first path and the source is the
            // second. Consume the source even though the UI operates on the destination.
            let _ = records.next();
        }
        if path.is_empty() || path.ends_with('/') {
            continue;
        }
        if is_unmerged_status(x, y) {
            changes.push(GitFileChange {
                path,
                status: format!("{}{}", x as char, y as char),
                staged: false,
                conflict: true,
            });
            continue;
        }
        if x == b'?' || x == b'!' {
            if x == b'?' {
                changes.push(GitFileChange {
                    path,
                    status: "?".into(),
                    staged: false,
                    conflict: false,
                });
            }
            continue;
        }
        if x != b' ' {
            changes.push(GitFileChange {
                path: path.clone(),
                status: (x as char).to_string(),
                staged: true,
                conflict: false,
            });
        }
        if y != b' ' {
            changes.push(GitFileChange {
                path: std::mem::take(&mut path),
                status: (y as char).to_string(),
                staged: false,
                conflict: false,
            });
        }
    }
    changes
}

/// Kept as a text helper for unit tests and callers that already have legacy
/// porcelain output. Production status reads use the byte-safe -z variant.
#[cfg(test)]
fn parse_status_porcelain(text: &str) -> Vec<GitFileChange> {
    if text.contains('\0') {
        return parse_status_porcelain_bytes(text.as_bytes());
    }
    let zero_delimited = text
        .lines()
        .map(|line| {
            if line.len() >= 3 && matches!(line.as_bytes()[0], b'R' | b'C') {
                let path = line[3..].split(" -> ").last().unwrap_or(&line[3..]);
                format!(
                    "{}\0",
                    [line.as_bytes()[0], line.as_bytes()[1], b' ']
                        .iter()
                        .map(|byte| *byte as char)
                        .collect::<String>()
                        + path
                )
            } else {
                format!("{line}\0")
            }
        })
        .collect::<String>();
    parse_status_porcelain_bytes(zero_delimited.as_bytes())
}

#[tauri::command]
pub async fn git_status(project_id: String) -> Result<Vec<GitFileChange>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<GitFileChange>, String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
        let Some(root) = initialized_repo(&project_id)? else {
            return Ok(Vec::new());
        };
        let out = run_git_read_only(
            &root,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        )?;
        if !out.status.success() {
            return Err(out_to_string(&out));
        }
        Ok(parse_status_porcelain_bytes(&out.stdout))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn status_at(root: &PathBuf) -> Result<Vec<GitFileChange>, String> {
    let out = run_git_read_only(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    if !out.status.success() {
        return Err(out_to_string(&out));
    }
    Ok(parse_status_porcelain_bytes(&out.stdout))
}

fn conflicts_at(root: &PathBuf) -> Result<Vec<GitConflict>, String> {
    Ok(status_at(root)?
        .into_iter()
        .filter(|change| change.conflict)
        .map(|change| GitConflict {
            path: change.path,
            status: change.status,
        })
        .collect())
}

fn merge_in_progress(root: &PathBuf) -> Result<bool, String> {
    Ok(
        run_git_read_only(root, &["rev-parse", "-q", "--verify", "MERGE_HEAD"])?
            .status
            .success(),
    )
}

fn branches_at(root: &PathBuf) -> Result<Vec<String>, String> {
    let out = run_git_read_only(
        root,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )?;
    if !out.status.success() {
        return Err(out_to_string(&out));
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .take(100)
        .map(ToOwned::to_owned)
        .collect())
}

#[tauri::command]
pub async fn git_workspace_snapshot(project_id: String) -> Result<GitWorkspaceSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<GitWorkspaceSnapshot, String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
        workspace_snapshot_at(&project_root(&project_id)?)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn workspace_snapshot_at(root: &PathBuf) -> Result<GitWorkspaceSnapshot, String> {
    let initialized = root.join(".git").exists();
    let git_available = git_available();
    if !initialized || !git_available {
        return Ok(GitWorkspaceSnapshot {
            initialized,
            branch: None,
            remote: None,
            ahead_behind: no_upstream(),
            operation: "idle".into(),
            changes: Vec::new(),
            conflicts: Vec::new(),
            branches: Vec::new(),
            commits: Vec::new(),
            git_available,
        });
    }
    let changes = status_at(root)?;
    let conflicts = changes
        .iter()
        .filter(|change| change.conflict)
        .map(|change| GitConflict {
            path: change.path.clone(),
            status: change.status.clone(),
        })
        .collect();
    Ok(GitWorkspaceSnapshot {
        initialized: true,
        branch: current_branch(root).ok(),
        remote: origin_url(root).map(|remote| remote.map(|value| sanitize_url(&value)))?,
        ahead_behind: ahead_behind_at(root)?,
        operation: if merge_in_progress(root)? {
            "merge"
        } else {
            "idle"
        }
        .into(),
        changes,
        conflicts,
        branches: branches_at(root)?,
        commits: git_log_at(root)?,
        git_available: true,
    })
}

#[tauri::command]
pub async fn git_diff(
    project_id: String,
    path: Option<String>,
    staged: bool,
) -> Result<String, String> {
    if let Some(path) = &path {
        validate_repo_relative_path(path)?;
    }
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
        let Some(root) = initialized_repo(&project_id)? else {
            return Ok(String::new());
        };
        diff_at(&root, path.as_deref(), staged)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn diff_at(root: &PathBuf, path: Option<&str>, staged: bool) -> Result<String, String> {
    if let Some(p) = path {
        if !staged {
            let is_tracked = match run_git_read_only(
                root,
                &[
                    "--literal-pathspecs",
                    "ls-files",
                    "--error-unmatch",
                    "--",
                    p,
                ],
            ) {
                Ok(o) => o.status.success(),
                Err(_) => false,
            };
            if !is_tracked {
                let devnull = null_device();
                let out = run_git_read_only(
                    root,
                    &[
                        "diff",
                        "--no-index",
                        "--no-ext-diff",
                        "--no-textconv",
                        "--",
                        devnull,
                        p,
                    ],
                )?;
                return Ok(String::from_utf8_lossy(&out.stdout).to_string());
            }
        }
    }

    let out = match (staged, path) {
        (false, None) => run_git_read_only(root, &["diff", "--no-ext-diff", "--no-textconv"]),
        (true, None) => run_git_read_only(
            root,
            &["diff", "--cached", "--no-ext-diff", "--no-textconv"],
        ),
        (false, Some(p)) => run_git_read_only(
            root,
            &[
                "--literal-pathspecs",
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--",
                p,
            ],
        ),
        (true, Some(p)) => run_git_read_only(
            root,
            &[
                "--literal-pathspecs",
                "diff",
                "--cached",
                "--no-ext-diff",
                "--no-textconv",
                "--",
                p,
            ],
        ),
    }?;
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
pub async fn git_discard(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    path: String,
    expected_generation: Option<u64>,
) -> Result<crate::project::ProjectStateChanged, String> {
    git_discard_paths(app, state, project_id, vec![path], expected_generation).await
}

fn path_is_tracked(root: &PathBuf, path: &Path) -> Result<bool, String> {
    let path = path.to_str().ok_or_else(|| {
        format!(
            "could not discard file {}: path is not valid Unicode",
            path.display()
        )
    })?;
    Ok(run_git_read_only(
        root,
        &[
            "--literal-pathspecs",
            "ls-files",
            "--error-unmatch",
            "--",
            path,
        ],
    )?
    .status
    .success())
}

enum DiscardPath {
    Tracked(PathBuf),
    UntrackedFile(PathBuf),
    #[cfg(windows)]
    UntrackedDirectoryLink(PathBuf),
}

#[cfg(windows)]
fn is_windows_directory_link(metadata: &cap_std::fs::Metadata) -> bool {
    use cap_std::fs::MetadataExt as _;

    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    let attributes = metadata.file_attributes();
    attributes & FILE_ATTRIBUTE_DIRECTORY != 0 && attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

fn resolve_discard_candidate(root: &Path, path: &str) -> Result<PathBuf, String> {
    let normalized: PathBuf = Path::new(path)
        .components()
        .filter(|component| !matches!(component, Component::CurDir))
        .collect();
    let file_name = normalized
        .file_name()
        .ok_or_else(|| format!("could not discard file {path}: illegal path"))?
        .to_owned();
    let parent = normalized.parent().unwrap_or_else(|| Path::new(""));
    let parent_text = parent
        .to_str()
        .ok_or_else(|| format!("could not discard file {path}: path is not valid Unicode"))?;
    crate::sandbox::resolve_within(root, parent_text)
        .map_err(|error| format!("could not discard file {path}: {error}"))?;

    let real_root = root
        .canonicalize()
        .map_err(|error| format!("could not discard file {path}: {error}"))?;
    let mut prefix = root.to_path_buf();
    let mut resolved_parent = PathBuf::new();
    let mut missing_parent = false;
    for component in parent.components() {
        let segment = match component {
            Component::Normal(segment) => segment,
            _ => return Err(format!("could not discard file {path}: illegal path")),
        };
        if missing_parent {
            resolved_parent.push(segment);
            continue;
        }
        prefix.push(segment);
        match std::fs::symlink_metadata(&prefix) {
            Ok(_) => {
                let real_prefix = prefix
                    .canonicalize()
                    .map_err(|error| format!("could not discard file {path}: {error}"))?;
                let relative = real_prefix.strip_prefix(&real_root).map_err(|_| {
                    format!("could not discard file {path}: path leaves the project")
                })?;
                if relative.components().any(|component| {
                    matches!(component, Component::Normal(segment) if is_reserved_repo_component(segment))
                }) {
                    return Err(format!(
                        "could not discard file {path}: Git cannot change Oleafly's internal files"
                    ));
                }
                resolved_parent = relative.to_path_buf();
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                // Preserve missing suffixes so a deleted tracked file can still
                // be restored. Any existing prefix, including a directory
                // symlink, has already been resolved above.
                missing_parent = true;
                resolved_parent.push(segment);
            }
            Err(error) => return Err(format!("could not discard file {path}: {error}")),
        }
    }
    Ok(resolved_parent.join(file_name))
}

enum DiscardBasenameMatch {
    Exact,
    CaseAlias,
    Missing,
}

fn discard_basename_match(
    root: &Path,
    candidate: &Path,
    requested: &str,
) -> Result<DiscardBasenameMatch, String> {
    let file_name = candidate
        .file_name()
        .ok_or_else(|| format!("could not discard file {requested}: illegal path"))?;
    let parent = candidate.parent().unwrap_or_else(|| Path::new(""));
    let entries = match std::fs::read_dir(root.join(parent)) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DiscardBasenameMatch::Missing)
        }
        Err(error) => return Err(format!("could not discard file {requested}: {error}")),
    };

    let mut has_case_alias = false;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("could not discard file {requested}: {error}"))?;
        let actual_name = entry.file_name();
        if actual_name == file_name {
            return Ok(DiscardBasenameMatch::Exact);
        }
        // Record a case-only spelling but keep scanning because a case-sensitive
        // directory can legitimately contain an exact entry as well. The caller
        // rejects the alias only when Git does not track the requested spelling.
        if actual_name
            .as_encoded_bytes()
            .eq_ignore_ascii_case(file_name.as_encoded_bytes())
        {
            has_case_alias = true;
        }
    }
    if has_case_alias {
        return Ok(DiscardBasenameMatch::CaseAlias);
    }
    Ok(DiscardBasenameMatch::Missing)
}

fn preflight_discard_paths(
    root: &PathBuf,
    repository: &cap_std::fs::Dir,
    paths: &[String],
) -> Result<Vec<DiscardPath>, String> {
    validate_repo_relative_paths(paths)?;
    let mut seen = std::collections::HashSet::new();
    let mut plan = Vec::with_capacity(paths.len());
    for path in paths {
        // Resolve every existing parent component but deliberately leave the
        // final basename unresolved. This makes Git classification agree with
        // filesystem mutation through an in-project directory alias without
        // following or merging distinct final symlink entries.
        let candidate = resolve_discard_candidate(root, path)?;
        if !seen.insert(candidate.clone()) {
            continue;
        }
        let basename_match = discard_basename_match(root, &candidate, path)?;
        let metadata = repository.symlink_metadata(&candidate);
        let tracked = path_is_tracked(root, &candidate)?;
        if !tracked
            && (matches!(basename_match, DiscardBasenameMatch::CaseAlias)
                || (!matches!(basename_match, DiscardBasenameMatch::Exact) && metadata.is_ok()))
        {
            // Some filesystems also alias Unicode-normalized spellings. If the
            // requested basename resolves without appearing exactly in its
            // directory, reject it for the same reason as a case-only alias.
            return Err(format!(
                "could not discard file {path}: use the file's exact name"
            ));
        }
        match metadata {
            Ok(metadata) if metadata.is_dir() => {
                return Err(format!("refusing to discard directory {path}"));
            }
            Ok(_) if tracked => plan.push(DiscardPath::Tracked(candidate)),
            Ok(_metadata) => {
                #[cfg(windows)]
                if is_windows_directory_link(&_metadata) {
                    plan.push(DiscardPath::UntrackedDirectoryLink(candidate));
                    continue;
                }
                plan.push(DiscardPath::UntrackedFile(candidate));
            }
            Err(error) if tracked && error.kind() == std::io::ErrorKind::NotFound => {
                // A deleted tracked file is a valid discard target: checkout
                // recreates it from the index.
                plan.push(DiscardPath::Tracked(candidate));
            }
            Err(error) => {
                return Err(format!("could not discard untracked file {path}: {error}"));
            }
        }
    }
    Ok(plan)
}

fn discard_paths_at(root: &PathBuf, paths: &[String]) -> Result<(), String> {
    let repository = cap_std::fs::Dir::open_ambient_dir(root, cap_std::ambient_authority())
        .map_err(|error| format!("could not open the project for discard: {error}"))?;
    // Resolve and inspect the complete batch before changing any file. Besides
    // rejecting missing paths and directories up front, `resolve_within`
    // prevents an untracked path from reaching outside the project through a
    // symlinked ancestor. The capability-rooted removal then keeps the mutation
    // bound to this repository if an ancestor changes after preflight.
    let plan = preflight_discard_paths(root, &repository, paths)?;
    for item in plan {
        match item {
            DiscardPath::Tracked(path) => {
                let path = path.to_str().ok_or_else(|| {
                    format!(
                        "could not discard file {}: path is not valid Unicode",
                        path.display()
                    )
                })?;
                ok_or_err(run_git(
                    root,
                    &["--literal-pathspecs", "checkout", "--", path],
                )?)?
            }
            DiscardPath::UntrackedFile(path) => match repository.remove_file(&path) {
                Ok(()) => {}
                // Two user-visible aliases may resolve to the same directory
                // entry. Once the first alias has removed it, the requested
                // end state already holds for the second one too.
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!(
                        "could not discard untracked file {}: {error}",
                        path.display()
                    ));
                }
            },
            #[cfg(windows)]
            DiscardPath::UntrackedDirectoryLink(path) => match repository.remove_dir(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!(
                        "could not discard untracked file {}: {error}",
                        path.display()
                    ));
                }
            },
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn git_discard_paths(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    paths: Vec<String>,
    expected_generation: Option<u64>,
) -> Result<crate::project::ProjectStateChanged, String> {
    validate_repo_relative_paths(&paths)?;
    let operation_id = project_id.clone();
    let mutation = crate::project::mutate_project_worktree(
        &state,
        project_id.clone(),
        expected_generation,
        move |_| {
            let root = existing_repo(&operation_id)?;
            discard_paths_at(&root, &paths)?;
            Ok(((), true))
        },
    )
    .await?;
    mutation.value?;
    crate::project::publish_project_state_changed(
        &app,
        &state,
        &project_id,
        mutation.project,
        "git-discard",
        true,
        Some(mutation.generation),
    )
}

#[tauri::command]
pub async fn git_head_oid(project_id: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || git_head_oid_sync(project_id))
        .await
        .map_err(|error| error.to_string())?
}

fn git_head_oid_sync(project_id: String) -> Result<Option<String>, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
    let Some(root) = initialized_repo(&project_id)? else {
        return Ok(None);
    };
    if !git_available() {
        return Ok(None);
    }
    let out = run_git_read_only(&root, &["rev-parse", "HEAD"])?;
    if !out.status.success() {
        return Ok(None);
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Ok(if s.is_empty() { None } else { Some(s) })
}

/// Bound for each of the two Git calls behind [`head_state`].
const HEAD_STATE_DEADLINE: Duration = Duration::from_secs(10);

/// The HEAD commit of the repository at `root` and whether the working tree has
/// uncommitted changes (untracked files count). `None` when Git is missing,
/// `root` is not a repository root, or HEAD is unborn; nothing is spawned in the
/// first two cases. Repository filters, hooks and the fsmonitor never run, so
/// this is safe on a folder that is not trusted. When the status cannot be
/// read in time the tree is reported as changed.
pub(crate) fn head_state(root: &Path) -> Option<(String, bool)> {
    if !is_repository_marker(&root.join(".git")) || !git_available() {
        return None;
    }
    let root = root.to_path_buf();
    let restricted = crate::trust::restricted_git_env(&root, &|_| None);
    let run = |args: &[&str]| {
        run_configured_git_bounded(
            &root,
            args,
            false,
            OutputBounds::total(HEAD_STATE_DEADLINE),
            |command| {
                command.envs(restricted.iter().map(|(key, value)| (key, value)));
            },
        )
        .ok()
        .filter(|output| output.status.success())
    };
    let head = run(&["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])?;
    let oid = String::from_utf8_lossy(&head.stdout).trim().to_string();
    validate_git_oid(&oid).ok()?;
    let dirty = run(&["status", "--porcelain", "--untracked-files=normal"])
        .is_none_or(|status| !status.stdout.is_empty());
    Some((oid, dirty))
}

pub(crate) fn head_commit_time(root: &Path) -> Option<u64> {
    if !is_repository_marker(&root.join(".git")) || !git_available() {
        return None;
    }
    let root = root.to_path_buf();
    let restricted = crate::trust::restricted_git_env(&root, &|_| None);
    let output = run_configured_git_bounded(
        &root,
        &["log", "-1", "--format=%ct", "HEAD"],
        false,
        OutputBounds::total(HEAD_STATE_DEADLINE),
        |command| {
            command.envs(restricted.iter().map(|(key, value)| (key, value)));
        },
    )
    .ok()
    .filter(|output| output.status.success())?;
    String::from_utf8_lossy(&output.stdout).trim().parse().ok()
}

/// Whether the repo has a HEAD commit yet (false on a fresh repo).
fn has_head(root: &PathBuf) -> bool {
    run_git(root, &["rev-parse", "--verify", "--quiet", "HEAD"])
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Whether the index holds anything different from HEAD (i.e. staged changes).
fn has_staged_changes(root: &PathBuf) -> bool {
    if has_head(root) {
        // `diff --cached --quiet` exits non-zero when there ARE staged changes.
        run_git(root, &["diff", "--cached", "--quiet"])
            .map(|o| !o.status.success())
            .unwrap_or(false)
    } else {
        // No commit yet: any entry in the index counts as staged.
        run_git(root, &["ls-files", "--cached"])
            .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
            .unwrap_or(false)
    }
}

fn ok_or_err(out: std::process::Output) -> Result<(), String> {
    if out.status.success() {
        Ok(())
    } else {
        Err(out_to_string(&out))
    }
}

fn stage(root: &PathBuf, path: &str) -> Result<(), String> {
    validate_repo_relative_path(path)?;
    ensure_private_exclude(root, Excludes::StateFolder)?;
    ok_or_err(run_git(root, &["--literal-pathspecs", "add", "--", path])?)
}

#[cfg(test)]
fn unstage(root: &PathBuf, path: &str) -> Result<(), String> {
    validate_repo_relative_path(path)?;
    // With a HEAD, reset the path back to HEAD in the index. Without one (initial
    // commit), there's nothing to reset to, so drop it from the index instead.
    let out = if has_head(root) {
        run_git(
            root,
            &["--literal-pathspecs", "reset", "-q", "HEAD", "--", path],
        )?
    } else {
        run_git(
            root,
            &[
                "--literal-pathspecs",
                "rm",
                "--cached",
                "-q",
                "--ignore-unmatch",
                "--",
                path,
            ],
        )?
    };
    ok_or_err(out)
}

fn stage_paths(root: &PathBuf, paths: &[String]) -> Result<(), String> {
    validate_repo_relative_paths(paths)?;
    ensure_private_exclude(root, Excludes::StateFolder)?;
    let mut args = vec!["--literal-pathspecs", "add", "--"];
    args.extend(paths.iter().map(String::as_str));
    ok_or_err(run_git(root, &args)?)
}

fn unstage_paths(root: &PathBuf, paths: &[String]) -> Result<(), String> {
    validate_repo_relative_paths(paths)?;
    let mut args = if has_head(root) {
        vec!["--literal-pathspecs", "reset", "-q", "HEAD", "--"]
    } else {
        vec![
            "--literal-pathspecs",
            "rm",
            "--cached",
            "-q",
            "--ignore-unmatch",
            "--",
        ]
    };
    args.extend(paths.iter().map(String::as_str));
    ok_or_err(run_git(root, &args)?)
}

fn stage_all(root: &PathBuf) -> Result<(), String> {
    ensure_private_exclude(root, Excludes::StateFolder)?;
    ok_or_err(run_git(root, &["add", "-A"])?)
}

/// Stage every change for Publish to GitHub except files that
/// [`looks_like_secret`], and return those files as project-relative paths.
/// They are left out through exclude pathspecs for this one `git add`, so no
/// project file or exclude rule changes, their content is never hashed, and
/// they stay visible as untracked, or keep their committed version, for the
/// user to stage on purpose. Anything secret-looking already in the index,
/// such as a file staged earlier, is unstaged again.
fn stage_all_except_secrets(root: &PathBuf) -> Result<Vec<String>, String> {
    ensure_private_exclude(root, Excludes::StateFolder)?;
    let status = run_git_read_only(
        root,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--no-renames",
        ],
    )?;
    let mut left_out = BTreeSet::new();
    for record in git_listing(status)? {
        if record.len() < 4 || record[2] != b' ' || record.ends_with(b"/") {
            continue;
        }
        let (x, y, path) = (record[0], record[1], &record[3..]);
        // `add -A` would stage the worktree side. A deletion is kept, so a
        // tracked secret can still be removed.
        let staged_by_add = is_unmerged_status(x, y) || (y != b' ' && y != b'D');
        if staged_by_add && looks_like_secret(root, path) {
            left_out.insert(path.to_vec());
        }
    }
    let mut pathspecs = vec![b".".to_vec()];
    pathspecs.extend(
        left_out
            .iter()
            .map(|path| [b":(exclude,literal)".as_slice(), path].concat()),
    );
    run_git_with_pathspecs(root, &["add", "-A"], &pathspecs)?;
    let staged: Vec<Vec<u8>> = staged_paths(root)?
        .into_iter()
        .filter(|path| looks_like_secret(root, path))
        .collect();
    if !staged.is_empty() {
        run_git_with_pathspecs(root, &["--literal-pathspecs", "reset", "-q"], &staged)?;
    }
    left_out.extend(staged);
    Ok(left_out
        .into_iter()
        .map(|path| String::from_utf8_lossy(&path).into_owned())
        .collect())
}

/// Paths the next commit would add, change or retype, or every index entry
/// before the first commit.
fn staged_paths(root: &PathBuf) -> Result<Vec<Vec<u8>>, String> {
    let output = if has_head(root) {
        run_git_read_only(
            root,
            &[
                "diff-index",
                "--cached",
                "--name-only",
                "-z",
                "--no-renames",
                "--diff-filter=AMT",
                "HEAD",
                "--",
            ],
        )?
    } else {
        run_git_read_only(root, &["ls-files", "-z", "--cached"])?
    };
    git_listing(output)
}

/// Run Git with `pathspecs` read from a temporary file, NUL-separated, so a
/// path with a newline, quotes or bytes that are not Unicode reaches Git as it
/// is and the list never meets a command-line length limit. The file is
/// written and closed before Git opens it.
fn run_git_with_pathspecs(
    root: &PathBuf,
    args: &[&str],
    pathspecs: &[Vec<u8>],
) -> Result<(), String> {
    let folder = tempfile::tempdir()
        .map_err(|error| format!("could not prepare the file list for Git: {error}"))?;
    let list = folder.path().join("pathspecs");
    let contents: Vec<u8> = pathspecs
        .iter()
        .flat_map(|pathspec| pathspec.iter().copied().chain([0]))
        .collect();
    std::fs::write(&list, contents)
        .map_err(|error| format!("could not prepare the file list for Git: {error}"))?;
    let mut from_file = OsString::from("--pathspec-from-file=");
    from_file.push(&list);
    let args = [args, &["--pathspec-file-nul"]].concat();
    ok_or_err(run_configured_git(root, &args, true, |command| {
        command.arg(from_file);
    })?)
}

/// The entries of a `-z` listing. Git ends each one with a NUL, so a listing
/// that ends otherwise was cut at the output limit and is refused rather than
/// checked in part.
fn git_listing(output: std::process::Output) -> Result<Vec<Vec<u8>>, String> {
    let listing = output.stdout.clone();
    ok_or_err(output)?;
    if listing.last().is_some_and(|byte| *byte != 0) {
        return Err("Git listed too many files to check for secrets".into());
    }
    Ok(listing
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .map(<[u8]>::to_vec)
        .collect())
}

fn unstage_all(root: &PathBuf) -> Result<(), String> {
    let out = if has_head(root) {
        run_git(root, &["reset", "-q", "HEAD", "--", "."])?
    } else {
        run_git(
            root,
            &["rm", "-r", "--cached", "-q", "--ignore-unmatch", "--", "."],
        )?
    };
    ok_or_err(out)
}

/// Commit the staged index only. Returns false (no-op) when nothing is staged.
fn commit_index(root: &PathBuf, message: &str) -> Result<bool, String> {
    if !has_staged_changes(root) {
        return Ok(false);
    }
    let out = run_git(root, &["commit", "--quiet", "-m", message])?;
    if out.status.success() {
        Ok(true)
    } else {
        Err(out_to_string(&out))
    }
}

/// Content of `path` at a revision: `rev = "HEAD"` for the last commit, `"INDEX"`
/// for the staged version. Missing in that revision (added/deleted/untracked)
/// yields an empty string rather than an error.
fn show(root: &PathBuf, rev: &str, path: &str) -> Result<String, String> {
    let object = if rev == "INDEX" {
        format!(":{path}")
    } else {
        format!("{rev}:{path}")
    };
    let out = run_git_read_only(root, &["show", &object])?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
pub async fn git_stage(project_id: String, path: String) -> Result<(), String> {
    git_stage_paths(project_id, vec![path]).await
}

#[tauri::command]
pub async fn git_stage_paths(project_id: String, paths: Vec<String>) -> Result<(), String> {
    validate_repo_relative_paths(&paths)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
        let root = existing_repo(&project_id)?;
        stage_paths(&root, &paths)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_unstage(project_id: String, path: String) -> Result<(), String> {
    git_unstage_paths(project_id, vec![path]).await
}

#[tauri::command]
pub async fn git_unstage_paths(project_id: String, paths: Vec<String>) -> Result<(), String> {
    validate_repo_relative_paths(&paths)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
        let root = existing_repo(&project_id)?;
        unstage_paths(&root, &paths)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_stage_all(project_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
        let root = existing_repo(&project_id)?;
        stage_all(&root)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_unstage_all(project_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
        let root = existing_repo(&project_id)?;
        unstage_all(&root)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_commit(project_id: String, message: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
        let root = existing_repo(&project_id)?;
        commit_index(&root, &message)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_commit_amend(project_id: String, message: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
        let root = existing_repo(&project_id)?;
        if !has_head(&root) {
            return Err("Create the first commit before amending it.".into());
        }
        if message.trim().is_empty() {
            ok_or_err(run_git(
                &root,
                &["commit", "--amend", "--quiet", "--no-edit"],
            )?)?;
        } else {
            ok_or_err(run_git(
                &root,
                &["commit", "--amend", "--quiet", "-m", &message],
            )?)?;
        }
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn validate_branch_name(root: &PathBuf, branch: &str) -> Result<(), String> {
    if branch.is_empty() || branch.contains('\0') || branch.starts_with('-') {
        return Err("Choose a valid branch name.".into());
    }
    let out = run_git_read_only(root, &["check-ref-format", "--branch", branch])?;
    if out.status.success() {
        Ok(())
    } else {
        Err("Choose a valid branch name.".into())
    }
}

#[tauri::command]
pub async fn git_create_branch(project_id: String, branch: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id)?;
        let root = existing_repo(&project_id)?;
        validate_branch_name(&root, &branch)?;
        ok_or_err(run_git(&root, &["branch", "--", &branch])?)?;
        Ok(branch)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn git_checkout_branch(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    branch: String,
    expected_generation: Option<u64>,
) -> Result<crate::project::ProjectStateChanged, String> {
    let operation_id = project_id.clone();
    let mutation = crate::project::mutate_project_worktree(
        &state,
        project_id.clone(),
        expected_generation,
        move |_| {
            let root = existing_repo(&operation_id)?;
            validate_branch_name(&root, &branch)?;
            ok_or_err(run_git(&root, &["switch", "--quiet", "--", &branch])?)?;
            Ok(((), true))
        },
    )
    .await?;
    mutation.value?;
    crate::project::publish_project_state_changed(
        &app,
        &state,
        &project_id,
        mutation.project,
        "git-checkout-branch",
        true,
        Some(mutation.generation),
    )
}

fn stash_push_at(root: &PathBuf) -> Result<(GitMutationOutcome, bool), String> {
    let out = run_git(root, &["stash", "push", "--include-untracked"])?;
    let report = String::from_utf8_lossy(&out.stdout).to_string();
    ok_or_err(out)?;
    if report.contains("No local changes to save") {
        return Ok((
            GitMutationOutcome {
                message: "Nothing to stash.".into(),
                outcome: "unchanged".into(),
                conflicts: Vec::new(),
                changed: false,
            },
            false,
        ));
    }
    Ok((
        GitMutationOutcome {
            message: "Saved changes to the stash.".into(),
            outcome: "stashed".into(),
            conflicts: Vec::new(),
            changed: true,
        },
        true,
    ))
}

fn stash_pop_at(root: &PathBuf) -> Result<(GitMutationOutcome, bool), String> {
    let out = run_git(root, &["stash", "pop"])?;
    if out.status.success() {
        return Ok((
            GitMutationOutcome {
                message: "Applied the latest stash.".into(),
                outcome: "applied".into(),
                conflicts: Vec::new(),
                changed: true,
            },
            true,
        ));
    }
    let conflicts = conflicts_at(root)?;
    if !conflicts.is_empty() {
        return Ok((
            GitMutationOutcome {
                message: "Applying the stash needs conflict resolution.".into(),
                outcome: "conflicts".into(),
                conflicts,
                changed: true,
            },
            true,
        ));
    }
    // Git can apply tracked changes before failing to restore an untracked
    // file. Return the failure with project state so editors reload before
    // they unlock, rather than saving their old buffers over the applied work.
    Ok((
        GitMutationOutcome {
            message: out_to_string(&out),
            outcome: "failed".into(),
            conflicts,
            changed: true,
        },
        true,
    ))
}

async fn run_git_worktree_operation<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    expected_generation: Option<u64>,
    reason: &'static str,
    operation: impl FnOnce(&PathBuf) -> Result<(GitMutationOutcome, bool), String> + Send + 'static,
) -> Result<GitWorktreeOperationResult, String> {
    let operation_project_id = project_id.clone();
    let mutation = crate::project::mutate_project_worktree(
        &state,
        project_id.clone(),
        expected_generation,
        move |_| {
            let root = existing_repo(&operation_project_id)?;
            operation(&root)
        },
    )
    .await?;
    let outcome = mutation.value?;
    let project_state = crate::project::publish_project_state_changed(
        &app,
        &state,
        &project_id,
        mutation.project,
        reason,
        outcome.changed,
        Some(mutation.generation),
    )?;
    Ok(GitWorktreeOperationResult {
        message: outcome.message,
        outcome: outcome.outcome,
        conflicts: outcome.conflicts,
        project_state,
    })
}

#[tauri::command]
pub async fn git_stash_push(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    expected_generation: Option<u64>,
) -> Result<GitWorktreeOperationResult, String> {
    run_git_worktree_operation(
        app,
        state,
        project_id,
        expected_generation,
        "git-stash-push",
        stash_push_at,
    )
    .await
}

#[tauri::command]
pub async fn git_stash_pop(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    expected_generation: Option<u64>,
) -> Result<GitWorktreeOperationResult, String> {
    run_git_worktree_operation(
        app,
        state,
        project_id,
        expected_generation,
        "git-stash-pop",
        stash_pop_at,
    )
    .await
}

struct UnmergedIndexStages {
    current_exists: bool,
    incoming_exists: bool,
}

fn unmerged_index_stages(root: &PathBuf, path: &str) -> Result<UnmergedIndexStages, String> {
    validate_repo_relative_path(path)?;
    let out = run_git_read_only(
        root,
        &["--literal-pathspecs", "ls-files", "-u", "-z", "--", path],
    )?;
    if !out.status.success() || out.stdout.is_empty() {
        return Err("That file is not waiting for conflict resolution.".into());
    }
    let mut current_exists = false;
    let mut incoming_exists = false;
    for entry in out.stdout.split(|byte| *byte == 0) {
        let Some(tab) = entry.iter().position(|byte| *byte == b'\t') else {
            continue;
        };
        let header = &entry[..tab];
        let Some(stage) = header
            .split(|byte| *byte == b' ')
            .filter(|field| !field.is_empty())
            .nth(2)
        else {
            continue;
        };
        match stage {
            b"2" => current_exists = true,
            b"3" => incoming_exists = true,
            _ => {}
        }
    }
    Ok(UnmergedIndexStages {
        current_exists,
        incoming_exists,
    })
}

fn resolve_conflict_side(root: &PathBuf, path: &str, resolution: &str) -> Result<(), String> {
    let stages = unmerged_index_stages(root, path)?;
    let (side_exists, checkout_side) = match resolution {
        "current" => (stages.current_exists, "--ours"),
        "incoming" => (stages.incoming_exists, "--theirs"),
        "mark" => return stage(root, path),
        _ => return Err("Choose current, incoming, or mark for the conflict resolution.".into()),
    };
    if side_exists {
        ok_or_err(run_git(
            root,
            &["--literal-pathspecs", "checkout", checkout_side, "--", path],
        )?)?;
        return stage(root, path);
    }

    // A missing stage means the selected side deleted the file. `git rm` both
    // removes the working-tree copy and records the resolution in the index.
    ok_or_err(run_git(root, &["--literal-pathspecs", "rm", "--", path])?)
}

#[tauri::command]
pub async fn git_resolve_conflict(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    path: String,
    resolution: String,
    expected_generation: Option<u64>,
) -> Result<crate::project::ProjectStateChanged, String> {
    validate_repo_relative_path(&path)?;
    let operation_project_id = project_id.clone();
    let mutation = crate::project::mutate_project_worktree(
        &state,
        project_id.clone(),
        expected_generation,
        move |_| {
            let root = existing_repo(&operation_project_id)?;
            resolve_conflict_side(&root, &path, &resolution)?;
            Ok(((), true))
        },
    )
    .await?;
    mutation.value?;
    crate::project::publish_project_state_changed(
        &app,
        &state,
        &project_id,
        mutation.project,
        "git-resolve-conflict",
        true,
        Some(mutation.generation),
    )
}

#[tauri::command]
pub async fn git_continue_merge(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    expected_generation: Option<u64>,
) -> Result<GitWorktreeOperationResult, String> {
    run_git_worktree_operation(
        app,
        state,
        project_id,
        expected_generation,
        "git-continue-merge",
        move |root| {
            if !merge_in_progress(root)? {
                return Err("There is no merge to continue.".into());
            }
            let conflicts = conflicts_at(root)?;
            if !conflicts.is_empty() {
                return Err("Resolve every conflicted file before continuing the merge.".into());
            }
            ok_or_err(run_git(
                root,
                &["-c", "core.editor=true", "merge", "--continue"],
            )?)?;
            Ok((
                GitMutationOutcome {
                    message: "Completed the merge.".into(),
                    outcome: "merged".into(),
                    conflicts: Vec::new(),
                    changed: true,
                },
                true,
            ))
        },
    )
    .await
}

#[tauri::command]
pub async fn git_abort_merge(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    expected_generation: Option<u64>,
) -> Result<GitWorktreeOperationResult, String> {
    run_git_worktree_operation(
        app,
        state,
        project_id,
        expected_generation,
        "git-abort-merge",
        move |root| {
            if !merge_in_progress(root)? {
                return Err("There is no merge to abort.".into());
            }
            ok_or_err(run_git(root, &["merge", "--abort"])?)?;
            Ok((
                GitMutationOutcome {
                    message: "Aborted the merge.".into(),
                    outcome: "aborted".into(),
                    conflicts: Vec::new(),
                    changed: true,
                },
                true,
            ))
        },
    )
    .await
}

#[tauri::command]
pub async fn git_show(project_id: String, rev: String, path: String) -> Result<String, String> {
    validate_repo_relative_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
        let Some(root) = initialized_repo(&project_id)? else {
            return Ok(String::new());
        };
        show(&root, &rev, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{
        attach_imported_repository_history_at, attach_imported_repository_history_lock_held,
        clean_remote_credentials, commit_index, conflicts_at, current_branch, discard_paths_at,
        ensure_repository, ensure_repository_with, git_log_at, initialize_repo,
        is_allowed_remote_url, local_bounds, merge_in_progress, ok_or_err, out_to_string,
        parse_status_porcelain, parse_status_porcelain_bytes, remote_credentials_need_cleanup,
        resolve_conflict_side, restore_worktree, run_configured_git, run_git, run_git_read_only,
        sanitize_url, show, stage, stage_all, stage_paths, stash_pop_at, stash_push_at,
        unmerged_index_stages, unstage, unstage_all, unstage_paths, validate_branch_name,
        validate_git_oid, validate_repo_relative_path, Command,
    };
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::mpsc;
    use std::time::Duration;

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    #[test]
    fn imported_history_is_never_attached_to_a_linked_folder() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        std::fs::create_dir(&data).unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", &data);
        let folder = directory.path().join("thesis");
        std::fs::create_dir(&folder).unwrap();
        let linked = crate::linked_registry::register_folder_for_test(&folder);

        let error = attach_imported_repository_history_lock_held(
            &linked.id,
            "https://github.com/octo/paper.git",
            "main",
            "token",
        )
        .unwrap_err();

        assert!(error.contains("project.linked_not_recyclable"), "{error}");
        assert!(!folder.join(".git").exists());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_failed_transfer_reports_where_it_stopped_not_every_percentage() {
        #[cfg(unix)]
        use std::os::unix::process::ExitStatusExt;
        #[cfg(windows)]
        use std::os::windows::process::ExitStatusExt;

        let out = std::process::Output {
            status: std::process::ExitStatus::from_raw(1),
            stdout: Vec::new(),
            stderr: b"Writing objects:  10% (1/10)\rWriting objects:  90% (9/10)\r\n\
                      error: failed to push some refs\r\n"
                .to_vec(),
        };
        assert_eq!(
            out_to_string(&out),
            "Writing objects:  90% (9/10)\nerror: failed to push some refs"
        );
    }

    #[test]
    fn only_tree_walking_subcommands_get_the_longer_local_deadline() {
        let long = super::WORKTREE_SCALE_DEADLINE;
        let short = super::LOCAL_DEADLINE;
        assert!(long > short);
        for args in [
            vec!["add", "-A"],
            vec!["commit", "-m", "message"],
            vec!["status", "--porcelain"],
            vec!["checkout", "--", "main.tex"],
            vec!["restore", "--staged", "main.tex"],
            vec!["switch", "--quiet", "--", "draft"],
            vec!["read-tree", "--reset", "-u", "HEAD"],
            vec!["rm", "-r", "--cached", "-q", "--ignore-unmatch", "--", "."],
            vec!["diff"],
            vec!["--literal-pathspecs", "add", "--", "main.tex"],
            vec!["-c", "core.editor=true", "merge", "--continue"],
            vec!["-C", "project", "status", "--porcelain"],
            vec!["-c", "core.fsmonitor=false", "status", "--porcelain=v1"],
        ] {
            assert_eq!(local_bounds(&args).total_for_test(), long, "{args:?}");
        }
        for args in [
            vec!["log", "-1"],
            vec!["diff", "--cached"],
            vec!["--literal-pathspecs", "diff", "--cached", "--", "main.tex"],
            vec!["diff", "--no-index", "--", "/dev/null", "main.tex"],
            vec!["show", "HEAD:main.tex"],
            vec!["rev-parse", "HEAD"],
            vec!["remote", "get-url", "origin"],
            vec!["ls-files", "--cached"],
            vec!["-c", "core.quotepath=false", "log", "-1"],
            vec![
                "-c",
                "core.fsmonitor=false",
                "diff",
                "--cached",
                "--no-ext-diff",
                "--no-textconv",
            ],
        ] {
            assert_eq!(local_bounds(&args).total_for_test(), short, "{args:?}");
        }
    }

    /// Create a throwaway git repo in a temp dir with a fixed identity.
    fn temp_repo() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("oleafly-git-test-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        run_git(&dir, &["init", "--quiet"]).unwrap();
        run_git(&dir, &["config", "core.autocrlf", "false"]).unwrap();
        run_git(&dir, &["symbolic-ref", "HEAD", "refs/heads/main"]).unwrap();
        run_git(&dir, &["config", "user.email", "t@t"]).unwrap();
        run_git(&dir, &["config", "user.name", "t"]).unwrap();
        dir
    }

    fn temp_dir(label: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "oleafly-git-{label}-test-{}-{n}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(root: &Path, name: &str, content: &str) {
        std::fs::write(root.join(name), content).unwrap();
    }

    struct TestDataDirOverride {
        previous: Option<std::ffi::OsString>,
    }

    impl TestDataDirOverride {
        fn set(path: &Path) -> Self {
            let previous = std::env::var_os("OLEAFLY_DATA_DIR");
            std::env::set_var("OLEAFLY_DATA_DIR", path);
            Self { previous }
        }
    }

    impl Drop for TestDataDirOverride {
        fn drop(&mut self) {
            if let Some(previous) = self.previous.take() {
                std::env::set_var("OLEAFLY_DATA_DIR", previous);
            } else {
                std::env::remove_var("OLEAFLY_DATA_DIR");
            }
        }
    }

    #[test]
    fn ensure_repository_creates_a_repository_in_an_empty_project() {
        let root = temp_dir("ensure-empty");
        write(&root, "main.tex", "\\documentclass{article}\n");

        assert!(ensure_repository(&root).unwrap());

        assert!(root.join(".git").is_dir());
        assert!(current_branch(&root).is_ok());
        assert!(
            std::fs::read_to_string(root.join(".git/info/exclude"))
                .unwrap()
                .lines()
                .any(|line| line == ".oleafly/"),
            "the automatic repository excludes Oleafly's private build directory"
        );
        assert!(!root.join(".gitignore").exists());
        let log = run_git(&root, &["log", "--oneline"]).unwrap();
        assert!(
            !log.status.success() || log.stdout.is_empty(),
            "ensure_repository must never commit"
        );
        let status = run_git_read_only(&root, &["status", "--porcelain"]).unwrap();
        assert_eq!(
            String::from_utf8_lossy(&status.stdout).trim(),
            "?? main.tex",
            "ensure_repository must never stage"
        );
    }

    #[test]
    fn ensure_repository_leaves_an_existing_repository_alone() {
        let root = temp_repo();
        write(&root, "main.tex", "first\n");
        stage_all(&root).unwrap();
        assert!(commit_index(&root, "first").unwrap());
        let head = run_git(&root, &["rev-parse", "HEAD"]).unwrap().stdout;

        assert!(!ensure_repository(&root).unwrap());

        assert_eq!(run_git(&root, &["rev-parse", "HEAD"]).unwrap().stdout, head);
        assert_eq!(current_branch(&root).unwrap(), "main");
    }

    #[test]
    fn ensure_repository_sets_an_identity_so_commits_work_without_a_global_config() {
        let root = temp_dir("ensure-identity");
        let no_global = temp_dir("ensure-identity-no-global");
        write(&root, "main.tex", "identity\n");
        let configure = |command: &mut Command| {
            command
                .env("HOME", &no_global)
                .env("XDG_CONFIG_HOME", &no_global)
                .env("GIT_CONFIG_GLOBAL", no_global.join("missing-global-config"))
                .env("GIT_CONFIG_NOSYSTEM", "1");
        };

        assert!(ensure_repository_with(&root, configure).unwrap());

        let email =
            run_configured_git(&root, &["config", "--local", "user.email"], true, configure)
                .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&email.stdout).trim(),
            "oleafly@local"
        );
        ok_or_err(run_configured_git(&root, &["add", "-A"], true, configure).unwrap()).unwrap();
        ok_or_err(run_configured_git(&root, &["commit", "-m", "first"], true, configure).unwrap())
            .unwrap();
        let head =
            run_configured_git(&root, &["rev-parse", "--verify", "HEAD"], true, configure).unwrap();
        assert!(head.status.success());
    }

    #[test]
    fn ensure_repository_does_not_nest_a_repository_inside_another_one() {
        let parent = temp_repo();
        let project = parent.join("projects").join("nested-project");
        std::fs::create_dir_all(&project).unwrap();
        write(&project, "main.tex", "nested\n");

        assert!(!ensure_repository(&project).unwrap());

        assert!(!project.join(".git").exists());
    }

    /// Point this thread's Git spawns at a program that does not exist. PATH
    /// overrides cannot hide a program on Windows, so tests inject the path.
    fn missing_git() -> super::testing::GitProgramOverride {
        let program =
            temp_dir("missing-git")
                .join("bin")
                .join(if cfg!(windows) { "git.exe" } else { "git" });
        super::testing::use_git_program(program)
    }

    fn git_text(root: &Path, args: &[&str]) -> String {
        let output = run_git(&root.to_path_buf(), args).unwrap();
        assert!(output.status.success(), "{}", out_to_string(&output));
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    #[test]
    fn a_program_that_does_not_exist_is_not_a_usable_git() {
        let missing = temp_dir("missing-git-probe").join("git");
        assert!(!super::git_available_as(missing.as_os_str()));
        assert!(super::git_available(), "the test machine has Git");
    }

    #[test]
    fn missing_git_is_reported_as_not_installed_on_every_platform() {
        let root = temp_dir("not-installed");
        write(&root, "main.tex", "no git here\n");
        let _git = missing_git();

        assert!(!super::git_available());
        let error = ensure_repository(&root).unwrap_err();
        assert!(error.contains("\"code\":\"git.not_installed\""), "{error}");
        let error = run_git(&root, &["status"]).unwrap_err();
        assert!(error.contains("\"code\":\"git.not_installed\""), "{error}");
        assert!(!root.join(".git").exists());
        assert_eq!(
            std::fs::read_to_string(root.join("main.tex")).unwrap(),
            "no git here\n"
        );
    }

    #[test]
    fn a_spawn_that_cannot_find_git_is_not_blamed_on_git_when_git_is_installed() {
        let missing_folder = temp_dir("missing-cwd").join("gone");
        let error = run_git(&missing_folder, &["status"]).unwrap_err();
        assert!(!error.contains("git.not_installed"), "{error}");
        assert!(super::git_available());
    }

    #[test]
    fn the_workspace_snapshot_says_when_git_is_missing() {
        let root = temp_repo();
        write(&root, "main.tex", "draft\n");
        {
            let _git = missing_git();
            let snapshot = super::workspace_snapshot_at(&root).unwrap();
            assert!(!snapshot.git_available);
            assert!(snapshot.initialized, "the repository is still there");
            assert!(snapshot.changes.is_empty());
            assert!(snapshot.commits.is_empty());
            let json = serde_json::to_value(&snapshot).unwrap();
            assert_eq!(json["gitAvailable"], false);
        }
        let snapshot = super::workspace_snapshot_at(&root).unwrap();
        assert!(snapshot.git_available);
        assert!(snapshot.initialized);
        assert_eq!(snapshot.changes.len(), 1);
        let empty = temp_dir("snapshot-no-repo");
        let snapshot = super::workspace_snapshot_at(&empty).unwrap();
        assert!(snapshot.git_available);
        assert!(!snapshot.initialized);
    }

    #[test]
    fn head_state_reports_the_commit_and_uncommitted_changes() {
        let root = temp_repo();
        write(&root, "main.tex", "first\n");
        assert_eq!(super::head_state(&root), None, "HEAD is unborn");
        stage_all(&root).unwrap();
        assert!(commit_index(&root, "first").unwrap());
        let head = git_text(&root, &["rev-parse", "HEAD"]);

        assert_eq!(super::head_state(&root), Some((head.clone(), false)));
        write(&root, "main.tex", "second\n");
        assert_eq!(super::head_state(&root), Some((head.clone(), true)));
        write(&root, "main.tex", "first\n");
        write(&root, "notes.md", "new\n");
        assert_eq!(
            super::head_state(&root),
            Some((head.clone(), true)),
            "an untracked file is an uncommitted change"
        );
        let chapter = root.join("chapter");
        std::fs::create_dir_all(&chapter).unwrap();
        assert_eq!(
            super::head_state(&chapter),
            None,
            "a folder inside a repository is not its root"
        );
        let _git = missing_git();
        assert_eq!(super::head_state(&root), None);
    }

    #[test]
    fn only_the_macos_placeholder_git_needs_the_developer_tools() {
        let placeholder = Path::new("/usr/bin/git");
        assert_eq!(
            super::is_developer_tools_placeholder(placeholder),
            cfg!(target_os = "macos")
        );
        assert!(!super::is_developer_tools_placeholder(Path::new(
            "/opt/homebrew/bin/git"
        )));
        assert!(!super::is_developer_tools_placeholder(Path::new(
            "/usr/local/bin/git"
        )));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_macos_placeholder_git_is_missing_without_the_developer_tools() {
        let asked = std::cell::Cell::new(false);
        let available = super::probe_git(std::ffi::OsStr::new("/usr/bin/git"), || {
            asked.set(true);
            false
        });
        assert!(asked.get());
        assert!(!available, "the placeholder never runs without the tools");
    }

    const PRIVATE_EXCLUDES: [&str; 6] = [
        ".oleafly/",
        ".DS_Store",
        "Thumbs.db",
        "desktop.ini",
        "_minted-*/",
        "pythontex-files-*/",
    ];

    #[test]
    fn new_repository_excludes_are_added_once_after_existing_lines() {
        let root = temp_repo();
        let exclude = root.join(".git").join("info").join("exclude");
        std::fs::create_dir_all(exclude.parent().unwrap()).unwrap();
        std::fs::write(&exclude, "# mine\n*.bak\n.oleafly/").unwrap();

        super::ensure_private_exclude(&root, super::Excludes::NewRepository).unwrap();
        super::ensure_private_exclude(&root, super::Excludes::NewRepository).unwrap();

        let text = std::fs::read_to_string(&exclude).unwrap();
        assert!(text.starts_with("# mine\n*.bak\n.oleafly/\n"), "{text}");
        for line in PRIVATE_EXCLUDES
            .iter()
            .chain(crate::build_hygiene::BUILD_ARTIFACT_PATTERNS)
        {
            assert_eq!(
                text.lines().filter(|entry| entry.trim() == *line).count(),
                1,
                "{line} appears once in:\n{text}"
            );
        }
        assert!(!text.lines().any(|entry| entry.trim() == "*.bbl"));

        for name in ["main.tex", "main.aux", "main.bbl", "main.synctex.gz"] {
            write(&root, name, "x\n");
        }
        std::fs::create_dir_all(root.join("_minted-main")).unwrap();
        write(&root.join("_minted-main"), "code.pygtex", "x\n");
        let mut untracked: Vec<String> =
            git_text(&root, &["ls-files", "--others", "--exclude-standard"])
                .lines()
                .map(str::to_string)
                .collect();
        untracked.sort();
        assert_eq!(untracked, ["main.bbl", "main.tex"]);
    }

    #[test]
    fn a_new_repository_gets_one_first_commit_of_its_sources() {
        let root = temp_dir("baseline");
        write(&root, "main.tex", "\\documentclass{article}\n");
        write(&root, "main.aux", "build output\n");
        std::fs::create_dir_all(root.join(".oleafly")).unwrap();
        write(&root.join(".oleafly"), "state.json", "{}\n");
        assert!(ensure_repository(&root).unwrap());
        ok_or_err(run_git(&root, &["config", "core.autocrlf", "false"]).unwrap()).unwrap();

        assert_eq!(
            super::commit_baseline(&root).unwrap(),
            super::Baseline::Committed
        );

        assert_eq!(git_text(&root, &["log", "--format=%s"]), "Create project");
        assert_eq!(git_text(&root, &["ls-files"]), "main.tex");
        assert_eq!(git_text(&root, &["status", "--porcelain"]), "");
        assert_eq!(
            super::commit_baseline(&root).unwrap(),
            super::Baseline::NotNeeded,
            "a repository with history keeps it"
        );
        assert_eq!(git_text(&root, &["rev-list", "--count", "HEAD"]), "1");
    }

    #[test]
    fn an_empty_new_repository_is_left_without_a_commit() {
        let root = temp_dir("baseline-empty");
        assert!(ensure_repository(&root).unwrap());
        assert_eq!(
            super::commit_baseline(&root).unwrap(),
            super::Baseline::NotNeeded
        );
        assert!(!super::has_head(&root));
    }

    #[test]
    fn a_failing_hook_or_signing_setting_does_not_block_the_first_commit() {
        let root = temp_dir("baseline-hooks");
        write(&root, "main.tex", "hooks\n");
        assert!(ensure_repository(&root).unwrap());
        let hooks = temp_dir("baseline-hooks-dir");
        for hook in ["pre-commit", "commit-msg", "post-commit"] {
            let path = hooks.join(hook);
            std::fs::write(&path, "#!/bin/sh\necho ran > hook-ran\nexit 1\n").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
        }
        let missing_gpg = temp_dir("baseline-no-gpg").join("gpg-missing");
        for (key, value) in [
            ("core.hooksPath", hooks.to_str().unwrap()),
            ("commit.gpgsign", "true"),
            ("gpg.program", missing_gpg.to_str().unwrap()),
        ] {
            ok_or_err(run_git(&root, &["config", key, value]).unwrap()).unwrap();
        }

        assert_eq!(
            super::commit_baseline(&root).unwrap(),
            super::Baseline::Committed
        );
        assert!(!root.join("hook-ran").exists(), "no hook ran");
        assert_eq!(git_text(&root, &["log", "--format=%s"]), "Create project");
    }

    #[test]
    fn a_project_above_the_size_limit_keeps_its_files_unstaged() {
        let root = temp_dir("baseline-large");
        write(
            &root,
            "main.tex",
            "0123456789012345678901234567890123456789\n",
        );
        write(
            &root,
            "figure.dat",
            "0123456789012345678901234567890123456789\n",
        );
        assert!(ensure_repository(&root).unwrap());

        assert_eq!(
            super::commit_baseline_with_limit(&root, 64).unwrap(),
            super::Baseline::TooLarge(82)
        );
        assert!(!super::has_head(&root));
        assert_eq!(git_text(&root, &["ls-files", "--cached"]), "");
        let objects = root.join(".git").join("objects");
        assert!(
            !std::fs::read_dir(&objects).unwrap().any(|entry| {
                let name = entry.unwrap().file_name();
                name.len() == 2 && name != "info" && name != "pack"
            }),
            "nothing was hashed into the object store"
        );
    }

    /// Ignore the machine's global excludes file in a test repository, so a
    /// developer's own ignore list (which may name `.env` or `.private/`)
    /// cannot hide the files a test expects Git to see.
    fn without_global_excludes(root: &Path) {
        let missing = root.join(".git").join("no-global-excludes");
        let missing = missing.to_str().unwrap();
        ok_or_err(
            run_git(
                &root.to_path_buf(),
                &["config", "core.excludesFile", missing],
            )
            .unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn a_new_project_with_secret_files_gets_no_first_commit() {
        let root = temp_dir("baseline-secrets");
        write(&root, "main.tex", "\\documentclass{article}\n");
        write(&root, ".env", "API_KEY=abc\n");
        write(&root, "key.pem", "-----BEGIN PRIVATE KEY-----\n");
        std::fs::create_dir_all(root.join("analysis")).unwrap();
        write(&root.join("analysis"), ".env.local", "TOKEN=abc\n");
        assert!(ensure_repository(&root).unwrap());
        without_global_excludes(&root);

        let baseline = super::commit_baseline(&root);

        assert!(!super::has_head(&root), "{baseline:?}");
        assert_eq!(git_text(&root, &["ls-files", "--cached"]), "");
        let objects = root.join(".git").join("objects");
        assert!(
            !std::fs::read_dir(&objects).unwrap().any(|entry| {
                let name = entry.unwrap().file_name();
                name.len() == 2 && name != "info" && name != "pack"
            }),
            "nothing was hashed into the object store"
        );
        let mut untracked: Vec<String> =
            git_text(&root, &["status", "--porcelain", "--untracked-files=all"])
                .lines()
                .map(str::to_string)
                .collect();
        untracked.sort();
        assert_eq!(
            untracked,
            [
                "?? .env",
                "?? analysis/.env.local",
                "?? key.pem",
                "?? main.tex"
            ],
            "every file stays visible in Source Control"
        );
        assert!(!root.join(".gitignore").exists());
        assert_eq!(
            baseline.unwrap(),
            super::Baseline::SecretFiles(vec![
                ".env".into(),
                "analysis/.env.local".into(),
                "key.pem".into(),
            ])
        );
    }

    #[test]
    fn every_common_secret_file_name_skips_the_first_commit() {
        for name in [
            ".env",
            ".env.production",
            ".envrc",
            "deploy.pem",
            "server.key",
            "cert.p12",
            "cert.pfx",
            "id_rsa",
            "id_dsa",
            "id_ecdsa",
            "id_ed25519",
            ".npmrc",
            ".pypirc",
            ".netrc",
            "_netrc",
            ".git-credentials",
            "credentials",
            "credentials.json",
            "Credentials.JSON",
            "secrets",
            "secrets.json",
            ".htpasswd",
            "putty.ppk",
            "release.jks",
            "app.keystore",
        ] {
            let root = temp_dir("baseline-secret-name");
            write(&root, "main.tex", "\\documentclass{article}\n");
            std::fs::create_dir_all(root.join("config")).unwrap();
            write(&root.join("config"), name, "secret\n");
            assert!(ensure_repository(&root).unwrap());
            without_global_excludes(&root);

            let baseline = super::commit_baseline(&root);

            assert!(!super::has_head(&root), "{name}: {baseline:?}");
            assert_eq!(
                baseline.unwrap(),
                super::Baseline::SecretFiles(vec![format!("config/{name}")]),
                "{name}"
            );
        }
        let private = temp_dir("baseline-secret-folder");
        write(&private, "main.tex", "\\documentclass{article}\n");
        std::fs::create_dir_all(private.join(".private")).unwrap();
        write(&private.join(".private"), "notes.md", "confidential\n");
        assert!(ensure_repository(&private).unwrap());
        without_global_excludes(&private);
        assert_eq!(
            super::commit_baseline(&private).unwrap(),
            super::Baseline::SecretFiles(vec![".private/notes.md".into()])
        );
    }

    #[test]
    fn ordinary_research_files_still_get_the_first_commit() {
        let root = temp_dir("baseline-not-secret");
        for name in [
            "main.tex",
            "environment.tex",
            "keys.tex",
            "credentials.tex",
            "keynote-notes.md",
            "env.bib",
            "latexmkrc",
            "monkey.png",
            "id_rsa.pub",
            ".env.example",
        ] {
            write(&root, name, "x\n");
        }
        write(&root, "talk.key", "PK\u{3}\u{4}\u{14}\u{0}keynote");
        assert!(ensure_repository(&root).unwrap());

        assert_eq!(
            super::commit_baseline(&root).unwrap(),
            super::Baseline::Committed
        );
        assert_eq!(git_text(&root, &["status", "--porcelain"]), "");
    }

    #[test]
    fn a_secret_file_the_project_already_ignores_does_not_block_the_first_commit() {
        let root = temp_dir("baseline-ignored-secret");
        write(&root, "main.tex", "\\documentclass{article}\n");
        write(&root, ".gitignore", ".env\n");
        write(&root, ".env", "API_KEY=abc\n");
        assert!(ensure_repository(&root).unwrap());
        without_global_excludes(&root);
        ok_or_err(run_git(&root, &["config", "core.autocrlf", "false"]).unwrap()).unwrap();

        assert_eq!(
            super::commit_baseline(&root).unwrap(),
            super::Baseline::Committed
        );
        assert_eq!(git_text(&root, &["ls-files"]), ".gitignore\nmain.tex");
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_first_commit_leaves_nothing_staged() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp_dir("baseline-unreadable");
        write(&root, "main.tex", "readable\n");
        write(&root, "secret.tex", "unreadable\n");
        let secret = root.join("secret.tex");
        std::fs::set_permissions(&secret, std::fs::Permissions::from_mode(0o000)).unwrap();
        if std::fs::read(&secret).is_ok() {
            // Running as root: permissions cannot make the file unreadable.
            return;
        }
        assert!(ensure_repository(&root).unwrap());

        assert!(super::commit_baseline(&root).is_err());

        assert!(!super::has_head(&root));
        assert_eq!(git_text(&root, &["ls-files", "--cached"]), "");
        std::fs::set_permissions(&secret, std::fs::Permissions::from_mode(0o644)).unwrap();
    }

    #[test]
    fn initialized_repository_uses_the_selected_default_branch() {
        let root = temp_dir("default-branch");
        initialize_repo(&root, "trunk").unwrap();

        assert_eq!(current_branch(&root).unwrap(), "trunk");
        assert!(
            std::fs::read_to_string(root.join(".git/info/exclude"))
                .unwrap()
                .lines()
                .any(|line| line == ".oleafly/"),
            "Oleafly's private build directory belongs in the repository-local exclude file"
        );
        assert!(
            !root.join(".gitignore").exists(),
            "initializing Source Control must not add a project file"
        );
    }

    #[test]
    fn observing_an_uninitialized_project_does_not_create_a_repository() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let previous_data_dir = std::env::var_os("OLEAFLY_DATA_DIR");
        let data = temp_dir("observe-uninitialized");
        let project_id = "plain-project";
        std::fs::create_dir_all(data.join("projects").join(project_id)).unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", &data);

        let branch = super::git_current_branch_sync(project_id.to_string());
        let repository_was_created = data.join("projects").join(project_id).join(".git").exists();

        if let Some(previous) = previous_data_dir {
            std::env::set_var("OLEAFLY_DATA_DIR", previous);
        } else {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }
        assert!(
            branch.is_err(),
            "an uninitialized project has no Git branch"
        );
        assert!(
            !repository_was_created,
            "observing Source Control must not initialize Git"
        );
    }

    #[test]
    fn pushing_reads_the_worktree_and_never_takes_the_exclusive_lock() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let previous_data_dir = std::env::var_os("OLEAFLY_DATA_DIR");
        let data = temp_dir("push-shared-worktree");
        let project_id = "plain-project";
        std::fs::create_dir_all(data.join("projects").join(project_id)).unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", &data);

        let reader = crate::worktree_lock::ProjectWorktreeLock::shared(project_id).unwrap();
        let (finished_tx, finished_rx) = mpsc::channel();
        let pusher = std::thread::spawn(move || {
            let result = tokio::runtime::Builder::new_current_thread()
                .build()
                .unwrap()
                .block_on(super::git_push(project_id.to_string()));
            let _ = finished_tx.send(());
            result
        });
        let finished = finished_rx.recv_timeout(Duration::from_secs(5)).is_ok();
        drop(reader);
        let result = pusher.join().unwrap();

        if let Some(previous) = previous_data_dir {
            std::env::set_var("OLEAFLY_DATA_DIR", previous);
        } else {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }
        assert!(
            finished,
            "pushing waited for the exclusive worktree lock a reader already held"
        );
        assert!(result.is_err(), "an uninitialized project cannot be pushed");
    }

    #[tokio::test(flavor = "current_thread")]
    #[allow(clippy::await_holding_lock)]
    async fn every_background_git_observation_is_neutral_for_an_uninitialized_project() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let previous_data_dir = std::env::var_os("OLEAFLY_DATA_DIR");
        let data = temp_dir("observe-all-uninitialized");
        let project_id = "plain-project";
        let project = data.join("projects").join(project_id);
        std::fs::create_dir_all(&project).unwrap();
        write(&project, "main.tex", "unchanged\n");
        std::env::set_var("OLEAFLY_DATA_DIR", &data);

        let branch = super::git_current_branch_sync(project_id.to_string());
        let log = super::git_log(project_id.to_string()).await.unwrap();
        let status = super::git_status(project_id.to_string()).await.unwrap();
        let diff = super::git_diff(project_id.to_string(), None, false)
            .await
            .unwrap();
        let ahead_behind = super::git_ahead_behind(project_id.to_string())
            .await
            .unwrap();
        let shown = super::git_show(
            project_id.to_string(),
            "HEAD".to_string(),
            "main.tex".to_string(),
        )
        .await
        .unwrap();
        let repository_was_created = project.join(".git").exists();
        let source = std::fs::read_to_string(project.join("main.tex")).unwrap();

        if let Some(previous) = previous_data_dir {
            std::env::set_var("OLEAFLY_DATA_DIR", previous);
        } else {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }

        assert!(branch.is_err());
        assert!(log.is_empty());
        assert!(status.is_empty());
        assert!(diff.is_empty());
        assert!(!ahead_behind.has_upstream);
        assert!(shown.is_empty());
        assert!(!repository_was_created);
        assert_eq!(source, "unchanged\n");
    }

    #[tokio::test(flavor = "current_thread")]
    #[allow(clippy::await_holding_lock)]
    async fn async_git_commands_cover_the_workspace_lifecycle() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = temp_dir("async-command-boundary");
        let _data_dir = TestDataDirOverride::set(&data);
        let project_id = "async-command-project";
        let project = data.join("projects").join(project_id);
        std::fs::create_dir_all(&project).unwrap();
        write(&project, "main.tex", "base line\n");
        write(&project, "references.bib", "@book{base}\n");
        crate::project::write_meta(
            project_id,
            &crate::project::ProjectMeta {
                name: "Async command project".into(),
                main_doc: "main.tex".into(),
                engine: "tectonic".into(),
                ..Default::default()
            },
        )
        .unwrap();

        assert!(!super::git_is_initialized(project_id.into()).await.unwrap());
        assert!(super::git_get_remote(project_id.into())
            .await
            .unwrap()
            .is_none());
        assert!(super::git_head_oid(project_id.into())
            .await
            .unwrap()
            .is_none());
        let unopened = super::git_workspace_snapshot(project_id.into())
            .await
            .unwrap();
        assert!(!unopened.initialized);
        assert!(unopened.branch.is_none());
        assert!(unopened.changes.is_empty());
        assert!(unopened.commits.is_empty());
        assert!(!project.join(".git").exists());

        let branch = super::git_initialize(project_id.into()).await.unwrap();
        assert!(!branch.is_empty());
        assert_eq!(
            super::git_initialize(project_id.into()).await.unwrap(),
            branch,
            "initialization is idempotent"
        );
        assert!(super::git_is_initialized(project_id.into()).await.unwrap());
        ok_or_err(run_git(&project, &["config", "core.autocrlf", "false"]).unwrap()).unwrap();
        ok_or_err(
            run_git(
                &project,
                &["config", "user.email", "command-boundary@example.test"],
            )
            .unwrap(),
        )
        .unwrap();
        ok_or_err(run_git(&project, &["config", "user.name", "Command Boundary"]).unwrap())
            .unwrap();

        let initialized = super::git_workspace_snapshot(project_id.into())
            .await
            .unwrap();
        assert!(initialized.initialized);
        assert_eq!(initialized.branch.as_deref(), Some(branch.as_str()));
        assert_eq!(initialized.operation, "idle");
        assert_eq!(initialized.changes.len(), 3);
        assert!(initialized.changes.iter().all(|change| !change.staged));
        assert!(initialized.commits.is_empty());
        assert!(super::git_log(project_id.into()).await.unwrap().is_empty());
        assert!(
            super::git_commit_amend(project_id.into(), "too soon".into())
                .await
                .unwrap_err()
                .contains("first commit")
        );

        let untracked_diff = super::git_diff(project_id.into(), Some("main.tex".into()), false)
            .await
            .unwrap();
        assert!(untracked_diff.contains("+base line"));
        assert!(super::git_diff(project_id.into(), None, false)
            .await
            .unwrap()
            .is_empty());

        super::git_stage(project_id.into(), "main.tex".into())
            .await
            .unwrap();
        let status = super::git_status(project_id.into()).await.unwrap();
        assert!(status
            .iter()
            .any(|change| change.path == "main.tex" && change.staged && change.status == "A"));
        assert!(status
            .iter()
            .any(|change| change.path == "references.bib" && !change.staged));
        assert!(
            super::git_diff(project_id.into(), Some("main.tex".into()), true)
                .await
                .unwrap()
                .contains("+base line")
        );

        super::git_unstage(project_id.into(), "main.tex".into())
            .await
            .unwrap();
        assert!(super::git_status(project_id.into())
            .await
            .unwrap()
            .iter()
            .all(|change| !change.staged));

        let first_pair = vec!["main.tex".to_string(), "project.json".to_string()];
        super::git_stage_paths(project_id.into(), first_pair.clone())
            .await
            .unwrap();
        let status = super::git_status(project_id.into()).await.unwrap();
        assert_eq!(status.iter().filter(|change| change.staged).count(), 2);
        assert!(status
            .iter()
            .any(|change| change.path == "references.bib" && !change.staged));
        super::git_unstage_paths(project_id.into(), first_pair)
            .await
            .unwrap();
        assert!(super::git_status(project_id.into())
            .await
            .unwrap()
            .iter()
            .all(|change| !change.staged));

        super::git_stage_all(project_id.into()).await.unwrap();
        let staged_all = super::git_status(project_id.into()).await.unwrap();
        assert_eq!(staged_all.len(), 3);
        assert!(staged_all.iter().all(|change| change.staged));
        let staged_diff = super::git_diff(project_id.into(), None, true)
            .await
            .unwrap();
        assert!(staged_diff.contains("diff --git a/main.tex b/main.tex"));
        assert!(staged_diff.contains("diff --git a/references.bib b/references.bib"));
        super::git_unstage_all(project_id.into()).await.unwrap();
        assert!(super::git_status(project_id.into())
            .await
            .unwrap()
            .iter()
            .all(|change| !change.staged));

        super::git_stage_all(project_id.into()).await.unwrap();
        assert!(super::git_commit(project_id.into(), "Initial paper".into())
            .await
            .unwrap());
        assert!(!super::git_commit(project_id.into(), "No changes".into())
            .await
            .unwrap());
        let initial_oid = super::git_head_oid(project_id.into())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(initial_oid.len(), 40);
        let initial_log = super::git_log(project_id.into()).await.unwrap();
        assert_eq!(initial_log.len(), 1);
        assert_eq!(initial_log[0].message, "Initial paper");
        assert_eq!(initial_log[0].author, "Command Boundary");
        assert_eq!(
            super::git_show(project_id.into(), "HEAD".into(), "main.tex".into())
                .await
                .unwrap(),
            "base line\n"
        );
        assert!(
            super::git_show(project_id.into(), "HEAD".into(), "missing.tex".into())
                .await
                .unwrap()
                .is_empty()
        );
        assert!(super::git_status(project_id.into())
            .await
            .unwrap()
            .is_empty());

        let amended_main = "base line\namended line\n";
        write(&project, "main.tex", amended_main);
        write(&project, "appendix.tex", "appendix draft\n");
        let working_path_diff = super::git_diff(project_id.into(), Some("main.tex".into()), false)
            .await
            .unwrap();
        assert!(working_path_diff.contains("+amended line"));
        let working_all_diff = super::git_diff(project_id.into(), None, false)
            .await
            .unwrap();
        assert!(working_all_diff.contains("+amended line"));
        assert!(!working_all_diff.contains("appendix draft"));
        assert!(
            super::git_diff(project_id.into(), Some("appendix.tex".into()), false)
                .await
                .unwrap()
                .contains("+appendix draft")
        );

        super::git_stage(project_id.into(), "main.tex".into())
            .await
            .unwrap();
        super::git_stage_paths(project_id.into(), vec!["appendix.tex".into()])
            .await
            .unwrap();
        assert!(
            super::git_diff(project_id.into(), Some("main.tex".into()), true)
                .await
                .unwrap()
                .contains("+amended line")
        );
        assert!(super::git_diff(project_id.into(), None, true)
            .await
            .unwrap()
            .contains("+appendix draft"));
        let message_before_amend = super::git_log(project_id.into()).await.unwrap()[0]
            .message
            .clone();
        assert!(super::git_commit_amend(project_id.into(), "   ".into())
            .await
            .unwrap());
        assert_eq!(
            super::git_log(project_id.into()).await.unwrap()[0].message,
            message_before_amend
        );
        assert!(
            super::git_commit_amend(project_id.into(), "Amended paper".into())
                .await
                .unwrap()
        );
        let amended_oid = super::git_head_oid(project_id.into())
            .await
            .unwrap()
            .unwrap();
        assert_ne!(amended_oid, initial_oid);
        let amended_log = super::git_log(project_id.into()).await.unwrap();
        assert_eq!(amended_log.len(), 1, "amend replaces the first commit");
        assert_eq!(amended_log[0].message, "Amended paper");
        assert_eq!(
            super::git_show(project_id.into(), "INDEX".into(), "main.tex".into())
                .await
                .unwrap(),
            amended_main
        );
        assert_eq!(
            super::git_show(project_id.into(), "HEAD".into(), "appendix.tex".into())
                .await
                .unwrap(),
            "appendix draft\n"
        );

        assert!(
            super::git_create_branch(project_id.into(), "bad..branch".into())
                .await
                .is_err()
        );
        assert_eq!(
            super::git_create_branch(project_id.into(), "review/figures".into())
                .await
                .unwrap(),
            "review/figures"
        );
        assert_eq!(
            super::git_current_branch(project_id.into()).await.unwrap(),
            branch
        );
        let branch_snapshot = super::git_workspace_snapshot(project_id.into())
            .await
            .unwrap();
        assert!(branch_snapshot.branches.contains(&branch));
        assert!(branch_snapshot.branches.contains(&"review/figures".into()));
        assert_eq!(branch_snapshot.commits[0].message, "Amended paper");
        let no_upstream = super::git_ahead_behind(project_id.into()).await.unwrap();
        assert!(!no_upstream.has_upstream);
        assert_eq!((no_upstream.ahead, no_upstream.behind), (0, 0));
    }

    #[tokio::test(flavor = "current_thread")]
    #[allow(clippy::await_holding_lock)]
    async fn async_git_commands_cover_a_local_remote_and_worktree_operations() {
        use tauri::Manager as _;

        let _env_guard = crate::paths::data_dir_env_lock();
        let data = temp_dir("async-remote-boundary");
        let _data_dir = TestDataDirOverride::set(&data);
        let project_id = "async-remote-project";
        let project = data.join("projects").join(project_id);
        std::fs::create_dir_all(&project).unwrap();
        let amended_main = "remote base\n";
        write(&project, "main.tex", amended_main);
        crate::project::write_meta(
            project_id,
            &crate::project::ProjectMeta {
                name: "Async remote project".into(),
                main_doc: "main.tex".into(),
                engine: "tectonic".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let branch = super::git_initialize(project_id.into()).await.unwrap();
        ok_or_err(run_git(&project, &["config", "core.autocrlf", "false"]).unwrap()).unwrap();
        ok_or_err(
            run_git(
                &project,
                &["config", "user.email", "remote-boundary@example.test"],
            )
            .unwrap(),
        )
        .unwrap();
        ok_or_err(run_git(&project, &["config", "user.name", "Remote Boundary"]).unwrap()).unwrap();
        super::git_stage_all(project_id.into()).await.unwrap();
        assert!(super::git_commit(project_id.into(), "Remote base".into())
            .await
            .unwrap());

        assert!(super::git_fetch(project_id.into())
            .await
            .unwrap_err()
            .contains("No remote"));
        assert!(
            super::git_set_remote(project_id.into(), "file:///tmp/not-allowed".into(), None)
                .await
                .is_err()
        );
        let first_remote = "https://github.com/Oleafly/command-one.git";
        let second_remote = "https://github.com/Oleafly/command-two.git";
        super::git_set_remote(project_id.into(), first_remote.into(), None)
            .await
            .unwrap();
        assert_eq!(
            super::git_get_remote(project_id.into())
                .await
                .unwrap()
                .as_deref(),
            Some(first_remote)
        );
        let refused = super::git_set_remote(project_id.into(), second_remote.into(), None)
            .await
            .unwrap_err();
        assert!(refused.contains("git.remote_exists"), "{refused}");
        assert_eq!(
            super::git_get_remote(project_id.into())
                .await
                .unwrap()
                .as_deref(),
            Some(first_remote)
        );
        super::git_set_remote(project_id.into(), second_remote.into(), Some(true))
            .await
            .unwrap();
        assert_eq!(
            super::git_get_remote(project_id.into())
                .await
                .unwrap()
                .as_deref(),
            Some(second_remote)
        );
        super::git_remove_remote(project_id.into()).await.unwrap();
        super::git_remove_remote(project_id.into()).await.unwrap();
        assert!(super::git_get_remote(project_id.into())
            .await
            .unwrap()
            .is_none());

        let remote = data.join("origin.git");
        std::fs::create_dir(&remote).unwrap();
        ok_or_err(run_git(&remote, &["init", "--bare", "--quiet"]).unwrap()).unwrap();
        let remote_path = remote.to_string_lossy().into_owned();
        ok_or_err(run_git(&project, &["remote", "add", "origin", &remote_path]).unwrap()).unwrap();
        ok_or_err(run_git(&project, &["push", "--quiet", "-u", "origin", &branch]).unwrap())
            .unwrap();
        let remote_head = format!("refs/heads/{branch}");
        ok_or_err(run_git(&remote, &["symbolic-ref", "HEAD", &remote_head]).unwrap()).unwrap();
        let synchronized = super::git_ahead_behind(project_id.into()).await.unwrap();
        assert!(synchronized.has_upstream);
        assert_eq!((synchronized.ahead, synchronized.behind), (0, 0));

        let publisher = data.join("publisher");
        let publisher_path = publisher.to_string_lossy().into_owned();
        ok_or_err(
            run_git(
                &data,
                &[
                    "-c",
                    "core.autocrlf=false",
                    "clone",
                    "--quiet",
                    &remote_path,
                    &publisher_path,
                ],
            )
            .unwrap(),
        )
        .unwrap();
        ok_or_err(run_git(&publisher, &["config", "core.autocrlf", "false"]).unwrap()).unwrap();
        ok_or_err(
            run_git(
                &publisher,
                &["config", "user.email", "publisher@example.test"],
            )
            .unwrap(),
        )
        .unwrap();
        ok_or_err(run_git(&publisher, &["config", "user.name", "Remote Publisher"]).unwrap())
            .unwrap();
        write(&publisher, "remote-note.tex", "from remote\n");
        stage_all(&publisher).unwrap();
        assert!(commit_index(&publisher, "Remote note").unwrap());
        ok_or_err(run_git(&publisher, &["push", "--quiet", "origin", &branch]).unwrap()).unwrap();

        assert_eq!(
            super::git_fetch(project_id.into()).await.unwrap(),
            "Fetched origin"
        );
        let behind = super::git_ahead_behind(project_id.into()).await.unwrap();
        assert!(behind.has_upstream);
        assert_eq!((behind.ahead, behind.behind), (0, 1));

        let app = tauri::test::mock_builder()
            .manage(crate::state::AppState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let pulled = super::git_pull_with_runtime(
            app.handle().clone(),
            app.state::<crate::state::AppState>(),
            project_id.into(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(pulled.outcome, "pulled");
        assert_eq!(pulled.message, format!("Pulled origin/{branch}"));
        assert!(pulled.conflicts.is_empty());
        assert_eq!(pulled.state.reason, "git-pull");
        assert!(pulled.state.files_changed);
        assert_eq!(
            std::fs::read_to_string(project.join("remote-note.tex")).unwrap(),
            "from remote\n"
        );
        let after_pull = super::git_ahead_behind(project_id.into()).await.unwrap();
        assert_eq!((after_pull.ahead, after_pull.behind), (0, 0));

        write(&project, "local-note.tex", "from local\n");
        super::git_stage(project_id.into(), "local-note.tex".into())
            .await
            .unwrap();
        assert!(super::git_commit(project_id.into(), "Local note".into())
            .await
            .unwrap());
        let ahead = super::git_ahead_behind(project_id.into()).await.unwrap();
        assert!(ahead.has_upstream);
        assert_eq!((ahead.ahead, ahead.behind), (1, 0));
        let remote_snapshot = super::git_workspace_snapshot(project_id.into())
            .await
            .unwrap();
        assert_eq!(
            remote_snapshot.remote.as_deref(),
            Some(remote_path.as_str())
        );
        assert_eq!(remote_snapshot.ahead_behind.ahead, 1);
        assert_eq!(remote_snapshot.commits[0].message, "Local note");

        write(&project, "main.tex", "worktree draft\n");
        write(&project, "scratch.tex", "untracked scratch\n");
        let stashed = super::run_git_worktree_operation(
            app.handle().clone(),
            app.state::<crate::state::AppState>(),
            project_id.into(),
            None,
            "git-stash-push",
            super::stash_push_at,
        )
        .await
        .unwrap();
        assert_eq!(stashed.outcome, "stashed");
        assert_eq!(stashed.message, "Saved changes to the stash.");
        assert_eq!(stashed.project_state.reason, "git-stash-push");
        assert!(stashed.project_state.mutation_generation.is_some());
        assert_eq!(
            std::fs::read_to_string(project.join("main.tex")).unwrap(),
            amended_main
        );
        assert!(!project.join("scratch.tex").exists());
        assert!(super::git_status(project_id.into())
            .await
            .unwrap()
            .is_empty());
        let nothing_to_stash = super::run_git_worktree_operation(
            app.handle().clone(),
            app.state::<crate::state::AppState>(),
            project_id.into(),
            None,
            "git-stash-push",
            super::stash_push_at,
        )
        .await
        .unwrap();
        assert_eq!(nothing_to_stash.outcome, "unchanged");
        assert_eq!(nothing_to_stash.message, "Nothing to stash.");

        let applied = super::run_git_worktree_operation(
            app.handle().clone(),
            app.state::<crate::state::AppState>(),
            project_id.into(),
            None,
            "git-stash-pop",
            super::stash_pop_at,
        )
        .await
        .unwrap();
        assert_eq!(applied.outcome, "applied");
        assert_eq!(applied.message, "Applied the latest stash.");
        assert_eq!(applied.project_state.reason, "git-stash-pop");
        assert_eq!(
            std::fs::read_to_string(project.join("main.tex")).unwrap(),
            "worktree draft\n"
        );
        assert_eq!(
            std::fs::read_to_string(project.join("scratch.tex")).unwrap(),
            "untracked scratch\n"
        );
        let restored_changes = super::git_status(project_id.into()).await.unwrap();
        assert!(restored_changes
            .iter()
            .any(|change| change.path == "main.tex" && !change.staged));
        assert!(restored_changes
            .iter()
            .any(|change| change.path == "scratch.tex" && !change.staged));

        let publish_id = "async-publish-project";
        let publish_project = data.join("projects").join(publish_id);
        std::fs::create_dir(&publish_project).unwrap();
        write(&publish_project, "main.tex", "publish me\n");
        assert!(
            super::git_prepare_publish(publish_id.into(), "Publish project".into(), None)
                .await
                .unwrap()
                .committed
        );
        assert!(super::git_is_initialized(publish_id.into()).await.unwrap());
        assert_eq!(super::git_log(publish_id.into()).await.unwrap().len(), 1);
        assert!(
            !super::git_prepare_publish(publish_id.into(), "No changes".into(), None)
                .await
                .unwrap()
                .committed
        );
    }

    #[test]
    fn background_status_does_not_refresh_the_git_index() {
        let root = temp_repo();
        write(&root, "main.tex", "unchanged\n");
        stage_all(&root).unwrap();
        assert!(commit_index(&root, "initial").unwrap());

        // Rewriting identical bytes changes filesystem metadata. A regular
        // `git status` may refresh that stat cache in the index; the background
        // runner must keep the repository byte-for-byte untouched.
        write(&root, "main.tex", "unchanged\n");
        let index = root.join(".git").join("index");
        let before = std::fs::read(&index).unwrap();

        let output = run_git_read_only(&root, &["status", "--porcelain"]).unwrap();
        assert!(output.status.success());

        assert_eq!(std::fs::read(index).unwrap(), before);
    }

    #[test]
    fn current_branch_reports_the_repository_branch_after_a_rename() {
        let root = temp_repo();
        run_git(&root, &["branch", "--move", "topic/reader-view"]).unwrap();

        assert_eq!(current_branch(&root).unwrap(), "topic/reader-view");
    }

    #[test]
    fn commit_ids_accept_hex_and_reject_revision_syntax() {
        assert!(validate_git_oid("a1b2").is_ok());
        assert!(validate_git_oid(&"f".repeat(64)).is_ok());
        for invalid in ["abc", "HEAD", "abcd^", "abcd:path", "../abcd"] {
            assert!(validate_git_oid(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn restore_replaces_tracked_content_without_interpreting_revision_syntax() {
        let root = temp_repo();
        write(&root, "main.tex", "first\n");
        stage_all(&root).unwrap();
        assert!(commit_index(&root, "first").unwrap());
        let first =
            String::from_utf8_lossy(&run_git(&root, &["rev-parse", "HEAD"]).unwrap().stdout)
                .trim()
                .to_string();
        write(&root, "main.tex", "second\n");
        restore_worktree(&root, &first).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("main.tex")).unwrap(),
            "first\n"
        );
    }

    #[test]
    fn restore_removes_files_added_after_the_checkpoint_and_brings_back_deleted_ones() {
        let root = temp_repo();
        write(&root, "keep.tex", "base\n");
        write(&root, "removed-later.tex", "here at checkpoint\n");
        stage_all(&root).unwrap();
        assert!(commit_index(&root, "checkpoint").unwrap());
        let checkpoint =
            String::from_utf8_lossy(&run_git(&root, &["rev-parse", "HEAD"]).unwrap().stdout)
                .trim()
                .to_string();

        // A later explicit commit adds a file, deletes one, and modifies one.
        write(&root, "added-later.tex", "created by the response\n");
        std::fs::remove_file(root.join("removed-later.tex")).unwrap();
        write(&root, "keep.tex", "changed by the response\n");
        stage_all(&root).unwrap();
        assert!(commit_index(&root, "response edits").unwrap());

        restore_worktree(&root, &checkpoint).unwrap();

        assert!(
            !root.join("added-later.tex").exists(),
            "a file created after the checkpoint must be removed on restore"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("keep.tex")).unwrap(),
            "base\n"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("removed-later.tex")).unwrap(),
            "here at checkpoint\n",
            "a file deleted after the checkpoint must be restored"
        );
    }

    #[test]
    fn imported_repository_history_keeps_the_remote_lineage_and_a_clean_worktree() {
        let remote = temp_repo();
        write(&remote, "main.tex", "remote content\n");
        stage_all(&remote).unwrap();
        assert!(commit_index(&remote, "Remote base").unwrap());

        let imported = temp_dir("history-import");
        write(&imported, "main.tex", "remote content\n");
        write(&imported, "project.json", "{}\n");
        let remote_url = remote.to_string_lossy().into_owned();
        attach_imported_repository_history_at(&imported, &remote_url, "main", |root, refspec| {
            ok_or_err(run_git(root, &["fetch", "--no-tags", "origin", refspec])?)
        })
        .unwrap();

        let messages = run_git(&imported, &["log", "--reverse", "--format=%s"]).unwrap();
        assert_eq!(
            String::from_utf8_lossy(&messages.stdout)
                .lines()
                .collect::<Vec<_>>(),
            ["Remote base", "Prepare project for Oleafly"]
        );
        let upstream = run_git(
            &imported,
            &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
        )
        .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&upstream.stdout).trim(),
            "origin/main"
        );
        assert!(status(&imported).is_empty());
        assert!(std::fs::read_to_string(imported.join(".git/info/exclude"))
            .unwrap()
            .lines()
            .any(|line| line == ".oleafly/"));
    }

    fn status(root: &PathBuf) -> Vec<super::GitFileChange> {
        let out = run_git(root, &["status", "--porcelain"]).unwrap();
        parse_status_porcelain(&String::from_utf8_lossy(&out.stdout))
    }

    #[test]
    fn staging_in_a_repository_the_user_made_adds_only_the_state_folder_exclude() {
        let root = temp_repo();
        let exclude = root.join(".git").join("info").join("exclude");
        std::fs::create_dir_all(exclude.parent().unwrap()).unwrap();
        std::fs::write(&exclude, "# mine\n*.bak\n").unwrap();
        std::fs::create_dir_all(root.join("results")).unwrap();
        write(&root.join("results"), "run.log", "log\n");
        write(&root, "slurm-42.out", "out\n");
        write(&root, "main.tex", "tex\n");

        stage_paths(&root, &["results/run.log".to_string()]).unwrap();
        stage(&root, "slurm-42.out").unwrap();
        write(&root, "later.idx", "idx\n");
        write(&root, "later.aux", "aux\n");
        stage_all(&root).unwrap();

        let mut staged: Vec<String> = git_text(&root, &["ls-files", "--cached"])
            .lines()
            .map(str::to_string)
            .collect();
        staged.sort();
        assert_eq!(
            staged,
            [
                "later.aux",
                "later.idx",
                "main.tex",
                "results/run.log",
                "slurm-42.out"
            ]
        );
        assert_eq!(
            std::fs::read_to_string(&exclude).unwrap(),
            "# mine\n*.bak\n.oleafly/\n"
        );
    }

    #[test]
    fn repositories_oleafly_creates_get_the_full_exclude_list() {
        let created = temp_dir("excludes-ensure");
        assert!(ensure_repository(&created).unwrap());
        let initialized = temp_dir("excludes-initialize");
        initialize_repo(&initialized, "main").unwrap();
        let remote = temp_repo();
        write(&remote, "main.tex", "remote\n");
        stage_all(&remote).unwrap();
        assert!(commit_index(&remote, "Remote base").unwrap());
        let imported = temp_dir("excludes-import");
        write(&imported, "main.tex", "remote\n");
        let remote_url = remote.to_string_lossy().into_owned();
        attach_imported_repository_history_at(&imported, &remote_url, "main", |root, refspec| {
            ok_or_err(run_git(root, &["fetch", "--no-tags", "origin", refspec])?)
        })
        .unwrap();

        for root in [&created, &initialized, &imported] {
            let text = std::fs::read_to_string(root.join(".git/info/exclude")).unwrap();
            for line in PRIVATE_EXCLUDES
                .iter()
                .chain(crate::build_hygiene::BUILD_ARTIFACT_PATTERNS)
            {
                assert!(
                    text.lines().any(|entry| entry.trim() == *line),
                    "{line} is missing from {}:\n{text}",
                    root.display()
                );
            }
        }
    }

    #[test]
    fn stage_and_unstage_roundtrip_for_untracked() {
        let r = temp_repo();
        write(&r, "a.txt", "hi\n");
        assert!(!status(&r)[0].staged);
        stage(&r, "a.txt").unwrap();
        let s = status(&r);
        assert!(s[0].staged);
        assert_eq!(s[0].status, "A");
        // No HEAD yet: unstage must fall back to `rm --cached`.
        unstage(&r, "a.txt").unwrap();
        let s = status(&r);
        assert!(!s[0].staged);
        assert_eq!(s[0].status, "?");
    }

    #[test]
    fn commit_index_commits_only_staged_files() {
        let r = temp_repo();
        write(&r, "a.txt", "one\n");
        write(&r, "b.txt", "two\n");
        stage(&r, "a.txt").unwrap(); // b.txt left unstaged
        assert!(commit_index(&r, "first").unwrap());
        let s = status(&r);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].path, "b.txt");
        // Nothing staged now -> commit is a no-op returning false.
        assert!(!commit_index(&r, "noop").unwrap());
    }

    #[test]
    fn show_reads_head_index_and_empty_for_missing() {
        let r = temp_repo();
        write(&r, "a.txt", "v1\n");
        stage(&r, "a.txt").unwrap();
        commit_index(&r, "c1").unwrap();
        write(&r, "a.txt", "v2\n");
        stage(&r, "a.txt").unwrap(); // index = v2
        write(&r, "a.txt", "v3\n"); // worktree = v3, index = v2, HEAD = v1
        assert_eq!(show(&r, "HEAD", "a.txt").unwrap(), "v1\n");
        assert_eq!(show(&r, "INDEX", "a.txt").unwrap(), "v2\n");
        assert_eq!(show(&r, "HEAD", "missing.txt").unwrap(), "");
    }

    #[test]
    fn stage_all_and_unstage_all_toggle_every_file() {
        let r = temp_repo();
        write(&r, "a.txt", "a\n");
        write(&r, "b.txt", "b\n");
        stage_all(&r).unwrap();
        assert!(status(&r).iter().all(|c| c.staged));
        unstage_all(&r).unwrap();
        assert!(status(&r).iter().all(|c| !c.staged));
    }

    #[test]
    fn staging_an_existing_repository_adds_the_private_local_exclude() {
        let r = temp_repo();
        std::fs::create_dir(r.join(".oleafly")).unwrap();
        write(&r, ".oleafly/state", "private\n");
        write(&r, "main.tex", "source\n");

        stage_all(&r).unwrap();

        let tracked = run_git(&r, &["ls-files", ".oleafly"]).unwrap();
        assert!(tracked.stdout.is_empty());
        assert!(std::fs::read_to_string(r.join(".git/info/exclude"))
            .unwrap()
            .lines()
            .any(|line| line.trim() == ".oleafly/"));
    }

    #[test]
    fn porcelain_classifies_staged_vs_unstaged() {
        let out = " M work.tex\nM  staged.tex\nMM both.tex\nA  added.tex\n?? new.tex";
        let c = parse_status_porcelain(out);
        assert_eq!(c.len(), 6);
        // " M" = modified in working tree only (unstaged)
        assert_eq!(c[0].path, "work.tex");
        assert_eq!(c[0].status, "M");
        assert!(!c[0].staged);
        // "M " = staged modification
        assert_eq!(c[1].status, "M");
        assert!(c[1].staged);
        // "MM" appears in both sections: staged first, then unstaged.
        assert!(c[2].staged);
        assert_eq!(c[3].path, "both.tex");
        assert!(!c[3].staged);
        // "A " = staged add
        assert_eq!(c[4].status, "A");
        assert!(c[4].staged);
        // "??" = untracked, never staged
        assert_eq!(c[5].path, "new.tex");
        assert_eq!(c[5].status, "?");
        assert!(!c[5].staged);
    }

    #[test]
    fn porcelain_uses_the_destination_of_a_rename() {
        let c = parse_status_porcelain("R  old/a.tex -> new/b.tex");
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].path, "new/b.tex");
        assert_eq!(c[0].status, "R");
        assert!(c[0].staged);
    }

    #[test]
    fn porcelain_z_emits_both_sides_and_explicit_conflicts() {
        let changes = parse_status_porcelain_bytes(b"MM both.tex\0UU conflicted.tex\0");
        assert_eq!(changes.len(), 3);
        assert_eq!(changes[0].path, "both.tex");
        assert!(changes[0].staged);
        assert!(!changes[0].conflict);
        assert_eq!(changes[1].path, "both.tex");
        assert!(!changes[1].staged);
        assert!(!changes[1].conflict);
        assert_eq!(changes[2].path, "conflicted.tex");
        assert_eq!(changes[2].status, "UU");
        assert!(changes[2].conflict);
    }

    #[test]
    fn porcelain_z_rename_keeps_the_destination_path() {
        let changes = parse_status_porcelain_bytes(b"R  new/b.tex\0old/a.tex\0");
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].path, "new/b.tex");
        assert_eq!(changes[0].status, "R");
    }

    #[test]
    fn graph_log_includes_two_commits_without_record_shifting() {
        let root = temp_repo();
        let commit_fixture = |message: &str| {
            let out = run_configured_git(
                &root,
                &["commit", "--quiet", "-m", message],
                true,
                |command| {
                    // Git exports the outer commit identity to hooks. Clear it so
                    // this fixture uses the repository-local identity from
                    // `temp_repo`, even when the test runs in a pre-commit hook.
                    for variable in [
                        "GIT_AUTHOR_NAME",
                        "GIT_AUTHOR_EMAIL",
                        "GIT_AUTHOR_DATE",
                        "GIT_COMMITTER_NAME",
                        "GIT_COMMITTER_EMAIL",
                        "GIT_COMMITTER_DATE",
                    ] {
                        command.env_remove(variable);
                    }
                },
            )
            .unwrap();
            ok_or_err(out).unwrap();
        };
        write(&root, "paper.tex", "first\n");
        stage(&root, "paper.tex").unwrap();
        commit_fixture("first commit");
        write(&root, "paper.tex", "second\n");
        stage(&root, "paper.tex").unwrap();
        commit_fixture("second commit");

        let commits = git_log_at(&root).unwrap();
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].message, "second commit");
        assert_eq!(commits[1].message, "first commit");
        assert_ne!(commits[0].oid, commits[1].oid);
        assert_eq!(commits[0].author, "t");
    }

    #[test]
    fn exact_path_operations_leave_other_files_untouched() {
        let root = temp_repo();
        write(&root, "a.tex", "a\n");
        write(&root, "b.tex", "b\n");
        let only_a = vec!["a.tex".to_string()];
        stage_paths(&root, &only_a).unwrap();
        let changes = super::status_at(&root).unwrap();
        assert!(changes
            .iter()
            .any(|change| change.path == "a.tex" && change.staged));
        assert!(changes
            .iter()
            .any(|change| change.path == "b.tex" && !change.staged));
        unstage_paths(&root, &only_a).unwrap();
        assert!(super::status_at(&root)
            .unwrap()
            .iter()
            .all(|change| !change.staged));
    }

    #[test]
    fn discard_untracked_paths_only_removes_the_requested_file() {
        let root = temp_repo();
        write(&root, "remove-me.tex", "draft\n");
        write(&root, "keep-me.tex", "draft\n");
        discard_paths_at(&root, &["remove-me.tex".to_string()]).unwrap();
        assert!(!root.join("remove-me.tex").exists());
        assert!(root.join("keep-me.tex").exists());
        assert!(discard_paths_at(&root, &[".oleafly/state".to_string()]).is_err());
        assert!(validate_repo_relative_path("sections/.git/config").is_err());
        assert!(validate_repo_relative_path("../outside.tex").is_err());
    }

    #[test]
    fn discard_preflights_every_path_before_changing_the_worktree() {
        let root = temp_repo();
        write(&root, "tracked.tex", "committed\n");
        stage(&root, "tracked.tex").unwrap();
        commit_index(&root, "initial").unwrap();
        write(&root, "tracked.tex", "working copy\n");
        write(&root, "untracked.tex", "draft\n");

        let result = discard_paths_at(
            &root,
            &[
                "tracked.tex".to_string(),
                "untracked.tex".to_string(),
                "missing.tex".to_string(),
            ],
        );

        assert!(result.is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("tracked.tex")).unwrap(),
            "working copy\n",
            "a later invalid path must not restore an earlier tracked file"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("untracked.tex")).unwrap(),
            "draft\n",
            "a later invalid path must not delete an earlier untracked file"
        );
    }

    #[test]
    fn discard_removes_a_path_alias_only_once() {
        let root = temp_repo();
        write(&root, "draft.tex", "draft\n");

        discard_paths_at(&root, &["draft.tex".to_string(), "./draft.tex".to_string()]).unwrap();

        assert!(!root.join("draft.tex").exists());
    }

    #[test]
    fn repository_internal_paths_are_rejected_case_insensitively() {
        assert!(validate_repo_relative_path(".GIT/config").is_err());
        assert!(validate_repo_relative_path("sections/.OLEAFLY/state").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn discard_rejects_an_untracked_path_through_a_symlinked_directory() {
        let root = temp_repo();
        let outside = temp_dir("discard-symlink-outside");
        write(&outside, "keep.tex", "outside\n");
        std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();

        let result = discard_paths_at(&root, &["escape/keep.tex".to_string()]);

        assert!(result.is_err());
        assert_eq!(
            std::fs::read_to_string(outside.join("keep.tex")).unwrap(),
            "outside\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn discard_rejects_a_path_through_an_internal_directory_alias() {
        let root = temp_repo();
        let config = root.join(".git/config");
        let before = std::fs::read(&config).unwrap();
        std::os::unix::fs::symlink(".git", root.join("git-alias")).unwrap();

        let result = discard_paths_at(&root, &["git-alias/config".to_string()]);

        assert!(result.is_err());
        assert_eq!(std::fs::read(config).unwrap(), before);
    }

    #[cfg(unix)]
    #[test]
    fn discard_unlinks_a_final_symlink_without_following_its_external_target() {
        let root = temp_repo();
        let outside = temp_dir("discard-final-symlink-target");
        write(&outside, "keep.tex", "outside\n");
        std::os::unix::fs::symlink(outside.join("keep.tex"), root.join("external-link.tex"))
            .unwrap();

        discard_paths_at(&root, &["external-link.tex".to_string()]).unwrap();

        assert!(!root.join("external-link.tex").exists());
        assert_eq!(
            std::fs::read_to_string(outside.join("keep.tex")).unwrap(),
            "outside\n"
        );
    }

    #[cfg(windows)]
    #[test]
    fn discard_removes_an_untracked_directory_link_without_touching_its_target() {
        let root = temp_repo();
        let outside = temp_dir("discard-windows-directory-link-target");
        write(&outside, "keep.tex", "outside\n");
        let link = root.join("directory-link");
        if let Err(error) = std::os::windows::fs::symlink_dir(&outside, &link) {
            eprintln!("skipping directory-link discard test: {error}");
            return;
        }

        discard_paths_at(&root, &["directory-link".to_string()]).unwrap();

        assert_eq!(
            std::fs::symlink_metadata(link).unwrap_err().kind(),
            std::io::ErrorKind::NotFound
        );
        assert_eq!(
            std::fs::read_to_string(outside.join("keep.tex")).unwrap(),
            "outside\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn discard_accepts_two_directory_aliases_for_the_same_entry() {
        let root = temp_repo();
        std::fs::create_dir(root.join("actual")).unwrap();
        write(&root, "actual/draft.tex", "draft\n");
        std::os::unix::fs::symlink("actual", root.join("alias")).unwrap();

        discard_paths_at(
            &root,
            &[
                "actual/draft.tex".to_string(),
                "alias/draft.tex".to_string(),
            ],
        )
        .unwrap();

        assert!(!root.join("actual/draft.tex").exists());
    }

    #[cfg(unix)]
    #[test]
    fn discard_restores_a_tracked_file_reached_through_a_directory_alias() {
        let root = temp_repo();
        std::fs::create_dir(root.join("actual")).unwrap();
        write(&root, "actual/tracked.tex", "committed\n");
        stage(&root, "actual/tracked.tex").unwrap();
        commit_index(&root, "initial").unwrap();
        write(&root, "actual/tracked.tex", "working copy\n");
        std::os::unix::fs::symlink("actual", root.join("alias")).unwrap();

        discard_paths_at(&root, &["alias/tracked.tex".to_string()]).unwrap();

        assert_eq!(
            std::fs::read_to_string(root.join("actual/tracked.tex")).unwrap(),
            "committed\n"
        );
        assert!(root.join("alias").is_symlink());
    }

    #[cfg(unix)]
    #[test]
    fn discard_classifies_mixed_paths_reached_through_a_directory_alias() {
        let root = temp_repo();
        std::fs::create_dir(root.join("actual")).unwrap();
        write(&root, "actual/tracked.tex", "committed\n");
        stage(&root, "actual/tracked.tex").unwrap();
        commit_index(&root, "initial").unwrap();
        write(&root, "actual/tracked.tex", "working copy\n");
        write(&root, "actual/draft.tex", "draft\n");
        std::os::unix::fs::symlink("actual", root.join("alias")).unwrap();

        discard_paths_at(
            &root,
            &[
                "actual/tracked.tex".to_string(),
                "alias/tracked.tex".to_string(),
                "alias/draft.tex".to_string(),
            ],
        )
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(root.join("actual/tracked.tex")).unwrap(),
            "committed\n"
        );
        assert!(!root.join("actual/draft.tex").exists());
    }

    #[test]
    fn discard_rejects_a_case_alias_for_a_tracked_file() {
        let root = temp_repo();
        write(&root, "README.md", "committed\n");
        stage(&root, "README.md").unwrap();
        commit_index(&root, "initial").unwrap();
        write(&root, "README.md", "working copy\n");

        let error = discard_paths_at(&root, &["readme.md".to_string()]).unwrap_err();

        assert!(error.contains("use the file's exact name"));
        assert_eq!(
            std::fs::read_to_string(root.join("README.md")).unwrap(),
            "working copy\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn discard_prefers_an_exact_name_when_case_variants_both_exist() {
        let root = temp_repo();
        write(&root, "README.md", "upper seed\n");
        write(&root, "readme.md", "lower seed\n");
        let variants: Vec<String> = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| name.eq_ignore_ascii_case("readme.md"))
            .collect();
        if variants.len() < 2 {
            // The host filesystem is case-insensitive, so it cannot represent
            // this otherwise valid Git worktree shape.
            return;
        }
        let other = &variants[0];
        let requested = &variants[1];
        write(&root, other, "other\n");
        write(&root, requested, "committed\n");
        stage(&root, requested).unwrap();
        commit_index(&root, "initial").unwrap();
        write(&root, requested, "working copy\n");

        discard_paths_at(&root, std::slice::from_ref(requested)).unwrap();

        assert_eq!(
            std::fs::read_to_string(root.join(requested)).unwrap(),
            "committed\n"
        );
        assert_eq!(
            std::fs::read_to_string(root.join(other)).unwrap(),
            "other\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn discard_restores_a_deleted_tracked_case_variant_without_removing_its_sibling() {
        let root = temp_repo();
        write(&root, "README.md", "committed\n");
        write(&root, "readme.md", "untracked sibling\n");
        let variant_count = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| name.eq_ignore_ascii_case("readme.md"))
            .count();
        if variant_count < 2 {
            // The host filesystem is case-insensitive, so it cannot represent
            // this otherwise valid Git worktree shape.
            return;
        }
        stage(&root, "README.md").unwrap();
        commit_index(&root, "initial").unwrap();
        std::fs::remove_file(root.join("README.md")).unwrap();

        discard_paths_at(&root, &["README.md".to_string()]).unwrap();

        assert_eq!(
            std::fs::read_to_string(root.join("README.md")).unwrap(),
            "committed\n"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("readme.md")).unwrap(),
            "untracked sibling\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn discard_rejects_a_case_alias_for_a_tracked_final_symlink() {
        let root = temp_repo();
        std::os::unix::fs::symlink("first.tex", root.join("Paper.tex")).unwrap();
        stage(&root, "Paper.tex").unwrap();
        commit_index(&root, "initial").unwrap();
        std::fs::remove_file(root.join("Paper.tex")).unwrap();
        std::os::unix::fs::symlink("second.tex", root.join("Paper.tex")).unwrap();

        let error = discard_paths_at(&root, &["paper.tex".to_string()]).unwrap_err();

        assert!(error.contains("use the file's exact name"));
        assert_eq!(
            std::fs::read_link(root.join("Paper.tex")).unwrap(),
            PathBuf::from("second.tex")
        );
    }

    #[cfg(unix)]
    #[test]
    fn discard_keeps_distinct_symlink_entries_distinct() {
        let root = temp_repo();
        write(&root, "target.tex", "keep\n");
        std::os::unix::fs::symlink("target.tex", root.join("first-link.tex")).unwrap();
        std::os::unix::fs::symlink("target.tex", root.join("second-link.tex")).unwrap();

        discard_paths_at(
            &root,
            &["first-link.tex".to_string(), "second-link.tex".to_string()],
        )
        .unwrap();

        assert!(!root.join("first-link.tex").exists());
        assert!(!root.join("second-link.tex").exists());
        assert_eq!(
            std::fs::read_to_string(root.join("target.tex")).unwrap(),
            "keep\n"
        );
    }

    #[test]
    fn branches_are_checked_by_git_before_creation() {
        let root = temp_repo();
        write(&root, "paper.tex", "base\n");
        stage(&root, "paper.tex").unwrap();
        commit_index(&root, "base").unwrap();
        validate_branch_name(&root, "experiment/tables").unwrap();
        assert!(validate_branch_name(&root, "bad..branch").is_err());
        assert!(validate_branch_name(&root, "-option").is_err());
        ok_or_err(run_git(&root, &["branch", "--", "experiment/tables"]).unwrap()).unwrap();
        assert!(String::from_utf8_lossy(
            &run_git_read_only(&root, &["branch", "--list", "experiment/tables"])
                .unwrap()
                .stdout
        )
        .contains("experiment/tables"));
    }

    #[test]
    fn stash_push_and_pop_round_trip_untracked_changes() {
        let root = temp_repo();
        write(&root, "paper.tex", "base\n");
        stage(&root, "paper.tex").unwrap();
        commit_index(&root, "base").unwrap();
        write(&root, "notes.tex", "draft\n");
        stash_push_at(&root).unwrap();
        assert!(!root.join("notes.tex").exists());
        stash_pop_at(&root).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("notes.tex")).unwrap(),
            "draft\n"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    #[allow(clippy::await_holding_lock)]
    async fn partial_stash_failure_returns_changed_project_state() {
        use tauri::Manager as _;

        let _env_guard = crate::paths::data_dir_env_lock();
        let data = temp_dir("partial-stash");
        let _data_dir = TestDataDirOverride::set(&data);
        let project_id = "partial-stash-project";
        let project = data.join("projects").join(project_id);
        std::fs::create_dir_all(&project).unwrap();
        write(&project, "main.tex", "original manuscript\n");
        crate::project::write_meta(
            project_id,
            &crate::project::ProjectMeta {
                name: "Stash project".into(),
                main_doc: "main.tex".into(),
                engine: "tectonic".into(),
                ..Default::default()
            },
        )
        .unwrap();
        super::git_initialize(project_id.into()).await.unwrap();
        ok_or_err(run_git(&project, &["config", "core.autocrlf", "false"]).unwrap()).unwrap();
        stage(&project, "main.tex").unwrap();
        commit_index(&project, "Initial manuscript").unwrap();
        write(&project, "main.tex", "stashed manuscript\n");
        write(&project, "new.tex", "stashed untracked file\n");
        stash_push_at(&project).unwrap();
        write(&project, "new.tex", "new local file\n");

        let app = tauri::test::mock_builder()
            .manage(crate::state::AppState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let before = crate::project::project_mutation_generation(project_id.into()).unwrap();
        let result = super::run_git_worktree_operation(
            app.handle().clone(),
            app.state::<crate::state::AppState>(),
            project_id.into(),
            Some(before),
            "git-stash-pop",
            super::stash_pop_at,
        )
        .await
        .unwrap();
        assert_eq!(result.outcome, "failed");
        assert!(!result.message.is_empty());
        assert!(result.conflicts.is_empty());
        assert!(result.project_state.files_changed);
        assert!(result.project_state.mutation_generation.unwrap() > before);
        assert_eq!(
            std::fs::read_to_string(project.join("main.tex")).unwrap(),
            "stashed manuscript\n"
        );
        assert_eq!(
            std::fs::read_to_string(project.join("new.tex")).unwrap(),
            "new local file\n"
        );
        assert!(run_git(&project, &["rev-parse", "--verify", "refs/stash"])
            .unwrap()
            .status
            .success());
    }

    fn merge_conflict_repo() -> PathBuf {
        let root = temp_repo();
        write(&root, "paper.tex", "base\n");
        stage(&root, "paper.tex").unwrap();
        commit_index(&root, "base").unwrap();
        ok_or_err(run_git(&root, &["branch", "incoming"]).unwrap()).unwrap();
        write(&root, "paper.tex", "current\n");
        stage(&root, "paper.tex").unwrap();
        commit_index(&root, "current").unwrap();
        ok_or_err(run_git(&root, &["switch", "--quiet", "incoming"]).unwrap()).unwrap();
        write(&root, "paper.tex", "incoming\n");
        stage(&root, "paper.tex").unwrap();
        commit_index(&root, "incoming").unwrap();
        ok_or_err(run_git(&root, &["switch", "--quiet", "main"]).unwrap()).unwrap();
        assert!(!run_git(&root, &["merge", "incoming"])
            .unwrap()
            .status
            .success());
        root
    }

    fn delete_modify_conflict_repo() -> PathBuf {
        let root = temp_repo();
        write(&root, "paper.tex", "base\n");
        stage(&root, "paper.tex").unwrap();
        commit_index(&root, "base").unwrap();
        ok_or_err(run_git(&root, &["branch", "incoming"]).unwrap()).unwrap();

        ok_or_err(run_git(&root, &["rm", "--", "paper.tex"]).unwrap()).unwrap();
        commit_index(&root, "current deletes paper").unwrap();

        ok_or_err(run_git(&root, &["switch", "--quiet", "incoming"]).unwrap()).unwrap();
        write(&root, "paper.tex", "incoming\n");
        stage(&root, "paper.tex").unwrap();
        commit_index(&root, "incoming modifies paper").unwrap();

        ok_or_err(run_git(&root, &["switch", "--quiet", "main"]).unwrap()).unwrap();
        assert!(!run_git(&root, &["merge", "incoming"])
            .unwrap()
            .status
            .success());
        root
    }

    #[test]
    fn restore_refuses_to_overwrite_an_active_merge() {
        let root = merge_conflict_repo();
        let head = String::from_utf8_lossy(&run_git(&root, &["rev-parse", "HEAD"]).unwrap().stdout)
            .trim()
            .to_string();
        let conflicted = std::fs::read_to_string(root.join("paper.tex")).unwrap();

        let error = restore_worktree(&root, &head).unwrap_err();

        assert!(error.contains("Complete or abort the current merge"));
        assert!(merge_in_progress(&root).unwrap());
        assert!(!conflicts_at(&root).unwrap().is_empty());
        assert_eq!(
            std::fs::read_to_string(root.join("paper.tex")).unwrap(),
            conflicted
        );
    }

    #[test]
    fn conflict_resolution_uses_or_deletes_the_requested_index_side() {
        let deleted_current = delete_modify_conflict_repo();
        let stages = unmerged_index_stages(&deleted_current, "paper.tex").unwrap();
        assert!(!stages.current_exists);
        assert!(stages.incoming_exists);
        resolve_conflict_side(&deleted_current, "paper.tex", "current").unwrap();
        assert!(!deleted_current.join("paper.tex").exists());
        assert!(conflicts_at(&deleted_current).unwrap().is_empty());

        let incoming_file = delete_modify_conflict_repo();
        resolve_conflict_side(&incoming_file, "paper.tex", "incoming").unwrap();
        assert_eq!(
            std::fs::read_to_string(incoming_file.join("paper.tex")).unwrap(),
            "incoming\n"
        );
        assert!(conflicts_at(&incoming_file).unwrap().is_empty());
    }

    #[test]
    fn conflict_resolution_can_continue_or_abort_a_merge() {
        let root = merge_conflict_repo();
        assert!(merge_in_progress(&root).unwrap());
        assert_eq!(conflicts_at(&root).unwrap()[0].status, "UU");
        ok_or_err(
            run_git(
                &root,
                &[
                    "--literal-pathspecs",
                    "checkout",
                    "--ours",
                    "--",
                    "paper.tex",
                ],
            )
            .unwrap(),
        )
        .unwrap();
        stage(&root, "paper.tex").unwrap();
        ok_or_err(run_git(&root, &["-c", "core.editor=true", "merge", "--continue"]).unwrap())
            .unwrap();
        assert!(!merge_in_progress(&root).unwrap());
        assert_eq!(
            std::fs::read_to_string(root.join("paper.tex")).unwrap(),
            "current\n"
        );

        let aborted = merge_conflict_repo();
        ok_or_err(run_git(&aborted, &["merge", "--abort"]).unwrap()).unwrap();
        assert!(!merge_in_progress(&aborted).unwrap());
        assert_eq!(
            std::fs::read_to_string(aborted.join("paper.tex")).unwrap(),
            "current\n"
        );
    }

    #[test]
    fn porcelain_skips_blank_and_short_lines() {
        assert!(parse_status_porcelain("\n\nx").is_empty());
    }

    #[test]
    fn porcelain_never_reports_a_directory_as_a_change() {
        let c = parse_status_porcelain("?? sections/\n?? sections/intro.tex\n?? figures/a/b.png");
        let paths: Vec<&str> = c.iter().map(|change| change.path.as_str()).collect();
        assert_eq!(paths, vec!["sections/intro.tex", "figures/a/b.png"]);
        assert!(c
            .iter()
            .all(|change| change.status == "?" && !change.staged));
    }

    #[test]
    fn status_lists_every_file_inside_an_untracked_folder() {
        let root = temp_repo();
        std::fs::create_dir_all(root.join("sections/deep")).unwrap();
        std::fs::write(root.join("sections/intro.tex"), "a").unwrap();
        std::fs::write(root.join("sections/deep/notes.tex"), "b").unwrap();
        let out =
            run_git_read_only(&root, &["status", "--porcelain", "--untracked-files=all"]).unwrap();
        let c = parse_status_porcelain(&String::from_utf8_lossy(&out.stdout));
        let mut paths: Vec<String> = c.into_iter().map(|change| change.path).collect();
        paths.sort();
        std::fs::remove_dir_all(&root).ok();
        assert_eq!(paths, vec!["sections/deep/notes.tex", "sections/intro.tex"]);
    }

    #[test]
    fn blocks_transport_helpers_and_bad_schemes() {
        assert!(!is_allowed_remote_url("ext::sh -c 'touch /tmp/pwned'"));
        assert!(!is_allowed_remote_url("fd::17/foo"));
        assert!(!is_allowed_remote_url("file:///etc/passwd"));
        assert!(!is_allowed_remote_url(""));
        assert!(!is_allowed_remote_url("   "));
    }

    #[test]
    fn allows_normal_remotes() {
        assert!(is_allowed_remote_url("https://github.com/u/repo.git"));
        assert!(is_allowed_remote_url("http://example.com/u/repo.git"));
        assert!(is_allowed_remote_url("ssh://git@github.com/u/repo.git"));
        assert!(is_allowed_remote_url("git@github.com:u/repo.git"));
    }

    #[test]
    fn sanitize_strips_credentials() {
        assert_eq!(
            sanitize_url("https://x-access-token:ghp_secret@github.com/u/repo.git"),
            "https://github.com/u/repo.git"
        );
        assert_eq!(
            sanitize_url("https://github.com/u/repo.git"),
            "https://github.com/u/repo.git"
        );
        assert_eq!(
            sanitize_url("https://example.com/repos/user@domain/project.git?owner=a@b"),
            "https://example.com/repos/user@domain/project.git?owner=a@b"
        );
        assert_eq!(
            sanitize_url("ssh://git@github.com/u/repo.git"),
            "ssh://git@github.com/u/repo.git"
        );
    }

    #[test]
    fn legacy_remote_credentials_are_only_removed_by_the_explicit_repair() {
        let root = temp_repo();
        run_git(
            &root,
            &[
                "remote",
                "add",
                "origin",
                "https://x-access-token:legacy-secret@github.com/u/repo.git",
            ],
        )
        .unwrap();

        assert!(remote_credentials_need_cleanup(&root).unwrap());
        assert!(clean_remote_credentials(&root).unwrap());
        assert!(!remote_credentials_need_cleanup(&root).unwrap());
        let remote = run_git_read_only(&root, &["remote", "get-url", "origin"]).unwrap();
        assert_eq!(
            String::from_utf8_lossy(&remote.stdout).trim(),
            "https://github.com/u/repo.git"
        );
    }

    #[test]
    fn ssh_remote_usernames_are_not_treated_as_embedded_credentials() {
        let root = temp_repo();
        run_git(
            &root,
            &["remote", "add", "origin", "ssh://git@github.com/u/repo.git"],
        )
        .unwrap();

        assert!(!remote_credentials_need_cleanup(&root).unwrap());
        assert!(!clean_remote_credentials(&root).unwrap());
        let remote = run_git_read_only(&root, &["remote", "get-url", "origin"]).unwrap();
        assert_eq!(
            String::from_utf8_lossy(&remote.stdout).trim(),
            "ssh://git@github.com/u/repo.git"
        );
    }

    #[test]
    fn the_github_token_helper_is_configured_only_for_github_com() {
        let root = temp_repo();
        let helper_for = |url: &str| {
            let output = super::run_git_authed(
                &root,
                "gh-test-token",
                &["config", "--get-urlmatch", "credential.helper", url],
            )
            .unwrap();
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        };
        assert!(helper_for("https://github.com/owner/paper.git").contains("OLEAFLY_GH_TOKEN"));
        for url in [
            "https://gitlab.com/owner/paper.git",
            "https://github.com.example.org/owner/paper.git",
            "https://api.github.com/owner/paper.git",
        ] {
            assert!(
                !helper_for(url).contains("OLEAFLY_GH_TOKEN"),
                "{url} would receive the GitHub token"
            );
        }
    }

    #[test]
    fn github_com_gets_only_the_token_and_other_hosts_keep_their_own_helper() {
        use std::io::Write as _;
        let root = temp_repo();
        let home = temp_dir("credential-home");
        let global = home.join("gitconfig");
        let global_path = global.to_string_lossy().into_owned();
        ok_or_err(
            run_git(
                &root,
                &[
                    "config",
                    "--file",
                    &global_path,
                    "credential.helper",
                    "!f() { test \"$1\" = get && printf 'username=own-user\\npassword=own-secret\\n'; }; f",
                ],
            )
            .unwrap(),
        )
        .unwrap();
        let fill = |host: &str| -> String {
            let mut command = Command::new("git");
            super::clear_inherited_git_env(&mut command);
            let mut child = command
                .args(super::github_authed_args(&["credential", "fill"]))
                .current_dir(&root)
                .env("HOME", &home)
                .env("XDG_CONFIG_HOME", &home)
                .env("GIT_CONFIG_GLOBAL", &global)
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env("GIT_TERMINAL_PROMPT", "0")
                .env("OLEAFLY_GH_TOKEN", "gh-test-token")
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            child
                .stdin
                .take()
                .unwrap()
                .write_all(
                    format!("protocol=https\nhost={host}\npath=owner/paper.git\n\n").as_bytes(),
                )
                .unwrap();
            String::from_utf8_lossy(&child.wait_with_output().unwrap().stdout).into_owned()
        };
        let github = fill("github.com");
        assert!(github.contains("password=gh-test-token"), "{github}");
        assert!(!github.contains("own-secret"), "{github}");
        let gitlab = fill("gitlab.com");
        assert!(gitlab.contains("password=own-secret"), "{gitlab}");
        assert!(!gitlab.contains("gh-test-token"), "{gitlab}");
    }

    #[test]
    fn an_existing_origin_is_replaced_only_after_confirmation() {
        let root = temp_repo();
        ok_or_err(
            run_git(
                &root,
                &[
                    "remote",
                    "add",
                    "origin",
                    "https://lab-user:lab-secret@gitlab.com/lab/paper.git",
                ],
            )
            .unwrap(),
        )
        .unwrap();

        let refused =
            super::set_origin(&root, "https://github.com/owner/paper.git", false).unwrap_err();
        let envelope: serde_json::Value =
            serde_json::from_str(refused.strip_prefix(crate::app_error::PREFIX).unwrap()).unwrap();
        assert_eq!(envelope["code"], "git.remote_exists");
        assert_eq!(
            envelope["params"]["remote"],
            "https://gitlab.com/lab/paper.git"
        );
        assert!(!refused.contains("lab-secret"));
        assert_eq!(
            super::origin_url(&root).unwrap().as_deref(),
            Some("https://lab-user:lab-secret@gitlab.com/lab/paper.git")
        );

        super::set_origin(&root, "https://gitlab.com/lab/paper.git", false).unwrap();
        assert_eq!(
            super::origin_url(&root).unwrap().as_deref(),
            Some("https://gitlab.com/lab/paper.git")
        );

        super::set_origin(&root, "https://github.com/owner/paper.git", true).unwrap();
        assert_eq!(
            super::origin_url(&root).unwrap().as_deref(),
            Some("https://github.com/owner/paper.git")
        );
    }

    #[test]
    fn an_enclosing_repository_is_found_from_the_filesystem_alone() {
        let parent = temp_repo();
        let project = parent.join("papers").join("thesis");
        std::fs::create_dir_all(&project).unwrap();
        assert_eq!(
            super::enclosing_repository_below_home(&project, None),
            Some(parent.canonicalize().unwrap())
        );
        let linked = temp_dir("enclosing-gitfile");
        std::fs::write(linked.join(".git"), "gitdir: /elsewhere/.git/worktrees/w\n").unwrap();
        let chapter = linked.join("chapter");
        std::fs::create_dir_all(&chapter).unwrap();
        assert!(super::enclosing_repository_below_home(&chapter, None).is_some());
    }

    #[test]
    fn a_repository_at_home_or_above_home_does_not_enclose_a_project() {
        let home = temp_repo();
        let project = home.join(".oleafly").join("projects").join("p1");
        std::fs::create_dir_all(&project).unwrap();
        assert_eq!(
            super::enclosing_repository_below_home(&project, Some(&home)),
            None
        );
        let deeper_home = home.join("user");
        let shared = home.join("shared").join("paper");
        std::fs::create_dir_all(&deeper_home).unwrap();
        std::fs::create_dir_all(&shared).unwrap();
        assert_eq!(
            super::enclosing_repository_below_home(&shared, Some(&deeper_home)),
            None
        );
        let work = home.join("work");
        std::fs::create_dir_all(work.join("paper")).unwrap();
        ok_or_err(run_git(&work, &["init", "--quiet"]).unwrap()).unwrap();
        assert!(super::enclosing_repository_below_home(&work.join("paper"), Some(&home)).is_some());
    }

    #[tokio::test(flavor = "current_thread")]
    #[allow(clippy::await_holding_lock)]
    async fn explicit_initialization_refuses_to_nest_inside_another_repository() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = temp_repo();
        let _data_dir = TestDataDirOverride::set(&data);
        let project_id = "nested-command-project";
        let project = data.join("projects").join(project_id);
        std::fs::create_dir_all(&project).unwrap();
        write(&project, "main.tex", "nested\n");

        let initialized = super::git_initialize(project_id.into()).await.unwrap_err();
        let published =
            super::git_prepare_publish(project_id.into(), "Initial commit".into(), None)
                .await
                .unwrap_err();

        for error in [initialized, published] {
            let envelope: serde_json::Value =
                serde_json::from_str(error.strip_prefix(crate::app_error::PREFIX).unwrap())
                    .unwrap();
            assert_eq!(envelope["code"], "git.nested_repository");
        }
        assert!(!project.join(".git").exists());
    }

    #[tokio::test(flavor = "current_thread")]
    #[allow(clippy::await_holding_lock)]
    async fn the_publish_preflight_refuses_a_project_inside_another_repository() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = temp_repo();
        let _data_dir = TestDataDirOverride::set(&data);
        let project_id = "nested-preflight-project";
        let project = data.join("projects").join(project_id);
        std::fs::create_dir_all(&project).unwrap();
        write(&project, "main.tex", "nested\n");

        let refused = super::git_publish_preflight(project_id.into())
            .await
            .unwrap_err();
        let envelope: serde_json::Value =
            serde_json::from_str(refused.strip_prefix(crate::app_error::PREFIX).unwrap()).unwrap();
        assert_eq!(envelope["code"], "git.nested_repository");
        assert!(!project.join(".git").exists());

        ok_or_err(run_git(&project, &["init", "--quiet"]).unwrap()).unwrap();
        let preflight = super::git_publish_preflight(project_id.into())
            .await
            .unwrap();
        assert!(preflight.tracked_secret_files.is_empty());
    }

    #[tokio::test(flavor = "current_thread")]
    #[allow(clippy::await_holding_lock)]
    async fn the_publish_preflight_accepts_a_standalone_project_without_touching_it() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = temp_dir("publish-preflight");
        let _data_dir = TestDataDirOverride::set(&data);
        let project_id = "standalone-preflight-project";
        let project = data.join("projects").join(project_id);
        std::fs::create_dir_all(&project).unwrap();
        write(&project, "main.tex", "standalone\n");

        let preflight = super::git_publish_preflight(project_id.into())
            .await
            .unwrap();
        assert!(preflight.tracked_secret_files.is_empty());
        assert!(!project.join(".git").exists());
    }

    const PEM: &str = "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n";
    /// The start of a single-file Keynote document, which is a zip archive.
    const KEYNOTE: &[u8] = b"PK\x03\x04\x14\x00\x00\x00keynote";

    fn write_file(root: &Path, relative: &str, content: impl AsRef<[u8]>) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    /// The NUL-separated paths a Git listing prints, as text.
    fn listed(root: &Path, args: &[&str]) -> Vec<String> {
        super::git_listing(run_git(&root.to_path_buf(), args).unwrap())
            .unwrap()
            .iter()
            .map(|path| String::from_utf8_lossy(path).into_owned())
            .collect()
    }

    fn sorted_status(root: &Path) -> Vec<String> {
        let mut status = listed(
            root,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        );
        status.sort();
        status
    }

    fn commit_everything(root: &Path, message: &str) {
        let root = root.to_path_buf();
        ok_or_err(run_git(&root, &["add", "-A"]).unwrap()).unwrap();
        ok_or_err(run_git(&root, &["commit", "--quiet", "-m", message]).unwrap()).unwrap();
    }

    /// Whether the object store holds the current content of `relative`.
    fn is_stored(root: &Path, relative: &str) -> bool {
        let hash = git_text(root, &["hash-object", "--", relative]);
        run_git(&root.to_path_buf(), &["cat-file", "-e", &hash])
            .unwrap()
            .status
            .success()
    }

    /// The `files` parameter of a `git.tracked_secret_files` refusal.
    fn refused_files(error: &str) -> String {
        let envelope: serde_json::Value = serde_json::from_str(
            error
                .strip_prefix(crate::app_error::PREFIX)
                .unwrap_or_else(|| panic!("{error}")),
        )
        .unwrap();
        assert_eq!(envelope["code"], "git.tracked_secret_files", "{error}");
        envelope["params"]["files"].as_str().unwrap().to_string()
    }

    /// Run this thread's Git spawns without the machine's global and system
    /// Git configuration or its default excludes file. A test that publishes a
    /// folder with no `.git` yet uses this, because [`without_global_excludes`]
    /// needs a repository to configure.
    fn without_global_config() -> super::testing::InheritedEnvOverride {
        let empty = temp_dir("no-global-config");
        super::testing::inherit_git_env(vec![
            (
                "GIT_CONFIG_GLOBAL".into(),
                empty.join("missing-global-config").into_os_string(),
            ),
            ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
            ("XDG_CONFIG_HOME".into(), empty.into_os_string()),
        ])
    }

    #[test]
    fn publishing_leaves_secret_files_out_of_a_new_repository() {
        let _config = without_global_config();
        let root = temp_dir("publish-new-secrets");
        write_file(&root, "main.tex", "\\documentclass{article}\n");
        write_file(&root, ".env", "API_KEY=abc\n");
        write_file(&root, "analysis/.env.local", "TOKEN=abc\n");
        write_file(&root, "deploy/server.pem", PEM);
        write_file(&root, "id_ed25519", "-----BEGIN OPENSSH PRIVATE KEY-----\n");
        write_file(&root, "prod.env", "DB_PASSWORD=abc\n");
        write_file(&root, ".oleafly/state.json", "{}\n");

        let prepared = super::prepare_publish_at(&root, "Initial commit", &[]).unwrap();
        without_global_excludes(&root);

        assert!(prepared.committed);
        assert!(prepared.has_commit);
        assert_eq!(listed(&root, &["ls-files", "-z"]), ["main.tex"]);
        assert_eq!(
            prepared.left_out,
            [
                ".env",
                "analysis/.env.local",
                "deploy/server.pem",
                "id_ed25519",
                "prod.env"
            ]
        );
        assert_eq!(
            sorted_status(&root),
            [
                "?? .env",
                "?? analysis/.env.local",
                "?? deploy/server.pem",
                "?? id_ed25519",
                "?? prod.env"
            ],
            "the left-out files stay visible as untracked"
        );
        assert!(!root.join(".gitignore").exists());
        let exclude = std::fs::read_to_string(root.join(".git/info/exclude")).unwrap();
        let rules: Vec<&str> = exclude
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .collect();
        assert_eq!(rules, super::private_exclude_lines().collect::<Vec<_>>());
        assert!(!is_stored(&root, ".env"), "nothing secret was hashed");
    }

    #[test]
    fn publishing_keeps_templates_public_keys_and_keynote_files() {
        let root = temp_repo();
        without_global_excludes(&root);
        let files: [(&str, &[u8]); 18] = [
            (".env.example", b"API_KEY=\n"),
            (".env.sample", b"API_KEY=\n"),
            (".env.template", b"API_KEY=\n"),
            (".env.local.example", b"API_KEY=\n"),
            ("example.env", b"API_KEY=\n"),
            ("id_ed25519.pub", b"ssh-ed25519 AAAAC3Nz t@t\n"),
            (".latexmkrc", b"$pdf_mode = 1;\n"),
            ("latexmkrc", b"$pdf_mode = 1;\n"),
            (".gitignore", b"*.bak\n"),
            ("refs.bib", b"@article{key,}\n"),
            ("figures/plot.png", b"\x89PNG\r\n\x1a\n"),
            ("environment.yml", b"name: paper\n"),
            ("keys.tex", b"keys\n"),
            ("credentials.tex", b"credentials\n"),
            (".env/pyvenv.cfg", b"home = /usr/bin\n"),
            ("talk.key", KEYNOTE),
            ("old.key/Index.zip", KEYNOTE),
            ("data.json", br#"{"samples": [1, 2, 3]}"#),
        ];
        for (name, content) in files {
            write_file(&root, name, content);
        }

        let prepared = super::prepare_publish_at(&root, "Initial commit", &[]).unwrap();

        assert!(prepared.committed);
        assert!(prepared.left_out.is_empty(), "{:?}", prepared.left_out);
        let mut expected: Vec<&str> = files.iter().map(|(name, _)| *name).collect();
        expected.sort();
        let mut tracked = listed(&root, &["ls-files", "-z"]);
        tracked.sort();
        assert_eq!(tracked, expected);
    }

    #[test]
    fn every_secret_name_is_left_out_in_any_case_or_folder() {
        let root = temp_repo();
        without_global_excludes(&root);
        write_file(&root, "main.tex", "\\documentclass{article}\n");
        let mut secrets: Vec<(String, Vec<u8>)> = Vec::new();
        for name in [
            ".ENV",
            ".Env.Production",
            ".env-local",
            ".ENV_prod",
            "Server.PEM",
            "ID_RSA",
            "id_ed25519_sk",
            "Credentials.JSON",
            "kaggle.json",
            ".Renviron",
            "_netrc",
            ".pgpass",
            "PgPass.CONF",
            ".my.cnf",
            "secrets",
            "secrets.toml",
            "token.pickle",
            "client_secret_1.apps.googleusercontent.com.json",
            "cert.P12",
            "AuthKey_X.p8",
        ] {
            secrets.push((format!("nested/deeper/{name}"), b"secret\n".to_vec()));
        }
        secrets.push(("nested/deeper/server.key".into(), PEM.into()));
        secrets.push((".private/notes.md".into(), b"confidential\n".to_vec()));
        secrets.push(("secrets/token.txt".into(), b"token\n".to_vec()));
        secrets.push(("infra/.aws/config".into(), b"[default]\n".to_vec()));
        secrets.push(("infra/.kube/config".into(), b"users: []\n".to_vec()));
        for (path, content) in &secrets {
            write_file(&root, path, content);
        }
        let mut expected: Vec<String> = secrets.into_iter().map(|(path, _)| path).collect();
        expected.sort();

        let prepared = super::prepare_publish_at(&root, "Initial commit", &[]).unwrap();

        assert_eq!(prepared.left_out, expected);
        assert_eq!(listed(&root, &["ls-files", "-z"]), ["main.tex"]);
    }

    #[test]
    fn publishing_an_existing_repository_leaves_new_secrets_out() {
        let root = temp_repo();
        without_global_excludes(&root);
        write_file(&root, "main.tex", "first\n");
        commit_everything(&root, "first");
        let exclude = root.join(".git").join("info").join("exclude");
        let before = std::fs::read_to_string(&exclude).unwrap_or_default();
        write_file(&root, ".env", "API_KEY=abc\n");
        write_file(&root, "main.tex", "second\n");

        let prepared = super::prepare_publish_at(&root, "Publish", &[]).unwrap();

        assert!(prepared.committed);
        assert!(prepared.has_commit);
        assert_eq!(prepared.left_out, [".env"]);
        assert_eq!(git_text(&root, &["show", "HEAD:main.tex"]), "second");
        assert_eq!(
            listed(&root, &["ls-tree", "-r", "-z", "--name-only", "HEAD"]),
            ["main.tex"]
        );
        let after = std::fs::read_to_string(&exclude).unwrap();
        let added = after
            .strip_prefix(before.as_str())
            .unwrap_or_else(|| panic!("the exclude file was rewritten:\n{before}\n---\n{after}"));
        assert_eq!(added.trim(), ".oleafly/");
    }

    #[test]
    fn publishing_unstages_secrets_the_user_staged_or_marked() {
        for with_head in [false, true] {
            let root = temp_repo();
            without_global_excludes(&root);
            write_file(&root, "main.tex", "first\n");
            if with_head {
                commit_everything(&root, "first");
                write_file(&root, "main.tex", "second\n");
            }
            write_file(&root, ".env", "API_KEY=abc\n");
            write_file(&root, ".env.local", "TOKEN=never-hashed\n");
            stage_paths(&root, &[".env".into()]).unwrap();
            ok_or_err(run_git(&root, &["add", "-N", "--", ".env.local"]).unwrap()).unwrap();

            let prepared = super::prepare_publish_at(&root, "Publish", &[]).unwrap();

            assert!(prepared.committed, "with a HEAD: {with_head}");
            assert_eq!(
                prepared.left_out,
                [".env", ".env.local"],
                "with a HEAD: {with_head}"
            );
            assert_eq!(
                sorted_status(&root),
                ["?? .env", "?? .env.local"],
                "with a HEAD: {with_head}"
            );
            assert_eq!(
                listed(&root, &["ls-tree", "-r", "-z", "--name-only", "HEAD"]),
                ["main.tex"]
            );
            assert!(
                !is_stored(&root, ".env.local"),
                "the marked file's content was never hashed (with a HEAD: {with_head})"
            );
        }
    }

    #[test]
    fn publishing_refuses_secret_files_already_in_history() {
        let root = temp_repo();
        without_global_excludes(&root);
        write_file(&root, "main.tex", "first\n");
        write_file(&root, ".env", "API_KEY=abc\n");
        write_file(&root, "deploy/server.key", PEM);
        write_file(&root, "notes.txt", "notes\n");
        commit_everything(&root, "first");
        // A secret name that arrives by rename is added too.
        ok_or_err(run_git(&root, &["mv", "notes.txt", "deploy/.env"]).unwrap()).unwrap();
        ok_or_err(run_git(&root, &["rm", "--cached", "-q", "--", ".env"]).unwrap()).unwrap();
        ok_or_err(run_git(&root, &["commit", "--quiet", "-m", "forget"]).unwrap()).unwrap();
        let history = [".env", "deploy/.env", "deploy/server.key"].map(String::from);
        let head = git_text(&root, &["rev-parse", "HEAD"]);
        let index = std::fs::read(root.join(".git").join("index")).unwrap();

        let error = super::prepare_publish_at(&root, "Publish", &[]).unwrap_err();

        assert_eq!(refused_files(&error), history.join(", "));
        assert_eq!(git_text(&root, &["rev-parse", "HEAD"]), head);
        assert_eq!(
            std::fs::read(root.join(".git").join("index")).unwrap(),
            index
        );
        assert_eq!(
            super::publish_preflight_at(&root)
                .unwrap()
                .tracked_secret_files,
            history
        );
        let error = super::prepare_publish_at(&root, "Publish", &history[..2]).unwrap_err();
        assert_eq!(refused_files(&error), "deploy/server.key");

        let prepared = super::prepare_publish_at(&root, "Publish", &history).unwrap();

        assert!(!prepared.committed);
        assert!(prepared.has_commit);
        assert_eq!(prepared.left_out, [".env"]);
        assert_eq!(git_text(&root, &["rev-parse", "HEAD"]), head);
    }

    #[test]
    fn history_scan_sees_secrets_added_in_a_merge() {
        let root = temp_repo();
        without_global_excludes(&root);
        write_file(&root, "main.tex", "first\n");
        commit_everything(&root, "first");
        ok_or_err(run_git(&root, &["checkout", "-q", "-b", "side"]).unwrap()).unwrap();
        write_file(&root, "side.tex", "side\n");
        commit_everything(&root, "side");
        ok_or_err(run_git(&root, &["checkout", "-q", "main"]).unwrap()).unwrap();
        write_file(&root, "other.tex", "other\n");
        commit_everything(&root, "other");
        ok_or_err(run_git(&root, &["merge", "-q", "--no-commit", "--no-ff", "side"]).unwrap())
            .unwrap();
        write_file(&root, "evil.pem", PEM);
        commit_everything(&root, "merge");
        ok_or_err(run_git(&root, &["config", "log.diffMerges", "off"]).unwrap()).unwrap();

        assert_eq!(
            super::publish_preflight_at(&root)
                .unwrap()
                .tracked_secret_files,
            ["evil.pem"]
        );
    }

    #[test]
    fn allowing_tracked_secrets_still_does_not_stage_their_new_content() {
        let root = temp_repo();
        without_global_excludes(&root);
        write_file(&root, "main.tex", "first\n");
        write_file(&root, ".env", "API_KEY=old\n");
        commit_everything(&root, "first");
        write_file(&root, "main.tex", "second\n");
        write_file(&root, ".env", "API_KEY=new\n");

        let prepared = super::prepare_publish_at(&root, "Publish", &[".env".into()]).unwrap();

        assert!(prepared.committed);
        assert_eq!(git_text(&root, &["show", "HEAD:.env"]), "API_KEY=old");
        assert_eq!(git_text(&root, &["show", "HEAD:main.tex"]), "second");
        assert_eq!(prepared.left_out, [".env"]);
    }

    #[test]
    fn exclude_pathspecs_survive_odd_names() {
        let root = temp_repo();
        without_global_excludes(&root);
        write_file(&root, "we ird/[ab] {c}.key", PEM);
        write_file(&root, "we ird/[ab].tex", "odd\n");
        write_file(&root, "données/clé.pem", PEM);
        write_file(&root, "données/résumé.tex", "résumé\n");
        write_file(&root, "论文/.ENV", "API_KEY=abc\n");
        let mut expected = vec![
            "we ird/[ab] {c}.key".to_string(),
            "données/clé.pem".to_string(),
            "论文/.ENV".to_string(),
        ];
        #[cfg(unix)]
        {
            write_file(&root, "line\nbreak*?.pem", PEM);
            expected.push("line\nbreak*?.pem".into());
        }
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::ffi::OsStrExt;
            std::fs::write(root.join(std::ffi::OsStr::from_bytes(b"caf\xe9.pem")), PEM).unwrap();
            expected.push("caf\u{fffd}.pem".into());
        }
        expected.sort();

        let prepared = super::prepare_publish_at(&root, "Publish", &[]).unwrap();

        assert_eq!(prepared.left_out, expected);
        assert_eq!(
            listed(&root, &["ls-files", "-z"]),
            ["données/résumé.tex", "we ird/[ab].tex"]
        );
    }

    #[test]
    fn nothing_to_publish_when_every_file_is_a_secret() {
        let _config = without_global_config();
        let root = temp_dir("publish-only-secrets");
        write_file(&root, ".env", "API_KEY=abc\n");

        let prepared = super::prepare_publish_at(&root, "Initial commit", &[]).unwrap();

        assert!(!prepared.committed);
        assert!(!prepared.has_commit);
        assert_eq!(prepared.left_out, [".env"]);
    }

    #[test]
    fn a_listing_cut_at_the_output_limit_is_refused() {
        let mut cut = run_git(&temp_repo(), &["ls-files", "-z"]).unwrap();
        cut.stdout = b"main.tex\0.env\n... output truncated".to_vec();
        assert!(super::git_listing(cut).is_err());
    }

    #[test]
    fn pathspec_environment_is_cleared() {
        let variables = [
            "GIT_LITERAL_PATHSPECS",
            "GIT_GLOB_PATHSPECS",
            "GIT_NOGLOB_PATHSPECS",
            "GIT_ICASE_PATHSPECS",
        ];
        let mut command = Command::new("git");
        for variable in variables {
            command.env(variable, "1");
        }
        super::clear_inherited_git_env(&mut command);
        let envs: Vec<_> = command.get_envs().collect();
        for variable in variables {
            assert!(
                envs.contains(&(std::ffi::OsStr::new(variable), None)),
                "{variable} is removed: {envs:?}"
            );
        }

        let root = temp_repo();
        without_global_excludes(&root);
        write_file(&root, "main.tex", "first\n");
        write_file(&root, ".env", "API_KEY=abc\n");
        let _inherited =
            super::testing::inherit_git_env(vec![("GIT_LITERAL_PATHSPECS".into(), "1".into())]);

        assert_eq!(super::stage_all_except_secrets(&root).unwrap(), [".env"]);
        assert_eq!(listed(&root, &["ls-files", "-z"]), ["main.tex"]);
    }

    #[test]
    fn imported_history_is_not_attached_inside_another_repository() {
        let parent = temp_repo();
        let root = parent.join("projects").join("imported");
        std::fs::create_dir_all(&root).unwrap();
        write(&root, "main.tex", "imported\n");
        let mut fetched = false;
        let error = attach_imported_repository_history_at(
            &root,
            "https://github.com/owner/paper.git",
            "main",
            |_, _| {
                fetched = true;
                Ok(())
            },
        )
        .unwrap_err();
        assert!(error.contains("git.nested_repository"), "{error}");
        assert!(!fetched);
        assert!(!root.join(".git").exists());
    }

    #[cfg(unix)]
    fn sentinel_program(dir: &Path, name: &str, sentinel: &Path, tail: &str) -> String {
        use std::os::unix::fs::PermissionsExt;
        let program = dir.join(name);
        std::fs::write(
            &program,
            format!("#!/bin/sh\necho ran >> '{}'\n{tail}\n", sentinel.display()),
        )
        .unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        program.to_string_lossy().into_owned()
    }

    #[cfg(unix)]
    #[test]
    fn background_reads_never_run_the_repository_fsmonitor_hook() {
        let root = temp_repo();
        write(&root, "main.tex", "first\n");
        stage_all(&root).unwrap();
        assert!(commit_index(&root, "initial").unwrap());
        let tools = temp_dir("fsmonitor-hook");
        let sentinel = tools.join("fsmonitor-ran");
        let hook = sentinel_program(&tools, "fsmonitor.sh", &sentinel, "exit 1");
        ok_or_err(run_git(&root, &["config", "core.fsmonitor", &hook]).unwrap()).unwrap();
        write(&root, "main.tex", "second\n");

        ok_or_err(run_git(&root, &["status", "--porcelain"]).unwrap()).unwrap();
        assert!(
            sentinel.exists(),
            "the fixture hook must run for an explicit status"
        );
        std::fs::remove_file(&sentinel).unwrap();

        super::status_at(&root).unwrap();
        ok_or_err(
            run_git_read_only(
                &root,
                &[
                    "--literal-pathspecs",
                    "ls-files",
                    "--error-unmatch",
                    "--",
                    "main.tex",
                ],
            )
            .unwrap(),
        )
        .unwrap();
        super::diff_at(&root, None, true).unwrap();
        super::diff_at(&root, Some("main.tex"), false).unwrap();
        assert!(
            !sentinel.exists(),
            "a background read ran the repository's fsmonitor hook"
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_diff_viewer_never_runs_external_diff_or_textconv_programs() {
        let root = temp_repo();
        write(&root, ".gitattributes", "*.tex diff=sentinel\n");
        write(&root, "main.tex", "first\n");
        stage_all(&root).unwrap();
        assert!(commit_index(&root, "initial").unwrap());
        write(&root, "main.tex", "second\n");
        stage_paths(&root, &["main.tex".to_string()]).unwrap();
        write(&root, "main.tex", "third\n");
        write(&root, "appendix.tex", "appendix\n");
        let tools = temp_dir("diff-programs");
        let sentinel = tools.join("diff-program-ran");
        let textconv = sentinel_program(&tools, "textconv.sh", &sentinel, "cat \"$1\"");
        let driver = sentinel_program(&tools, "driver.sh", &sentinel, "exit 0");
        let external = sentinel_program(&tools, "external.sh", &sentinel, "exit 0");
        ok_or_err(run_git(&root, &["config", "diff.sentinel.textconv", &textconv]).unwrap())
            .unwrap();
        ok_or_err(run_git(&root, &["config", "diff.sentinel.command", &driver]).unwrap()).unwrap();
        ok_or_err(run_git(&root, &["config", "diff.external", &external]).unwrap()).unwrap();

        let staged_all = super::diff_at(&root, None, true).unwrap();
        let staged_file = super::diff_at(&root, Some("main.tex"), true).unwrap();
        let working_all = super::diff_at(&root, None, false).unwrap();
        let working_file = super::diff_at(&root, Some("main.tex"), false).unwrap();
        let untracked = super::diff_at(&root, Some("appendix.tex"), false).unwrap();

        assert!(
            !sentinel.exists(),
            "the diff viewer ran a repository diff program"
        );
        assert!(staged_all.contains("+second"));
        assert!(staged_file.contains("+second"));
        assert!(working_all.contains("+third"));
        assert!(working_file.contains("+third"));
        assert!(untracked.contains("+appendix"));

        ok_or_err(run_git(&root, &["diff"]).unwrap()).unwrap();
        assert!(
            sentinel.exists(),
            "the fixture diff programs must run for a plain diff"
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_commit_graph_never_runs_the_signature_program() {
        let root = temp_repo();
        write(&root, "main.tex", "first\n");
        stage_all(&root).unwrap();
        assert!(commit_index(&root, "initial").unwrap());
        let tools = temp_dir("signature-program");
        let sentinel = tools.join("gpg-ran");
        let gpg = sentinel_program(&tools, "gpg.sh", &sentinel, "exit 1");
        let rev = |spec: &str| {
            String::from_utf8_lossy(&run_git(&root, &["rev-parse", spec]).unwrap().stdout)
                .trim()
                .to_string()
        };
        let (tree, parent) = (rev("HEAD^{tree}"), rev("HEAD"));
        let object = tools.join("signed-commit");
        std::fs::write(
            &object,
            format!(
                "tree {tree}\nparent {parent}\nauthor t <t@t> 1700000000 +0000\ncommitter t <t@t> 1700000000 +0000\n\
                 gpgsig -----BEGIN PGP SIGNATURE-----\n \n iQEzBAABCAAdFiEE\n -----END PGP SIGNATURE-----\n\nSigned on GitHub\n"
            ),
        )
        .unwrap();
        let object_path = object.to_string_lossy().into_owned();
        let signed = run_git(&root, &["hash-object", "-t", "commit", "-w", &object_path]).unwrap();
        let signed = String::from_utf8_lossy(&signed.stdout).trim().to_string();
        ok_or_err(run_git(&root, &["update-ref", "HEAD", &signed]).unwrap()).unwrap();
        ok_or_err(run_git(&root, &["config", "log.showSignature", "true"]).unwrap()).unwrap();
        ok_or_err(run_git(&root, &["config", "gpg.program", &gpg]).unwrap()).unwrap();

        ok_or_err(run_git(&root, &["log", "-n", "1"]).unwrap()).unwrap();
        assert!(
            sentinel.exists(),
            "the fixture signature program must run for a plain log"
        );
        std::fs::remove_file(&sentinel).unwrap();

        assert_eq!(git_log_at(&root).unwrap()[0].message, "Signed on GitHub");
        assert!(
            !sentinel.exists(),
            "the background commit graph ran gpg.program"
        );
    }

    #[test]
    fn every_variable_git_treats_as_repository_local_is_cleared() {
        let listed = run_git(
            &temp_dir("local-env-vars"),
            &["rev-parse", "--local-env-vars"],
        )
        .unwrap();
        assert!(listed.status.success());
        for variable in String::from_utf8_lossy(&listed.stdout).lines() {
            assert!(
                super::GIT_REPOSITORY_ENV.contains(&variable),
                "{variable} is not cleared before Oleafly runs Git"
            );
        }
    }

    #[test]
    fn git_targets_the_project_even_from_inside_another_repositorys_hook() {
        let outer = temp_repo();
        let project = temp_repo();
        let outer_git = outer.join(".git");
        let mut command = Command::new("git");
        command
            .current_dir(&project)
            .args(["rev-parse", "--show-toplevel"])
            .env("GIT_DIR", &outer_git)
            .env("GIT_WORK_TREE", &outer)
            .env("GIT_INDEX_FILE", outer_git.join("index"))
            .env("GIT_COMMON_DIR", &outer_git)
            .env("GIT_OBJECT_DIRECTORY", outer_git.join("objects"));
        super::clear_inherited_git_env(&mut command);
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            PathBuf::from(String::from_utf8_lossy(&output.stdout).trim())
                .canonicalize()
                .unwrap(),
            project.canonicalize().unwrap()
        );

        let mut config = Command::new("git");
        config
            .current_dir(&project)
            .args(["config", "--get", "oleafly.marker"])
            .env("GIT_CONFIG_PARAMETERS", "'oleafly.marker'='outer'")
            .env("GIT_CONFIG_COUNT", "1")
            .env("GIT_CONFIG_KEY_0", "oleafly.marker")
            .env("GIT_CONFIG_VALUE_0", "outer");
        super::clear_inherited_git_env(&mut config);
        let output = config.output().unwrap();
        assert!(
            output.stdout.is_empty(),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
    }

    #[test]
    fn a_repository_without_origin_is_linked_without_confirmation() {
        let root = temp_repo();
        super::set_origin(&root, "https://github.com/owner/paper.git", false).unwrap();
        assert_eq!(
            super::origin_url(&root).unwrap().as_deref(),
            Some("https://github.com/owner/paper.git")
        );
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "current_thread")]
    #[allow(clippy::await_holding_lock)]
    async fn restricted_projects_never_spawn_git() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = temp_dir("restricted-git");
        let _data_dir = TestDataDirOverride::set(&data);
        let project_id = "restricted-git-project";
        let project = data.join("projects").join(project_id);
        std::fs::create_dir_all(&project).unwrap();
        write(&project, "main.tex", "base\n");
        ok_or_err(run_git(&project, &["init", "--quiet"]).unwrap()).unwrap();
        let sentinel = data.join("fsmonitor-ran");
        let hook = format!("touch '{}'; false", sentinel.display());
        ok_or_err(run_git(&project, &["config", "core.fsmonitor", &hook]).unwrap()).unwrap();
        let restricted = crate::trust::testing::restrict(project_id);
        for result in [
            super::git_workspace_snapshot(project_id.into())
                .await
                .map(|_| ()),
            super::git_status(project_id.into()).await.map(|_| ()),
            super::git_log(project_id.into()).await.map(|_| ()),
            super::git_is_initialized(project_id.into())
                .await
                .map(|_| ()),
            super::git_commit(project_id.into(), "x".into())
                .await
                .map(|_| ()),
        ] {
            let error = result.unwrap_err();
            assert!(error.contains("\"code\":\"trust.git\""), "{error}");
        }
        assert!(!sentinel.exists());
        drop(restricted);
        let _ = run_git(&project, &["status", "--porcelain"]);
        assert!(
            sentinel.exists(),
            "positive control: spawning git runs the hostile fsmonitor"
        );
        let _ = std::fs::remove_dir_all(&data);
    }
}
