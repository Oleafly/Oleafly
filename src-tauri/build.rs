use std::path::{Path, PathBuf};

/// Tools that Linux packages keep in `/usr/libexec/oleafly` (see
/// `tauri.linux.conf.json`). In `/usr/bin` they would collide with the
/// distribution's own pandoc, and linuxdeploy would rewrite them for the
/// AppImage, which breaks a static-pie Typst. Biber stays a Tauri sidecar:
/// linuxdeploy has to see it to bundle the libraries it needs.
const LINUX_PACKAGED_TOOLS: [&str; 3] = ["tectonic", "pandoc", "typst"];

fn unchanged(source: &Path, destination: &Path) -> bool {
    let (Ok(source), Ok(destination)) = (source.metadata(), destination.metadata()) else {
        return false;
    };
    source.len() == destination.len()
        && matches!(
            (source.modified(), destination.modified()),
            (Ok(source), Ok(destination)) if destination >= source
        )
}

fn stage_linux_tools() -> Result<(), String> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let triple = std::env::var("TARGET").map_err(|error| error.to_string())?;
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").map_err(|error| error.to_string())?);
    // A development build runs the tools from beside its own binary.
    let profile_dir = out_dir
        .ancestors()
        .nth(3)
        .ok_or("OUT_DIR is not inside a Cargo target folder")?;
    let staged = manifest.join("binaries/linux");
    std::fs::create_dir_all(&staged).map_err(|error| error.to_string())?;
    for tool in LINUX_PACKAGED_TOOLS {
        let source = manifest.join("binaries").join(format!("{tool}-{triple}"));
        println!("cargo:rerun-if-changed={}", source.display());
        for destination in [staged.join(tool), profile_dir.join(tool)] {
            if !unchanged(&source, &destination) {
                std::fs::copy(&source, &destination)
                    .map_err(|error| format!("{}: {error}", source.display()))?;
            }
        }
    }
    Ok(())
}

fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    let mut attributes = tauri_build::Attributes::new();
    println!("cargo:rerun-if-env-changed=OLEAFLY_EMBED_TEST_MANIFEST");
    if target_os == "windows"
        && target_env == "msvc"
        && std::env::var_os("OLEAFLY_EMBED_TEST_MANIFEST").is_some()
    {
        let manifest =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-test-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        // The linker embeds the test manifest for every test target. Tauri's
        // binary resource must not contribute a second manifest with ID 1.
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    }
    if target_os == "linux" {
        stage_linux_tools().expect("failed to stage the bundled tools");
    }
    tauri_build::try_build(attributes).expect("failed to run Tauri build script");
}
