//! Interpreters and environments a run may use: found on the search path,
//! in the project and in well-known folders. Detection only reads metadata
//! and small files; it never starts a program.
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

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

/// Read roots that are never allowed: the filesystem root and the home.
fn usable_root(path: &Path, home: Option<&Path>) -> bool {
    path.parent().is_some() && home.is_none_or(|home| path != home)
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
        if self.installs.len() >= MAX_INSTALLS
            || self
                .installs
                .iter()
                .any(|install| install.prefix == prefix && install.kind == kind)
        {
            return;
        }
        let mut read_roots: Vec<PathBuf> = std::iter::once(prefix.clone())
            .chain(extra_roots)
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

/// `home =` from a venv's `pyvenv.cfg`: the base interpreter's folder.
fn venv_base(prefix: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(prefix.join("pyvenv.cfg")).ok()?;
    text.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        (key.trim() == "home").then(|| prefix_of(&PathBuf::from(value.trim()).join("python")))
    })
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

fn detect_project(collector: &mut Collector<'_>, project: &Path) {
    for folder in [".venv", "venv"] {
        let prefix = project.join(folder);
        if let Some(python) = python_in(&prefix) {
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
    if let Some(python) = python_in(&pixi) {
        collector.push(
            RuntimeKind::Pixi,
            python,
            pixi,
            Vec::new(),
            RuntimeSource::Project,
        );
    }
    let renv = project.join("renv").join("library");
    if renv.is_dir() {
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
