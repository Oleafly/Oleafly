//! Evidence checks before review: does the project build, do references
//! resolve, are new bibliography entries real, do numbers match the runs
//! they cite, are new figures used. The checks only warn; the review never
//! waits on them and nothing is blocked.
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use oleafly_agent::CancellationToken;
use serde_json::Value;

use crate::host::WorkspaceTools;
use crate::model::{
    now_ms, EvidenceCheck, EvidenceCheckId, EvidenceItem, EvidenceReport, EvidenceStatus,
    RunRecord, TaskFileChange, TaskFileChangeKind, TaskIsolation,
};
use crate::record::LedgerRow;

mod bib;
pub mod figures;
pub mod numbers;
#[cfg(test)]
mod tests;

pub use numbers::{number_matches, numbers_with_run_markers};

const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_WALK_ENTRIES: usize = 20_000;
const CLI_MISSING: &str = "The command-line tool isn't available.";

/// What the checks look at.
pub struct EvidenceInputs<'a> {
    pub isolation: &'a TaskIsolation,
    pub changes: &'a [TaskFileChange],
    pub runs: Vec<RunRecord>,
    pub ledger: Vec<LedgerRow>,
    pub workspace: Option<Arc<dyn WorkspaceTools>>,
}

pub async fn check_evidence(
    inputs: EvidenceInputs<'_>,
    cancel: &CancellationToken,
) -> EvidenceReport {
    check_evidence_with(inputs, cancel, bib::crossref_verifier()).await
}

pub(crate) async fn check_evidence_with(
    inputs: EvidenceInputs<'_>,
    cancel: &CancellationToken,
    verify: bib::Verifier,
) -> EvidenceReport {
    let root = PathBuf::from(&inputs.isolation.execution_root);
    let baseline = PathBuf::from(&inputs.isolation.baseline_root);
    let mut checks = Vec::with_capacity(5);
    checks.push(build_check(inputs.workspace.as_deref(), &root).await);
    if !cancel.is_cancelled() {
        checks.push(references_check(inputs.workspace.as_deref(), &root, &baseline).await);
    }
    if !cancel.is_cancelled() {
        checks.push(bibliography_check(inputs.changes, &root, &baseline, verify).await);
    }
    if !cancel.is_cancelled() {
        checks.push(numbers_check(
            inputs.changes,
            &root,
            &inputs.runs,
            &inputs.ledger,
        ));
    }
    if !cancel.is_cancelled() {
        checks.push(figures_check(inputs.changes, &root));
    }
    EvidenceReport {
        checked_at: now_ms(),
        checks,
    }
}

fn check(id: EvidenceCheckId, items: Vec<EvidenceItem>) -> EvidenceCheck {
    EvidenceCheck {
        id,
        status: if items.is_empty() {
            EvidenceStatus::Pass
        } else {
            EvidenceStatus::Warn
        },
        items,
    }
}

fn skipped(id: EvidenceCheckId, item: EvidenceItem) -> EvidenceCheck {
    EvidenceCheck {
        id,
        status: EvidenceStatus::Skipped,
        items: vec![item],
    }
}

fn item(
    code: &str,
    file: Option<&str>,
    line: Option<u32>,
    params: &[(&str, String)],
) -> EvidenceItem {
    EvidenceItem {
        code: code.to_owned(),
        file: file.map(str::to_owned),
        line,
        params: params
            .iter()
            .map(|(name, value)| ((*name).to_owned(), value.clone()))
            .collect(),
    }
}

async fn build_check(workspace: Option<&dyn WorkspaceTools>, root: &Path) -> EvidenceCheck {
    let Some(workspace) = workspace else {
        return skipped(
            EvidenceCheckId::Build,
            item(
                "build.skipped",
                None,
                None,
                &[("reason", CLI_MISSING.into())],
            ),
        );
    };
    match workspace.compile(root.to_path_buf()).await {
        Ok(summary) => match summary.skipped {
            Some(reason) => skipped(
                EvidenceCheckId::Build,
                item("build.skipped", None, None, &[("reason", reason)]),
            ),
            None if summary.ok => check(EvidenceCheckId::Build, Vec::new()),
            None => check(
                EvidenceCheckId::Build,
                vec![item(
                    "build.failed",
                    None,
                    None,
                    &[("errors", summary.errors.max(1).to_string())],
                )],
            ),
        },
        Err(reason) => skipped(
            EvidenceCheckId::Build,
            item("build.skipped", None, None, &[("reason", reason)]),
        ),
    }
}

/// The keys a project map lists as unresolved references and citations.
fn unresolved(map: &Value) -> BTreeSet<String> {
    [
        "unresolvedRefs",
        "unresolvedCites",
        "unresolved_refs",
        "unresolved_cites",
    ]
    .iter()
    .flat_map(|name| map[name].as_array().cloned().unwrap_or_default())
    .filter_map(|value| match value {
        Value::String(key) => Some(key),
        Value::Object(object) => object
            .get("key")
            .or_else(|| object.get("label"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        _ => None,
    })
    .collect()
}

async fn references_check(
    workspace: Option<&dyn WorkspaceTools>,
    root: &Path,
    baseline: &Path,
) -> EvidenceCheck {
    let not_checked = || {
        skipped(
            EvidenceCheckId::References,
            item("references.notChecked", None, None, &[]),
        )
    };
    let Some(workspace) = workspace else {
        return not_checked();
    };
    let (Ok(after), Ok(before)) = (
        workspace.project_map(root.to_path_buf()).await,
        workspace.project_map(baseline.to_path_buf()).await,
    ) else {
        return not_checked();
    };
    let known = unresolved(&before);
    let items = unresolved(&after)
        .into_iter()
        .filter(|key| !known.contains(key))
        .map(|key| item("references.unresolved", None, None, &[("key", key)]))
        .collect();
    check(EvidenceCheckId::References, items)
}

fn read_text(path: &Path) -> Option<String> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_TEXT_BYTES {
        return None;
    }
    String::from_utf8(std::fs::read(path).ok()?).ok()
}

fn changed_after(changes: &[TaskFileChange]) -> impl Iterator<Item = &TaskFileChange> {
    changes
        .iter()
        .filter(|change| change.after_sha256.is_some())
}

async fn bibliography_check(
    changes: &[TaskFileChange],
    root: &Path,
    baseline: &Path,
    verify: bib::Verifier,
) -> EvidenceCheck {
    let mut entries = Vec::new();
    for change in
        changed_after(changes).filter(|change| change.path.to_ascii_lowercase().ends_with(".bib"))
    {
        let Some(after) = read_text(&root.join(&change.path)) else {
            continue;
        };
        let before = (change.kind == TaskFileChangeKind::Modified)
            .then(|| read_text(&baseline.join(&change.path)))
            .flatten();
        entries.extend(bib::new_entries(before.as_deref(), &after, &change.path));
    }
    check(
        EvidenceCheckId::Bibliography,
        bib::verify_entries(entries, verify).await,
    )
}

fn numbers_check(
    changes: &[TaskFileChange],
    root: &Path,
    runs: &[RunRecord],
    ledger: &[LedgerRow],
) -> EvidenceCheck {
    let runs: HashMap<&str, &RunRecord> =
        runs.iter().map(|run| (run.run_id.as_str(), run)).collect();
    let ledger: BTreeSet<&str> = ledger.iter().map(|row| row.id.as_str()).collect();
    let mut items = Vec::new();
    for change in changed_after(changes).filter(|change| figures::is_text(&change.path)) {
        let Some(text) = read_text(&root.join(&change.path)) else {
            continue;
        };
        for (line, values, run_id) in numbers_with_run_markers(&text) {
            let file = Some(change.path.as_str());
            let Some(run) = runs.get(run_id.as_str()) else {
                items.push(item(
                    "numbers.unknownRun",
                    file,
                    Some(line),
                    &[("run", run_id)],
                ));
                continue;
            };
            if !ledger.contains(run_id.as_str()) {
                items.push(item(
                    "numbers.noLedgerRow",
                    file,
                    Some(line),
                    &[("run", run_id.clone())],
                ));
            }
            let recorded = run
                .metrics
                .iter()
                .map(|(name, value)| format!("{name}={value}"))
                .collect::<Vec<_>>()
                .join(", ");
            for value in values {
                if !run
                    .metrics
                    .values()
                    .any(|metric| number_matches(&value, *metric))
                {
                    items.push(item(
                        "numbers.mismatch",
                        file,
                        Some(line),
                        &[
                            ("value", value),
                            ("run", run_id.clone()),
                            ("recorded", recorded.clone()),
                        ],
                    ));
                }
            }
        }
    }
    check(EvidenceCheckId::Numbers, items)
}

/// Portable paths of the workspace's files (bounded).
fn workspace_files(root: &Path) -> BTreeSet<String> {
    let mut files = BTreeSet::new();
    let mut pending = vec![PathBuf::new()];
    let mut seen = 0usize;
    while let Some(relative) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(root.join(&relative)) else {
            continue;
        };
        for entry in entries.flatten() {
            seen += 1;
            if seen > MAX_WALK_ENTRIES {
                return files;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.')
                || [
                    "node_modules",
                    "__pycache__",
                    "venv",
                    "target",
                    "build",
                    "dist",
                ]
                .contains(&name.as_str())
            {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let path = relative.join(&name);
            if kind.is_dir() {
                pending.push(path);
            } else if kind.is_file() {
                files.insert(path.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    files
}

fn figures_check(changes: &[TaskFileChange], root: &Path) -> EvidenceCheck {
    let existing = workspace_files(root);
    let mut used: BTreeSet<String> = BTreeSet::new();
    let mut items = Vec::new();
    let changed_text: BTreeSet<&str> = changed_after(changes)
        .filter(|change| figures::is_text(&change.path))
        .map(|change| change.path.as_str())
        .collect();
    for path in existing.iter().filter(|path| figures::is_text(path)) {
        let Some(text) = read_text(&root.join(path)) else {
            continue;
        };
        for reference in figures::figure_references(&text) {
            match figures::resolve_reference(&reference, path, &existing) {
                Some(resolved) => {
                    used.insert(resolved);
                }
                None if changed_text.contains(path.as_str()) => {
                    items.push(item(
                        "figures.missing",
                        Some(path),
                        None,
                        &[("path", reference)],
                    ));
                }
                None => {}
            }
        }
    }
    for change in changes.iter().filter(|change| {
        change.kind == TaskFileChangeKind::Added && figures::is_image(&change.path)
    }) {
        if !used.contains(&change.path) {
            items.push(item(
                "figures.unused",
                Some(&change.path),
                None,
                &[("path", change.path.clone())],
            ));
        }
    }
    check(EvidenceCheckId::Figures, items)
}
