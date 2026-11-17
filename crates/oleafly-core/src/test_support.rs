use std::hash::{Hash, Hasher};
use std::path::PathBuf;

pub fn nextest_run_dir() -> Option<PathBuf> {
    std::env::var_os("NEXTEST_RUN_ID")
        .map(|run_id| std::env::temp_dir().join("oleafly-test-data").join(run_id))
}

pub fn test_attempt_key() -> String {
    let test_id = std::env::var_os("NEXTEST_ATTEMPT_ID")
        .unwrap_or_else(|| std::process::id().to_string().into());
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    test_id.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub fn test_data_dir(prefix: &str) -> Result<PathBuf, String> {
    test_data_dir_in(nextest_run_dir(), prefix)
}

fn test_data_dir_in(run_dir: Option<PathBuf>, prefix: &str) -> Result<PathBuf, String> {
    let mut builder = tempfile::Builder::new();
    builder.prefix(prefix);
    let directory = match run_dir {
        Some(parent) => {
            std::fs::create_dir_all(&parent)
                .map_err(|e| format!("failed to create the test data run folder: {e}"))?;
            builder.tempdir_in(parent)
        }
        None => builder.tempdir(),
    };
    directory
        .map(tempfile::TempDir::keep)
        .map_err(|e| format!("failed to create the test data folder: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_data_dir_in_honors_the_run_directory() {
        let parent = tempfile::tempdir().unwrap();
        let scoped = test_data_dir_in(Some(parent.path().to_path_buf()), "scoped-").unwrap();
        assert_eq!(scoped.parent(), Some(parent.path()));

        let unscoped = test_data_dir_in(None, "unscoped-").unwrap();
        assert_eq!(unscoped.parent(), Some(std::env::temp_dir().as_path()));
        std::fs::remove_dir(&unscoped).unwrap();
    }
}
