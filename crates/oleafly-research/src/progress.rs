//! What a task's Progress tab shows: the plan checklist, the todo list, the
//! research ledger, the runs, the best value of the main metric and how much
//! of the budget is used.
use std::collections::BTreeSet;
use std::path::Path;

use serde::Serialize;

use crate::model::{
    EvidenceReport, MetricGoal, ResearchBrief, ResearchTask, RunRecord, TaskPhase, TodoItem,
};
use crate::record::{self, LedgerRow, PlanItem};

const MAX_LEDGER_ROWS: usize = 50;
const MAX_RECENT_RUNS: usize = 20;
const MAX_SERIES: usize = 30;
const MAX_PLAN_BYTES: usize = 64 * 1024;
const MAX_LEDGER_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgress {
    pub phase: Option<TaskPhase>,
    pub plan: Vec<PlanItem>,
    pub todos: Vec<TodoItem>,
    /// The last 50 ledger rows.
    pub ledger: Vec<LedgerRow>,
    pub best: Option<BestMetric>,
    pub runs_in_flight: Vec<RunRecord>,
    /// The last 20 runs, newest first.
    pub recent_runs: Vec<RunRecord>,
    pub budget: BudgetUsage,
    pub evidence: Option<EvidenceReport>,
    pub record_dir: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BestMetric {
    pub name: String,
    pub value: f64,
    pub run_id: String,
    /// The metric over the last 30 finished runs, oldest first.
    pub series: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BudgetUsage {
    pub active_minutes: f64,
    pub limit_minutes: u32,
    pub spent_usd: Option<f64>,
    pub usd_cap: Option<f64>,
    pub runs_started: u32,
    pub max_runs: Option<u32>,
}

/// The plan checklist and every ledger row from the task's record, when its
/// workspace still exists. The best result needs the whole ledger; the tab
/// shows only [`recent_ledger`].
pub fn record_contents(task: &ResearchTask) -> (Vec<PlanItem>, Vec<LedgerRow>) {
    let Some(isolation) = &task.isolation else {
        return (Vec::new(), Vec::new());
    };
    let root = Path::new(&isolation.execution_root);
    let plan = record::read_record_file(root, &task.record_slug, "plan.md", MAX_PLAN_BYTES)
        .map(|text| record::parse_plan_checklist(&text))
        .unwrap_or_default();
    let ledger = record::read_record_file(root, &task.record_slug, "ledger.tsv", MAX_LEDGER_BYTES)
        .map(|text| record::parse_ledger(&text))
        .unwrap_or_default();
    (plan, ledger)
}

/// The newest ledger rows, which the Progress tab lists.
pub fn recent_ledger(ledger: &[LedgerRow]) -> Vec<LedgerRow> {
    ledger[ledger.len().saturating_sub(MAX_LEDGER_ROWS)..].to_vec()
}

/// The best value of the brief's main metric: over finished runs the ledger
/// kept, or over every finished run when the ledger has no verdicts yet.
pub fn best_metric(
    brief: &ResearchBrief,
    runs: &[RunRecord],
    ledger: &[LedgerRow],
) -> Option<BestMetric> {
    let metric = brief.primary_metric.as_ref()?;
    let mut finished: Vec<&RunRecord> = runs
        .iter()
        .filter(|run| run.state.is_terminal() && run.metrics.contains_key(&metric.name))
        .collect();
    finished.sort_by_key(|run| (run.started_at, run.run_id.clone()));
    let judged: Vec<&LedgerRow> = ledger
        .iter()
        .filter(|row| !row.verdict.trim().is_empty())
        .collect();
    let kept: BTreeSet<&str> = judged
        .iter()
        .filter(|row| row.verdict.trim().eq_ignore_ascii_case("keep"))
        .map(|row| row.id.as_str())
        .collect();
    let candidates = finished
        .iter()
        .filter(|run| judged.is_empty() || kept.contains(run.run_id.as_str()));
    let better = |candidate: f64, current: f64| match metric.goal {
        MetricGoal::Maximize => candidate > current,
        MetricGoal::Minimize => candidate < current,
    };
    let mut best: Option<(&RunRecord, f64)> = None;
    for run in candidates {
        let value = run.metrics[&metric.name];
        if !value.is_finite() {
            continue;
        }
        if best.is_none_or(|(_, current)| better(value, current)) {
            best = Some((run, value));
        }
    }
    let (run, value) = best?;
    let mut series: Vec<f64> = finished
        .iter()
        .map(|run| run.metrics[&metric.name])
        .filter(|value| value.is_finite())
        .collect();
    if series.len() > MAX_SERIES {
        series.drain(..series.len() - MAX_SERIES);
    }
    Some(BestMetric {
        name: metric.name.clone(),
        value,
        run_id: run.run_id.clone(),
        series,
    })
}

/// Splits a task's runs into those in flight and the most recent ones.
pub fn split_runs(mut runs: Vec<RunRecord>) -> (Vec<RunRecord>, Vec<RunRecord>) {
    runs.sort_by(|left, right| {
        right
            .started_at
            .cmp(&left.started_at)
            .then_with(|| right.run_id.cmp(&left.run_id))
    });
    let in_flight = runs
        .iter()
        .filter(|run| !run.state.is_terminal())
        .cloned()
        .collect();
    runs.truncate(MAX_RECENT_RUNS);
    (in_flight, runs)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::model::{PrimaryMetric, RunState};

    fn run(id: &str, started_at: i64, state: RunState, loss: Option<f64>) -> RunRecord {
        RunRecord {
            task_id: "task".into(),
            run_id: id.into(),
            execution_generation: 1,
            name: id.into(),
            executor: "local".into(),
            command: "python train.py".into(),
            cwd_rel: String::new(),
            state,
            exit_code: Some(0),
            started_at,
            finished_at: Some(started_at + 1),
            run_dir: String::new(),
            metrics: loss
                .map(|loss| BTreeMap::from([("val_loss".to_owned(), loss)]))
                .unwrap_or_default(),
            reported: true,
        }
    }

    fn brief() -> ResearchBrief {
        ResearchBrief {
            primary_metric: Some(PrimaryMetric {
                name: "val_loss".into(),
                goal: MetricGoal::Minimize,
            }),
            ..ResearchBrief::default()
        }
    }

    fn row(id: &str, verdict: &str) -> LedgerRow {
        LedgerRow {
            id: id.into(),
            verdict: verdict.into(),
            ..LedgerRow::default()
        }
    }

    #[test]
    fn the_best_run_follows_the_metric_goal_and_the_ledger_verdicts() {
        let runs = vec![
            run("r001", 1, RunState::Succeeded, Some(1.4)),
            run("r002", 2, RunState::Succeeded, Some(1.1)),
            run("r003", 3, RunState::Running, Some(0.2)),
            run("r004", 4, RunState::Failed, Some(1.2)),
        ];
        let best = best_metric(&brief(), &runs, &[]).unwrap();
        assert_eq!((best.run_id.as_str(), best.value), ("r002", 1.1));
        assert_eq!(best.series, vec![1.4, 1.1, 1.2]);
        let kept = best_metric(
            &brief(),
            &runs,
            &[row("r001", "keep"), row("r002", "discard")],
        )
        .unwrap();
        assert_eq!(kept.run_id, "r001");
    }

    #[test]
    fn the_best_run_comes_from_the_whole_ledger_not_its_last_rows() {
        // r012 is the best run and was kept long ago; the newest 50 rows only
        // keep worse ones.
        let mut runs = vec![run("r012", 12, RunState::Succeeded, Some(1.05))];
        let mut ledger = vec![row("r012", "keep")];
        for index in 13..=80 {
            let id = format!("r{index:03}");
            runs.push(run(&id, index, RunState::Succeeded, Some(1.2)));
            ledger.push(row(&id, "keep"));
        }
        assert_eq!(recent_ledger(&ledger).len(), MAX_LEDGER_ROWS);
        assert_eq!(recent_ledger(&ledger[..3]).len(), 3);
        // The rows shown do not hold r012, but the best result does.
        assert!(recent_ledger(&ledger).iter().all(|row| row.id != "r012"));
        let best = best_metric(&brief(), &runs, &ledger).unwrap();
        assert_eq!((best.run_id.as_str(), best.value), ("r012", 1.05));
    }

    #[test]
    fn no_main_metric_means_no_best_run() {
        let runs = vec![run("r001", 1, RunState::Succeeded, Some(1.4))];
        assert_eq!(best_metric(&ResearchBrief::default(), &runs, &[]), None);
    }

    #[test]
    fn recent_runs_are_newest_first_and_in_flight_runs_are_listed() {
        let runs = (1..=25)
            .map(|index| {
                run(
                    &format!("r{index:03}"),
                    index,
                    if index == 25 {
                        RunState::Running
                    } else {
                        RunState::Succeeded
                    },
                    None,
                )
            })
            .collect();
        let (in_flight, recent) = split_runs(runs);
        assert_eq!(in_flight.len(), 1);
        assert_eq!(recent.len(), 20);
        assert_eq!(recent[0].run_id, "r025");
    }
}
