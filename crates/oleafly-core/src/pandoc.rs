//! Finding a Pandoc new enough for Oleafly (2.19 or later, which has
//! `--embed-resources`), in the same order the app and the CLI use.
use std::ffi::OsString;
use std::path::PathBuf;
use std::time::Duration;

use crate::process_probe::probe_output;

pub const MIN_PANDOC_VERSION: (u32, u32) = (2, 19);
const VERSION_OUTPUT_BYTES: u64 = 64 * 1024;

/// The version on the first line of `pandoc --version` (`pandoc 3.1.2`).
pub fn parse_pandoc_version(version_stdout: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(version_stdout);
    let first = text.lines().next()?;
    let mut words = first.split_whitespace();
    if !words.next()?.to_ascii_lowercase().starts_with("pandoc") {
        return None;
    }
    let version = words.next()?;
    version
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_digit())
        .then(|| version.to_string())
}

pub fn pandoc_version_supported(version_stdout: &[u8]) -> bool {
    let Some(version) = parse_pandoc_version(version_stdout) else {
        return false;
    };
    let mut parts = version
        .split('.')
        .filter_map(|part| part.parse::<u32>().ok());
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    (major, minor) >= MIN_PANDOC_VERSION
}

#[derive(Clone, Debug, Default)]
pub struct PandocSearch {
    pub bundled_dirs: Vec<PathBuf>,
    pub data_root: Option<PathBuf>,
    pub home: Option<PathBuf>,
    pub path: Option<OsString>,
}

fn split_path_list(value: &OsString, windows: bool) -> Vec<PathBuf> {
    if windows {
        value
            .to_string_lossy()
            .split(';')
            .map(|entry| entry.trim().trim_matches('"'))
            .filter(|entry| !entry.is_empty())
            .map(PathBuf::from)
            .collect()
    } else {
        std::env::split_paths(value).collect()
    }
}

fn pandoc_candidates_for(search: &PandocSearch, windows: bool) -> Vec<PathBuf> {
    let name = if windows { "pandoc.exe" } else { "pandoc" };
    let mut folders: Vec<PathBuf> = search.bundled_dirs.clone();
    if let Some(root) = &search.data_root {
        folders.push(root.join("bin"));
    }
    if let Some(path) = &search.path {
        folders.extend(
            split_path_list(path, windows)
                .into_iter()
                .filter(|folder| folder.is_absolute() || windows),
        );
    }
    if !windows {
        for folder in [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/opt/homebrew/anaconda3/bin",
        ] {
            folders.push(PathBuf::from(folder));
        }
    }
    if let Some(home) = &search.home {
        for sub in [
            "anaconda3/bin",
            "miniconda3/bin",
            ".local/bin",
            "homebrew/bin",
            "bin",
        ] {
            folders.push(home.join(sub));
        }
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    for folder in folders {
        let candidate = folder.join(name);
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }
    candidates
}

pub fn pandoc_candidates(search: &PandocSearch) -> Vec<PathBuf> {
    pandoc_candidates_for(search, cfg!(windows))
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PandocFound {
    pub path: Option<PathBuf>,
    pub version: Option<String>,
    pub too_old: Vec<(PathBuf, String)>,
}

pub fn find_pandoc(search: &PandocSearch, timeout: Duration) -> PandocFound {
    let mut found = PandocFound::default();
    let mut probed: Vec<PathBuf> = Vec::new();
    for candidate in pandoc_candidates(search) {
        let Ok(real) = candidate.canonicalize() else {
            continue;
        };
        if !real.is_file() || probed.contains(&real) {
            continue;
        }
        probed.push(real.clone());
        let Some(output) = probe_output(&real, &["--version"], timeout, VERSION_OUTPUT_BYTES)
        else {
            continue;
        };
        if !output.success {
            continue;
        }
        let version = parse_pandoc_version(&output.stdout);
        if pandoc_version_supported(&output.stdout) {
            found.path = Some(real);
            found.version = version;
            return found;
        }
        if let Some(version) = version {
            found.too_old.push((real, version));
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pandoc_version_gate_accepts_2_19_plus_rejects_older() {
        assert!(pandoc_version_supported(b"pandoc 2.19\nfeatures: ..."));
        assert!(pandoc_version_supported(b"pandoc 3.9.0.2\nfeatures: ..."));
        assert!(pandoc_version_supported(b"pandoc.exe 3.1.2\n"));
        assert!(!pandoc_version_supported(b"pandoc 2.12\nfeatures: ..."));
        assert!(!pandoc_version_supported(b"pandoc 1.19.2.1\nfeatures: ..."));
        assert!(!pandoc_version_supported(b""));
        assert!(!pandoc_version_supported(b"not pandoc output"));
        assert_eq!(
            parse_pandoc_version(b"pandoc 3.1.2\n").as_deref(),
            Some("3.1.2")
        );
    }

    #[cfg(unix)]
    #[test]
    fn pandoc_path_resolution_returns_canonical_supported_executable() {
        use std::os::unix::fs::PermissionsExt as _;
        let directory = tempfile::tempdir().unwrap();
        let bin = directory.path().join("bin");
        std::fs::create_dir(&bin).unwrap();
        let executable = bin.join("pandoc");
        // Written through a child so no thread of this process holds the
        // write descriptor when the probe runs it (ETXTBSY on Linux).
        let status = std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg("printf '#!/bin/sh\\nprintf \"pandoc 3.9.0.2\\\\n\"\\n' > \"$1\" && chmod 755 \"$1\"")
            .arg("sh")
            .arg(&executable)
            .status()
            .unwrap();
        assert!(status.success());
        let mut permissions = executable.metadata().unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&executable, permissions).unwrap();
        let search = PandocSearch {
            path: Some(std::env::join_paths([&bin]).unwrap()),
            ..PandocSearch::default()
        };
        let found = find_pandoc(&search, Duration::from_secs(5));
        assert_eq!(found.path, Some(executable.canonicalize().unwrap()));
        assert_eq!(found.version.as_deref(), Some("3.9.0.2"));
    }

    #[test]
    fn windows_pandoc_candidates_end_in_exe_and_skip_unix_dirs() {
        let search = PandocSearch {
            home: Some(PathBuf::from("C:\\Users\\Ada")),
            path: Some(OsString::from("C:\\tools;D:\\pandoc")),
            ..PandocSearch::default()
        };
        let candidates = pandoc_candidates_for(&search, true);
        assert!(!candidates.is_empty());
        for candidate in &candidates {
            let text = candidate.to_string_lossy();
            assert!(text.ends_with("pandoc.exe"), "{text}");
            assert!(
                !text.starts_with("/opt") && !text.starts_with("/usr"),
                "{text}"
            );
        }
    }

    #[test]
    fn the_bundled_pandoc_comes_first_then_the_data_root() {
        let search = PandocSearch {
            bundled_dirs: vec![PathBuf::from("/bundle")],
            data_root: Some(PathBuf::from("/data")),
            ..PandocSearch::default()
        };
        let candidates = pandoc_candidates_for(&search, false);
        assert_eq!(candidates[0], PathBuf::from("/bundle/pandoc"));
        assert_eq!(candidates[1], PathBuf::from("/data/bin/pandoc"));
    }
}
