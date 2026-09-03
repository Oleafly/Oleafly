use std::collections::{BTreeSet, HashMap};
use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};

pub(crate) const MAX_SOURCE_FILE_BYTES: usize = 2_000_000;
pub(crate) const MAX_SOURCE_BATCH_BYTES: usize = 10_000_000;
pub(crate) const MAX_SOURCE_BATCH_PATHS: usize = 20_000;

const FNV_OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnownSourceHash {
    pub path: String,
    pub hash: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectSourcesRequest {
    pub paths: Vec<String>,
    #[serde(default)]
    pub known: Vec<KnownSourceHash>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSourceFile {
    pub path: String,
    pub hash: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnreadableSource {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSourcesResult {
    pub files: Vec<ProjectSourceFile>,
    pub unchanged: Vec<String>,
    pub unreadable: Vec<UnreadableSource>,
    pub oversized: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct SourceLimits {
    pub file_bytes: usize,
    pub batch_bytes: usize,
    pub batch_paths: usize,
}

impl SourceLimits {
    pub(crate) const DEFAULT: Self = Self {
        file_bytes: MAX_SOURCE_FILE_BYTES,
        batch_bytes: MAX_SOURCE_BATCH_BYTES,
        batch_paths: MAX_SOURCE_BATCH_PATHS,
    };
}

pub(crate) fn fnv1a_64(bytes: &[u8]) -> u64 {
    bytes.iter().fold(FNV_OFFSET_BASIS, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(FNV_PRIME)
    })
}

pub(crate) fn source_hash(bytes: &[u8]) -> String {
    format!("{:016x}", fnv1a_64(bytes))
}

enum SourceRead {
    Bytes(Vec<u8>),
    OverFileLimit,
    OverBatchLimit,
    Failed(String),
}

fn read_source_bytes(path: &Path, file_limit: usize, batch_remaining: usize) -> SourceRead {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) => return SourceRead::Failed(error.to_string()),
    };
    let allowed = file_limit.min(batch_remaining);
    let mut bytes = Vec::with_capacity(allowed.min(64 * 1024));
    if let Err(error) = file
        .take(allowed.saturating_add(1) as u64)
        .read_to_end(&mut bytes)
    {
        return SourceRead::Failed(error.to_string());
    }
    if bytes.len() > allowed {
        return if allowed == file_limit {
            SourceRead::OverFileLimit
        } else {
            SourceRead::OverBatchLimit
        };
    }
    SourceRead::Bytes(bytes)
}

pub(crate) fn read_project_sources_sync(
    project_id: &str,
    request: ProjectSourcesRequest,
    limits: SourceLimits,
) -> Result<ProjectSourcesResult, String> {
    if request.paths.len() > limits.batch_paths {
        return Err(format!(
            "The request names {} files, which is more than the {} file batch limit.",
            request.paths.len(),
            limits.batch_paths
        ));
    }
    if request.known.len() > limits.batch_paths {
        return Err(format!(
            "The request carries {} known hashes, which is more than the {} file batch limit.",
            request.known.len(),
            limits.batch_paths
        ));
    }
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
    crate::paths::project_dir(project_id)?;
    let known: HashMap<String, String> = request
        .known
        .into_iter()
        .map(|entry| (entry.path, entry.hash))
        .collect();
    let paths: BTreeSet<String> = request.paths.into_iter().collect();

    let mut result = ProjectSourcesResult {
        files: Vec::new(),
        unchanged: Vec::new(),
        unreadable: Vec::new(),
        oversized: Vec::new(),
        truncated: false,
    };
    let mut consumed = 0usize;
    for path in paths {
        let remaining = limits.batch_bytes.saturating_sub(consumed);
        let resolved = match crate::sandbox::resolve(project_id, &path) {
            Ok(resolved) => resolved,
            Err(message) => {
                result.unreadable.push(UnreadableSource { path, message });
                continue;
            }
        };
        match read_source_bytes(&resolved, limits.file_bytes, remaining) {
            SourceRead::Bytes(bytes) => {
                consumed = consumed.saturating_add(bytes.len());
                let hash = source_hash(&bytes);
                if known.get(&path) == Some(&hash) {
                    result.unchanged.push(path);
                } else {
                    result.files.push(ProjectSourceFile {
                        path,
                        hash,
                        text: String::from_utf8_lossy(&bytes).into_owned(),
                    });
                }
            }
            SourceRead::OverFileLimit => {
                result.truncated = true;
                result.oversized.push(path);
            }
            SourceRead::OverBatchLimit => {
                result.truncated = true;
                result.oversized.push(path);
            }
            SourceRead::Failed(error) => {
                result.unreadable.push(UnreadableSource {
                    message: format!("{path} could not be read: {error}."),
                    path,
                });
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn read_project_sources(
    project_id: String,
    request: ProjectSourcesRequest,
) -> Result<ProjectSourcesResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_project_sources_sync(&project_id, request, SourceLimits::DEFAULT)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::Instant;

    struct TestProject {
        _directory: tempfile::TempDir,
        _env_guard: std::sync::MutexGuard<'static, ()>,
        id: String,
        root: PathBuf,
    }

    impl Drop for TestProject {
        fn drop(&mut self) {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }
    }

    fn project(id: &str) -> TestProject {
        let env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let root = crate::paths::create_project_dir(id).unwrap();
        assert!(root.starts_with(directory.path().canonicalize().unwrap()));
        TestProject {
            _directory: directory,
            _env_guard: env_guard,
            id: id.to_string(),
            root,
        }
    }

    fn write(project: &TestProject, rel: &str, bytes: &[u8]) {
        let full = project.root.join(rel);
        std::fs::create_dir_all(full.parent().unwrap()).unwrap();
        std::fs::write(full, bytes).unwrap();
    }

    fn request(paths: &[&str], known: &[(&str, &str)]) -> ProjectSourcesRequest {
        ProjectSourcesRequest {
            paths: paths.iter().map(|path| path.to_string()).collect(),
            known: known
                .iter()
                .map(|(path, hash)| KnownSourceHash {
                    path: path.to_string(),
                    hash: hash.to_string(),
                })
                .collect(),
        }
    }

    fn read(project: &TestProject, request: ProjectSourcesRequest) -> ProjectSourcesResult {
        read_project_sources_sync(&project.id, request, SourceLimits::DEFAULT).unwrap()
    }

    #[test]
    fn fnv1a_matches_published_vectors() {
        assert_eq!(source_hash(b""), "cbf29ce484222325");
        assert_eq!(source_hash(b"a"), "af63dc4c8601ec8c");
        assert_eq!(source_hash(b"foobar"), "85944171f73967e8");
    }

    #[test]
    fn default_limits_match_the_intelligence_worker() {
        assert_eq!(SourceLimits::DEFAULT.file_bytes, 2_000_000);
        assert_eq!(SourceLimits::DEFAULT.batch_bytes, 10_000_000);
        assert_eq!(SourceLimits::DEFAULT.batch_paths, 20_000);
    }

    #[test]
    fn unchanged_files_return_only_their_path_and_changed_files_return_text() {
        let project = project("sources-unchanged");
        write(&project, "main.tex", b"\\documentclass{article}\n");
        write(&project, "chapters/intro.tex", b"\\section{Intro}\n");

        let first = read(&project, request(&["main.tex", "chapters/intro.tex"], &[]));
        assert!(first.unchanged.is_empty());
        assert!(first.unreadable.is_empty());
        assert!(first.oversized.is_empty());
        assert!(!first.truncated);
        assert_eq!(
            first
                .files
                .iter()
                .map(|f| f.path.as_str())
                .collect::<Vec<_>>(),
            vec!["chapters/intro.tex", "main.tex"]
        );
        assert_eq!(first.files[1].text, "\\documentclass{article}\n");
        assert_eq!(
            first.files[1].hash,
            source_hash(b"\\documentclass{article}\n")
        );

        let known: Vec<(String, String)> = first
            .files
            .iter()
            .map(|f| (f.path.clone(), f.hash.clone()))
            .collect();
        let known_refs: Vec<(&str, &str)> = known
            .iter()
            .map(|(p, h)| (p.as_str(), h.as_str()))
            .collect();
        write(&project, "chapters/intro.tex", b"\\section{Introduction}\n");
        let second = read(
            &project,
            request(&["main.tex", "chapters/intro.tex"], &known_refs),
        );
        assert_eq!(second.unchanged, vec!["main.tex".to_string()]);
        assert_eq!(second.files.len(), 1);
        assert_eq!(second.files[0].path, "chapters/intro.tex");
        assert_eq!(second.files[0].text, "\\section{Introduction}\n");
        assert_eq!(
            second.files[0].hash,
            source_hash(b"\\section{Introduction}\n")
        );
        assert_ne!(second.files[0].hash, known[0].1);
    }

    #[test]
    fn a_stale_or_malformed_known_hash_is_treated_as_changed() {
        let project = project("sources-stale");
        write(&project, "main.tex", b"hello");
        let result = read(
            &project,
            request(&["main.tex"], &[("main.tex", "not-a-real-hash")]),
        );
        assert!(result.unchanged.is_empty());
        assert_eq!(result.files[0].text, "hello");
    }

    #[test]
    fn duplicate_paths_are_read_once_and_output_is_sorted_by_code_point() {
        let project = project("sources-dedupe");
        write(&project, "b.tex", b"b");
        write(&project, "A.tex", b"A");
        write(&project, "a.tex", b"a");
        let result = read(
            &project,
            request(&["b.tex", "a.tex", "A.tex", "b.tex"], &[]),
        );
        assert_eq!(
            result
                .files
                .iter()
                .map(|f| f.path.as_str())
                .collect::<Vec<_>>(),
            vec!["A.tex", "a.tex", "b.tex"]
        );
    }

    #[test]
    fn latin1_bibliographies_decode_lossily_like_read_file() {
        let project = project("sources-latin1");
        let latin1 = b"@article{key, author={Jos\xe9 M\xfcller}}\n";
        write(&project, "refs.bib", latin1);
        let result = read(&project, request(&["refs.bib"], &[]));
        assert_eq!(
            result.files[0].text,
            String::from_utf8_lossy(latin1).into_owned()
        );
        assert!(result.files[0].text.contains('\u{FFFD}'));
        assert_eq!(result.files[0].hash, source_hash(latin1));
    }

    #[test]
    fn missing_files_and_paths_outside_the_project_are_unreadable() {
        let project = project("sources-unreadable");
        write(&project, "main.tex", b"ok");
        let result = read(
            &project,
            request(
                &["main.tex", "gone.tex", "../escape.tex", "/etc/passwd"],
                &[],
            ),
        );
        assert_eq!(result.files.len(), 1);
        assert_eq!(
            result
                .unreadable
                .iter()
                .map(|u| u.path.as_str())
                .collect::<Vec<_>>(),
            vec!["../escape.tex", "/etc/passwd", "gone.tex"]
        );
        for entry in &result.unreadable {
            assert!(!entry.message.is_empty());
        }
        assert!(result.unreadable[2]
            .message
            .starts_with("gone.tex could not be read: "));
        assert!(!result.truncated);
    }

    #[test]
    fn a_directory_path_is_unreadable_not_an_error() {
        let project = project("sources-dir");
        write(&project, "chapters/one.tex", b"one");
        let result = read(&project, request(&["chapters"], &[]));
        assert!(result.files.is_empty());
        assert_eq!(result.unreadable.len(), 1);
    }

    #[test]
    fn per_file_and_batch_caps_report_truncation() {
        let project = project("sources-caps");
        write(&project, "a.tex", b"aaaa");
        write(&project, "b.tex", b"bbbbbbbbbb");
        write(&project, "c.tex", b"cc");
        let limits = SourceLimits {
            file_bytes: 8,
            batch_bytes: 5,
            batch_paths: 100,
        };
        let result = read_project_sources_sync(
            &project.id,
            request(&["a.tex", "b.tex", "c.tex"], &[]),
            limits,
        )
        .unwrap();
        assert!(result.truncated);
        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].path, "a.tex");
        assert!(result.unreadable.is_empty());
        assert_eq!(
            result.oversized,
            vec!["b.tex".to_string(), "c.tex".to_string()]
        );

        let file_only = SourceLimits {
            file_bytes: 8,
            batch_bytes: 1_000,
            batch_paths: 100,
        };
        let result = read_project_sources_sync(
            &project.id,
            request(&["a.tex", "b.tex", "c.tex"], &[]),
            file_only,
        )
        .unwrap();
        assert!(result.truncated);
        assert_eq!(result.files.len(), 2);
        assert!(result.unreadable.is_empty());
        assert_eq!(result.oversized, vec!["b.tex".to_string()]);
    }

    #[test]
    fn an_oversized_file_is_reported_separately_even_when_its_hash_is_known() {
        let project = project("sources-oversized-known");
        write(&project, "big.tex", b"0123456789");
        let limits = SourceLimits {
            file_bytes: 4,
            batch_bytes: 1_000,
            batch_paths: 100,
        };
        let hash = source_hash(b"0123456789");
        let result = read_project_sources_sync(
            &project.id,
            request(&["big.tex"], &[("big.tex", hash.as_str())]),
            limits,
        )
        .unwrap();
        assert!(result.files.is_empty());
        assert!(result.unchanged.is_empty());
        assert!(result.unreadable.is_empty());
        assert_eq!(result.oversized, vec!["big.tex".to_string()]);
        assert!(result.truncated);
    }

    #[test]
    fn unchanged_files_still_count_toward_the_batch_cap() {
        let project = project("sources-caps-unchanged");
        write(&project, "a.tex", b"aaaa");
        write(&project, "b.tex", b"bbbb");
        let limits = SourceLimits {
            file_bytes: 100,
            batch_bytes: 6,
            batch_paths: 100,
        };
        let hash = source_hash(b"aaaa");
        let result = read_project_sources_sync(
            &project.id,
            request(&["a.tex", "b.tex"], &[("a.tex", hash.as_str())]),
            limits,
        )
        .unwrap();
        assert_eq!(result.unchanged, vec!["a.tex".to_string()]);
        assert!(result.files.is_empty());
        assert!(result.unreadable.is_empty());
        assert_eq!(result.oversized, vec!["b.tex".to_string()]);
        assert!(result.truncated);
    }

    #[test]
    fn oversized_path_lists_are_rejected_before_any_read() {
        let project = project("sources-too-many");
        let limits = SourceLimits {
            file_bytes: 100,
            batch_bytes: 100,
            batch_paths: 2,
        };
        let error = read_project_sources_sync(
            &project.id,
            request(&["a.tex", "b.tex", "c.tex"], &[]),
            limits,
        )
        .unwrap_err();
        assert_eq!(
            error,
            "The request names 3 files, which is more than the 2 file batch limit."
        );
        let error = read_project_sources_sync(
            &project.id,
            request(
                &["a.tex"],
                &[("a.tex", "1"), ("b.tex", "2"), ("c.tex", "3")],
            ),
            limits,
        )
        .unwrap_err();
        assert_eq!(
            error,
            "The request carries 3 known hashes, which is more than the 2 file batch limit."
        );
    }

    #[test]
    fn a_missing_project_is_an_error() {
        let _project = project("sources-present");
        let error = read_project_sources_sync(
            "sources-absent",
            request(&["main.tex"], &[]),
            SourceLimits::DEFAULT,
        )
        .unwrap_err();
        assert!(error.contains("sources-absent"));
    }

    #[test]
    fn request_rejects_unknown_fields_and_defaults_known() {
        let parsed: ProjectSourcesRequest =
            serde_json::from_str(r#"{"paths":["main.tex"]}"#).unwrap();
        assert!(parsed.known.is_empty());
        assert!(serde_json::from_str::<ProjectSourcesRequest>(
            r#"{"paths":["main.tex"],"extra":1}"#
        )
        .is_err());
        assert!(serde_json::from_str::<ProjectSourcesRequest>(
            r#"{"paths":[],"known":[{"path":"a","hash":"b","c":1}]}"#
        )
        .is_err());
    }

    #[test]
    fn result_serializes_with_camel_case_keys() {
        let value = serde_json::to_value(ProjectSourcesResult {
            files: vec![ProjectSourceFile {
                path: "a.tex".into(),
                hash: "0".repeat(16),
                text: "x".into(),
            }],
            unchanged: vec!["b.tex".into()],
            unreadable: vec![UnreadableSource {
                path: "c.tex".into(),
                message: "c.tex could not be read: gone.".into(),
            }],
            oversized: vec!["d.tex".into()],
            truncated: false,
        })
        .unwrap();
        assert_eq!(value["files"][0]["path"], "a.tex");
        assert_eq!(value["unchanged"][0], "b.tex");
        assert_eq!(
            value["unreadable"][0]["message"],
            "c.tex could not be read: gone."
        );
        assert_eq!(value["oversized"], serde_json::json!(["d.tex"]));
        assert_eq!(value["truncated"], false);
    }

    fn seed_fixture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("fixtures")
            .join("research-seeds")
            .join("computational-physics-phd-thesis")
    }

    fn collect_sources(root: &Path, base: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        for entry in std::fs::read_dir(root).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            if path.is_dir() {
                collect_sources(&path, base, out);
                continue;
            }
            let rel = path
                .strip_prefix(base)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            let indexable = [".tex", ".bib", ".md", ".typ", ".sty", ".cls"]
                .iter()
                .any(|ext| rel.ends_with(ext));
            if indexable {
                out.push((rel, std::fs::read(&path).unwrap()));
            }
        }
    }

    #[test]
    fn seed_thesis_round_trips_byte_for_byte_with_read_file() {
        let project = project("sources-seed");
        let mut sources = Vec::new();
        collect_sources(&seed_fixture_root(), &seed_fixture_root(), &mut sources);
        assert!(sources.len() >= 10);
        for (rel, bytes) in &sources {
            write(&project, rel, bytes);
        }
        let paths: Vec<&str> = sources.iter().map(|(rel, _)| rel.as_str()).collect();
        let result = read(&project, request(&paths, &[]));
        assert_eq!(result.files.len(), sources.len());
        for file in &result.files {
            let expected =
                crate::project::read_file(project.id.clone(), file.path.clone()).unwrap();
            assert_eq!(file.text, expected);
            let bytes = &sources.iter().find(|(rel, _)| rel == &file.path).unwrap().1;
            assert_eq!(file.hash, source_hash(bytes));
        }
    }

    fn scaled_thesis(project: &TestProject, copies: usize) -> Vec<String> {
        let mut base = Vec::new();
        collect_sources(&seed_fixture_root(), &seed_fixture_root(), &mut base);
        let mut paths = Vec::new();
        for (rel, bytes) in &base {
            let scalable = rel.starts_with("chapters/") || rel.starts_with("appendices/");
            let count = if scalable { copies } else { 1 };
            for copy in 0..count {
                let target = if copy == 0 {
                    rel.clone()
                } else {
                    rel.replace(".tex", &format!("-{copy}.tex"))
                };
                write(project, &target, bytes);
                paths.push(target);
            }
        }
        paths
    }

    fn median(samples: &mut [f64]) -> f64 {
        samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
        samples[samples.len() / 2]
    }

    #[test]
    #[ignore = "benchmark: run with cargo test -p oleafly read_project_sources_benchmark -- --ignored --nocapture"]
    fn read_project_sources_benchmark() {
        let project = project("sources-bench");
        let paths = scaled_thesis(&project, 32);
        let refs: Vec<&str> = paths.iter().map(|p| p.as_str()).collect();
        let first = read(&project, request(&refs, &[]));
        let total_bytes: usize = first.files.iter().map(|f| f.text.len()).sum();
        let json_full = serde_json::to_string(&first).unwrap().len();
        let known: Vec<(String, String)> = first
            .files
            .iter()
            .map(|f| (f.path.clone(), f.hash.clone()))
            .collect();
        let known_refs: Vec<(&str, &str)> = known
            .iter()
            .map(|(p, h)| (p.as_str(), h.as_str()))
            .collect();

        let mut per_file = Vec::new();
        for _ in 0..10 {
            let start = Instant::now();
            for path in &paths {
                crate::project::read_file(project.id.clone(), path.clone()).unwrap();
            }
            per_file.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        let mut cold = Vec::new();
        for _ in 0..10 {
            let start = Instant::now();
            let result = read(&project, request(&refs, &[]));
            cold.push(start.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(result.files.len(), paths.len());
        }
        let mut warm = Vec::new();
        let mut json_warm = 0;
        for _ in 0..10 {
            let start = Instant::now();
            let result = read(&project, request(&refs, &known_refs));
            warm.push(start.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(result.unchanged.len(), paths.len());
            json_warm = serde_json::to_string(&result).unwrap().len();
        }
        println!(
            "thesis-x32: {} files, {} bytes of text; full response JSON {} bytes, unchanged response JSON {} bytes",
            paths.len(),
            total_bytes,
            json_full,
            json_warm
        );
        println!(
            "{} sequential read_file calls (Rust side only, no IPC): median {:.2} ms",
            paths.len(),
            median(&mut per_file)
        );
        println!(
            "one read_project_sources with no known hashes: median {:.2} ms",
            median(&mut cold)
        );
        println!(
            "one read_project_sources with every hash known: median {:.2} ms",
            median(&mut warm)
        );
    }

    #[test]
    fn the_command_reads_a_batch_off_the_blocking_pool() {
        let project = project("sources-command");
        write(&project, "main.tex", b"\\documentclass{article}\n");

        let result = tauri::async_runtime::block_on(read_project_sources(
            project.id.clone(),
            request(&["main.tex"], &[]),
        ))
        .unwrap();
        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].path, "main.tex");
        assert_eq!(result.files[0].text, "\\documentclass{article}\n");

        let error = tauri::async_runtime::block_on(read_project_sources(
            "sources-command-absent".to_string(),
            request(&["main.tex"], &[]),
        ))
        .unwrap_err();
        assert!(error.contains("sources-command-absent"));
    }

    #[cfg(unix)]
    #[test]
    fn a_file_the_process_cannot_open_is_unreadable_not_an_error() {
        use std::os::unix::fs::PermissionsExt;

        let project = project("sources-permission");
        write(&project, "open.tex", b"open");
        write(&project, "sealed.tex", b"sealed");
        let sealed = project.root.join("sealed.tex");
        std::fs::set_permissions(&sealed, std::fs::Permissions::from_mode(0o000)).unwrap();

        let result = read(&project, request(&["open.tex", "sealed.tex"], &[]));
        std::fs::set_permissions(&sealed, std::fs::Permissions::from_mode(0o600)).unwrap();

        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].path, "open.tex");
        assert_eq!(result.unreadable.len(), 1);
        assert_eq!(result.unreadable[0].path, "sealed.tex");
        assert!(result.unreadable[0]
            .message
            .starts_with("sealed.tex could not be read: "));
        assert!(result.unreadable[0].message.ends_with('.'));
        assert!(!result.truncated);
    }

    #[test]
    fn windows_line_endings_and_invalid_bytes_survive_the_round_trip() {
        let project = project("sources-line-endings");
        let crlf = b"\\documentclass{article}\r\n\r\n\\begin{document}\r\n";
        write(&project, "crlf.tex", crlf);
        let mixed = b"caf\xc3\xa9 \xff\r\ndone\n";
        write(&project, "mixed.tex", mixed);

        let result = read(&project, request(&["crlf.tex", "mixed.tex"], &[]));
        assert_eq!(result.files[0].path, "crlf.tex");
        assert_eq!(result.files[0].text, String::from_utf8_lossy(crlf));
        assert!(result.files[0].text.contains("\r\n"));
        assert_eq!(result.files[0].hash, source_hash(crlf));
        assert_eq!(result.files[1].text, String::from_utf8_lossy(mixed));
        assert!(result.files[1].text.contains("café \u{FFFD}\r\n"));
        assert_eq!(result.files[1].hash, source_hash(mixed));
    }

    #[test]
    fn known_hashes_are_matched_by_path_and_ignored_when_they_name_another_file() {
        let project = project("sources-known-paths");
        write(&project, "a.tex", b"same");
        write(&project, "b.tex", b"same");
        let hash = source_hash(b"same");

        let result = read(
            &project,
            request(
                &["a.tex"],
                &[
                    ("a.tex", hash.as_str()),
                    ("b.tex", hash.as_str()),
                    ("never-requested.tex", hash.as_str()),
                ],
            ),
        );
        assert_eq!(result.unchanged, vec!["a.tex".to_string()]);
        assert!(result.files.is_empty());

        let result = read(&project, request(&["a.tex"], &[("b.tex", hash.as_str())]));
        assert!(result.unchanged.is_empty());
        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].path, "a.tex");
        assert_eq!(result.files[0].hash, hash);
    }

    #[test]
    fn the_benchmark_fixture_copies_only_chapters_and_appendices() {
        let project = project("sources-scaled");
        let paths = scaled_thesis(&project, 3);

        let chapters: Vec<&String> = paths
            .iter()
            .filter(|path| path.starts_with("chapters/"))
            .collect();
        let roots: Vec<&String> = paths.iter().filter(|path| !path.contains('/')).collect();
        assert!(!chapters.is_empty());
        assert!(chapters.iter().any(|path| path.ends_with("-1.tex")));
        assert!(chapters.iter().any(|path| path.ends_with("-2.tex")));
        assert!(!chapters.iter().any(|path| path.ends_with("-3.tex")));
        assert_eq!(
            roots.len(),
            roots.iter().collect::<std::collections::HashSet<_>>().len()
        );
        for path in &paths {
            assert!(project.root.join(path).exists(), "{path}");
        }
    }

    #[test]
    fn the_benchmark_reports_the_middle_sample() {
        assert_eq!(median(&mut [3.0, 1.0, 2.0]), 2.0);
        assert_eq!(median(&mut [5.0]), 5.0);
        assert_eq!(median(&mut [4.0, 1.0, 3.0, 2.0]), 3.0);
    }
}
