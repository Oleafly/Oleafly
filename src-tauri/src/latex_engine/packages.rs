use super::*;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, serde::Serialize)]
pub struct TexPackage {
    name: String,
    description: String,
}

#[derive(serde::Deserialize)]
struct SearchResult {
    packages: BTreeMap<String, String>,
    files: BTreeMap<String, Vec<String>>,
}

fn literal_pattern(value: &str) -> String {
    let mut pattern = String::new();
    for ch in value.chars() {
        if "\\.^$|?*+()[]{}".contains(ch) {
            pattern.push('\\');
        }
        pattern.push(ch);
    }
    pattern
}

fn validate_files(files: &[String]) -> Result<(), String> {
    if files.is_empty() || files.len() > 8 {
        return Err("Choose between one and eight missing LaTeX files.".into());
    }
    for file in files {
        if file.len() > 128
            || !file
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphanumeric)
            || !file
                .bytes()
                .all(|ch| ch.is_ascii_alphanumeric() || b"._-".contains(&ch))
            || !file.rsplit_once('.').is_some_and(|(_, extension)| {
                extension.eq_ignore_ascii_case("sty") || extension.eq_ignore_ascii_case("cls")
            })
        {
            return Err(format!("Invalid LaTeX package filename: {file}"));
        }
    }
    Ok(())
}

async fn search_at(tlmgr: &str, pattern: String, files: bool) -> Result<SearchResult, String> {
    let mut args = vec!["search".into(), "--global".into(), "--json".into()];
    if files {
        args.push("--file".into());
    }
    args.extend(["--".into(), pattern]);
    let output = run_tex_utility(Path::new(tlmgr), &args, TLMGR_INFO_TIMEOUT).await?;
    if !output.success {
        return Err(package_command_error(&output, "Could not search TeX Live."));
    }
    parse_search_result(&output.stdout)
}

fn parse_search_result(stdout: &str) -> Result<SearchResult, String> {
    let json = stdout
        .find('{')
        .map(|start| &stdout[start..])
        .unwrap_or(stdout);
    serde_json::from_str(json)
        .map_err(|error| format!("Could not read the TeX Live search results: {error}"))
}

pub(super) fn package_command_error(output: &TexUtilityOutput, fallback: &str) -> String {
    let detail = format!("{}\n{}", output.stdout.trim(), output.stderr.trim());
    if detail.trim().is_empty() {
        fallback.into()
    } else {
        detail.trim().into()
    }
}

#[tauri::command]
pub async fn tlmgr_search(query: String) -> Result<Vec<TexPackage>, String> {
    let query = query.trim();
    if query.len() < 2 || query.len() > 128 || query.chars().any(char::is_control) {
        return Err("Enter between 2 and 128 characters to search TeX Live.".into());
    }
    let _runtime = acquire_tex_runtime_read()?;
    let tlmgr = tlmgr_path()?;
    let result = search_at(&tlmgr, literal_pattern(query), false).await?;
    Ok(search_packages(result, query))
}

fn search_packages(result: SearchResult, query: &str) -> Vec<TexPackage> {
    let mut packages: Vec<_> = result
        .packages
        .into_iter()
        .filter(|(name, _)| validate_package_names(std::slice::from_ref(name)).is_ok())
        .map(|(name, description)| TexPackage { name, description })
        .collect();
    packages.sort_by(|a, b| {
        (!a.name.eq_ignore_ascii_case(query))
            .cmp(&(!b.name.eq_ignore_ascii_case(query)))
            .then_with(|| a.name.cmp(&b.name))
    });
    packages.truncate(200);
    packages
}

fn resolve_providers(result: SearchResult, files: &[String]) -> Result<Vec<String>, String> {
    let mut packages = BTreeSet::new();
    for file in files {
        let providers: Vec<_> = result
            .files
            .iter()
            .filter(|(name, paths)| {
                validate_package_names(std::slice::from_ref(name)).is_ok()
                    && paths.iter().any(|path| {
                        path.starts_with("texmf-dist/tex/")
                            && !path.starts_with("texmf-dist/tex/latex-dev/")
                            && path.rsplit('/').next() == Some(file.as_str())
                    })
            })
            .map(|(name, _)| name.clone())
            .collect();
        match providers.as_slice() {
            [name] => { packages.insert(name.clone()); }
            [] => return Err(format!("TeX Live has no package that provides {file}. If this file belongs to your university or publisher template, add it to the project from the original template.")),
            _ => return Err(format!("Several TeX Live packages provide {file}: {}. Search for these packages in Settings and choose the one required by your template.", providers.join(", "))),
        }
    }
    Ok(packages.into_iter().collect())
}

async fn install_missing_at(tlmgr: &str, files: Vec<String>) -> Result<String, String> {
    validate_files(&files)?;
    let pattern = format!(
        "(^|/)({})$",
        files
            .iter()
            .map(|file| literal_pattern(file))
            .collect::<Vec<_>>()
            .join("|")
    );
    let result = search_at(tlmgr, pattern, true).await?;
    let packages = resolve_providers(result, &files)?;
    tlmgr_run_at(tlmgr, "install", packages).await
}

#[tauri::command]
pub async fn tlmgr_install_missing(
    state: tauri::State<'_, AppState>,
    files: Vec<String>,
) -> Result<String, String> {
    validate_files(&files)?;
    let _mutation = TinytexMutationGuard::acquire_maintenance()?;
    let _compile = state.compile_lock.lock().await;
    let _figure_compile = state.figure_compile_lock.lock().await;
    let _runtime = acquire_tex_runtime_write()?;
    install_missing_at(&tlmgr_path()?, files).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn results(files: serde_json::Value) -> SearchResult {
        parse_search_result(&serde_json::json!({"packages": {}, "files": files}).to_string())
            .unwrap()
    }

    #[test]
    fn resolves_file_owners_and_deduplicates_shared_packages() {
        let result = results(serde_json::json!({
            "pgf": ["texmf-dist/tex/latex/pgf/frontendlayer/tikz.sty"],
            "caption": ["texmf-dist/tex/latex/caption/caption.sty", "texmf-dist/tex/latex/caption/subcaption.sty"],
            "latex-graphics-dev": ["texmf-dist/tex/latex-dev/graphics/graphicx.sty"],
            "graphics": ["texmf-dist/tex/latex/graphics/graphicx.sty"]
        }));
        let files = ["tikz.sty", "caption.sty", "subcaption.sty", "graphicx.sty"].map(String::from);
        assert_eq!(
            resolve_providers(result, &files).unwrap(),
            ["caption", "graphics", "pgf"]
        );
    }

    #[test]
    fn does_not_install_an_arbitrary_provider_or_an_incomplete_set() {
        let files = ["thesis.cls".into()];
        assert!(resolve_providers(results(serde_json::json!({})), &files)
            .unwrap_err()
            .contains("original template"));
        let result = results(
            serde_json::json!({"a": ["texmf-dist/tex/latex/a/thesis.cls"], "b": ["texmf-dist/tex/latex/b/thesis.cls"]}),
        );
        assert!(resolve_providers(result, &files)
            .unwrap_err()
            .contains("Several"));
        let result = results(serde_json::json!({"a": ["texmf-dist/doc/latex/a/thesis.cls"]}));
        assert!(resolve_providers(result, &files).is_err());
    }

    #[test]
    fn escapes_search_patterns_and_rejects_invalid_filenames() {
        assert_eq!(literal_pattern("a.b+(c)[d]"), r"a\.b\+\(c\)\[d\]");
        for file in [
            "../thesis.cls",
            "--foo.sty",
            "foo.tex",
            "foo.sty|bar",
            "a b.sty",
        ] {
            assert!(validate_files(&[file.into()]).is_err());
        }
        assert!(validate_files(&["university_thesis.cls".into()]).is_ok());
        assert!(validate_files(&[]).is_err());
    }

    #[test]
    fn parses_json_after_repository_notice_and_prioritizes_exact_names() {
        let result = parse_search_result("tlmgr: package repository https://example.test\n{\"files\":{},\"packages\":{\"arsclassica\":\"Thesis style\",\"classicthesis\":\"Thesis\",\"--bad\":\"invalid\"}}").unwrap();
        let packages = search_packages(result, "classicthesis");
        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "classicthesis");
        assert!(parse_search_result("not json").is_err());
    }

    #[test]
    fn errors_keep_both_output_streams_and_never_return_an_empty_reason() {
        let output = TexUtilityOutput {
            success: false,
            stdout: "repository details".into(),
            stderr: "permission denied".into(),
        };
        let error = package_command_error(&output, "Install failed.");
        assert!(error.contains("repository details"));
        assert!(error.contains("permission denied"));
        let empty = TexUtilityOutput {
            success: false,
            stdout: String::new(),
            stderr: String::new(),
        };
        assert_eq!(
            package_command_error(&empty, "Install failed."),
            "Install failed."
        );
    }

    #[cfg(unix)]
    fn fake_manager(result: &str) -> (tempfile::TempDir, String) {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let script = root.path().join("tlmgr");
        let calls = root.path().join("calls");
        std::fs::write(&script, format!("#!/bin/sh\nprintf '%s\\n' \"$@\" >> '{}'\nif [ \"$1\" = search ]; then\ncat <<'RESULT'\n{}\nRESULT\nelse\nprintf 'Installed\\n'\nfi\n", calls.display(), result)).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
        (root, script.to_string_lossy().into_owned())
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn installation_uses_resolved_package_names_at_the_process_boundary() {
        let (root, manager) = fake_manager(
            r#"{"packages":{},"files":{"pgf":["texmf-dist/tex/latex/pgf/tikz.sty"],"caption":["texmf-dist/tex/latex/caption/subcaption.sty"]}}"#,
        );
        install_missing_at(&manager, vec!["tikz.sty".into(), "subcaption.sty".into()])
            .await
            .unwrap();
        let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
        assert!(calls.starts_with("search\n--global\n--json\n--file\n--\n"));
        assert!(calls.contains(r"(^|/)(tikz\.sty|subcaption\.sty)$"));
        assert!(calls.ends_with("install\n--\ncaption\npgf\n"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn missing_template_files_stop_before_any_installation() {
        let (root, manager) = fake_manager(
            r#"{"packages":{},"files":{"pgf":["texmf-dist/tex/latex/pgf/tikz.sty"]}}"#,
        );
        let error = install_missing_at(&manager, vec!["tikz.sty".into(), "university.cls".into()])
            .await
            .unwrap_err();
        assert!(error.contains("university.cls"));
        assert!(!std::fs::read_to_string(root.path().join("calls"))
            .unwrap()
            .contains("install\n"));
    }
}
