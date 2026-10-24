//! The base environment of a sandboxed Windows child. `CreateProcessW`
//! fails with error 203 inside an AppContainer unless `SystemRoot` and
//! `LOCALAPPDATA` are set; user folders point into the task's home.
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// Host variables every Windows program expects.
const SYSTEM_VARS: [&str; 9] = [
    "SystemRoot",
    "windir",
    "SystemDrive",
    "ComSpec",
    "PATHEXT",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER",
    "OS",
];

/// The folder of the Python temp-folder shim inside the home.
pub fn python_shim_dir(home: &Path) -> PathBuf {
    home.join("oleafly-python")
}

/// `PATH` without the task's own folders: the Windows system folders.
pub fn system_path(system_root: &str) -> Vec<PathBuf> {
    vec![
        PathBuf::from(format!(r"{system_root}\System32")),
        PathBuf::from(system_root),
        PathBuf::from(format!(r"{system_root}\System32\Wbem")),
        PathBuf::from(format!(r"{system_root}\System32\WindowsPowerShell\v1.0")),
    ]
}

/// The base environment: system variables from the host, user folders in
/// `home`, `PATH` = `path` then the system folders.
pub fn base_env(
    host: &dyn Fn(&str) -> Option<OsString>,
    home: &Path,
    path: &[PathBuf],
) -> BTreeMap<String, OsString> {
    let mut env = BTreeMap::new();
    for name in SYSTEM_VARS {
        if let Some(value) = host(name).filter(|value| !value.is_empty()) {
            env.insert(name.to_string(), value);
        }
    }
    let system_root = env
        .get("SystemRoot")
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| r"C:\Windows".to_string());
    env.insert("SystemRoot".into(), OsString::from(&system_root));
    let tmp = home.join("tmp");
    let folder = |path: PathBuf| path.into_os_string();
    env.insert("USERPROFILE".into(), folder(home.to_path_buf()));
    env.insert("HOME".into(), folder(home.to_path_buf()));
    env.insert(
        "APPDATA".into(),
        folder(home.join("AppData").join("Roaming")),
    );
    env.insert(
        "LOCALAPPDATA".into(),
        folder(home.join("AppData").join("Local")),
    );
    env.insert("TEMP".into(), folder(tmp.clone()));
    env.insert("TMP".into(), folder(tmp.clone()));
    // Python reads TMPDIR first; Windows rewrites TEMP and TMP.
    env.insert("TMPDIR".into(), folder(tmp));
    env.insert("LANG".into(), OsString::from("en_US.UTF-8"));
    env.insert(crate::SANDBOX_ENV.into(), OsString::from("appcontainer"));
    env.insert("PYTHONPATH".into(), folder(python_shim_dir(home)));
    let mut entries: Vec<PathBuf> = path.to_vec();
    entries.extend(system_path(&system_root));
    let joined = std::env::join_paths(entries.iter())
        .unwrap_or_else(|_| OsString::from(format!(r"{system_root}\System32")));
    env.insert("PATH".into(), joined);
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_env_has_systemroot_and_localappdata() {
        let env = base_env(&|_| None, Path::new(r"C:\h"), &[]);
        assert_eq!(env["SystemRoot"], OsString::from(r"C:\Windows"));
        assert!(env.contains_key("LOCALAPPDATA"));
    }

    // PATH is joined with the host's separator, so the Windows folders in
    // it only join on Windows.
    #[cfg(windows)]
    #[test]
    fn base_env_points_user_folders_at_the_task_home() {
        let host = |name: &str| (name == "SystemRoot").then(|| OsString::from(r"D:\Win"));
        let home = Path::new(r"C:\tasks\homes\t1");
        let env = base_env(&host, home, &[PathBuf::from(r"C:\py")]);
        for name in ["USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "TMPDIR"] {
            assert!(Path::new(&env[name]).starts_with(home), "{name}");
        }
        assert_eq!(env["OLEAFLY_SANDBOX"], OsString::from("appcontainer"));
        assert!(Path::new(&env["PYTHONPATH"]).starts_with(home.join("oleafly-python")));
        let path = env["PATH"].to_string_lossy().into_owned();
        assert!(path.starts_with(r"C:\py"));
        assert!(path.contains(r"D:\Win\System32"));
    }
}
