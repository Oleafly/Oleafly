//! Interpreters and environments a run may use: found on the search path,
//! in the project and in well-known folders. Detection only reads metadata
//! and small files; it never starts a program. What a project says about its
//! own environment (`pyvenv.cfg`, an `renv/library` link) is untrusted: the
//! folders it names become read grants only when they stay inside the
//! project or look like an interpreter install.
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::roots::{broad_reason, is_shared_prefix, note_refused};

const MAX_INSTALLS: usize = 32;
const CACHE_FOR: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInstall {
    pub kind: RuntimeKind,
    pub executable: PathBuf,
    pub prefix: PathBuf,
    /// Folders to put on `PATH`, in order.
    pub bin_dirs: Vec<PathBuf>,
    /// Folders runs must be able to read.
    pub read_roots: Vec<PathBuf>,
    pub source: RuntimeSource,
    pub note: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeKind {
    Python,
    Conda,
    Venv,
    Uv,
    Pixi,
    R,
    Julia,
    Node,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeSource {
    Path,
    Project,
    KnownDir,
}

pub struct DetectInputs<'a> {
    pub search_dirs: &'a [PathBuf],
    pub project_root: Option<&'a Path>,
    pub home: Option<&'a Path>,
    pub env: &'a dyn Fn(&str) -> Option<OsString>,
}

const WINDOWS_STORE_ALIASES: &str = r"\Microsoft\WindowsApps\";
const NODE_NOTE: &str = "Node.js can hang in the Windows sandbox when it starts other programs.";

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn is_file(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
}

fn canonical(path: &Path) -> PathBuf {
    path.canonicalize()
        .map(|path| crate::plain_path(&path))
        .unwrap_or_else(|_| path.to_path_buf())
}

/// The folder an executable's install lives in: the parent of `bin`, or the
/// executable's own folder.
fn prefix_of(executable: &Path) -> PathBuf {
    let parent = executable.parent().unwrap_or(executable).to_path_buf();
    let name = parent
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase());
    match name.as_deref() {
        Some("bin") | Some("scripts") => parent.parent().map(Path::to_path_buf).unwrap_or(parent),
        Some("x64")
            if parent
                .parent()
                .and_then(Path::file_name)
                .is_some_and(|name| name == "bin") =>
        {
            parent
                .parent()
                .and_then(Path::parent)
                .map(Path::to_path_buf)
                .unwrap_or(parent)
        }
        _ => parent,
    }
}

/// The folders `conda activate` puts on `PATH` for a Windows prefix.
pub fn windows_conda_bin_dirs(prefix: &Path) -> Vec<PathBuf> {
    vec![
        prefix.to_path_buf(),
        prefix.join("Library").join("mingw-w64").join("bin"),
        prefix.join("Library").join("usr").join("bin"),
        prefix.join("Library").join("bin"),
        prefix.join("Scripts"),
        prefix.join("bin"),
    ]
}

fn bin_dirs(kind: RuntimeKind, prefix: &Path, executable: &Path) -> Vec<PathBuf> {
    if cfg!(windows)
        && matches!(
            kind,
            RuntimeKind::Conda | RuntimeKind::Python | RuntimeKind::Venv
        )
    {
        return windows_conda_bin_dirs(prefix)
            .into_iter()
            .filter(|folder| folder.is_dir())
            .collect();
    }
    let mut folders = vec![executable.parent().unwrap_or(prefix).to_path_buf()];
    let bin = prefix.join("bin");
    if bin.is_dir() && !folders.contains(&bin) {
        folders.push(bin);
    }
    folders
}

/// Read roots that are never allowed: the whole disk, a home folder or the
/// folder that holds one, a top-level system folder.
fn usable_root(path: &Path, home: Option<&Path>) -> bool {
    match broad_reason(path, home) {
        Some(reason) => {
            note_refused(path, reason);
            false
        }
        None => true,
    }
}

struct Collector<'a> {
    installs: Vec<RuntimeInstall>,
    home: Option<&'a Path>,
}

impl Collector<'_> {
    fn push(
        &mut self,
        kind: RuntimeKind,
        executable: PathBuf,
        prefix: PathBuf,
        extra_roots: Vec<PathBuf>,
        source: RuntimeSource,
    ) {
        let roots = std::iter::once(prefix.clone()).chain(extra_roots).collect();
        self.push_roots(kind, executable, prefix, roots, source);
    }

    /// Adds an install whose read grants are exactly `roots`.
    fn push_roots(
        &mut self,
        kind: RuntimeKind,
        executable: PathBuf,
        prefix: PathBuf,
        roots: Vec<PathBuf>,
        source: RuntimeSource,
    ) {
        if self.installs.len() >= MAX_INSTALLS
            || self
                .installs
                .iter()
                .any(|install| install.prefix == prefix && install.kind == kind)
        {
            return;
        }
        let mut read_roots: Vec<PathBuf> = roots
            .into_iter()
            .filter(|root| usable_root(root, self.home))
            .collect();
        read_roots.sort();
        read_roots.dedup();
        if read_roots.is_empty() {
            return;
        }
        let note = (cfg!(windows) && kind == RuntimeKind::Node).then(|| NODE_NOTE.to_string());
        let bin_dirs = bin_dirs(kind, &prefix, &executable);
        self.installs.push(RuntimeInstall {
            kind,
            executable,
            prefix,
            bin_dirs,
            read_roots,
            source,
            note,
        });
    }
}

fn kind_for(name: &str, prefix: &Path) -> RuntimeKind {
    match name {
        "conda" | "mamba" | "micromamba" => RuntimeKind::Conda,
        "uv" => RuntimeKind::Uv,
        "pixi" => RuntimeKind::Pixi,
        "R" | "Rscript" => RuntimeKind::R,
        "julia" => RuntimeKind::Julia,
        "node" => RuntimeKind::Node,
        _ if prefix.join("conda-meta").is_dir() => RuntimeKind::Conda,
        _ if prefix.join("pyvenv.cfg").is_file() => RuntimeKind::Venv,
        _ if prefix.to_string_lossy().contains("uv")
            && prefix.to_string_lossy().contains("python") =>
        {
            RuntimeKind::Uv
        }
        _ => RuntimeKind::Python,
    }
}

/// `home =` from a venv's `pyvenv.cfg`: the base interpreter's folder. The
/// file comes from the project, so the folder it names is only used when it
/// is an interpreter install (a `python` in its `bin`, or in its root on
/// Windows) and not a folder that holds more than that.
fn venv_base(prefix: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(prefix.join("pyvenv.cfg")).ok()?;
    let base = text.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        (key.trim() == "home").then(|| prefix_of(&PathBuf::from(value.trim()).join("python")))
    })?;
    if is_shared_prefix(&base) || python_in(&base).is_none() {
        note_refused(
            &base,
            "a virtual environment names it as its base interpreter, but it is not an interpreter install",
        );
        return None;
    }
    Some(base)
}

fn detect_on_path(collector: &mut Collector<'_>, search_dirs: &[PathBuf]) {
    const NAMES: [&str; 11] = [
        "python3",
        "python",
        "conda",
        "mamba",
        "micromamba",
        "uv",
        "pixi",
        "R",
        "Rscript",
        "julia",
        "node",
    ];
    for name in NAMES {
        let Some(found) = search_dirs
            .iter()
            .map(|folder| folder.join(exe(name)))
            .find(|path| is_file(path))
        else {
            continue;
        };
        if found.to_string_lossy().contains(WINDOWS_STORE_ALIASES) {
            continue;
        }
        // pyenv shims stand in for every installed Python.
        let shims = found
            .parent()
            .filter(|folder| folder.file_name().is_some_and(|name| name == "shims"));
        if let Some(root) = shims
            .and_then(Path::parent)
            .filter(|root| root.file_name().is_some_and(|name| name == ".pyenv"))
        {
            collector.push(
                RuntimeKind::Python,
                found.clone(),
                root.to_path_buf(),
                Vec::new(),
                RuntimeSource::Path,
            );
            continue;
        }
        let real = canonical(&found);
        let prefix = prefix_of(&real);
        // A program in `~/.local/bin` or `~/.cargo/bin` sits among other
        // tools' data and logins; it is granted alone.
        if is_shared_prefix(&prefix) {
            let folder = real.parent().unwrap_or(&real).to_path_buf();
            let kind = kind_for(name, &folder);
            collector.push_roots(kind, real.clone(), folder, vec![real], RuntimeSource::Path);
            continue;
        }
        let kind = kind_for(name, &prefix);
        let extra = if kind == RuntimeKind::Venv {
            venv_base(&prefix).into_iter().collect()
        } else {
            Vec::new()
        };
        collector.push(kind, real, prefix, extra, RuntimeSource::Path);
    }
}

fn python_in(prefix: &Path) -> Option<PathBuf> {
    let candidates = if cfg!(windows) {
        vec![
            prefix.join("python.exe"),
            prefix.join("Scripts").join("python.exe"),
        ]
    } else {
        vec![
            prefix.join("bin").join("python3"),
            prefix.join("bin").join("python"),
        ]
    };
    candidates.into_iter().find(|path| is_file(path))
}

/// Whether the environment folder `candidate` of a project may be used. A
/// link in a cloned repository can point anywhere (`renv/library` to a home
/// folder), and a read grant on its target would follow. So a folder that
/// resolves outside the project is used only when it is a Python environment
/// (it holds a `python`, checked by the caller) and not a shared folder such
/// as `~/.local`.
fn project_env_allowed(candidate: &Path, project: &Path, python_env: bool) -> bool {
    let (Ok(real), Ok(project)) = (candidate.canonicalize(), project.canonicalize()) else {
        return false;
    };
    if real.starts_with(&project) || (python_env && !is_shared_prefix(&real)) {
        return true;
    }
    note_refused(
        &real,
        "a link in the project points there, outside the project",
    );
    false
}

fn detect_project(collector: &mut Collector<'_>, project: &Path) {
    for folder in [".venv", "venv"] {
        let prefix = project.join(folder);
        if let Some(python) =
            python_in(&prefix).filter(|_| project_env_allowed(&prefix, project, true))
        {
            let extra: Vec<PathBuf> = venv_base(&prefix).into_iter().collect();
            collector.push(
                RuntimeKind::Venv,
                python,
                prefix,
                extra,
                RuntimeSource::Project,
            );
        }
    }
    let pixi = project.join(".pixi").join("envs").join("default");
    if let Some(python) = python_in(&pixi).filter(|_| project_env_allowed(&pixi, project, true)) {
        collector.push(
            RuntimeKind::Pixi,
            python,
            pixi,
            Vec::new(),
            RuntimeSource::Project,
        );
    }
    let renv = project.join("renv").join("library");
    if renv.is_dir() && project_env_allowed(&renv, project, false) {
        collector.push(
            RuntimeKind::R,
            renv.clone(),
            renv,
            Vec::new(),
            RuntimeSource::Project,
        );
    }
}

fn known_folders(
    home: Option<&Path>,
    env: &dyn Fn(&str) -> Option<OsString>,
) -> Vec<(RuntimeKind, PathBuf)> {
    let mut folders = Vec::new();
    let var = |name: &str| {
        env(name)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    };
    if let Some(home) = home {
        for name in [
            "miniconda3",
            "anaconda3",
            "miniforge3",
            "mambaforge",
            "micromamba",
        ] {
            folders.push((RuntimeKind::Conda, home.join(name)));
        }
        folders.push((RuntimeKind::Julia, home.join(".julia")));
        folders.push((RuntimeKind::Julia, home.join(".juliaup")));
        folders.push((RuntimeKind::Pixi, home.join(".pixi")));
        folders.push((RuntimeKind::R, home.join("Library").join("R")));
        if let Ok(entries) = std::fs::read_dir(home.join("R")) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().ends_with("-library") {
                    folders.push((RuntimeKind::R, entry.path()));
                }
            }
        }
    }
    if cfg!(windows) {
        if let Some(local) = var("LOCALAPPDATA") {
            folders.push((RuntimeKind::Conda, local.join("miniconda3")));
            folders.push((RuntimeKind::R, local.join("R").join("win-library")));
            if let Ok(entries) = std::fs::read_dir(local.join("Programs").join("Python")) {
                for entry in entries.flatten() {
                    if entry.file_name().to_string_lossy().starts_with("Python3") {
                        folders.push((RuntimeKind::Python, entry.path()));
                    }
                }
            }
        }
        if let Some(data) = var("ProgramData") {
            folders.push((RuntimeKind::Conda, data.join("miniconda3")));
            folders.push((RuntimeKind::Conda, data.join("anaconda3")));
        }
        if let Some(roaming) = var("APPDATA") {
            folders.push((RuntimeKind::Uv, roaming.join("uv").join("python")));
        }
    } else {
        for root in ["/opt/conda", "/opt/miniconda3"] {
            folders.push((RuntimeKind::Conda, PathBuf::from(root)));
        }
        let data =
            var("XDG_DATA_HOME").or_else(|| home.map(|home| home.join(".local").join("share")));
        if let Some(data) = data {
            folders.push((RuntimeKind::Uv, data.join("uv").join("python")));
        }
    }
    folders
}

fn detect_known(
    collector: &mut Collector<'_>,
    home: Option<&Path>,
    env: &dyn Fn(&str) -> Option<OsString>,
) {
    for (kind, folder) in known_folders(home, env) {
        if !folder.is_dir() {
            continue;
        }
        let folder = canonical(&folder);
        let executable = match kind {
            RuntimeKind::Conda | RuntimeKind::Python => {
                python_in(&folder).unwrap_or_else(|| folder.clone())
            }
            _ => folder.clone(),
        };
        collector.push(
            kind,
            executable,
            folder,
            Vec::new(),
            RuntimeSource::KnownDir,
        );
    }
}

/// Interpreters and environments a run may use, project ones first.
pub fn detect_runtimes(inputs: &DetectInputs<'_>) -> Vec<RuntimeInstall> {
    let mut collector = Collector {
        installs: Vec::new(),
        home: inputs.home,
    };
    if let Some(project) = inputs.project_root {
        detect_project(&mut collector, project);
    }
    detect_on_path(&mut collector, inputs.search_dirs);
    detect_known(&mut collector, inputs.home, inputs.env);
    collector.installs
}

type CacheKey = (Vec<PathBuf>, Option<PathBuf>);
type RuntimeCache = Mutex<BTreeMap<CacheKey, (Instant, Vec<RuntimeInstall>)>>;

fn cache() -> &'static RuntimeCache {
    static CACHE: std::sync::OnceLock<RuntimeCache> = std::sync::OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// [`detect_runtimes`], remembered for a minute per search path and project.
pub fn detect_runtimes_cached(inputs: &DetectInputs<'_>) -> Vec<RuntimeInstall> {
    let key = (
        inputs.search_dirs.to_vec(),
        inputs.project_root.map(Path::to_path_buf),
    );
    let mut cache = cache()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some((at, installs)) = cache.get(&key) {
        if at.elapsed() < CACHE_FOR {
            return installs.clone();
        }
    }
    let installs = detect_runtimes(inputs);
    cache.insert(key, (Instant::now(), installs.clone()));
    installs
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[cfg(unix)]
    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "").unwrap();
    }

    #[test]
    fn windows_conda_bin_dirs_follow_conda_activate() {
        let prefix = Path::new("/env");
        assert_eq!(
            windows_conda_bin_dirs(prefix),
            vec![
                PathBuf::from("/env"),
                PathBuf::from("/env/Library/mingw-w64/bin"),
                PathBuf::from("/env/Library/usr/bin"),
                PathBuf::from("/env/Library/bin"),
                PathBuf::from("/env/Scripts"),
                PathBuf::from("/env/bin"),
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn detects_conda_venv_pyenv_and_uv_prefixes() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        touch(&home.join("miniconda3/bin/python3"));
        std::fs::create_dir_all(home.join("miniconda3/conda-meta")).unwrap();
        touch(&home.join(".pyenv/shims/python"));
        touch(&home.join(".local/share/uv/python/cpython-3.12/bin/python3"));
        let base = root.path().join("base");
        touch(&base.join("bin/python3"));
        let project = root.path().join("project");
        touch(&project.join(".venv/bin/python3"));
        std::fs::write(
            project.join(".venv/pyvenv.cfg"),
            format!("home = {}\n", base.join("bin").display()),
        )
        .unwrap();
        let search = vec![home.join(".pyenv/shims"), home.join("miniconda3/bin")];
        let env = |name: &str| {
            (name == "XDG_DATA_HOME").then(|| home.join(".local/share").into_os_string())
        };
        let installs = detect_runtimes(&DetectInputs {
            search_dirs: &search,
            project_root: Some(&project),
            home: Some(&home),
            env: &env,
        });
        let kinds: Vec<RuntimeKind> = installs.iter().map(|install| install.kind).collect();
        assert!(kinds.contains(&RuntimeKind::Venv), "{kinds:?}");
        assert!(kinds.contains(&RuntimeKind::Conda), "{kinds:?}");
        assert!(kinds.contains(&RuntimeKind::Python), "{kinds:?}");
        assert!(kinds.contains(&RuntimeKind::Uv), "{kinds:?}");
        let venv = installs
            .iter()
            .find(|install| install.kind == RuntimeKind::Venv)
            .unwrap();
        assert!(
            venv.read_roots.iter().any(|root| root.ends_with("base")),
            "{:?}",
            venv.read_roots
        );
        let pyenv = installs
            .iter()
            .find(|install| install.kind == RuntimeKind::Python)
            .unwrap();
        assert!(pyenv.read_roots.iter().any(|root| root.ends_with(".pyenv")));
        for install in &installs {
            assert!(install
                .read_roots
                .iter()
                .all(|root| root != &home && root.parent().is_some()));
        }
    }

    /// The read roots inside `root` (the machine's own `/opt/conda` and the
    /// like are not the test's business).
    #[cfg(unix)]
    fn roots_of(installs: &[RuntimeInstall], root: &Path) -> Vec<PathBuf> {
        installs
            .iter()
            .flat_map(|install| install.read_roots.iter().cloned())
            .filter(|path| path.starts_with(root))
            .collect()
    }

    #[cfg(unix)]
    fn detect_in(root: &Path, project: &Path, search: &[PathBuf]) -> Vec<RuntimeInstall> {
        let home = root.join("home");
        let env = |_: &str| None;
        detect_runtimes(&DetectInputs {
            search_dirs: search,
            project_root: Some(project),
            home: Some(&home),
            env: &env,
        })
    }

    #[cfg(unix)]
    #[test]
    fn a_project_cannot_widen_the_read_roots_with_pyvenv_home() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path().canonicalize().unwrap();
        let project = root.join("project");
        // Something that holds the user's home, with a `python3` in its `bin`.
        touch(&root.join("bin/python3"));
        touch(&root.join("home/.local/bin/python3"));
        touch(&project.join(".venv/bin/python3"));
        for base in [
            root.join("bin"),
            root.join("home/.local/bin"),
            PathBuf::from("/"),
            root.join("home/data"),
        ] {
            std::fs::write(
                project.join(".venv/pyvenv.cfg"),
                format!("home = {}\n", base.display()),
            )
            .unwrap();
            let installs = detect_in(&root, &project, &[]);
            let roots = roots_of(&installs, &root);
            assert_eq!(
                roots,
                vec![project.join(".venv")],
                "base {}",
                base.display()
            );
        }
        // A real interpreter install elsewhere is still granted.
        touch(&root.join("python-install/bin/python3"));
        std::fs::write(
            project.join(".venv/pyvenv.cfg"),
            format!("home = {}\n", root.join("python-install/bin").display()),
        )
        .unwrap();
        let roots = roots_of(&detect_in(&root, &project, &[]), &root);
        assert!(roots.contains(&root.join("python-install")), "{roots:?}");
    }

    #[cfg(unix)]
    #[test]
    fn a_project_link_cannot_point_a_read_root_at_another_folder() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path().canonicalize().unwrap();
        let project = root.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let secrets = root.join("home/Library");
        std::fs::create_dir_all(&secrets).unwrap();
        std::fs::create_dir_all(project.join("renv")).unwrap();
        std::os::unix::fs::symlink(&secrets, project.join("renv/library")).unwrap();
        // A venv link to a shared folder is refused, one to a real Python
        // environment outside the project is not.
        touch(&root.join("home/.local/bin/python3"));
        std::os::unix::fs::symlink(root.join("home/.local"), project.join(".venv")).unwrap();
        touch(&root.join("envs/py/bin/python3"));
        std::os::unix::fs::symlink(root.join("envs/py"), project.join("venv")).unwrap();
        let installs = detect_in(&root, &project, &[]);
        let roots = roots_of(&installs, &root);
        assert!(
            !roots.iter().any(|path| path.ends_with("library")),
            "{roots:?}"
        );
        assert!(!roots.contains(&project.join(".venv")), "{roots:?}");
        assert!(roots.contains(&project.join("venv")), "{roots:?}");
    }

    #[cfg(unix)]
    #[test]
    fn a_tool_in_a_shared_user_folder_is_granted_alone() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path().canonicalize().unwrap();
        let home = root.join("home");
        touch(&home.join(".local/bin/uv"));
        touch(&home.join(".cargo/bin/pixi"));
        touch(&home.join(".cargo/credentials.toml"));
        touch(&home.join("tools/bin/micromamba"));
        touch(&home.join("tools/lib/keep"));
        let project = root.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let search = vec![
            home.join(".local/bin"),
            home.join(".cargo/bin"),
            home.join("tools/bin"),
        ];
        let roots = roots_of(&detect_in(&root, &project, &search), &root);
        assert!(roots.contains(&home.join(".local/bin/uv")), "{roots:?}");
        assert!(roots.contains(&home.join(".cargo/bin/pixi")), "{roots:?}");
        assert!(!roots.contains(&home.join(".local")), "{roots:?}");
        assert!(!roots.contains(&home.join(".cargo")), "{roots:?}");
        // A tool in its own install folder keeps the whole install.
        assert!(roots.contains(&home.join("tools")), "{roots:?}");
    }

    #[test]
    fn detection_is_cached_for_sixty_seconds() {
        let calls = Cell::new(0);
        let env = |_: &str| {
            calls.set(calls.get() + 1);
            None
        };
        let search = vec![PathBuf::from("/definitely/not/a/folder/for/oleafly")];
        let inputs = DetectInputs {
            search_dirs: &search,
            project_root: None,
            home: None,
            env: &env,
        };
        detect_runtimes_cached(&inputs);
        let first = calls.get();
        detect_runtimes_cached(&inputs);
        assert_eq!(calls.get(), first);
    }
}
