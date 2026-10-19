use std::path::Path;
use std::process::Command;

fn main() {
    if let Ok(target) = std::env::var("TARGET") {
        println!("cargo:rustc-env=OLEAFLY_BUILD_TARGET={target}");
    }
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR");
    let config = Path::new(&manifest_dir).join("../../src-tauri/tauri.conf.json");
    println!("cargo:rerun-if-changed={}", config.display());
    println!("cargo:rerun-if-env-changed=OLEAFLY_COMMIT");
    let text = std::fs::read_to_string(&config).unwrap_or_else(|error| {
        panic!(
            "the CLI takes its version from {}, which can't be read: {error}",
            config.display()
        )
    });
    let value: serde_json::Value = serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("{} isn't valid JSON: {error}", config.display()));
    let version = value["version"]
        .as_str()
        .unwrap_or_else(|| panic!("{} has no \"version\"", config.display()));
    println!("cargo:rustc-env=OLEAFLY_APP_VERSION={version}");
    let commit = std::env::var("OLEAFLY_COMMIT")
        .ok()
        .map(|commit| commit.trim().to_string())
        .filter(|commit| !commit.is_empty())
        .or_else(|| {
            let output = Command::new("git")
                .args(["rev-parse", "--short=12", "HEAD"])
                .current_dir(&manifest_dir)
                .output()
                .ok()?;
            output
                .status
                .success()
                .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
                .filter(|commit| {
                    !commit.is_empty()
                        && commit
                            .chars()
                            .all(|character| character.is_ascii_hexdigit())
                })
        })
        .unwrap_or_default();
    let label = if commit.is_empty() {
        "dev".to_string()
    } else {
        commit.clone()
    };
    println!("cargo:rustc-env=OLEAFLY_COMMIT={commit}");
    println!("cargo:rustc-env=OLEAFLY_COMMIT_LABEL={label}");
}
