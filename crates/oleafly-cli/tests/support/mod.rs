use std::ffi::OsString;
use std::path::{Path, PathBuf};

pub fn compiler_fixture(directory: &Path, failure: bool) -> PathBuf {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/compiler.rs");
    let output = directory.join(oleafly_cli::executable_name(if failure {
        "fixture-failure"
    } else {
        "fixture-success"
    }));
    let mut command = std::process::Command::new(
        std::env::var_os("RUSTC").unwrap_or_else(|| OsString::from("rustc")),
    );
    command
        .args(["--edition=2021", "-o"])
        .arg(&output)
        .arg(source);
    if failure {
        command.args(["--cfg", "fixture_failure"]);
    }
    let result = command.output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    output.canonicalize().unwrap()
}
