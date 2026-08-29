use std::path::{Path, PathBuf};

use serde::Serialize;

// Skills packs v1: ~/.oleafly/skills/<id>/ holds a SKILL.md (frontmatter +
// instructions) and a manifest.json the webview validates with zod
// (src/lib/skills.ts). First listing seeds the four built-in workflow skills
// so the folder is never empty; users and future CDN packs add more. The
// manifest schema reserves sha256 pins for the signed-catalog machinery.

#[derive(Clone, Serialize)]
pub struct RawSkillPack {
    pub id: String,
    pub manifest_json: String,
    pub skill_md: String,
}

fn skills_root(root: &Path) -> PathBuf {
    root.join("skills")
}

const DEFAULT_SKILLS: [(&str, &str, &str); 9] = [
    (
        "research-authoring",
        r#"{ "name": "research-authoring", "version": "1.0.0", "description": "Draft or extend a research manuscript section by section." }"#,
        "---\nname: research-authoring\ndescription: Draft or extend a research manuscript section by section.\n---\n\nWork through the manuscript one section at a time. Before writing, map the current outline and note gaps. Draft in the project's voice and formatting, keep claims tied to citations that exist in the bibliography, and compile after each section so the document never drifts from a building state.\n",
    ),
    (
        "research-review",
        r#"{ "name": "research-review", "version": "1.0.0", "description": "Review the manuscript the way a careful referee would." }"#,
        "---\nname: research-review\ndescription: Review the manuscript the way a careful referee would.\n---\n\nRead the full manuscript and produce a structured review: summary, strengths, major concerns, minor issues, and line-level notes. Check that every claim is supported, that figures and tables are referenced, and that notation stays consistent. Do not edit the document; report findings so I can decide what to change.\n",
    ),
    (
        "research-citation",
        r#"{ "name": "research-citation", "version": "1.0.0", "description": "Audit, verify, and complete the project's citations." }"#,
        "---\nname: research-citation\ndescription: Audit, verify, and complete the project's citations.\n---\n\nScan the document for citation problems: unresolved keys, entries never cited, claims that need a source, and bibliography entries with missing fields. Verify entries against the citation tools, fetch canonical BibTeX where it is missing, and recompile to confirm the bibliography resolves cleanly.\n",
    ),
    (
        "research-publish",
        r#"{ "name": "research-publish", "version": "1.0.0", "description": "Prepare the manuscript for submission to a venue." }"#,
        "---\nname: research-publish\ndescription: Prepare the manuscript for submission to a venue.\n---\n\nRun a submission pass: confirm the venue's format and page limits, check the abstract and title, verify anonymization where required, resolve every remaining compile warning, and produce a final clean PDF. List anything that still needs a human decision before upload.\n",
    ),
    (
        "conduct-research",
        r#"{ "name": "conduct-research", "version": "1.0.0", "description": "Run a literature investigation for the current project." }"#,
        "---\nname: conduct-research\ndescription: Run a literature investigation for the current project.\n---\n\nInvestigate the research question I give you. Search the literature tools for relevant work, read what the connectors return, and build an annotated map: the key papers, how they relate, and where the open gap is. Save the findings as notes in the project so authoring can build on them.\n",
    ),
    (
        "import-refine",
        r#"{ "name": "import-refine", "version": "1.0.0", "description": "Clean up an imported document so it compiles and reads well." }"#,
        "---\nname: import-refine\ndescription: Clean up an imported document so it compiles and reads well.\n---\n\nReview the imported sources in this project. Fix compile errors first, then normalize the preamble, tidy section structure, and flag any content that did not survive the import. Compile after each change and stop when the document builds cleanly.\n",
    ),
    (
        "pdf-to-latex",
        r#"{ "name": "pdf-to-latex", "version": "1.0.0", "description": "Reconstruct an attached PDF as an editable LaTeX project." }"#,
        "---\nname: pdf-to-latex\ndescription: Reconstruct an attached PDF as an editable LaTeX project.\n---\n\nRead the attached PDF page by page and rebuild it as LaTeX in this project. Match the section structure, environments, math, and citations. After each section, compile and use the PDF text tools to compare the output against the original.\n",
    ),
    (
        "template-generate",
        r#"{ "name": "template-generate", "version": "1.0.0", "description": "Turn the current document into a reusable template." }"#,
        "---\nname: template-generate\ndescription: Turn the current document into a reusable template.\n---\n\nGeneralize the current document into a reusable template: replace concrete content with placeholder commands, keep the preamble and styling, and document each placeholder at the top of the file. Compile to confirm the skeleton still builds.\n",
    ),
    (
        "ai-figure",
        r#"{ "name": "ai-figure", "version": "1.0.0", "description": "Draw a publication-quality TikZ figure from a description." }"#,
        "---\nname: ai-figure\ndescription: Draw a publication-quality TikZ figure from a description.\n---\n\nDraw the figure I describe as TikZ. Preview it with the figure tools, iterate until the layout is clean and labels do not overlap, then insert it at my cursor with a caption and label.\n",
    ),
];

pub fn seed_defaults(root: &Path) -> Result<(), String> {
    let skills = skills_root(root);
    for (id, manifest, skill_md) in DEFAULT_SKILLS {
        let dir = skills.join(id);
        if dir.exists() {
            continue;
        }
        std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create skill dir: {e}"))?;
        std::fs::write(dir.join("manifest.json"), manifest)
            .map_err(|e| format!("failed to write skill manifest: {e}"))?;
        std::fs::write(dir.join("SKILL.md"), skill_md)
            .map_err(|e| format!("failed to write SKILL.md: {e}"))?;
    }
    Ok(())
}

pub fn list(root: &Path) -> Result<Vec<RawSkillPack>, String> {
    seed_defaults(root)?;
    let mut packs = Vec::new();
    let entries = std::fs::read_dir(skills_root(root))
        .map_err(|e| format!("failed to read skills dir: {e}"))?;
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        let manifest_json =
            std::fs::read_to_string(entry.path().join("manifest.json")).unwrap_or_default();
        let skill_md = std::fs::read_to_string(entry.path().join("SKILL.md")).unwrap_or_default();
        if manifest_json.is_empty() && skill_md.is_empty() {
            continue;
        }
        packs.push(RawSkillPack {
            id,
            manifest_json,
            skill_md,
        });
    }
    packs.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(packs)
}

#[tauri::command]
pub fn skills_list() -> Result<Vec<RawSkillPack>, String> {
    list(&crate::paths::oleafly_root()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("oleafly-skills-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn first_list_seeds_the_default_workflow_skills() {
        let root = temp_root("seed");
        let packs = list(&root).unwrap();
        let ids: Vec<_> = packs.iter().map(|p| p.id.as_str()).collect();
        assert!(ids.contains(&"import-refine"));
        assert!(ids.contains(&"pdf-to-latex"));
        assert!(ids.contains(&"template-generate"));
        assert!(ids.contains(&"ai-figure"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn user_edits_survive_reseeding() {
        let root = temp_root("edits");
        list(&root).unwrap();
        let skill = skills_root(&root).join("ai-figure").join("SKILL.md");
        std::fs::write(&skill, "customized").unwrap();

        let packs = list(&root).unwrap();
        let figure = packs.iter().find(|p| p.id == "ai-figure").unwrap();
        assert_eq!(figure.skill_md, "customized");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn extra_user_skills_are_listed_sorted() {
        let root = temp_root("extra");
        let dir = skills_root(&root).join("zz-custom");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), "---\nname: zz-custom\n---\nbody").unwrap();

        let packs = list(&root).unwrap();
        assert_eq!(packs.last().unwrap().id, "zz-custom");
        std::fs::remove_dir_all(&root).ok();
    }
}
