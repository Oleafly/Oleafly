//! Reads the Typst function forms a project can use: its `oleafly-forms.toml`
//! and the `typst.toml` of each package its documents import, from the package
//! folders the compiler uses. Nothing here fetches, installs or compiles, so a
//! package that isn't on disk yet simply has no forms.

use std::collections::BTreeSet;
use std::io::Read;
use std::path::Path;

use oleafly_core::typst_forms::{
    assemble_catalog, FormCatalog, SourceOrigin, SourceRead, SourceText, MAX_FORMS_FILE_BYTES,
    PROJECT_FORMS_FILE,
};

use crate::typst_packages::{package_dir, PackageSpec, TypstPackageDirs};

const PACKAGE_MANIFEST: &str = "typst.toml";

/// The project file first, then each requested package once, in the order
/// asked. A string that isn't a package spec becomes an invalid-spec source.
pub(crate) fn read_sources(
    project_root: &Path,
    dirs: &TypstPackageDirs,
    packages: &[String],
) -> Vec<SourceRead> {
    let project_file = match crate::sandbox::resolve_within(project_root, PROJECT_FORMS_FILE) {
        Ok(path) => read_text(&path),
        Err(error) => SourceText::Unreadable(error),
    };
    let mut sources = vec![SourceRead {
        origin: SourceOrigin::ProjectFile,
        watch: Some(PROJECT_FORMS_FILE.to_owned()),
        text: project_file,
    }];
    let mut seen = BTreeSet::new();
    for package in packages {
        if !seen.insert(package.as_str()) {
            continue;
        }
        sources.push(match PackageSpec::parse(package) {
            Some(spec) => package_source(project_root, dirs, &spec),
            None => SourceRead {
                origin: SourceOrigin::Package {
                    spec: package.clone(),
                },
                watch: None,
                text: SourceText::InvalidSpec,
            },
        });
    }
    sources
}

/// A vendored package is watched at its place in the project, whether or not
/// it has been copied there yet, so vendoring it reloads the catalog.
fn package_source(project_root: &Path, dirs: &TypstPackageDirs, spec: &PackageSpec) -> SourceRead {
    let watch = dirs
        .package_path
        .strip_prefix(project_root)
        .ok()
        .map(|vendor| {
            oleafly_core::slash_path(&vendor.join(spec.relative_dir()).join(PACKAGE_MANIFEST))
        });
    let text = match package_dir(dirs, spec) {
        Some(directory) => read_text(&directory.join(PACKAGE_MANIFEST)),
        None => SourceText::Missing,
    };
    SourceRead {
        origin: SourceOrigin::Package {
            spec: spec.to_string(),
        },
        watch,
        text,
    }
}

fn read_text(path: &Path) -> SourceText {
    let size = match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => metadata.len(),
        Ok(_) => return SourceText::Missing,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return SourceText::Missing,
        Err(error) => return SourceText::Unreadable(error.to_string()),
    };
    if size > MAX_FORMS_FILE_BYTES {
        return SourceText::TooLarge(size);
    }
    let mut bytes = Vec::new();
    if let Err(error) = std::fs::File::open(path)
        .and_then(|file| file.take(MAX_FORMS_FILE_BYTES + 1).read_to_end(&mut bytes))
    {
        return SourceText::Unreadable(error.to_string());
    }
    if bytes.len() as u64 > MAX_FORMS_FILE_BYTES {
        return SourceText::TooLarge(bytes.len() as u64);
    }
    match String::from_utf8(bytes) {
        Ok(text) => SourceText::Text(text),
        Err(_) => SourceText::Unreadable("it is not UTF-8 text.".into()),
    }
}

/// The catalog for a project, read the way its compiles see packages. A
/// project that doesn't build with Typst has an empty one.
fn catalog_blocking(project_id: &str, packages: &[String]) -> Result<FormCatalog, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
    let meta = crate::project::read_meta(project_id)?;
    let root = crate::project_location::locate(project_id)?.root;
    Ok(match crate::typst_packages::for_compile(&meta, &root)? {
        Some(dirs) => assemble_catalog(read_sources(&root, &dirs, packages)),
        None => assemble_catalog(Vec::new()),
    })
}

#[tauri::command]
pub async fn typst_form_catalog(
    project_id: String,
    packages: Vec<String>,
) -> Result<FormCatalog, String> {
    crate::typst_packages::blocking(move || catalog_blocking(&project_id, &packages)).await
}

#[cfg(test)]
mod tests;
