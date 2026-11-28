use super::SourceFamily;
use crate::front_matter::yaml_uses_aliases;
use serde_norway::Value;

pub const PROJECT_FILES: [&str; 2] = ["_quarto.yml", "_quarto.yaml"];
const INDEX: &str = "index.qmd";

#[derive(Debug)]
pub(super) struct QuartoProject {
    pub(super) main: String,
    pub(super) output_dir: Option<String>,
}

pub(super) fn parse(text: &str) -> QuartoProject {
    let yaml = if yaml_uses_aliases(text) {
        Value::Null
    } else {
        serde_norway::from_str(text).unwrap_or(Value::Null)
    };
    let project = &yaml["project"];
    let main = match project["type"].as_str().unwrap_or_default() {
        "manuscript" => yaml["manuscript"]["article"].as_str(),
        "book" => first_chapter(&yaml["book"]["chapters"]),
        _ => first_rendered(&project["render"]),
    };
    QuartoProject {
        main: main.unwrap_or(INDEX).to_owned(),
        output_dir: project["output-dir"]
            .as_str()
            .map(|dir| dir.trim().replace('\\', "/"))
            .map(|dir| {
                dir.trim_start_matches("./")
                    .trim_end_matches('/')
                    .to_owned()
            })
            .filter(|dir| !dir.is_empty() && dir != "."),
    }
}

fn first_chapter(chapters: &Value) -> Option<&str> {
    chapters
        .as_sequence()?
        .iter()
        .find_map(|entry| match entry {
            Value::String(path) => Some(path.as_str()),
            Value::Mapping(_) => entry["href"]
                .as_str()
                .or_else(|| entry["file"].as_str())
                .or_else(|| first_chapter(&entry["chapters"])),
            _ => None,
        })
}

fn first_rendered(render: &Value) -> Option<&str> {
    render.as_sequence()?.iter().find_map(|entry| {
        entry
            .as_str()
            .filter(|path| !path.starts_with('!') && !path.contains(['*', '?', '[']))
            .filter(|path| SourceFamily::of(path) == Some(SourceFamily::Quarto))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn a_manuscript_opens_its_article() {
        let project = parse("project:\n  type: manuscript\nmanuscript:\n  article: paper.qmd\n");

        assert_eq!(project.main, "paper.qmd");
        assert_eq!(project.output_dir, None);
    }

    #[test]
    fn a_book_opens_its_first_chapter_even_inside_a_part() {
        let project = parse(
            "project:\n  type: book\n  output-dir: .\\docs\\\nbook:\n  chapters:\n    - part: Background\n      chapters:\n        - intro.qmd\n    - methods.qmd\n",
        );

        assert_eq!(project.main, "intro.qmd");
        assert_eq!(project.output_dir.as_deref(), Some("docs"));
    }

    #[test]
    fn other_projects_open_the_first_rendered_notebook_or_the_index() {
        assert_eq!(
            parse("project:\n  render:\n    - \"*.qmd\"\n    - \"!draft.qmd\"\n    - report.qmd\n")
                .main,
            "report.qmd"
        );
        assert_eq!(parse("project:\n  type: website\n").main, INDEX);
        assert_eq!(parse("{ not yaml").main, INDEX);
        assert_eq!(
            parse("project:\n  type: manuscript\n  description: The *main* paper, R&D notes\nmanuscript:\n  article: paper.qmd\n").main,
            "paper.qmd"
        );
    }

    #[test]
    fn a_config_with_anchors_or_aliases_is_not_expanded() {
        let row = vec!["\"x\""; 100].join(",");
        let uses = vec!["*a"; 100].join(",");
        let mut bomb = format!("{{\"a\":&a [{row}], \"b\":[{uses}]}}\n");
        bomb.push_str("project:\n  type: manuscript\nmanuscript:\n  article: paper.qmd\n");
        let started = Instant::now();

        let project = parse(&bomb);

        assert!(started.elapsed() < Duration::from_secs(1));
        assert_eq!(project.main, INDEX);
        assert_eq!(project.output_dir, None);
    }
}
