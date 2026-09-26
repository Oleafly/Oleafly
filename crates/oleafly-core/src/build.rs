use crate::{Engine, Result, Workspace};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct PreparedBuild {
    project_root: PathBuf,
    main_document: String,
    source_path: PathBuf,
    build_directory: PathBuf,
    compile_directory: PathBuf,
    engine: Engine,
    tex_flavor: Option<String>,
}

impl PreparedBuild {
    pub fn project_root(&self) -> &Path {
        &self.project_root
    }

    pub fn source_path(&self) -> &Path {
        &self.source_path
    }

    pub fn build_directory(&self) -> &Path {
        &self.build_directory
    }

    pub fn compile_directory(&self) -> &Path {
        &self.compile_directory
    }

    pub fn engine(&self) -> Engine {
        self.engine
    }

    pub fn main_document(&self) -> &str {
        &self.main_document
    }

    pub fn tex_flavor(&self) -> Option<&str> {
        self.tex_flavor.as_deref()
    }
}

impl Workspace {
    pub fn prepare_build(&self) -> Result<PreparedBuild> {
        Ok(PreparedBuild {
            project_root: self.root().to_path_buf(),
            main_document: self.manifest().main_doc.clone(),
            source_path: self.main_document_path()?,
            build_directory: self.build_dir()?,
            compile_directory: self.compile_directory(),
            engine: self.manifest().engine()?,
            tex_flavor: self.manifest().normalized_tex_flavor()?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::InitOptions;
    use tempfile::TempDir;

    #[test]
    fn prepare_reuses_the_workspace_security_checks() {
        let directory = TempDir::new().unwrap();
        let workspace = Workspace::init(directory.path(), InitOptions::default()).unwrap();
        let prepared = workspace.prepare_build().unwrap();
        assert_eq!(prepared.engine(), Engine::Tectonic);
        assert!(prepared.source_path().ends_with("main.tex"));
        assert!(prepared.build_directory().ends_with(".oleafly/build"));
        assert_eq!(prepared.compile_directory(), prepared.project_root());
    }

    #[test]
    fn prepare_uses_an_external_build_directory() {
        let directory = TempDir::new().unwrap();
        let external = TempDir::new().unwrap();
        std::fs::write(directory.path().join("main.typ"), "= Paper").unwrap();
        let workspace = Workspace::from_manifest_with_build(
            directory.path(),
            crate::ProjectManifest {
                main_doc: "main.typ".into(),
                engine: "typst".into(),
                ..crate::ProjectManifest::default()
            },
            crate::BuildLocation::External(external.path().to_path_buf()),
        )
        .unwrap();
        let prepared = workspace.prepare_build().unwrap();
        assert_eq!(
            prepared.build_directory(),
            external.path().canonicalize().unwrap()
        );
        assert!(!directory.path().join(".oleafly").exists());
    }
}
