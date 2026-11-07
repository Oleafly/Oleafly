use std::path::Path;

use serde::{Deserialize, Serialize};
use unicode_normalization::char::is_combining_mark;

use crate::portable::{is_windows_reserved_component, relative_problem};

const MANIFEST_FILE: &str = "project.json";
const MANIFEST_FIELD: &str = "pdf_sync";
const MAX_MANIFEST_BYTES: u64 = 4 * 1024 * 1024;
const FALLBACK_STEM: &str = "document";
const MAX_STEM_BYTES: usize = 120;

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct PdfSync {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub stem: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub path: String,
}

impl PdfSync {
    pub fn target(&self) -> Option<&str> {
        is_target_name(&self.path).then_some(self.path.as_str())
    }

    pub fn active_target(&self) -> Option<&str> {
        self.target().filter(|_| self.enabled)
    }
}

pub fn is_target_name(path: &str) -> bool {
    !path.contains(['/', '\\'])
        && path.to_ascii_lowercase().ends_with(".pdf")
        && relative_problem(path).is_none()
}

pub fn title_stem(title: &str) -> String {
    let mut cleaned = String::with_capacity(title.len());
    let mut in_gap = false;
    for character in title.chars() {
        if character.is_alphanumeric()
            || is_combining_mark(character)
            || matches!(character, '_' | '.' | '-')
        {
            cleaned.push(character);
            in_gap = false;
        } else if !in_gap {
            cleaned.push('_');
            in_gap = true;
        }
    }
    let mut stem = cleaned.trim_matches(['_', '.']);
    if stem.len() > MAX_STEM_BYTES {
        let mut end = MAX_STEM_BYTES;
        while !stem.is_char_boundary(end) {
            end -= 1;
        }
        stem = stem[..end].trim_end_matches(['_', '.']);
    }
    if stem.is_empty() {
        FALLBACK_STEM.to_owned()
    } else if is_windows_reserved_component(stem) {
        format!("{FALLBACK_STEM}_{stem}")
    } else {
        stem.to_owned()
    }
}

pub fn numbered_name(stem: &str, attempt: u32) -> String {
    if attempt <= 1 {
        format!("{stem}.pdf")
    } else {
        format!("{stem}_{attempt}.pdf")
    }
}

pub fn free_name(stem: &str, taken: impl Fn(&str) -> bool) -> String {
    (1..=9_999)
        .map(|attempt| numbered_name(stem, attempt))
        .find(|name| !taken(name))
        .unwrap_or_else(|| numbered_name(stem, 10_000))
}

pub fn target_in_manifest(manifest: &serde_json::Value) -> Option<String> {
    let sync: PdfSync = serde_json::from_value(manifest.get(MANIFEST_FIELD)?.clone()).ok()?;
    sync.active_target().map(str::to_owned)
}

pub fn target_in_folder(root: &Path) -> Option<String> {
    let path = root.join(MANIFEST_FILE);
    if std::fs::metadata(&path).ok()?.len() > MAX_MANIFEST_BYTES {
        return None;
    }
    target_in_manifest(&serde_json::from_slice(&std::fs::read(path).ok()?).ok()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_become_the_same_stem_as_a_download() {
        for (title, stem) in [
            ("Thesis: Final Draft", "Thesis_Final_Draft"),
            ("论文 初稿", "论文_初稿"),
            ("Überblick 2026", "Überblick_2026"),
            ("研究ノート", "研究ノート"),
            ("  ..Report..  ", "Report"),
            ("a/b\\c?d", "a_b_c_d"),
            ("v1.2-final", "v1.2-final"),
            ("???", "document"),
            ("", "document"),
        ] {
            assert_eq!(title_stem(title), stem, "{title}");
        }
    }

    #[test]
    fn every_stem_is_a_portable_file_name() {
        for title in [
            "Thesis: Final Draft",
            "Aux",
            "con",
            "LPT1",
            "NUL.backup",
            "ends with dot.",
            ".oleafly",
            ".git",
            "emoji 🎓 title",
        ] {
            let name = numbered_name(&title_stem(title), 1);
            assert!(is_target_name(&name), "{title} gave {name}");
        }
    }

    #[test]
    fn a_long_title_is_cut_on_a_character_boundary() {
        let stem = title_stem(&"论".repeat(200));
        assert!(stem.len() <= MAX_STEM_BYTES);
        assert!(stem.chars().all(|character| character == '论'));
    }

    #[test]
    fn a_taken_name_moves_on_to_the_next_number() {
        let taken = ["Thesis.pdf", "Thesis_2.pdf"];
        assert_eq!(
            free_name("Thesis", |name| taken.contains(&name)),
            "Thesis_3.pdf"
        );
        assert_eq!(free_name("Thesis", |_| false), "Thesis.pdf");
    }

    #[test]
    fn only_a_plain_pdf_in_the_project_root_can_be_a_target() {
        for path in [
            "",
            "main.tex",
            "figures/plot.pdf",
            "..\\up.pdf",
            "../up.pdf",
            ".git",
            "a:b.pdf",
            "NUL.pdf",
        ] {
            assert!(!is_target_name(path), "{path}");
        }
        assert!(is_target_name("Thesis.pdf"));
        assert!(is_target_name("Thesis.PDF"));
    }

    #[test]
    fn the_manifest_names_a_target_only_while_sync_is_on() {
        let on = serde_json::json!({
            "pdf_sync": { "enabled": true, "stem": "Thesis", "path": "Thesis.pdf" }
        });
        let off = serde_json::json!({
            "pdf_sync": { "enabled": false, "stem": "Thesis", "path": "Thesis.pdf" }
        });
        let unsafe_path = serde_json::json!({
            "pdf_sync": { "enabled": true, "stem": "x", "path": "main.tex" }
        });
        assert_eq!(target_in_manifest(&on).as_deref(), Some("Thesis.pdf"));
        assert_eq!(target_in_manifest(&off), None);
        assert_eq!(target_in_manifest(&unsafe_path), None);
        assert_eq!(target_in_manifest(&serde_json::json!({})), None);
    }

    #[test]
    fn the_folder_manifest_is_read_from_the_project_root() {
        let folder = tempfile::tempdir().unwrap();
        assert_eq!(target_in_folder(folder.path()), None);
        std::fs::write(
            folder.path().join(MANIFEST_FILE),
            r#"{"pdf_sync":{"enabled":true,"stem":"T","path":"T.pdf"}}"#,
        )
        .unwrap();
        assert_eq!(target_in_folder(folder.path()).as_deref(), Some("T.pdf"));
    }
}
