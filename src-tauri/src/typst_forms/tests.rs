use super::*;
use oleafly_core::typst_forms::DiagnosticCode;
use std::fs;
use std::path::PathBuf;

const PACKAGE: &str =
    include_str!("../../../test/fixtures/typst-forms/packages/local/acme-report/0.1.0/typst.toml");
const PROJECT: &str = include_str!("../../../test/fixtures/typst-forms/project/oleafly-forms.toml");
const BOM: &str = include_str!("../../../test/fixtures/typst-forms/bad/bom.toml");
const GOLDEN: &str = include_str!("../../../test/fixtures/typst-forms/expected/catalog.json");
const ACME: &str = "@local/acme-report:0.1.0";
const VENDORED_ACME: &str = "typst-packages/local/acme-report/0.1.0/typst.toml";

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn install(root: &Path, spec: &str, manifest: &str) -> PathBuf {
    let directory = root.join(PackageSpec::parse(spec).unwrap().relative_dir());
    write(&directory.join(PACKAGE_MANIFEST), manifest);
    directory
}

fn catalog(root: &Path, dirs: &TypstPackageDirs, packages: &[&str]) -> FormCatalog {
    let packages: Vec<String> = packages.iter().map(|spec| (*spec).to_owned()).collect();
    assemble_catalog(read_sources(root, dirs, &packages))
}

fn ids(catalog: &FormCatalog) -> Vec<&str> {
    catalog.forms.iter().map(|form| form.id.as_str()).collect()
}

fn codes(catalog: &FormCatalog) -> Vec<(&str, DiagnosticCode)> {
    catalog
        .diagnostics
        .iter()
        .map(|diagnostic| (diagnostic.source.as_str(), diagnostic.code))
        .collect()
}

fn renamed(label: &str) -> String {
    PACKAGE.replace("label = \"Cover page\"", &format!("label = \"{label}\""))
}

fn cover_label(catalog: &FormCatalog) -> &str {
    &catalog
        .forms
        .iter()
        .find(|form| form.id == "pkg:@local/acme-report:0.1.0#cover-page")
        .unwrap()
        .label
}

fn assert_golden(catalog: &FormCatalog) {
    let golden: serde_json::Value = serde_json::from_str(GOLDEN).unwrap();
    let actual = serde_json::to_value(catalog).unwrap();
    assert_eq!(actual["forms"], golden["forms"]);
    assert_eq!(actual["diagnostics"], golden["diagnostics"]);
}

#[test]
fn the_fixture_project_reads_as_the_golden_catalog() {
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let dirs = TypstPackageDirs::app(data.path());
    install(&dirs.package_path, ACME, PACKAGE);
    write(&project.path().join(PROJECT_FORMS_FILE), PROJECT);

    let catalog = catalog(project.path(), &dirs, &[ACME]);
    println!("{}", serde_json::to_string_pretty(&catalog).unwrap());
    assert_golden(&catalog);
    assert_eq!(catalog.watch, [PROJECT_FORMS_FILE]);
}

#[test]
fn packages_are_read_from_where_the_compiler_finds_them() {
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let shared = TypstPackageDirs::for_project(data.path(), project.path(), false);
    let vendoring = TypstPackageDirs::for_project(data.path(), project.path(), true);

    install(&shared.cache_path, ACME, &renamed("From the cache"));
    let read = catalog(project.path(), &shared, &[ACME]);
    assert_eq!(cover_label(&read), "From the cache");

    install(
        &shared.package_path,
        ACME,
        &renamed("From the package path"),
    );
    let read = catalog(project.path(), &shared, &[ACME]);
    assert_eq!(cover_label(&read), "From the package path");
    assert_eq!(read.watch, [PROJECT_FORMS_FILE]);

    // Vendoring swaps the app package path for the project's folder, as the
    // compiler and Tinymist see it, so only the shared cache is still read.
    let read = catalog(project.path(), &vendoring, &[ACME]);
    assert_eq!(cover_label(&read), "From the cache");
    assert_eq!(read.watch, [PROJECT_FORMS_FILE, VENDORED_ACME]);

    install(&vendoring.package_path, ACME, &renamed("Vendored"));
    let read = catalog(project.path(), &vendoring, &[ACME]);
    assert_eq!(cover_label(&read), "Vendored");
    assert_eq!(read.watch, [PROJECT_FORMS_FILE, VENDORED_ACME]);

    let read = catalog(project.path(), &shared, &[ACME]);
    assert_eq!(cover_label(&read), "From the package path");

    fs::remove_dir_all(&shared.cache_path).unwrap();
    fs::remove_dir_all(&vendoring.package_path).unwrap();
    let read = catalog(project.path(), &vendoring, &[ACME]);
    assert!(read.forms.is_empty(), "{:?}", ids(&read));
    assert!(read.diagnostics.is_empty());
}

#[test]
fn package_dir_prefers_the_package_path_and_ignores_files() {
    let data = tempfile::tempdir().unwrap();
    let dirs = TypstPackageDirs::app(data.path());
    let spec = PackageSpec::parse(ACME).unwrap();
    assert_eq!(package_dir(&dirs, &spec), None);
    write(&dirs.cache_path.join(spec.relative_dir()), "not a folder");
    assert_eq!(package_dir(&dirs, &spec), None);
    let installed = install(&dirs.package_path, ACME, PACKAGE);
    assert_eq!(package_dir(&dirs, &spec), Some(installed));
}

#[test]
fn missing_files_and_packages_are_silent() {
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let dirs = TypstPackageDirs::app(data.path());
    let read = catalog(project.path(), &dirs, &[ACME, "@preview/absent:1.0.0"]);
    assert!(read.forms.is_empty());
    assert!(read.diagnostics.is_empty());
    assert_eq!(read.watch, [PROJECT_FORMS_FILE]);

    let nothing = catalog(project.path(), &dirs, &[]);
    fs::create_dir(project.path().join(PROJECT_FORMS_FILE)).unwrap();
    assert_eq!(catalog(project.path(), &dirs, &[]), nothing);
}

#[test]
fn an_oversized_file_is_refused_without_being_read() {
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let dirs = TypstPackageDirs::app(data.path());
    let oversized = |path: &Path| {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let file = fs::File::create(path).unwrap();
        file.set_len(257 * 1024).unwrap();
        // Unreadable to anyone but root: reading it would report Unreadable.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o000)).unwrap();
        }
    };
    oversized(&project.path().join(PROJECT_FORMS_FILE));
    oversized(
        &dirs
            .package_path
            .join("local/acme-report/0.1.0")
            .join(PACKAGE_MANIFEST),
    );
    let read = catalog(project.path(), &dirs, &[ACME]);
    assert!(read.forms.is_empty());
    assert_eq!(
        codes(&read),
        [
            (PROJECT_FORMS_FILE, DiagnosticCode::FileTooLarge),
            (ACME, DiagnosticCode::FileTooLarge),
        ]
    );
    assert!(read.diagnostics[0].detail.contains("263168 bytes"));

    let limit = project.path().join("limit.toml");
    write(
        &limit,
        &format!("{PROJECT}#{}", "x".repeat(256 * 1024 - PROJECT.len() - 1)),
    );
    assert!(matches!(read_text(&limit), SourceText::Text(_)));
}

#[test]
fn a_bom_or_non_utf8_project_file_is_handled() {
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let dirs = TypstPackageDirs::app(data.path());
    write(&project.path().join(PROJECT_FORMS_FILE), BOM);
    let read = catalog(project.path(), &dirs, &[]);
    assert_eq!(ids(&read), ["mod:template/memo.typ#memo-header"]);
    assert!(read.diagnostics.is_empty());

    fs::write(project.path().join(PROJECT_FORMS_FILE), b"schema = \xff\n").unwrap();
    let read = catalog(project.path(), &dirs, &[]);
    assert_eq!(
        codes(&read),
        [(PROJECT_FORMS_FILE, DiagnosticCode::Unreadable)]
    );
    assert_eq!(
        read.diagnostics[0].detail,
        "The file could not be read: it is not UTF-8 text."
    );
}

#[cfg(unix)]
#[test]
fn a_project_file_linked_from_outside_the_project_is_not_read() {
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let dirs = TypstPackageDirs::app(data.path());
    let outside = data.path().join("elsewhere.toml");
    write(&outside, PROJECT);
    std::os::unix::fs::symlink(&outside, project.path().join(PROJECT_FORMS_FILE)).unwrap();
    let read = catalog(project.path(), &dirs, &[]);
    assert!(read.forms.is_empty());
    assert_eq!(
        codes(&read),
        [(PROJECT_FORMS_FILE, DiagnosticCode::Unreadable)]
    );
}

#[test]
fn only_the_exact_file_name_is_read() {
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let dirs = TypstPackageDirs::app(data.path());
    write(&project.path().join("Oleafly-Forms.toml"), PROJECT);
    let read = catalog(project.path(), &dirs, &[]);
    assert!(read.forms.is_empty(), "{:?}", ids(&read));
    assert!(read.diagnostics.is_empty());
    assert_eq!(read.watch, [PROJECT_FORMS_FILE]);
    assert_eq!(
        read,
        catalog(tempfile::tempdir().unwrap().path(), &dirs, &[])
    );
}

#[test]
fn a_package_name_with_capitals_gets_its_forms() {
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let dirs = TypstPackageDirs::for_project(data.path(), project.path(), true);
    let spec = "@local/AcmeReport:1.0.0";
    install(&dirs.package_path, spec, PACKAGE);
    let read = catalog(project.path(), &dirs, &[spec]);
    assert!(
        ids(&read).contains(&"pkg:@local/AcmeReport:1.0.0#cover-page"),
        "{:?}",
        ids(&read)
    );
    assert_eq!(codes(&read), [(spec, DiagnosticCode::BuiltinName)]);
    assert_eq!(
        read.watch,
        [
            PROJECT_FORMS_FILE,
            "typst-packages/local/AcmeReport/1.0.0/typst.toml"
        ]
    );
}

#[test]
fn typst_before_0_12_reads_only_its_own_package_folders() {
    let capabilities = oleafly_core::typst_toolchain::capabilities_for;
    let data = Path::new("/home/me/.local/share");
    let cache = Path::new("/home/me/.cache");
    let typst_own = TypstPackageDirs {
        package_path: data.join("typst").join("packages"),
        cache_path: cache.join("typst").join("packages"),
    };
    for vendor in [false, true] {
        let configured =
            TypstPackageDirs::for_project(Path::new("/data"), Path::new("/project"), vendor);
        let pick = |version: &str, data: Option<&Path>, cache: Option<&Path>| {
            compiler_package_dirs(
                configured.clone(),
                capabilities(version),
                data.map(Path::to_path_buf),
                cache.map(Path::to_path_buf),
            )
        };
        for version in ["0.12.0", "0.13.1", "0.15.1"] {
            assert_eq!(pick(version, Some(data), Some(cache)), configured);
        }
        assert_eq!(pick("0.11.1", Some(data), Some(cache)), typst_own);
        assert_eq!(pick("0.11.1", None, Some(cache)), configured);
        assert_eq!(pick("0.11.1", Some(data), None), configured);
    }
}

#[test]
fn requests_are_read_once_each_in_the_order_asked() {
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let dirs = TypstPackageDirs::app(data.path());
    install(&dirs.package_path, ACME, PACKAGE);
    install(
        &dirs.cache_path,
        "@preview/badges:1.0.0",
        "[tool.oleafly]\nschema = 1\n\n[[tool.oleafly.forms]]\nfunction = \"badge\"\nfields = [{ arg = 0, kind = \"text\", label = \"Text\" }]\n",
    );
    write(&project.path().join(PROJECT_FORMS_FILE), PROJECT);

    let read = catalog(
        project.path(),
        &dirs,
        &[
            "@preview/badges:1.0.0",
            "@local/acme-report:0.1",
            ACME,
            "@preview/badges:1.0.0",
            "nonsense",
            "@local/acme-report:0.1",
        ],
    );
    assert_eq!(
        ids(&read),
        [
            "mod:template/memo.typ#memo-header",
            "pkg:@preview/badges:1.0.0#badge",
            "pkg:@local/acme-report:0.1.0#cover-page",
            "pkg:@local/acme-report:0.1.0#info-box",
            "pkg:@local/acme-report:0.1.0#status-badge",
            "pkg:@local/acme-report:0.1.0#sign-off",
            "pkg:@local/acme-report:0.1.0#table",
        ]
    );
    assert_eq!(
        codes(&read),
        [
            ("@local/acme-report:0.1", DiagnosticCode::InvalidPackageSpec),
            (ACME, DiagnosticCode::BuiltinName),
            ("nonsense", DiagnosticCode::InvalidPackageSpec),
        ]
    );
}

fn library_project(library: &crate::collab::testing::TempLibrary, id: &str, main: &str) -> PathBuf {
    let root = library.project(id, &[(main, "= Hello\n"), (PROJECT_FORMS_FILE, PROJECT)]);
    let meta = crate::project::ProjectMeta {
        name: id.into(),
        main_doc: main.into(),
        engine: if main.ends_with(".typ") {
            "typst"
        } else {
            "tectonic"
        }
        .into(),
        ..crate::project::ProjectMeta::default()
    };
    crate::project::write_meta_at(&root.join("project.json"), &meta).unwrap();
    root
}

#[test]
fn the_command_reads_a_library_project_like_its_compile() {
    let library = crate::collab::testing::TempLibrary::new();
    let app = TypstPackageDirs::app(&crate::paths::oleafly_root().unwrap());
    install(&app.package_path, ACME, PACKAGE);
    library_project(&library, "forms-typst", "main.typ");
    library_project(&library, "forms-latex", "main.tex");
    let packages = vec![ACME.to_owned()];

    let read = catalog_blocking("forms-typst", &packages).unwrap();
    assert_golden(&read);
    assert_eq!(read.watch, [PROJECT_FORMS_FILE]);

    let empty = catalog_blocking("forms-latex", &packages).unwrap();
    assert!(empty.forms.is_empty());
    assert!(empty.diagnostics.is_empty());
    assert!(empty.watch.is_empty());
    assert_eq!(empty.version, assemble_catalog(Vec::new()).version);

    let vendored = crate::project::read_meta("forms-typst").map(|mut meta| {
        crate::typst_packages::set_vendor_flag(&mut meta, true);
        meta
    });
    let root = crate::project_location::locate("forms-typst").unwrap().root;
    crate::project::write_meta_at(&root.join("project.json"), &vendored.unwrap()).unwrap();
    let read = catalog_blocking("forms-typst", &packages).unwrap();
    assert_eq!(ids(&read), ["mod:template/memo.typ#memo-header"]);
    assert_eq!(read.watch, [PROJECT_FORMS_FILE, VENDORED_ACME]);

    assert!(catalog_blocking("forms-missing", &packages).is_err());
}

#[test]
fn the_command_skips_folders_typst_0_11_never_reads() {
    let library = crate::collab::testing::TempLibrary::new();
    let root = library_project(&library, "forms-typst-0-11", "main.typ");
    let mut meta = crate::project::read_meta("forms-typst-0-11").unwrap();
    meta.set_typst_version_pin(Some("0.11.1".into()));
    crate::typst_packages::set_vendor_flag(&mut meta, true);
    crate::project::write_meta_at(&root.join("project.json"), &meta).unwrap();
    let app = TypstPackageDirs::app(&crate::paths::oleafly_root().unwrap());
    install(&app.package_path, ACME, &renamed("From the app folder"));
    install(
        &root.join(crate::typst_packages::VENDOR_DIR),
        ACME,
        &renamed("Vendored"),
    );

    // The real data and cache folders are only read, and hold no such package
    // unless someone installed one by hand.
    let read = catalog_blocking("forms-typst-0-11", &[ACME.to_owned()]).unwrap();
    assert!(ids(&read).contains(&"mod:template/memo.typ#memo-header"));
    assert!(
        read.forms
            .iter()
            .all(|form| form.label != "Vendored" && form.label != "From the app folder"),
        "{:?}",
        ids(&read)
    );
    assert_eq!(read.watch, [PROJECT_FORMS_FILE]);
}
