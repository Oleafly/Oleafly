use crate::app_error::AppError;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read as _, Write as _};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

const PROGRESS_INTERVAL: Duration = Duration::from_millis(60);
const PROGRESS_EVERY: u64 = 16;
const CHUNK_BYTES: usize = 1024 * 1024;
const MAX_GIT_LINK_BYTES: u64 = 4 * 1024;
const MAX_GIT_CONFIG_BYTES: u64 = 1024 * 1024;
const FOREIGN_MANIFEST_STEM: &str = "project.external";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CopyPhase {
    Counting,
    Copying,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyProgress {
    pub phase: CopyPhase,
    pub entries_done: u64,
    pub entries_total: u64,
    pub bytes_done: u64,
    pub bytes_total: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopiedIntoLibrary {
    pub project_id: String,
    pub left_out: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CopyLimits {
    pub(crate) max_entries: u64,
    pub(crate) max_bytes: u64,
}

pub(crate) const COPY_LIMITS: CopyLimits = CopyLimits {
    max_entries: 5_000,
    max_bytes: 2 * 1024 * 1024 * 1024,
};

#[derive(Debug)]
enum Planned {
    Directory(PathBuf),
    File(PathBuf),
    GitConfig(PathBuf, u64),
}

struct Reporter<'a> {
    sink: &'a mut dyn FnMut(CopyProgress),
    cancel: &'a AtomicBool,
    last: Option<Instant>,
    last_entries: u64,
    last_bytes: u64,
    bytes_step: u64,
}

impl Reporter<'_> {
    fn check(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::SeqCst) {
            return Err(AppError::new("project.copy_cancelled").into());
        }
        Ok(())
    }

    fn report(&mut self, progress: CopyProgress, force: bool) {
        let due = self
            .last
            .is_none_or(|last| last.elapsed() >= PROGRESS_INTERVAL)
            || progress.entries_done >= self.last_entries + PROGRESS_EVERY
            || progress.bytes_done >= self.last_bytes.saturating_add(self.bytes_step);
        if force || due {
            self.last = Some(Instant::now());
            self.last_entries = progress.entries_done;
            self.last_bytes = progress.bytes_done;
            (self.sink)(progress);
        }
    }
}

struct Plan {
    items: Vec<Planned>,
    entries: u64,
    bytes: u64,
    git_entries: u64,
    left_out: u64,
}

impl Plan {
    fn count(&mut self, in_git: bool, bytes: u64) {
        self.entries += 1;
        self.bytes = self.bytes.saturating_add(bytes);
        if in_git {
            self.git_entries += 1;
        }
    }
}

fn skipped_name(name: &str) -> bool {
    name.eq_ignore_ascii_case(".oleafly")
        || name.starts_with(".oleafly-")
        || (name.starts_with('.') && name.contains(".oleafly-") && name.ends_with(".tmp"))
}

fn git_link_stays_inside(parent: &Path, target: &str) -> bool {
    let target = Path::new(target.trim());
    if target.as_os_str().is_empty() || target.is_absolute() {
        return false;
    }
    let mut depth = parent
        .components()
        .filter(|component| matches!(component, Component::Normal(_)))
        .count();
    for component in target.components() {
        match component {
            Component::Normal(_) => depth += 1,
            Component::CurDir => {}
            Component::ParentDir if depth > 0 => depth -= 1,
            _ => return false,
        }
    }
    true
}

fn portable_git_link(path: &Path, relative_parent: &Path) -> bool {
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return false;
    };
    if metadata.len() > MAX_GIT_LINK_BYTES {
        return false;
    }
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| {
            text.lines()
                .next()
                .and_then(|line| line.strip_prefix("gitdir:"))
                .map(|target| git_link_stays_inside(relative_parent, target))
        })
        .unwrap_or(false)
}

fn limit_error(plan: &Plan, limits: CopyLimits) -> Option<String> {
    if plan.entries > limits.max_entries {
        let code = if plan.git_entries > 0 {
            "project.copy_entry_limit_git"
        } else {
            "project.copy_entry_limit"
        };
        return Some(AppError::new(code).into());
    }
    if plan.bytes > limits.max_bytes {
        return Some(AppError::new("project.copy_size_limit").into());
    }
    None
}

fn scan(
    root: &Path,
    relative: &Path,
    in_git: bool,
    limits: CopyLimits,
    plan: &mut Plan,
    reporter: &mut Reporter<'_>,
) -> Result<(), String> {
    let directory = root.join(relative);
    if relative.components().count() >= crate::project::MAX_WALK_DEPTH {
        let hidden = std::fs::read_dir(&directory).map_or(0, |entries| entries.count() as u64);
        plan.left_out = plan.left_out.saturating_add(hidden);
        return Ok(());
    }
    let git_directory = in_git && directory.join("HEAD").is_file();
    let mut entries: Vec<_> = std::fs::read_dir(&directory)
        .map_err(|error| format!("could not read {}: {error}", relative.display()))?
        .flatten()
        .collect();
    entries.sort_by_key(std::fs::DirEntry::file_name);
    for entry in entries {
        reporter.check()?;
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        if skipped_name(&name) {
            continue;
        }
        if file_type.is_symlink() {
            plan.left_out += 1;
            continue;
        }
        let child = relative.join(entry.file_name());
        if file_type.is_dir() {
            if git_directory && (name == "hooks" || name == "worktrees") {
                continue;
            }
            plan.items.push(Planned::Directory(child.clone()));
            plan.count(in_git || name == ".git", 0);
            if let Some(error) = limit_error(plan, limits) {
                return Err(error);
            }
            scan(
                root,
                &child,
                in_git || name == ".git",
                limits,
                plan,
                reporter,
            )?;
        } else if file_type.is_file() {
            if name == ".git" && !portable_git_link(&entry.path(), relative) {
                continue;
            }
            let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
            plan.count(in_git || name == ".git", size);
            if let Some(error) = limit_error(plan, limits) {
                return Err(error);
            }
            plan.items.push(if git_directory && name == "config" {
                Planned::GitConfig(child, size)
            } else {
                Planned::File(child)
            });
        } else {
            plan.left_out += 1;
            continue;
        }
        reporter.report(
            CopyProgress {
                phase: CopyPhase::Counting,
                entries_done: plan.entries,
                entries_total: 0,
                bytes_done: plan.bytes,
                bytes_total: 0,
            },
            false,
        );
    }
    Ok(())
}

fn git_boolean(value: &str) -> Option<&'static str> {
    match value {
        "true" | "yes" | "on" | "1" => Some("true"),
        "false" | "no" | "off" | "0" => Some("false"),
        _ => None,
    }
}

pub(crate) fn sanitized_git_config(original: &str) -> String {
    let mut section = String::new();
    let mut version = "0".to_string();
    let mut disk: Vec<(String, &'static str)> = Vec::new();
    let mut extensions: Vec<(String, String)> = Vec::new();
    for line in original.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            section = line
                .trim_start_matches('[')
                .trim_end_matches(']')
                .trim()
                .to_ascii_lowercase();
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        let value = value
            .split(['#', ';'])
            .next()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        match (section.as_str(), key.as_str(), value.as_str()) {
            ("core", "repositoryformatversion", "0" | "1") => version = value,
            ("core", "ignorecase" | "precomposeunicode" | "symlinks", _) => {
                if let Some(flag) = git_boolean(&value) {
                    disk.retain(|(existing, _)| existing != &key);
                    disk.push((key, flag));
                }
            }
            ("extensions", "objectformat", "sha1" | "sha256")
            | ("extensions", "refstorage", "files" | "reftable") => {
                extensions.retain(|(existing, _)| existing != &key);
                extensions.push((key, value));
            }
            _ => {}
        }
    }
    let mut config = format!(
        "[core]\n\trepositoryformatversion = {version}\n\tfilemode = {}\n\tbare = false\n\tlogallrefupdates = true\n",
        cfg!(unix)
    );
    for (key, value) in disk {
        config.push_str(&format!("\t{key} = {value}\n"));
    }
    if !extensions.is_empty() {
        config.push_str("[extensions]\n");
        for (key, value) in extensions {
            config.push_str(&format!("\t{key} = {value}\n"));
        }
    }
    config
}

fn copy_file(
    source: &Path,
    destination: &Path,
    reporter: &mut Reporter<'_>,
    at: impl Fn(u64) -> CopyProgress,
) -> Result<u64, String> {
    let mut input = std::fs::File::open(source)
        .map_err(|error| format!("could not read {}: {error}", source.display()))?;
    let mut output = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|error| format!("could not write {}: {error}", destination.display()))?;
    let mut buffer = vec![0_u8; CHUNK_BYTES];
    let mut copied = 0_u64;
    loop {
        reporter.check()?;
        let read = input
            .read(&mut buffer)
            .map_err(|error| format!("could not read {}: {error}", source.display()))?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(|error| format!("could not write {}: {error}", destination.display()))?;
        copied = copied.saturating_add(read as u64);
        reporter.report(at(copied), false);
    }
    if let Ok(metadata) = input.metadata() {
        let _ = std::fs::set_permissions(destination, metadata.permissions());
    }
    Ok(copied)
}

fn copy_planned(
    source_root: &Path,
    destination_root: &Path,
    plan: &Plan,
    reporter: &mut Reporter<'_>,
) -> Result<(), String> {
    let mut entries_done = 0_u64;
    let mut bytes_done = 0_u64;
    let progress = |entries_done: u64, bytes_done: u64| CopyProgress {
        phase: CopyPhase::Copying,
        entries_done,
        entries_total: plan.entries,
        bytes_done: bytes_done.min(plan.bytes),
        bytes_total: plan.bytes,
    };
    reporter.bytes_step = (plan.bytes / 100).max(CHUNK_BYTES as u64);
    reporter.report(progress(0, 0), true);
    for item in &plan.items {
        reporter.check()?;
        match item {
            Planned::Directory(relative) => {
                std::fs::create_dir_all(destination_root.join(relative))
                    .map_err(|error| format!("could not create {}: {error}", relative.display()))?;
            }
            Planned::File(relative) => {
                let copied = copy_file(
                    &source_root.join(relative),
                    &destination_root.join(relative),
                    reporter,
                    |copied| progress(entries_done, bytes_done.saturating_add(copied)),
                )?;
                bytes_done = bytes_done.saturating_add(copied);
            }
            Planned::GitConfig(relative, size) => {
                let source = source_root.join(relative);
                let mut text = String::new();
                std::fs::File::open(&source)
                    .and_then(|file| file.take(MAX_GIT_CONFIG_BYTES).read_to_string(&mut text))
                    .map_err(|error| format!("could not read {}: {error}", relative.display()))?;
                crate::sandbox::atomic_write(
                    &destination_root.join(relative),
                    sanitized_git_config(&text).as_bytes(),
                )?;
                bytes_done = bytes_done.saturating_add(*size);
            }
        }
        entries_done += 1;
        reporter.report(progress(entries_done, bytes_done), false);
    }
    reporter.report(progress(plan.entries, plan.bytes), true);
    Ok(())
}

fn set_foreign_manifest_aside(destination_root: &Path) -> Result<(), String> {
    let manifest = destination_root.join(crate::project_location::MANIFEST_FILE);
    if !manifest.is_file() {
        return Ok(());
    }
    for attempt in 1..=1_000_u32 {
        let name = if attempt == 1 {
            format!("{FOREIGN_MANIFEST_STEM}.json")
        } else {
            format!("{FOREIGN_MANIFEST_STEM}-{attempt}.json")
        };
        let target = destination_root.join(name);
        if std::fs::symlink_metadata(&target).is_ok() {
            continue;
        }
        return std::fs::rename(&manifest, &target)
            .map_err(|error| format!("could not set the folder's project.json aside: {error}"));
    }
    Err("could not find a free name for the folder's project.json".into())
}

pub(crate) fn copy_folder_into_library(
    project_id: &str,
    limits: CopyLimits,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(CopyProgress),
) -> Result<CopiedIntoLibrary, String> {
    crate::paths::validate_project_id(project_id)?;
    if crate::project_location::kind_of(project_id)? != crate::project_location::ProjectKind::Linked
    {
        return Err(AppError::new("project.copy_needs_folder").into());
    }
    let location = crate::project_location::locate(project_id).map_err(String::from)?;
    let mut reporter = Reporter {
        sink: progress,
        cancel,
        last: None,
        last_entries: 0,
        last_bytes: 0,
        bytes_step: u64::MAX,
    };
    reporter.report(
        CopyProgress {
            phase: CopyPhase::Counting,
            entries_done: 0,
            entries_total: 0,
            bytes_done: 0,
            bytes_total: 0,
        },
        true,
    );
    let mut left_out = 0;
    let copied = crate::project::create_library_project_with(|copied, staging| {
        let _source = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
        let foreign = matches!(
            crate::project_manifest::route_project(project_id)?,
            crate::project_manifest::Route::Sidecar { foreign: true, .. }
        );
        let mut meta = crate::project::read_meta(project_id)?;
        let restricted = !crate::trust::project_trust(project_id)
            .is_ok_and(crate::trust::TrustState::is_trusted);
        let mut plan = Plan {
            items: Vec::new(),
            entries: 0,
            bytes: 0,
            git_entries: 0,
            left_out: 0,
        };
        scan(
            &location.root,
            Path::new(""),
            false,
            limits,
            &mut plan,
            &mut reporter,
        )?;
        copy_planned(&location.root, staging, &plan, &mut reporter)?;
        reporter.check()?;
        if foreign {
            set_foreign_manifest_aside(staging)?;
        }
        meta.allow_shell_escape = false;
        meta.hidden = false;
        meta.forked_from = None;
        crate::project::write_meta_at(
            &staging.join(crate::project_location::MANIFEST_FILE),
            &meta,
        )?;
        if restricted {
            crate::trust::mark_library_restricted(copied)?;
        }
        left_out = plan.left_out;
        Ok(())
    })?;
    crate::project::initialize_git_for_project_quietly(&copied);
    Ok(CopiedIntoLibrary {
        project_id: copied,
        left_out,
    })
}

fn running() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    RUNNING.get_or_init(Default::default)
}

fn valid_operation_id(operation_id: &str) -> bool {
    !operation_id.is_empty()
        && operation_id.len() <= 64
        && operation_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

#[tauri::command]
pub async fn copy_linked_into_library(
    project_id: String,
    operation_id: String,
    on_progress: tauri::ipc::Channel<CopyProgress>,
) -> Result<CopiedIntoLibrary, String> {
    if !valid_operation_id(&operation_id) {
        return Err("this copy has an invalid operation id".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut running = running().lock().unwrap_or_else(PoisonError::into_inner);
        if running.contains_key(&operation_id) {
            return Err("this copy is already running".into());
        }
        running.insert(operation_id.clone(), Arc::clone(&cancel));
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        copy_folder_into_library(&project_id, COPY_LIMITS, &cancel, &mut |progress| {
            let _ = on_progress.send(progress);
        })
    })
    .await
    .map_err(|error| format!("the copy stopped unexpectedly: {error}"));
    running()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(&operation_id);
    result?
}

#[tauri::command]
pub async fn cancel_copy_into_library(operation_id: String) -> bool {
    running()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(&operation_id)
        .map(|cancel| cancel.store(true, Ordering::SeqCst))
        .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::linked_registry::folder_snapshot_for_test;
    use crate::trust::testing::LinkedFixture;
    use crate::trust::TrustScope;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::Ordering;

    fn copy(project_id: &str) -> Result<String, String> {
        copy_folder_into_library(
            project_id,
            COPY_LIMITS,
            &AtomicBool::new(false),
            &mut |_| {},
        )
        .map(|copied| copied.project_id)
    }

    fn library_ids() -> Vec<String> {
        let mut ids: Vec<String> = std::fs::read_dir(crate::paths::projects_root().unwrap())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        ids.sort();
        ids
    }

    fn write(root: &Path, relative: &str, contents: &str) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    fn thesis(fixture: &LinkedFixture) -> (String, PathBuf) {
        let (project_id, folder) = fixture.link("thesis");
        write(
            &folder,
            "main.tex",
            "\\documentclass{article}\\begin{document}Hi\\end{document}",
        );
        write(&folder, "chapters/intro.tex", "Intro");
        write(&folder, "figures/plot.pdf", "%PDF");
        write(&folder, ".gitignore", "*.aux\n");
        write(&folder, ".oleafly/build/main.pdf", "%PDF stale");
        write(&folder, ".main.tex.oleafly-12-1-abcd.tmp", "half saved");
        (project_id, folder)
    }

    #[test]
    fn a_copy_brings_the_files_and_this_devices_settings_but_not_oleafly_state() {
        let fixture = LinkedFixture::new();
        let (source, folder) = thesis(&fixture);
        tauri::async_runtime::block_on(crate::project::rename_project(
            source.clone(),
            "My thesis".into(),
        ))
        .unwrap();
        tauri::async_runtime::block_on(crate::project::set_project_color(
            source.clone(),
            "#224466".into(),
        ))
        .unwrap();
        let before = folder_snapshot_for_test(&folder);

        let copied = copy(&source).unwrap();

        let root = crate::paths::project_dir(&copied).unwrap();
        assert_ne!(copied, source);
        assert!(!crate::linked_registry::is_linked_id(&copied));
        assert_eq!(
            std::fs::read_to_string(root.join("chapters/intro.tex")).unwrap(),
            "Intro"
        );
        assert!(root.join("figures/plot.pdf").is_file());
        assert!(root.join(".gitignore").is_file());
        assert!(!root.join(".oleafly").join("build").exists());
        assert!(!root.join(".main.tex.oleafly-12-1-abcd.tmp").exists());
        let meta = crate::project::read_meta(&copied).unwrap();
        assert_eq!(
            (
                meta.name.as_str(),
                meta.main_doc.as_str(),
                meta.color.as_str()
            ),
            ("My thesis", "main.tex", "#224466")
        );
        assert!(!meta.allow_shell_escape && !meta.hidden);
        assert_eq!(folder_snapshot_for_test(&folder), before);
        let listed = crate::project::list_projects_blocking().unwrap();
        let entry = listed.iter().find(|project| project.id == copied).unwrap();
        assert_eq!(
            serde_json::to_value(&entry.location).unwrap(),
            serde_json::json!({ "kind": "library" })
        );
        assert!(listed.iter().any(|project| project.id == source));
    }

    #[test]
    fn a_copy_of_an_untrusted_folder_stays_untrusted_and_a_trusted_one_does_not() {
        let fixture = LinkedFixture::new();
        let (restricted, _) = thesis(&fixture);
        let (trusted, trusted_folder) = fixture.link("trusted");
        write(&trusted_folder, "main.tex", "\\documentclass{article}");
        fixture.trust(&trusted, TrustScope::Folder);

        let restricted_copy = copy(&restricted).unwrap();
        let trusted_copy = copy(&trusted).unwrap();

        assert!(!crate::trust::is_trusted(&restricted));
        assert!(!crate::trust::is_trusted(&restricted_copy));
        assert!(crate::trust::is_trusted(&trusted_copy));
        assert!(!crate::paths::project_dir(&restricted_copy)
            .unwrap()
            .join(".git")
            .exists());
    }

    #[test]
    fn git_history_comes_along_without_config_hooks_or_worktrees() {
        let fixture = LinkedFixture::new();
        let (source, folder) = thesis(&fixture);
        write(&folder, ".git/HEAD", "ref: refs/heads/main\n");
        write(
            &folder,
            ".git/config",
            "[core]\n\trepositoryformatversion = 1\n\tfsmonitor = touch /tmp/sentinel\n\thooksPath = .husky\n[extensions]\n\tobjectformat = sha256\n\tworktreeconfig = true\n[remote \"origin\"]\n\turl = https://example.com/thesis.git\n[filter \"lfs\"]\n\tclean = git-lfs clean -- %f\n",
        );
        write(&folder, ".git/objects/ab/cdef0123", "object");
        write(&folder, ".git/refs/heads/main", "abcdef\n");
        write(&folder, ".git/packed-refs", "# pack-refs\n");
        write(&folder, ".git/index", "index");
        write(
            &folder,
            ".git/hooks/pre-commit",
            "#!/bin/sh\ntouch /tmp/sentinel\n",
        );
        write(&folder, ".git/worktrees/other/gitdir", "/elsewhere/.git\n");
        write(&folder, ".git/modules/sub/HEAD", "ref: refs/heads/main\n");
        write(
            &folder,
            ".git/modules/sub/config",
            "[core]\n\tfsmonitor = true\n",
        );
        write(
            &folder,
            ".git/modules/sub/hooks/post-checkout",
            "#!/bin/sh\n",
        );
        write(&folder, "sub/.git", "gitdir: ../.git/modules/sub\n");
        write(&folder, "sub/file.tex", "Sub");
        write(&folder, "vendor/lib/.git/HEAD", "ref: refs/heads/main\n");
        write(
            &folder,
            "vendor/lib/.git/config",
            "[core]\n\tsshCommand = evil\n",
        );
        write(&folder, "vendor/lib/.git/hooks/pre-push", "#!/bin/sh\n");
        write(&folder, "linked/.git", "gitdir: /somewhere/else/.git\n");
        write(&folder, "escaping/.git", "gitdir: ../../outside/.git\n");

        let copied = copy(&source).unwrap();

        let root = crate::paths::project_dir(&copied).unwrap();
        let git = root.join(".git");
        for kept in [
            "HEAD",
            "objects/ab/cdef0123",
            "refs/heads/main",
            "packed-refs",
            "index",
            "modules/sub/HEAD",
        ] {
            assert!(git.join(kept).is_file(), "{kept}");
        }
        for dropped in ["hooks", "worktrees", "modules/sub/hooks"] {
            assert!(!git.join(dropped).exists(), "{dropped}");
        }
        assert!(!root.join("vendor/lib/.git/hooks").exists());
        assert!(root.join("vendor/lib/.git/HEAD").is_file());
        assert_eq!(
            std::fs::read_to_string(root.join("sub/.git")).unwrap(),
            "gitdir: ../.git/modules/sub\n"
        );
        assert!(!root.join("linked/.git").exists());
        assert!(!root.join("escaping/.git").exists());
        let config = std::fs::read_to_string(git.join("config")).unwrap();
        assert!(config.contains("repositoryformatversion = 1"), "{config}");
        assert!(config.contains("objectformat = sha256"), "{config}");
        assert!(config.contains("bare = false"), "{config}");
        for gone in [
            "fsmonitor",
            "hooksPath",
            "worktreeconfig",
            "remote",
            "filter",
            "example.com",
        ] {
            assert!(!config.contains(gone), "{gone} in {config}");
        }
        let module = std::fs::read_to_string(git.join("modules/sub/config")).unwrap();
        assert!(!module.contains("fsmonitor"), "{module}");
        let nested = std::fs::read_to_string(root.join("vendor/lib/.git/config")).unwrap();
        assert!(!nested.contains("sshCommand"), "{nested}");
        assert!(folder.join(".git/hooks/pre-commit").is_file());
    }

    #[test]
    fn a_foreign_project_json_is_set_aside_and_an_oleafly_manifest_is_replaced() {
        let fixture = LinkedFixture::new();
        let (foreign, foreign_folder) = fixture.link("workspace");
        write(&foreign_folder, "paper.tex", "\\documentclass{article}");
        write(
            &foreign_folder,
            "project.json",
            crate::project_manifest::NX_PROJECT_JSON,
        );
        write(&foreign_folder, "project.external.json", "{\"taken\":true}");
        crate::project::set_main_doc_for_test(&foreign, "paper.tex");
        let (declared, declared_folder) = fixture.link("declared");
        write(&declared_folder, "report.tex", "\\documentclass{article}");
        oleafly_core::Workspace::init(
            &declared_folder,
            oleafly_core::InitOptions {
                name: Some("Shared report".into()),
                main_document: Some("report.tex".into()),
                ..Default::default()
            },
        )
        .unwrap();

        let foreign_copy = copy(&foreign).unwrap();
        let declared_copy = copy(&declared).unwrap();

        let foreign_root = crate::paths::project_dir(&foreign_copy).unwrap();
        assert_eq!(
            std::fs::read_to_string(foreign_root.join("project.external-2.json")).unwrap(),
            crate::project_manifest::NX_PROJECT_JSON
        );
        assert_eq!(
            std::fs::read_to_string(foreign_root.join("project.external.json")).unwrap(),
            "{\"taken\":true}"
        );
        let foreign_meta = crate::project::read_meta(&foreign_copy).unwrap();
        assert_eq!(foreign_meta.main_doc, "paper.tex");
        assert_eq!(foreign_meta.name, "workspace");
        let declared_meta = crate::project::read_meta(&declared_copy).unwrap();
        assert_eq!(
            (declared_meta.name.as_str(), declared_meta.main_doc.as_str()),
            ("Shared report", "report.tex")
        );
        assert_eq!(
            std::fs::read_to_string(foreign_folder.join("project.json")).unwrap(),
            crate::project_manifest::NX_PROJECT_JSON
        );
    }

    #[test]
    fn copies_over_either_limit_are_refused_before_anything_is_written() {
        let fixture = LinkedFixture::new();
        let (source, folder) = thesis(&fixture);
        write(&folder, "data/big.csv", &"x".repeat(4096));
        let before = library_ids();

        let too_many = copy_folder_into_library(
            &source,
            CopyLimits {
                max_entries: 4,
                max_bytes: COPY_LIMITS.max_bytes,
            },
            &AtomicBool::new(false),
            &mut |_| {},
        )
        .unwrap_err();
        let too_large = copy_folder_into_library(
            &source,
            CopyLimits {
                max_entries: COPY_LIMITS.max_entries,
                max_bytes: 1024,
            },
            &AtomicBool::new(false),
            &mut |_| {},
        )
        .unwrap_err();

        assert!(too_many.contains("project.copy_entry_limit"), "{too_many}");
        assert!(too_large.contains("project.copy_size_limit"), "{too_large}");
        assert_eq!(library_ids(), before);
    }

    #[test]
    fn progress_counts_up_to_the_total_and_a_cancel_leaves_nothing_behind() {
        let fixture = LinkedFixture::new();
        let (source, folder) = thesis(&fixture);
        for index in 0..40 {
            write(&folder, &format!("sections/part-{index}.tex"), "Part");
        }
        let mut events = Vec::new();
        let copied = copy_folder_into_library(
            &source,
            COPY_LIMITS,
            &AtomicBool::new(false),
            &mut |progress| events.push(progress),
        )
        .unwrap()
        .project_id;
        let last = events.last().unwrap();
        assert_eq!(events.first().unwrap().phase, CopyPhase::Counting);
        assert_eq!(last.phase, CopyPhase::Copying);
        assert_eq!(last.entries_done, last.entries_total);
        assert_eq!(last.bytes_done, last.bytes_total);
        assert!(last.entries_total >= 44);
        assert!(events
            .windows(2)
            .all(|pair| pair[0].entries_done <= pair[1].entries_done
                || pair[0].phase != pair[1].phase));
        let before = library_ids();
        assert!(before.contains(&copied));

        let cancel = AtomicBool::new(false);
        let cancelled = copy_folder_into_library(&source, COPY_LIMITS, &cancel, &mut |progress| {
            if progress.phase == CopyPhase::Copying && progress.entries_done > 3 {
                cancel.store(true, Ordering::SeqCst);
            }
        })
        .unwrap_err();

        assert!(cancelled.contains("project.copy_cancelled"), "{cancelled}");
        assert_eq!(library_ids(), before);
    }

    #[test]
    fn a_copy_cut_off_midway_never_leaves_a_trusted_project_in_the_library() {
        let fixture = LinkedFixture::new();
        let (source, folder) = thesis(&fixture);
        oleafly_core::Workspace::init(
            &folder,
            oleafly_core::InitOptions {
                name: Some("Thesis".into()),
                main_document: Some("main.tex".into()),
                ..Default::default()
            },
        )
        .unwrap();
        for index in 0..40 {
            write(&folder, &format!("sections/part-{index}.tex"), "Part");
        }
        let projects = crate::paths::projects_root().unwrap();
        let before = library_ids();
        let mut seen = 0;
        let mut exposed = Vec::new();

        let copied = copy_folder_into_library(
            &source,
            COPY_LIMITS,
            &AtomicBool::new(false),
            &mut |progress| {
                if progress.phase != CopyPhase::Copying || progress.entries_done == 0 {
                    return;
                }
                seen += 1;
                for id in library_ids() {
                    if before.contains(&id) || crate::paths::validate_project_id(&id).is_err() {
                        continue;
                    }
                    if projects.join(&id).join("project.json").is_file()
                        && crate::trust::is_trusted(&id)
                    {
                        exposed.push(id);
                    }
                }
            },
        )
        .unwrap()
        .project_id;

        assert!(seen > 1, "{seen}");
        assert!(exposed.is_empty(), "{exposed:?}");
        assert!(!crate::trust::is_trusted(&copied));
        assert_eq!(
            library_ids()
                .into_iter()
                .filter(|id| !before.contains(id))
                .collect::<Vec<_>>(),
            vec![copied]
        );
    }

    #[test]
    fn the_rebuilt_git_config_keeps_what_git_init_learned_about_the_disk() {
        let config = sanitized_git_config(
            "[core]\n\tignorecase = true\n\tprecomposeUnicode = TRUE ; set by git init\n\tsymlinks = false\n\tfsmonitor = true\n",
        );
        for kept in [
            "ignorecase = true",
            "precomposeunicode = true",
            "symlinks = false",
        ] {
            assert!(config.contains(kept), "{kept} missing from {config}");
        }
        assert!(!config.contains("fsmonitor"), "{config}");
        let odd = sanitized_git_config(
            "[core]\n\tignorecase = $(touch /tmp/x)\n\tsymlinks\n[remote \"origin\"]\n\tignorecase = false\n",
        );
        assert!(!odd.contains("ignorecase"), "{odd}");
        assert!(!odd.contains("symlinks"), "{odd}");
    }

    #[test]
    fn progress_moves_through_a_large_file_by_bytes() {
        let fixture = LinkedFixture::new();
        let (source, folder) = fixture.link("recordings");
        write(&folder, "main.tex", "\\documentclass{article}");
        std::fs::write(folder.join("audio.wav"), vec![7_u8; 4 * CHUNK_BYTES + 17]).unwrap();
        let mut events = Vec::new();

        copy_folder_into_library(
            &source,
            COPY_LIMITS,
            &AtomicBool::new(false),
            &mut |progress| events.push(progress),
        )
        .unwrap();

        let copying: Vec<&CopyProgress> = events
            .iter()
            .filter(|progress| progress.phase == CopyPhase::Copying)
            .collect();
        let within_the_file = copying
            .iter()
            .filter(|progress| {
                progress.entries_done == 0
                    && progress.bytes_done > 0
                    && progress.bytes_done < progress.bytes_total
            })
            .count();
        assert!(within_the_file >= 3, "{copying:?}");
        assert!(copying
            .windows(2)
            .all(|pair| pair[0].bytes_done <= pair[1].bytes_done));
        let last = copying.last().unwrap();
        assert_eq!(last.bytes_done, last.bytes_total);
    }

    #[test]
    fn the_item_limit_says_when_git_history_pushed_a_folder_over_it() {
        let fixture = LinkedFixture::new();
        let (plain, plain_folder) = thesis(&fixture);
        let (tracked, tracked_folder) = fixture.link("tracked");
        write(&tracked_folder, "main.tex", "\\documentclass{article}");
        write(&tracked_folder, ".git/HEAD", "ref: refs/heads/main\n");
        for index in 0..12 {
            write(&plain_folder, &format!("notes/note-{index}.md"), "Note");
            write(
                &tracked_folder,
                &format!(".git/objects/{index:02x}/{index:038x}"),
                "object",
            );
        }
        let limits = CopyLimits {
            max_entries: 10,
            max_bytes: COPY_LIMITS.max_bytes,
        };
        let refuse = |project_id: &str| {
            copy_folder_into_library(project_id, limits, &AtomicBool::new(false), &mut |_| {})
                .unwrap_err()
        };

        let plain_error = refuse(&plain);
        let tracked_error = refuse(&tracked);

        assert!(
            plain_error.contains("\"project.copy_entry_limit\""),
            "{plain_error}"
        );
        assert!(
            tracked_error.contains("\"project.copy_entry_limit_git\""),
            "{tracked_error}"
        );
    }

    #[test]
    fn items_nested_too_deep_are_counted_as_left_out() {
        let fixture = LinkedFixture::new();
        let (source, folder) = thesis(&fixture);
        let deepest: PathBuf = std::iter::repeat_n("d", crate::project::MAX_WALK_DEPTH).collect();
        write(&folder, &deepest.join("a.tex").to_string_lossy(), "A");
        write(&folder, &deepest.join("b.tex").to_string_lossy(), "B");

        let copied =
            copy_folder_into_library(&source, COPY_LIMITS, &AtomicBool::new(false), &mut |_| {})
                .unwrap();

        assert_eq!(copied.left_out, 2);
        let root = crate::paths::project_dir(&copied.project_id).unwrap();
        assert!(root.join("main.tex").is_file());
        assert!(!root.join(&deepest).join("a.tex").exists());
        assert_eq!(
            copy_folder_into_library(&source, COPY_LIMITS, &AtomicBool::new(false), &mut |_| {})
                .map(|again| again.left_out),
            Ok(2)
        );
    }

    #[cfg(unix)]
    #[test]
    fn links_are_left_out_and_counted() {
        let fixture = LinkedFixture::new();
        let (source, folder) = thesis(&fixture);
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("library.bib"), "@book{a,}").unwrap();
        std::os::unix::fs::symlink(outside.path().join("library.bib"), folder.join("refs.bib"))
            .unwrap();
        std::os::unix::fs::symlink(outside.path(), folder.join("shared")).unwrap();

        let copied =
            copy_folder_into_library(&source, COPY_LIMITS, &AtomicBool::new(false), &mut |_| {})
                .unwrap();

        assert_eq!(copied.left_out, 2);
        let root = crate::paths::project_dir(&copied.project_id).unwrap();
        assert!(std::fs::symlink_metadata(root.join("refs.bib")).is_err());
        assert!(std::fs::symlink_metadata(root.join("shared")).is_err());
        assert_eq!(
            copy_folder_into_library(&source, COPY_LIMITS, &AtomicBool::new(false), &mut |_| {})
                .map(|again| again.left_out),
            Ok(2)
        );
        let (plain, _) = fixture.link("plain");
        assert_eq!(
            copy_folder_into_library(&plain, COPY_LIMITS, &AtomicBool::new(false), &mut |_| {})
                .map(|copied| copied.left_out),
            Ok(0)
        );
    }

    #[test]
    fn only_available_folders_can_be_copied() {
        let fixture = LinkedFixture::new();
        let (source, folder) = thesis(&fixture);
        crate::paths::create_project_dir("library-paper").unwrap();
        std::fs::remove_dir_all(&folder).unwrap();
        let before = library_ids();

        let missing = copy(&source).unwrap_err();
        let library = copy("library-paper").unwrap_err();

        assert!(missing.contains("project.linked_missing"), "{missing}");
        assert!(library.contains("project.copy_needs_folder"), "{library}");
        assert_eq!(library_ids(), before);
    }
}
