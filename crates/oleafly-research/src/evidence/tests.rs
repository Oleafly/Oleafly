use std::collections::BTreeMap;
use std::sync::Arc;

use super::*;
use crate::citation::CitationCheck;
use crate::model::{RunState, TaskIsolationKind};

fn isolation(root: &Path, baseline: &Path) -> TaskIsolation {
    TaskIsolation {
        kind: TaskIsolationKind::StagedProject,
        execution_root: root.to_string_lossy().into_owned(),
        baseline_root: baseline.to_string_lossy().into_owned(),
        source_revision: "snapshot:x".into(),
        baseline_hash: "x".into(),
        baseline: Vec::new(),
        allowed_paths: Vec::new(),
        created_at: 0,
        skipped: Vec::new(),
    }
}

fn change(path: &str, kind: TaskFileChangeKind) -> TaskFileChange {
    TaskFileChange {
        path: path.into(),
        kind,
        before_sha256: (kind != TaskFileChangeKind::Added).then(|| "b".into()),
        after_sha256: (kind != TaskFileChangeKind::Deleted).then(|| "a".into()),
        before_size: None,
        after_size: None,
    }
}

fn run(id: &str, metrics: &[(&str, f64)]) -> RunRecord {
    RunRecord {
        task_id: "t".into(),
        run_id: id.into(),
        execution_generation: 1,
        name: id.into(),
        executor: "local".into(),
        command: "python t.py".into(),
        cwd_rel: String::new(),
        state: RunState::Succeeded,
        exit_code: Some(0),
        started_at: 0,
        finished_at: Some(1),
        run_dir: String::new(),
        metrics: metrics
            .iter()
            .map(|(name, value)| ((*name).to_owned(), *value))
            .collect(),
        reported: true,
    }
}

fn fake_verifier() -> bib::Verifier {
    Arc::new(|doi, title| {
        Box::pin(async move {
            let mismatch = title.as_deref() == Some("Wrong Paper");
            Ok(CitationCheck {
                verified: !mismatch,
                source: if doi.is_some() {
                    "doi".into()
                } else {
                    "crossref-search".into()
                },
                doi,
                matched_title: Some("Another Paper".into()),
                score: Some(if mismatch { 0.3 } else { 1.0 }),
                bibtex: None,
                reason: mismatch.then(|| "The DOI belongs to a different title.".into()),
            })
        })
    })
}

fn find(report: &EvidenceReport, id: EvidenceCheckId) -> &EvidenceCheck {
    report.checks.iter().find(|check| check.id == id).unwrap()
}

#[tokio::test]
async fn a_number_without_a_recorded_run_is_flagged() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("work");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("main.tex"),
        "Acc & 0.913 \\\\ % run: r009\nAcc & 0.913 \\\\ % run: r002\nLoss 0.70 % run: r002\n",
    )
    .unwrap();
    let changes = [change("main.tex", TaskFileChangeKind::Modified)];
    let isolation = isolation(&root, &temp.path().join("base"));
    let report = check_evidence_with(
        EvidenceInputs {
            isolation: &isolation,
            changes: &changes,
            runs: vec![run("r002", &[("acc", 0.913), ("loss", 0.5)])],
            ledger: Vec::new(),
            workspace: None,
            project_root: None,
        },
        &CancellationToken::new(),
        fake_verifier(),
    )
    .await;
    let numbers = find(&report, EvidenceCheckId::Numbers);
    assert_eq!(numbers.status, EvidenceStatus::Warn);
    let codes: Vec<&str> = numbers
        .items
        .iter()
        .map(|item| item.code.as_str())
        .collect();
    assert!(codes.contains(&"numbers.unknownRun"));
    assert!(codes.contains(&"numbers.noLedgerRow"));
    let mismatch = numbers
        .items
        .iter()
        .find(|item| item.code == "numbers.mismatch")
        .unwrap();
    assert_eq!(mismatch.params["value"], "0.70");
    assert_eq!(mismatch.line, Some(3));
    assert_eq!(
        find(&report, EvidenceCheckId::Build).status,
        EvidenceStatus::Skipped
    );
    assert_eq!(
        find(&report, EvidenceCheckId::References).status,
        EvidenceStatus::Skipped
    );
}

#[tokio::test]
async fn new_bib_entries_are_verified_and_mismatches_warn() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("work");
    let base = temp.path().join("base");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&base).unwrap();
    std::fs::write(base.join("refs.bib"), "@article{old, title={Old}}\n").unwrap();
    std::fs::write(
        root.join("refs.bib"),
        "@article{old, title={Old}}\n@article{good, title={Good Paper}, doi={10.1/g}}\n@article{bad, title={Wrong Paper}}\n",
    )
    .unwrap();
    let changes = [change("refs.bib", TaskFileChangeKind::Modified)];
    let isolation = isolation(&root, &base);
    let report = check_evidence_with(
        EvidenceInputs {
            isolation: &isolation,
            changes: &changes,
            runs: Vec::new(),
            ledger: Vec::new(),
            workspace: None,
            project_root: None,
        },
        &CancellationToken::new(),
        fake_verifier(),
    )
    .await;
    let bibliography = find(&report, EvidenceCheckId::Bibliography);
    assert_eq!(bibliography.status, EvidenceStatus::Warn);
    assert_eq!(bibliography.items.len(), 1);
    assert_eq!(bibliography.items[0].code, "bib.titleMismatch");
    assert_eq!(bibliography.items[0].params["key"], "bad");
    assert_eq!(bibliography.items[0].params["found"], "Another Paper");
}

#[tokio::test]
async fn added_figures_must_be_used() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("work");
    std::fs::create_dir_all(root.join("figures")).unwrap();
    std::fs::write(root.join("figures/new.png"), b"png").unwrap();
    std::fs::write(root.join("figures/used.png"), b"png").unwrap();
    std::fs::write(
        root.join("main.tex"),
        "\\includegraphics{figures/used}\n\\includegraphics{figures/gone}\n",
    )
    .unwrap();
    let changes = [
        change("figures/new.png", TaskFileChangeKind::Added),
        change("figures/used.png", TaskFileChangeKind::Added),
        change("main.tex", TaskFileChangeKind::Modified),
    ];
    let isolation = isolation(&root, &temp.path().join("base"));
    let report = check_evidence_with(
        EvidenceInputs {
            isolation: &isolation,
            changes: &changes,
            runs: Vec::new(),
            ledger: Vec::new(),
            workspace: None,
            project_root: None,
        },
        &CancellationToken::new(),
        fake_verifier(),
    )
    .await;
    let figures = find(&report, EvidenceCheckId::Figures);
    let codes: Vec<(&str, &str)> = figures
        .items
        .iter()
        .map(|item| (item.code.as_str(), item.params["path"].as_str()))
        .collect();
    assert!(codes.contains(&("figures.unused", "figures/new.png")));
    assert!(codes.contains(&("figures.missing", "figures/gone")));
    assert!(!codes.iter().any(|(_, path)| *path == "figures/used.png"));
}

#[tokio::test]
async fn a_clean_result_passes_every_check_it_can_run() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("work");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("main.tex"), "Accuracy 0.91 % run: r001\n").unwrap();
    let changes = [change("main.tex", TaskFileChangeKind::Modified)];
    let isolation = isolation(&root, &temp.path().join("base"));
    let report = check_evidence_with(
        EvidenceInputs {
            isolation: &isolation,
            changes: &changes,
            runs: vec![run("r001", &[("acc", 0.913)])],
            ledger: vec![crate::record::LedgerRow {
                id: "r001".into(),
                metrics: BTreeMap::from([("acc".to_owned(), 0.913)]),
                ..Default::default()
            }],
            workspace: None,
            project_root: None,
        },
        &CancellationToken::new(),
        fake_verifier(),
    )
    .await;
    for id in [
        EvidenceCheckId::Bibliography,
        EvidenceCheckId::Numbers,
        EvidenceCheckId::Figures,
    ] {
        assert_eq!(find(&report, id).status, EvidenceStatus::Pass, "{id:?}");
    }
}

#[test]
fn a_library_that_links_back_to_itself_yields_no_entries_instead_of_crashing() {
    // biblatex follows crossref and xdata without a loop check; this used to
    // overflow the stack and abort the app.
    assert!(bib::new_entries(None, "@book{x, title={T}, crossref={x}}\n", "refs.bib").is_empty());
    let entries = bib::new_entries(
        None,
        "@book{a, title={A}}\n@inbook{b, crossref={a}}\n",
        "refs.bib",
    );
    assert_eq!(entries.len(), 2);
}

struct Maps {
    root: PathBuf,
    after: Value,
    before: Value,
}

impl WorkspaceTools for Maps {
    fn compile(
        &self,
        _root: PathBuf,
        _source: Option<PathBuf>,
    ) -> crate::scheduler::TaskRuntimeFuture<crate::host::CompileSummary> {
        Box::pin(async { Err("not used".to_string()) })
    }

    fn project_map(&self, root: PathBuf) -> crate::scheduler::TaskRuntimeFuture<Value> {
        let map = if root == self.root {
            self.after.clone()
        } else {
            self.before.clone()
        };
        Box::pin(async move { Ok(map) })
    }
}

#[derive(Default)]
struct Sources(std::sync::Mutex<Vec<Option<PathBuf>>>);

impl WorkspaceTools for Sources {
    fn compile(
        &self,
        _root: PathBuf,
        source: Option<PathBuf>,
    ) -> crate::scheduler::TaskRuntimeFuture<crate::host::CompileSummary> {
        self.0.lock().unwrap().push(source);
        Box::pin(async {
            Ok(crate::host::CompileSummary {
                ok: true,
                ..Default::default()
            })
        })
    }

    fn project_map(&self, _root: PathBuf) -> crate::scheduler::TaskRuntimeFuture<Value> {
        Box::pin(async { Ok(Value::Null) })
    }
}

#[tokio::test]
async fn a_task_copy_is_built_with_the_settings_of_the_folder_it_came_from() {
    let tools = Sources::default();
    let paper = PathBuf::from("paper");
    let check = build_check(Some(&tools), Path::new("copy"), Some(paper.clone())).await;
    assert_eq!(check.status, EvidenceStatus::Pass);
    assert_eq!(*tools.0.lock().unwrap(), [Some(paper)]);
}

#[tokio::test]
async fn a_capped_project_map_is_not_diffed_for_unresolved_citations() {
    let temp = tempfile::tempdir().unwrap();
    let (root, baseline) = (temp.path().join("work"), temp.path().join("base"));
    let check = |after: Value, before: Value| {
        let maps = Maps {
            root: root.clone(),
            after,
            before,
        };
        let (root, baseline) = (root.clone(), baseline.clone());
        async move { references_check(Some(&maps), &root, &baseline).await }
    };
    let whole = check(
        serde_json::json!({"unresolvedCites": ["old", "new"]}),
        serde_json::json!({"unresolvedCites": ["old"]}),
    )
    .await;
    assert_eq!(whole.status, EvidenceStatus::Warn);
    assert_eq!(whole.items.len(), 1);
    assert_eq!(whole.items[0].params["key"], "new");
    let capped = check(
        serde_json::json!({"unresolvedCites": ["old", "new"]}),
        serde_json::json!({"unresolvedCites": [], "truncatedCounts": {"unresolvedCites": 1}}),
    )
    .await;
    assert_eq!(capped.status, EvidenceStatus::Skipped);
    assert_eq!(capped.items[0].code, "references.notChecked");
    let other = check(
        serde_json::json!({"unresolvedCites": ["old", "new"], "truncatedCounts": {"bibKeys": 9}}),
        serde_json::json!({"unresolvedCites": ["old"]}),
    )
    .await;
    assert_eq!(other.status, EvidenceStatus::Warn);
}
