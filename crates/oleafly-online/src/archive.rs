use std::io::Read;
use std::path::{Path, PathBuf};

use oleafly_core::{detect_main_document, DetectOptions, Engine, ProjectManifest};
use serde::Serialize;
use serde_json::Value;

use crate::client::Http;
use crate::error::{OnlineError, OnlineErrorKind};
use crate::projects::{origin_record, RemoteProject};
use crate::socket::{self, ProjectSettings};
use crate::sync::{check_remote_paths, now_seconds};

const SKIPPED_NAMES: [&str; 5] = ["__MACOSX", ".DS_Store", ".git", ".oleafly", "Thumbs.db"];
const MAX_FOLDER_NAME: usize = 80;
const MAX_FOLDER_BYTES: usize = 180;
const MANIFEST: &str = "project.json";

#[derive(Clone, Copy, Debug)]
pub struct ImportLimits {
    pub max_entries: usize,
    pub max_total_bytes: u64,
    pub max_depth: usize,
}

impl Default for ImportLimits {
    fn default() -> Self {
        ImportLimits {
            max_entries: 5_000,
            max_total_bytes: 2 * 1024 * 1024 * 1024,
            max_depth: 16,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFolder {
    pub remote_id: String,
    pub name: String,
    pub folder: PathBuf,
    pub main_doc: Option<String>,
    pub compiler: Option<String>,
    pub files: usize,
    pub manifest_written: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ImportProgress {
    Downloading { received: u64, total: Option<u64> },
    Extracting,
}

fn reserved_on_windows(stem: &str) -> bool {
    let stem = stem.to_ascii_lowercase();
    matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || ["com", "lpt"].iter().any(|prefix| {
            stem.strip_prefix(prefix)
                .is_some_and(|digit| digit.len() == 1 && matches!(digit.as_bytes()[0], b'1'..=b'9'))
        })
}

pub fn folder_name_for(project_name: &str) -> String {
    let replaced: String = project_name
        .chars()
        .map(|character| {
            if matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            ) || character.is_control()
            {
                '-'
            } else {
                character
            }
        })
        .collect();
    let collapsed = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let trim = |text: &str| {
        text.trim_matches(|character: char| character == ' ' || character == '.')
            .to_string()
    };
    let mut capped: String = trim(&collapsed).chars().take(MAX_FOLDER_NAME).collect();
    while capped.len() > MAX_FOLDER_BYTES {
        capped.pop();
    }
    let name = trim(&capped);
    if name.is_empty() {
        return "project".to_string();
    }
    let (stem, rest) = name.split_at(name.find('.').unwrap_or(name.len()));
    if reserved_on_windows(stem) {
        return format!("{stem}-project{rest}");
    }
    name
}

pub fn unique_folder(parent: &Path, name: &str) -> PathBuf {
    let taken = |path: &Path| std::fs::symlink_metadata(path).is_ok();
    let first = parent.join(name);
    if !taken(&first) {
        return first;
    }
    (2_u32..)
        .map(|number| parent.join(format!("{name}-{number}")))
        .find(|candidate| !taken(candidate))
        .unwrap_or(first)
}

fn entry_path(raw: &str) -> Option<String> {
    if raw.contains('\0') {
        return None;
    }
    let unified = raw.replace('\\', "/");
    if unified.starts_with('/') {
        return None;
    }
    let mut parts = Vec::new();
    for (index, part) in unified.split('/').enumerate() {
        match part {
            "" | "." => {}
            ".." => return None,
            drive if index == 0 && drive.len() >= 2 && drive.as_bytes()[1] == b':' => return None,
            part => parts.push(part),
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

fn skipped(rel: &str) -> bool {
    rel.split('/').any(|segment| {
        SKIPPED_NAMES
            .iter()
            .any(|name| segment.eq_ignore_ascii_case(name))
    })
}

fn not_an_archive<E>(_: E) -> OnlineError {
    OnlineError::new(OnlineErrorKind::NotAnArchive)
}

fn write_error(path: &Path, error: std::io::Error) -> OnlineError {
    OnlineError::io(format!("could not write {}: {error}", path.display()))
}

pub fn extract_project_zip(
    archive: &Path,
    dest: &Path,
    limits: &ImportLimits,
) -> Result<usize, OnlineError> {
    let file = std::fs::File::open(archive)
        .map_err(|error| OnlineError::io(format!("could not open the download: {error}")))?;
    let mut zip = zip::ZipArchive::new(file).map_err(not_an_archive)?;
    let too_large = || OnlineError::new(OnlineErrorKind::TooLarge);
    let mut planned: Vec<(usize, String, bool)> = Vec::new();
    let mut files: Vec<String> = Vec::new();
    let mut declared: u64 = 0;
    for index in 0..zip.len() {
        let entry = zip.by_index_raw(index).map_err(not_an_archive)?;
        let name = entry.name().map_err(not_an_archive)?;
        let Some(rel) = entry_path(&name) else {
            continue;
        };
        if skipped(&rel)
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170_000 == 0o120_000)
        {
            continue;
        }
        if rel.split('/').count() > limits.max_depth {
            return Err(too_large());
        }
        let is_dir = entry.is_dir();
        if !is_dir {
            declared = declared.saturating_add(entry.size());
            files.push(rel.clone());
            if files.len() > limits.max_entries || declared > limits.max_total_bytes {
                return Err(too_large());
            }
        }
        planned.push((index, rel, is_dir));
    }
    check_remote_paths(&files)?;
    std::fs::create_dir_all(dest).map_err(|error| write_error(dest, error))?;
    let mut written: u64 = 0;
    for (index, rel, is_dir) in &planned {
        let out = dest.join(rel);
        if *is_dir {
            std::fs::create_dir_all(&out).map_err(|error| write_error(&out, error))?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|error| write_error(parent, error))?;
        }
        let entry = zip.by_index(*index).map_err(not_an_archive)?;
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&out)
            .map_err(|error| write_error(&out, error))?;
        let budget = limits.max_total_bytes.saturating_sub(written);
        let copied = std::io::copy(&mut entry.take(budget.saturating_add(1)), &mut output)
            .map_err(|error| write_error(&out, error))?;
        written = written.saturating_add(copied);
        if written > limits.max_total_bytes {
            return Err(too_large());
        }
    }
    Ok(files.len())
}

fn usable_main(folder: &Path, main: &str) -> bool {
    !main.is_empty()
        && !main.starts_with('/')
        && !main.split('/').any(|part| part == "..")
        && Engine::infer(main).is_ok()
        && folder.join(main).is_file()
}

fn claim_origin(path: &Path, origin: Value) -> Result<(), OnlineError> {
    let Ok(Value::Object(mut manifest)) = std::fs::read(path)
        .map_err(|_| ())
        .and_then(|bytes| serde_json::from_slice(&bytes).map_err(|_| ()))
    else {
        return Ok(());
    };
    if !manifest.contains_key("importedFrom") {
        return Ok(());
    }
    manifest.insert("importedFrom".to_string(), origin);
    let mut bytes = serde_json::to_vec_pretty(&Value::Object(manifest))
        .map_err(|error| OnlineError::io(error.to_string()))?;
    bytes.push(b'\n');
    oleafly_secrets::fs::write_atomic(path, &bytes).map_err(OnlineError::io)
}

pub fn write_folder_manifest(
    folder: &Path,
    settings: &ProjectSettings,
    origin: Value,
) -> Result<bool, OnlineError> {
    let path = folder.join(MANIFEST);
    if std::fs::symlink_metadata(&path).is_ok() {
        claim_origin(&path, origin)?;
        return Ok(false);
    }
    let main_doc = settings
        .main_doc
        .as_deref()
        .map(str::trim)
        .filter(|main| usable_main(folder, main))
        .map(str::to_string)
        .or_else(|| {
            detect_main_document(folder, &DetectOptions::default())
                .ok()
                .and_then(|detection| detection.best().map(str::to_string))
        })
        .unwrap_or_else(|| Engine::Tectonic.default_main_document().to_string());
    let flavor = settings
        .compiler
        .as_deref()
        .and_then(socket::flavor_for_compiler);
    let (engine, tex_flavor) = match (Engine::infer(&main_doc), flavor) {
        (Ok(Engine::Tectonic), Some(flavor)) => (Engine::Latexmk, Some(flavor.to_string())),
        (Ok(engine), _) => (engine, None),
        (Err(_), _) => (Engine::Tectonic, None),
    };
    let mut manifest = ProjectManifest {
        name: origin
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        main_doc,
        engine: engine.manifest_name().to_string(),
        tex_flavor,
        ..ProjectManifest::default()
    };
    manifest.extra.insert("importedFrom".to_string(), origin);
    let mut bytes =
        serde_json::to_vec_pretty(&manifest).map_err(|error| OnlineError::io(error.to_string()))?;
    bytes.push(b'\n');
    oleafly_secrets::fs::write_atomic(&path, &bytes).map_err(OnlineError::io)?;
    Ok(true)
}

struct Staging {
    archive: PathBuf,
    folder: PathBuf,
}

impl Drop for Staging {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.archive);
        let _ = std::fs::remove_dir_all(&self.folder);
    }
}

fn main_doc_of(folder: &Path) -> Option<String> {
    let bytes = std::fs::read(folder.join(MANIFEST)).ok()?;
    oleafly_core::sniff_oleafly_manifest(&bytes).map(|manifest| manifest.main_doc)
}

fn path_exists(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok()
}

pub async fn import_into_folder(
    http: &Http,
    cookie: &str,
    remote: &RemoteProject,
    target: &Path,
    limits: &ImportLimits,
    progress: &(dyn Fn(ImportProgress) + Send + Sync),
) -> Result<ImportedFolder, OnlineError> {
    let folder_exists =
        || OnlineError::new(OnlineErrorKind::FolderExists).param("folder", target.display());
    if tokio::fs::symlink_metadata(target).await.is_ok() {
        return Err(folder_exists());
    }
    let parent = target
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."))
        .to_path_buf();
    tokio::fs::create_dir_all(&parent)
        .await
        .map_err(|error| write_error(&parent, error))?;
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "project".to_string());
    let tag = format!("{:016x}", rand::random::<u64>());
    let staging = Staging {
        archive: parent.join(format!(".{name}.oleafly-import-{tag}.zip")),
        folder: parent.join(format!(".{name}.oleafly-import-{tag}.tmp")),
    };
    let settings = socket::fetch_project(http, cookie, &remote.id)
        .await
        .map(|project| socket::settings_from_project(&project))
        .unwrap_or_default();
    http.download_zip(cookie, &remote.id, &staging.archive, |received, total| {
        progress(ImportProgress::Downloading { received, total });
    })
    .await?;
    progress(ImportProgress::Extracting);
    let origin = origin_record(&http.base, remote, &settings, now_seconds());
    let limits = *limits;
    let task_settings = settings.clone();
    let destination = target.to_path_buf();
    let (files, manifest_written) = tokio::task::spawn_blocking(move || {
        let staging = staging;
        let files = extract_project_zip(&staging.archive, &staging.folder, &limits)?;
        let written = write_folder_manifest(&staging.folder, &task_settings, origin)?;
        if path_exists(&destination) {
            return Err(OnlineError::new(OnlineErrorKind::FolderExists)
                .param("folder", destination.display()));
        }
        std::fs::rename(&staging.folder, &destination)
            .map_err(|error| write_error(&destination, error))?;
        Ok::<_, OnlineError>((files, written))
    })
    .await
    .map_err(|error| OnlineError::io(error.to_string()))??;
    Ok(ImportedFolder {
        remote_id: remote.id.clone(),
        name: remote.name.clone(),
        folder: target.to_path_buf(),
        main_doc: main_doc_of(target),
        compiler: settings.compiler,
        files,
        manifest_written,
    })
}

#[cfg(test)]
mod tests {
    use std::io::Write as _;
    use std::sync::{Arc, Mutex};

    use serde_json::json;

    use super::*;
    use crate::projects::remote_project;
    use crate::service::SERVICE_ID;
    use crate::test_support::{
        dashboard_page, remote_project_json, socket_handler, zip_bytes, FixtureServer, Reply,
        Request,
    };

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = std::fs::File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        for (name, body) in entries {
            if name.ends_with('/') {
                writer.add_directory(*name, options).unwrap();
            } else {
                writer.start_file(*name, options).unwrap();
                writer.write_all(body).unwrap();
            }
        }
        writer.finish().unwrap();
    }

    fn listing(dir: &Path) -> Vec<String> {
        let mut found = Vec::new();
        let mut stack = vec![(dir.to_path_buf(), String::new())];
        while let Some((folder, prefix)) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&folder) else {
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let rel = if prefix.is_empty() {
                    name
                } else {
                    format!("{prefix}/{name}")
                };
                if entry.file_type().unwrap().is_dir() {
                    stack.push((entry.path(), rel));
                } else {
                    found.push(rel);
                }
            }
        }
        found.sort();
        found
    }

    #[test]
    fn folder_names_are_safe_on_windows_and_unique() {
        assert_eq!(folder_name_for("Thesis: Draft?"), "Thesis- Draft-");
        assert_eq!(folder_name_for("CON"), "CON-project");
        assert_eq!(folder_name_for("lpt7.draft"), "lpt7-project.draft");
        assert_eq!(folder_name_for("  ...  "), "project");
        assert_eq!(folder_name_for("Ünïcode café"), "Ünïcode café");
        assert_eq!(
            folder_name_for("Two   spaces\tand tab"),
            "Two spaces-and tab"
        );
        assert!(folder_name_for(&"x".repeat(300)).chars().count() <= 80);
        let parent = tempfile::tempdir().unwrap();
        let parent = parent.path();
        assert_eq!(unique_folder(parent, "Paper"), parent.join("Paper"));
        std::fs::create_dir(parent.join("Paper")).unwrap();
        assert_eq!(unique_folder(parent, "Paper"), parent.join("Paper-2"));
        std::fs::create_dir(parent.join("Paper-2")).unwrap();
        assert_eq!(unique_folder(parent, "Paper"), parent.join("Paper-3"));
    }

    #[test]
    fn extraction_skips_traversal_junk_and_app_folders() {
        let temp = tempfile::tempdir().unwrap();
        let archive = temp.path().join("in.zip");
        write_zip(
            &archive,
            &[
                ("../evil.tex", b"x"),
                ("C:/abs.tex", b"x"),
                ("/rooted.tex", b"x"),
                ("__MACOSX/x", b"x"),
                (".git/config", b"x"),
                (".oleafly/build/x", b"x"),
                ("figs/.DS_Store", b"x"),
                ("figs\\a.png", b"png"),
                ("empty/", b""),
                ("main.tex", b"\\documentclass{article}"),
            ],
        );
        let dest = temp.path().join("out");
        let count = extract_project_zip(&archive, &dest, &ImportLimits::default()).unwrap();
        assert_eq!(count, 2);
        assert_eq!(
            listing(&dest),
            vec!["figs/a.png".to_string(), "main.tex".to_string()]
        );
        assert!(dest.join("empty").is_dir());
        assert!(!temp.path().join("evil.tex").exists());
    }

    #[test]
    fn extraction_refuses_case_clashes_and_windows_names_before_writing() {
        let temp = tempfile::tempdir().unwrap();
        let archive = temp.path().join("in.zip");
        write_zip(&archive, &[("Figure.png", b"a"), ("figure.png", b"b")]);
        let dest = temp.path().join("out");
        let error = extract_project_zip(&archive, &dest, &ImportLimits::default()).unwrap_err();
        assert_eq!(error.kind, OnlineErrorKind::SyncCaseClash);
        assert!(!dest.exists());
        if cfg!(windows) {
            write_zip(&archive, &[("aux.tex", b"a")]);
            let error = extract_project_zip(&archive, &dest, &ImportLimits::default()).unwrap_err();
            assert_eq!(error.kind, OnlineErrorKind::SyncInvalidNames);
            assert!(!dest.exists());
        }
    }

    #[test]
    fn extraction_stops_at_each_limit_without_partial_folders() {
        let temp = tempfile::tempdir().unwrap();
        let archive = temp.path().join("in.zip");
        let dest = temp.path().join("out");
        write_zip(
            &archive,
            &[("a.tex", b"1"), ("b.tex", b"2"), ("c.tex", b"3")],
        );
        let few = ImportLimits {
            max_entries: 2,
            ..ImportLimits::default()
        };
        assert_eq!(
            extract_project_zip(&archive, &dest, &few).unwrap_err().kind,
            OnlineErrorKind::TooLarge
        );
        assert!(!dest.exists());

        write_zip(&archive, &[("a.tex", b"0123456789abcdef")]);
        let small = ImportLimits {
            max_total_bytes: 10,
            ..ImportLimits::default()
        };
        assert_eq!(
            extract_project_zip(&archive, &dest, &small)
                .unwrap_err()
                .kind,
            OnlineErrorKind::TooLarge
        );
        assert!(!dest.exists());

        write_zip(&archive, &[("a/b/c.tex", b"deep")]);
        let shallow = ImportLimits {
            max_depth: 2,
            ..ImportLimits::default()
        };
        assert_eq!(
            extract_project_zip(&archive, &dest, &shallow)
                .unwrap_err()
                .kind,
            OnlineErrorKind::TooLarge
        );
        assert!(!dest.exists());
    }

    #[test]
    fn a_file_that_is_not_an_archive_is_named_as_such() {
        let temp = tempfile::tempdir().unwrap();
        let archive = temp.path().join("in.zip");
        std::fs::write(&archive, b"<html>not a zip</html>").unwrap();
        let error =
            extract_project_zip(&archive, &temp.path().join("out"), &ImportLimits::default())
                .unwrap_err();
        assert_eq!(error.kind, OnlineErrorKind::NotAnArchive);
    }

    fn thesis_project() -> Value {
        json!({
            "compiler": "xelatex",
            "imageName": "texlive-full:2025.1",
            "rootDoc_id": "m",
            "rootFolder": [{
                "docs": [{ "_id": "n", "name": "notes.tex" }],
                "folders": [{ "name": "paper", "docs": [{ "_id": "m", "name": "main.tex" }] }]
            }]
        })
    }

    async fn fixture(archive: Vec<u8>) -> FixtureServer {
        let page = dashboard_page(
            &json!({ "totalSize": 1, "projects": [remote_project_json("a1", "Thesis")] }),
        );
        let socket = socket_handler(thesis_project(), Arc::new(Mutex::new(0)));
        FixtureServer::start(Arc::new(move |request: &Request| {
            if let Some(reply) = socket(request) {
                return reply;
            }
            match request.path.as_str() {
                "/project" => Reply::ok(page.clone()),
                "/project/a1/download/zip" => Reply::ok(archive.clone()),
                _ => Reply::status(404),
            }
        }))
        .await
    }

    fn thesis_remote() -> RemoteProject {
        remote_project(&remote_project_json("a1", "Thesis"), "user-1").unwrap()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn import_writes_files_manifest_and_origin_into_a_new_folder() {
        let server = fixture(zip_bytes(&[
            (
                "paper/main.tex",
                "\\documentclass{book}\\begin{document}x\\end{document}",
            ),
            (
                "notes.tex",
                "\\documentclass{article}\\begin{document}y\\end{document}",
            ),
        ]))
        .await;
        let http = Http::new(&server.base, "Oleafly/test").unwrap();
        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("Thesis");
        let events = Mutex::new(Vec::new());
        let imported = import_into_folder(
            &http,
            "site_session=good",
            &thesis_remote(),
            &target,
            &ImportLimits::default(),
            &|event| events.lock().unwrap().push(event),
        )
        .await
        .unwrap();
        assert_eq!(imported.folder, target);
        assert_eq!(imported.files, 2);
        assert!(imported.manifest_written);
        assert_eq!(imported.main_doc.as_deref(), Some("paper/main.tex"));
        assert_eq!(imported.compiler.as_deref(), Some("xelatex"));
        assert!(target.join("paper/main.tex").is_file());
        let manifest: Value =
            serde_json::from_str(&std::fs::read_to_string(target.join("project.json")).unwrap())
                .unwrap();
        assert_eq!(manifest["name"], "Thesis");
        assert_eq!(manifest["main_doc"], "paper/main.tex");
        assert_eq!(manifest["engine"], "latexmk");
        assert_eq!(manifest["tex_flavor"], "xelatex");
        assert_eq!(manifest["importedFrom"]["service"], SERVICE_ID);
        assert_eq!(manifest["importedFrom"]["projectId"], "a1");
        assert_eq!(manifest["importedFrom"]["server"], server.base.as_str());
        assert_eq!(manifest["importedFrom"]["texLive"], "2025");
        let events = events.into_inner().unwrap();
        assert!(events
            .iter()
            .any(|event| matches!(event, ImportProgress::Downloading { .. })));
        assert_eq!(events.last(), Some(&ImportProgress::Extracting));
        let leftovers: Vec<_> = std::fs::read_dir(parent.path())
            .unwrap()
            .flatten()
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".oleafly-import-")
            })
            .collect();
        assert!(leftovers.is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_archive_with_its_own_project_json_keeps_it_and_skips_the_manifest() {
        let own = "{\"name\":\"Mine\",\"main_doc\":\"notes.tex\",\"engine\":\"xetex\"}";
        let server = fixture(zip_bytes(&[
            (
                "notes.tex",
                "\\documentclass{article}\\begin{document}y\\end{document}",
            ),
            ("project.json", own),
        ]))
        .await;
        let http = Http::new(&server.base, "Oleafly/test").unwrap();
        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("Mine");
        let imported = import_into_folder(
            &http,
            "site_session=good",
            &thesis_remote(),
            &target,
            &ImportLimits::default(),
            &|_| {},
        )
        .await
        .unwrap();
        assert!(!imported.manifest_written);
        assert_eq!(imported.main_doc.as_deref(), Some("notes.tex"));
        assert_eq!(
            std::fs::read_to_string(target.join("project.json")).unwrap(),
            own
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_archive_cannot_say_where_the_folder_came_from() {
        let own = json!({
            "name": "Mine",
            "main_doc": "notes.tex",
            "engine": "xetex",
            "importedFrom": {"service": SERVICE_ID, "server": "https://evil.example", "projectId": "zzz"}
        });
        let server = fixture(zip_bytes(&[
            (
                "notes.tex",
                "\\documentclass{article}\\begin{document}y\\end{document}",
            ),
            ("project.json", &own.to_string()),
        ]))
        .await;
        let http = Http::new(&server.base, "Oleafly/test").unwrap();
        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("Mine");
        import_into_folder(
            &http,
            "site_session=good",
            &thesis_remote(),
            &target,
            &ImportLimits::default(),
            &|_| {},
        )
        .await
        .unwrap();
        let kept: Value =
            serde_json::from_str(&std::fs::read_to_string(target.join("project.json")).unwrap())
                .unwrap();
        assert_eq!(kept["importedFrom"]["server"], server.base.as_str());
        assert_eq!(kept["importedFrom"]["projectId"], "a1");
        assert_eq!(kept["main_doc"], "notes.tex");
        assert_eq!(kept["engine"], "xetex");
    }

    #[test]
    fn long_names_in_wide_characters_fit_a_file_name() {
        for wide in ["字", "😀", "é"] {
            let name = folder_name_for(&wide.repeat(100));
            assert!(
                name.len() <= MAX_FOLDER_BYTES,
                "{wide}: {} bytes",
                name.len()
            );
            assert!(!name.is_empty());
            let staged = format!(".{name}.oleafly-import-{:016x}.zip", 0_u64);
            assert!(staged.len() <= 255, "{wide}: {}", staged.len());
        }
        assert_eq!(folder_name_for(&"a".repeat(100)).len(), MAX_FOLDER_NAME);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_existing_target_is_never_overwritten() {
        let server = fixture(zip_bytes(&[("main.tex", "new")])).await;
        let http = Http::new(&server.base, "Oleafly/test").unwrap();
        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("Thesis");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("main.tex"), "old").unwrap();
        let error = import_into_folder(
            &http,
            "site_session=good",
            &thesis_remote(),
            &target,
            &ImportLimits::default(),
            &|_| {},
        )
        .await
        .unwrap_err();
        assert_eq!(error.kind, OnlineErrorKind::FolderExists);
        assert_eq!(
            std::fs::read_to_string(target.join("main.tex")).unwrap(),
            "old"
        );
        assert!(server.requests("/project/a1/download").is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_refused_archive_leaves_no_folder_or_staging_behind() {
        let server = fixture(zip_bytes(&[("a.tex", "1"), ("b.tex", "2"), ("c.tex", "3")])).await;
        let http = Http::new(&server.base, "Oleafly/test").unwrap();
        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("Thesis");
        let few = ImportLimits {
            max_entries: 2,
            ..ImportLimits::default()
        };
        let error = import_into_folder(
            &http,
            "site_session=good",
            &thesis_remote(),
            &target,
            &few,
            &|_| {},
        )
        .await
        .unwrap_err();
        assert_eq!(error.kind, OnlineErrorKind::TooLarge);
        assert!(!target.exists());
        assert_eq!(std::fs::read_dir(parent.path()).unwrap().count(), 0);
    }
}
