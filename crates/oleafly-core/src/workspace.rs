use crate::tree::{slash_path, walk_source_tree};
use crate::{Engine, Error, ErrorKind, ProjectManifest, Result};
use serde::Serialize;
use std::collections::BTreeSet;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const MANIFEST_NAME: &str = "project.json";
const INTERNAL_DIR: &str = ".oleafly";
const BUILD_DIR: &str = "build";
static WRITE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug)]
pub struct Workspace {
    root: PathBuf,
    manifest: ProjectManifest,
}

#[derive(Clone, Debug, Default)]
pub struct InitOptions {
    pub name: Option<String>,
    pub main_document: Option<String>,
    pub engine: Option<Engine>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ProjectInfo {
    pub root: PathBuf,
    pub name: String,
    pub main_document: String,
    pub engine: Engine,
    pub build_directory: PathBuf,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DoctorStatus {
    Pass,
    Warning,
    Fail,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct DoctorCheck {
    pub name: String,
    pub status: DoctorStatus,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct DoctorReport {
    pub ok: bool,
    pub checks: Vec<DoctorCheck>,
}

impl Workspace {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let root = canonical_directory(path.as_ref())?;
        let manifest_path = root.join(MANIFEST_NAME);
        if !manifest_path.is_file() {
            return Err(Error::new(
                ErrorKind::NotInitialized,
                format!(
                    "{} is not an Oleafly project. Run `oleaflyc init` first",
                    root.display()
                ),
            ));
        }
        let content = std::fs::read_to_string(&manifest_path).map_err(|error| {
            Error::new(
                ErrorKind::Io,
                format!("failed to read {}: {error}", manifest_path.display()),
            )
        })?;
        let manifest: ProjectManifest = serde_json::from_str(&content).map_err(|error| {
            Error::new(
                ErrorKind::InvalidManifest,
                format!("invalid {}: {error}", manifest_path.display()),
            )
        })?;
        manifest.validate()?;
        let workspace = Self { root, manifest };
        workspace.resolve(&workspace.manifest.main_doc)?;
        Ok(workspace)
    }

    pub fn from_manifest(path: impl AsRef<Path>, manifest: ProjectManifest) -> Result<Self> {
        let root = canonical_directory(path.as_ref())?;
        manifest.validate()?;
        let workspace = Self { root, manifest };
        workspace.resolve(&workspace.manifest.main_doc)?;
        Ok(workspace)
    }

    pub fn init(path: impl AsRef<Path>, options: InitOptions) -> Result<Self> {
        let input = path.as_ref();
        if !input.exists() {
            std::fs::create_dir_all(input).map_err(|error| {
                Error::new(
                    ErrorKind::Io,
                    format!("failed to create {}: {error}", input.display()),
                )
            })?;
        }
        let root = canonical_directory(input)?;
        let manifest_path = root.join(MANIFEST_NAME);
        if manifest_path.exists() {
            return Err(Error::new(
                ErrorKind::InvalidInput,
                format!("{} already exists", manifest_path.display()),
            ));
        }
        let discovered = match options.main_document {
            Some(value) => Some(normalize_relative(&value)?),
            None => discover_main_document(&root)?,
        };
        let (main_document, engine) = match discovered {
            Some(main_document) => {
                let engine = options
                    .engine
                    .map_or_else(|| Engine::infer(&main_document), Ok)?;
                (main_document, engine)
            }
            None => {
                let engine = options.engine.unwrap_or(Engine::Tectonic);
                (engine.default_main_document().to_string(), engine)
            }
        };
        if !engine.accepts(&main_document) {
            return Err(Error::new(
                ErrorKind::InvalidInput,
                format!(
                    "engine `{}` cannot compile `{main_document}`",
                    engine.manifest_name()
                ),
            ));
        }
        let main_path = resolve_within(&root, &main_document)?;
        if !main_path.exists() {
            if let Some(parent) = main_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            write_new_file(&main_path, starter_document(engine))?;
        } else if !main_path.is_file() {
            return Err(Error::new(
                ErrorKind::InvalidInput,
                format!("main document is not a file: {}", main_path.display()),
            ));
        }
        let default_name = root
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("Oleafly project")
            .to_string();
        let manifest = ProjectManifest {
            name: options.name.unwrap_or(default_name),
            main_doc: main_document,
            engine: engine.manifest_name().to_string(),
            ..ProjectManifest::default()
        };
        manifest.validate()?;
        write_json_new(&manifest_path, &manifest)?;
        Self::open(root)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn manifest(&self) -> &ProjectManifest {
        &self.manifest
    }

    pub fn info(&self) -> Result<ProjectInfo> {
        Ok(ProjectInfo {
            root: self.root.clone(),
            name: self.manifest.name.clone(),
            main_document: self.manifest.main_doc.clone(),
            engine: self.manifest.engine()?,
            build_directory: self.build_dir_path(),
        })
    }

    pub fn resolve(&self, relative: &str) -> Result<PathBuf> {
        resolve_within(&self.root, relative)
    }

    pub fn main_document_path(&self) -> Result<PathBuf> {
        let path = self.resolve(&self.manifest.main_doc)?;
        if !path.is_file() {
            return Err(Error::new(
                ErrorKind::InvalidManifest,
                format!("main document does not exist: {}", path.display()),
            ));
        }
        Ok(path)
    }

    pub fn build_dir(&self) -> Result<PathBuf> {
        secure_build_directory(&self.root, true)
    }

    pub fn build_dir_path(&self) -> PathBuf {
        self.root.join(INTERNAL_DIR).join(BUILD_DIR)
    }

    pub fn clean(&self) -> Result<bool> {
        Self::clean_build_directory(&self.root)
    }

    pub fn clean_build_directory(path: impl AsRef<Path>) -> Result<bool> {
        let root = canonical_directory(path.as_ref())?;
        let internal = root.join(INTERNAL_DIR);
        if !internal.exists() {
            return Ok(false);
        }
        if !metadata_is_real_directory(&std::fs::symlink_metadata(&internal)?) {
            return Err(unsafe_directory("project data", &internal));
        }
        let build = internal.join(BUILD_DIR);
        if !build.exists() {
            return Ok(false);
        }
        if !metadata_is_real_directory(&std::fs::symlink_metadata(&build)?) {
            return Err(unsafe_directory("build path", &build));
        }
        std::fs::remove_dir_all(&build).map_err(|error| {
            Error::new(
                ErrorKind::Io,
                format!("failed to remove {}: {error}", build.display()),
            )
        })?;
        Ok(true)
    }

    pub fn ensure_build_directory(path: impl AsRef<Path>) -> Result<PathBuf> {
        let root = canonical_directory(path.as_ref())?;
        secure_build_directory(&root, true)
    }

    pub fn doctor(&self) -> DoctorReport {
        let mut checks = Vec::new();
        checks.push(DoctorCheck {
            name: "manifest".to_string(),
            status: DoctorStatus::Pass,
            message: format!("{} is valid", self.root.join(MANIFEST_NAME).display()),
        });
        match self.main_document_path() {
            Ok(path) => checks.push(DoctorCheck {
                name: "main_document".to_string(),
                status: DoctorStatus::Pass,
                message: path.display().to_string(),
            }),
            Err(error) => checks.push(DoctorCheck {
                name: "main_document".to_string(),
                status: DoctorStatus::Fail,
                message: error.to_string(),
            }),
        }
        match validate_build_location(&self.root) {
            Ok(()) => checks.push(DoctorCheck {
                name: "build_directory".to_string(),
                status: DoctorStatus::Pass,
                message: self.build_dir_path().display().to_string(),
            }),
            Err(error) => checks.push(DoctorCheck {
                name: "build_directory".to_string(),
                status: DoctorStatus::Fail,
                message: error.to_string(),
            }),
        }
        DoctorReport {
            ok: checks
                .iter()
                .all(|check| check.status != DoctorStatus::Fail),
            checks,
        }
    }
}

fn canonical_directory(path: &Path) -> Result<PathBuf> {
    let metadata = std::fs::metadata(path).map_err(|error| {
        Error::new(
            ErrorKind::InvalidInput,
            format!("cannot inspect {}: {error}", path.display()),
        )
    })?;
    if !metadata.is_dir() {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            format!("workspace is not a directory: {}", path.display()),
        ));
    }
    path.canonicalize().map_err(|error| {
        Error::new(
            ErrorKind::Io,
            format!("cannot resolve {}: {error}", path.display()),
        )
    })
}

fn normalize_relative(value: &str) -> Result<String> {
    if value.contains('\\') {
        return Err(Error::new(
            ErrorKind::UnsafePath,
            format!("project paths must use forward slashes: {value}"),
        ));
    }
    let path = Path::new(value);
    if value.trim().is_empty()
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(Error::new(
            ErrorKind::UnsafePath,
            format!("illegal project path: {value}"),
        ));
    }
    Ok(path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy()),
            Component::CurDir => None,
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/"))
}

fn resolve_within(root: &Path, relative: &str) -> Result<PathBuf> {
    let normalized = normalize_relative(relative)?;
    let joined = root.join(normalized);
    let real_root = root.canonicalize()?;
    let mut anchor = joined.as_path();
    while !anchor.exists() {
        anchor = anchor.parent().ok_or_else(|| {
            Error::new(
                ErrorKind::UnsafePath,
                format!("illegal project path: {relative}"),
            )
        })?;
    }
    let real_anchor = anchor.canonicalize()?;
    if !real_anchor.starts_with(&real_root) {
        return Err(Error::new(
            ErrorKind::UnsafePath,
            format!("project path escapes the workspace: {relative}"),
        ));
    }
    Ok(joined)
}

fn secure_build_directory(root: &Path, create: bool) -> Result<PathBuf> {
    let internal = root.join(INTERNAL_DIR);
    ensure_real_directory(&internal, create, "project data")?;
    let build = internal.join(BUILD_DIR);
    ensure_real_directory(&build, create, "build")?;
    let canonical_root = root.canonicalize()?;
    let canonical_build = build.canonicalize()?;
    if !canonical_build.starts_with(canonical_root.join(INTERNAL_DIR)) {
        return Err(Error::new(
            ErrorKind::UnsafePath,
            "build directory escapes the workspace",
        ));
    }
    Ok(canonical_build)
}

fn validate_build_location(root: &Path) -> Result<()> {
    let internal = root.join(INTERNAL_DIR);
    validate_existing_directory(&internal, "project data path")?;
    validate_existing_directory(&internal.join(BUILD_DIR), "build path")
}

fn validate_existing_directory(path: &Path, label: &str) -> Result<()> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata_is_real_directory(&metadata) => Ok(()),
        Ok(_) => Err(unsafe_directory(label, path)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn ensure_real_directory(path: &Path, create: bool, label: &str) -> Result<()> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata_is_real_directory(&metadata) => Ok(()),
        Ok(_) => Err(unsafe_directory(&format!("{label} path"), path)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && create => {
            std::fs::create_dir(path).map_err(|error| {
                Error::new(
                    ErrorKind::Io,
                    format!("failed to create {}: {error}", path.display()),
                )
            })
        }
        Err(error) => Err(Error::new(
            ErrorKind::Io,
            format!("failed to inspect {}: {error}", path.display()),
        )),
    }
}

fn metadata_is_real_directory(metadata: &std::fs::Metadata) -> bool {
    metadata.is_dir() && !metadata.file_type().is_symlink() && !metadata_is_reparse_point(metadata)
}

fn unsafe_directory(label: &str, path: &Path) -> Error {
    Error::new(
        ErrorKind::UnsafePath,
        format!("{label} is not a real directory: {}", path.display()),
    )
}

#[cfg(windows)]
fn metadata_is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn metadata_is_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
}

fn discover_main_document(root: &Path) -> Result<Option<String>> {
    for preferred in ["main.tex", "main.typ", "main.md"] {
        if root.join(preferred).is_file() {
            return Ok(Some(preferred.to_string()));
        }
    }
    let mut found = BTreeSet::new();
    discover_sources(root, &mut found)?;
    match found.len() {
        0 => Ok(None),
        1 => Ok(found.into_iter().next()),
        _ => Err(Error::new(
            ErrorKind::InvalidInput,
            "multiple possible main documents found. Pass --main",
        )),
    }
}

fn discover_sources(root: &Path, found: &mut BTreeSet<String>) -> Result<()> {
    walk_source_tree(root, "source discovery", &mut |relative, _| {
        let value = slash_path(relative);
        if Engine::infer(&value).is_ok() {
            found.insert(value);
        }
        Ok(())
    })
}

fn starter_document(engine: Engine) -> &'static [u8] {
    match engine {
        Engine::Tectonic | Engine::Latexmk => {
            b"\\documentclass{article}\n\\begin{document}\nHello from Oleafly.\n\\end{document}\n"
        }
        Engine::Typst => b"= Hello from Oleafly\n",
        Engine::Markdown => b"# Hello from Oleafly\n",
    }
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

fn write_json_new(path: &Path, value: &ProjectManifest) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(value)?;
    let parent = path
        .parent()
        .ok_or_else(|| Error::new(ErrorKind::InvalidInput, "manifest path has no parent"))?;
    let sequence = WRITE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let staging = parent.join(format!(
        ".project.json.{}.{}.tmp",
        std::process::id(),
        sequence
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staging)?;
    if let Err(error) = (|| -> std::io::Result<()> {
        file.write_all(&bytes)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        std::fs::hard_link(&staging, path)?;
        std::fs::remove_file(&staging)?;
        #[cfg(unix)]
        std::fs::File::open(parent)?.sync_all()?;
        Ok(())
    })() {
        let _ = std::fs::remove_file(&staging);
        return Err(error.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn init_creates_a_compatible_project_without_overwriting() {
        let directory = TempDir::new().unwrap();
        let workspace = Workspace::init(directory.path(), InitOptions::default()).unwrap();
        assert_eq!(workspace.manifest().main_doc, "main.tex");
        assert_eq!(workspace.manifest().engine, "xetex");
        assert!(directory.path().join("main.tex").is_file());
        let error = Workspace::init(directory.path(), InitOptions::default()).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidInput);
    }

    #[test]
    fn init_uses_the_selected_engines_default_document() {
        for (engine, document) in [
            (Engine::Tectonic, "main.tex"),
            (Engine::Latexmk, "main.tex"),
            (Engine::Typst, "main.typ"),
            (Engine::Markdown, "main.md"),
        ] {
            let directory = TempDir::new().unwrap();
            let workspace = Workspace::init(
                directory.path(),
                InitOptions {
                    engine: Some(engine),
                    ..InitOptions::default()
                },
            )
            .unwrap();
            assert_eq!(workspace.manifest().main_doc, document);
            assert!(directory.path().join(document).is_file());
        }
    }

    #[test]
    fn init_refuses_ambiguous_source_discovery() {
        let directory = TempDir::new().unwrap();
        std::fs::write(directory.path().join("paper.tex"), "").unwrap();
        std::fs::write(directory.path().join("notes.md"), "").unwrap();
        let error = Workspace::init(directory.path(), InitOptions::default()).unwrap_err();
        assert!(error.to_string().contains("multiple possible"));
    }

    #[test]
    fn init_discovers_one_nested_source_and_ignores_generated_trees() {
        let directory = TempDir::new().unwrap();
        std::fs::create_dir_all(directory.path().join("chapters")).unwrap();
        std::fs::write(directory.path().join("chapters/paper.typ"), "= Existing").unwrap();
        for ignored in crate::GENERATED_DIRECTORIES {
            std::fs::create_dir(directory.path().join(ignored)).unwrap();
            std::fs::write(directory.path().join(ignored).join("ignored.tex"), "").unwrap();
        }

        let workspace = Workspace::init(
            directory.path(),
            InitOptions {
                name: Some("Nested paper".into()),
                ..InitOptions::default()
            },
        )
        .unwrap();

        assert_eq!(workspace.manifest().name, "Nested paper");
        assert_eq!(workspace.manifest().main_doc, "chapters/paper.typ");
        assert_eq!(workspace.manifest().engine().unwrap(), Engine::Typst);
        assert_eq!(
            std::fs::read_to_string(directory.path().join("chapters/paper.typ")).unwrap(),
            "= Existing"
        );
    }

    #[test]
    fn init_validates_custom_document_before_writing_project_files() {
        let directory = TempDir::new().unwrap();
        let error = Workspace::init(
            directory.path(),
            InitOptions {
                main_document: Some("paper.md".into()),
                engine: Some(Engine::Typst),
                ..InitOptions::default()
            },
        )
        .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidInput);
        assert!(!directory.path().join(MANIFEST_NAME).exists());
        assert!(!directory.path().join("paper.md").exists());

        std::fs::create_dir(directory.path().join("paper.typ")).unwrap();
        let error = Workspace::init(
            directory.path(),
            InitOptions {
                main_document: Some("paper.typ".into()),
                ..InitOptions::default()
            },
        )
        .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidInput);
        assert!(!directory.path().join(MANIFEST_NAME).exists());
    }

    #[test]
    fn init_creates_a_missing_nested_workspace() {
        let directory = TempDir::new().unwrap();
        let root = directory.path().join("projects/paper");
        let workspace = Workspace::init(
            &root,
            InitOptions {
                main_document: Some("src/main.md".into()),
                ..InitOptions::default()
            },
        )
        .unwrap();
        assert_eq!(workspace.root(), root.canonicalize().unwrap());
        assert!(root.join("src/main.md").is_file());
    }

    #[test]
    fn open_reports_non_directories_and_invalid_manifests() {
        let directory = TempDir::new().unwrap();
        let file = directory.path().join("not-a-directory");
        std::fs::write(&file, "file").unwrap();
        assert_eq!(
            Workspace::open(&file).unwrap_err().kind(),
            ErrorKind::InvalidInput
        );
        assert_eq!(
            Workspace::open(directory.path()).unwrap_err().kind(),
            ErrorKind::NotInitialized
        );

        std::fs::write(directory.path().join(MANIFEST_NAME), "not json").unwrap();
        assert_eq!(
            Workspace::open(directory.path()).unwrap_err().kind(),
            ErrorKind::InvalidManifest
        );
    }

    #[test]
    fn workspace_rejects_manifest_traversal() {
        let directory = TempDir::new().unwrap();
        std::fs::write(
            directory.path().join(MANIFEST_NAME),
            r#"{"main_doc":"../escape.tex","engine":"xetex"}"#,
        )
        .unwrap();
        let error = Workspace::open(directory.path()).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::UnsafePath);
    }

    #[cfg(unix)]
    #[test]
    fn workspace_rejects_a_source_symlink_escape() {
        use std::os::unix::fs::symlink;

        let directory = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        std::fs::write(outside.path().join("paper.tex"), "outside").unwrap();
        symlink(outside.path(), directory.path().join("linked")).unwrap();
        std::fs::write(
            directory.path().join(MANIFEST_NAME),
            r#"{"main_doc":"linked/paper.tex","engine":"xetex"}"#,
        )
        .unwrap();
        let error = Workspace::open(directory.path()).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::UnsafePath);
    }

    #[test]
    fn clean_removes_only_the_build_directory() {
        let directory = TempDir::new().unwrap();
        let workspace = Workspace::init(directory.path(), InitOptions::default()).unwrap();
        let build = workspace.build_dir().unwrap();
        std::fs::write(build.join("output.pdf"), "pdf").unwrap();
        std::fs::write(directory.path().join(INTERNAL_DIR).join("keep"), "keep").unwrap();
        assert!(workspace.clean().unwrap());
        assert!(!build.exists());
        assert!(directory.path().join(INTERNAL_DIR).join("keep").exists());
        assert!(!workspace.clean().unwrap());
    }

    #[test]
    fn build_cleanup_supports_legacy_projects_without_a_manifest() {
        let directory = TempDir::new().unwrap();
        let build = Workspace::ensure_build_directory(directory.path()).unwrap();
        std::fs::write(build.join("output.pdf"), "pdf").unwrap();
        assert!(Workspace::clean_build_directory(directory.path()).unwrap());
        assert!(!build.exists());
    }

    #[test]
    fn in_memory_manifest_supports_desktop_adapters() {
        let directory = TempDir::new().unwrap();
        std::fs::write(directory.path().join("paper.typ"), "= Paper").unwrap();
        let workspace = Workspace::from_manifest(
            directory.path(),
            ProjectManifest {
                main_doc: "paper.typ".into(),
                engine: "typst".into(),
                ..ProjectManifest::default()
            },
        )
        .unwrap();
        assert!(!directory.path().join(MANIFEST_NAME).exists());
        assert_eq!(workspace.prepare_build().unwrap().engine(), Engine::Typst);
    }

    #[test]
    fn desktop_tex_flavor_defaults_share_the_cli_build_contract() {
        for (engine, flavor, expected) in [
            ("latexmk", " auto ", None),
            ("latexmk", " xelatex ", Some("xelatex")),
            ("xetex", "lualatex", None),
        ] {
            let directory = TempDir::new().unwrap();
            std::fs::write(
                directory.path().join("main.tex"),
                "\\documentclass{article}",
            )
            .unwrap();
            std::fs::write(
                directory.path().join(MANIFEST_NAME),
                format!(r#"{{"main_doc":"main.tex","engine":"{engine}","tex_flavor":"{flavor}"}}"#),
            )
            .unwrap();

            let workspace = Workspace::open(directory.path()).unwrap();
            assert_eq!(workspace.prepare_build().unwrap().tex_flavor(), expected);
        }
    }

    #[test]
    fn doctor_does_not_create_project_data() {
        let directory = TempDir::new().unwrap();
        let workspace = Workspace::init(directory.path(), InitOptions::default()).unwrap();
        let report = workspace.doctor();
        assert!(report.ok);
        assert!(report
            .checks
            .iter()
            .all(|check| check.status == DoctorStatus::Pass));
        assert!(!directory.path().join(INTERNAL_DIR).exists());
    }

    #[test]
    fn doctor_reports_missing_source_and_an_unsafe_build_path() {
        let directory = TempDir::new().unwrap();
        let workspace = Workspace::init(directory.path(), InitOptions::default()).unwrap();
        std::fs::remove_file(workspace.main_document_path().unwrap()).unwrap();
        std::fs::create_dir(directory.path().join(INTERNAL_DIR)).unwrap();
        std::fs::write(
            directory.path().join(INTERNAL_DIR).join(BUILD_DIR),
            "not a directory",
        )
        .unwrap();

        let report = workspace.doctor();
        assert!(!report.ok);
        assert_eq!(
            report
                .checks
                .iter()
                .filter(|check| check.status == DoctorStatus::Fail)
                .count(),
            2
        );
        assert_eq!(
            workspace.build_dir().unwrap_err().kind(),
            ErrorKind::UnsafePath
        );
        assert_eq!(workspace.clean().unwrap_err().kind(), ErrorKind::UnsafePath);
    }

    #[test]
    fn project_data_must_be_a_real_directory() {
        let directory = TempDir::new().unwrap();
        let workspace = Workspace::init(directory.path(), InitOptions::default()).unwrap();
        std::fs::write(directory.path().join(INTERNAL_DIR), "not a directory").unwrap();

        assert_eq!(
            workspace.build_dir().unwrap_err().kind(),
            ErrorKind::UnsafePath
        );
        assert_eq!(workspace.clean().unwrap_err().kind(), ErrorKind::UnsafePath);
        assert!(!workspace.doctor().ok);
    }

    #[test]
    fn project_paths_are_normalized_and_confined() {
        assert_eq!(
            normalize_relative("./chapters/one.tex").unwrap(),
            "chapters/one.tex"
        );
        for unsafe_path in ["", "   ", "../escape.tex", "chapters\\one.tex"] {
            assert_eq!(
                normalize_relative(unsafe_path).unwrap_err().kind(),
                ErrorKind::UnsafePath
            );
        }

        let absolute = std::env::current_dir().unwrap().join("paper.tex");
        assert_eq!(
            normalize_relative(&absolute.to_string_lossy())
                .unwrap_err()
                .kind(),
            ErrorKind::UnsafePath
        );
    }

    #[test]
    fn concurrent_initialization_has_one_winner() {
        use std::sync::{Arc, Barrier};
        use std::thread;

        let directory = TempDir::new().unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let workers = (0..2)
            .map(|_| {
                let root = directory.path().to_path_buf();
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    Workspace::init(root, InitOptions::default())
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        let results = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        Workspace::open(directory.path()).unwrap();
        let staging = std::fs::read_dir(directory.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .any(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"));
        assert!(!staging);
    }

    #[cfg(unix)]
    #[test]
    fn build_directory_refuses_symlink_escape() {
        use std::os::unix::fs::symlink;
        let directory = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let workspace = Workspace::init(directory.path(), InitOptions::default()).unwrap();
        std::fs::create_dir(directory.path().join(INTERNAL_DIR)).unwrap();
        symlink(
            outside.path(),
            directory.path().join(INTERNAL_DIR).join(BUILD_DIR),
        )
        .unwrap();
        let error = workspace.build_dir().unwrap_err();
        assert_eq!(error.kind(), ErrorKind::UnsafePath);
    }
}
