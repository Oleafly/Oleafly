use std::path::{Path, PathBuf};

use super::rust_fixture::rust_fixture;

pub fn compiler_fixture(directory: &Path, failure: bool) -> PathBuf {
    let name = if failure {
        "fixture-failure"
    } else {
        "fixture-success"
    };
    rust_fixture(
        directory,
        "compiler.rs",
        name,
        failure.then_some("fixture_failure"),
    )
}
