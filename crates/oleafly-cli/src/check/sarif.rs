//! SARIF 2.1.0 for code-scanning services (GitHub and others): paths
//! relative to the repository, UTF-16 columns, stable line fingerprints.
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::report::{Level, ReportRow, RuleMeta};

/// Where SARIF paths start: the Git root holding the project, else the
/// project itself.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SarifBase {
    pub base_dir: PathBuf,
    /// The project folder below `base_dir` (`"paper/"`, or `""`).
    pub project_prefix: String,
}

pub fn sarif_base(project_root: &Path) -> SarifBase {
    let root = project_root
        .canonicalize()
        .map(|path| oleafly_core::plain_path(&path))
        .unwrap_or_else(|_| project_root.to_path_buf());
    for ancestor in root.ancestors() {
        // A worktree's `.git` is a file; it counts too.
        if ancestor.join(".git").exists() {
            let relative = root.strip_prefix(ancestor).unwrap_or(Path::new(""));
            let parts: Vec<String> = relative
                .components()
                .map(|part| part.as_os_str().to_string_lossy().into_owned())
                .collect();
            let prefix = if parts.is_empty() {
                String::new()
            } else {
                format!("{}/", parts.join("/"))
            };
            return SarifBase {
                base_dir: ancestor.to_path_buf(),
                project_prefix: prefix,
            };
        }
    }
    SarifBase {
        base_dir: root,
        project_prefix: String::new(),
    }
}

fn keep(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || b"-._~!$&'()*+,;=:@".contains(&byte)
}

fn encode_segment(segment: &str) -> String {
    let mut out = String::new();
    for byte in segment.bytes() {
        if keep(byte) {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn encode_path(path: &str) -> String {
    path.split('/')
        .map(encode_segment)
        .collect::<Vec<_>>()
        .join("/")
}

pub fn file_uri(path: &Path) -> String {
    file_uri_from(&path.to_string_lossy(), cfg!(windows))
}

/// A folder as a `file:` URI ending in `/`.
pub fn file_uri_from(path: &str, windows: bool) -> String {
    let mut uri = if windows {
        let path = if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{rest}")
        } else {
            path.strip_prefix(r"\\?\").unwrap_or(path).to_string()
        };
        let path = path.replace('\\', "/");
        match path.strip_prefix("//") {
            Some(unc) => format!("file://{}", encode_path(unc)),
            None => format!("file:///{}", encode_path(path.trim_start_matches('/'))),
        }
    } else {
        format!("file://{}", encode_path(path))
    };
    if !uri.ends_with('/') {
        uri.push('/');
    }
    uri
}

/// A project file's path from the SARIF base, percent-encoded.
pub fn relative_uri(prefix: &str, file: &str) -> String {
    encode_path(&format!("{prefix}{file}"))
}

/// 16 hex digits of SHA-256 over the rule and the trimmed line.
pub fn line_hash(rule_id: &str, line_text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(rule_id.as_bytes());
    hasher.update([0u8]);
    hasher.update(line_text.trim().as_bytes());
    hasher.finalize()[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn pascal_case(id: &str) -> String {
    id.split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|first| first.to_ascii_uppercase().to_string() + chars.as_str())
                .unwrap_or_default()
        })
        .collect()
}

pub fn sarif_document(
    automation_id: &str,
    rules: &[RuleMeta],
    rows: &[ReportRow],
    base: &SarifBase,
    main_document: &str,
) -> Value {
    let used: Vec<&RuleMeta> = rules
        .iter()
        .filter(|rule| rows.iter().any(|row| row.rule_id == rule.id))
        .collect();
    let rules_json: Vec<Value> = used
        .iter()
        .map(|rule| {
            let mut value = json!({
                "id": rule.id,
                "name": pascal_case(&rule.id),
                "shortDescription": {"text": rule.short},
                "fullDescription": {"text": rule.full},
                "help": {"text": rule.full},
                "defaultConfiguration": {"level": rule.default_level.as_str()},
                "properties": {"tags": rule.tags, "precision": rule.precision},
            });
            if let Some(uri) = &rule.help_uri {
                value["helpUri"] = json!(uri);
            }
            value
        })
        .collect();
    let mut occurrences: HashMap<(String, String), usize> = HashMap::new();
    let results: Vec<Value> = rows
        .iter()
        .map(|row| {
            let file = row.file.as_deref().unwrap_or(main_document);
            let region = match &row.range {
                Some(range) => json!({
                    "startLine": range.start.line,
                    "startColumn": range.start.column,
                    "endLine": range.end.line,
                    "endColumn": range.end.column.max(if range.end.line == range.start.line { range.start.column } else { 1 }),
                }),
                None => json!({"startLine": 1, "startColumn": 1, "endLine": 1, "endColumn": 1}),
            };
            let hash = line_hash(&row.rule_id, row.line_text.as_deref().unwrap_or(""));
            let count = occurrences.entry((file.to_string(), hash.clone())).or_insert(0);
            *count += 1;
            let text = match &row.detail {
                Some(detail) if !detail.is_empty() => format!("{}\n\n{detail}", row.title),
                _ => row.title.clone(),
            };
            json!({
                "ruleId": row.rule_id,
                "ruleIndex": used.iter().position(|rule| rule.id == row.rule_id).unwrap_or(0),
                "level": match row.level { Level::Error => "error", Level::Warning => "warning", Level::Note => "note" },
                "message": {"text": text},
                "locations": [{
                    "physicalLocation": {
                        "artifactLocation": {"uri": relative_uri(&base.project_prefix, file), "uriBaseId": "SRCROOT"},
                        "region": region,
                    }
                }],
                "partialFingerprints": {"primaryLocationLineHash": format!("{hash}:{count}")},
            })
        })
        .collect();
    let base_uri = file_uri(&base.base_dir);
    json!({
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "version": "2.1.0",
        "runs": [{
            "tool": {"driver": {
                "name": "Oleafly",
                "semanticVersion": crate::version::APP_VERSION,
                "informationUri": "https://oleafly.com",
                "rules": rules_json,
            }},
            "automationDetails": {"id": automation_id},
            "columnKind": "utf16CodeUnits",
            "originalUriBaseIds": {"SRCROOT": {"uri": base_uri}},
            "invocations": [{"executionSuccessful": true, "workingDirectory": {"uri": base_uri}}],
            "results": results,
        }],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_preflight::Position;

    #[test]
    fn file_uri_handles_windows_drive_paths() {
        assert_eq!(
            file_uri_from(r"C:\Users\Ana María\paper", true),
            "file:///C:/Users/Ana%20Mar%C3%ADa/paper/"
        );
    }

    #[test]
    fn file_uri_strips_verbatim_prefixes() {
        assert_eq!(file_uri_from(r"\\?\C:\x", true), "file:///C:/x/");
        assert_eq!(
            file_uri_from(r"\\?\UNC\srv\share\x", true),
            "file://srv/share/x/"
        );
    }

    #[test]
    fn file_uri_handles_unc_shares() {
        assert_eq!(file_uri_from(r"\\srv\share\p", true), "file://srv/share/p/");
    }

    #[test]
    fn file_uri_on_unix_encodes_spaces() {
        assert_eq!(file_uri_from("/home/a b", false), "file:///home/a%20b/");
    }

    #[test]
    fn relative_uri_percent_encodes_segments() {
        assert_eq!(
            relative_uri("paper/", "figs/my plot#1.png"),
            "paper/figs/my%20plot%231.png"
        );
    }

    #[test]
    fn sarif_base_uses_the_git_root() {
        let repo = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(repo.path().join(".git")).unwrap();
        std::fs::create_dir_all(repo.path().join("paper")).unwrap();
        let base = sarif_base(&repo.path().join("paper"));
        assert_eq!(base.project_prefix, "paper/");
        let worktree = tempfile::tempdir().unwrap();
        std::fs::write(worktree.path().join(".git"), "gitdir: elsewhere").unwrap();
        assert_eq!(sarif_base(worktree.path()).project_prefix, "");
    }

    #[test]
    fn line_hash_ignores_indentation() {
        assert_eq!(line_hash("r", "  \\cite{x}"), line_hash("r", "\\cite{x}\t"));
        assert_ne!(line_hash("r", "a"), line_hash("s", "a"));
        assert_eq!(line_hash("r", "a").len(), 16);
    }

    #[test]
    fn sarif_document_has_the_fields_github_requires() {
        let rule = RuleMeta {
            id: "refs-undefined-cite".into(),
            short: "Undefined citation".into(),
            full: "A citation names no entry.".into(),
            default_level: Level::Error,
            tags: vec!["refs".into()],
            precision: "high",
            help_uri: None,
        };
        let position = |line, column| Position { line, column };
        let row = |line_text: &str| ReportRow {
            rule_id: rule.id.clone(),
            level: Level::Error,
            title: "Citation \"x\" is not in any .bib".into(),
            detail: Some("Add it.".into()),
            file: Some("sections/intro.tex".into()),
            range: Some(super::super::report::RowRange {
                from: 3,
                to: 9,
                start: position(4, 9),
                end: position(4, 15),
            }),
            line_text: Some(line_text.into()),
            json: json!({}),
        };
        let base = SarifBase {
            base_dir: PathBuf::from("/repo"),
            project_prefix: "paper/".into(),
        };
        let document = sarif_document(
            "oleafly/check/",
            std::slice::from_ref(&rule),
            &[row("\\cite{x}"), row("  \\cite{x}")],
            &base,
            "main.tex",
        );
        assert_eq!(document["version"], "2.1.0");
        let run = &document["runs"][0];
        assert_eq!(run["tool"]["driver"]["name"], "Oleafly");
        assert_eq!(
            run["tool"]["driver"]["rules"][0]["name"],
            "RefsUndefinedCite"
        );
        assert_eq!(run["columnKind"], "utf16CodeUnits");
        assert_eq!(run["automationDetails"]["id"], "oleafly/check/");
        let results = run["results"].as_array().unwrap();
        for (index, result) in results.iter().enumerate() {
            assert!(result["message"]["text"]
                .as_str()
                .unwrap()
                .starts_with("Citation"));
            let location = &result["locations"][0]["physicalLocation"];
            assert_eq!(
                location["artifactLocation"]["uri"],
                "paper/sections/intro.tex"
            );
            for field in ["startLine", "startColumn", "endLine", "endColumn"] {
                assert!(location["region"][field].is_u64(), "{field}");
            }
            let fingerprint = result["partialFingerprints"]["primaryLocationLineHash"]
                .as_str()
                .unwrap();
            assert!(
                fingerprint.ends_with(&format!(":{}", index + 1)),
                "{fingerprint}"
            );
        }
    }
}
