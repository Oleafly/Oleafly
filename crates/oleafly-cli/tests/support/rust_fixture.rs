use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn rust_fixture(directory: &Path, source: &str, name: &str, cfg: Option<&str>) -> PathBuf {
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(source);
    let output = directory.join(oleafly_cli::executable_name(name));
    let mut command =
        Command::new(std::env::var_os("RUSTC").unwrap_or_else(|| OsString::from("rustc")));
    command
        .args(["--edition=2021", "-o"])
        .arg(&output)
        .arg(source);
    if let Some(cfg) = cfg {
        command.args(["--cfg", cfg]);
    }
    let result = command.output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    output.canonicalize().unwrap()
}
