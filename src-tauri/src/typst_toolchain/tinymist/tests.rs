use super::*;
use sha2::Digest as _;
use std::sync::atomic::{AtomicUsize, Ordering};

fn version(text: &str) -> ToolchainVersion {
    ToolchainVersion::parse(text).unwrap()
}

fn target() -> &'static str {
    oleafly_core::typst_toolchain::host_target().unwrap_or("aarch64-apple-darwin")
}

fn chosen_version(choice: &TinymistChoice) -> Option<String> {
    match choice {
        TinymistChoice::Bundled => None,
        TinymistChoice::Catalog(catalog) => Some(catalog.version.to_string()),
    }
}

fn fake_choice(root: &Path, label: &str, bytes: &[u8]) -> CatalogTinymist {
    let catalog = super::super::catalog();
    let release = release_for_typst(catalog, &version("0.13.1")).unwrap();
    let mut artifact = release.targets.get(target()).unwrap().clone();
    artifact.binary_size = bytes.len() as u64;
    artifact.binary_sha256 = format!("{:x}", sha2::Sha256::digest(bytes));
    let tinymist_version = version(label);
    CatalogTinymist {
        binary: oleafly_core::typst_toolchain::tinymist_binary_path(
            root,
            &tinymist_version,
            target(),
        ),
        version: tinymist_version,
        typst_minor: "0.13".into(),
        artifact,
        allowed_hosts: catalog.allowed_download_hosts.clone(),
    }
}

struct DataDir {
    _directory: tempfile::TempDir,
    _env: std::sync::MutexGuard<'static, ()>,
}

impl DataDir {
    fn new() -> Self {
        let env = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        Self {
            _directory: directory,
            _env: env,
        }
    }
}

impl Drop for DataDir {
    fn drop(&mut self) {
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}

fn write_binary(request: &ToolchainInstallRequest, bytes: &[u8]) {
    std::fs::create_dir_all(&request.install_dir).unwrap();
    let binary = request.install_dir.join(&request.binary_name);
    std::fs::write(&binary, bytes).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}

#[test]
fn every_typst_minor_maps_to_the_tinymist_built_for_it() {
    let catalog = super::super::catalog();
    let pairs = [
        ("0.11.1", "0.11.32"),
        ("0.12.0", "0.12.22"),
        ("0.13.1", "0.13.30"),
        ("0.14.2", "0.14.20"),
        ("0.15.0", "0.15.8"),
        ("0.15.1", "0.15.8"),
        ("0.13.0", "0.13.30"),
    ];
    for (typst, tinymist) in pairs {
        assert_eq!(
            release_for_typst(catalog, &version(typst)).map(|release| release.version.to_string()),
            Some(tinymist.to_string()),
            "Typst {typst}"
        );
    }
}

#[test]
fn a_typst_outside_the_catalog_uses_the_nearest_older_minor_or_the_oldest() {
    let catalog = super::super::catalog();
    assert_eq!(
        release_for_typst(catalog, &version("0.16.2")).map(|release| release.version.to_string()),
        Some("0.15.8".into())
    );
    assert_eq!(
        release_for_typst(catalog, &version("0.10.0")).map(|release| release.version.to_string()),
        Some("0.11.32".into())
    );
}

#[test]
fn the_bundled_typst_minor_keeps_the_bundled_tinymist() {
    let root = tempfile::tempdir().unwrap();
    let catalog = super::super::catalog();
    for typst in ["0.15.0", "0.15.1", "0.16.0"] {
        assert_eq!(
            choose(catalog, &version(typst), root.path(), Some(target())),
            TinymistChoice::Bundled,
            "Typst {typst}"
        );
    }
}

#[test]
fn other_minors_use_the_catalog_tinymist_under_the_oleafly_root() {
    let root = tempfile::tempdir().unwrap();
    let catalog = super::super::catalog();
    let TinymistChoice::Catalog(choice) =
        choose(catalog, &version("0.13.1"), root.path(), Some(target()))
    else {
        panic!("Typst 0.13 needs the 0.13 Tinymist");
    };
    assert_eq!(choice.version.to_string(), "0.13.30");
    assert_eq!(choice.typst_minor, "0.13");
    assert_eq!(
        choice.binary,
        root.path()
            .join("toolchains")
            .join("tinymist")
            .join("0.13.30")
            .join(if target().contains("windows") {
                "tinymist.exe"
            } else {
                "tinymist"
            })
    );
    let release = release_for_typst(catalog, &version("0.13.1")).unwrap();
    assert_eq!(&choice.artifact, release.targets.get(target()).unwrap());
    assert_eq!(
        chosen_version(&choose(
            catalog,
            &version("0.11.1"),
            root.path(),
            Some(target())
        )),
        Some("0.11.32".into())
    );
}

#[test]
fn a_computer_without_catalog_builds_keeps_the_bundled_tinymist() {
    let root = tempfile::tempdir().unwrap();
    let catalog = super::super::catalog();
    assert_eq!(
        choose(catalog, &version("0.12.0"), root.path(), None),
        TinymistChoice::Bundled
    );
    assert_eq!(
        choose(
            catalog,
            &version("0.12.0"),
            root.path(),
            Some("x86_64-apple-darwin")
        ),
        TinymistChoice::Bundled
    );
}

#[test]
fn settings_rows_name_the_tinymist_each_typst_version_uses() {
    assert_eq!(tinymist_version_for("0.12.0").as_deref(), Some("0.12.22"));
    assert_eq!(tinymist_version_for("0.15.1").as_deref(), Some("0.15.8"));
    assert_eq!(tinymist_version_for("not a version"), None);
}

#[test]
fn the_toolchain_status_lists_the_tinymist_for_every_typst_row() {
    let root = tempfile::tempdir().unwrap();
    let toolchain = super::super::TypstToolchain {
        data_root: root.path().to_path_buf(),
        target: Some(target()),
        bundled: Some(root.path().join("typst")),
        default_choice: None,
        system: Some(oleafly_core::typst_toolchain::SystemTypst {
            path: root.path().join("system-typst"),
            version: version("0.16.0"),
        }),
        system_known: true,
    };
    let status = toolchain.status(None);
    let rows: Vec<(&str, Option<&str>)> = status
        .versions
        .iter()
        .map(|entry| (entry.version.as_str(), entry.tinymist_version.as_deref()))
        .collect();
    assert_eq!(
        rows,
        [
            ("0.16.0", Some("0.15.8")),
            ("0.15.1", Some("0.15.8")),
            ("0.15.0", Some("0.15.8")),
            ("0.14.2", Some("0.14.20")),
            ("0.13.1", Some("0.13.30")),
            ("0.12.0", Some("0.12.22")),
            ("0.11.1", Some("0.11.32")),
        ]
    );
}

#[test]
fn projects_use_their_pin_and_unpinned_projects_follow_the_app_default() {
    let _data = DataDir::new();
    let mut meta = crate::project::ProjectMeta {
        name: "Paper".into(),
        main_doc: "main.typ".into(),
        engine: "typst".into(),
        ..crate::project::ProjectMeta::default()
    };
    meta.set_typst_version_pin(Some("0.12.0".into()));
    assert_eq!(project_typst_version(&meta).to_string(), "0.12.0");
    meta.set_typst_version_pin(None);
    assert_eq!(
        project_typst_version(&meta).to_string(),
        super::super::bundled_version()
    );
    crate::config::set_typst_default_choice(Some("0.13.1".into())).unwrap();
    assert_eq!(project_typst_version(&meta).to_string(), "0.13.1");
}

#[test]
fn install_requests_point_at_the_pinned_catalog_artifact() {
    let root = tempfile::tempdir().unwrap();
    let catalog = super::super::catalog();
    let TinymistChoice::Catalog(choice) =
        choose(catalog, &version("0.12.0"), root.path(), Some(target()))
    else {
        panic!("Typst 0.12 needs the 0.12 Tinymist");
    };
    let request = choice.request().unwrap();
    assert_eq!(
        request.urls,
        [
            choice.artifact.mirror_url.clone(),
            choice.artifact.github_url.clone()
        ]
    );
    assert_eq!(request.allowed_hosts, catalog.allowed_download_hosts);
    assert_eq!(request.archive_sha256, choice.artifact.archive_sha256);
    assert_eq!(request.binary_sha256, choice.artifact.binary_sha256);
    assert_eq!(request.binary_size, choice.artifact.binary_size);
    assert_eq!(request.archive_member, choice.artifact.archive_member);
    assert_eq!(request.install_dir, choice.binary.parent().unwrap());
    assert_eq!(
        request.binary_name,
        choice.binary.file_name().unwrap().to_string_lossy()
    );
}

#[tokio::test]
async fn the_first_need_downloads_once_and_later_needs_reuse_the_install() {
    let root = tempfile::tempdir().unwrap();
    let bytes = b"fake tinymist 9.1.1";
    let choice = fake_choice(root.path(), "9.1.1", bytes);
    let calls = AtomicUsize::new(0);
    assert_eq!(choice.state(), TinymistInstallState::Missing);

    let first = ensure_installed(&choice, |request| {
        calls.fetch_add(1, Ordering::SeqCst);
        async move {
            write_binary(&request, bytes);
            Ok(())
        }
    })
    .await
    .unwrap();
    assert_eq!(first, TinymistEnsured::Installed(choice.binary.clone()));
    assert_eq!(choice.state(), TinymistInstallState::Installed);

    let second = ensure_installed(&choice, |request| {
        calls.fetch_add(1, Ordering::SeqCst);
        async move {
            write_binary(&request, bytes);
            Ok(())
        }
    })
    .await
    .unwrap();
    assert_eq!(
        second,
        TinymistEnsured::AlreadyInstalled(choice.binary.clone())
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn needs_that_arrive_together_share_one_download() {
    let root = tempfile::tempdir().unwrap();
    let bytes = b"fake tinymist 9.2.1";
    let choice = fake_choice(root.path(), "9.2.1", bytes);
    let calls = AtomicUsize::new(0);
    let (release, released) = tokio::sync::oneshot::channel::<()>();
    let first = ensure_installed(&choice, |request| {
        calls.fetch_add(1, Ordering::SeqCst);
        async move {
            let _ = released.await;
            write_binary(&request, bytes);
            Ok(())
        }
    });
    let second = ensure_installed(&choice, |request| {
        calls.fetch_add(1, Ordering::SeqCst);
        async move {
            write_binary(&request, bytes);
            Ok(())
        }
    });
    let observer = async {
        tokio::task::yield_now().await;
        let state = choice.state();
        let _ = release.send(());
        state
    };
    let (first, second, observed) = tokio::join!(first, second, observer);
    assert_eq!(observed, TinymistInstallState::Installing);
    assert_eq!(
        first.unwrap(),
        TinymistEnsured::Installed(choice.binary.clone())
    );
    assert_eq!(
        second.unwrap(),
        TinymistEnsured::AlreadyInstalled(choice.binary.clone())
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_failed_download_is_reported_until_a_later_one_succeeds() {
    let root = tempfile::tempdir().unwrap();
    let bytes = b"fake tinymist 9.3.1";
    let choice = fake_choice(root.path(), "9.3.1", bytes);

    let failure = ensure_installed(&choice, |_request| async {
        Err(TinymistInstallFailure {
            kind: TinymistFailureKind::Download,
            message: "The mirror and GitHub could not be reached.".into(),
        })
    })
    .await
    .unwrap_err();
    assert_eq!(failure.kind, TinymistFailureKind::Download);
    assert_eq!(
        choice.state(),
        TinymistInstallState::Failed("The mirror and GitHub could not be reached.".into())
    );

    ensure_installed(&choice, |request| async move {
        write_binary(&request, bytes);
        Ok(())
    })
    .await
    .unwrap();
    assert_eq!(choice.state(), TinymistInstallState::Installed);
}

#[tokio::test]
async fn a_download_that_does_not_match_the_catalog_hash_is_not_installed() {
    let root = tempfile::tempdir().unwrap();
    let choice = fake_choice(root.path(), "9.4.1", b"expected bytes");

    let failure = ensure_installed(&choice, |request| async move {
        write_binary(&request, b"tampered bytes");
        Ok(())
    })
    .await
    .unwrap_err();
    assert_eq!(failure.kind, TinymistFailureKind::Integrity);
    assert!(matches!(choice.state(), TinymistInstallState::Failed(_)));
}

#[test]
fn install_errors_keep_their_kind() {
    assert_eq!(
        failure_kind(crate::toolchain_download::ToolchainInstallErrorKind::DownloadFailed),
        TinymistFailureKind::Download
    );
    assert_eq!(
        failure_kind(crate::toolchain_download::ToolchainInstallErrorKind::IntegrityFailure),
        TinymistFailureKind::Integrity
    );
    assert_eq!(
        failure_kind(crate::toolchain_download::ToolchainInstallErrorKind::InstallFailed),
        TinymistFailureKind::Install
    );
}

#[tokio::test]
#[ignore = "downloads Tinymist 0.13.30 from the network"]
async fn downloads_the_catalog_tinymist_for_this_computer_and_runs_it() {
    let root = tempfile::tempdir().unwrap();
    let catalog = super::super::catalog();
    let target = oleafly_core::typst_toolchain::host_target().expect("a supported computer");
    let TinymistChoice::Catalog(choice) =
        choose(catalog, &version("0.13.1"), root.path(), Some(target))
    else {
        panic!("Typst 0.13 needs the 0.13 Tinymist");
    };
    let ensured = ensure_downloaded(&choice).await.unwrap();
    assert_eq!(ensured, TinymistEnsured::Installed(choice.binary.clone()));
    assert!(choice.verified());

    let mut command = std::process::Command::new(&choice.binary);
    command.arg("--version");
    let output =
        crate::proc::output_contained_with_timeout(command, std::time::Duration::from_secs(30))
            .unwrap();
    assert!(output.status.success());
    let text = String::from_utf8_lossy(&output.stdout);
    assert!(text.contains("0.13.30"), "{text}");
}
