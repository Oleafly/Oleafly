//! The research record: `research/<slug>/` in the task workspace holds the
//! brief, the plan, the ledger of results, hypotheses, sources, the handoff
//! note for whoever continues, and the final report. It comes back through
//! review with the rest of the work.
use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::model::{MetricGoal, ResearchBrief};
use crate::task_tools::TaskFiles;

pub const LEDGER_HEADER: &str = "id\ttime\thypothesis\tchange\tcommand\tmetrics\tverdict\tnotes";
const MAX_LEDGER_ROWS: usize = 2_000;
const MAX_PLAN_ITEMS: usize = 200;
const MAX_SLUG_CHARS: usize = 40;

/// `research/{slug}`.
pub fn record_dir(slug: &str) -> String {
    format!("research/{slug}")
}

/// A stable ASCII folder name for a task's record: the title in lowercase
/// with other characters turned into dashes, then four characters of the id.
pub fn record_slug(title: &str, task_id: &str) -> String {
    let mut slug = String::new();
    let mut dash = false;
    for character in title.chars() {
        if character.is_ascii_alphanumeric() {
            if dash && !slug.is_empty() {
                slug.push('-');
            }
            dash = false;
            slug.push(character.to_ascii_lowercase());
        } else {
            dash = true;
        }
        if slug.len() >= MAX_SLUG_CHARS {
            break;
        }
    }
    slug.truncate(MAX_SLUG_CHARS);
    let slug = slug.trim_end_matches('-');
    let slug = if slug.is_empty() { "task" } else { slug };
    let suffix: String = task_id
        .rsplit('-')
        .next()
        .unwrap_or_default()
        .chars()
        .filter(char::is_ascii_hexdigit)
        .take(4)
        .collect();
    format!("{slug}-{suffix}")
}

const HYPOTHESES_TEMPLATE: &str = "# Hypotheses\n\nOne line per idea: what you expect, why, and its status (queued, testing, kept, dropped).\n";
const SOURCES_TEMPLATE: &str =
    "# Sources\n\nEvery source you rely on, with what you read and a page anchor such as [p. 4].\n";
const HANDOFF_TEMPLATE: &str = "# Handoff\n\nWhat was done, what is running, what comes next. Rewrite this after every result.\n";

fn open_record(execution_root: &Path, slug: &str) -> Result<TaskFiles, String> {
    TaskFiles::open(execution_root, &[record_dir(slug)])
}

/// Creates the record folder and writes each starting file that is missing.
/// Files the agent already changed are kept.
pub fn init_record(execution_root: &Path, slug: &str, brief_md: &str) -> Result<(), String> {
    let files = open_record(execution_root, slug)?;
    let dir = record_dir(slug);
    let header = format!("{LEDGER_HEADER}\n");
    for (name, content) in [
        ("brief.md", brief_md),
        ("ledger.tsv", header.as_str()),
        ("hypotheses.md", HYPOTHESES_TEMPLATE),
        ("sources.md", SOURCES_TEMPLATE),
        ("handoff.md", HANDOFF_TEMPLATE),
    ] {
        let path = format!("{dir}/{name}");
        if !files.exists(&path)? {
            files.write(&path, content)?;
        }
    }
    Ok(())
}

/// The brief as Markdown, for `brief.md`.
pub fn render_brief_markdown(title: &str, prompt: &str, brief: &ResearchBrief) -> String {
    let mut out = format!("# {}\n\n{}\n", title.trim(), prompt.trim());
    if !brief.goal.trim().is_empty() {
        out.push_str(&format!("\n## Goal\n\n{}\n", brief.goal.trim()));
    }
    if !brief.success_criteria.is_empty() {
        out.push_str("\n## Success criteria\n\n");
        for criterion in &brief.success_criteria {
            out.push_str(&format!("- {}\n", criterion.trim()));
        }
    }
    if !brief.scope.trim().is_empty() {
        out.push_str(&format!("\n## Scope\n\n{}\n", brief.scope.trim()));
    }
    if !brief.constraints.trim().is_empty() {
        out.push_str(&format!(
            "\n## Constraints\n\n{}\n",
            brief.constraints.trim()
        ));
    }
    if let Some(metric) = &brief.primary_metric {
        let better = match metric.goal {
            MetricGoal::Maximize => "higher",
            MetricGoal::Minimize => "lower",
        };
        out.push_str(&format!(
            "\n## Main metric\n\n{} ({better} is better)\n",
            metric.name
        ));
    }
    out
}

/// One result in `ledger.tsv`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LedgerRow {
    pub id: String,
    pub time: String,
    pub hypothesis: String,
    pub change: String,
    pub command: String,
    pub metrics: BTreeMap<String, f64>,
    pub verdict: String,
    pub notes: String,
}

fn parse_metrics(cell: &str) -> BTreeMap<String, f64> {
    cell.split(';')
        .filter_map(|pair| {
            let (name, value) = pair.split_once('=')?;
            let name = name.trim();
            let value: f64 = value.trim().parse().ok()?;
            (!name.is_empty() && value.is_finite()).then(|| (name.to_owned(), value))
        })
        .collect()
}

/// Reads `ledger.tsv` by its header, so extra or reordered columns and CRLF
/// line ends are fine. Metrics that are not numbers are left out.
pub fn parse_ledger(text: &str) -> Vec<LedgerRow> {
    let mut lines = text.lines().map(|line| line.trim_end_matches('\r'));
    let Some(header) = lines.next() else {
        return Vec::new();
    };
    let columns: Vec<&str> = header.split('\t').map(str::trim).collect();
    let index = |name: &str| {
        columns
            .iter()
            .position(|column| column.eq_ignore_ascii_case(name))
    };
    let (id, time, hypothesis, change, command, metrics, verdict, notes) = (
        index("id"),
        index("time"),
        index("hypothesis"),
        index("change"),
        index("command"),
        index("metrics"),
        index("verdict"),
        index("notes"),
    );
    // The newest rows are the ones that matter when a ledger outgrows the cap.
    let rows: Vec<&str> = lines.filter(|line| !line.trim().is_empty()).collect();
    let skipped = rows.len().saturating_sub(MAX_LEDGER_ROWS);
    rows.into_iter()
        .skip(skipped)
        .map(|line| {
            let cells: Vec<&str> = line.split('\t').collect();
            let cell = |position: Option<usize>| {
                position
                    .and_then(|position| cells.get(position))
                    .map(|cell| cell.trim().to_owned())
                    .unwrap_or_default()
            };
            LedgerRow {
                id: cell(id),
                time: cell(time),
                hypothesis: cell(hypothesis),
                change: cell(change),
                command: cell(command),
                metrics: parse_metrics(&cell(metrics)),
                verdict: cell(verdict),
                notes: cell(notes),
            }
        })
        .collect()
}

fn clean_cell(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if matches!(character, '\t' | '\r' | '\n') {
                ' '
            } else {
                character
            }
        })
        .collect::<String>()
        .trim()
        .to_owned()
}

/// One ledger line (without the newline). Tabs and line breaks in cells
/// become spaces; metrics are written as `name=value;name=value`.
pub fn format_ledger_row(row: &LedgerRow) -> String {
    let metrics = row
        .metrics
        .iter()
        .map(|(name, value)| format!("{}={value}", clean_cell(name)))
        .collect::<Vec<_>>()
        .join(";");
    [
        clean_cell(&row.id),
        clean_cell(&row.time),
        clean_cell(&row.hypothesis),
        clean_cell(&row.change),
        clean_cell(&row.command),
        metrics,
        clean_cell(&row.verdict),
        clean_cell(&row.notes),
    ]
    .join("\t")
}

/// One checklist item of `plan.md`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub text: String,
    pub done: bool,
}

/// The `- [ ]` / `- [x]` / `* [X]` items of a plan.
pub fn parse_plan_checklist(markdown: &str) -> Vec<PlanItem> {
    markdown
        .lines()
        .filter_map(|line| {
            let line = line.trim_start();
            let rest = line
                .strip_prefix("- [")
                .or_else(|| line.strip_prefix("* ["))?;
            let mut chars = rest.chars();
            let mark = chars.next()?;
            let rest = chars.as_str().strip_prefix(']')?;
            let done = match mark {
                ' ' => false,
                'x' | 'X' => true,
                _ => return None,
            };
            let text = rest.trim();
            (!text.is_empty()).then(|| PlanItem {
                text: text.to_owned(),
                done,
            })
        })
        .take(MAX_PLAN_ITEMS)
        .collect()
}

/// A record file's text, at most `max_bytes` (cut at a character boundary),
/// or `None` when it is missing, a link or not text.
pub fn read_record_file(
    execution_root: &Path,
    slug: &str,
    name: &str,
    max_bytes: usize,
) -> Option<String> {
    read_record_file_cut(execution_root, slug, name, max_bytes).map(|(text, _)| text)
}

/// [`read_record_file`], and whether the file was longer than `max_bytes`.
pub fn read_record_file_cut(
    execution_root: &Path,
    slug: &str,
    name: &str,
    max_bytes: usize,
) -> Option<(String, bool)> {
    let files = open_record(execution_root, slug).ok()?;
    let mut text = files.read(&format!("{}/{name}", record_dir(slug))).ok()?;
    let cut = text.len() > max_bytes;
    if cut {
        let mut end = max_bytes;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
    }
    Some((text, cut))
}

/// The last `count` ledger lines (header first), for a resumed conversation.
pub fn ledger_tail(execution_root: &Path, slug: &str, count: usize) -> String {
    let Some(text) = read_record_file(execution_root, slug, "ledger.tsv", 1024 * 1024) else {
        return String::new();
    };
    let lines: Vec<&str> = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let Some((header, rows)) = lines.split_first() else {
        return String::new();
    };
    let start = rows.len().saturating_sub(count);
    std::iter::once(*header)
        .chain(rows[start..].iter().copied())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn init_record_writes_templates_once_and_keeps_existing_files() {
        let root = workspace();
        init_record(root.path(), "study-ab12", "# Brief\n").unwrap();
        let ledger =
            std::fs::read_to_string(root.path().join("research/study-ab12/ledger.tsv")).unwrap();
        assert!(ledger.starts_with(LEDGER_HEADER));
        let handoff = root.path().join("research/study-ab12/handoff.md");
        std::fs::write(&handoff, "next: r003").unwrap();
        init_record(root.path(), "study-ab12", "# Changed brief\n").unwrap();
        assert_eq!(std::fs::read_to_string(&handoff).unwrap(), "next: r003");
        assert_eq!(
            std::fs::read_to_string(root.path().join("research/study-ab12/brief.md")).unwrap(),
            "# Brief\n"
        );
        assert!(!root.path().join("research/study-ab12/plan.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn init_record_never_writes_through_a_link() {
        let root = workspace();
        let outside = workspace();
        std::fs::create_dir_all(root.path().join("research")).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("research/study-ab12"))
            .unwrap();
        assert!(init_record(root.path(), "study-ab12", "# Brief\n").is_err());
        assert!(std::fs::read_dir(outside.path()).unwrap().next().is_none());
    }

    #[test]
    fn ledger_parsing_tolerates_crlf_extra_columns_and_bad_metrics() {
        let text = format!(
            "{LEDGER_HEADER}\textra\r\nr001\t2026-10-18T10:00:00Z\th\tc\tpython t.py\tloss=0.5;acc=x\tkeep\tok\tignored\r\n\r\n"
        );
        let rows = parse_ledger(&text);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].metrics, BTreeMap::from([("loss".to_owned(), 0.5)]));
        assert_eq!(rows[0].verdict, "keep");
        assert_eq!(rows[0].command, "python t.py");
    }

    #[test]
    fn a_long_ledger_keeps_its_newest_rows() {
        let mut text = format!("{LEDGER_HEADER}\n");
        for index in 1..=MAX_LEDGER_ROWS + 100 {
            text.push_str(&format!("r{index:04}\t\t\t\t\t\tkeep\t\n"));
        }
        let rows = parse_ledger(&text);
        assert_eq!(rows.len(), MAX_LEDGER_ROWS);
        assert_eq!(rows[0].id, "r0101");
        assert_eq!(
            rows[MAX_LEDGER_ROWS - 1].id,
            format!("r{:04}", MAX_LEDGER_ROWS + 100)
        );
    }

    #[test]
    fn ledger_rows_round_trip_and_clean_their_cells() {
        let row = LedgerRow {
            id: "r002".into(),
            time: "2026-10-18T10:00:00Z".into(),
            hypothesis: "smaller\tlearning rate".into(),
            change: "lr 3e-4\nto 1e-4".into(),
            command: "python train.py".into(),
            metrics: BTreeMap::from([("acc".to_owned(), 0.913), ("loss".to_owned(), 0.25)]),
            verdict: "keep".into(),
            notes: String::new(),
        };
        let line = format_ledger_row(&row);
        assert_eq!(line.matches('\t').count(), 7);
        let parsed = parse_ledger(&format!("{LEDGER_HEADER}\n{line}\n"));
        assert_eq!(parsed[0].metrics, row.metrics);
        assert_eq!(parsed[0].hypothesis, "smaller learning rate");
    }

    #[test]
    fn plan_checklists_parse_both_cases_of_x() {
        let items =
            parse_plan_checklist("Intro\n- [ ] a\n- [x] b\n  * [X] c\n- [?] no\n- [ ]   \n");
        assert_eq!(
            items,
            vec![
                PlanItem {
                    text: "a".into(),
                    done: false
                },
                PlanItem {
                    text: "b".into(),
                    done: true
                },
                PlanItem {
                    text: "c".into(),
                    done: true
                },
            ]
        );
    }

    #[test]
    fn the_record_slug_is_stable_and_ascii() {
        let slug = record_slug("Ablation of Dropout — v2 ü", "task-1f2e3d4c5b6a");
        assert!(slug.starts_with("ablation-of-dropout-v2-"), "{slug}");
        assert!(slug.ends_with("-1f2e"), "{slug}");
        assert!(slug.len() <= 45);
        assert_eq!(record_slug("—", "task-abcd0000"), "task-abcd");
        let long = record_slug(&"word ".repeat(30), "task-0123");
        assert!(long.len() <= 45, "{long}");
        assert!(!long.contains("--"));
    }

    #[test]
    fn the_brief_renders_its_sections() {
        let brief = ResearchBrief {
            goal: "Lower validation loss".into(),
            success_criteria: vec!["val_loss < 1.2".into()],
            primary_metric: Some(crate::model::PrimaryMetric {
                name: "val_loss".into(),
                goal: MetricGoal::Minimize,
            }),
            ..ResearchBrief::default()
        };
        let markdown = render_brief_markdown("Tune", "Tune the model.", &brief);
        assert!(markdown.contains("## Success criteria\n\n- val_loss < 1.2"));
        assert!(markdown.contains("val_loss (lower is better)"));
        assert!(!markdown.contains("## Scope"));
    }

    #[test]
    fn the_ledger_tail_keeps_the_header() {
        let root = workspace();
        init_record(root.path(), "s-0000", "# Brief\n").unwrap();
        let rows: String = (1..=30)
            .map(|n| format!("r{n:03}\tt\th\tc\tcmd\t\tkeep\t\n"))
            .collect();
        std::fs::write(
            root.path().join("research/s-0000/ledger.tsv"),
            format!("{LEDGER_HEADER}\n{rows}"),
        )
        .unwrap();
        let tail = ledger_tail(root.path(), "s-0000", 20);
        assert!(tail.starts_with(LEDGER_HEADER));
        assert!(tail.contains("r011") && !tail.contains("r010\t"));
    }
}
