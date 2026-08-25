use super::*;

#[test]
#[ignore = "downloads are large; run manually against local archives when bumping TINYTEX_TAG"]
fn pinned_release_archives_pass_reviewed_policies() {
    use sha2::Digest as _;
    use std::io::Read as _;

    let dir = std::env::var("TINYTEX_ARCHIVE_DIR").expect(
        "set TINYTEX_ARCHIVE_DIR to a directory holding the release archives for every platform",
    );
    let mut verified = Vec::new();
    for (os, arch) in [
        ("macos", "aarch64"),
        ("windows", "x86_64"),
        ("linux", "x86_64"),
        ("linux", "aarch64"),
    ] {
        let asset = tinytex_asset_for(os, arch).unwrap();
        let name = asset.url.rsplit('/').next().unwrap();
        let path = std::path::Path::new(&dir).join(name);
        assert!(path.is_file(), "missing archive {name} in {dir}");
        assert_eq!(
            std::fs::metadata(&path).unwrap().len(),
            asset.expected_bytes,
            "{name}: size does not match the pinned release"
        );
        let mut hasher = sha2::Sha256::new();
        let mut file = std::fs::File::open(&path).unwrap();
        let mut buffer = vec![0u8; 1 << 20];
        loop {
            let read = file.read(&mut buffer).unwrap();
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        assert_eq!(
            format!("{:x}", hasher.finalize()),
            asset.expected_sha256,
            "{name}: sha256 does not match the pinned release"
        );
        let result = if asset.format == ArchiveFormat::TarXz && !cfg!(target_os = "linux") {
            let tar = path.with_extension("").with_extension("tar");
            assert!(
                tar.is_file(),
                "this host cannot decode xz; place the decompressed {} next to the archive",
                tar.file_name().unwrap().to_string_lossy()
            );
            crate::tinytex_archive::inspect_tar(
                std::fs::File::open(tar).unwrap(),
                asset.member_policy(),
            )
        } else {
            crate::tinytex_archive::inspect_archive(&path, asset.format, asset.member_policy())
        };
        result.unwrap_or_else(|error| panic!("{name}: {error}"));
        verified.push(name.to_string());
    }
    assert_eq!(verified.len(), 4, "expected all four platform archives");
}
