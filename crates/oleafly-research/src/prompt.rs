//! Model-facing prompt text for research tasks. English and not localized:
//! the model reads it, not the user.
use crate::model::{
    CommandPolicy, MetricGoal, ResearchBrief, ResumeContext, ResumeReason, RunState, TaskRunContext,
};
use crate::runs::RunSummary;

/// The system prompt for a task run, with the selected skills appended.
pub fn task_prompt(context: &TaskRunContext, skills: &str) -> String {
    let mut prompt = format!(
        "Complete this research task in the isolated workspace. Work only on the requested deliverable. Use relative file paths. Allowed paths: {}. Linked research roots are read-only. Summarize the result and remaining limitations when finished. Changes will be reviewed before applying them to the project.{}",
        context.allowed_paths.join(", "),
        skills
    );
    if !context.record_dir.is_empty() {
        prompt.push_str("\n\n");
        prompt.push_str(&brief_block(&context.brief, &context.record_dir));
    }
    if !context.dependencies.is_empty() {
        prompt.push_str("\n\nEarlier tasks this one builds on:");
        for dependency in &context.dependencies {
            let summary = dependency.summary.trim();
            prompt.push_str(&format!(
                "\n- {}: {} Record: {}/",
                dependency.title,
                if summary.is_empty() {
                    "No summary."
                } else {
                    summary
                },
                dependency.record_dir
            ));
        }
    }
    if context.plan_phase {
        prompt.push_str(&format!(
            "\n\nFirst write {}/plan.md: the approach, the steps as a checklist, the runs you expect and how you will check success. Then stop. Do not start runs or change other files until the user approves the plan.",
            context.record_dir
        ));
    }
    prompt.push_str(&format!("\n\nTask: {}\n{}", context.title, context.prompt));
    prompt
}

fn none_or<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    let value = value.trim();
    if value.is_empty() {
        fallback
    } else {
        value
    }
}

/// What the task is for and how far it may go.
pub fn brief_block(brief: &ResearchBrief, record_dir: &str) -> String {
    let mut lines = vec![
        "<research-brief>".to_owned(),
        format!("Goal: {}", none_or(&brief.goal, "See the task below.")),
        "Success criteria:".to_owned(),
    ];
    if brief
        .success_criteria
        .iter()
        .all(|criterion| criterion.trim().is_empty())
    {
        lines.push("- None given. Propose checkable criteria in plan.md.".to_owned());
    } else {
        lines.extend(
            brief
                .success_criteria
                .iter()
                .filter(|criterion| !criterion.trim().is_empty())
                .map(|criterion| format!("- {}", criterion.trim())),
        );
    }
    lines.push(format!("Scope: {}", none_or(&brief.scope, "Not limited.")));
    lines.push(format!(
        "Constraints: {}",
        none_or(&brief.constraints, "None.")
    ));
    if let Some(metric) = &brief.primary_metric {
        let better = match metric.goal {
            MetricGoal::Maximize => "higher",
            MetricGoal::Minimize => "lower",
        };
        lines.push(format!("Main metric: {} ({better} is better)", metric.name));
    }
    let budget = &brief.budget;
    let cost = budget
        .usd_cap
        .map(|cap| format!("${cap} cost limit"))
        .unwrap_or_else(|| "no cost limit".to_owned());
    let runs = budget
        .max_runs
        .map(|runs| format!("{runs} runs"))
        .unwrap_or_else(|| "no run limit".to_owned());
    lines.push(format!(
        "Budget: {} minutes of active time, {cost}, {runs}, each run stops after {} minutes.",
        budget.wall_clock_minutes, budget.run_timeout_minutes
    ));
    let commands = match brief.permissions.commands {
        CommandPolicy::Allow => "allowed",
        CommandPolicy::Ask => "allowed after the user approves each one",
        CommandPolicy::Off => "not allowed",
    };
    let network = if brief.permissions.network {
        "on"
    } else {
        "off"
    };
    lines.push(format!(
        "Commands: {commands}. Network for commands: {network}."
    ));
    lines.push(format!(
        "Record: {record_dir}/ holds brief.md, plan.md, ledger.tsv, hypotheses.md, sources.md, handoff.md and report.md. Update ledger.tsv and handoff.md after every result."
    ));
    lines.push("</research-brief>".to_owned());
    lines.join("\n")
}

/// The first message of a resumed generation.
pub fn resume_message(resume: &ResumeContext, record_dir: &str) -> String {
    let reason = match resume.reason {
        ResumeReason::Retry => "the previous attempt stopped",
        ResumeReason::PlanApproved => "the user approved the plan below; carry it out",
        ResumeReason::Handoff => "the task moved to a new owner",
    };
    format!(
        "You are resuming this task in the same workspace ({reason}). Read {record_dir}/handoff.md, plan.md and ledger.tsv before you act.\n\nHandoff:\n{}\n\nPlan:\n{}\n\nLast ledger rows:\n{}",
        none_or(&resume.handoff, "(empty)"),
        none_or(&resume.plan, "(empty)"),
        none_or(&resume.ledger_tail, "(none)")
    )
}

fn state_text(state: RunState) -> &'static str {
    match state {
        RunState::Starting => "starting",
        RunState::Running => "running",
        RunState::Succeeded => "succeeded",
        RunState::Failed => "failed",
        RunState::TimedOut => "timed out",
        RunState::Cancelled => "cancelled",
        RunState::Lost => "lost",
    }
}

/// The message that wakes the agent when runs finished after its turn.
pub fn wake_up_message(finished: &[RunSummary]) -> String {
    finished
        .iter()
        .map(|run| {
            let exit = run
                .exit_code
                .map(|code| format!(", exit code {code}"))
                .unwrap_or_default();
            let metrics = if run.metrics.is_empty() {
                "none".to_owned()
            } else {
                run.metrics
                    .iter()
                    .map(|(name, value)| format!("{name}={value}"))
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            format!(
                "Run {} ({}) finished: {}{exit}. Last metrics: {metrics}. Log tail:\n{}\nRecord the result in ledger.tsv with ledger_append and update handoff.md before the next step.",
                run.run_id,
                run.name,
                state_text(run.state),
                run.log_tail.trim_end()
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// The last turn after the time budget ran out.
pub fn wrap_up_message(record_dir: &str) -> String {
    format!(
        "The time budget ended. Update {record_dir}/handoff.md and write {record_dir}/report.md now. Do not start runs."
    )
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::model::{DependencyResult, PrimaryMetric, TaskBudget};

    fn full_brief() -> ResearchBrief {
        ResearchBrief {
            goal: "Lower validation loss".into(),
            success_criteria: vec!["val_loss < 1.2".into(), "  ".into()],
            scope: "The tokenizer only".into(),
            constraints: "No new data".into(),
            primary_metric: Some(PrimaryMetric {
                name: "val_loss".into(),
                goal: MetricGoal::Minimize,
            }),
            budget: TaskBudget {
                wall_clock_minutes: 90,
                usd_cap: Some(5.0),
                max_runs: Some(12),
                run_timeout_minutes: 30,
            },
            ..ResearchBrief::default()
        }
    }

    #[test]
    fn the_brief_block_contains_goal_criteria_budget_and_record() {
        let block = brief_block(&full_brief(), "research/tune-ab12");
        for line in [
            "Goal: Lower validation loss",
            "- val_loss < 1.2",
            "Scope: The tokenizer only",
            "Constraints: No new data",
            "Main metric: val_loss (lower is better)",
            "Budget: 90 minutes of active time, $5 cost limit, 12 runs, each run stops after 30 minutes.",
            "Commands: allowed. Network for commands: off.",
            "Record: research/tune-ab12/ holds brief.md",
        ] {
            assert!(block.contains(line), "missing {line:?} in\n{block}");
        }
        assert!(!block.contains("- \n"));
        let default = brief_block(&ResearchBrief::default(), "research/x");
        assert!(!default.contains("Main metric"));
        assert!(default.contains("- None given. Propose checkable criteria in plan.md."));
        assert!(default.contains("no cost limit, no run limit"));
    }

    #[test]
    fn the_task_prompt_adds_dependencies_and_the_plan_phase() {
        let context = TaskRunContext {
            title: "Tune".into(),
            prompt: "Tune the model.".into(),
            allowed_paths: vec!["analysis".into()],
            record_dir: "research/tune-ab12".into(),
            plan_phase: true,
            dependencies: vec![DependencyResult {
                task_id: "task-a".into(),
                title: "Collect papers".into(),
                summary: "Found 12 papers".into(),
                record_dir: "research/collect-cd34".into(),
            }],
            ..TaskRunContext::default()
        };
        let prompt = task_prompt(&context, "");
        assert!(prompt.contains("- Collect papers: Found 12 papers Record: research/collect-cd34/"));
        assert!(prompt.contains("First write research/tune-ab12/plan.md"));
        assert!(prompt.ends_with("Task: Tune\nTune the model."));
    }

    #[test]
    fn a_resume_message_names_its_reason() {
        let resume = ResumeContext {
            reason: ResumeReason::PlanApproved,
            handoff: "next: r003".into(),
            plan: "- [ ] baseline".into(),
            ledger_tail: String::new(),
            previous_native_session_id: None,
        };
        let message = resume_message(&resume, "research/x");
        assert!(message.contains("the user approved the plan below; carry it out"));
        assert!(message.contains("Handoff:\nnext: r003"));
        assert!(message.contains("Last ledger rows:\n(none)"));
    }

    #[test]
    fn wake_ups_report_state_exit_code_metrics_and_log() {
        let run = RunSummary {
            run_id: "r001".into(),
            name: "baseline".into(),
            state: RunState::Failed,
            exit_code: Some(3),
            metrics: BTreeMap::from([("loss".to_owned(), 0.5)]),
            log_tail: "done\n".into(),
        };
        let message = wake_up_message(&[run]);
        assert!(message.starts_with("Run r001 (baseline) finished: failed, exit code 3. Last metrics: loss=0.5. Log tail:\ndone\n"));
        assert!(message.ends_with("before the next step."));
    }
}
