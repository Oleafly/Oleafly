use super::*;
use std::time::UNIX_EPOCH;

fn version(text: &str) -> ToolchainVersion {
    ToolchainVersion::parse(text).unwrap()
}

fn target() -> &'static str {
    oleafly_core::typst_toolchain::host_target().unwrap_or("aarch64-apple-darwin")
}

fn toolchain(root: &Path) -> TypstToolchain {
    TypstToolchain {
        data_root: root.to_path_buf(),
        target: Some(target()),
        bundled: Some(root.join("app").join("typst")),
        default_choice: None,
        system: None,
        system_known: true,
    }
}

fn system(path: &Path, text: &str) -> SystemTypst {
    SystemTypst {
        path: path.to_path_buf(),
        version: version(text),
    }
}

fn fake_download(root: &Path, text: &str) -> PathBuf {
    let parsed = version(text);
    let artifact = catalog().typst_artifact(text, target()).unwrap();
    let binary = oleafly_core::typst_toolchain::typst_binary_path(root, &parsed, target());
    std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
    std::fs::write(&binary, format!("fake typst {text}")).unwrap();
    let metadata = std::fs::metadata(&binary).unwrap();
    let modified = metadata
        .modified()
        .unwrap()
        .duration_since(UNIX_EPOCH)
        .unwrap();
    let record = serde_json::json!({
        "binary": binary.file_name().unwrap().to_string_lossy(),
        "binarySha256": artifact.binary_sha256,
        "size": metadata.len(),
        "modifiedSecs": modified.as_secs(),
        "modifiedNanos": modified.subsec_nanos(),
    });
    std::fs::write(
        binary.with_file_name(oleafly_core::typst_toolchain::INSTALLED_CACHE_FILE),
        serde_json::to_vec(&record).unwrap(),
    )
    .unwrap();
    binary
}

fn app_error(text: &str) -> (String, BTreeMap<String, String>) {
    let json: serde_json::Value =
        serde_json::from_str(text.strip_prefix(crate::app_error::PREFIX).unwrap()).unwrap();
    let params = json["params"]
        .as_object()
        .map(|params| {
            params
                .iter()
                .map(|(key, value)| (key.clone(), value.as_str().unwrap().to_owned()))
                .collect()
        })
        .unwrap_or_default();
    (json["code"].as_str().unwrap().to_owned(), params)
}

fn assert_app_error(text: &str, code: &str, version: &str) {
    let (actual, params) = app_error(text);
    assert_eq!(actual, code, "{text}");
    assert_eq!(params.get("version").map(String::as_str), Some(version));
    assert!(
        crate::app_error::english(text).is_some(),
        "{code} needs English text in errors.json"
    );
}

fn typst_meta(pin: Option<&str>) -> ProjectMeta {
    let mut meta = ProjectMeta {
        name: "Paper".into(),
        main_doc: "main.typ".into(),
        engine: "typst".into(),
        ..ProjectMeta::default()
    };
    meta.set_typst_version_pin(pin.map(str::to_owned));
    meta
}

struct DataDir {
    _directory: tempfile::TempDir,
    root: PathBuf,
    _env: std::sync::MutexGuard<'static, ()>,
}

impl DataDir {
    fn new() -> Self {
        let env = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        Self {
            root: crate::paths::oleafly_root().unwrap(),
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

#[test]
fn the_status_lists_every_catalog_version_newest_first_with_where_it_is_installed() {
    let root = tempfile::tempdir().unwrap();
    let mut typst = toolchain(root.path());
    fake_download(root.path(), "0.13.1");
    typst.system = Some(system(Path::new("/usr/local/bin/typst"), "0.10.0"));

    let status = typst.status(Some("0.14.2".into()));

    let listed: Vec<(&str, &[TypstSource], bool)> = status
        .versions
        .iter()
        .map(|entry| {
            (
                entry.version.as_str(),
                entry.sources.as_slice(),
                entry.in_catalog,
            )
        })
        .collect();
    assert_eq!(
        listed,
        [
            ("0.15.1", &[TypstSource::Bundled][..], true),
            ("0.15.0", &[][..], true),
            ("0.14.2", &[][..], true),
            ("0.13.1", &[TypstSource::Downloaded][..], true),
            ("0.12.0", &[][..], true),
            ("0.11.1", &[][..], true),
            ("0.10.0", &[TypstSource::System][..], false),
        ]
    );
    let system_only = status.versions.last().unwrap();
    assert_eq!(system_only.released_at, None);
    assert_eq!(system_only.download_bytes, None);
    let downloaded = &status.versions[3];
    assert_eq!(downloaded.released_at.as_deref(), Some("2025-03-07"));
    assert_eq!(
        downloaded.download_bytes,
        Some(
            catalog()
                .typst_artifact("0.13.1", target())
                .unwrap()
                .archive_size
        )
    );
    assert_eq!(status.bundled_version, "0.15.1");
    assert_eq!(status.default_version, "0.15.1");
    assert_eq!(status.default_choice, None);
    assert_eq!(status.installing.as_deref(), Some("0.14.2"));

    let json = serde_json::to_value(&status).unwrap();
    assert_eq!(json["bundledVersion"], "0.15.1");
    assert_eq!(json["defaultVersion"], "0.15.1");
    assert!(json["defaultChoice"].is_null());
    assert_eq!(
        json["system"],
        serde_json::json!({"version": "0.10.0", "path": "/usr/local/bin/typst"})
    );
    assert_eq!(
        json["versions"][3]["sources"],
        serde_json::json!(["downloaded"])
    );
    assert_eq!(json["versions"][3]["inCatalog"], true);
    assert!(json["versions"][3]["releasedAt"].is_string());
    assert!(json["versions"][3]["downloadBytes"].is_u64());
}

#[test]
fn a_system_typst_of_a_catalog_version_joins_that_row_and_the_default_choice_is_reported() {
    let root = tempfile::tempdir().unwrap();
    let mut typst = toolchain(root.path());
    typst.system = Some(system(Path::new("/opt/homebrew/bin/typst"), "0.15.1"));
    typst.default_choice = Some("0.13.1".into());

    let status = typst.status(None);

    assert_eq!(
        status.versions[0].sources,
        [TypstSource::Bundled, TypstSource::System]
    );
    assert_eq!(status.versions.len(), catalog().typst.versions.len());
    assert_eq!(status.default_version, "0.13.1");
    assert_eq!(status.default_choice.as_deref(), Some("0.13.1"));
    assert_eq!(status.installing, None);
}

#[test]
fn a_missing_bundled_sidecar_is_not_listed_as_installed() {
    let root = tempfile::tempdir().unwrap();
    let mut typst = toolchain(root.path());
    typst.bundled = None;
    let status = typst.status(None);
    assert!(status.versions.iter().all(|entry| entry.sources.is_empty()));
    assert_eq!(status.default_version, "0.15.1");
}

#[test]
fn pins_resolve_to_the_bundled_downloaded_or_system_binary_and_feed_compile_options() {
    let root = tempfile::tempdir().unwrap();
    let mut typst = toolchain(root.path());
    let downloaded = fake_download(root.path(), "0.13.1");
    typst.system = Some(system(Path::new("/opt/homebrew/bin/typst"), "0.12.0"));

    let bundled = typst.resolve(None).unwrap();
    assert_eq!(bundled.source, TypstSource::Bundled);
    assert_eq!(bundled.path, root.path().join("app").join("typst"));
    let pinned = typst.resolve(Some("0.13.1")).unwrap();
    assert_eq!(pinned.source, TypstSource::Downloaded);
    assert_eq!(pinned.path, downloaded);
    let from_system = typst.resolve(Some("0.12.0")).unwrap();
    assert_eq!(from_system.source, TypstSource::System);
    assert_eq!(
        from_system.capabilities,
        *oleafly_core::typst_toolchain::capabilities_for("0.12.0")
    );

    typst.default_choice = Some("0.13.1".into());
    assert_eq!(typst.resolve(None).unwrap().path, downloaded);

    let engine = crate::document_engine::engine_for("typst", "main.typ").unwrap();
    let spec = engine
        .compile_spec(
            Path::new("/build"),
            Path::new("/project"),
            crate::document_engine::CompileTarget::Main {
                main_document: "main.typ",
            },
            crate::document_engine::CompileOptions {
                typst: Some(Arc::new(pinned)),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        spec.executable,
        crate::document_engine::EngineExecutable::ExternalPath(downloaded)
    );
}

#[test]
fn a_lazy_resolution_looks_for_a_system_typst_only_when_nothing_else_matches() {
    let root = tempfile::tempdir().unwrap();
    let mut typst = toolchain(root.path());
    typst.system_known = false;
    assert_eq!(
        typst.resolve_lazily(None).unwrap().source,
        TypstSource::Bundled
    );
    assert!(!typst.system_known);
}

#[test]
fn the_project_pin_or_the_app_default_is_resolved_before_compiling() {
    let data = DataDir::new();
    let downloaded = fake_download(&data.root, "0.13.1");

    let resolved = resolve_for_compile(&typst_meta(Some("0.13.1")))
        .unwrap()
        .unwrap();
    assert_eq!(resolved.source, TypstSource::Downloaded);
    assert_eq!(resolved.path, downloaded);
    assert_eq!(resolved.version, version("0.13.1"));

    let latex = ProjectMeta {
        main_doc: "main.tex".into(),
        engine: "xetex".into(),
        ..ProjectMeta::default()
    };
    assert_eq!(resolve_for_compile(&latex).unwrap(), None);

    crate::config::set_typst_default_choice(Some("0.13.1".into())).unwrap();
    let unpinned = resolve_for_compile(&typst_meta(None)).unwrap().unwrap();
    assert_eq!(unpinned.path, downloaded);
    assert_eq!(
        compile_identity(&typst_meta(None), Some(&unpinned)),
        "typst 0.13.1"
    );
    assert_eq!(compile_identity(&latex, None), "xetex");
}

#[test]
fn a_missing_pin_fails_with_a_translatable_error_before_any_process_starts() {
    let _data = DataDir::new();
    let error = resolve_for_compile(&typst_meta(Some("0.12.0"))).unwrap_err();
    assert_app_error(&error, "typst_version_missing", "0.12.0");
    assert_eq!(
        crate::app_error::english(&error).as_deref(),
        Some("Typst 0.12.0 is not installed.")
    );

    let unknown = resolve_for_compile(&typst_meta(Some("0.9.0"))).unwrap_err();
    assert_app_error(&unknown, "typst_version_missing", "0.9.0");
}

#[test]
fn descriptors_name_the_pin_the_resolved_binary_and_a_missing_version() {
    let root = tempfile::tempdir().unwrap();
    let mut typst = toolchain(root.path());
    let fresh = || crate::document_engine::descriptor_for("typst", "main.typ").unwrap();

    let mut missing = fresh();
    typst.describe(&mut missing, Some("0.13.1"));
    assert_eq!(missing.typst_version.as_deref(), Some("0.13.1"));
    assert_eq!(missing.typst_resolved, None);
    assert_eq!(missing.typst_missing.as_deref(), Some("0.13.1"));

    fake_download(root.path(), "0.13.1");
    let mut installed = fresh();
    typst.describe(&mut installed, Some("0.13.1"));
    assert_eq!(installed.typst_missing, None);
    assert_eq!(
        installed.typst_resolved,
        Some(TypstResolvedDescriptor {
            version: "0.13.1".into(),
            source: TypstSource::Downloaded,
        })
    );

    let mut unpinned = fresh();
    typst.describe(&mut unpinned, None);
    assert_eq!(unpinned.typst_version, None);
    assert_eq!(
        unpinned.typst_resolved,
        Some(TypstResolvedDescriptor {
            version: "0.15.1".into(),
            source: TypstSource::Bundled,
        })
    );
    assert_eq!(unpinned.typst_missing, None);

    let json = serde_json::to_value(&installed).unwrap();
    assert_eq!(json["typst_version"], "0.13.1");
    assert_eq!(json["typst_resolved"]["source"], "downloaded");
    assert!(json.get("typst_missing").is_none());
}

#[test]
fn only_typst_descriptors_carry_version_details() {
    let _data = DataDir::new();
    let mut latex = crate::document_engine::descriptor_for("xetex", "main.tex").unwrap();
    let meta = ProjectMeta {
        main_doc: "main.tex".into(),
        engine: "xetex".into(),
        ..ProjectMeta::default()
    };
    describe_project(&mut latex, &meta);
    assert_eq!(latex.typst_version, None);
    assert_eq!(latex.typst_resolved, None);
    assert_eq!(latex.typst_missing, None);

    let mut typst = crate::document_engine::descriptor_for("typst", "main.typ").unwrap();
    describe_project(&mut typst, &typst_meta(Some("0.12.0")));
    assert_eq!(typst.typst_version.as_deref(), Some("0.12.0"));
    assert_eq!(typst.typst_missing.as_deref(), Some("0.12.0"));
}

#[test]
fn pins_must_name_a_catalog_bundled_or_system_version() {
    let root = tempfile::tempdir().unwrap();
    let mut typst = toolchain(root.path());
    assert_eq!(typst.accepted_pin(" 0.13.1 ").unwrap(), "0.13.1");
    assert_eq!(typst.accepted_pin("0.15.1").unwrap(), "0.15.1");
    assert_app_error(
        &typst.accepted_pin("0.10.0").unwrap_err(),
        "typst_toolchain.unknown_version",
        "0.10.0",
    );
    assert_app_error(
        &typst.accepted_pin("latest").unwrap_err(),
        "typst_toolchain.unknown_version",
        "latest",
    );
    typst.system = Some(system(Path::new("/usr/local/bin/typst"), "0.10.0"));
    assert_eq!(typst.accepted_pin("0.10.0").unwrap(), "0.10.0");
}

#[test]
fn the_default_must_be_installed_and_the_bundled_version_means_follow_the_app() {
    let root = tempfile::tempdir().unwrap();
    let typst = toolchain(root.path());
    assert_eq!(typst.default_choice_for(None).unwrap(), None);
    assert_eq!(typst.default_choice_for(Some(" ")).unwrap(), None);
    assert_eq!(typst.default_choice_for(Some("0.15.1")).unwrap(), None);
    assert_app_error(
        &typst.default_choice_for(Some("0.13.1")).unwrap_err(),
        "typst_version_missing",
        "0.13.1",
    );
    assert_app_error(
        &typst.default_choice_for(Some("0.9.0")).unwrap_err(),
        "typst_toolchain.unknown_version",
        "0.9.0",
    );
    fake_download(root.path(), "0.13.1");
    assert_eq!(
        typst.default_choice_for(Some("0.13.1")).unwrap().as_deref(),
        Some("0.13.1")
    );
}

#[test]
fn removal_is_limited_to_downloaded_versions_that_are_not_the_default_or_installing() {
    let root = tempfile::tempdir().unwrap();
    let mut typst = toolchain(root.path());
    typst.system = Some(system(Path::new("/usr/local/bin/typst"), "0.12.0"));
    fake_download(root.path(), "0.13.1");
    fake_download(root.path(), "0.14.2");

    for (version, code) in [
        ("0.15.1", "typst_toolchain.remove_default"),
        ("0.12.0", "typst_toolchain.remove_not_downloaded"),
        ("0.11.1", "typst_toolchain.remove_not_downloaded"),
    ] {
        assert_app_error(&typst.removable(version, None).unwrap_err(), code, version);
    }
    assert_app_error(
        &typst.removable("0.14.2", Some("0.14.2")).unwrap_err(),
        "typst_toolchain.busy",
        "0.14.2",
    );
    assert_eq!(
        typst.removable("0.14.2", Some("0.13.1")).unwrap(),
        root.path().join("toolchains").join("typst").join("0.14.2")
    );

    typst.default_choice = Some("0.13.1".into());
    assert_app_error(
        &typst.removable("0.13.1", None).unwrap_err(),
        "typst_toolchain.remove_default",
        "0.13.1",
    );
}

#[test]
fn removing_a_downloaded_version_deletes_its_folder_and_returns_the_status() {
    let data = DataDir::new();
    let binary = fake_download(&data.root, "0.14.2");
    let status = remove_version_blocking("0.14.2").unwrap();
    assert!(!binary.exists());
    assert!(!binary.parent().unwrap().exists());
    let row = status
        .versions
        .iter()
        .find(|entry| entry.version == "0.14.2")
        .unwrap();
    assert!(row.sources.is_empty());
    assert_app_error(
        &remove_version_blocking("0.14.2").unwrap_err(),
        "typst_toolchain.remove_not_downloaded",
        "0.14.2",
    );
}

fn fake_tinymist(root: &Path, text: &str) -> PathBuf {
    let directory = oleafly_core::typst_toolchain::tinymist_install_dir(root, &version(text));
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("tinymist"), format!("fake tinymist {text}")).unwrap();
    directory
}

#[test]
fn the_status_lists_tinymist_downloads_that_no_installed_typst_needs() {
    let root = tempfile::tempdir().unwrap();
    let mut typst = toolchain(root.path());
    fake_download(root.path(), "0.13.1");
    fake_tinymist(root.path(), "0.11.32");
    fake_tinymist(root.path(), "0.12.22");
    fake_tinymist(root.path(), "0.13.30");
    fake_tinymist(root.path(), "0.14.20");
    let tinymist_root = root.path().join("toolchains").join("tinymist");
    std::fs::create_dir_all(tinymist_root.join(".staging").join("0.10.0")).unwrap();
    std::fs::create_dir_all(tinymist_root.join("not-a-version")).unwrap();
    typst.system = Some(system(Path::new("/usr/local/bin/typst"), "0.11.1"));

    let status = typst.status(None);

    assert_eq!(status.unused_tinymist, ["0.14.20", "0.12.22"]);
    assert_eq!(
        serde_json::to_value(&status).unwrap()["unusedTinymist"],
        serde_json::json!(["0.14.20", "0.12.22"])
    );

    typst.default_choice = Some("0.14.2".into());
    assert_eq!(typst.status(None).unused_tinymist, ["0.12.22"]);
}

#[test]
fn removing_unused_tinymist_downloads_keeps_the_builds_installed_versions_use() {
    let root = tempfile::tempdir().unwrap();
    let typst = toolchain(root.path());
    fake_download(root.path(), "0.13.1");
    let used = fake_tinymist(root.path(), "0.13.30");
    let unused = fake_tinymist(root.path(), "0.12.22");

    let status = typst.remove_unused_tinymist().unwrap();

    assert!(used.join("tinymist").is_file());
    assert!(!unused.exists());
    assert!(status.unused_tinymist.is_empty());
}

#[test]
fn removing_a_typst_version_also_removes_the_tinymist_build_only_it_needed() {
    let root = tempfile::tempdir().unwrap();
    let mut typst = toolchain(root.path());
    fake_download(root.path(), "0.13.1");
    let typst_14 = fake_download(root.path(), "0.14.2");
    let tinymist_13 = fake_tinymist(root.path(), "0.13.30");
    let tinymist_14 = fake_tinymist(root.path(), "0.14.20");
    let tinymist_12 = fake_tinymist(root.path(), "0.12.22");

    let status = typst.remove_downloaded("0.14.2", None).unwrap();

    assert!(!typst_14.exists());
    assert!(!tinymist_14.exists());
    assert!(tinymist_13.exists());
    assert!(
        tinymist_12.exists(),
        "removing a version only removes the build for its own minor"
    );
    assert_eq!(status.unused_tinymist, ["0.12.22"]);

    typst.system = Some(system(Path::new("/usr/local/bin/typst"), "0.13.0"));
    typst.remove_downloaded("0.13.1", None).unwrap();
    assert!(
        tinymist_13.exists(),
        "a system Typst of the same minor still needs its Tinymist"
    );
}

#[test]
fn setting_the_default_persists_it_and_reports_it_back() {
    let data = DataDir::new();
    fake_download(&data.root, "0.13.1");
    let status = set_default_blocking(Some("0.13.1".into())).unwrap();
    assert_eq!(status.default_choice.as_deref(), Some("0.13.1"));
    assert_eq!(status.default_version, "0.13.1");
    assert_eq!(default_version(), "0.13.1");
    assert_app_error(
        &set_default_blocking(Some("0.12.0".into())).unwrap_err(),
        "typst_version_missing",
        "0.12.0",
    );
    assert_eq!(
        crate::config::typst_default_choice().as_deref(),
        Some("0.13.1")
    );
    let status = set_default_blocking(None).unwrap();
    assert_eq!(status.default_choice, None);
    assert_eq!(status.default_version, "0.15.1");
}

#[test]
fn installs_take_catalog_versions_for_this_computer_only() {
    let root = tempfile::tempdir().unwrap();
    let typst = toolchain(root.path());
    let (parsed, request) = typst.install_request("0.13.1").unwrap();
    let artifact = catalog().typst_artifact("0.13.1", target()).unwrap();
    assert_eq!(parsed, version("0.13.1"));
    assert_eq!(
        request.urls,
        [artifact.mirror_url.clone(), artifact.github_url.clone()]
    );
    assert_eq!(request.allowed_hosts, catalog().allowed_download_hosts);
    assert_eq!(request.archive_size, artifact.archive_size);
    assert_eq!(request.archive_sha256, artifact.archive_sha256);
    assert_eq!(request.archive_member, artifact.archive_member);
    assert_eq!(request.binary_sha256, artifact.binary_sha256);
    assert_eq!(
        request.install_dir,
        root.path().join("toolchains").join("typst").join("0.13.1")
    );
    assert_eq!(
        request.binary_name,
        if target().contains("windows") {
            "typst.exe"
        } else {
            "typst"
        }
    );

    for refused in ["0.10.0", "0.13.2"] {
        assert_app_error(
            &typst.install_request(refused).unwrap_err().to_string(),
            "typst_toolchain.not_offered",
            refused,
        );
    }
    let mut elsewhere = toolchain(root.path());
    elsewhere.target = None;
    assert_app_error(
        &elsewhere.install_request("0.13.1").unwrap_err(),
        "typst_toolchain.not_offered",
        "0.13.1",
    );
}

#[test]
fn one_install_runs_at_a_time_and_the_status_names_it() {
    let claim = InstallClaim::take("0.13.1").unwrap();
    assert_eq!(installing_version().as_deref(), Some("0.13.1"));
    assert_app_error(
        &InstallClaim::take("0.14.2").err().unwrap(),
        "typst_toolchain.busy",
        "0.13.1",
    );
    drop(claim);
    assert_eq!(installing_version(), None);
    drop(InstallClaim::take("0.14.2").unwrap());
}

#[test]
fn install_progress_carries_the_version_and_only_reports_phase_or_whole_percent_changes() {
    let sent = Arc::new(Mutex::new(Vec::new()));
    let cancel = CancelToken::new();
    let sink = {
        let sent = sent.clone();
        throttled_progress("0.13.1".into(), cancel.clone(), move |progress| {
            sent.lock().unwrap().push(progress);
            true
        })
    };
    let at = |phase, received_bytes| InstallProgress {
        phase,
        received_bytes,
        total_bytes: 1000,
    };
    for progress in [
        at(InstallPhase::Downloading, 0),
        at(InstallPhase::Downloading, 5),
        at(InstallPhase::Downloading, 9),
        at(InstallPhase::Downloading, 10),
        at(InstallPhase::Downloading, 19),
        at(InstallPhase::Downloading, 1000),
        at(InstallPhase::Verifying, 1000),
        at(InstallPhase::Verifying, 1000),
        at(InstallPhase::Extracting, 1000),
        at(InstallPhase::Done, 1000),
    ] {
        sink(progress);
    }
    let sent = sent.lock().unwrap();
    let marks: Vec<(InstallPhase, u64)> = sent
        .iter()
        .map(|progress| (progress.phase, progress.received_bytes))
        .collect();
    assert_eq!(
        marks,
        [
            (InstallPhase::Downloading, 0),
            (InstallPhase::Downloading, 10),
            (InstallPhase::Downloading, 1000),
            (InstallPhase::Verifying, 1000),
            (InstallPhase::Extracting, 1000),
            (InstallPhase::Done, 1000),
        ]
    );
    assert!(sent.iter().all(|progress| progress.version == "0.13.1"));
    assert!(!cancel.is_cancelled());
    assert_eq!(
        serde_json::to_value(&sent[1]).unwrap(),
        serde_json::json!({
            "version": "0.13.1",
            "phase": "downloading",
            "receivedBytes": 10,
            "totalBytes": 1000,
        })
    );
}

#[test]
fn an_install_stops_when_the_window_that_asked_for_it_is_gone() {
    let cancel = CancelToken::new();
    let sink = throttled_progress("0.13.1".into(), cancel.clone(), |_| false);
    sink(InstallProgress {
        phase: InstallPhase::Downloading,
        received_bytes: 0,
        total_bytes: 10,
    });
    assert!(cancel.is_cancelled());
}

#[test]
fn every_catalog_archive_maps_to_a_downloader_archive_kind() {
    for release in catalog().curated_typst_versions() {
        for artifact in release.targets.values() {
            assert!(archive_kind(artifact.archive_type).is_some(), "{release:?}");
        }
    }
    assert_eq!(archive_kind(ArchiveType::TarXz), Some(ArchiveKind::TarXz));
    assert_eq!(archive_kind(ArchiveType::Zip), Some(ArchiveKind::Zip));
}

#[test]
fn new_typst_projects_record_the_effective_default_version() {
    let _data = DataDir::new();
    assert_eq!(creation_pin("xetex"), None);
    assert_eq!(creation_pin("markdown"), None);
    let pin = creation_pin("typst").unwrap();
    assert_eq!(pin.version.as_deref(), Some("0.15.1"));
    assert!(pin.extra.is_empty());
    crate::config::set_typst_default_choice(Some("0.13.1".into())).unwrap();
    assert_eq!(
        creation_pin("Typst").unwrap().version.as_deref(),
        Some("0.13.1")
    );
}

#[test]
fn restricted_folders_keep_their_typst_pin_because_pins_are_versions_not_paths() {
    let _restricted = crate::trust::testing::restrict("typst-restricted-pin");
    let mut meta = typst_meta(Some("0.13.1"));
    meta.typst
        .as_mut()
        .unwrap()
        .extra
        .insert("font_paths".into(), serde_json::json!(["fonts"]));
    let restricted =
        crate::trust::restrict_compile_meta("typst-restricted-pin", meta.clone()).unwrap();
    assert_eq!(restricted.typst, meta.typst);
    assert_eq!(restricted.typst_version_pin(), Some("0.13.1"));
    assert_eq!(restricted.engine, "typst");
}

fn library_typst_project(id: &str, pin: Option<&str>) -> PathBuf {
    let root = crate::paths::create_project_dir(id).unwrap();
    std::fs::write(root.join("main.typ"), "= Hello\n\n$ x^2 $\n").unwrap();
    crate::project::write_meta_at(&root.join("project.json"), &typst_meta(pin)).unwrap();
    root
}

fn bundled_sidecar() -> Option<PathBuf> {
    crate::document_engine::resolve_bundled_sidecar(TYPST_SIDECAR).ok()
}

#[test]
fn snippets_render_with_the_project_pin_and_fall_back_to_the_default() {
    let data = DataDir::new();
    library_typst_project("snippet-missing", Some("0.12.0"));
    assert_app_error(
        &snippet_typst(Some("snippet-missing")).unwrap_err(),
        "typst_version_missing",
        "0.12.0",
    );
    let downloaded = fake_download(&data.root, "0.13.1");
    library_typst_project("snippet-downloaded", Some("0.13.1"));
    let resolved = snippet_typst(Some("snippet-downloaded")).unwrap();
    assert_eq!(resolved.path, downloaded);
    assert_eq!(resolved.source, TypstSource::Downloaded);

    let Some(sidecar) = bundled_sidecar() else {
        eprintln!("Typst sidecar is not staged; skipping the bundled snippet render");
        return;
    };
    library_typst_project("snippet-bundled", Some("0.15.1"));
    let bundled = snippet_typst(Some("snippet-bundled")).unwrap();
    assert_eq!(bundled.path, sidecar);
    assert_eq!(snippet_typst(None).unwrap().path, sidecar);
    let request: crate::typst_render::TypstSnippetRequest =
        serde_json::from_value(serde_json::json!({
            "source": "$ x^2 $",
            "format": "svg",
            "projectId": "snippet-bundled",
        }))
        .unwrap();
    let rendered = crate::typst_render::render_snippet(
        &bundled.path,
        &bundled.capabilities,
        None,
        &request,
        std::time::Duration::from_secs(60),
    )
    .unwrap();
    assert!(
        matches!(
            rendered,
            crate::typst_render::TypstSnippetRender::Rendered { .. }
        ),
        "{rendered:?}"
    );
}

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target).unwrap();
        }
    }
}

fn research_seed(destination: &Path) -> PathBuf {
    let seed = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("fixtures")
        .join("research-seeds")
        .join("journal-article-typst");
    let project = destination.join("journal-article-typst");
    copy_tree(&seed, &project);
    project
}

fn compile_seed_with(resolved: ResolvedTypst, workspace: &Path) -> Vec<u8> {
    let project = research_seed(workspace);
    let out = workspace.join("build");
    std::fs::create_dir_all(&out).unwrap();
    let options = crate::document_engine::CompileOptions {
        typst: Some(Arc::new(resolved)),
        ..Default::default()
    };
    let spec = tauri::async_runtime::block_on(crate::document_engine::prepare_compile_spec(
        DocumentEngineId::Typst,
        out.clone(),
        project.clone(),
        crate::document_engine::CompileTarget::Main {
            main_document: "main.typ",
        },
        options,
    ))
    .unwrap();
    let executable = match &spec.executable {
        crate::document_engine::EngineExecutable::BundledSidecar(name) => {
            crate::document_engine::resolve_bundled_sidecar(name).unwrap()
        }
        crate::document_engine::EngineExecutable::ExternalPath(path) => path.clone(),
    };
    let (log, code) = tauri::async_runtime::block_on(
        crate::document_engine::run_supervised_external(&executable, &spec.args, &spec.working_dir),
    )
    .unwrap();
    assert_eq!(code, Some(0), "{log}");
    std::fs::read(spec.artifacts.pdf.unwrap()).unwrap()
}

#[test]
fn the_journal_article_seed_compiles_with_the_bundled_typst_when_pinned_to_it() {
    let Some(sidecar) = bundled_sidecar() else {
        eprintln!("Typst sidecar is not staged; skipping the pinned seed compile");
        return;
    };
    let workspace = tempfile::tempdir().unwrap();
    let mut typst = toolchain(workspace.path());
    typst.bundled = Some(sidecar.clone());
    let resolved = typst.resolve(Some("0.15.1")).unwrap();
    assert_eq!(resolved.source, TypstSource::Bundled);
    assert_eq!(resolved.path, sidecar);
    let pdf = compile_seed_with(resolved, workspace.path());
    assert!(pdf.starts_with(b"%PDF"));
}

#[test]
#[ignore = "downloads Typst 0.13.1: cargo test -p oleafly typst_toolchain -- --ignored"]
fn a_downloaded_typst_installs_resolves_and_compiles_the_journal_article_seed() {
    let data = DataDir::new();
    let reports = Arc::new(Mutex::new(Vec::new()));
    let status = {
        let reports = reports.clone();
        tauri::async_runtime::block_on(install_version("0.13.1".into(), move |progress| {
            reports.lock().unwrap().push(progress);
            true
        }))
        .unwrap()
    };
    let row = status
        .versions
        .iter()
        .find(|entry| entry.version == "0.13.1")
        .unwrap();
    assert!(row.sources.contains(&TypstSource::Downloaded));
    assert_eq!(status.installing, None);
    let reports = reports.lock().unwrap();
    assert_eq!(reports.last().unwrap().phase, InstallPhase::Done);
    assert!(reports.iter().all(|progress| progress.version == "0.13.1"));
    assert!(data
        .root
        .join("toolchains")
        .join("typst")
        .join("0.13.1")
        .join(oleafly_core::typst_toolchain::INSTALLED_CACHE_FILE)
        .is_file());

    let resolved = resolve_for_compile(&typst_meta(Some("0.13.1")))
        .unwrap()
        .unwrap();
    assert_eq!(resolved.source, TypstSource::Downloaded);
    assert_eq!(
        oleafly_core::typst_toolchain::typst_version_of(
            &resolved.path,
            std::time::Duration::from_secs(10)
        ),
        Some(version("0.13.1"))
    );
    let workspace = tempfile::tempdir().unwrap();
    let pdf = compile_seed_with((*resolved).clone(), workspace.path());
    assert!(pdf.starts_with(b"%PDF"));
}
