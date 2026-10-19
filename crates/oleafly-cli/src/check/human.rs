//! The report for people: one line per finding, sorted by place, then a
//! summary line.
use super::report::{Level, ReportRow};

fn sort_key(row: &ReportRow) -> (bool, String, u32, u32) {
    let (line, column) = row
        .range
        .map_or((0, 0), |range| (range.start.line, range.start.column));
    (
        row.file.is_some(),
        row.file.clone().unwrap_or_default(),
        line,
        column,
    )
}

/// The rendered report (ends with a newline).
pub fn render_human(rows: &[ReportRow], quiet: bool) -> String {
    let mut sorted: Vec<&ReportRow> = rows.iter().collect();
    sorted.sort_by_key(|row| sort_key(row));
    let mut out = String::new();
    for row in &sorted {
        let place = match (&row.file, &row.range) {
            (Some(file), Some(range)) => {
                format!("{file}:{}:{}", range.start.line, range.start.column)
            }
            (Some(file), None) => file.clone(),
            (None, _) => "(project)".to_string(),
        };
        out.push_str(&format!(
            "{place}: {} {} [{}]\n",
            row.level.as_str(),
            row.title,
            row.rule_id
        ));
        if !quiet {
            if let Some(detail) = row.detail.as_deref().filter(|detail| !detail.is_empty()) {
                for line in detail.lines() {
                    out.push_str(&format!("    {line}\n"));
                }
            }
        }
    }
    let count = |level: Level| rows.iter().filter(|row| row.level == level).count();
    let (errors, warnings, notes) = (
        count(Level::Error),
        count(Level::Warning),
        count(Level::Note),
    );
    if rows.is_empty() {
        out.push_str("No problems found.\n");
    } else {
        let plural = |count: usize, one: &str, many: &str| {
            format!("{count} {}", if count == 1 { one } else { many })
        };
        out.push_str(&format!(
            "\n{}, {}, {}\n",
            plural(errors, "error", "errors"),
            plural(warnings, "warning", "warnings"),
            plural(notes, "note", "notes")
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::check::report::RowRange;
    use oleafly_preflight::Position;

    fn row(file: Option<&str>, line: u32, level: Level) -> ReportRow {
        ReportRow {
            rule_id: "r".into(),
            level,
            title: "Title".into(),
            detail: Some("Detail one.\nDetail two.".into()),
            file: file.map(str::to_string),
            range: file.map(|_| RowRange {
                from: 0,
                to: 1,
                start: Position { line, column: 2 },
                end: Position { line, column: 3 },
            }),
            line_text: None,
            json: serde_json::json!({}),
        }
    }

    #[test]
    fn project_rows_come_first_then_files_by_line() {
        let text = render_human(
            &[
                row(Some("b.tex"), 9, Level::Warning),
                row(None, 0, Level::Error),
                row(Some("a.tex"), 3, Level::Note),
            ],
            false,
        );
        let lines: Vec<&str> = text.lines().collect();
        assert!(lines[0].starts_with("(project): error Title [r]"));
        assert_eq!(lines[1], "    Detail one.");
        assert!(lines[3].starts_with("a.tex:3:2: note"));
        assert!(text.ends_with("1 error, 1 warning, 1 note\n"));
        assert_eq!(render_human(&[], false), "No problems found.\n");
    }
}
