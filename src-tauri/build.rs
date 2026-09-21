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
    tauri_build::try_build(attributes).expect("failed to run Tauri build script");
}
