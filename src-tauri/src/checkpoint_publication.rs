//! Durable Checkpoint publication outcome shared by compile IPC and the UI.

use oleafly_core::CheckpointPolicy;
use oleafly_history::{Candidate, CaptureInput, ContentHash, ReplayedInput};
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::Emitter as _;

const MAX_DEPENDENCY_REPORT_BYTES: usize = 4 * 1024 * 1024;
const MAX_DEPENDENCY_COUNT: usize = 10_000;
const MAX_TECTONIC_BUNDLE_INDEX_BYTES: u64 = 64 * 1024 * 1024;
const MAX_TECTONIC_CACHE_FILE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_TECTONIC_CACHE_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_TECTONIC_CACHE_FILES: usize = 100_000;
const MAX_TECTONIC_CACHE_DESCRIPTOR_BYTES: usize = 32 * 1024 * 1024;
const TECTONIC_CACHE_LOCK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);
const TECTONIC_CACHE_LOCK_RETRY: std::time::Duration = std::time::Duration::from_millis(50);

const CACHE_FINGERPRINT_SETTLE: std::time::Duration = std::time::Duration::from_secs(2);
const PUBLICATION_DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const PUBLICATION_DRAIN_POLL: std::time::Duration = std::time::Duration::from_millis(50);
const PUBLICATION_START_DELAY: std::time::Duration = std::time::Duration::from_millis(1500);

/// Why a successful compile could not publish a durable Checkpoint.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckpointSkipReason {
    InvalidPolicy,
    DependencyEvidenceUnavailable,
    UntrackedExternalCommands,
    ExternalDependency,
    InsufficientSpace,
}

/// Publication is supplementary to compilation. A skipped outcome never
/// changes an otherwise successful compile into a failure.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CheckpointPublicationOutcome {
    #[default]
    NotAttempted,
    Scheduled,
    Unchanged,
    Published {
        snapshot_root: String,
        created: bool,
    },
    PublishedDurabilityUncertain {
        snapshot_root: String,
        created: bool,
    },
    Skipped {
        reason: CheckpointSkipReason,
        message: String,
        suggestion: String,
    },
}

impl CheckpointPublicationOutcome {
    fn skipped(
        reason: CheckpointSkipReason,
        message: impl Into<String>,
        suggestion: impl Into<String>,
    ) -> Self {
        Self::Skipped {
            reason,
            message: message.into(),
            suggestion: suggestion.into(),
        }
    }
}

#[derive(Debug, Eq, PartialEq)]
struct AdapterFailure {
    reason: CheckpointSkipReason,
    detail: String,
}

impl AdapterFailure {
    fn unavailable(detail: impl Into<String>) -> Self {
        Self {
            reason: CheckpointSkipReason::DependencyEvidenceUnavailable,
            detail: detail.into(),
        }
    }

    fn external(detail: impl Into<String>) -> Self {
        Self {
            reason: CheckpointSkipReason::ExternalDependency,
            detail: detail.into(),
        }
    }
}

fn ensure_checkpoint_not_cancelled(
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<(), AdapterFailure> {
    if cancel.is_some_and(crate::state::CompileCancel::is_requested) {
        return Err(AdapterFailure::unavailable(
            "checkpoint publication was cancelled",
        ));
    }
    Ok(())
}

struct CheckpointCancelScope<'a> {
    cancel: Option<&'a crate::state::CompileCancel>,
}

impl<'a> CheckpointCancelScope<'a> {
    fn new(cancel: Option<&'a crate::state::CompileCancel>) -> Self {
        if let Some(cancel) = cancel {
            cancel.begin();
        }
        Self { cancel }
    }
}

impl Drop for CheckpointCancelScope<'_> {
    fn drop(&mut self) {
        if let Some(cancel) = self.cancel {
            let _ = cancel.detach();
        }
    }
}

#[derive(Clone, Copy)]
enum TectonicDependencyLayout<'a> {
    ProjectNamesRebasedFrom(&'a Path),
    ResolvedPaths,
}

fn is_protected_project_component(component: &str) -> bool {
    component.eq_ignore_ascii_case(".git")
        || component.eq_ignore_ascii_case(".oleafly")
        || component.eq_ignore_ascii_case("node_modules")
}

fn validate_report_size(bytes: &[u8]) -> Result<(), AdapterFailure> {
    if bytes.is_empty() {
        return Err(AdapterFailure::unavailable(
            "the compiler dependency report is empty",
        ));
    }
    if bytes.len() > MAX_DEPENDENCY_REPORT_BYTES {
        return Err(AdapterFailure::unavailable(
            "the compiler dependency report exceeds the safety limit",
        ));
    }
    Ok(())
}

fn portable_relative(path: &Path) -> Result<String, AdapterFailure> {
    let mut parts = Vec::new();
    for component in path.components() {
        let Component::Normal(part) = component else {
            return Err(AdapterFailure::unavailable(format!(
                "compiler reported an unsafe project path {}",
                path.display()
            )));
        };
        let part = part.to_str().ok_or_else(|| {
            AdapterFailure::unavailable("compiler reported a non-Unicode project path")
        })?;
        if part.is_empty() || part.chars().any(char::is_control) {
            return Err(AdapterFailure::unavailable(
                "compiler reported an unsafe project path",
            ));
        }
        if is_protected_project_component(part) {
            return Err(AdapterFailure::unavailable(
                "compiler read protected project metadata",
            ));
        }
        parts.push(part);
    }
    if parts.is_empty() {
        return Err(AdapterFailure::unavailable(
            "compiler reported the project directory as a file",
        ));
    }
    let relative = parts.join("/");
    Ok(relative)
}

fn normalize_project_dependency(raw: &Path, project_root: &Path) -> Result<String, AdapterFailure> {
    let canonical_root = project_root.canonicalize().map_err(|error| {
        AdapterFailure::unavailable(format!("could not resolve the project root: {error}"))
    })?;
    let lexical = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        canonical_root.join(raw)
    };
    let canonical = lexical.canonicalize().map_err(|error| {
        AdapterFailure::unavailable(format!(
            "compiler dependency {} could not be resolved: {error}",
            lexical.display()
        ))
    })?;
    if !canonical.starts_with(&canonical_root) {
        return Err(AdapterFailure::external(format!(
            "compiler read {} outside the project",
            canonical.display()
        )));
    }
    let metadata = std::fs::metadata(&canonical).map_err(|error| {
        AdapterFailure::unavailable(format!(
            "compiler dependency {} could not be inspected: {error}",
            canonical.display()
        ))
    })?;
    if !metadata.is_file() {
        return Err(AdapterFailure::unavailable(format!(
            "compiler dependency {} is not a regular file",
            canonical.display()
        )));
    }
    let lexical_relative = lexical
        .strip_prefix(&canonical_root)
        .or_else(|_| canonical.strip_prefix(&canonical_root))
        .map_err(|_| {
            AdapterFailure::external(format!(
                "compiler read {} outside the project",
                lexical.display()
            ))
        })?;
    portable_relative(lexical_relative)
}

fn insert_dependency(
    dependencies: &mut BTreeSet<String>,
    dependency: String,
) -> Result<(), AdapterFailure> {
    dependencies.insert(dependency);
    if dependencies.len() > MAX_DEPENDENCY_COUNT {
        return Err(AdapterFailure::unavailable(
            "the compiler reported too many project inputs",
        ));
    }
    Ok(())
}

fn path_is_inside_any(path: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| path.starts_with(root))
}

fn is_reserved_device_name(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let stem = name.split('.').next().unwrap_or(name).to_ascii_lowercase();
    matches!(stem.as_str(), "nul" | "con" | "prn" | "aux")
        || (stem.len() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && stem.as_bytes()[3].is_ascii_digit())
}

fn is_known_unix_device(path: &Path) -> bool {
    matches!(
        path.to_str(),
        Some("/dev/null" | "/dev/zero" | "/dev/full" | "/dev/random" | "/dev/urandom" | "/dev/tty")
    )
}

fn is_device_input(path: &Path) -> bool {
    if is_known_unix_device(path) {
        return true;
    }
    if cfg!(windows) {
        if path.to_string_lossy().eq_ignore_ascii_case(r"\\.\nul") {
            return true;
        }
        if is_reserved_device_name(path) {
            return true;
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileTypeExt;
        if let Ok(metadata) = std::fs::metadata(path) {
            return metadata.file_type().is_char_device();
        }
    }
    false
}

fn path_is_lexically_inside_any(path: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| {
        path.strip_prefix(root).is_ok_and(|relative| {
            !relative.as_os_str().is_empty()
                && relative
                    .components()
                    .all(|component| matches!(component, Component::Normal(_)))
        })
    })
}

fn parse_tectonic_dependencies(
    bytes: &[u8],
    project_root: &Path,
    layout: TectonicDependencyLayout<'_>,
    generated_roots: &[PathBuf],
) -> Result<Vec<String>, AdapterFailure> {
    validate_report_size(bytes)?;
    let report = std::str::from_utf8(bytes)
        .map_err(|_| AdapterFailure::unavailable("Tectonic emitted a non-UTF-8 report"))?;
    let (targets, rest) = report
        .split_once(" : ")
        .ok_or_else(|| AdapterFailure::unavailable("Tectonic emitted malformed makefile rules"))?;
    if targets.trim().is_empty() || !report.ends_with('\n') {
        return Err(AdapterFailure::unavailable(
            "Tectonic did not finish its dependency report",
        ));
    }

    let mut raw_dependencies = Vec::new();
    for (index, line) in rest.lines().enumerate() {
        let value = line.trim().strip_suffix('\\').unwrap_or(line.trim()).trim();
        if value.is_empty() {
            continue;
        }
        if index == 0 || line.starts_with(char::is_whitespace) {
            raw_dependencies.push((index == 0, PathBuf::from(value)));
        } else {
            return Err(AdapterFailure::unavailable(
                "Tectonic emitted ambiguous makefile rules",
            ));
        }
    }

    let canonical_generated = generated_roots
        .iter()
        .map(|root| root.canonicalize().unwrap_or_else(|_| root.to_path_buf()))
        .collect::<Vec<_>>();
    let mut dependencies = BTreeSet::new();
    for (is_primary, raw) in raw_dependencies {
        let absolute = if raw.is_absolute() {
            raw.clone()
        } else {
            project_root.join(&raw)
        };
        if is_primary
            && (path_is_lexically_inside_any(&absolute, generated_roots)
                || path_is_lexically_inside_any(&absolute, &canonical_generated))
        {
            continue;
        }
        if is_device_input(&absolute) {
            continue;
        }
        let exists = absolute.exists();
        if matches!(layout, TectonicDependencyLayout::ResolvedPaths)
            && !is_primary
            && !exists
            && (path_is_lexically_inside_any(&absolute, generated_roots)
                || path_is_lexically_inside_any(&absolute, &canonical_generated))
        {
            continue;
        }
        if exists {
            let canonical = absolute
                .canonicalize()
                .unwrap_or_else(|_| absolute.to_path_buf());
            if path_is_inside_any(&canonical, &canonical_generated) {
                continue;
            }
        }

        let project_path = match layout {
            TectonicDependencyLayout::ProjectNamesRebasedFrom(output_root) => {
                if let Ok(relative) = raw.strip_prefix(output_root) {
                    project_root.join(relative)
                } else {
                    raw
                }
            }
            TectonicDependencyLayout::ResolvedPaths => raw,
        };
        insert_dependency(
            &mut dependencies,
            normalize_project_dependency(&project_path, project_root)?,
        )?;
    }
    Ok(dependencies.into_iter().collect())
}

fn parse_typst_dependencies(
    bytes: &[u8],
    project_root: &Path,
) -> Result<Vec<String>, AdapterFailure> {
    validate_report_size(bytes)?;
    if bytes.last() != Some(&0) {
        return Err(AdapterFailure::unavailable(
            "Typst did not finish its dependency report",
        ));
    }
    let mut dependencies = BTreeSet::new();
    for raw in bytes
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
    {
        let raw = std::str::from_utf8(raw)
            .map_err(|_| AdapterFailure::unavailable("Typst reported a non-Unicode path"))?;
        insert_dependency(
            &mut dependencies,
            normalize_project_dependency(Path::new(raw), project_root)?,
        )?;
    }
    if dependencies.is_empty() {
        return Err(AdapterFailure::unavailable(
            "Typst did not report the main document",
        ));
    }
    Ok(dependencies.into_iter().collect())
}

fn parse_pandoc_resources(
    bytes: &[u8],
    project_root: &Path,
) -> Result<Vec<String>, AdapterFailure> {
    validate_report_size(bytes)?;
    let entries: Vec<serde_json::Value> = serde_json::from_slice(bytes)
        .map_err(|_| AdapterFailure::unavailable("Pandoc emitted a malformed JSON log"))?;
    let mut dependencies = BTreeSet::new();
    for entry in entries {
        let event_type = entry
            .get("type")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if event_type.to_ascii_lowercase().contains("fetch") {
            let source = entry
                .get("path")
                .or_else(|| entry.get("from"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("an external resource");
            return Err(AdapterFailure::external(format!(
                "Pandoc fetched {source} outside the sealed project"
            )));
        }
        if event_type != "LoadedResource" {
            continue;
        }
        let source = entry
            .get("from")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| AdapterFailure::unavailable("Pandoc omitted a loaded resource path"))?;
        if source.contains("://") || source.starts_with("data:") || source.starts_with("file:") {
            return Err(AdapterFailure::external(format!(
                "Pandoc loaded a remote resource {source}"
            )));
        }
        insert_dependency(
            &mut dependencies,
            normalize_project_dependency(Path::new(source), project_root)?,
        )?;
    }
    Ok(dependencies.into_iter().collect())
}

fn wildcard_component_matches(pattern: &str, candidate: &str) -> bool {
    let pattern = pattern.to_ascii_lowercase().chars().collect::<Vec<_>>();
    let candidate = candidate.to_ascii_lowercase().chars().collect::<Vec<_>>();
    let (mut pattern_index, mut candidate_index) = (0, 0);
    let (mut star_index, mut star_candidate_index) = (None, 0);
    while candidate_index < candidate.len() {
        if pattern_index < pattern.len()
            && (pattern[pattern_index] == '?'
                || pattern[pattern_index] == candidate[candidate_index])
        {
            pattern_index += 1;
            candidate_index += 1;
        } else if pattern_index < pattern.len() && pattern[pattern_index] == '*' {
            star_index = Some(pattern_index);
            pattern_index += 1;
            star_candidate_index = candidate_index;
        } else if let Some(star) = star_index {
            pattern_index = star + 1;
            star_candidate_index += 1;
            candidate_index = star_candidate_index;
        } else {
            return false;
        }
    }
    while pattern_index < pattern.len() && pattern[pattern_index] == '*' {
        pattern_index += 1;
    }
    pattern_index == pattern.len()
}

fn count_always_include_entry(inspected: &mut usize) -> Result<(), AdapterFailure> {
    *inspected += 1;
    if *inspected > 100_000 {
        return Err(AdapterFailure::unavailable(
            "always-include traversal exceeded the entry safety limit",
        ));
    }
    Ok(())
}

fn include_policy_file(
    project_root: &Path,
    path: &Path,
    policy: &CheckpointPolicy,
    included: &mut BTreeSet<String>,
) -> Result<(), AdapterFailure> {
    let relative = path
        .strip_prefix(project_root)
        .map_err(|_| AdapterFailure::unavailable("always-include traversal escaped the project"))?;
    let portable = portable_relative(relative)?;
    if policy.is_ignored(&portable) {
        return Err(AdapterFailure::unavailable(format!(
            "checkpoint policy both includes and ignores {portable}"
        )));
    }
    included.insert(portable);
    Ok(())
}

fn collect_literal_policy_subtree(
    project_root: &Path,
    root: &Path,
    policy: &CheckpointPolicy,
    included: &mut BTreeSet<String>,
    inspected: &mut usize,
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<(), AdapterFailure> {
    let mut pending = vec![(root.to_path_buf(), 0_usize)];
    while let Some((directory, depth)) = pending.pop() {
        ensure_checkpoint_not_cancelled(cancel)?;
        if depth > 64 {
            return Err(AdapterFailure::unavailable(
                "always-include traversal exceeded the safety depth",
            ));
        }
        for entry in std::fs::read_dir(&directory).map_err(|error| {
            AdapterFailure::unavailable(format!(
                "could not inspect always-include directory {}: {error}",
                directory.display()
            ))
        })? {
            count_always_include_entry(inspected)?;
            let entry = entry.map_err(|error| {
                AdapterFailure::unavailable(format!(
                    "could not inspect an always-include entry: {error}"
                ))
            })?;
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                return Err(AdapterFailure::unavailable(
                    "always-include path is not Unicode",
                ));
            };
            if is_protected_project_component(&name) {
                continue;
            }
            let path = entry.path();
            let metadata = std::fs::symlink_metadata(&path).map_err(|error| {
                AdapterFailure::unavailable(format!(
                    "could not inspect always-include path {}: {error}",
                    path.display()
                ))
            })?;
            if metadata.file_type().is_symlink() || metadata_is_reparse_point(&metadata) {
                let relative = path.strip_prefix(project_root).map_err(|_| {
                    AdapterFailure::unavailable("always-include traversal escaped the project")
                })?;
                return Err(AdapterFailure::external(format!(
                    "always-include path {} is a symbolic link",
                    portable_relative(relative)?
                )));
            }
            if metadata.is_dir() {
                pending.push((path, depth + 1));
            } else if metadata.is_file() {
                include_policy_file(project_root, &path, policy, included)?;
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn collect_policy_pattern(
    project_root: &Path,
    directory: &Path,
    segments: &[&str],
    segment_index: usize,
    contains_wildcard: bool,
    policy: &CheckpointPolicy,
    included: &mut BTreeSet<String>,
    inspected: &mut usize,
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<(), AdapterFailure> {
    ensure_checkpoint_not_cancelled(cancel)?;
    if segment_index > 64 {
        return Err(AdapterFailure::unavailable(
            "always-include pattern exceeded the safety depth",
        ));
    }
    for entry in std::fs::read_dir(directory).map_err(|error| {
        AdapterFailure::unavailable(format!(
            "could not inspect always-include directory {}: {error}",
            directory.display()
        ))
    })? {
        count_always_include_entry(inspected)?;
        let entry = entry.map_err(|error| {
            AdapterFailure::unavailable(format!(
                "could not inspect an always-include entry: {error}"
            ))
        })?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if is_protected_project_component(&name)
            || !wildcard_component_matches(segments[segment_index], &name)
        {
            continue;
        }
        let path = entry.path();
        let relative = path.strip_prefix(project_root).map_err(|_| {
            AdapterFailure::unavailable("always-include traversal escaped the project")
        })?;
        let portable = portable_relative(relative)?;
        let metadata = std::fs::symlink_metadata(&path).map_err(|error| {
            AdapterFailure::unavailable(format!(
                "could not inspect always-include path {}: {error}",
                path.display()
            ))
        })?;
        if metadata.file_type().is_symlink() || metadata_is_reparse_point(&metadata) {
            return Err(AdapterFailure::external(format!(
                "always-include path {portable} is a symbolic link"
            )));
        }
        let is_final = segment_index + 1 == segments.len();
        if !is_final {
            if metadata.is_dir() {
                collect_policy_pattern(
                    project_root,
                    &path,
                    segments,
                    segment_index + 1,
                    contains_wildcard,
                    policy,
                    included,
                    inspected,
                    cancel,
                )?;
            }
        } else if metadata.is_file() {
            include_policy_file(project_root, &path, policy, included)?;
        } else if metadata.is_dir() && !contains_wildcard {
            collect_literal_policy_subtree(
                project_root,
                &path,
                policy,
                included,
                inspected,
                cancel,
            )?;
        }
    }
    Ok(())
}

fn collect_always_included_files(
    project_root: &Path,
    policy: &CheckpointPolicy,
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<BTreeSet<String>, AdapterFailure> {
    if policy.always_include.is_empty() {
        return Ok(BTreeSet::new());
    }
    let mut included = BTreeSet::new();
    let mut inspected = 0_usize;
    for pattern in &policy.always_include {
        let segments = pattern.split('/').collect::<Vec<_>>();
        collect_policy_pattern(
            project_root,
            project_root,
            &segments,
            0,
            pattern.contains(['*', '?']),
            policy,
            &mut included,
            &mut inspected,
            cancel,
        )?;
    }
    Ok(included)
}

fn build_capture_inputs(
    project_root: &Path,
    dependencies: &[String],
    main_document: &str,
    policy: &CheckpointPolicy,
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<Vec<CaptureInput>, AdapterFailure> {
    ensure_checkpoint_not_cancelled(cancel)?;
    policy.validate().map_err(|error| {
        AdapterFailure::unavailable(format!("checkpoint policy is invalid: {error}"))
    })?;
    let required = dependencies.iter().cloned().collect::<BTreeSet<_>>();
    if !required.contains(main_document) {
        return Err(AdapterFailure::unavailable(
            "the compiler did not report the main document",
        ));
    }
    let mut all = collect_always_included_files(project_root, policy, cancel)?;
    all.extend(required.iter().cloned());
    all.insert("project.json".into());
    let mut inputs = Vec::with_capacity(all.len());
    for relative in all {
        ensure_checkpoint_not_cancelled(cancel)?;
        let path = project_root.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
        if required.contains(&relative) {
            let resolved = path.canonicalize().map_err(|error| {
                AdapterFailure::unavailable(format!(
                    "required compiler input {relative} could not be resolved: {error}"
                ))
            })?;
            let hash = if let Some(cancel) = cancel {
                ContentHash::digest_file_controlled(&path, cancel)
            } else {
                ContentHash::digest_file(&path)
            }
            .map_err(|error| {
                AdapterFailure::unavailable(format!(
                    "required compiler input {relative} could not be hashed: {error}"
                ))
            })?;
            let always_stored = relative == "project.json" || relative == main_document;
            let sealed = if always_stored || !policy.is_ignored(&relative) {
                CaptureInput::replay_required(relative, resolved, hash)
            } else {
                CaptureInput::replay_required_unstored(relative, resolved, hash)
            };
            inputs.push(sealed.map_err(|error| {
                AdapterFailure::unavailable(format!("required compiler input is unsafe: {error}"))
            })?);
        } else {
            inputs.push(CaptureInput::explicit(relative).map_err(|error| {
                AdapterFailure::unavailable(format!("explicit checkpoint input is unsafe: {error}"))
            })?);
        }
    }
    Ok(inputs)
}

fn replayed_inputs_for(
    candidate: &Candidate,
    dependencies: &[String],
) -> Result<Vec<ReplayedInput>, AdapterFailure> {
    let actual = dependencies.iter().cloned().collect::<BTreeSet<_>>();
    let expected = candidate
        .proven_files()
        .iter()
        .map(|file| file.relative_path.clone())
        .collect::<BTreeSet<_>>();
    if actual != expected {
        return Err(AdapterFailure::unavailable(
            "sealed replay dependency closure differs from discovery",
        ));
    }
    candidate
        .proven_files()
        .iter()
        .map(|file| {
            ReplayedInput::new(&file.relative_path, file.content_hash).map_err(|error| {
                AdapterFailure::unavailable(format!("replay evidence is invalid: {error}"))
            })
        })
        .collect()
}

struct ProbeWorkspace {
    root: PathBuf,
}

async fn wait_for_tectonic_cache_lock(
    file: std::fs::File,
    path: &Path,
    timeout: std::time::Duration,
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<std::fs::File, AdapterFailure> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if cancel.is_some_and(crate::state::CompileCancel::is_requested) {
            return Err(AdapterFailure::unavailable(
                "checkpoint publication was cancelled while waiting for the compiler cache",
            ));
        }
        match fs4::FileExt::try_lock(&file) {
            Ok(()) => {
                let opened = same_file::Handle::from_file(file.try_clone().map_err(|error| {
                    AdapterFailure::unavailable(format!(
                        "checkpoint compiler cache lock could not be cloned: {error}"
                    ))
                })?)
                .map_err(|error| {
                    AdapterFailure::unavailable(format!(
                        "checkpoint compiler cache lock identity is unavailable: {error}"
                    ))
                })?;
                let current = same_file::Handle::from_path(path).map_err(|error| {
                    AdapterFailure::unavailable(format!(
                        "checkpoint compiler cache lock identity could not be confirmed: {error}"
                    ))
                })?;
                if opened != current {
                    return Err(AdapterFailure::unavailable(
                        "checkpoint compiler cache lock changed while it was acquired",
                    ));
                }
                return Ok(file);
            }
            Err(fs4::TryLockError::WouldBlock) if tokio::time::Instant::now() < deadline => {
                tokio::time::sleep(TECTONIC_CACHE_LOCK_RETRY).await;
            }
            Err(fs4::TryLockError::WouldBlock) => {
                return Err(AdapterFailure::unavailable(
                    "another checkpoint is using the compiler cache",
                ));
            }
            Err(fs4::TryLockError::Error(error)) => {
                return Err(AdapterFailure::unavailable(format!(
                    "checkpoint compiler cache could not be locked: {error}"
                )));
            }
        }
    }
}

async fn acquire_tectonic_cache_lock(
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<std::fs::File, AdapterFailure> {
    let cache_root = crate::paths::compiler_cache_root().map_err(AdapterFailure::unavailable)?;
    let file = tokio::task::spawn_blocking(move || {
        let path = cache_root.join("tectonic.lock");
        let mut options = std::fs::OpenOptions::new();
        options.create(true).read(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt as _;
            options.custom_flags(0x0020_0000);
        }
        let file = options.open(&path).map_err(|error| {
            AdapterFailure::unavailable(format!(
                "checkpoint compiler cache lock could not be opened: {error}"
            ))
        })?;
        let metadata = std::fs::symlink_metadata(&path).map_err(|error| {
            AdapterFailure::unavailable(format!(
                "checkpoint compiler cache lock could not be inspected: {error}"
            ))
        })?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata_is_reparse_point(&metadata)
        {
            return Err(AdapterFailure::unavailable(
                "checkpoint compiler cache lock is not a regular file",
            ));
        }
        let opened = same_file::Handle::from_file(file.try_clone().map_err(|error| {
            AdapterFailure::unavailable(format!(
                "checkpoint compiler cache lock could not be cloned: {error}"
            ))
        })?)
        .map_err(|error| {
            AdapterFailure::unavailable(format!(
                "checkpoint compiler cache lock identity is unavailable: {error}"
            ))
        })?;
        let current = same_file::Handle::from_path(&path).map_err(|error| {
            AdapterFailure::unavailable(format!(
                "checkpoint compiler cache lock identity could not be confirmed: {error}"
            ))
        })?;
        if opened != current {
            return Err(AdapterFailure::unavailable(
                "checkpoint compiler cache lock changed while it was opened",
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))
                .map_err(|error| {
                    AdapterFailure::unavailable(format!(
                        "checkpoint compiler cache lock could not be protected: {error}"
                    ))
                })?;
        }
        Ok((file, path))
    })
    .await
    .map_err(|error| {
        AdapterFailure::unavailable(format!(
            "checkpoint compiler cache lock task failed: {error}"
        ))
    })??;
    wait_for_tectonic_cache_lock(file.0, &file.1, TECTONIC_CACHE_LOCK_TIMEOUT, cancel).await
}

impl ProbeWorkspace {
    fn create() -> Result<Self, AdapterFailure> {
        let parent = std::env::temp_dir();
        for _ in 0..32 {
            let root = parent.join(format!(
                "oleafly-checkpoint-probe-{}-{:016x}",
                std::process::id(),
                rand::random::<u64>()
            ));
            match std::fs::create_dir(&root) {
                Ok(()) => {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt as _;
                        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
                            .map_err(|error| {
                                AdapterFailure::unavailable(format!(
                                    "could not protect checkpoint replay workspace: {error}"
                                ))
                            })?;
                    }
                    let workspace = Self { root };
                    workspace.create_output("discovery")?;
                    workspace.create_output("replay")?;
                    return Ok(workspace);
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(AdapterFailure::unavailable(format!(
                        "could not create checkpoint replay workspace: {error}"
                    )))
                }
            }
        }
        Err(AdapterFailure::unavailable(
            "could not reserve a checkpoint replay workspace",
        ))
    }

    fn create_output(&self, name: &str) -> Result<PathBuf, AdapterFailure> {
        let output = self.root.join(name);
        match std::fs::create_dir(&output) {
            Ok(()) => Ok(output),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(output),
            Err(error) => Err(AdapterFailure::unavailable(format!(
                "could not prepare checkpoint replay output: {error}"
            ))),
        }
    }

    fn discovery(&self) -> PathBuf {
        self.root.join("discovery")
    }

    fn replay(&self) -> PathBuf {
        self.root.join("replay")
    }

    fn generated_temp_root(&self) -> PathBuf {
        self.root.join("checkpoint-home/tmp")
    }
}

impl Drop for ProbeWorkspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn read_dependency_report(path: &Path) -> Result<Vec<u8>, AdapterFailure> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| {
        AdapterFailure::unavailable(format!(
            "compiler dependency report {} is unavailable: {error}",
            path.display()
        ))
    })?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > MAX_DEPENDENCY_REPORT_BYTES as u64
    {
        return Err(AdapterFailure::unavailable(format!(
            "compiler dependency report {} is unsafe",
            path.display()
        )));
    }
    std::fs::read(path).map_err(|error| {
        AdapterFailure::unavailable(format!(
            "compiler dependency report {} could not be read: {error}",
            path.display()
        ))
    })
}

fn dependencies_from_probe(
    engine: crate::document_engine::DocumentEngineId,
    output_dir: &Path,
    project_root: &Path,
    main_document: &str,
    workspace: &ProbeWorkspace,
) -> Result<Vec<String>, AdapterFailure> {
    match engine {
        crate::document_engine::DocumentEngineId::Latex => {
            if output_dir
                .join(format!("{}.bcf", crate::paths::ENTRY_STEM))
                .exists()
            {
                return Err(AdapterFailure {
                    reason: CheckpointSkipReason::UntrackedExternalCommands,
                    detail: "the LaTeX compile requires Biber, whose complete input closure is not yet tracked"
                        .into(),
                });
            }
            let report = read_dependency_report(&output_dir.join("checkpoint-tectonic-deps.mk"))?;
            parse_tectonic_dependencies(
                &report,
                project_root,
                TectonicDependencyLayout::ProjectNamesRebasedFrom(output_dir),
                &[output_dir.to_path_buf()],
            )
        }
        crate::document_engine::DocumentEngineId::Typst => {
            let report = read_dependency_report(&output_dir.join("checkpoint-typst-deps.zero"))?;
            parse_typst_dependencies(&report, project_root)
        }
        crate::document_engine::DocumentEngineId::Markdown => {
            let pandoc = read_dependency_report(&output_dir.join("checkpoint-pandoc-log.json"))?;
            let mut dependencies = parse_pandoc_resources(&pandoc, project_root)?
                .into_iter()
                .collect::<BTreeSet<_>>();
            let tectonic = read_dependency_report(&output_dir.join("checkpoint-tectonic-deps.mk"))?;
            dependencies.extend(parse_tectonic_dependencies(
                &tectonic,
                project_root,
                TectonicDependencyLayout::ResolvedPaths,
                &[output_dir.to_path_buf(), workspace.generated_temp_root()],
            )?);
            dependencies.insert(main_document.to_owned());
            Ok(dependencies.into_iter().collect())
        }
        crate::document_engine::DocumentEngineId::Latexmk => Err(AdapterFailure::unavailable(
            "the system LaTeX engine cannot report every compiler and helper pass",
        )),
    }
}

fn latex_output_requires_untracked_helper(output_dir: &Path) -> bool {
    output_dir
        .join(format!("{}.bcf", crate::paths::ENTRY_STEM))
        .is_file()
}

fn resolved_executable_path(
    executable: &crate::document_engine::EngineExecutable,
) -> Result<PathBuf, AdapterFailure> {
    let path = match executable {
        crate::document_engine::EngineExecutable::BundledSidecar(name) => {
            crate::document_engine::resolve_bundled_sidecar(name)
                .map_err(AdapterFailure::unavailable)?
        }
        crate::document_engine::EngineExecutable::ExternalPath(path) if path.is_absolute() => {
            path.to_path_buf()
        }
        crate::document_engine::EngineExecutable::ExternalPath(_) => {
            return Err(AdapterFailure::unavailable(
                "checkpoint publication requires an absolute compiler path",
            ))
        }
    };
    path.canonicalize().map_err(|error| {
        AdapterFailure::unavailable(format!(
            "compiler executable {} could not be resolved: {error}",
            path.display()
        ))
    })
}

fn decode_tectonic_cache_key(name: &str) -> Option<String> {
    let bytes = name.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b',' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        let end = bytes[index + 1..].iter().position(|byte| *byte == b',')? + index + 1;
        let encoded = std::str::from_utf8(&bytes[index + 1..end]).ok()?;
        if encoded.is_empty() || !encoded.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        let value = encoded.parse::<u8>().ok()?;
        decoded.push(value);
        index = end + 1;
    }
    String::from_utf8(decoded).ok()
}

fn metadata_is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt as _;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        false
    }
}

fn checked_cache_file(
    path: &Path,
    cache_root: &Path,
    label: &str,
    max_bytes: u64,
) -> Result<PathBuf, AdapterFailure> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| {
        AdapterFailure::unavailable(format!(
            "{label} {} is unavailable: {error}",
            path.display()
        ))
    })?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata_is_reparse_point(&metadata)
        || metadata.len() > max_bytes
    {
        return Err(AdapterFailure::unavailable(format!(
            "{label} {} is unsafe",
            path.display()
        )));
    }
    let canonical = path.canonicalize().map_err(|error| {
        AdapterFailure::unavailable(format!("{label} could not be resolved: {error}"))
    })?;
    if !canonical.starts_with(cache_root) {
        return Err(AdapterFailure::unavailable(format!(
            "{label} escaped the controlled compiler cache"
        )));
    }
    Ok(canonical)
}

fn checked_cache_directory(
    path: &Path,
    cache_root: &Path,
    label: &str,
) -> Result<PathBuf, AdapterFailure> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| {
        AdapterFailure::unavailable(format!(
            "{label} {} is unavailable: {error}",
            path.display()
        ))
    })?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || metadata_is_reparse_point(&metadata)
    {
        return Err(AdapterFailure::unavailable(format!(
            "{label} {} is unsafe",
            path.display()
        )));
    }
    let canonical = path.canonicalize().map_err(|error| {
        AdapterFailure::unavailable(format!("{label} could not be resolved: {error}"))
    })?;
    if !canonical.starts_with(cache_root) {
        return Err(AdapterFailure::unavailable(format!(
            "{label} escaped the controlled compiler cache"
        )));
    }
    Ok(canonical)
}

fn hash_stable_cache_file(
    path: &Path,
    cache_root: &Path,
    label: &str,
    max_bytes: u64,
) -> Result<(PathBuf, u64, ContentHash), AdapterFailure> {
    let canonical = checked_cache_file(path, cache_root, label, max_bytes)?;
    let before_identity = same_file::Handle::from_path(&canonical).map_err(|error| {
        AdapterFailure::unavailable(format!("{label} identity is unavailable: {error}"))
    })?;
    let before = std::fs::metadata(&canonical).map_err(|error| {
        AdapterFailure::unavailable(format!("{label} could not be inspected: {error}"))
    })?;
    let hash = ContentHash::digest_file(&canonical).map_err(|error| {
        AdapterFailure::unavailable(format!("{label} could not be hashed: {error}"))
    })?;
    let after_identity = same_file::Handle::from_path(&canonical).map_err(|error| {
        AdapterFailure::unavailable(format!("{label} changed while it was hashed: {error}"))
    })?;
    let after = std::fs::symlink_metadata(&canonical).map_err(|error| {
        AdapterFailure::unavailable(format!("{label} changed while it was hashed: {error}"))
    })?;
    if before_identity != after_identity
        || !after.is_file()
        || after.file_type().is_symlink()
        || metadata_is_reparse_point(&after)
        || after.len() != before.len()
    {
        return Err(AdapterFailure::unavailable(format!(
            "{label} changed while it was hashed"
        )));
    }
    Ok((canonical, before.len(), hash))
}

fn read_stable_cache_file(
    path: &Path,
    cache_root: &Path,
    label: &str,
    max_bytes: u64,
) -> Result<Vec<u8>, AdapterFailure> {
    let canonical = checked_cache_file(path, cache_root, label, max_bytes)?;
    let before_identity = same_file::Handle::from_path(&canonical).map_err(|error| {
        AdapterFailure::unavailable(format!("{label} identity is unavailable: {error}"))
    })?;
    let before = std::fs::metadata(&canonical).map_err(|error| {
        AdapterFailure::unavailable(format!("{label} could not be inspected: {error}"))
    })?;
    let bytes = std::fs::read(&canonical).map_err(|error| {
        AdapterFailure::unavailable(format!("{label} could not be read: {error}"))
    })?;
    let after_identity = same_file::Handle::from_path(&canonical).map_err(|error| {
        AdapterFailure::unavailable(format!("{label} changed while it was read: {error}"))
    })?;
    let after = std::fs::symlink_metadata(&canonical).map_err(|error| {
        AdapterFailure::unavailable(format!("{label} changed while it was read: {error}"))
    })?;
    if before_identity != after_identity
        || !after.is_file()
        || after.file_type().is_symlink()
        || metadata_is_reparse_point(&after)
        || after.len() != before.len()
        || bytes.len() as u64 != before.len()
    {
        return Err(AdapterFailure::unavailable(format!(
            "{label} changed while it was read"
        )));
    }
    Ok(bytes)
}

fn portable_cache_relative(path: &Path) -> Result<String, AdapterFailure> {
    let mut parts = Vec::new();
    for component in path.components() {
        let Component::Normal(component) = component else {
            return Err(AdapterFailure::unavailable(
                "Tectonic cache contains an unsafe relative path",
            ));
        };
        let component = component.to_str().ok_or_else(|| {
            AdapterFailure::unavailable("Tectonic cache contains a non-Unicode path")
        })?;
        if component.is_empty() || component.chars().any(char::is_control) {
            return Err(AdapterFailure::unavailable(
                "Tectonic cache contains an unsafe path",
            ));
        }
        parts.push(component);
    }
    if parts.is_empty() {
        return Err(AdapterFailure::unavailable(
            "Tectonic cache file has no relative path",
        ));
    }
    Ok(parts.join("/"))
}

fn hash_cache_entries(
    label: &str,
    mut entries: Vec<(String, u64, ContentHash)>,
) -> Result<String, AdapterFailure> {
    if entries.is_empty() {
        return Err(AdapterFailure::unavailable(format!(
            "{label} did not contain any compiler inputs"
        )));
    }
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    let file_count = entries.len();
    let mut descriptor = Vec::new();
    descriptor.extend_from_slice(b"oleafly-tectonic-cache-v1\0");
    let mut total_bytes = 0_u64;
    for (relative, length, hash) in entries {
        total_bytes = total_bytes
            .checked_add(length)
            .ok_or_else(|| AdapterFailure::unavailable(format!("{label} size overflowed")))?;
        if total_bytes > MAX_TECTONIC_CACHE_TOTAL_BYTES {
            return Err(AdapterFailure::unavailable(format!(
                "{label} exceeds the cache safety limit"
            )));
        }
        let path = relative.as_bytes();
        descriptor.extend_from_slice(&(path.len() as u64).to_le_bytes());
        descriptor.extend_from_slice(path);
        descriptor.extend_from_slice(&length.to_le_bytes());
        descriptor.extend_from_slice(hash.as_bytes());
        if descriptor.len() > MAX_TECTONIC_CACHE_DESCRIPTOR_BYTES {
            return Err(AdapterFailure::unavailable(format!(
                "{label} descriptor exceeds the safety limit"
            )));
        }
    }
    Ok(format!(
        "files={};bytes={total_bytes};blake3={}",
        file_count,
        ContentHash::digest(&descriptor)
    ))
}

fn hash_tectonic_cache_tree(
    root: &Path,
    cache_root: &Path,
    label: &str,
) -> Result<String, AdapterFailure> {
    let root = checked_cache_directory(root, cache_root, label)?;
    let mut entries = Vec::new();
    let mut pending = vec![(root.clone(), 0_usize)];
    let mut inspected = 0_usize;
    let mut total_bytes = 0_u64;
    while let Some((directory, depth)) = pending.pop() {
        if depth > 16 {
            return Err(AdapterFailure::unavailable(format!(
                "{label} exceeded the traversal depth limit"
            )));
        }
        for entry in std::fs::read_dir(&directory).map_err(|error| {
            AdapterFailure::unavailable(format!("{label} could not be read: {error}"))
        })? {
            inspected += 1;
            if inspected > MAX_TECTONIC_CACHE_FILES {
                return Err(AdapterFailure::unavailable(format!(
                    "{label} contains too many entries"
                )));
            }
            let entry = entry.map_err(|error| {
                AdapterFailure::unavailable(format!("{label} entry could not be read: {error}"))
            })?;
            let path = entry.path();
            let metadata = std::fs::symlink_metadata(&path).map_err(|error| {
                AdapterFailure::unavailable(format!(
                    "{label} entry {} could not be inspected: {error}",
                    path.display()
                ))
            })?;
            if metadata.file_type().is_symlink() || metadata_is_reparse_point(&metadata) {
                return Err(AdapterFailure::unavailable(format!(
                    "{label} contains a link or reparse point"
                )));
            }
            if metadata.is_dir() {
                pending.push((path, depth + 1));
                continue;
            }
            if !metadata.is_file() || metadata.len() > MAX_TECTONIC_CACHE_FILE_BYTES {
                return Err(AdapterFailure::unavailable(format!(
                    "{label} contains an unsafe file"
                )));
            }
            let remaining = MAX_TECTONIC_CACHE_TOTAL_BYTES.saturating_sub(total_bytes);
            let allowed = MAX_TECTONIC_CACHE_FILE_BYTES.min(remaining);
            let (canonical, length, hash) =
                hash_stable_cache_file(&path, cache_root, &format!("{label} file"), allowed)?;
            total_bytes = total_bytes
                .checked_add(length)
                .ok_or_else(|| AdapterFailure::unavailable(format!("{label} size overflowed")))?;
            if total_bytes > MAX_TECTONIC_CACHE_TOTAL_BYTES {
                return Err(AdapterFailure::unavailable(format!(
                    "{label} exceeds the cache safety limit"
                )));
            }
            if !canonical.starts_with(&root) {
                return Err(AdapterFailure::unavailable(format!(
                    "{label} file escaped its cache tree"
                )));
            }
            let relative =
                portable_cache_relative(canonical.strip_prefix(&root).map_err(|_| {
                    AdapterFailure::unavailable(format!("{label} file escaped its cache tree"))
                })?)?;
            entries.push((relative, length, hash));
        }
    }
    hash_cache_entries(label, entries)
}

fn hash_tectonic_formats(
    formats: &Path,
    cache_root: &Path,
    bundle_id: &str,
) -> Result<String, AdapterFailure> {
    let formats = checked_cache_directory(formats, cache_root, "Tectonic format cache")?;
    let prefix = format!("{bundle_id}-");
    let mut entries = Vec::new();
    let mut inspected = 0_usize;
    let mut total_bytes = 0_u64;
    for entry in std::fs::read_dir(&formats).map_err(|error| {
        AdapterFailure::unavailable(format!("Tectonic format cache could not be read: {error}"))
    })? {
        record_directory_entry(
            &mut inspected,
            MAX_TECTONIC_CACHE_FILES,
            "Tectonic format cache",
        )?;
        let entry = entry.map_err(|error| {
            AdapterFailure::unavailable(format!(
                "Tectonic format cache entry could not be read: {error}"
            ))
        })?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !name.starts_with(&prefix) {
            continue;
        }
        if entries.len() >= 128 {
            return Err(AdapterFailure::unavailable(
                "Tectonic format cache contains too many matching files",
            ));
        }
        let remaining = MAX_TECTONIC_CACHE_TOTAL_BYTES.saturating_sub(total_bytes);
        let (_, length, hash) = hash_stable_cache_file(
            &entry.path(),
            cache_root,
            "Tectonic format cache file",
            MAX_TECTONIC_CACHE_FILE_BYTES.min(remaining),
        )?;
        total_bytes = total_bytes
            .checked_add(length)
            .ok_or_else(|| AdapterFailure::unavailable("Tectonic format cache size overflowed"))?;
        if total_bytes > MAX_TECTONIC_CACHE_TOTAL_BYTES {
            return Err(AdapterFailure::unavailable(
                "Tectonic format cache exceeds the cache safety limit",
            ));
        }
        entries.push((name, length, hash));
    }
    hash_cache_entries("Tectonic format cache", entries)
}

fn record_directory_entry(
    inspected: &mut usize,
    limit: usize,
    label: &str,
) -> Result<(), AdapterFailure> {
    *inspected = inspected
        .checked_add(1)
        .ok_or_else(|| AdapterFailure::unavailable(format!("{label} entry count overflowed")))?;
    if *inspected > limit {
        return Err(AdapterFailure::unavailable(format!(
            "{label} contains too many entries"
        )));
    }
    Ok(())
}

fn ordinary_tectonic_cache_root() -> Option<PathBuf> {
    if let Some(configured) = std::env::var_os("TECTONIC_CACHE_DIR") {
        if !configured.is_empty() {
            return Some(PathBuf::from(configured));
        }
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME")
            .filter(|home| !home.is_empty())
            .map(|home| PathBuf::from(home).join("Library").join("Caches"))
            .map(|caches| caches.join("Tectonic"))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("LOCALAPPDATA")
            .filter(|data| !data.is_empty())
            .map(|data| {
                PathBuf::from(data)
                    .join("TectonicProject")
                    .join("Tectonic")
                    .join("cache")
            })
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var_os("XDG_CACHE_HOME")
            .filter(|cache| !cache.is_empty())
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .filter(|home| !home.is_empty())
                    .map(|home| PathBuf::from(home).join(".cache"))
            })
            .map(|cache| cache.join("Tectonic"))
    }
    #[cfg(not(any(unix, windows)))]
    {
        None
    }
}

fn opened_regular_cache_file(path: &Path) -> Result<(std::fs::File, u64), String> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt as _;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options
        .open(path)
        .map_err(|error| format!("could not open {}: {error}", path.display()))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("could not inspect {}: {error}", path.display()))?;
    if !metadata.is_file() || metadata_is_reparse_point(&metadata) {
        return Err(format!("{} is not a regular file", path.display()));
    }
    Ok((file, metadata.len()))
}

fn seed_one_cache_file(source: &Path, destination: &Path, max_bytes: u64) -> Result<u64, String> {
    let metadata = std::fs::symlink_metadata(source)
        .map_err(|error| format!("could not inspect {}: {error}", source.display()))?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata_is_reparse_point(&metadata)
    {
        return Err(format!("{} is not a regular file", source.display()));
    }
    if metadata.len() > max_bytes {
        return Err(format!(
            "{} exceeds the cache safety limit",
            source.display()
        ));
    }
    if std::fs::symlink_metadata(destination).is_ok() {
        return Ok(0);
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "cache destination has no parent".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("could not prepare {}: {error}", parent.display()))?;
    match std::fs::hard_link(source, destination) {
        Ok(()) => return Ok(metadata.len()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => return Ok(0),
        Err(_) => {}
    }
    let (mut opened, length) = opened_regular_cache_file(source)?;
    if length > max_bytes {
        return Err(format!(
            "{} exceeds the cache safety limit",
            source.display()
        ));
    }
    let staging = parent.join(format!(".oleafly-seed-{:016x}", rand::random::<u64>()));
    let copied = (|| -> Result<u64, String> {
        let mut staged = std::fs::File::create(&staging)
            .map_err(|error| format!("could not stage a cache file: {error}"))?;
        let copied = std::io::copy(&mut opened, &mut staged)
            .map_err(|error| format!("could not copy a cache file: {error}"))?;
        staged
            .sync_all()
            .map_err(|error| format!("could not save a cache file: {error}"))?;
        Ok(copied)
    })();
    let copied = match copied {
        Ok(copied) => copied,
        Err(error) => {
            let _ = std::fs::remove_file(&staging);
            return Err(error);
        }
    };
    match std::fs::rename(&staging, destination) {
        Ok(()) => Ok(copied),
        Err(error) => {
            let _ = std::fs::remove_file(&staging);
            if std::fs::symlink_metadata(destination).is_ok() {
                Ok(0)
            } else {
                Err(format!("could not publish a cache file: {error}"))
            }
        }
    }
}

struct CacheSeedBudget {
    files: usize,
    bytes: u64,
}

impl CacheSeedBudget {
    fn new() -> Self {
        Self { files: 0, bytes: 0 }
    }

    fn charge(&mut self, bytes: u64) -> Result<(), String> {
        self.files = self
            .files
            .checked_add(1)
            .ok_or_else(|| "cache seed file count overflowed".to_string())?;
        if self.files > MAX_TECTONIC_CACHE_FILES {
            return Err("cache seed exceeds the file safety limit".into());
        }
        self.bytes = self
            .bytes
            .checked_add(bytes)
            .ok_or_else(|| "cache seed size overflowed".to_string())?;
        if self.bytes > MAX_TECTONIC_CACHE_TOTAL_BYTES {
            return Err("cache seed exceeds the cache safety limit".into());
        }
        Ok(())
    }
}

fn safe_cache_component(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\'])
        && !name.chars().any(char::is_control)
}

fn ordinary_bundle_marker(
    ordinary: &Path,
    bundle_locator: &str,
) -> Result<(PathBuf, String), String> {
    let hashes = ordinary.join("bundles").join("hashes");
    let mut marker = None;
    let mut inspected = 0_usize;
    for entry in std::fs::read_dir(&hashes)
        .map_err(|error| format!("could not read the Tectonic bundle cache: {error}"))?
    {
        inspected += 1;
        if inspected > 1_024 {
            return Err("the Tectonic bundle cache has too many locator records".into());
        }
        let entry =
            entry.map_err(|error| format!("could not inspect a bundle locator: {error}"))?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !safe_cache_component(&name) {
            continue;
        }
        if decode_tectonic_cache_key(&name).as_deref() == Some(bundle_locator)
            && marker.replace(name).is_some()
        {
            return Err("the Tectonic bundle cache has duplicate locator records".into());
        }
    }
    let name = marker.ok_or_else(|| "the Tectonic bundle is not cached".to_string())?;
    let path = hashes.join(&name);
    let (mut file, length) = opened_regular_cache_file(&path)?;
    if length > 65 {
        return Err("the Tectonic bundle marker is not a content identity".into());
    }
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(&mut file, &mut bytes)
        .map_err(|error| format!("could not read the Tectonic bundle marker: {error}"))?;
    let bundle_id = bytes.strip_suffix(b"\n").unwrap_or(&bytes);
    if bundle_id.len() != 64
        || !bundle_id
            .iter()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("the Tectonic bundle marker is not a content identity".into());
    }
    let bundle_id = std::str::from_utf8(bundle_id)
        .map_err(|_| "the Tectonic bundle identity is not Unicode".to_string())?
        .to_owned();
    Ok((path, bundle_id))
}

fn seed_flat_bundle_directory(
    ordinary: &Path,
    probe: &Path,
    bundle_id: &str,
    budget: &mut CacheSeedBudget,
) -> Result<(), String> {
    let source_root = ordinary.join("bundles").join("data").join(bundle_id);
    let metadata = match std::fs::symlink_metadata(&source_root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("could not inspect the bundle cache: {error}")),
    };
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || metadata_is_reparse_point(&metadata)
    {
        return Err("the Tectonic bundle cache is not a real directory".into());
    }
    let destination_root = probe.join("bundles").join("data").join(bundle_id);
    for entry in std::fs::read_dir(&source_root)
        .map_err(|error| format!("could not read the bundle cache: {error}"))?
    {
        let entry = entry.map_err(|error| format!("could not inspect a bundle file: {error}"))?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !safe_cache_component(&name) {
            continue;
        }
        let source = source_root.join(&name);
        let source_metadata = std::fs::symlink_metadata(&source)
            .map_err(|error| format!("could not inspect a bundle file: {error}"))?;
        if !source_metadata.is_file()
            || source_metadata.file_type().is_symlink()
            || metadata_is_reparse_point(&source_metadata)
        {
            continue;
        }
        let seeded = seed_one_cache_file(
            &source,
            &destination_root.join(&name),
            MAX_TECTONIC_CACHE_FILE_BYTES,
        )?;
        budget.charge(seeded)?;
    }
    Ok(())
}

fn seed_bundle_formats(
    ordinary: &Path,
    probe: &Path,
    bundle_id: &str,
    budget: &mut CacheSeedBudget,
) -> Result<(), String> {
    let source_root = ordinary.join("formats");
    let metadata = match std::fs::symlink_metadata(&source_root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("could not inspect the format cache: {error}")),
    };
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || metadata_is_reparse_point(&metadata)
    {
        return Err("the Tectonic format cache is not a real directory".into());
    }
    let prefix = format!("{bundle_id}-");
    let destination_root = probe.join("formats");
    for entry in std::fs::read_dir(&source_root)
        .map_err(|error| format!("could not read the format cache: {error}"))?
    {
        let entry = entry.map_err(|error| format!("could not inspect a format file: {error}"))?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !safe_cache_component(&name) || !name.starts_with(&prefix) {
            continue;
        }
        let source = source_root.join(&name);
        let source_metadata = std::fs::symlink_metadata(&source)
            .map_err(|error| format!("could not inspect a format file: {error}"))?;
        if !source_metadata.is_file()
            || source_metadata.file_type().is_symlink()
            || metadata_is_reparse_point(&source_metadata)
        {
            continue;
        }
        let seeded = seed_one_cache_file(
            &source,
            &destination_root.join(&name),
            MAX_TECTONIC_CACHE_FILE_BYTES,
        )?;
        budget.charge(seeded)?;
    }
    Ok(())
}

fn seed_probe_tectonic_cache_from(
    ordinary: &Path,
    probe: &Path,
    bundle_locator: &str,
) -> Result<(), String> {
    let metadata = match std::fs::symlink_metadata(ordinary) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("could not inspect the Tectonic cache: {error}")),
    };
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || metadata_is_reparse_point(&metadata)
    {
        return Err("the Tectonic cache is not a real directory".into());
    }
    if same_file::Handle::from_path(ordinary)
        .ok()
        .zip(same_file::Handle::from_path(probe).ok())
        .is_some_and(|(left, right)| left == right)
    {
        return Ok(());
    }
    let (marker, bundle_id) = ordinary_bundle_marker(ordinary, bundle_locator)?;
    let mut budget = CacheSeedBudget::new();
    let index_name = format!("{bundle_id}.index");
    let index = ordinary.join("bundles").join("data").join(&index_name);
    if std::fs::symlink_metadata(&index).is_ok() {
        let seeded = seed_one_cache_file(
            &index,
            &probe.join("bundles").join("data").join(&index_name),
            MAX_TECTONIC_BUNDLE_INDEX_BYTES,
        )?;
        budget.charge(seeded)?;
    }
    seed_flat_bundle_directory(ordinary, probe, &bundle_id, &mut budget)?;
    seed_bundle_formats(ordinary, probe, &bundle_id, &mut budget)?;
    let marker_name = marker
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .ok_or_else(|| "the Tectonic bundle marker has no name".to_string())?;
    let seeded = seed_one_cache_file(
        &marker,
        &probe.join("bundles").join("hashes").join(marker_name),
        65,
    )?;
    budget.charge(seeded)
}

fn seed_probe_tectonic_cache(bundle_locator: &str) {
    let Ok(probe) = crate::paths::tectonic_cache_root() else {
        return;
    };
    let Some(ordinary) = ordinary_tectonic_cache_root() else {
        return;
    };
    let _ = seed_probe_tectonic_cache_from(&ordinary, &probe, bundle_locator);
}

fn resolve_tectonic_bundle_id(
    cache_root: &Path,
    bundle_locator: &str,
) -> Result<String, AdapterFailure> {
    let hashes = checked_cache_directory(
        &cache_root.join("bundles/hashes"),
        cache_root,
        "Tectonic bundle cache",
    )?;
    let mut marker = None;
    let mut inspected = 0_usize;
    for entry in std::fs::read_dir(&hashes).map_err(|error| {
        AdapterFailure::unavailable(format!("Tectonic bundle cache could not be read: {error}"))
    })? {
        inspected += 1;
        if inspected > 1_024 {
            return Err(AdapterFailure::unavailable(
                "Tectonic bundle cache contains too many locator records",
            ));
        }
        let entry = entry.map_err(|error| {
            AdapterFailure::unavailable(format!(
                "Tectonic bundle locator could not be inspected: {error}"
            ))
        })?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if decode_tectonic_cache_key(&name).as_deref() == Some(bundle_locator)
            && marker.replace(entry.path()).is_some()
        {
            return Err(AdapterFailure::unavailable(
                "Tectonic bundle cache contains duplicate locator records",
            ));
        }
    }
    let marker = marker.ok_or_else(|| {
        AdapterFailure::unavailable("Tectonic did not record the selected bundle identity")
    })?;
    let bytes = read_stable_cache_file(&marker, cache_root, "Tectonic bundle marker", 65)?;
    let bundle_id = bytes.strip_suffix(b"\n").unwrap_or(&bytes);
    if bundle_id.len() != 64
        || !bundle_id
            .iter()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(AdapterFailure::unavailable(
            "Tectonic bundle marker has an invalid content identity",
        ));
    }
    std::str::from_utf8(bundle_id)
        .map(str::to_owned)
        .map_err(|_| AdapterFailure::unavailable("Tectonic bundle identity is not Unicode"))
}

fn hash_tectonic_bundle_identity(
    cache_root: &Path,
    bundle_id: &str,
) -> Result<String, AdapterFailure> {
    let index = cache_root
        .join("bundles/data")
        .join(format!("{bundle_id}.index"));
    let (_, _, index_hash) = hash_stable_cache_file(
        &index,
        cache_root,
        "Tectonic bundle index",
        MAX_TECTONIC_BUNDLE_INDEX_BYTES,
    )?;
    let resources = hash_tectonic_cache_tree(
        &cache_root.join("bundles/data").join(bundle_id),
        cache_root,
        "Tectonic bundle resource cache",
    )?;
    let formats = hash_tectonic_formats(&cache_root.join("formats"), cache_root, bundle_id)?;
    Ok(format!(
        "bundle-sha256={bundle_id};bundle-index-blake3={index_hash};bundle-resources={resources};bundle-formats={formats}"
    ))
}

struct CacheFingerprint {
    digest: String,
    settled: bool,
}

type CacheStatEntry = (String, u64, std::time::SystemTime);

fn fingerprint_cache_file(
    entries: &mut Vec<CacheStatEntry>,
    relative: String,
    metadata: &std::fs::Metadata,
    label: &str,
) -> Result<(), AdapterFailure> {
    if metadata.file_type().is_symlink()
        || metadata_is_reparse_point(metadata)
        || !metadata.is_file()
    {
        return Err(AdapterFailure::unavailable(format!(
            "{label} contains an unsafe entry"
        )));
    }
    let modified = metadata.modified().map_err(|error| {
        AdapterFailure::unavailable(format!("{label} entry has no modification time: {error}"))
    })?;
    entries.push((relative, metadata.len(), modified));
    Ok(())
}

fn fingerprint_cache_tree(
    root: &Path,
    prefix: &str,
    entries: &mut Vec<CacheStatEntry>,
    inspected: &mut usize,
    label: &str,
) -> Result<(), AdapterFailure> {
    let mut pending = vec![(root.to_path_buf(), 0_usize)];
    while let Some((directory, depth)) = pending.pop() {
        if depth > 16 {
            return Err(AdapterFailure::unavailable(format!(
                "{label} exceeded the traversal depth limit"
            )));
        }
        for entry in std::fs::read_dir(&directory).map_err(|error| {
            AdapterFailure::unavailable(format!("{label} could not be read: {error}"))
        })? {
            record_directory_entry(inspected, MAX_TECTONIC_CACHE_FILES, label)?;
            let entry = entry.map_err(|error| {
                AdapterFailure::unavailable(format!("{label} entry could not be read: {error}"))
            })?;
            let path = entry.path();
            let metadata = std::fs::symlink_metadata(&path).map_err(|error| {
                AdapterFailure::unavailable(format!(
                    "{label} entry {} could not be inspected: {error}",
                    path.display()
                ))
            })?;
            if metadata.file_type().is_symlink() || metadata_is_reparse_point(&metadata) {
                return Err(AdapterFailure::unavailable(format!(
                    "{label} contains a link or reparse point"
                )));
            }
            if metadata.is_dir() {
                pending.push((path, depth + 1));
                continue;
            }
            let relative = portable_cache_relative(path.strip_prefix(root).map_err(|_| {
                AdapterFailure::unavailable(format!("{label} file escaped its cache tree"))
            })?)?;
            fingerprint_cache_file(entries, format!("{prefix}{relative}"), &metadata, label)?;
        }
    }
    Ok(())
}

fn tectonic_cache_fingerprint(
    cache_root: &Path,
    bundle_id: &str,
) -> Result<CacheFingerprint, AdapterFailure> {
    let data = cache_root.join("bundles/data");
    let mut entries = Vec::new();
    let mut inspected = 0_usize;
    let index = data.join(format!("{bundle_id}.index"));
    let index_metadata = std::fs::symlink_metadata(&index).map_err(|error| {
        AdapterFailure::unavailable(format!(
            "Tectonic bundle index {} is unavailable: {error}",
            index.display()
        ))
    })?;
    fingerprint_cache_file(
        &mut entries,
        format!("index/{bundle_id}.index"),
        &index_metadata,
        "Tectonic bundle index",
    )?;
    fingerprint_cache_tree(
        &data.join(bundle_id),
        "resources/",
        &mut entries,
        &mut inspected,
        "Tectonic bundle resource cache",
    )?;
    let formats = cache_root.join("formats");
    let prefix = format!("{bundle_id}-");
    for entry in std::fs::read_dir(&formats).map_err(|error| {
        AdapterFailure::unavailable(format!("Tectonic format cache could not be read: {error}"))
    })? {
        record_directory_entry(
            &mut inspected,
            MAX_TECTONIC_CACHE_FILES,
            "Tectonic format cache",
        )?;
        let entry = entry.map_err(|error| {
            AdapterFailure::unavailable(format!(
                "Tectonic format cache entry could not be read: {error}"
            ))
        })?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !name.starts_with(&prefix) {
            continue;
        }
        let metadata = std::fs::symlink_metadata(entry.path()).map_err(|error| {
            AdapterFailure::unavailable(format!(
                "Tectonic format cache entry could not be inspected: {error}"
            ))
        })?;
        fingerprint_cache_file(
            &mut entries,
            format!("formats/{name}"),
            &metadata,
            "Tectonic format cache",
        )?;
    }
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    let settled_before = std::time::SystemTime::now().checked_sub(CACHE_FINGERPRINT_SETTLE);
    let mut settled = true;
    let mut descriptor = Vec::new();
    descriptor.extend_from_slice(b"oleafly-tectonic-cache-stat-v1\0");
    for (relative, len, modified) in &entries {
        if settled_before.map_or(true, |limit| *modified > limit) {
            settled = false;
        }
        let (seconds, nanos) = match modified.duration_since(std::time::UNIX_EPOCH) {
            Ok(elapsed) => (elapsed.as_secs() as i64, elapsed.subsec_nanos()),
            Err(before) => (
                -(before.duration().as_secs() as i64),
                before.duration().subsec_nanos(),
            ),
        };
        descriptor.extend_from_slice(&(relative.len() as u64).to_le_bytes());
        descriptor.extend_from_slice(relative.as_bytes());
        descriptor.extend_from_slice(&len.to_le_bytes());
        descriptor.extend_from_slice(&seconds.to_le_bytes());
        descriptor.extend_from_slice(&nanos.to_le_bytes());
    }
    Ok(CacheFingerprint {
        digest: ContentHash::digest(&descriptor).to_hex(),
        settled,
    })
}

type CacheIdentityKey = (PathBuf, String);
type CacheIdentityRecord = (String, String);

fn tectonic_cache_identities() -> &'static Mutex<HashMap<CacheIdentityKey, CacheIdentityRecord>> {
    static IDENTITIES: OnceLock<Mutex<HashMap<CacheIdentityKey, CacheIdentityRecord>>> =
        OnceLock::new();
    IDENTITIES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Resolves the selected bundle and returns its content identity. A settled
/// cache whose stat fingerprint is unchanged reuses the recorded identity, so
/// steady-state probes cost a directory walk instead of rehashing every byte.
fn read_tectonic_bundle_identity(
    cache_root: &Path,
    bundle_locator: &str,
) -> Result<String, AdapterFailure> {
    let cache_root = cache_root.canonicalize().map_err(|error| {
        AdapterFailure::unavailable(format!("Tectonic cache could not be resolved: {error}"))
    })?;
    let bundle_id = resolve_tectonic_bundle_id(&cache_root, bundle_locator)?;
    let fingerprint = tectonic_cache_fingerprint(&cache_root, &bundle_id)?;
    let key = (cache_root.clone(), bundle_id.clone());
    if fingerprint.settled {
        let identities = tectonic_cache_identities()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some((known, identity)) = identities.get(&key) {
            if *known == fingerprint.digest {
                return Ok(identity.clone());
            }
        }
    }
    let identity = hash_tectonic_bundle_identity(&cache_root, &bundle_id)?;
    let confirmation = tectonic_cache_fingerprint(&cache_root, &bundle_id)?;
    if confirmation.digest != fingerprint.digest {
        return Err(AdapterFailure::unavailable(
            "Tectonic cache changed while its identity was recorded",
        ));
    }
    if confirmation.settled {
        tectonic_cache_identities()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(key, (fingerprint.digest, identity.clone()));
    }
    Ok(identity)
}

fn tectonic_bundle_locator(
    engine: crate::document_engine::DocumentEngineId,
    spec: &crate::document_engine::EngineCompileSpec,
) -> Result<&str, AdapterFailure> {
    match engine {
        crate::document_engine::DocumentEngineId::Latex => spec
            .args
            .windows(2)
            .find(|pair| pair[0] == "--bundle")
            .map(|pair| pair[1].as_str()),
        crate::document_engine::DocumentEngineId::Markdown => spec
            .args
            .windows(2)
            .find(|pair| pair[0] == "--pdf-engine-opt=--bundle")
            .and_then(|pair| pair[1].strip_prefix("--pdf-engine-opt=")),
        _ => None,
    }
    .ok_or_else(|| AdapterFailure::unavailable("Tectonic bundle selection is unavailable"))
}

fn complete_toolchain_identity(
    engine: crate::document_engine::DocumentEngineId,
    spec: &crate::document_engine::EngineCompileSpec,
    executable_identity: &str,
) -> Result<String, AdapterFailure> {
    if !matches!(
        engine,
        crate::document_engine::DocumentEngineId::Latex
            | crate::document_engine::DocumentEngineId::Markdown
    ) {
        return Ok(executable_identity.to_owned());
    }
    let cache_root = spec
        .environment
        .variable("TECTONIC_CACHE_DIR")
        .ok_or_else(|| AdapterFailure::unavailable("Tectonic cache identity is unavailable"))?;
    let locator = tectonic_bundle_locator(engine, spec)?;
    let bundle_identity = read_tectonic_bundle_identity(Path::new(cache_root), locator)?;
    Ok(format!("{executable_identity};{bundle_identity}"))
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct FileStamp {
    len: u64,
    modified: std::time::SystemTime,
}

fn file_stamp(path: &Path, label: &str) -> Result<FileStamp, AdapterFailure> {
    let metadata = std::fs::metadata(path).map_err(|error| {
        AdapterFailure::unavailable(format!(
            "{label} {} could not be inspected: {error}",
            path.display()
        ))
    })?;
    if !metadata.is_file() {
        return Err(AdapterFailure::unavailable(format!(
            "{label} {} is not a regular file",
            path.display()
        )));
    }
    let modified = metadata.modified().map_err(|error| {
        AdapterFailure::unavailable(format!(
            "{label} {} has no modification time: {error}",
            path.display()
        ))
    })?;
    Ok(FileStamp {
        len: metadata.len(),
        modified,
    })
}

fn binary_identities() -> &'static Mutex<HashMap<PathBuf, (FileStamp, ContentHash)>> {
    static IDENTITIES: OnceLock<Mutex<HashMap<PathBuf, (FileStamp, ContentHash)>>> =
        OnceLock::new();
    IDENTITIES.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn checked_binary_identity(
    path: &Path,
    expected_version: &str,
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<ContentHash, AdapterFailure> {
    let stamp = file_stamp(path, "compiler")?;
    let known = binary_identities()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(path)
        .copied();
    if let Some((known_stamp, hash)) = known {
        if known_stamp == stamp {
            return Ok(hash);
        }
    }
    let args = vec!["--version".to_string()];
    let working_dir = path.parent().unwrap_or_else(|| Path::new("."));
    let (version, status) = if let Some(cancel) = cancel {
        crate::document_engine::run_supervised_external_cancellable(
            path,
            &args,
            working_dir,
            cancel,
        )
        .await
    } else {
        crate::document_engine::run_supervised_external(path, &args, working_dir).await
    }
    .map_err(AdapterFailure::unavailable)?;
    if status != Some(0)
        || !version
            .lines()
            .next()
            .is_some_and(|line| exact_tool_version(line, expected_version))
    {
        return Err(AdapterFailure::unavailable(format!(
            "compiler {} is not the supported {expected_version} toolchain",
            path.display()
        )));
    }
    ensure_checkpoint_not_cancelled(cancel)?;
    let hash_path = path.to_path_buf();
    let display = path.display().to_string();
    let hash = tokio::task::spawn_blocking(move || ContentHash::digest_file(hash_path))
        .await
        .map_err(|error| {
            AdapterFailure::unavailable(format!(
                "compiler {display} fingerprint task failed: {error}"
            ))
        })?
        .map_err(|error| {
            AdapterFailure::unavailable(format!(
                "compiler {display} could not be fingerprinted: {error}"
            ))
        })?;
    ensure_checkpoint_not_cancelled(cancel)?;
    if file_stamp(path, "compiler")? != stamp {
        return Err(AdapterFailure::unavailable(format!(
            "compiler {display} changed while it was fingerprinted"
        )));
    }
    binary_identities()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(path.to_path_buf(), (stamp, hash));
    Ok(hash)
}

fn exact_tool_version(actual: &str, expected: &str) -> bool {
    let mut actual = actual.split_whitespace();
    let mut expected = expected.split_whitespace();
    let Some(expected_product) = expected.next() else {
        return false;
    };
    let Some(expected_version) = expected.next() else {
        return false;
    };
    if expected.next().is_some() {
        return false;
    }
    actual
        .next()
        .is_some_and(|product| product.eq_ignore_ascii_case(expected_product))
        && actual.next() == Some(expected_version)
}

async fn executable_toolchain_identity(
    engine: crate::document_engine::DocumentEngineId,
    spec: &crate::document_engine::EngineCompileSpec,
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<String, AdapterFailure> {
    let primary = resolved_executable_path(&spec.executable)?;
    let expected = match engine {
        crate::document_engine::DocumentEngineId::Latex => "tectonic 0.16.9",
        crate::document_engine::DocumentEngineId::Typst => "typst 0.15.0",
        crate::document_engine::DocumentEngineId::Markdown => "pandoc 3.9.0.2",
        crate::document_engine::DocumentEngineId::Latexmk => {
            return Err(AdapterFailure::unavailable(
                "latexmk has no checkpoint evidence adapter",
            ))
        }
    };
    let primary_hash = checked_binary_identity(&primary, expected, cancel).await?;
    let source_date_epoch = spec
        .environment
        .variable("SOURCE_DATE_EPOCH")
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| {
            AdapterFailure::unavailable(
                "the controlled compile did not record a valid source date epoch",
            )
        })?;
    let mut identity = format!(
        "checkpoint-evidence-v1;engine={};compiler-blake3={primary_hash};controlled-env=v2;source-date-epoch={source_date_epoch}",
        engine.as_str(),
    );
    if engine == crate::document_engine::DocumentEngineId::Markdown {
        let tectonic = spec
            .args
            .iter()
            .find_map(|argument| argument.strip_prefix("--pdf-engine="))
            .map(PathBuf::from)
            .ok_or_else(|| AdapterFailure::unavailable("Pandoc did not identify its PDF engine"))?;
        let tectonic = tectonic.canonicalize().map_err(|error| {
            AdapterFailure::unavailable(format!(
                "Markdown PDF engine could not be resolved: {error}"
            ))
        })?;
        let tectonic_hash = checked_binary_identity(&tectonic, "tectonic 0.16.9", cancel).await?;
        identity.push_str(&format!(";tectonic-blake3={tectonic_hash}"));
    }
    Ok(identity)
}

struct ProbeRun {
    toolchain_identity: String,
}

fn record_probe_failure(
    mode: crate::document_engine::CheckpointCompileMode,
    result: &crate::document_engine::CompileResult,
) {
    let errors: Vec<&str> = result
        .errors
        .iter()
        .map(|error| error.message.as_str())
        .take(3)
        .collect();
    let tail_start = result
        .log
        .char_indices()
        .rev()
        .nth(799)
        .map_or(0, |(index, _)| index);
    let tail = result.log[tail_start..]
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let summary = format!(
        "checkpoint {mode:?} compile failed: ok={} pdf={} errors={errors:?} log tail: {tail}",
        result.ok, result.has_pdf
    );
    #[cfg(debug_assertions)]
    eprintln!("checkpoint: {summary}");
    let _ = crate::project::append_app_log(summary);
}

#[allow(clippy::too_many_arguments)]
async fn run_probe(
    app: &tauri::AppHandle,
    engine: &'static dyn crate::document_engine::DocumentEngine,
    project_root: &Path,
    output_dir: &Path,
    main_document: &str,
    mut options: crate::document_engine::CompileOptions,
    mode: crate::document_engine::CheckpointCompileMode,
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<ProbeRun, AdapterFailure> {
    options.fast = false;
    options.allow_shell_escape = false;
    options.checkpoint_mode = mode;
    ensure_checkpoint_not_cancelled(cancel)?;
    let spec = crate::document_engine::prepare_compile_spec(
        engine.id(),
        output_dir.to_path_buf(),
        project_root.to_path_buf(),
        crate::document_engine::CompileTarget::Main { main_document },
        options,
    )
    .await
    .map_err(AdapterFailure::unavailable)?;
    ensure_checkpoint_not_cancelled(cancel)?;
    let executable_identity = executable_toolchain_identity(engine.id(), &spec, cancel).await?;
    ensure_checkpoint_not_cancelled(cancel)?;
    let result = crate::document_engine::compile(crate::document_engine::CompileRequest {
        app,
        engine,
        out_dir: output_dir,
        project_dir: project_root,
        target: crate::document_engine::CompileTarget::Main { main_document },
        log_event: "checkpoint:log",
        options,
        cancel,
        prepared_spec: Some(spec.clone()),
    })
    .await
    .map_err(AdapterFailure::unavailable)?;
    ensure_checkpoint_not_cancelled(cancel)?;
    if !result.ok || !result.has_pdf {
        record_probe_failure(mode, &result);
        return Err(AdapterFailure::unavailable(
            "the controlled checkpoint compile did not produce a valid PDF",
        ));
    }
    let post_executable_identity =
        executable_toolchain_identity(engine.id(), &spec, cancel).await?;
    if post_executable_identity != executable_identity {
        return Err(AdapterFailure::unavailable(
            "the compiler toolchain changed while checkpoint evidence was recorded",
        ));
    }
    let engine_id = engine.id();
    let identity_spec = spec.clone();
    let identity = tokio::task::spawn_blocking(move || {
        complete_toolchain_identity(engine_id, &identity_spec, &post_executable_identity)
    })
    .await
    .map_err(|error| {
        AdapterFailure::unavailable(format!("compiler cache identity task failed: {error}"))
    })??;
    ensure_checkpoint_not_cancelled(cancel)?;
    Ok(ProbeRun {
        toolchain_identity: identity,
    })
}

async fn output_hash(
    output_dir: &Path,
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<ContentHash, AdapterFailure> {
    let path = output_dir.join(format!("{}.pdf", crate::paths::ENTRY_STEM));
    let cancel = cancel.cloned();
    tokio::task::spawn_blocking(move || {
        ensure_checkpoint_not_cancelled(cancel.as_ref())?;
        let hash = ContentHash::digest_file(path).map_err(|error| {
            AdapterFailure::unavailable(format!("compiled PDF could not be fingerprinted: {error}"))
        })?;
        ensure_checkpoint_not_cancelled(cancel.as_ref())?;
        Ok(hash)
    })
    .await
    .map_err(|error| {
        AdapterFailure::unavailable(format!("compiled PDF identity task failed: {error}"))
    })?
}

fn skip_from_failure(failure: AdapterFailure) -> CheckpointPublicationOutcome {
    let suggestion = match failure.reason {
        CheckpointSkipReason::ExternalDependency => {
            "Move the required file into this project, then compile again."
        }
        CheckpointSkipReason::UntrackedExternalCommands => {
            "Use a compile without untracked helper commands, then compile again."
        }
        CheckpointSkipReason::InsufficientSpace => {
            "Free some disk space, then compile again."
        }
        _ => "Your document still compiled successfully. Use Source Control or export a project backup for recovery.",
    };
    CheckpointPublicationOutcome::skipped(
        failure.reason,
        format!("Checkpoint not saved because {}.", failure.detail),
        suggestion,
    )
}

fn worktree_file_matches(
    project_root: &Path,
    file: &oleafly_history::CheckpointFile,
    cancel: Option<&crate::state::CompileCancel>,
) -> bool {
    let path = project_root.join(
        file.relative_path
            .replace('/', std::path::MAIN_SEPARATOR_STR),
    );
    let Ok(metadata) = std::fs::symlink_metadata(&path) else {
        return false;
    };
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata_is_reparse_point(&metadata)
        || metadata.len() != file.logical_bytes
    {
        return false;
    }
    let hash = if let Some(cancel) = cancel {
        ContentHash::digest_file_controlled(&path, cancel)
    } else {
        ContentHash::digest_file(&path)
    };
    hash.is_ok_and(|hash| hash == file.content_hash)
}

fn manifest_matches_worktree(
    project_root: &Path,
    main_document: &str,
    policy: &CheckpointPolicy,
    checkpoint: &oleafly_history::Checkpoint,
    files: &[oleafly_history::CheckpointFile],
    cancel: Option<&crate::state::CompileCancel>,
) -> bool {
    let replayed = checkpoint
        .replayed_inputs()
        .iter()
        .map(|input| input.relative_path.clone())
        .collect::<BTreeSet<_>>();
    let recorded_explicit = files
        .iter()
        .filter(|file| !replayed.contains(&file.relative_path))
        .map(|file| file.relative_path.clone())
        .collect::<BTreeSet<_>>();
    let Ok(mut current_explicit) = collect_always_included_files(project_root, policy, cancel)
    else {
        return false;
    };
    current_explicit.insert("project.json".into());
    current_explicit.retain(|path| !replayed.contains(path));
    if current_explicit != recorded_explicit {
        return false;
    }
    for file in files {
        if ensure_checkpoint_not_cancelled(cancel).is_err() {
            return false;
        }
        if replayed.contains(&file.relative_path) {
            let stored = file.relative_path == "project.json"
                || file.relative_path == main_document
                || !policy.is_ignored(&file.relative_path);
            if stored != file.stored {
                return false;
            }
        }
        if !worktree_file_matches(project_root, file, cancel) {
            return false;
        }
    }
    true
}

async fn publication_would_be_unchanged(
    project_id: &str,
    project_root: &Path,
    main_document: &str,
    policy: &CheckpointPolicy,
    cancel: Option<&crate::state::CompileCancel>,
) -> bool {
    let project_id = project_id.to_owned();
    let project_root = project_root.to_path_buf();
    let main_document = main_document.to_owned();
    let policy = policy.clone();
    let cancel = cancel.cloned();
    tokio::task::spawn_blocking(move || {
        let Ok(_worktree) = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id) else {
            return false;
        };
        let Ok(Some(store_path)) = crate::paths::existing_checkpoint_store_dir(&project_id) else {
            return false;
        };
        let Ok(Some(store)) = oleafly_history::Store::open_existing(store_path) else {
            return false;
        };
        let Ok(Some(checkpoint)) = store.latest_checkpoint() else {
            return false;
        };
        let Ok(Some(files)) = store.checkpoint_files(&checkpoint.snapshot_root) else {
            return false;
        };
        manifest_matches_worktree(
            &project_root,
            &main_document,
            &policy,
            &checkpoint,
            &files,
            cancel.as_ref(),
        )
    })
    .await
    .unwrap_or(false)
}

enum SealedPublication {
    Prepared(Box<PreparedCheckpointPublication>),
    Unchanged,
}

#[allow(clippy::too_many_arguments)]
async fn stage_and_replay(
    app: &tauri::AppHandle,
    store: &oleafly_history::Store,
    workspace: &ProbeWorkspace,
    engine: &'static dyn crate::document_engine::DocumentEngine,
    project_id: &str,
    project_root: &Path,
    main_document: &str,
    policy: &CheckpointPolicy,
    options: crate::document_engine::CompileOptions,
    discovery_dependencies: &[String],
    discovery_hash: ContentHash,
    discovery_identity: &str,
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<SealedPublication, AdapterFailure> {
    ensure_checkpoint_not_cancelled(cancel)?;
    let seal_project_id = project_id.to_owned();
    let seal_project_root = project_root.to_path_buf();
    let seal_dependencies = discovery_dependencies.to_vec();
    let seal_main_document = main_document.to_owned();
    let seal_policy = policy.clone();
    let seal_store = store.clone();
    let seal_cancel = cancel.cloned();
    let candidate = tokio::task::spawn_blocking(move || {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&seal_project_id)
            .map_err(AdapterFailure::unavailable)?;
        ensure_checkpoint_not_cancelled(seal_cancel.as_ref())?;
        let inputs = build_capture_inputs(
            &seal_project_root,
            &seal_dependencies,
            &seal_main_document,
            &seal_policy,
            seal_cancel.as_ref(),
        )?;
        let candidate = if let Some(cancel) = seal_cancel.as_ref() {
            seal_store.stage_candidate_controlled(&seal_project_root, &inputs, cancel)
        } else {
            seal_store.stage_candidate(&seal_project_root, &inputs)
        }
        .map_err(|error| {
            AdapterFailure::unavailable(format!("inputs could not be sealed: {error}"))
        })?;
        if let Err(error) = ensure_checkpoint_not_cancelled(seal_cancel.as_ref()) {
            drop(candidate);
            return Err(error);
        }
        Ok(candidate)
    })
    .await
    .map_err(|error| {
        AdapterFailure::unavailable(format!("checkpoint input sealing task failed: {error}"))
    })??;

    ensure_checkpoint_not_cancelled(cancel)?;
    let (candidate, already_visible) = tokio::task::spawn_blocking(move || {
        let visible = candidate.root_is_visible();
        (candidate, visible)
    })
    .await
    .map_err(|error| {
        AdapterFailure::unavailable(format!("checkpoint lookup task failed: {error}"))
    })?;
    let already_visible = already_visible.map_err(|error| {
        AdapterFailure::unavailable(format!("checkpoint history could not be read: {error}"))
    })?;
    if already_visible {
        let _ = tokio::task::spawn_blocking(move || drop(candidate)).await;
        return Ok(SealedPublication::Unchanged);
    }

    trace_lane(project_id, "candidate sealed");
    let replay = run_probe(
        app,
        engine,
        candidate.sealed_root(),
        &workspace.replay(),
        main_document,
        options,
        crate::document_engine::CheckpointCompileMode::Replay,
        cancel,
    )
    .await?;
    ensure_checkpoint_not_cancelled(cancel)?;
    if replay.toolchain_identity != discovery_identity {
        return Err(AdapterFailure::unavailable(
            "the compiler toolchain changed between discovery and replay",
        ));
    }
    trace_lane(project_id, "replay compile finished");
    let replay_dependencies = dependencies_from_probe(
        engine.id(),
        &workspace.replay(),
        candidate.sealed_root(),
        main_document,
        workspace,
    )?;
    let replayed_inputs = replayed_inputs_for(&candidate, &replay_dependencies)?;
    let replay_hash = output_hash(&workspace.replay(), cancel).await?;
    ensure_checkpoint_not_cancelled(cancel)?;
    if replay_hash != discovery_hash {
        return Err(AdapterFailure::unavailable(
            "the sealed replay PDF differs from the validated compile",
        ));
    }
    let completed_at_unix_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0);
    let evidence = oleafly_history::CompileEvidence::new(
        engine.id().as_str(),
        discovery_identity,
        main_document,
        replay_hash,
        completed_at_unix_ms,
        replayed_inputs,
    )
    .map_err(|error| {
        AdapterFailure::unavailable(format!("compile evidence is invalid: {error}"))
    })?;
    Ok(SealedPublication::Prepared(Box::new(
        PreparedCheckpointPublication {
            snapshot_root: candidate.snapshot_root().to_string(),
            candidate,
            evidence,
        },
    )))
}

struct PreparedCheckpointPublication {
    snapshot_root: String,
    candidate: Candidate,
    evidence: oleafly_history::CompileEvidence,
}

fn publication_failure(error: oleafly_history::HistoryError) -> AdapterFailure {
    let normalized = error.to_string().to_ascii_lowercase();
    let reason = if normalized.contains("space") || normalized.contains("size limit") {
        CheckpointSkipReason::InsufficientSpace
    } else {
        CheckpointSkipReason::DependencyEvidenceUnavailable
    };
    AdapterFailure {
        reason,
        detail: format!("the sealed checkpoint could not be published: {error}"),
    }
}

#[derive(Clone)]
pub(crate) struct PublicationRequest {
    pub project_id: String,
    pub project_root: PathBuf,
    pub engine_name: String,
    pub main_document: String,
    pub policy: CheckpointPolicy,
    pub options: crate::document_engine::CompileOptions,
    pub primary_hash: ContentHash,
    pub primary_requires_untracked_helper: bool,
}

pub(crate) const PUBLICATION_EVENT: &str = "checkpoint:publication";

#[derive(Clone, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
enum PublicationPhase<'a> {
    Started,
    Finished {
        outcome: &'a CheckpointPublicationOutcome,
    },
}

#[derive(Clone, Serialize)]
struct PublicationEvent<'a> {
    project_id: &'a str,
    main_document: &'a str,
    #[serde(flatten)]
    phase: PublicationPhase<'a>,
}

#[derive(Default)]
struct PublicationLane {
    in_flight: Option<crate::state::CompileCancel>,
    successor: Option<PublicationRequest>,
}

struct PublicationRegistry {
    lanes: Mutex<HashMap<String, PublicationLane>>,
    idle: std::sync::Condvar,
}

fn publication_registry() -> &'static PublicationRegistry {
    static REGISTRY: OnceLock<PublicationRegistry> = OnceLock::new();
    REGISTRY.get_or_init(|| PublicationRegistry {
        lanes: Mutex::new(HashMap::new()),
        idle: std::sync::Condvar::new(),
    })
}

fn lock_publication_lanes() -> std::sync::MutexGuard<'static, HashMap<String, PublicationLane>> {
    publication_registry()
        .lanes
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn stop_in_flight_publication(lane: &mut PublicationLane) {
    if let Some(pid) = lane
        .in_flight
        .as_ref()
        .and_then(crate::state::CompileCancel::request)
    {
        tauri::async_runtime::spawn(crate::proc::terminate_process_tree(pid));
    }
}

fn admit_publication(
    request: PublicationRequest,
) -> Option<(PublicationRequest, crate::state::CompileCancel)> {
    let mut lanes = lock_publication_lanes();
    let lane = lanes.entry(request.project_id.clone()).or_default();
    if lane.in_flight.is_some() {
        stop_in_flight_publication(lane);
        lane.successor = Some(request);
        return None;
    }
    let cancel = crate::state::CompileCancel::default();
    cancel.begin();
    lane.in_flight = Some(cancel.clone());
    Some((request, cancel))
}

fn finish_publication(
    project_id: &str,
    finished: &crate::state::CompileCancel,
) -> Option<(PublicationRequest, crate::state::CompileCancel)> {
    let registry = publication_registry();
    let mut lanes = registry
        .lanes
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _ = finished.detach();
    let next = lanes.get_mut(project_id).and_then(|lane| {
        lane.successor.take().map(|request| {
            let cancel = crate::state::CompileCancel::default();
            cancel.begin();
            lane.in_flight = Some(cancel.clone());
            (request, cancel)
        })
    });
    if next.is_none() {
        lanes.remove(project_id);
        registry.idle.notify_all();
    }
    next
}

#[cfg(test)]
fn lane_successor_epoch(project_id: &str) -> Option<u64> {
    lock_publication_lanes()
        .get(project_id)
        .and_then(|lane| lane.successor.as_ref())
        .and_then(|request| request.options.source_date_epoch)
}

fn request_publication_cancel(
    lanes: &mut HashMap<String, PublicationLane>,
    project_id: &str,
) -> bool {
    let Some(lane) = lanes.get_mut(project_id) else {
        return false;
    };
    lane.successor = None;
    stop_in_flight_publication(lane);
    true
}

/// Stops the in-flight background publication for a project and drops its
/// successor. Worktree mutations and store deletions call this first so they
/// never wait behind supplementary work.
pub(crate) fn cancel_project_publications(project_id: &str) {
    let mut lanes = lock_publication_lanes();
    request_publication_cancel(&mut lanes, project_id);
}

/// Cancels like [`cancel_project_publications`] and then waits, bounded, for
/// the lane to drain so a store deletion cannot race a late publication.
pub(crate) fn cancel_project_publications_and_wait(project_id: &str) {
    let registry = publication_registry();
    let deadline = std::time::Instant::now() + PUBLICATION_DRAIN_TIMEOUT;
    let mut lanes = registry
        .lanes
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    while request_publication_cancel(&mut lanes, project_id) {
        let now = std::time::Instant::now();
        if now >= deadline {
            return;
        }
        lanes = registry
            .idle
            .wait_timeout(lanes, (deadline - now).min(PUBLICATION_DRAIN_POLL))
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .0;
    }
}

fn emit_publication_phase(
    app: &tauri::AppHandle,
    request: &PublicationRequest,
    phase: PublicationPhase<'_>,
) {
    let _ = app.emit(
        PUBLICATION_EVENT,
        PublicationEvent {
            project_id: &request.project_id,
            main_document: &request.main_document,
            phase,
        },
    );
}

#[cfg(debug_assertions)]
fn trace_lane(project_id: &str, phase: &str) {
    eprintln!("checkpoint: {project_id} {phase}");
}

#[cfg(not(debug_assertions))]
fn trace_lane(_project_id: &str, _phase: &str) {}

async fn run_publication_lane(
    app: tauri::AppHandle,
    mut request: PublicationRequest,
    mut cancel: crate::state::CompileCancel,
) {
    loop {
        emit_publication_phase(&app, &request, PublicationPhase::Started);
        trace_lane(&request.project_id, "lane started");
        let started = std::time::Instant::now();
        let outcome = if wait_for_lane_start(&cancel, PUBLICATION_START_DELAY).await {
            publish_after_successful_compile(&app, &request, Some(&cancel)).await
        } else {
            skip_from_failure(AdapterFailure::unavailable(
                "checkpoint publication was cancelled",
            ))
        };
        let elapsed_ms = started.elapsed().as_millis();
        let summary = match &outcome {
            CheckpointPublicationOutcome::Skipped { message, .. } => {
                format!("skipped after {elapsed_ms} ms: {message}")
            }
            CheckpointPublicationOutcome::Published { snapshot_root, .. } => {
                format!("published {snapshot_root} after {elapsed_ms} ms")
            }
            CheckpointPublicationOutcome::PublishedDurabilityUncertain {
                snapshot_root, ..
            } => {
                format!("published {snapshot_root} after {elapsed_ms} ms with uncertain durability")
            }
            CheckpointPublicationOutcome::Unchanged => {
                format!("unchanged after {elapsed_ms} ms")
            }
            CheckpointPublicationOutcome::NotAttempted
            | CheckpointPublicationOutcome::Scheduled => {
                format!("not attempted after {elapsed_ms} ms")
            }
        };
        let _ = crate::project::append_app_log(format!(
            "Checkpoint publication for project {} {summary}",
            request.project_id
        ));

        emit_publication_phase(
            &app,
            &request,
            PublicationPhase::Finished { outcome: &outcome },
        );
        match finish_publication(&request.project_id, &cancel) {
            Some((next_request, next_cancel)) => {
                request = next_request;
                cancel = next_cancel;
            }
            None => return,
        }
    }
}

async fn wait_for_lane_start(
    cancel: &crate::state::CompileCancel,
    delay: std::time::Duration,
) -> bool {
    let deadline = tokio::time::Instant::now() + delay;
    while tokio::time::Instant::now() < deadline {
        if cancel.is_requested() {
            return false;
        }
        tokio::time::sleep(PUBLICATION_DRAIN_POLL).await;
    }
    !cancel.is_requested()
}

fn checkpoints_are_enabled() -> bool {
    crate::config::read_config()
        .map(|config| config.checkpoints_enabled)
        .unwrap_or(true)
}

fn preflight_publication(
    engine_name: &str,
    main_document: &str,
    policy: &CheckpointPolicy,
    options: crate::document_engine::CompileOptions,
) -> Result<&'static dyn crate::document_engine::DocumentEngine, CheckpointPublicationOutcome> {
    if policy.validate().is_err() {
        return Err(CheckpointPublicationOutcome::skipped(
            CheckpointSkipReason::InvalidPolicy,
            "Checkpoint not saved because this project's Checkpoints settings are invalid.",
            "Review the project Checkpoints settings, then compile again.",
        ));
    }
    if options.allow_shell_escape {
        return Err(CheckpointPublicationOutcome::skipped(
            CheckpointSkipReason::UntrackedExternalCommands,
            "Checkpoint not saved because this compile allowed external commands whose inputs cannot be proven.",
            "Turn off external TeX commands for this project, then compile again.",
        ));
    }
    if options.fast {
        return Err(CheckpointPublicationOutcome::skipped(
            CheckpointSkipReason::DependencyEvidenceUnavailable,
            "Checkpoint not saved because draft mode does not run a complete reproducible compile.",
            "Turn off draft mode, then compile again.",
        ));
    }
    match crate::document_engine::engine_for(engine_name, main_document) {
        Ok(engine) if engine.id() != crate::document_engine::DocumentEngineId::Latexmk => {
            Ok(engine)
        }
        Ok(_) => Err(unavailable_adapter_outcome(engine_name, false, policy)),
        Err(error) => Err(skip_from_failure(AdapterFailure::unavailable(error))),
    }
}

fn biber_publication_skip() -> CheckpointPublicationOutcome {
    skip_from_failure(AdapterFailure {
        reason: CheckpointSkipReason::UntrackedExternalCommands,
        detail: "the validated LaTeX compile used Biber, whose complete input closure is not yet tracked"
            .into(),
    })
}

pub(crate) fn capture_primary_evidence(
    primary_output_dir: &Path,
) -> Result<(ContentHash, bool), String> {
    let pdf = primary_output_dir.join(format!("{}.pdf", crate::paths::ENTRY_STEM));
    let hash = ContentHash::digest_file(&pdf)
        .map_err(|error| format!("compiled PDF could not be fingerprinted: {error}"))?;
    Ok((
        hash,
        latex_output_requires_untracked_helper(primary_output_dir),
    ))
}

/// Binds the visible PDF and hands controlled discovery, sealing, replay, and
/// publication to the background lane behind the compile result. At most one
/// publication runs per project. A newer request cancels the running one and
/// becomes its single successor, so there is never a queue.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn schedule_after_successful_compile(
    app: &tauri::AppHandle,
    project_id: &str,
    project_root: &Path,
    primary_output_dir: &Path,
    engine_name: &str,
    main_document: &str,
    policy: &CheckpointPolicy,
    options: crate::document_engine::CompileOptions,
) -> CheckpointPublicationOutcome {
    if !checkpoints_are_enabled() {
        return CheckpointPublicationOutcome::NotAttempted;
    }
    let engine = match preflight_publication(engine_name, main_document, policy, options) {
        Ok(engine) => engine,
        Err(outcome) => return outcome,
    };
    let evidence_dir = primary_output_dir.to_path_buf();
    let (primary_hash, primary_requires_untracked_helper) =
        match tokio::task::spawn_blocking(move || capture_primary_evidence(&evidence_dir)).await {
            Ok(Ok(evidence)) => evidence,
            Ok(Err(error)) => return skip_from_failure(AdapterFailure::unavailable(error)),
            Err(error) => {
                return skip_from_failure(AdapterFailure::unavailable(format!(
                    "compiled PDF identity task failed: {error}"
                )))
            }
        };
    if engine.id() == crate::document_engine::DocumentEngineId::Latex
        && primary_requires_untracked_helper
    {
        return biber_publication_skip();
    }
    let request = PublicationRequest {
        project_id: project_id.to_owned(),
        project_root: project_root.to_path_buf(),
        engine_name: engine_name.to_owned(),
        main_document: main_document.to_owned(),
        policy: policy.clone(),
        options,
        primary_hash,
        primary_requires_untracked_helper,
    };
    if let Some((request, cancel)) = admit_publication(request) {
        tauri::async_runtime::spawn(run_publication_lane(app.clone(), request, cancel));
    }
    CheckpointPublicationOutcome::Scheduled
}

async fn acquire_operation_lock_cancellable(
    operation: std::sync::Arc<tokio::sync::Mutex<()>>,
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<tokio::sync::OwnedMutexGuard<()>, AdapterFailure> {
    loop {
        ensure_checkpoint_not_cancelled(cancel)?;
        match std::sync::Arc::clone(&operation).try_lock_owned() {
            Ok(guard) => return Ok(guard),
            Err(_) => tokio::time::sleep(TECTONIC_CACHE_LOCK_RETRY).await,
        }
    }
}

/// Runs controlled discovery and sealed replay for one validated compile.
/// Every failure remains supplementary and returns a skipped outcome.
pub async fn publish_after_successful_compile(
    app: &tauri::AppHandle,
    request: &PublicationRequest,
    cancel: Option<&crate::state::CompileCancel>,
) -> CheckpointPublicationOutcome {
    let _cancel_scope = CheckpointCancelScope::new(cancel);
    let project_id = request.project_id.as_str();
    let project_root = request.project_root.as_path();
    let main_document = request.main_document.as_str();
    let policy = &request.policy;
    let mut options = request.options;
    let engine = match preflight_publication(&request.engine_name, main_document, policy, options) {
        Ok(engine) => engine,
        Err(outcome) => return outcome,
    };
    options.checkpoint_persistent_cache = matches!(
        engine.id(),
        crate::document_engine::DocumentEngineId::Latex
            | crate::document_engine::DocumentEngineId::Markdown
    );
    if engine.id() == crate::document_engine::DocumentEngineId::Latex
        && request.primary_requires_untracked_helper
    {
        return biber_publication_skip();
    }
    let operation = match crate::checkpoints::checkpoint_operation_lock(project_id) {
        Ok(operation) => operation,
        Err(error) => return skip_from_failure(AdapterFailure::unavailable(error)),
    };
    let _operation = match acquire_operation_lock_cancellable(operation, cancel).await {
        Ok(guard) => guard,
        Err(error) => return skip_from_failure(error),
    };
    trace_lane(project_id, "operation lock acquired");
    if publication_would_be_unchanged(project_id, project_root, main_document, policy, cancel).await
    {
        return CheckpointPublicationOutcome::Unchanged;
    }
    trace_lane(project_id, "sources differ from the newest checkpoint");
    let _compiler_cache_lock = if matches!(
        engine.id(),
        crate::document_engine::DocumentEngineId::Latex
            | crate::document_engine::DocumentEngineId::Markdown
    ) {
        match acquire_tectonic_cache_lock(cancel).await {
            Ok(lock) => Some(lock),
            Err(error) => return skip_from_failure(error),
        }
    } else {
        None
    };
    if _compiler_cache_lock.is_some() {
        let locator = crate::document_engine::tex_bundle_url();
        let _ = tokio::task::spawn_blocking(move || seed_probe_tectonic_cache(&locator)).await;
    }
    trace_lane(project_id, "compiler cache ready");
    let workspace = match ProbeWorkspace::create() {
        Ok(workspace) => workspace,
        Err(error) => return skip_from_failure(error),
    };
    let primary_hash = request.primary_hash;
    let discovery = match run_probe(
        app,
        engine,
        project_root,
        &workspace.discovery(),
        main_document,
        options,
        crate::document_engine::CheckpointCompileMode::Discovery,
        cancel,
    )
    .await
    {
        Ok(discovery) => discovery,
        Err(error) => return skip_from_failure(error),
    };
    trace_lane(project_id, "discovery compile finished");
    let discovery_hash = match output_hash(&workspace.discovery(), cancel).await {
        Ok(hash) => hash,
        Err(error) => return skip_from_failure(error),
    };
    if discovery_hash != primary_hash {
        return skip_from_failure(AdapterFailure::unavailable(
            "the controlled discovery compile did not reproduce the visible PDF",
        ));
    }
    let discovery_dependencies = match dependencies_from_probe(
        engine.id(),
        &workspace.discovery(),
        project_root,
        main_document,
        &workspace,
    ) {
        Ok(dependencies) => dependencies,
        Err(error) => return skip_from_failure(error),
    };
    let store_path = match crate::paths::checkpoint_store_dir(project_id) {
        Ok(path) => path,
        Err(error) => return skip_from_failure(AdapterFailure::unavailable(error)),
    };
    if let Err(error) = ensure_checkpoint_not_cancelled(cancel) {
        return skip_from_failure(error);
    }
    let publication = match tokio::task::spawn_blocking(move || {
        oleafly_history::Store::try_open_for_publication(store_path)
    })
    .await
    {
        Ok(Ok(Some(publication))) => publication,
        Ok(Ok(None)) => {
            return skip_from_failure(AdapterFailure::unavailable(
                "another process is already publishing this project's checkpoint",
            ))
        }
        Ok(Err(error)) => {
            return skip_from_failure(AdapterFailure::unavailable(format!(
                "checkpoint storage could not be opened: {error}"
            )))
        }
        Err(error) => {
            return skip_from_failure(AdapterFailure::unavailable(format!(
                "checkpoint storage task failed: {error}"
            )))
        }
    };
    trace_lane(project_id, "store opened");
    let prepared = stage_and_replay(
        app,
        publication.store(),
        &workspace,
        engine,
        project_id,
        project_root,
        main_document,
        policy,
        options,
        &discovery_dependencies,
        discovery_hash,
        &discovery.toolchain_identity,
        cancel,
    )
    .await;
    match prepared {
        Ok(SealedPublication::Unchanged) => {
            let _ = tokio::task::spawn_blocking(move || drop(publication)).await;
            CheckpointPublicationOutcome::Unchanged
        }
        Ok(SealedPublication::Prepared(prepared)) => {
            trace_lane(project_id, "publishing");
            let publish_cancel = cancel.cloned();
            let prepared = *prepared;
            let snapshot_root = prepared.snapshot_root;
            match tokio::task::spawn_blocking(move || {
                ensure_checkpoint_not_cancelled(publish_cancel.as_ref())?;
                let result = if let Some(cancel) = publish_cancel.as_ref() {
                    publication.publish_controlled(prepared.candidate, prepared.evidence, cancel)
                } else {
                    publication.publish(prepared.candidate, prepared.evidence)
                };
                result.map_err(publication_failure)
            })
            .await
            {
                Ok(Ok((oleafly_history::PublishOutcome::Existing(_), _committed))) => {
                    CheckpointPublicationOutcome::Unchanged
                }
                Ok(Ok((oleafly_history::PublishOutcome::Created(_), committed))) => match committed
                {
                    oleafly_history::PublicationCommitOutcome::Durable(_store) => {
                        CheckpointPublicationOutcome::Published {
                            snapshot_root,
                            created: true,
                        }
                    }
                    oleafly_history::PublicationCommitOutcome::InstalledDurabilityUncertain(
                        _store,
                    ) => CheckpointPublicationOutcome::PublishedDurabilityUncertain {
                        snapshot_root,
                        created: true,
                    },
                },
                Ok(Err(error)) => skip_from_failure(error),
                Err(error) => skip_from_failure(AdapterFailure::unavailable(format!(
                    "checkpoint storage task failed: {error}"
                ))),
            }
        }
        Err(error) => {
            let _ = tokio::task::spawn_blocking(move || drop(publication)).await;
            skip_from_failure(error)
        }
    }
}

fn unavailable_adapter_outcome(
    engine: &str,
    allow_shell_escape: bool,
    policy: &CheckpointPolicy,
) -> CheckpointPublicationOutcome {
    if policy.validate().is_err() {
        return CheckpointPublicationOutcome::skipped(
            CheckpointSkipReason::InvalidPolicy,
            "Checkpoint not saved because this project's Checkpoints settings are invalid.",
            "Review the project Checkpoints settings, then compile again.",
        );
    }

    if allow_shell_escape {
        return CheckpointPublicationOutcome::skipped(
            CheckpointSkipReason::UntrackedExternalCommands,
            "Checkpoint not saved because this compile allowed external commands whose inputs cannot be proven.",
            "Turn off external TeX commands for this project, then compile again.",
        );
    }

    let detail = match engine.trim().to_ascii_lowercase().as_str() {
        "latexmk" => {
            "The system LaTeX engine cannot yet prove inputs from every compiler pass and helper."
        }
        _ => "This document engine does not provide complete dependency evidence.",
    };
    CheckpointPublicationOutcome::skipped(
        CheckpointSkipReason::DependencyEvidenceUnavailable,
        format!("Checkpoint not saved. {detail}"),
        "Your document still compiled successfully. Use explicit Source Control or export a project backup for recovery.",
    )
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::{Arc, Barrier};

    use oleafly_core::CheckpointPolicy;
    use oleafly_history::{
        Candidate, CaptureInput, CompileEvidence, ContentHash, HistoryError, ReplayedInput, Store,
    };
    use tempfile::tempdir;

    use super::{
        admit_publication, build_capture_inputs, cancel_project_publications_and_wait,
        checkpoints_are_enabled, finish_publication, is_device_input, is_reserved_device_name,
        lane_successor_epoch, latex_output_requires_untracked_helper, manifest_matches_worktree,
        parse_pandoc_resources, parse_tectonic_dependencies, parse_typst_dependencies,
        read_tectonic_bundle_identity, record_directory_entry, replayed_inputs_for,
        seed_probe_tectonic_cache_from, tectonic_cache_fingerprint, unavailable_adapter_outcome,
        wait_for_tectonic_cache_lock, CheckpointPublicationOutcome, CheckpointSkipReason,
        PublicationRequest, TectonicDependencyLayout,
    };
    use std::path::Path;

    fn publication_candidate(
        store: &Store,
        project: &std::path::Path,
        source: &[u8],
    ) -> (Candidate, CompileEvidence) {
        fs::write(project.join("main.typ"), source).unwrap();
        let source_path = project.join("main.typ").canonicalize().unwrap();
        let inputs = vec![
            CaptureInput::explicit("project.json").unwrap(),
            CaptureInput::replay_required("main.typ", source_path, ContentHash::digest(source))
                .unwrap(),
        ];
        let candidate = store.stage_candidate(project, &inputs).unwrap();
        let evidence = CompileEvidence::new(
            "typst",
            "typst-test@1",
            "main.typ",
            ContentHash::digest(b"validated-pdf"),
            1,
            candidate
                .proven_files()
                .iter()
                .map(|file| ReplayedInput::new(&file.relative_path, file.content_hash).unwrap())
                .collect(),
        )
        .unwrap();
        (candidate, evidence)
    }

    #[test]
    fn cancellation_and_root_publication_share_one_linearizable_cutoff() {
        for iteration in 0..24_u8 {
            let temp = tempdir().unwrap();
            let project = temp.path().join("project");
            fs::create_dir(&project).unwrap();
            fs::write(project.join("project.json"), br#"{"main":"main.typ"}"#).unwrap();
            let store = Store::open(temp.path().join("history")).unwrap();
            let (candidate, evidence) = publication_candidate(&store, &project, &[iteration]);
            let cancel = crate::state::CompileCancel::default();
            cancel.begin();
            let barrier = Arc::new(Barrier::new(2));

            let (publication, request_result) = std::thread::scope(|scope| {
                let publish_barrier = barrier.clone();
                let publish_cancel = cancel.clone();
                let publish_store = store.clone();
                let publication = scope.spawn(move || {
                    publish_barrier.wait();
                    publish_store.publish_controlled(candidate, evidence, &publish_cancel)
                });
                let cancel_barrier = barrier.clone();
                let request_cancel = cancel.clone();
                let request = scope.spawn(move || {
                    cancel_barrier.wait();
                    request_cancel.request()
                });
                (publication.join().unwrap(), request.join().unwrap())
            });
            let stopped = cancel.detach();

            match publication {
                Ok(_) => {
                    assert_eq!(request_result, None);
                    assert!(!stopped, "a stop after the cutoff must not be reported");
                    assert_eq!(store.list().unwrap().len(), 1);
                }
                Err(HistoryError::PublicationCancelled) => {
                    assert_eq!(request_result, None);
                    assert!(stopped, "the stop that won the cutoff must be reported");
                    assert!(store.list().unwrap().is_empty());
                }
                Err(error) => panic!("unexpected publication failure: {error}"),
            }
        }
    }

    #[test]
    fn first_store_install_and_stop_share_one_linearizable_cutoff() {
        for iteration in 0..24_u8 {
            let temp = tempdir().unwrap();
            let project = temp.path().join("project");
            fs::create_dir(&project).unwrap();
            fs::write(project.join("project.json"), br#"{"main":"main.typ"}"#).unwrap();
            let history = temp.path().join("history");
            let publication = Store::open_for_publication(&history).unwrap();
            let (candidate, evidence) =
                publication_candidate(publication.store(), &project, &[iteration]);
            let cancel = crate::state::CompileCancel::default();
            cancel.begin();
            let barrier = Arc::new(Barrier::new(2));

            let (published, request_result) = std::thread::scope(|scope| {
                let publish_barrier = barrier.clone();
                let publish_cancel = cancel.clone();
                let published = scope.spawn(move || {
                    publish_barrier.wait();
                    publication.publish_controlled(candidate, evidence, &publish_cancel)
                });
                let cancel_barrier = barrier.clone();
                let request_cancel = cancel.clone();
                let request = scope.spawn(move || {
                    cancel_barrier.wait();
                    request_cancel.request()
                });
                (published.join().unwrap(), request.join().unwrap())
            });
            let stopped = cancel.detach();

            match published {
                Ok(_) => {
                    assert_eq!(request_result, None);
                    assert!(!stopped, "a stop after install must not be reported");
                    assert_eq!(
                        Store::open_existing(&history)
                            .unwrap()
                            .unwrap()
                            .list()
                            .unwrap()
                            .len(),
                        1
                    );
                }
                Err(HistoryError::PublicationCancelled) => {
                    assert_eq!(request_result, None);
                    assert!(stopped, "the stop that won install must be reported");
                    assert!(!history.exists());
                    assert!(Store::open_existing(&history).unwrap().is_none());
                }
                Err(error) => panic!("unexpected first-store publication failure: {error}"),
            }
        }
    }

    #[tokio::test]
    async fn compiler_cache_lock_wait_is_bounded_and_cancelable() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("tectonic.lock");
        let holder = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        fs4::FileExt::lock(&holder).unwrap();
        let contender = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();

        let started = std::time::Instant::now();
        let error = wait_for_tectonic_cache_lock(
            contender,
            &path,
            std::time::Duration::from_millis(50),
            None,
        )
        .await
        .unwrap_err();
        assert!(error.detail.contains("another checkpoint"));
        assert!(started.elapsed() < std::time::Duration::from_secs(1));

        let cancel = crate::state::CompileCancel::default();
        cancel.begin();
        assert_eq!(cancel.request(), None);
        let cancelled = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        let error = wait_for_tectonic_cache_lock(
            cancelled,
            &path,
            std::time::Duration::from_secs(1),
            Some(&cancel),
        )
        .await
        .unwrap_err();
        assert!(error.detail.contains("cancelled"));
        assert!(cancel.detach());
    }

    #[test]
    fn compiler_versions_match_exact_product_and_version_tokens() {
        assert!(super::exact_tool_version(
            "pandoc 3.9.0.2\nFeatures: +server",
            "pandoc 3.9.0.2"
        ));
        assert!(super::exact_tool_version(
            "Typst 0.15.0 (release)",
            "typst 0.15.0"
        ));
        assert!(!super::exact_tool_version(
            "pandoc 3.9.0.20",
            "pandoc 3.9.0.2"
        ));
        assert!(!super::exact_tool_version(
            "not-pandoc 3.9.0.2",
            "pandoc 3.9.0.2"
        ));
    }

    #[test]
    fn directory_entry_budget_counts_unrelated_entries() {
        let mut inspected = 0;
        record_directory_entry(&mut inspected, 1, "cache").unwrap();
        let error = record_directory_entry(&mut inspected, 1, "cache").unwrap_err();
        assert!(error.detail.contains("too many entries"));
    }

    #[test]
    fn engines_without_an_evidence_adapter_fail_closed() {
        let outcome = unavailable_adapter_outcome("latexmk", false, &CheckpointPolicy::default());
        assert!(matches!(
            outcome,
            CheckpointPublicationOutcome::Skipped {
                reason: CheckpointSkipReason::DependencyEvidenceUnavailable,
                ..
            }
        ));
    }

    #[test]
    fn the_checkpoints_switch_gates_publication_and_defaults_to_on() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());

        assert!(checkpoints_are_enabled());

        let mut config = crate::config::AppConfig {
            checkpoints_enabled: false,
            ..Default::default()
        };
        crate::config::write_config(&config).unwrap();
        assert!(!checkpoints_are_enabled());

        config.checkpoints_enabled = true;
        crate::config::write_config(&config).unwrap();
        assert!(checkpoints_are_enabled());

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn publication_outcomes_serialize_their_documented_status_shapes() {
        assert_eq!(
            serde_json::to_value(CheckpointPublicationOutcome::Unchanged).unwrap(),
            serde_json::json!({"status": "unchanged"})
        );
        assert_eq!(
            serde_json::to_value(CheckpointPublicationOutcome::NotAttempted).unwrap(),
            serde_json::json!({"status": "not_attempted"})
        );
        assert_eq!(
            serde_json::to_value(CheckpointPublicationOutcome::Scheduled).unwrap(),
            serde_json::json!({"status": "scheduled"})
        );
        assert_eq!(
            serde_json::to_value(CheckpointPublicationOutcome::Published {
                snapshot_root: "abc".into(),
                created: true,
            })
            .unwrap(),
            serde_json::json!({"status": "published", "snapshot_root": "abc", "created": true})
        );
    }

    #[test]
    fn invalid_policy_has_a_distinct_actionable_outcome() {
        let policy: CheckpointPolicy = serde_json::from_value(serde_json::json!({
            "mode": "engine_dependencies",
            "always_include": ["../outside"],
            "ignored": []
        }))
        .unwrap();
        let outcome = unavailable_adapter_outcome("unknown", false, &policy);
        assert!(matches!(
            outcome,
            CheckpointPublicationOutcome::Skipped {
                reason: CheckpointSkipReason::InvalidPolicy,
                ..
            }
        ));
    }

    #[test]
    fn shell_escape_is_reported_before_generic_latexmk_unavailability() {
        let outcome = unavailable_adapter_outcome("latexmk", true, &CheckpointPolicy::default());
        assert!(matches!(
            outcome,
            CheckpointPublicationOutcome::Skipped {
                reason: CheckpointSkipReason::UntrackedExternalCommands,
                ..
            }
        ));
    }

    #[test]
    fn primary_latex_biber_artifact_blocks_probe_before_an_external_helper_can_run() {
        let temp = tempdir().unwrap();
        assert!(!latex_output_requires_untracked_helper(temp.path()));
        fs::write(
            temp.path()
                .join(format!("{}.bcf", crate::paths::ENTRY_STEM)),
            b"control",
        )
        .unwrap();
        assert!(latex_output_requires_untracked_helper(temp.path()));
    }

    #[test]
    fn tectonic_rules_rebase_logical_project_inputs_from_the_output_directory() {
        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        let output = temp.path().join("probe");
        fs::create_dir_all(project.join("chapters")).unwrap();
        fs::create_dir(&output).unwrap();
        fs::write(project.join("main.tex"), b"main").unwrap();
        fs::write(project.join("chapters/one.tex"), b"chapter").unwrap();
        fs::write(output.join("_oleafly_entry.tex"), b"wrapper").unwrap();
        let report = format!(
            "{out}/_oleafly_entry.pdf : {out}/_oleafly_entry.tex \\\n  {out}/main.tex \\\n  {out}/chapters/one.tex\n",
            out = output.display()
        );

        let dependencies = parse_tectonic_dependencies(
            report.as_bytes(),
            &project,
            TectonicDependencyLayout::ProjectNamesRebasedFrom(&output),
            std::slice::from_ref(&output),
        )
        .unwrap();

        assert_eq!(dependencies, ["chapters/one.tex", "main.tex"]);
    }

    #[test]
    fn tectonic_rules_reject_an_absolute_external_dependency() {
        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        let output = temp.path().join("probe");
        let outside = temp.path().join("outside.tex");
        fs::create_dir(&project).unwrap();
        fs::create_dir(&output).unwrap();
        fs::write(project.join("main.tex"), b"main").unwrap();
        fs::write(&outside, b"outside").unwrap();
        let report = format!(
            "{out}/entry.pdf : {out}/entry.tex \\\n  {outside}\n",
            out = output.display(),
            outside = outside.display()
        );

        let error = parse_tectonic_dependencies(
            report.as_bytes(),
            &project,
            TectonicDependencyLayout::ProjectNamesRebasedFrom(&output),
            std::slice::from_ref(&output),
        )
        .unwrap_err();

        assert_eq!(error.reason, CheckpointSkipReason::ExternalDependency);
    }

    #[cfg(unix)]
    #[test]
    fn tectonic_rules_do_not_hide_a_regular_file_behind_a_dev_fd_alias() {
        use std::os::unix::io::AsRawFd;
        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        let output = temp.path().join("probe");
        fs::create_dir(&project).unwrap();
        fs::create_dir(&output).unwrap();
        fs::write(project.join("main.tex"), b"main").unwrap();
        let secret = temp.path().join("secret.tex");
        fs::write(&secret, b"\\def\\leaked{1}").unwrap();
        let held = fs::File::open(&secret).unwrap();
        let alias = format!("/dev/fd/{}", held.as_raw_fd());
        assert_eq!(fs::read(&alias).unwrap(), b"\\def\\leaked{1}");
        let report = format!(
            "{out}/entry.pdf : {out}/entry.tex \\\n  {alias} \\\n  {out}/main.tex\n",
            out = output.display()
        );

        let error = parse_tectonic_dependencies(
            report.as_bytes(),
            &project,
            TectonicDependencyLayout::ProjectNamesRebasedFrom(&output),
            std::slice::from_ref(&output),
        )
        .unwrap_err();

        assert_eq!(error.reason, CheckpointSkipReason::ExternalDependency);
    }

    #[cfg(unix)]
    #[test]
    fn tectonic_rules_ignore_device_probes_such_as_dev_null() {
        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        let output = temp.path().join("probe");
        fs::create_dir(&project).unwrap();
        fs::create_dir(&output).unwrap();
        fs::write(project.join("main.tex"), b"main").unwrap();
        fs::write(project.join("chapter.tex"), b"chapter").unwrap();
        let report = format!(
            "{out}/entry.pdf : {out}/entry.tex \\\n  /dev/null \\\n  {out}/chapter.tex\n",
            out = output.display()
        );

        let dependencies = parse_tectonic_dependencies(
            report.as_bytes(),
            &project,
            TectonicDependencyLayout::ProjectNamesRebasedFrom(&output),
            std::slice::from_ref(&output),
        )
        .unwrap();

        assert_eq!(dependencies, ["chapter.tex"]);
    }

    #[test]
    fn device_inputs_are_recognised_by_name_and_by_kind() {
        assert!(is_device_input(Path::new("/dev/null")));
        assert!(is_device_input(Path::new("/dev/urandom")));
        assert!(is_reserved_device_name(Path::new("NUL")));
        assert!(is_reserved_device_name(Path::new("nul.txt")));
        assert!(is_reserved_device_name(Path::new("COM3")));
        assert!(!is_reserved_device_name(Path::new("commons.tex")));
        assert!(!is_reserved_device_name(Path::new("auxiliary.tex")));
        assert!(!is_device_input(Path::new("/tmp")));
        assert!(!is_device_input(Path::new("/dev/shm/secret.tex")));
        let temp = tempdir().unwrap();
        let regular = temp.path().join("regular.tex");
        fs::write(&regular, b"x").unwrap();
        assert!(!is_device_input(&regular));
        assert!(!is_device_input(&temp.path().join("dev/null")));
    }

    #[test]
    fn tectonic_rules_skip_cleaned_generated_dependencies_without_hiding_missing_inputs() {
        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        let generated = temp.path().join("checkpoint-home/tmp");
        fs::create_dir(&project).unwrap();
        fs::create_dir_all(&generated).unwrap();
        let main = project.join("main.md");
        fs::write(&main, b"main").unwrap();
        let target = generated.join("media-cleaned/texput.pdf");
        let cleaned = generated.join("media-cleaned/assets/tile.png");
        let report = format!(
            "{target} : {main} \\\n  {cleaned}\n",
            target = target.display(),
            main = main.display(),
            cleaned = cleaned.display(),
        );

        let dependencies = parse_tectonic_dependencies(
            report.as_bytes(),
            &project,
            TectonicDependencyLayout::ResolvedPaths,
            std::slice::from_ref(&generated),
        )
        .unwrap();

        assert_eq!(dependencies, ["main.md"]);

        for missing in [
            generated.join("../outside/missing.png"),
            temp.path().join("unrelated/missing.png"),
        ] {
            let report = format!(
                "{target} : {main} \\\n  {missing}\n",
                target = target.display(),
                main = main.display(),
                missing = missing.display(),
            );
            let error = parse_tectonic_dependencies(
                report.as_bytes(),
                &project,
                TectonicDependencyLayout::ResolvedPaths,
                std::slice::from_ref(&generated),
            )
            .unwrap_err();
            assert_eq!(
                error.reason,
                CheckpointSkipReason::DependencyEvidenceUnavailable
            );
        }

        let escaped_primary = generated.join("../outside/missing.tex");
        let report = format!(
            "{target} : {escaped_primary}\n",
            target = target.display(),
            escaped_primary = escaped_primary.display(),
        );
        let error = parse_tectonic_dependencies(
            report.as_bytes(),
            &project,
            TectonicDependencyLayout::ResolvedPaths,
            std::slice::from_ref(&generated),
        )
        .unwrap_err();
        assert_eq!(
            error.reason,
            CheckpointSkipReason::DependencyEvidenceUnavailable
        );
    }

    #[test]
    fn typst_zero_dependencies_are_exact_and_project_local() {
        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir_all(project.join("chapters")).unwrap();
        fs::write(project.join("main.typ"), b"main").unwrap();
        fs::write(project.join("chapters/one.typ"), b"chapter").unwrap();
        let main = project.join("main.typ").to_string_lossy().into_owned();
        let chapter = project
            .join("chapters/one.typ")
            .to_string_lossy()
            .into_owned();
        let bytes = [main.as_bytes(), b"\0", chapter.as_bytes(), b"\0"].concat();

        let dependencies = parse_typst_dependencies(&bytes, &project).unwrap();

        assert_eq!(dependencies, ["chapters/one.typ", "main.typ"]);
    }

    #[test]
    fn pandoc_resources_union_local_inputs_and_reject_remote_fetches() {
        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir_all(project.join("figures")).unwrap();
        fs::write(project.join("references.bib"), b"bib").unwrap();
        fs::write(project.join("figures/plot.png"), b"png").unwrap();
        let local = serde_json::json!([
            {
                "type": "LoadedResource",
                "for": "references.bib",
                "from": project.join("references.bib")
            },
            {
                "type": "LoadedResource",
                "for": "figures/plot.png",
                "from": project.join("figures/plot.png")
            }
        ]);
        let resources =
            parse_pandoc_resources(&serde_json::to_vec(&local).unwrap(), &project).unwrap();
        assert_eq!(resources, ["figures/plot.png", "references.bib"]);

        let remote = serde_json::json!([{
            "type": "LoadedResource",
            "for": "image",
            "from": "https://example.test/plot.png"
        }]);
        let error =
            parse_pandoc_resources(&serde_json::to_vec(&remote).unwrap(), &project).unwrap_err();
        assert_eq!(error.reason, CheckpointSkipReason::ExternalDependency);

        let fetched = serde_json::json!([{
            "type": "Fetching",
            "path": "https://example.test/plot.png"
        }]);
        let error =
            parse_pandoc_resources(&serde_json::to_vec(&fetched).unwrap(), &project).unwrap_err();
        assert_eq!(error.reason, CheckpointSkipReason::ExternalDependency);
    }

    fn lane_request(project_id: &str, epoch: u64) -> PublicationRequest {
        PublicationRequest {
            project_id: project_id.to_owned(),
            project_root: std::path::PathBuf::from("/project"),
            engine_name: "typst".into(),
            main_document: "main.typ".into(),
            policy: CheckpointPolicy::default(),
            options: crate::document_engine::CompileOptions {
                source_date_epoch: Some(epoch),
                ..Default::default()
            },
            primary_hash: ContentHash::digest(b"pdf"),
            primary_requires_untracked_helper: false,
        }
    }

    #[test]
    fn a_newer_request_cancels_the_running_publication_and_becomes_its_successor() {
        let project = "lane-successor";
        let (first, cancel) = admit_publication(lane_request(project, 1)).unwrap();
        assert_eq!(first.options.source_date_epoch, Some(1));
        assert!(!cancel.is_requested());

        assert!(admit_publication(lane_request(project, 2)).is_none());

        assert!(cancel.is_requested());
        let (next, next_cancel) = finish_publication(project, &cancel).unwrap();
        assert_eq!(next.options.source_date_epoch, Some(2));
        assert!(!next_cancel.is_requested());
        assert!(finish_publication(project, &next_cancel).is_none());
        let (_, reopened) = admit_publication(lane_request(project, 3)).unwrap();
        assert!(finish_publication(project, &reopened).is_none());
    }

    #[test]
    fn a_third_request_replaces_the_successor_and_leaves_the_first_cancelled() {
        let project = "lane-replace-successor";
        let (_, cancel) = admit_publication(lane_request(project, 1)).unwrap();
        assert!(admit_publication(lane_request(project, 2)).is_none());
        assert!(admit_publication(lane_request(project, 3)).is_none());

        assert!(cancel.is_requested());
        let (next, next_cancel) = finish_publication(project, &cancel).unwrap();
        assert_eq!(next.options.source_date_epoch, Some(3));
        assert!(!next_cancel.is_requested());
        assert!(finish_publication(project, &next_cancel).is_none());
    }

    #[test]
    fn cancel_and_wait_drains_the_running_publication_and_its_successor() {
        let project = "lane-drain";
        cancel_project_publications_and_wait(project);
        let (_, cancel) = admit_publication(lane_request(project, 1)).unwrap();
        assert!(admit_publication(lane_request(project, 2)).is_none());
        assert_eq!(lane_successor_epoch(project), Some(2));
        let finisher_cancel = cancel.clone();
        let finisher = std::thread::spawn(move || {
            while lane_successor_epoch("lane-drain").is_some() {
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            std::thread::sleep(std::time::Duration::from_millis(40));
            assert!(finish_publication("lane-drain", &finisher_cancel).is_none());
        });

        let started = std::time::Instant::now();
        cancel_project_publications_and_wait(project);

        assert!(started.elapsed() < std::time::Duration::from_secs(5));
        finisher.join().unwrap();
        assert_eq!(lane_successor_epoch(project), None);
        let (_, reopened) = admit_publication(lane_request(project, 3)).unwrap();
        assert!(finish_publication(project, &reopened).is_none());
    }

    fn unchanged_fixture(
        project: &std::path::Path,
        store: &Store,
        policy: &CheckpointPolicy,
    ) -> (
        oleafly_history::Checkpoint,
        Vec<oleafly_history::CheckpointFile>,
    ) {
        let inputs = build_capture_inputs(
            project,
            &["main.typ".into(), "scratch/data.csv".into()],
            "main.typ",
            policy,
            None,
        )
        .unwrap();
        let candidate = store.stage_candidate(project, &inputs).unwrap();
        let root = *candidate.snapshot_root();
        let replayed = candidate
            .proven_files()
            .iter()
            .map(|file| ReplayedInput::new(&file.relative_path, file.content_hash).unwrap())
            .collect::<Vec<_>>();
        let evidence = CompileEvidence::new(
            "typst",
            "typst-test@1",
            "main.typ",
            ContentHash::digest(b"pdf"),
            10,
            replayed,
        )
        .unwrap();
        store.publish(candidate, evidence).unwrap();
        let checkpoint = store.latest_checkpoint().unwrap().unwrap();
        assert_eq!(checkpoint.snapshot_root, root);
        let files = store.checkpoint_files(&root).unwrap().unwrap();
        (checkpoint, files)
    }

    #[test]
    fn an_identical_worktree_matches_the_newest_checkpoint_manifest() {
        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir_all(project.join("scratch")).unwrap();
        fs::create_dir_all(project.join("figures")).unwrap();
        fs::write(project.join("project.json"), b"{}").unwrap();
        fs::write(project.join("main.typ"), b"main").unwrap();
        fs::write(project.join("scratch/data.csv"), b"data").unwrap();
        fs::write(project.join("figures/plot.png"), b"plot").unwrap();
        let policy: CheckpointPolicy = serde_json::from_value(serde_json::json!({
            "always_include": ["figures/*.png"],
            "ignored": ["scratch/*.csv"]
        }))
        .unwrap();
        let store = Store::open(temp.path().join("history")).unwrap();
        let (checkpoint, files) = unchanged_fixture(&project, &store, &policy);
        assert!(files
            .iter()
            .any(|file| file.relative_path == "scratch/data.csv" && !file.stored));

        assert!(manifest_matches_worktree(
            &project,
            "main.typ",
            &policy,
            &checkpoint,
            &files,
            None
        ));

        fs::write(project.join("main.typ"), b"edited").unwrap();
        assert!(
            !manifest_matches_worktree(&project, "main.typ", &policy, &checkpoint, &files, None),
            "an edited compiler input must not read as unchanged"
        );
        fs::write(project.join("main.typ"), b"main").unwrap();

        fs::write(project.join("scratch/data.csv"), b"edited data").unwrap();
        assert!(
            !manifest_matches_worktree(&project, "main.typ", &policy, &checkpoint, &files, None),
            "an edited unstored input must not read as unchanged"
        );
        fs::write(project.join("scratch/data.csv"), b"data").unwrap();

        fs::write(project.join("figures/extra.png"), b"extra").unwrap();
        assert!(
            !manifest_matches_worktree(&project, "main.typ", &policy, &checkpoint, &files, None),
            "a new always-included file must not read as unchanged"
        );
        fs::remove_file(project.join("figures/extra.png")).unwrap();

        let unignored: CheckpointPolicy =
            serde_json::from_value(serde_json::json!({"always_include": ["figures/*.png"]}))
                .unwrap();
        assert!(
            !manifest_matches_worktree(&project, "main.typ", &unignored, &checkpoint, &files, None),
            "clearing the ignore list changes the stored flags and must not read as unchanged"
        );

        fs::remove_file(project.join("figures/plot.png")).unwrap();
        assert!(
            !manifest_matches_worktree(&project, "main.typ", &policy, &checkpoint, &files, None),
            "a removed recorded file must not read as unchanged"
        );
    }

    fn encode_tectonic_cache_key(key: &str) -> String {
        let mut encoded = String::new();
        for byte in key.bytes() {
            if byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-' {
                encoded.push(byte as char);
            } else {
                encoded.push_str(&format!(",{byte},"));
            }
        }
        encoded
    }

    fn fake_ordinary_tectonic_cache(root: &std::path::Path, locator: &str, bundle_id: &str) {
        fs::create_dir_all(root.join("bundles/hashes")).unwrap();
        fs::create_dir_all(root.join("bundles/data").join(bundle_id)).unwrap();
        fs::create_dir_all(root.join("formats")).unwrap();
        fs::write(
            root.join("bundles/hashes")
                .join(encode_tectonic_cache_key(locator)),
            format!("{bundle_id}\n"),
        )
        .unwrap();
        fs::write(
            root.join("bundles/data").join(format!("{bundle_id}.index")),
            b"index bytes",
        )
        .unwrap();
        fs::write(
            root.join("bundles/data")
                .join(bundle_id)
                .join("article.cls"),
            b"class bytes",
        )
        .unwrap();
        fs::write(
            root.join("bundles/data").join(bundle_id).join("latex.ltx"),
            b"format source",
        )
        .unwrap();
        fs::write(
            root.join("formats")
                .join(format!("{bundle_id}-xelatex.fmt")),
            b"format bytes",
        )
        .unwrap();
    }

    #[test]
    fn probe_cache_seeding_copies_only_the_selected_bundle_and_keeps_existing_files() {
        let directory = tempdir().unwrap();
        let ordinary = directory.path().join("ordinary");
        let probe = directory.path().join("probe");
        let locator = "https://mirrors.oleafly.test/tex-bundles/tlextras-2022.0r0.tar";
        let other_locator = "https://mirrors.oleafly.test/tex-bundles/other.tar";
        let bundle = "a".repeat(64);
        let other_bundle = "b".repeat(64);
        fake_ordinary_tectonic_cache(&ordinary, locator, &bundle);
        fake_ordinary_tectonic_cache(&ordinary, other_locator, &other_bundle);
        fs::create_dir_all(probe.join("bundles/data").join(&bundle)).unwrap();
        fs::write(
            probe.join("bundles/data").join(&bundle).join("article.cls"),
            b"already cached",
        )
        .unwrap();

        seed_probe_tectonic_cache_from(&ordinary, &probe, locator).unwrap();

        assert_eq!(
            fs::read_to_string(
                probe
                    .join("bundles/hashes")
                    .join(encode_tectonic_cache_key(locator))
            )
            .unwrap(),
            format!("{bundle}\n")
        );
        assert_eq!(
            fs::read(probe.join("bundles/data").join(format!("{bundle}.index"))).unwrap(),
            b"index bytes"
        );
        assert_eq!(
            fs::read(probe.join("bundles/data").join(&bundle).join("latex.ltx")).unwrap(),
            b"format source"
        );
        assert_eq!(
            fs::read(probe.join("bundles/data").join(&bundle).join("article.cls")).unwrap(),
            b"already cached",
            "an already cached file must never be replaced"
        );
        assert_eq!(
            fs::read(probe.join("formats").join(format!("{bundle}-xelatex.fmt"))).unwrap(),
            b"format bytes"
        );
        assert!(!probe.join("bundles/data").join(&other_bundle).exists());
        assert!(!probe
            .join("formats")
            .join(format!("{other_bundle}-xelatex.fmt"))
            .exists());
        assert!(!probe
            .join("bundles/hashes")
            .join(encode_tectonic_cache_key(other_locator))
            .exists());

        seed_probe_tectonic_cache_from(&ordinary, &probe, locator).unwrap();
        assert_eq!(
            fs::read(probe.join("bundles/data").join(&bundle).join("latex.ltx")).unwrap(),
            b"format source"
        );
    }

    #[test]
    fn probe_cache_seeding_is_silent_without_an_ordinary_cache_or_the_bundle() {
        let directory = tempdir().unwrap();
        let probe = directory.path().join("probe");
        let missing = directory.path().join("absent");

        seed_probe_tectonic_cache_from(&missing, &probe, "https://example.test/bundle.tar")
            .unwrap();
        assert!(!probe.exists());

        let ordinary = directory.path().join("ordinary");
        fake_ordinary_tectonic_cache(&ordinary, "https://example.test/one.tar", &"c".repeat(64));
        assert!(
            seed_probe_tectonic_cache_from(&ordinary, &probe, "https://example.test/two.tar")
                .is_err()
        );
        assert!(!probe.exists());
    }

    #[cfg(unix)]
    #[test]
    fn probe_cache_seeding_never_follows_a_link_in_the_ordinary_cache() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().unwrap();
        let ordinary = directory.path().join("ordinary");
        let probe = directory.path().join("probe");
        let locator = "https://example.test/linked.tar";
        let bundle = "d".repeat(64);
        fake_ordinary_tectonic_cache(&ordinary, locator, &bundle);
        let outside = directory.path().join("outside.tex");
        fs::write(&outside, b"outside bytes").unwrap();
        symlink(
            &outside,
            ordinary
                .join("bundles/data")
                .join(&bundle)
                .join("linked.tex"),
        )
        .unwrap();
        symlink(
            &outside,
            ordinary
                .join("formats")
                .join(format!("{bundle}-linked.fmt")),
        )
        .unwrap();

        seed_probe_tectonic_cache_from(&ordinary, &probe, locator).unwrap();

        assert!(!probe
            .join("bundles/data")
            .join(&bundle)
            .join("linked.tex")
            .exists());
        assert!(!probe
            .join("formats")
            .join(format!("{bundle}-linked.fmt"))
            .exists());
        assert!(probe
            .join("bundles/data")
            .join(&bundle)
            .join("latex.ltx")
            .is_file());
    }

    fn backdate(path: &std::path::Path, modified: std::time::SystemTime) {
        fs::OpenOptions::new()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(modified)
            .unwrap();
    }

    #[test]
    fn settled_tectonic_cache_identity_is_reused_until_its_stat_fingerprint_changes() {
        let temp = tempdir().unwrap();
        let cache = temp.path();
        let hashes = cache.join("bundles/hashes");
        let data = cache.join("bundles/data");
        fs::create_dir_all(&hashes).unwrap();
        fs::create_dir_all(&data).unwrap();
        let locator = "https://mirrors.oleafly.com/tex-bundles/tlextras-2022.0r0.tar";
        let cache_key =
            "https,58,,47,,47,mirrors.oleafly.com,47,tex-bundles,47,tlextras-2022.0r0.tar";
        let bundle_id = "6ffe055852f8faf66c0acbe1a7fb27f87b869a90bad1204f3bf4d9683f597c7c";
        fs::write(hashes.join(cache_key), format!("{bundle_id}\n")).unwrap();
        let index = data.join(format!("{bundle_id}.index"));
        fs::write(&index, b"index-v1").unwrap();
        let resources = data.join(bundle_id);
        fs::create_dir(&resources).unwrap();
        let class = resources.join("article.cls");
        fs::write(&class, b"class-v1").unwrap();
        let formats = cache.join("formats");
        fs::create_dir(&formats).unwrap();
        let format = formats.join(format!("{bundle_id}-latex-33.fmt"));
        fs::write(&format, b"format-v1").unwrap();
        let canonical = cache.canonicalize().unwrap();
        assert!(
            !tectonic_cache_fingerprint(&canonical, bundle_id)
                .unwrap()
                .settled
        );

        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        for path in [&index, &class, &format] {
            backdate(path, old);
        }
        assert!(
            tectonic_cache_fingerprint(&canonical, bundle_id)
                .unwrap()
                .settled
        );
        let identity = read_tectonic_bundle_identity(cache, locator).unwrap();

        fs::write(&class, b"class-v2").unwrap();
        backdate(&class, old);
        assert_eq!(
            read_tectonic_bundle_identity(cache, locator).unwrap(),
            identity,
            "an unchanged stat fingerprint reuses the recorded identity"
        );

        fs::write(&class, b"class-v2-longer").unwrap();
        backdate(&class, old);
        assert_ne!(
            read_tectonic_bundle_identity(cache, locator).unwrap(),
            identity,
            "a changed length invalidates the recorded identity"
        );
    }

    #[test]
    fn tectonic_bundle_identity_binds_the_selected_cache_marker_and_index() {
        let temp = tempdir().unwrap();
        let cache = temp.path();
        let hashes = cache.join("bundles/hashes");
        let data = cache.join("bundles/data");
        fs::create_dir_all(&hashes).unwrap();
        fs::create_dir_all(&data).unwrap();
        let locator = "https://mirrors.oleafly.com/tex-bundles/tlextras-2022.0r0.tar";
        let cache_key =
            "https,58,,47,,47,mirrors.oleafly.com,47,tex-bundles,47,tlextras-2022.0r0.tar";
        let bundle_id = "6ffe055852f8faf66c0acbe1a7fb27f87b869a90bad1204f3bf4d9683f597c7c";
        fs::write(hashes.join(cache_key), format!("{bundle_id}\n")).unwrap();
        fs::write(data.join(format!("{bundle_id}.index")), b"index-v1").unwrap();
        let resources = data.join(bundle_id);
        fs::create_dir(&resources).unwrap();
        fs::write(resources.join("article.cls"), b"class-v1").unwrap();
        let formats = cache.join("formats");
        fs::create_dir(&formats).unwrap();
        fs::write(
            formats.join(format!("{bundle_id}-latex-33.fmt")),
            b"format-v1",
        )
        .unwrap();

        let identity = read_tectonic_bundle_identity(cache, locator).unwrap();

        assert!(identity.contains(&format!("bundle-sha256={bundle_id}")));
        assert!(identity.contains(&format!(
            "bundle-index-blake3={}",
            oleafly_history::ContentHash::digest(b"index-v1")
        )));
        fs::write(resources.join("article.cls"), b"class-v2").unwrap();
        assert_ne!(
            read_tectonic_bundle_identity(cache, locator).unwrap(),
            identity,
            "the identity must bind the cache bytes Tectonic actually opens"
        );
        assert!(read_tectonic_bundle_identity(cache, "https://example.test/other.tar").is_err());
    }

    #[test]
    fn capture_inputs_record_ignored_dependencies_by_identity_and_expand_only_explicit_policy_matches(
    ) {
        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir_all(project.join("figures/deep")).unwrap();
        fs::create_dir_all(project.join("scratch")).unwrap();
        let mut unrelated = project.join("unrelated");
        fs::create_dir(&unrelated).unwrap();
        for _ in 0..70 {
            unrelated.push("deep");
            fs::create_dir(&unrelated).unwrap();
        }
        fs::write(project.join("project.json"), b"{}").unwrap();
        fs::write(project.join("main.typ"), b"main").unwrap();
        fs::write(project.join("figures/plot.png"), b"plot").unwrap();
        fs::write(project.join("figures/deep/unused.png"), b"unused").unwrap();
        fs::write(project.join("scratch/data.csv"), b"data").unwrap();
        let ignored: CheckpointPolicy = serde_json::from_value(serde_json::json!({
            "ignored": ["scratch/*.csv", "main.typ"]
        }))
        .unwrap();

        let inputs = build_capture_inputs(
            &project,
            &["main.typ".into(), "scratch/data.csv".into()],
            "main.typ",
            &ignored,
            None,
        )
        .unwrap();
        let stored = inputs
            .iter()
            .map(|input| (input.relative_path(), input.is_stored()))
            .collect::<Vec<_>>();
        assert_eq!(
            stored,
            [
                ("main.typ", true),
                ("project.json", true),
                ("scratch/data.csv", false),
            ]
        );

        let include: CheckpointPolicy = serde_json::from_value(serde_json::json!({
            "always_include": ["figures/*.png"]
        }))
        .unwrap();
        let inputs =
            build_capture_inputs(&project, &["main.typ".into()], "main.typ", &include, None)
                .unwrap();
        let paths = inputs
            .iter()
            .map(|input| input.relative_path())
            .collect::<Vec<_>>();
        assert_eq!(paths, ["figures/plot.png", "main.typ", "project.json"]);
    }

    #[test]
    fn always_include_prunes_nested_protected_project_directories() {
        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir_all(project.join("figures/.git")).unwrap();
        fs::create_dir_all(project.join("figures/.oleafly")).unwrap();
        fs::create_dir_all(project.join("figures/node_modules/package")).unwrap();
        fs::write(project.join("project.json"), b"{}").unwrap();
        fs::write(project.join("main.typ"), b"main").unwrap();
        fs::write(project.join("figures/plot.png"), b"plot").unwrap();
        fs::write(project.join("figures/.git/config"), b"credentials").unwrap();
        fs::write(project.join("figures/.oleafly/private"), b"private").unwrap();
        fs::write(
            project.join("figures/node_modules/package/index.js"),
            b"dependency",
        )
        .unwrap();
        let policy: CheckpointPolicy = serde_json::from_value(serde_json::json!({
            "always_include": ["figures"]
        }))
        .unwrap();

        let inputs =
            build_capture_inputs(&project, &["main.typ".into()], "main.typ", &policy, None)
                .unwrap();
        let paths = inputs
            .iter()
            .map(|input| input.relative_path())
            .collect::<Vec<_>>();

        assert_eq!(paths, ["figures/plot.png", "main.typ", "project.json"]);
    }

    #[test]
    fn replay_closure_requires_every_and_only_replay_required_file() {
        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir(&project).unwrap();
        fs::write(project.join("project.json"), b"{}").unwrap();
        fs::write(project.join("main.typ"), b"main").unwrap();
        fs::write(project.join("data.csv"), b"data").unwrap();
        let store = oleafly_history::Store::open(temp.path().join("history")).unwrap();
        let inputs = build_capture_inputs(
            &project,
            &["data.csv".into(), "main.typ".into()],
            "main.typ",
            &CheckpointPolicy::default(),
            None,
        )
        .unwrap();
        let candidate = store.stage_candidate(&project, &inputs).unwrap();

        let replayed =
            replayed_inputs_for(&candidate, &["data.csv".into(), "main.typ".into()]).unwrap();
        assert_eq!(replayed.len(), 2);

        let missing = replayed_inputs_for(&candidate, &["main.typ".into()]).unwrap_err();
        assert_eq!(
            missing.reason,
            CheckpointSkipReason::DependencyEvidenceUnavailable
        );
        let extra = replayed_inputs_for(
            &candidate,
            &["data.csv".into(), "extra.typ".into(), "main.typ".into()],
        )
        .unwrap_err();
        assert_eq!(
            extra.reason,
            CheckpointSkipReason::DependencyEvidenceUnavailable
        );
    }

    #[test]
    fn report_and_project_path_validation_fail_closed() {
        let skipped = CheckpointPublicationOutcome::skipped(
            CheckpointSkipReason::DependencyEvidenceUnavailable,
            "missing evidence",
            "compile again",
        );
        assert!(matches!(
            skipped,
            CheckpointPublicationOutcome::Skipped { .. }
        ));
        assert_eq!(
            super::AdapterFailure::unavailable("missing").detail,
            "missing"
        );
        assert_eq!(super::AdapterFailure::external("outside").detail, "outside");

        super::ensure_checkpoint_not_cancelled(None).unwrap();
        let cancel = crate::state::CompileCancel::default();
        {
            let _scope = super::CheckpointCancelScope::new(Some(&cancel));
            assert_eq!(cancel.request(), None);
            let error = super::ensure_checkpoint_not_cancelled(Some(&cancel)).unwrap_err();
            assert!(error.detail.contains("cancelled"));
        }
        assert!(!cancel.is_requested());
        let _scope = super::CheckpointCancelScope::new(None);

        assert!(super::validate_report_size(b"").is_err());
        assert!(super::validate_report_size(b"complete").is_ok());
        assert!(
            super::validate_report_size(&vec![0; super::MAX_DEPENDENCY_REPORT_BYTES + 1]).is_err()
        );

        assert_eq!(
            super::portable_relative(std::path::Path::new("chapters/one.typ")).unwrap(),
            "chapters/one.typ"
        );
        for unsafe_path in ["", "../outside", ".git/config", "bad\nname"] {
            assert!(super::portable_relative(std::path::Path::new(unsafe_path)).is_err());
        }

        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        let outside = temp.path().join("outside.typ");
        fs::create_dir(&project).unwrap();
        fs::write(project.join("main.typ"), b"main").unwrap();
        fs::write(&outside, b"outside").unwrap();
        assert_eq!(
            super::normalize_project_dependency(std::path::Path::new("main.typ"), &project)
                .unwrap(),
            "main.typ"
        );
        assert!(super::normalize_project_dependency(&outside, &project).is_err());
        assert!(
            super::normalize_project_dependency(std::path::Path::new("missing.typ"), &project)
                .is_err()
        );
        assert!(super::normalize_project_dependency(std::path::Path::new("."), &project).is_err());

        assert!(super::path_is_inside_any(
            &project.join("main.typ"),
            std::slice::from_ref(&project)
        ));
        assert!(!super::path_is_lexically_inside_any(
            &project.join("../outside.typ"),
            std::slice::from_ref(&project)
        ));

        let mut dependencies = std::collections::BTreeSet::new();
        for index in 0..super::MAX_DEPENDENCY_COUNT {
            dependencies.insert(format!("input-{index}"));
        }
        assert!(super::insert_dependency(&mut dependencies, "one-too-many".into()).is_err());
    }

    #[test]
    fn dependency_report_parsers_reject_ambiguous_or_incomplete_evidence() {
        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir(&project).unwrap();
        fs::write(project.join("main.typ"), b"main").unwrap();

        for report in [
            b"not-a-rule\n".as_slice(),
            b"target : input".as_slice(),
            b"target : \nother-rule\n".as_slice(),
            b"target : input\n".as_slice(),
        ] {
            assert!(parse_tectonic_dependencies(
                report,
                &project,
                TectonicDependencyLayout::ResolvedPaths,
                &[],
            )
            .is_err());
        }
        assert!(parse_tectonic_dependencies(
            b"target : \xff\n",
            &project,
            TectonicDependencyLayout::ResolvedPaths,
            &[],
        )
        .is_err());

        assert!(parse_typst_dependencies(b"main.typ", &project).is_err());
        assert!(parse_typst_dependencies(b"\xff\0", &project).is_err());
        assert!(parse_typst_dependencies(b"\0", &project).is_err());

        assert!(parse_pandoc_resources(b"not-json", &project).is_err());
        let ignored = serde_json::to_vec(&serde_json::json!([{"type": "Diagnostic"}])).unwrap();
        assert!(parse_pandoc_resources(&ignored, &project)
            .unwrap()
            .is_empty());
        let missing_path =
            serde_json::to_vec(&serde_json::json!([{"type": "LoadedResource"}])).unwrap();
        assert!(parse_pandoc_resources(&missing_path, &project).is_err());
        for source in ["data:image/png;base64,AAAA", "file:///tmp/outside.png"] {
            let remote = serde_json::to_vec(&serde_json::json!([{
                "type": "LoadedResource",
                "from": source
            }]))
            .unwrap();
            assert_eq!(
                parse_pandoc_resources(&remote, &project)
                    .unwrap_err()
                    .reason,
                CheckpointSkipReason::ExternalDependency
            );
        }
    }

    #[tokio::test]
    async fn probe_workspace_dispatches_reports_and_cleans_up() {
        let workspace = super::ProbeWorkspace::create().unwrap();
        let workspace_root = workspace.root.clone();
        assert!(workspace.discovery().is_dir());
        assert!(workspace.replay().is_dir());
        assert_eq!(
            workspace.create_output("discovery").unwrap(),
            workspace.discovery()
        );
        fs::create_dir_all(workspace.generated_temp_root()).unwrap();

        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        let output = temp.path().join("output");
        fs::create_dir(&project).unwrap();
        fs::create_dir(&output).unwrap();
        fs::write(project.join("main.typ"), b"main").unwrap();

        let typst_report = [project.join("main.typ").to_string_lossy().as_bytes(), b"\0"].concat();
        fs::write(output.join("checkpoint-typst-deps.zero"), typst_report).unwrap();
        assert_eq!(
            super::dependencies_from_probe(
                crate::document_engine::DocumentEngineId::Typst,
                &output,
                &project,
                "main.typ",
                &workspace,
            )
            .unwrap(),
            ["main.typ"]
        );

        let latex_report = format!(
            "{output}/entry.pdf : {output}/entry.tex \\\n  {output}/main.typ\n",
            output = output.display()
        );
        fs::write(output.join("checkpoint-tectonic-deps.mk"), &latex_report).unwrap();
        assert_eq!(
            super::dependencies_from_probe(
                crate::document_engine::DocumentEngineId::Latex,
                &output,
                &project,
                "main.typ",
                &workspace,
            )
            .unwrap(),
            ["main.typ"]
        );

        fs::write(output.join("checkpoint-pandoc-log.json"), b"[]").unwrap();
        let markdown_report = format!(
            "{output}/entry.pdf : {output}/entry.tex \\\n  {main}\n",
            output = output.display(),
            main = project.join("main.typ").display()
        );
        fs::write(output.join("checkpoint-tectonic-deps.mk"), markdown_report).unwrap();
        assert_eq!(
            super::dependencies_from_probe(
                crate::document_engine::DocumentEngineId::Markdown,
                &output,
                &project,
                "main.typ",
                &workspace,
            )
            .unwrap(),
            ["main.typ"]
        );
        assert!(super::dependencies_from_probe(
            crate::document_engine::DocumentEngineId::Latexmk,
            &output,
            &project,
            "main.typ",
            &workspace,
        )
        .is_err());

        fs::write(
            output.join(format!("{}.bcf", crate::paths::ENTRY_STEM)),
            b"biber",
        )
        .unwrap();
        assert_eq!(
            super::dependencies_from_probe(
                crate::document_engine::DocumentEngineId::Latex,
                &output,
                &project,
                "main.typ",
                &workspace,
            )
            .unwrap_err()
            .reason,
            CheckpointSkipReason::UntrackedExternalCommands
        );

        let report = output.join("checkpoint-pandoc-log.json");
        assert_eq!(super::read_dependency_report(&report).unwrap(), b"[]");
        let unsafe_report = output.join("unsafe-report");
        fs::create_dir(&unsafe_report).unwrap();
        assert!(super::read_dependency_report(&unsafe_report).is_err());

        let lock_path = temp.path().join("available.lock");
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&lock_path)
            .unwrap();
        let locked = wait_for_tectonic_cache_lock(
            lock,
            &lock_path,
            std::time::Duration::from_millis(50),
            None,
        )
        .await
        .unwrap();
        fs4::FileExt::unlock(&locked).unwrap();

        drop(workspace);
        assert!(!workspace_root.exists());
    }

    #[test]
    fn cache_helpers_validate_shape_and_hash_stable_inputs() {
        assert_eq!(
            super::decode_tectonic_cache_key("https,58,,47,,47,example.test"),
            Some("https://example.test".into())
        );
        for malformed in [",", ",x,", ",999,", ",12"] {
            assert_eq!(super::decode_tectonic_cache_key(malformed), None);
        }

        let temp = tempdir().unwrap();
        let cache = temp.path().canonicalize().unwrap();
        let tree = cache.join("tree");
        let nested = tree.join("nested");
        fs::create_dir_all(&nested).unwrap();
        let input = nested.join("input.dat");
        fs::write(&input, b"stable-input").unwrap();

        assert_eq!(
            super::checked_cache_file(&input, &cache, "cache file", 64).unwrap(),
            input.canonicalize().unwrap()
        );
        assert!(super::checked_cache_file(&input, &cache, "cache file", 1).is_err());
        assert!(super::checked_cache_file(&nested, &cache, "cache file", 64).is_err());
        assert_eq!(
            super::checked_cache_directory(&nested, &cache, "cache directory").unwrap(),
            nested.canonicalize().unwrap()
        );
        assert!(super::checked_cache_directory(&input, &cache, "cache directory").is_err());
        assert!(!super::metadata_is_reparse_point(
            &fs::metadata(&input).unwrap()
        ));

        let (_, length, hash) =
            super::hash_stable_cache_file(&input, &cache, "cache file", 64).unwrap();
        assert_eq!(length, b"stable-input".len() as u64);
        assert_eq!(hash, ContentHash::digest(b"stable-input"));
        assert_eq!(
            super::read_stable_cache_file(&input, &cache, "cache file", 64).unwrap(),
            b"stable-input"
        );
        assert!(super::hash_tectonic_cache_tree(&tree, &cache, "cache tree")
            .unwrap()
            .contains("files=1"));

        assert_eq!(
            super::portable_cache_relative(std::path::Path::new("nested/input.dat")).unwrap(),
            "nested/input.dat"
        );
        for unsafe_path in ["", "../outside", "bad\nname"] {
            assert!(super::portable_cache_relative(std::path::Path::new(unsafe_path)).is_err());
        }

        assert!(super::hash_cache_entries("empty cache", Vec::new()).is_err());
        assert!(super::hash_cache_entries(
            "oversized cache",
            vec![(
                "huge".into(),
                super::MAX_TECTONIC_CACHE_TOTAL_BYTES + 1,
                ContentHash::digest(b"huge"),
            )],
        )
        .is_err());
        assert!(super::hash_cache_entries(
            "stable cache",
            vec![
                ("b".into(), 1, ContentHash::digest(b"b")),
                ("a".into(), 1, ContentHash::digest(b"a")),
            ],
        )
        .unwrap()
        .contains("files=2;bytes=2"));

        let empty_formats = cache.join("formats");
        fs::create_dir(&empty_formats).unwrap();
        assert!(super::hash_tectonic_formats(&empty_formats, &cache, "bundle").is_err());
        let mut inspected = usize::MAX;
        assert!(super::record_directory_entry(&mut inspected, usize::MAX, "cache").is_err());
    }
}
