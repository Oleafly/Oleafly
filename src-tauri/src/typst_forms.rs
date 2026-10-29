//! Reads the Typst function forms a project can use: its `oleafly-forms.toml`
//! and the `typst.toml` of each package its documents import, from the package
//! folders the compiler uses. Nothing here fetches, installs or compiles, so a
//! package that isn't on disk yet simply has no forms.

use std::collections::BTreeSet;
use std::io::Read;
use std::path::{Path, PathBuf};

use oleafly_core::typst_forms::{
    assemble_catalog, FormCatalog, SourceOrigin, SourceRead, SourceText, MAX_FORMS_FILE_BYTES,
    PROJECT_FORMS_FILE,
};
use oleafly_core::typst_toolchain::TypstCapabilities;

use crate::typst_packages::{package_dir, PackageSpec, TypstPackageDirs};

const PACKAGE_MANIFEST: &str = "typst.toml";

/// The project file first, then each requested package once, in the order
/// asked. A string that isn't a package spec becomes an invalid-spec source.
pub(crate) fn read_sources(
    project_root: &Path,
    dirs: &TypstPackageDirs,
    packages: &[String],
) -> Vec<SourceRead> {
    let project_file = match has_entry_named(project_root, PROJECT_FORMS_FILE) {
        Ok(true) => match crate::sandbox::resolve_within(project_root, PROJECT_FORMS_FILE) {
            Ok(path) => read_text(&path),
            Err(error) => SourceText::Unreadable(error),
        },
        Ok(false) => SourceText::Missing,
        Err(error) => SourceText::Unreadable(error.to_string()),
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

/// Whether `directory` has an entry named exactly `name`. NTFS and APFS would
/// also open a mis-cased `Oleafly-Forms.toml`, which the watch list, the lint
/// and Linux never see, so only the exact name counts.
fn has_entry_named(directory: &Path, name: &str) -> std::io::Result<bool> {
    Ok(std::fs::read_dir(directory)?
        .flatten()
        .any(|entry| entry.file_name() == name))
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

/// The folders a compile with `capabilities` reads packages from. Typst before
/// 0.12 takes no `--package-path` and ignores `TYPST_PACKAGE_PATH`, so it reads
/// only its own data folder, then its cache, and never a vendored folder. With
/// no home folder that version finds no packages at all, so the app's folders
/// stay.
fn compiler_package_dirs(
    dirs: TypstPackageDirs,
    capabilities: &TypstCapabilities,
    data_dir: Option<PathBuf>,
    cache_dir: Option<PathBuf>,
) -> TypstPackageDirs {
    if capabilities.supports_flag("--package-path") {
        return dirs;
    }
    let packages = |root: PathBuf| root.join("typst").join("packages");
    match (data_dir, cache_dir) {
        (Some(data), Some(cache)) => TypstPackageDirs {
            package_path: packages(data),
            cache_path: packages(cache),
        },
        _ => dirs,
    }
}

/// The catalog for a project, read the way its compiles see packages. A
/// project that doesn't build with Typst has an empty one.
fn catalog_blocking(project_id: &str, packages: &[String]) -> Result<FormCatalog, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
    let meta = crate::project::read_meta(project_id)?;
    let root = crate::project_location::locate(project_id)?.root;
    Ok(match crate::typst_packages::for_compile(&meta, &root)? {
        Some(configured) => {
            // The version the compile resolves, without running it.
            let version = meta
                .typst_version_pin()
                .map_or_else(crate::typst_toolchain::default_version, str::to_owned);
            let dirs = compiler_package_dirs(
                configured,
                oleafly_core::typst_toolchain::capabilities_for(&version),
                dirs::data_dir(),
                dirs::cache_dir(),
            );
            assemble_catalog(read_sources(&root, &dirs, packages))
        }
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
