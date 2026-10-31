use std::collections::BTreeMap;

use oleafly_doctools::stats::{
    collect_project_files, document_stats_with, KnownFiles, SourceReader,
};
pub use oleafly_doctools::stats::{DocumentStatsRequest, DocumentStatsResult};
use oleafly_doctools::DocError;

use crate::project_sources::{read_project_sources_sync, ProjectSourcesRequest, SourceLimits};

fn known_files(project_id: &str) -> Result<KnownFiles, String> {
    let root = crate::paths::project_dir(project_id)?;
    Ok(KnownFiles::from_paths(collect_project_files(&root)))
}

fn read_whole_file(project_id: &str, path: &str) -> Result<String, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
    let resolved = crate::sandbox::resolve_readable(project_id, path)?;
    std::fs::read(&resolved)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .map_err(|error| error.to_string())
}

struct ProjectReader<'a> {
    project_id: &'a str,
    limits: SourceLimits,
}

impl SourceReader for ProjectReader<'_> {
    fn read_batch(&self, paths: &[String]) -> Result<BTreeMap<String, Option<String>>, DocError> {
        let result = read_project_sources_sync(
            self.project_id,
            ProjectSourcesRequest {
                paths: paths.to_vec(),
                known: Vec::new(),
            },
            self.limits,
        )
        .map_err(DocError::other)?;
        let mut out = BTreeMap::new();
        for file in result.files {
            out.insert(file.path, Some(file.text));
        }
        for entry in result.unreadable {
            out.insert(entry.path, None);
        }
        for path in result.oversized {
            let text = read_whole_file(self.project_id, &path).ok();
            out.insert(path, text);
        }
        Ok(out)
    }
}

pub(crate) fn document_stats_with_limits(
    project_id: &str,
    request: DocumentStatsRequest,
    limits: SourceLimits,
) -> Result<DocumentStatsResult, String> {
    let known = known_files(project_id)?;
    document_stats_with(&known, request, &ProjectReader { project_id, limits })
        .map_err(|error| error.message)
}

pub(crate) fn document_stats_sync(
    project_id: &str,
    request: DocumentStatsRequest,
) -> Result<DocumentStatsResult, String> {
    document_stats_with_limits(project_id, request, SourceLimits::DEFAULT)
}

#[tauri::command]
pub async fn document_stats(
    project_id: String,
    request: DocumentStatsRequest,
) -> Result<DocumentStatsResult, String> {
    tauri::async_runtime::spawn_blocking(move || document_stats_sync(&project_id, request))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_doctools::stats::DocumentStats;
    use std::path::PathBuf;

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

    fn request(main: &str, overrides: &[(&str, &str)]) -> DocumentStatsRequest {
        DocumentStatsRequest {
            main_document: main.to_string(),
            overrides: overrides
                .iter()
                .map(|(path, text)| (path.to_string(), text.to_string()))
                .collect(),
        }
    }

    fn collect(project: &TestProject, main: &str) -> DocumentStatsResult {
        document_stats_sync(&project.id, request(main, &[])).unwrap()
    }

    #[test]
    fn vendor_dirs_agree() {
        assert_eq!(
            oleafly_doctools::stats::VENDOR_DIR,
            crate::typst_packages::VENDOR_DIR
        );
    }

    #[test]
    fn a_missing_root_counts_nothing_and_a_missing_project_is_an_error() {
        let project = project("stats-missing-root");
        let result = collect(&project, "main.tex");
        assert_eq!(result.file_count, 0);
        assert_eq!(result.unreadable, vec!["main.tex"]);
        assert_eq!(result.stats, DocumentStats::default());
        assert_eq!(result.root, "main.tex");
        assert!(document_stats_sync("stats-absent", request("main.tex", &[])).is_err());
    }

    #[test]
    fn oversized_files_fall_back_to_a_whole_read_like_the_frontend() {
        let project = project("stats-oversized");
        write(
            &project,
            "main.tex",
            b"Alpha beta gamma delta epsilon.\n\\input{part}\n",
        );
        write(&project, "part.tex", b"tiny\n");
        let limits = SourceLimits {
            file_bytes: 8,
            batch_bytes: 1_000,
            batch_paths: 100,
        };
        let result =
            document_stats_with_limits(&project.id, request("main.tex", &[]), limits).unwrap();
        assert_eq!(result.file_count, 2);
        assert_eq!(result.stats.words, 6);
        assert!(result.unreadable.is_empty());
    }

    #[test]
    fn the_command_counts_off_the_blocking_pool() {
        let project = project("stats-command");
        write(&project, "main.tex", b"\\section{One}\nAlpha beta.\n");
        let result = tauri::async_runtime::block_on(document_stats(
            project.id.clone(),
            request("main.tex", &[]),
        ))
        .unwrap();
        assert_eq!(result.stats.words, 3);
        assert_eq!(result.stats.headers, 1);
        let error = tauri::async_runtime::block_on(document_stats(
            "stats-command-absent".to_string(),
            request("main.tex", &[]),
        ))
        .unwrap_err();
        assert!(error.contains("stats-command-absent"));
    }
}
