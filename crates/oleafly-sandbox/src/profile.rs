use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::{SandboxError, SandboxSpec};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunProfile {
    #[default]
    Analysis,
    Training,
}

impl RunProfile {
    pub fn default_timeout(self) -> Duration {
        match self {
            Self::Analysis => Duration::from_secs(30 * 60),
            Self::Training => Duration::from_secs(4 * 3600),
        }
    }

    pub fn max_timeout(self) -> Duration {
        match self {
            Self::Analysis => Duration::from_secs(2 * 3600),
            Self::Training => Duration::from_secs(12 * 3600),
        }
    }

    pub fn clamp_timeout(self, requested: Option<Duration>) -> Duration {
        match requested {
            Some(requested) if !requested.is_zero() => requested.min(self.max_timeout()),
            _ => self.default_timeout(),
        }
    }

    pub fn gpu(self) -> bool {
        matches!(self, Self::Training)
    }
}

pub mod env;
pub mod runtimes;

pub use env::run_env;
pub use runtimes::{
    detect_runtimes, detect_runtimes_cached, DetectInputs, RuntimeInstall, RuntimeKind,
    RuntimeSource,
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedFolder {
    pub id: String,
    pub label: String,
    pub path: PathBuf,
}

pub struct RunInputs<'a> {
    pub profile: RunProfile,
    pub owner: &'a str,
    pub project: Option<&'a str>,
    pub workspace: &'a Path,
    pub writable: &'a [PathBuf],
    pub protected: &'a [PathBuf],
    pub home: &'a Path,
    pub network: bool,
    pub linked: &'a [LinkedFolder],
    pub extra_read: &'a [PathBuf],
    pub runtimes: &'a [RuntimeInstall],
    pub host_env: &'a dyn Fn(&str) -> Option<String>,
}

/// The sandbox of a run: runtimes and skill folders readable, linked data
/// read-only, writes exactly as given, caches in the task's home.
///
/// `child_processes` stays off, which is right for a short task command (no
/// descendant can leave its process group). On macOS that also makes
/// `posix_spawn` fail, so a long-running experiment run that starts `uv`,
/// `pixi` or `cargo` sets `spec.child_processes = true` on the result.
pub fn spec_for_run(inputs: &RunInputs<'_>) -> Result<SandboxSpec, SandboxError> {
    let (env, path_prepend) = run_env(
        inputs.profile,
        inputs.home,
        inputs.runtimes,
        inputs.linked,
        inputs.network,
        inputs.host_env,
    );
    let mut read_only: Vec<PathBuf> = inputs.extra_read.to_vec();
    for install in inputs.runtimes {
        read_only.extend(install.read_roots.iter().cloned());
    }
    if inputs.network {
        let system = crate::system_read_paths();
        for name in env::CA_VARS {
            if let Some(value) = (inputs.host_env)(name).filter(|value| !value.is_empty()) {
                let path = PathBuf::from(value);
                if path.exists() && !system.iter().any(|root| path.starts_with(root)) {
                    read_only.push(path);
                }
            }
        }
    }
    read_only.retain(|path| path.exists());
    read_only.sort();
    read_only.dedup();
    let mut spec = SandboxSpec::new(
        inputs.owner,
        inputs.workspace.to_path_buf(),
        inputs.home.to_path_buf(),
    );
    spec.project = inputs.project.map(str::to_owned);
    spec.read_only = read_only;
    spec.project_read_only = inputs
        .linked
        .iter()
        .map(|folder| folder.path.clone())
        .collect();
    spec.read_write = inputs.writable.to_vec();
    spec.protected = inputs.protected.to_vec();
    spec.network = inputs.network;
    spec.gpu = inputs.profile.gpu();
    spec.env = env;
    spec.path_prepend = path_prepend;
    Ok(spec)
}

pub fn task_home(tasks_root: &Path, task_id: &str) -> PathBuf {
    tasks_root.join("homes").join(task_id)
}

pub fn prepare_home(home: &Path) -> std::io::Result<()> {
    let mut folders = vec![
        "tmp",
        ".cache",
        ".config",
        ".local/share",
        ".local/state",
        "R/library",
        "python-user",
    ];
    if cfg!(windows) {
        folders.extend(["AppData/Roaming", "AppData/Local"]);
    }
    std::fs::create_dir_all(home)?;
    for folder in folders {
        match crate::safe_fs::create_folders_below(home, Path::new(folder)) {
            Ok(_) => {}
            Err(error) if crate::safe_fs::is_link_error(&error) => {}
            Err(error) => return Err(error),
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(home, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn spec_for_run_mounts_linked_folders_read_only_and_never_widens_writes() {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("ws");
        let home = root.path().join("home");
        let data = root.path().join("data");
        for folder in [&workspace, &home, &data] {
            std::fs::create_dir_all(folder).unwrap();
        }
        let writable = vec![workspace.join("analysis")];
        let linked = vec![LinkedFolder {
            id: "d1".into(),
            label: "Corpus".into(),
            path: data.clone(),
        }];
        let spec = spec_for_run(&RunInputs {
            profile: RunProfile::Training,
            owner: "task:t1",
            project: Some("p1"),
            workspace: &workspace,
            writable: &writable,
            protected: &[],
            home: &home,
            network: true,
            linked: &linked,
            extra_read: &[],
            runtimes: &[],
            host_env: &no_env,
        })
        .unwrap();
        assert_eq!(spec.project_read_only, vec![data]);
        assert_eq!(spec.read_write, writable);
        assert!(spec.gpu && spec.network);
        assert_eq!(spec.owner, "task:t1");
        assert_eq!(
            spec.env["OLEAFLY_DATA_CORPUS"],
            spec.project_read_only[0].to_string_lossy()
        );
    }

    #[test]
    fn profiles_add_the_cache_linked_roots_and_gpu_for_training() {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("ws");
        let home = root.path().join("home");
        let data = root.path().join("data");
        for folder in [&workspace, &home, &data] {
            std::fs::create_dir_all(folder).unwrap();
        }
        let writable = vec![workspace.join("analysis")];
        let linked = vec![LinkedFolder {
            id: "d1".into(),
            label: "Survey".into(),
            path: data.clone(),
        }];
        let spec = |profile| {
            spec_for_run(&RunInputs {
                profile,
                owner: "task:t1",
                project: Some("p1"),
                workspace: &workspace,
                writable: &writable,
                protected: &[],
                home: &home,
                network: false,
                linked: &linked,
                extra_read: &[],
                runtimes: &[],
                host_env: &no_env,
            })
            .unwrap()
        };

        let analysis = spec(RunProfile::Analysis);
        assert!(!analysis.gpu);
        assert!(!analysis.network);
        assert_eq!(analysis.home, home);
        assert_eq!(analysis.read_write, writable);
        let cache = home.join(".cache");
        for name in ["PIP_CACHE_DIR", "UV_CACHE_DIR", "HF_HOME"] {
            assert!(
                Path::new(&analysis.env[name]).starts_with(&cache),
                "{name} = {}",
                analysis.env[name]
            );
        }
        let base = crate::unix_environment(&analysis.home, &analysis.path_prepend);
        let xdg_cache = base
            .iter()
            .find(|(name, _)| name == "XDG_CACHE_HOME")
            .map(|(_, value)| PathBuf::from(value))
            .unwrap();
        assert_eq!(xdg_cache, cache);
        assert_eq!(analysis.project_read_only, vec![data.clone()]);
        assert_eq!(analysis.env["OLEAFLY_DATA_SURVEY"], data.to_string_lossy());

        let training = spec(RunProfile::Training);
        assert!(training.gpu);
        assert_eq!(training.read_write, writable);
        assert_eq!(training.project_read_only, vec![data]);
        assert_eq!(training.env["HF_HOME"], analysis.env["HF_HOME"]);
    }

    #[test]
    fn ca_bundle_outside_system_reads_becomes_readable() {
        let root = tempfile::tempdir().unwrap();
        let bundle = root.path().join("ca.pem");
        std::fs::write(&bundle, "cert").unwrap();
        let bundle_text = bundle.to_string_lossy().into_owned();
        let host = move |name: &str| (name == "SSL_CERT_FILE").then(|| bundle_text.clone());
        let spec = spec_for_run(&RunInputs {
            profile: RunProfile::Analysis,
            owner: "task:t1",
            project: None,
            workspace: root.path(),
            writable: &[],
            protected: &[],
            home: root.path(),
            network: true,
            linked: &[],
            extra_read: &[],
            runtimes: &[],
            host_env: &host,
        })
        .unwrap();
        assert!(spec.read_only.contains(&bundle));
    }

    #[test]
    fn profiles_have_pinned_timeouts() {
        assert_eq!(
            RunProfile::Analysis.default_timeout(),
            Duration::from_secs(30 * 60)
        );
        assert_eq!(
            RunProfile::Analysis.max_timeout(),
            Duration::from_secs(2 * 3600)
        );
        assert_eq!(
            RunProfile::Training.default_timeout(),
            Duration::from_secs(4 * 3600)
        );
        assert_eq!(
            RunProfile::Training.clamp_timeout(Some(Duration::from_secs(24 * 3600))),
            Duration::from_secs(12 * 3600)
        );
        assert_eq!(
            RunProfile::Analysis.clamp_timeout(Some(Duration::ZERO)),
            RunProfile::Analysis.default_timeout()
        );
        assert_eq!(
            RunProfile::Analysis.clamp_timeout(Some(Duration::from_secs(60))),
            Duration::from_secs(60)
        );
        assert!(RunProfile::Training.gpu() && !RunProfile::Analysis.gpu());
    }

    #[test]
    fn old_tasks_default_to_analysis() {
        assert_eq!(
            serde_json::from_str::<RunProfile>("\"analysis\"").unwrap(),
            RunProfile::Analysis
        );
        assert_eq!(
            serde_json::to_string(&RunProfile::Training).unwrap(),
            "\"training\""
        );
        assert_eq!(RunProfile::default(), RunProfile::Analysis);
    }
}
