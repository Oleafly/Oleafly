use super::*;
use sha2::{Digest, Sha256};
use tempfile::TempDir;

const TEST_TARGET: &str = "aarch64-apple-darwin";
const WINDOWS_TARGET: &str = "x86_64-pc-windows-msvc";

fn embedded() -> &'static TypstToolchainCatalog {
    TypstToolchainCatalog::embedded()
}

fn version(value: &str) -> ToolchainVersion {
    ToolchainVersion::parse(value).unwrap_or_else(|| panic!("{value} should parse"))
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn fake_binary_bytes(version: &str) -> Vec<u8> {
    format!("fake typst {version}\n").into_bytes()
}

fn artifact_json(version: &str, bytes: &[u8]) -> serde_json::Value {
    serde_json::json!({
        "asset": "typst-aarch64-apple-darwin.tar.xz",
        "archiveType": "tar.xz",
        "archiveMember": "typst-aarch64-apple-darwin/typst",
        "archiveSha256": "0".repeat(64),
        "archiveSize": 1,
        "binarySha256": sha256_hex(bytes),
        "binarySize": bytes.len(),
        "mirrorUrl": format!("https://mirrors.oleafly.com/binaries/typst/{version}/typst-aarch64-apple-darwin.tar.xz"),
        "githubUrl": format!("https://github.com/typst/typst/releases/download/v{version}/typst-aarch64-apple-darwin.tar.xz")
    })
}

fn release_json(version: &str, flags: &[&str]) -> serde_json::Value {
    let parsed = ToolchainVersion::parse(version).unwrap();
    serde_json::json!({
        "version": version,
        "tag": format!("v{version}"),
        "minor": parsed.minor_line(),
        "releasedAt": "2026-01-01",
        "capabilities": {
            "flags": flags,
            "outputFormats": ["pdf", "png", "svg"],
            "pdfStandards": ["1.7", "a-2b"]
        },
        "targets": { TEST_TARGET: artifact_json(version, &fake_binary_bytes(version)) }
    })
}

fn test_catalog() -> TypstToolchainCatalog {
    let value = serde_json::json!({
        "schemaVersion": 1,
        "generatedAt": "2026-10-02",
        "supportedTargets": [TEST_TARGET],
        "allowedDownloadHosts": ["mirrors.oleafly.com", "github.com"],
        "typst": {
            "repository": "https://github.com/typst/typst",
            "bundled": "0.15.1",
            "versions": [
                release_json("0.13.1", &["--font-path", "--input"]),
                release_json("0.14.2", &["--font-path", "--input", "--pdf-standard"]),
                release_json("0.15.1", &["--color", "--font-path", "--input", "--pdf-standard"])
            ]
        },
        "tinymist": {
            "repository": "https://github.com/Myriad-Dreamin/tinymist",
            "bundled": "0.15.8",
            "versions": [
                {"typstMinor": "0.13", "version": "0.13.30", "tag": "v0.13.30", "releasedAt": "2025-10-27", "targets": {}},
                {"typstMinor": "0.15", "version": "0.15.8", "tag": "v0.15.8", "releasedAt": "2026-09-08", "targets": {}}
            ]
        }
    });
    TypstToolchainCatalog::parse(&value.to_string()).unwrap()
}

fn install_fake(data_root: &Path, version_text: &str) -> PathBuf {
    let path = typst_binary_path(data_root, &version(version_text), TEST_TARGET);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, fake_binary_bytes(version_text)).unwrap();
    path
}

fn request<'a>(
    pin: Option<&'a str>,
    default_choice: Option<&'a str>,
    bundled: Option<(&'a Path, &'a str)>,
    data_root: &'a Path,
    system: Option<&'a SystemTypst>,
) -> TypstResolveRequest<'a> {
    TypstResolveRequest {
        pin,
        default_choice,
        bundled,
        data_root,
        target: TEST_TARGET,
        system,
    }
}

#[test]
fn the_embedded_catalog_parses_and_names_the_bundled_release() {
    let catalog = embedded();
    assert_eq!(catalog.schema_version, 1);
    assert_eq!(catalog.bundled_version(), &version("0.15.1"));
    assert_eq!(bundled_typst_version(), &version("0.15.1"));
    assert!(catalog.typst_release("0.15.1").is_some());
    assert_eq!(
        catalog
            .supported_targets
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        [
            "aarch64-apple-darwin",
            "aarch64-unknown-linux-gnu",
            "x86_64-unknown-linux-gnu",
            "x86_64-pc-windows-msvc"
        ]
    );
}

#[test]
fn curated_versions_are_listed_newest_first() {
    let versions: Vec<String> = embedded()
        .curated_typst_versions()
        .into_iter()
        .map(|release| release.version.to_string())
        .collect();
    assert_eq!(
        versions,
        ["0.15.1", "0.15.0", "0.14.2", "0.13.1", "0.12.0", "0.11.1"]
    );
}

#[test]
fn every_curated_release_covers_every_supported_target() {
    let catalog = embedded();
    for release in catalog.curated_typst_versions() {
        for target in &catalog.supported_targets {
            let artifact = catalog
                .typst_artifact(&release.version.to_string(), target)
                .unwrap_or_else(|| panic!("{} has no {target} entry", release.version));
            assert_eq!(artifact.binary_sha256.len(), 64);
            assert!(artifact.binary_size > 0);
            assert!(artifact
                .mirror_url
                .starts_with("https://mirrors.oleafly.com/"));
        }
        assert!(
            catalog.tinymist_for_typst(&release.version).is_some(),
            "no Tinymist for {}",
            release.version
        );
    }
    assert!(catalog
        .typst_artifact("0.15.1", "riscv64-unknown-linux-gnu")
        .is_none());
    assert!(catalog.typst_artifact("0.10.0", TEST_TARGET).is_none());
}

#[test]
fn the_entry_for_a_version_and_target_carries_its_pins() {
    let artifact = embedded().typst_artifact("0.15.1", TEST_TARGET).unwrap();
    assert_eq!(artifact.asset, "typst-aarch64-apple-darwin.tar.xz");
    assert_eq!(artifact.archive_type, ArchiveType::TarXz);
    assert_eq!(
        artifact.archive_member.as_deref(),
        Some("typst-aarch64-apple-darwin/typst")
    );
    assert_eq!(
        artifact.binary_sha256,
        "7c4a136b377f3689400afe37b4f0fe3528d50faaa55cbb1106ac8a128f86ba1a"
    );
    assert_eq!(artifact.binary_size, 45_029_488);
    let windows = embedded().typst_artifact("0.11.1", WINDOWS_TARGET).unwrap();
    assert_eq!(windows.archive_type, ArchiveType::Zip);
}

#[test]
fn tinymist_is_matched_by_typst_minor() {
    let catalog = embedded();
    assert_eq!(
        catalog.tinymist_for_typst_minor("0.15").unwrap().version,
        version("0.15.8")
    );
    assert_eq!(
        catalog
            .tinymist_for_typst(&version("0.13.1"))
            .unwrap()
            .version,
        version("0.13.30")
    );
    assert_eq!(
        catalog
            .tinymist_for_typst(&version("0.15.0-rc.1"))
            .unwrap()
            .version,
        version("0.15.8")
    );
    assert!(catalog.tinymist_for_typst_minor("0.16").is_none());
    let bare = catalog
        .tinymist_for_typst_minor("0.11")
        .unwrap()
        .targets
        .get(TEST_TARGET)
        .unwrap();
    assert_eq!(bare.archive_type, ArchiveType::Binary);
    assert_eq!(bare.archive_member, None);
}

#[test]
fn capabilities_follow_the_nearest_catalog_version_at_or_below() {
    let catalog = embedded();
    let flags = |value: &str| catalog.capabilities_for(value).flags.clone();
    let release_flags = |value: &str| {
        catalog
            .typst_release(value)
            .unwrap()
            .capabilities
            .flags
            .clone()
    };
    assert_eq!(flags("0.15.1"), release_flags("0.15.1"));
    assert_eq!(flags("0.11.1"), release_flags("0.11.1"));
    assert_eq!(flags("0.14.9"), release_flags("0.14.2"));
    assert_eq!(flags("0.15.0-rc.1"), release_flags("0.14.2"));
    assert_eq!(flags("0.16.0"), release_flags("0.15.1"));
    assert_eq!(flags("1.0.0-beta.2"), release_flags("0.15.1"));
    assert_eq!(flags("0.12.1"), release_flags("0.12.0"));
    assert_eq!(flags("not a version"), release_flags("0.15.1"));
    assert_eq!(flags("0.10.0"), release_flags("0.11.1"));
    assert!(!catalog
        .capabilities_for("0.11.1")
        .supports_flag("--pdf-standard"));
    assert!(catalog
        .capabilities_for("0.16.0")
        .supports_flag("--pdf-standard"));
    assert_eq!(
        capabilities_for("0.16.0").flags,
        catalog.capabilities_for("0.16.0").flags
    );
}

#[test]
fn versions_parse_and_order_like_semver() {
    let parsed = version("0.16.0-rc.1");
    assert_eq!((parsed.major, parsed.minor, parsed.patch), (0, 16, 0));
    assert_eq!(parsed.to_string(), "0.16.0-rc.1");
    assert_eq!(parsed.minor_line(), "0.16");
    assert!(parsed.is_prerelease());
    assert!(!version("0.15.1").is_prerelease());
    assert_eq!(version(" 0.15.1 ").to_string(), "0.15.1");
    assert_eq!(version("0.15.1+build.7"), version("0.15.1"));

    let mut ordered = vec![
        version("0.16.0"),
        version("0.16.0-rc.1"),
        version("0.15.1"),
        version("0.16.0-beta.11"),
        version("0.16.0-beta.2"),
        version("0.16.0-beta"),
        version("0.16.0-rc.1.1"),
        version("0.9.9"),
        version("1.0.0"),
        version("0.16.0-1"),
    ];
    ordered.sort();
    let ordered: Vec<String> = ordered.iter().map(ToString::to_string).collect();
    assert_eq!(
        ordered,
        [
            "0.9.9",
            "0.15.1",
            "0.16.0-1",
            "0.16.0-beta",
            "0.16.0-beta.2",
            "0.16.0-beta.11",
            "0.16.0-rc.1",
            "0.16.0-rc.1.1",
            "0.16.0",
            "1.0.0"
        ]
    );

    for invalid in [
        "",
        "0.15",
        "0.15.1.2",
        "v0.15.1",
        "0.15.x",
        "00.15.1",
        "0.015.1",
        "0.15.1-",
        "0.15.1-rc..1",
        "0.15.1-rc.01",
        "0.15.1-rc/1",
        "0.15.1-../x",
        "-1.0.0",
        "0.15.1 0.15.2",
    ] {
        assert_eq!(ToolchainVersion::parse(invalid), None, "{invalid:?}");
    }
}

#[test]
fn versions_serialize_as_plain_strings() {
    let value = serde_json::to_value(version("0.16.0-rc.1")).unwrap();
    assert_eq!(value, serde_json::json!("0.16.0-rc.1"));
    let back: ToolchainVersion = serde_json::from_value(value).unwrap();
    assert_eq!(back, version("0.16.0-rc.1"));
    assert!(serde_json::from_value::<ToolchainVersion>(serde_json::json!("0.16")).is_err());
}

#[test]
fn version_output_parses_across_typst_releases() {
    for (output, expected) in [
        ("typst 0.11.1 (50115102)\n", "0.11.1"),
        ("typst 0.12.0 (737895d7)\n", "0.12.0"),
        ("typst 0.13.1 (8ace67d9)\n", "0.13.1"),
        ("typst 0.14.2 (b33de9de)\n", "0.14.2"),
        ("typst 0.15.0 (3ae52774)\n", "0.15.0"),
        ("typst 0.15.1 (9dfd3a08)\n", "0.15.1"),
        ("typst 0.15.1 (9dfd3a08)\r\n", "0.15.1"),
        ("typst 0.13.1 (unknown hash)\n", "0.13.1"),
        ("typst 0.14.0\n", "0.14.0"),
        ("typst 0.16.0-rc.1 (0123abcd)\n", "0.16.0-rc.1"),
        ("Typst v0.15.1\n", "0.15.1"),
        ("typst-cli 0.10.0\n", "0.10.0"),
        ("\nwarning: noise\ntypst 0.15.1 (9dfd3a08)\n", "0.15.1"),
    ] {
        assert_eq!(
            parse_typst_version_output(output),
            Some(version(expected)),
            "{output:?}"
        );
    }
    for output in [
        "",
        "tinymist 0.15.8\n",
        "typst\n",
        "typst version unknown\n",
        "pandoc 3.1.11\n",
    ] {
        assert_eq!(parse_typst_version_output(output), None, "{output:?}");
    }
}

#[test]
fn layout_places_toolchains_under_the_data_root() {
    let root = Path::new("/home/me/.oleafly");
    assert_eq!(toolchains_root(root), root.join("toolchains"));
    assert_eq!(
        typst_install_dir(root, &version("0.13.1")),
        root.join("toolchains/typst/0.13.1")
    );
    assert_eq!(
        typst_binary_path(root, &version("0.13.1"), TEST_TARGET),
        root.join("toolchains/typst/0.13.1/typst")
    );
    assert_eq!(
        typst_binary_path(root, &version("0.13.1"), WINDOWS_TARGET),
        root.join("toolchains/typst/0.13.1/typst.exe")
    );
    assert_eq!(
        tinymist_install_dir(root, &version("0.15.8")),
        root.join("toolchains/tinymist/0.15.8")
    );
    assert_eq!(
        tinymist_binary_path(root, &version("0.15.8"), TEST_TARGET),
        root.join("toolchains/tinymist/0.15.8/tinymist")
    );
    assert_eq!(
        tinymist_binary_path(root, &version("0.15.8"), WINDOWS_TARGET),
        root.join("toolchains/tinymist/0.15.8/tinymist.exe")
    );
}

#[test]
fn the_host_target_is_a_supported_catalog_target_when_known() {
    if let Some(target) = host_target() {
        assert!(embedded()
            .supported_targets
            .iter()
            .any(|known| known == target));
    }
}

#[test]
fn installed_versions_require_the_pinned_binary_hash() {
    let catalog = test_catalog();
    let data = TempDir::new().unwrap();
    assert!(catalog
        .installed_typst_versions(data.path(), TEST_TARGET)
        .is_empty());

    let good = install_fake(data.path(), "0.14.2");
    install_fake(data.path(), "0.13.1");
    let tampered = typst_binary_path(data.path(), &version("0.15.1"), TEST_TARGET);
    std::fs::create_dir_all(tampered.parent().unwrap()).unwrap();
    let mut bytes = fake_binary_bytes("0.15.1");
    bytes[0] ^= 1;
    std::fs::write(&tampered, bytes).unwrap();
    std::fs::create_dir_all(data.path().join("toolchains/typst/0.99.0")).unwrap();
    std::fs::write(
        data.path().join("toolchains/typst/0.99.0/typst"),
        fake_binary_bytes("0.99.0"),
    )
    .unwrap();

    let installed = catalog.installed_typst_versions(data.path(), TEST_TARGET);
    assert_eq!(
        installed,
        vec![
            InstalledTypst {
                version: version("0.14.2"),
                path: good.clone(),
            },
            InstalledTypst {
                version: version("0.13.1"),
                path: typst_binary_path(data.path(), &version("0.13.1"), TEST_TARGET),
            },
        ]
    );
    assert!(catalog
        .installed_typst_versions(data.path(), WINDOWS_TARGET)
        .is_empty());
    assert!(catalog.verify_typst_install(data.path(), &version("0.14.2"), TEST_TARGET));
    assert!(!catalog.verify_typst_install(data.path(), &version("0.15.1"), TEST_TARGET));
    assert!(!catalog.verify_typst_install(data.path(), &version("0.99.0"), TEST_TARGET));
}

#[test]
fn verification_is_cached_beside_the_binary_by_size_and_mtime() {
    let catalog = test_catalog();
    let data = TempDir::new().unwrap();
    let binary = install_fake(data.path(), "0.14.2");
    let cache = binary.with_file_name(INSTALLED_CACHE_FILE);
    assert!(!cache.exists());
    assert!(catalog.verify_typst_install(data.path(), &version("0.14.2"), TEST_TARGET));
    let recorded: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&cache).unwrap()).unwrap();
    assert_eq!(recorded["binary"], "typst");
    assert_eq!(
        recorded["binarySha256"],
        catalog
            .typst_artifact("0.14.2", TEST_TARGET)
            .unwrap()
            .binary_sha256
    );
    assert_eq!(recorded["size"], fake_binary_bytes("0.14.2").len());

    let file = std::fs::OpenOptions::new()
        .write(true)
        .open(&binary)
        .unwrap();
    let modified = file.metadata().unwrap().modified().unwrap();
    let mut changed = fake_binary_bytes("0.14.2");
    changed[0] ^= 1;
    std::fs::write(&binary, &changed).unwrap();
    file.set_modified(modified).unwrap();
    drop(file);
    assert!(
        catalog.verify_typst_install(data.path(), &version("0.14.2"), TEST_TARGET),
        "an unchanged size and mtime trusts the cached verification"
    );

    let later = modified + std::time::Duration::from_secs(5);
    std::fs::OpenOptions::new()
        .write(true)
        .open(&binary)
        .unwrap()
        .set_modified(later)
        .unwrap();
    assert!(!catalog.verify_typst_install(data.path(), &version("0.14.2"), TEST_TARGET));

    std::fs::write(&binary, fake_binary_bytes("0.14.2")).unwrap();
    std::fs::write(&cache, "not json").unwrap();
    assert!(catalog.verify_typst_install(data.path(), &version("0.14.2"), TEST_TARGET));
    let rewritten: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&cache).unwrap()).unwrap();
    assert_eq!(rewritten["binary"], "typst");
}

#[test]
fn a_cache_for_another_hash_is_not_trusted() {
    let catalog = test_catalog();
    let data = TempDir::new().unwrap();
    let binary = install_fake(data.path(), "0.14.2");
    let mut bytes = fake_binary_bytes("0.14.2");
    bytes[0] ^= 1;
    std::fs::write(&binary, &bytes).unwrap();
    let metadata = std::fs::metadata(&binary).unwrap();
    let modified = metadata
        .modified()
        .unwrap()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    std::fs::write(
        binary.with_file_name(INSTALLED_CACHE_FILE),
        serde_json::json!({
            "binary": "typst",
            "binarySha256": sha256_hex(&bytes),
            "size": metadata.len(),
            "modifiedSecs": modified.as_secs(),
            "modifiedNanos": modified.subsec_nanos()
        })
        .to_string(),
    )
    .unwrap();
    assert!(!catalog.verify_typst_install(data.path(), &version("0.14.2"), TEST_TARGET));
}

#[test]
fn resolution_prefers_bundled_then_downloaded_then_system() {
    let catalog = test_catalog();
    let data = TempDir::new().unwrap();
    let bundled = data.path().join("bundled-typst");
    let system = SystemTypst {
        path: PathBuf::from("/opt/homebrew/bin/typst"),
        version: version("0.14.2"),
    };

    let resolved = catalog
        .resolve_typst(&request(
            None,
            None,
            Some((&bundled, "0.15.1")),
            data.path(),
            Some(&system),
        ))
        .unwrap();
    assert_eq!(resolved.source, TypstSource::Bundled);
    assert_eq!(resolved.path, bundled);
    assert_eq!(resolved.version, version("0.15.1"));
    assert_eq!(
        resolved.capabilities,
        catalog.capabilities_for("0.15.1").clone()
    );

    install_fake(data.path(), "0.15.1");
    let resolved = catalog
        .resolve_typst(&request(
            Some("0.15.1"),
            None,
            Some((&bundled, "0.15.1")),
            data.path(),
            None,
        ))
        .unwrap();
    assert_eq!(resolved.source, TypstSource::Bundled);

    let resolved = catalog
        .resolve_typst(&request(
            Some("0.14.2"),
            None,
            Some((&bundled, "0.15.1")),
            data.path(),
            Some(&system),
        ))
        .unwrap();
    assert_eq!(resolved.source, TypstSource::System);
    assert_eq!(resolved.path, system.path);
    assert_eq!(resolved.version, version("0.14.2"));

    let installed = install_fake(data.path(), "0.14.2");
    let resolved = catalog
        .resolve_typst(&request(
            Some("0.14.2"),
            None,
            Some((&bundled, "0.15.1")),
            data.path(),
            Some(&system),
        ))
        .unwrap();
    assert_eq!(resolved.source, TypstSource::Downloaded);
    assert_eq!(resolved.path, installed);
    assert_eq!(
        resolved.capabilities,
        catalog.capabilities_for("0.14.2").clone()
    );
}

#[test]
fn the_pin_wins_over_the_default_choice_and_the_default_over_bundled() {
    let catalog = test_catalog();
    let data = TempDir::new().unwrap();
    let bundled = data.path().join("bundled-typst");
    install_fake(data.path(), "0.13.1");
    install_fake(data.path(), "0.14.2");

    let by_default = catalog
        .resolve_typst(&request(
            None,
            Some("0.13.1"),
            Some((&bundled, "0.15.1")),
            data.path(),
            None,
        ))
        .unwrap();
    assert_eq!(by_default.version, version("0.13.1"));
    assert_eq!(by_default.source, TypstSource::Downloaded);

    let pinned = catalog
        .resolve_typst(&request(
            Some("0.14.2"),
            Some("0.13.1"),
            Some((&bundled, "0.15.1")),
            data.path(),
            None,
        ))
        .unwrap();
    assert_eq!(pinned.version, version("0.14.2"));

    let blank_pin = catalog
        .resolve_typst(&request(
            Some("  "),
            None,
            Some((&bundled, "0.15.1")),
            data.path(),
            None,
        ))
        .unwrap();
    assert_eq!(blank_pin.source, TypstSource::Bundled);
}

#[test]
fn a_missing_catalog_pin_is_not_installed_and_a_foreign_pin_is_unknown() {
    let catalog = test_catalog();
    let data = TempDir::new().unwrap();
    let bundled = data.path().join("bundled-typst");
    let system = SystemTypst {
        path: PathBuf::from("/usr/local/bin/typst"),
        version: version("0.12.0"),
    };

    let missing = catalog
        .resolve_typst(&request(
            Some("0.13.1"),
            None,
            Some((&bundled, "0.15.1")),
            data.path(),
            Some(&system),
        ))
        .unwrap_err();
    assert_eq!(
        missing,
        TypstResolveError::NotInstalled {
            version: "0.13.1".into()
        }
    );
    assert!(missing.to_string().contains("0.13.1"));

    let unknown = catalog
        .resolve_typst(&request(
            Some("0.99.0"),
            None,
            Some((&bundled, "0.15.1")),
            data.path(),
            Some(&system),
        ))
        .unwrap_err();
    assert_eq!(
        unknown,
        TypstResolveError::UnknownVersion {
            version: "0.99.0".into()
        }
    );

    for garbage in ["latest", "../0.15.1", "0.15"] {
        assert_eq!(
            catalog
                .resolve_typst(&request(Some(garbage), None, None, data.path(), None))
                .unwrap_err(),
            TypstResolveError::UnknownVersion {
                version: garbage.into()
            }
        );
    }

    assert_eq!(
        catalog
            .resolve_typst(&request(None, None, None, data.path(), None))
            .unwrap_err(),
        TypstResolveError::NotInstalled {
            version: "0.15.1".into()
        }
    );
}

#[test]
fn a_system_typst_satisfies_only_its_exact_version() {
    let catalog = test_catalog();
    let data = TempDir::new().unwrap();
    let system = SystemTypst {
        path: PathBuf::from("/home/me/.cargo/bin/typst"),
        version: version("0.16.0-rc.1"),
    };
    let resolved = catalog
        .resolve_typst(&request(
            Some("0.16.0-rc.1"),
            None,
            None,
            data.path(),
            Some(&system),
        ))
        .unwrap();
    assert_eq!(resolved.source, TypstSource::System);
    assert_eq!(resolved.version, version("0.16.0-rc.1"));
    assert_eq!(
        resolved.capabilities,
        catalog.capabilities_for("0.15.1").clone(),
        "an unknown newer Typst uses the newest catalog capabilities"
    );
    assert_eq!(
        catalog
            .resolve_typst(&request(
                Some("0.16.0"),
                None,
                None,
                data.path(),
                Some(&system)
            ))
            .unwrap_err(),
        TypstResolveError::UnknownVersion {
            version: "0.16.0".into()
        }
    );
}

#[test]
fn a_bundled_binary_of_another_version_is_not_used_for_a_pin() {
    let catalog = test_catalog();
    let data = TempDir::new().unwrap();
    let bundled = data.path().join("bundled-typst");
    assert_eq!(
        catalog
            .resolve_typst(&request(
                Some("0.14.2"),
                None,
                Some((&bundled, "0.15.1")),
                data.path(),
                None,
            ))
            .unwrap_err(),
        TypstResolveError::NotInstalled {
            version: "0.14.2".into()
        }
    );
    let resolved = catalog
        .resolve_typst(&request(
            Some("0.14.2"),
            None,
            Some((&bundled, "0.14.2")),
            data.path(),
            None,
        ))
        .unwrap();
    assert_eq!(resolved.source, TypstSource::Bundled);
}

#[test]
fn compile_arguments_match_the_app_for_the_bundled_release() {
    let arguments = typst_compile_args(
        capabilities_for("0.15.1"),
        Path::new("/p/main.typ"),
        Path::new("/p/.oleafly/build/main.pdf"),
        Path::new("/p"),
        TypstDiagnosticFormat::Short,
        &[],
    )
    .unwrap();
    assert_eq!(
        arguments,
        [
            "--color=never",
            "compile",
            "/p/main.typ",
            "/p/.oleafly/build/main.pdf",
            "--root",
            "/p",
            "--diagnostic-format",
            "short"
        ]
        .map(OsString::from)
    );
    let human = typst_compile_args(
        capabilities_for("0.11.1"),
        Path::new("a.typ"),
        Path::new("a.pdf"),
        Path::new("."),
        TypstDiagnosticFormat::Human,
        &[],
    )
    .unwrap();
    assert_eq!(human[0], "--color=never");
    assert_eq!(&human[human.len() - 2..], ["--diagnostic-format", "human"]);
}

#[test]
fn compile_arguments_append_supported_flags_in_order() {
    let arguments = typst_compile_args(
        capabilities_for("0.15.1"),
        Path::new("main.typ"),
        Path::new("out/{p}.png"),
        Path::new("/p"),
        TypstDiagnosticFormat::Short,
        &[
            TypstCompileFlag::FontPath(PathBuf::from("/p/fonts")),
            TypstCompileFlag::IgnoreSystemFonts,
            TypstCompileFlag::Input {
                key: "draft".into(),
                value: "a=b".into(),
            },
            TypstCompileFlag::Format("png".into()),
            TypstCompileFlag::Ppi(144),
            TypstCompileFlag::PdfStandard("a-2b".into()),
            TypstCompileFlag::PackagePath(PathBuf::from("/data/packages")),
            TypstCompileFlag::PackageCachePath(PathBuf::from("/cache/packages")),
        ],
    )
    .unwrap();
    let tail: Vec<String> = arguments[8..]
        .iter()
        .map(|value| value.to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        tail,
        [
            "--font-path",
            "/p/fonts",
            "--ignore-system-fonts",
            "--input",
            "draft=a=b",
            "--format",
            "png",
            "--ppi",
            "144",
            "--pdf-standard",
            "a-2b",
            "--package-path",
            "/data/packages",
            "--package-cache-path",
            "/cache/packages"
        ]
    );
}

#[test]
fn compile_arguments_refuse_flags_the_version_lacks() {
    let old = capabilities_for("0.11.1");
    let build = |flags: &[TypstCompileFlag]| {
        typst_compile_args(
            old,
            Path::new("main.typ"),
            Path::new("main.pdf"),
            Path::new("."),
            TypstDiagnosticFormat::Short,
            flags,
        )
    };
    for (flag, name) in [
        (TypstCompileFlag::IgnoreSystemFonts, "--ignore-system-fonts"),
        (
            TypstCompileFlag::PdfStandard("a-2b".into()),
            "--pdf-standard",
        ),
        (
            TypstCompileFlag::PackagePath(PathBuf::from("/x")),
            "--package-path",
        ),
        (
            TypstCompileFlag::PackageCachePath(PathBuf::from("/x")),
            "--package-cache-path",
        ),
    ] {
        assert_eq!(
            build(std::slice::from_ref(&flag)).unwrap_err(),
            TypstArgsError::UnsupportedFlag { flag: name },
            "{flag:?}"
        );
    }
    assert!(build(&[TypstCompileFlag::FontPath(PathBuf::from("/f"))]).is_ok());

    let middle = capabilities_for("0.12.0");
    assert_eq!(
        typst_compile_args(
            middle,
            Path::new("main.typ"),
            Path::new("main.pdf"),
            Path::new("."),
            TypstDiagnosticFormat::Short,
            &[TypstCompileFlag::PdfStandard("a-3b".into())],
        )
        .unwrap_err(),
        TypstArgsError::UnsupportedValue {
            flag: "--pdf-standard",
            value: "a-3b".into()
        }
    );
    assert_eq!(
        build(&[TypstCompileFlag::Format("html".into())]).unwrap_err(),
        TypstArgsError::UnsupportedValue {
            flag: "--format",
            value: "html".into()
        }
    );
    for flag in [
        TypstCompileFlag::Ppi(0),
        TypstCompileFlag::Input {
            key: String::new(),
            value: "x".into(),
        },
        TypstCompileFlag::Input {
            key: "a=b".into(),
            value: "x".into(),
        },
    ] {
        assert!(
            matches!(
                build(std::slice::from_ref(&flag)).unwrap_err(),
                TypstArgsError::InvalidValue { .. }
            ),
            "{flag:?}"
        );
    }
    let error = build(&[TypstCompileFlag::IgnoreSystemFonts]).unwrap_err();
    assert!(error.to_string().contains("--ignore-system-fonts"));
}

#[cfg(unix)]
fn script(directory: &Path, name: &str, body: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = directory.join(name);
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

#[cfg(unix)]
#[test]
fn version_probes_read_the_binary_and_give_up_quickly() {
    let directory = TempDir::new().unwrap();
    let good = script(directory.path(), "good", "echo 'typst 0.13.1 (8ace67d9)'");
    assert_eq!(
        typst_version_of(&good, TYPST_VERSION_TIMEOUT),
        Some(version("0.13.1"))
    );
    let failing = script(
        directory.path(),
        "failing",
        "echo 'typst 0.13.1 (8ace67d9)'\nexit 2",
    );
    assert_eq!(typst_version_of(&failing, TYPST_VERSION_TIMEOUT), None);
    let other = script(directory.path(), "other", "echo 'pandoc 3.1.11'");
    assert_eq!(typst_version_of(&other, TYPST_VERSION_TIMEOUT), None);
    assert_eq!(
        typst_version_of(&directory.path().join("missing"), TYPST_VERSION_TIMEOUT),
        None
    );

    let slow = script(directory.path(), "slow", "exec sleep 30");
    let started = std::time::Instant::now();
    assert_eq!(
        typst_version_of(&slow, std::time::Duration::from_millis(300)),
        None
    );
    assert!(started.elapsed() < std::time::Duration::from_secs(5));

    let holder = script(
        directory.path(),
        "holder",
        "echo 'typst 0.13.1 (x)'\nsleep 30 &\nexit 0",
    );
    let started = std::time::Instant::now();
    let _ = typst_version_of(&holder, std::time::Duration::from_millis(500));
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
}

#[test]
fn system_candidates_cover_path_and_the_usual_install_folders() {
    let home = Path::new("/home/me");
    let path = std::env::join_paths([
        PathBuf::from("/usr/bin"),
        PathBuf::from("relative/bin"),
        PathBuf::from("/opt/homebrew/bin"),
    ])
    .unwrap();
    let unix = system_typst_candidates_from(Some(&path), Some(home), false);
    assert_eq!(
        unix,
        [
            PathBuf::from("/usr/bin/typst"),
            PathBuf::from("/opt/homebrew/bin/typst"),
            PathBuf::from("/usr/local/bin/typst"),
            home.join(".cargo/bin/typst"),
        ]
    );
    let windows = system_typst_candidates_from(None, Some(home), true);
    assert_eq!(windows, [home.join(".cargo").join("bin").join("typst.exe")]);
    assert!(system_typst_candidates_from(None, None, true).is_empty());
}

#[cfg(unix)]
#[test]
fn system_detection_skips_the_bundled_sidecar_and_managed_installs() {
    let data = TempDir::new().unwrap();
    let elsewhere = TempDir::new().unwrap();
    let bundled_dir = elsewhere.path().join("bundled");
    let managed_dir = data.path().join("toolchains/typst/0.13.1");
    let user_dir = elsewhere.path().join("user");
    let broken_dir = elsewhere.path().join("broken");
    for directory in [&bundled_dir, &managed_dir, &user_dir, &broken_dir] {
        std::fs::create_dir_all(directory).unwrap();
    }
    let bundled = script(&bundled_dir, "typst", "echo 'typst 0.15.1 (9dfd3a08)'");
    script(&managed_dir, "typst", "echo 'typst 0.13.1 (8ace67d9)'");
    script(&broken_dir, "typst", "exit 1");
    std::fs::write(elsewhere.path().join("not-executable"), "typst").unwrap();
    let user = script(&user_dir, "typst", "echo 'typst 0.14.2 (b33de9de)'");
    let candidates = vec![
        bundled_dir.join("typst"),
        managed_dir.join("typst"),
        elsewhere.path().join("missing/typst"),
        elsewhere.path().join("not-executable"),
        broken_dir.join("typst"),
        user_dir.join("typst"),
    ];
    let found = detect_system_typst_among(
        &candidates,
        data.path(),
        Some(&bundled),
        TYPST_VERSION_TIMEOUT,
    )
    .unwrap();
    assert_eq!(found.path, user.canonicalize().unwrap());
    assert_eq!(found.version, version("0.14.2"));
    assert_eq!(
        detect_system_typst_among(
            &candidates[..5],
            data.path(),
            Some(&bundled),
            TYPST_VERSION_TIMEOUT
        ),
        None
    );
    let first =
        detect_system_typst_among(&candidates, data.path(), None, TYPST_VERSION_TIMEOUT).unwrap();
    assert_eq!(first.version, version("0.15.1"));
}

fn tail_of(arguments: &[OsString]) -> Vec<String> {
    arguments[8..]
        .iter()
        .map(|value| value.to_string_lossy().into_owned())
        .collect()
}

fn args_for(version: &str, flags: &[TypstCompileFlag]) -> Result<Vec<OsString>, TypstArgsError> {
    typst_compile_args(
        capabilities_for(version),
        Path::new("main.typ"),
        Path::new("main.pdf"),
        Path::new("/p"),
        TypstDiagnosticFormat::Human,
        flags,
    )
}

#[test]
fn page_timestamp_dependency_and_feature_flags_follow_each_version() {
    let pages = TypstCompileFlag::Pages("1-2".into());
    let stamp = TypstCompileFlag::CreationTimestamp(0);
    let deps = TypstCompileFlag::Deps(PathBuf::from("/b/deps.json"));
    let html = TypstCompileFlag::Features("html".into());
    for flag in [&pages, &stamp, &deps, &html] {
        assert_eq!(
            args_for("0.11.1", std::slice::from_ref(flag)).unwrap_err(),
            TypstArgsError::UnsupportedFlag { flag: flag.name() },
            "{flag:?}"
        );
    }
    assert!(args_for("0.12.0", &[pages.clone(), stamp.clone()]).is_ok());
    for flag in [&deps, &html] {
        assert!(
            args_for("0.12.0", std::slice::from_ref(flag)).is_err(),
            "{flag:?}"
        );
    }
    assert!(args_for(
        "0.13.1",
        &[html.clone(), TypstCompileFlag::Format("html".into())]
    )
    .is_ok());
    assert!(args_for("0.13.1", std::slice::from_ref(&deps)).is_err());
    assert!(args_for("0.12.0", &[TypstCompileFlag::Format("html".into())]).is_err());
    let newest = args_for(
        "0.15.1",
        &[
            pages,
            stamp,
            deps,
            html,
            TypstCompileFlag::Format("html".into()),
        ],
    )
    .unwrap();
    assert_eq!(
        tail_of(&newest),
        [
            "--pages",
            "1-2",
            "--creation-timestamp",
            "0",
            "--deps",
            "/b/deps.json",
            "--deps-format",
            "json",
            "--features",
            "html",
            "--format",
            "html"
        ]
    );
    assert_eq!(
        &newest[6..8],
        [
            OsString::from("--diagnostic-format"),
            OsString::from("human")
        ]
    );
    assert!(args_for("0.14.2", &[TypstCompileFlag::Deps(PathBuf::from("d.json"))]).is_ok());
}

#[test]
fn page_ranges_are_checked_before_typst_sees_them() {
    for (value, normalized) in [
        ("1", "1"),
        ("2,5", "2,5"),
        ("3-6", "3-6"),
        ("8-", "8-"),
        ("-3", "-3"),
        (" 1, 2 - 4 ", "1,2-4"),
        ("4-4", "4-4"),
    ] {
        assert_eq!(
            normalize_page_ranges(value).as_deref(),
            Some(normalized),
            "{value}"
        );
        assert!(args_for("0.15.1", &[TypstCompileFlag::Pages(value.into())]).is_ok());
    }
    for value in [
        "",
        " ",
        "0",
        "a",
        "5-3",
        "1--2",
        "1,,2",
        "-",
        "0-2",
        "1-0",
        ",1",
        "99999999999",
    ] {
        assert_eq!(normalize_page_ranges(value), None, "{value}");
        assert!(
            matches!(
                args_for("0.15.1", &[TypstCompileFlag::Pages(value.into())]).unwrap_err(),
                TypstArgsError::InvalidValue {
                    flag: "--pages",
                    ..
                }
            ),
            "{value}"
        );
    }
    assert!(matches!(
        args_for("0.15.1", &[TypstCompileFlag::Features("html now".into())]).unwrap_err(),
        TypstArgsError::InvalidValue {
            flag: "--features",
            ..
        }
    ));
}

#[test]
fn font_list_arguments_follow_the_version() {
    let dirs = [PathBuf::from("/p/fonts"), PathBuf::from("/p/extra")];
    let strings = |arguments: Vec<OsString>| -> Vec<String> {
        arguments
            .into_iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect()
    };
    assert_eq!(
        strings(typst_fonts_args(
            capabilities_for("0.11.1"),
            &version("0.11.1"),
            &dirs,
            true
        )),
        [
            "--color=never",
            "fonts",
            "--font-path",
            "/p/fonts",
            "--font-path",
            "/p/extra"
        ]
    );
    assert_eq!(
        strings(typst_fonts_args(
            capabilities_for("0.14.2"),
            &version("0.14.2"),
            &dirs[..1],
            true
        )),
        [
            "--color=never",
            "fonts",
            "--font-path",
            "/p/fonts",
            "--ignore-system-fonts"
        ]
    );
    assert_eq!(
        strings(typst_fonts_args(
            capabilities_for("0.15.1"),
            &version("0.15.1"),
            &[],
            false
        )),
        ["--color=never", "fonts", "--variants"]
    );
}

#[test]
fn font_listings_parse_with_and_without_sources() {
    let plain = "Academy Engraved LET\nDejaVu Sans Mono\n\nNew Computer Modern\n";
    assert_eq!(
        parse_typst_fonts(plain),
        [
            TypstFontFamily {
                name: "Academy Engraved LET".into(),
                sources: Vec::new()
            },
            TypstFontFamily {
                name: "DejaVu Sans Mono".into(),
                sources: Vec::new()
            },
            TypstFontFamily {
                name: "New Computer Modern".into(),
                sources: Vec::new()
            },
        ]
    );
    let old_variants = "Al Bayan\n- Style: Normal, Weight: 400, Stretch: FontStretch(1000)\n- Style: Normal, Weight: 700, Stretch: FontStretch(1000)\nInter\n- Style: Normal, Weight: 400, Stretch: FontStretch(1000)\n";
    assert_eq!(
        parse_typst_fonts(old_variants)
            .into_iter()
            .map(|family| family.name)
            .collect::<Vec<_>>(),
        ["Al Bayan", "Inter"]
    );
    let sourced = "Academy Engraved LET\n  └ /System/Library/Fonts/Academy.ttf\n      Style: Normal, Weight: 400, Stretch: 100%\n\nADT Slab Numeric\n  └ /System/Library/Fonts/ADTNumeric.ttc (Variable)\n      Style: Normal\n      Weight: 300-900 (Default: 300)\n\nLibertinus Serif\n  ├ (Embedded)\n  │   Style: Normal, Weight: 400, Stretch: 100%\n  ├ /p/fonts/Libertinus.otf\n  │   Style: Normal, Weight: 700, Stretch: 100%\n  └ (Embedded)\n      Style: Italic, Weight: 400, Stretch: 100%\n";
    assert_eq!(
        parse_typst_fonts(sourced),
        [
            TypstFontFamily {
                name: "Academy Engraved LET".into(),
                sources: vec!["/System/Library/Fonts/Academy.ttf".into()]
            },
            TypstFontFamily {
                name: "ADT Slab Numeric".into(),
                sources: vec!["/System/Library/Fonts/ADTNumeric.ttc".into()]
            },
            TypstFontFamily {
                name: "Libertinus Serif".into(),
                sources: vec!["(Embedded)".into(), "/p/fonts/Libertinus.otf".into()]
            },
        ]
    );
}

#[test]
fn dependency_listings_name_every_input() {
    assert_eq!(
        parse_typst_deps(r#"{"inputs":["fig.svg","sub/ch.typ","main.typ"],"outputs":["out.pdf"]}"#),
        Some(vec![
            "fig.svg".to_string(),
            "sub/ch.typ".to_string(),
            "main.typ".to_string()
        ])
    );
    assert_eq!(
        parse_typst_deps(r#"{"inputs":["a.typ", 3]}"#),
        Some(vec!["a.typ".to_string()])
    );
    assert_eq!(parse_typst_deps(r#"{"outputs":[]}"#), None);
    assert_eq!(parse_typst_deps("main.pdf: main.typ"), None);
}

#[test]
fn project_font_folders_must_stay_inside_the_project() {
    let directory = TempDir::new().unwrap();
    let root = directory.path().join("project");
    let outside = directory.path().join("outside");
    for folder in [
        root.join("fonts"),
        root.join("assets/type"),
        outside.clone(),
    ] {
        std::fs::create_dir_all(folder).unwrap();
    }
    std::fs::write(root.join("note.txt"), b"x").unwrap();
    let canonical = root.canonicalize().unwrap();
    let spec = crate::TypstSpec {
        font_paths: vec![
            "assets/type".into(),
            "../outside".into(),
            outside.to_string_lossy().into_owned(),
            "missing".into(),
            "note.txt".into(),
            "fonts".into(),
            "./assets/type/".into(),
        ],
        ..crate::TypstSpec::default()
    };
    assert_eq!(
        typst_project_font_dirs(Some(&spec), &root),
        [canonical.join("fonts"), canonical.join("assets/type")]
    );
    assert_eq!(
        typst_project_font_dirs(None, &root),
        [canonical.join("fonts")]
    );
    std::fs::remove_dir(root.join("fonts")).unwrap();
    assert!(typst_project_font_dirs(None, &root).is_empty());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&outside, root.join("linked")).unwrap();
        let linked = crate::TypstSpec {
            font_paths: vec!["linked".into()],
            ..crate::TypstSpec::default()
        };
        assert!(typst_project_font_dirs(Some(&linked), &root).is_empty());
    }
}
