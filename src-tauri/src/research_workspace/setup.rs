use super::model::{
    ResearchDocumentEngine, ResearchProjectFilePreview, ResearchProjectPreview,
    ResearchProjectRequest, ResearchStarter,
};
use std::path::{Path, PathBuf};

#[cfg(test)]
use std::collections::HashMap;

const MAX_PROJECT_NAME_BYTES: usize = 120;

fn validate_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Project name cannot be empty.".into());
    }
    if name.len() > MAX_PROJECT_NAME_BYTES
        || name.chars().any(char::is_control)
        || name.contains('/')
        || name.contains('\\')
    {
        return Err(
            "Use a project name without slashes or control characters, up to 120 characters."
                .into(),
        );
    }
    Ok(name.to_string())
}

fn latex_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        escaped.push_str(match character {
            '\\' => "\\textbackslash{}",
            '&' => "\\&",
            '%' => "\\%",
            '$' => "\\$",
            '#' => "\\#",
            '_' => "\\_",
            '{' => "\\{",
            '}' => "\\}",
            '^' => "\\^{}",
            '~' => "\\~{}",
            _ => {
                escaped.push(character);
                continue;
            }
        });
    }
    escaped
}

fn quoted_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn markdown_text(value: &str) -> String {
    let mut text = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '{' | '}' => {
                text.push_str("[\\");
                text.push(character);
                text.push_str("]{}");
            }
            '\'' | '"' => text.push(character),
            _ if character.is_ascii_punctuation() => {
                text.push('\\');
                text.push(character);
            }
            _ => text.push(character),
        }
    }
    text
}

const CALEPIN_PRELUDE: &str =
    "#import \"/.calepin/calepin.typ\" as calepin\n#show: calepin.document\n\n";

fn section_names(starter: ResearchStarter) -> &'static [&'static str] {
    match starter {
        ResearchStarter::Article => &[
            "Introduction",
            "Methods",
            "Results",
            "Discussion",
            "Conclusion",
        ],
        ResearchStarter::LiteratureReview => &[
            "Scope",
            "Search strategy",
            "Themes",
            "Evidence gaps",
            "Conclusion",
        ],
        ResearchStarter::Thesis => &[
            "Introduction",
            "Background",
            "Methods",
            "Results",
            "Discussion",
            "Conclusion",
        ],
        ResearchStarter::ReproducibleAnalysis => &[
            "Research question",
            "Data and methods",
            "Analysis",
            "Results",
            "Limitations",
        ],
    }
}

fn main_document(
    name: &str,
    engine: ResearchDocumentEngine,
    starter: ResearchStarter,
) -> (String, String) {
    match engine {
        ResearchDocumentEngine::Latex => {
            let sections = section_names(starter)
                .iter()
                .map(|section| format!("\\section{{{section}}}\n\n"))
                .collect::<String>();
            (
                "main.tex".into(),
                format!(
                    "\\documentclass[11pt]{{article}}\n\\usepackage[T1]{{fontenc}}\n\\usepackage{{hyperref}}\n\n\\title{{{}}}\n\\author{{}}\n\n\\begin{{document}}\n\\maketitle\n\n\\begin{{abstract}}\nDescribe the question, method, and main finding.\n\\end{{abstract}}\n\n{sections}\\end{{document}}\n",
                    latex_escape(name)
                ),
            )
        }
        ResearchDocumentEngine::Typst | ResearchDocumentEngine::Calepin => {
            let prelude = if engine == ResearchDocumentEngine::Calepin {
                CALEPIN_PRELUDE
            } else {
                ""
            };
            let sections = section_names(starter)
                .iter()
                .map(|section| format!("== {section}\n\n"))
                .collect::<String>();
            let title = quoted_escape(name);
            (
                "main.typ".into(),
                format!(
                    "{prelude}#set document(title: \"{title}\")\n#set page(paper: \"us-letter\", margin: 1in)\n#set text(size: 11pt)\n\n= #text(\"{title}\")\n\n#emph[Describe the question, method, and main finding.]\n\n{sections}"
                ),
            )
        }
        ResearchDocumentEngine::Markdown => {
            let sections = section_names(starter)
                .iter()
                .map(|section| format!("## {section}\n\n"))
                .collect::<String>();
            let title = markdown_text(name);
            (
                "main.md".into(),
                format!(
                    "---\ntitle: \"{}\"\nauthor: \"\"\n---\n\n# {title}\n\n_Describe the question, method, and main finding._\n\n{sections}",
                    quoted_escape(&title)
                ),
            )
        }
        ResearchDocumentEngine::Quarto => {
            let sections = section_names(starter)
                .iter()
                .map(|section| format!("# {section}\n\n"))
                .collect::<String>();
            (
                "main.qmd".into(),
                format!(
                    "---\ntitle: \"{}\"\nauthor: \"\"\nabstract: \"Describe the question, method, and main finding.\"\nformat: typst\n---\n\n{sections}",
                    quoted_escape(&markdown_text(name))
                ),
            )
        }
    }
}

fn initial_task(starter: ResearchStarter) -> &'static str {
    match starter {
        ResearchStarter::Article => "Define the research question and draft the article outline.",
        ResearchStarter::LiteratureReview => {
            "Set the review scope, then build a reading list from verified sources."
        }
        ResearchStarter::Thesis => {
            "Map the thesis question, chapters, and evidence needed for each claim."
        }
        ResearchStarter::ReproducibleAnalysis => {
            "Record the data provenance and plan a reproducible analysis before running it."
        }
    }
}

fn shared_files(starter: ResearchStarter) -> Vec<(String, Option<String>)> {
    let mut files = vec![
        ("analysis".into(), None),
        ("figures".into(), None),
        ("research".into(), None),
        ("research/sources".into(), None),
        ("review".into(), None),
        (
            "research/reading-list.md".into(),
            Some("# Reading list\n\nRecord each source, why it matters, and whether you have read it.\n".into()),
        ),
        (
            "research/claims.md".into(),
            Some("# Claims\n\nTrack each manuscript claim with its supporting source or result.\n".into()),
        ),
        (
            "research/sources/.gitkeep".into(),
            Some(String::new()),
        ),
        (
            "review/notes.md".into(),
            Some("# Review notes\n\nKeep reviewer questions and revision decisions here.\n".into()),
        ),
        ("figures/.gitkeep".into(), Some(String::new())),
    ];
    match starter {
        ResearchStarter::ReproducibleAnalysis => {
            files.extend([
                ("analysis/data".into(), None),
                ("analysis/output".into(), None),
                (
                    "analysis/README.md".into(),
                    Some("# Analysis\n\nDescribe how to reproduce the analysis and where outputs are written.\n".into()),
                ),
                (
                    "analysis/environment.md".into(),
                    Some("# Environment\n\nRecord the tools, versions, and commands used for each run.\n".into()),
                ),
                ("analysis/data/.gitkeep".into(), Some(String::new())),
                ("analysis/output/.gitkeep".into(), Some(String::new())),
            ]);
        }
        _ => files.push(("analysis/.gitkeep".into(), Some(String::new()))),
    }
    files
}

pub fn build_preview(request: ResearchProjectRequest) -> Result<ResearchProjectPreview, String> {
    let name = validate_name(&request.name)?;
    let (main_document, main_content) = main_document(&name, request.engine, request.starter);
    let mut files = vec![ResearchProjectFilePreview {
        path: main_document.clone(),
        kind: "file".into(),
        content: Some(main_content),
    }];
    files.extend(
        shared_files(request.starter)
            .into_iter()
            .map(|(path, content)| ResearchProjectFilePreview {
                path,
                kind: if content.is_some() {
                    "file"
                } else {
                    "directory"
                }
                .into(),
                content,
            }),
    );
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(ResearchProjectPreview {
        name,
        engine: request.engine,
        starter: request.starter,
        main_document,
        initial_task: initial_task(request.starter).into(),
        files,
    })
}

fn engine_id(engine: ResearchDocumentEngine, main_document: &str) -> Result<String, String> {
    match engine {
        ResearchDocumentEngine::Latex => crate::project::engine_for_new_project(main_document),
        ResearchDocumentEngine::Typst => Ok("typst".into()),
        ResearchDocumentEngine::Markdown => Ok("markdown".into()),
        ResearchDocumentEngine::Quarto => Ok("quarto".into()),
        ResearchDocumentEngine::Calepin => Ok("calepin".into()),
    }
}

struct ProjectReservation {
    project_id: String,
    path: PathBuf,
    _lock: crate::worktree_lock::ProjectWorktreeLock,
    committed: bool,
}

impl ProjectReservation {
    fn reserve(root: &Path) -> Result<Self, String> {
        for _ in 0..64 {
            let project_id = format!("research-{:032x}", rand::random::<u128>());
            let lock =
                crate::worktree_lock::ProjectWorktreeLock::exclusive_for_identity_allocation(
                    &project_id,
                )?;
            let path = root.join(&project_id);
            match std::fs::create_dir(&path) {
                Ok(()) => {
                    return Ok(Self {
                        project_id,
                        path,
                        _lock: lock,
                        committed: false,
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("could not reserve research project: {error}")),
            }
        }
        Err("Could not reserve a new project folder.".into())
    }

    fn commit(mut self) -> String {
        self.committed = true;
        self.project_id.clone()
    }
}

impl Drop for ProjectReservation {
    fn drop(&mut self) {
        if !self.committed {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

fn write_preview_tree(path: &Path, preview: &ResearchProjectPreview) -> Result<(), String> {
    for entry in &preview.files {
        let destination = path.join(&entry.path);
        if entry.kind == "directory" {
            std::fs::create_dir_all(&destination)
                .map_err(|error| format!("could not create {}: {error}", entry.path))?;
        } else {
            let parent = destination
                .parent()
                .ok_or_else(|| format!("{} has no parent folder", entry.path))?;
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("could not create {}: {error}", entry.path))?;
            let content = entry
                .content
                .as_deref()
                .ok_or_else(|| format!("{} has no file content", entry.path))?;
            std::fs::write(&destination, content)
                .map_err(|error| format!("could not write {}: {error}", entry.path))?;
        }
    }
    Ok(())
}

pub(super) fn create_at(root: &Path, request: ResearchProjectRequest) -> Result<String, String> {
    let preview = build_preview(request)?;
    let engine = engine_id(preview.engine, &preview.main_document)?;
    crate::document_engine::engine_for(&engine, &preview.main_document)?;
    let reservation = ProjectReservation::reserve(root)?;
    write_preview_tree(&reservation.path, &preview)?;
    let mut project = serde_json::json!({
        "name": preview.name,
        "main_doc": preview.main_document,
        "engine": &engine,
        "allow_shell_escape": false,
        "color": "",
        "kind": "",
        "exports": [],
        "hidden": false,
        "forked_from": null,
        "checkpoints": oleafly_core::CheckpointPolicy::default(),
        "research": {
            "starter": preview.starter,
            "initialTask": preview.initial_task
        }
    });
    if let Some(pin) = crate::typst_toolchain::creation_pin(&engine) {
        project["typst"] = serde_json::to_value(pin)
            .map_err(|error| format!("could not encode project metadata: {error}"))?;
    }
    let metadata = serde_json::to_vec_pretty(&project)
        .map_err(|error| format!("could not encode project metadata: {error}"))?;
    crate::sandbox::atomic_write(&reservation.path.join("project.json"), &metadata)?;
    let project_id = reservation.commit();
    crate::project::initialize_git_for_new_project(&project_id);
    Ok(project_id)
}

pub fn create(app: &tauri::AppHandle, request: ResearchProjectRequest) -> Result<String, String> {
    let project_id = create_at(&crate::paths::projects_root()?, request)?;
    crate::project::record_tex_spec_for_new_project(app, &project_id);
    Ok(project_id)
}

#[cfg(test)]
pub(super) fn preview_files(preview: &ResearchProjectPreview) -> HashMap<String, Option<String>> {
    preview
        .files
        .iter()
        .map(|entry| (entry.path.clone(), entry.content.clone()))
        .collect()
}
