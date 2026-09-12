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

impl SearchResult {
    fn is_empty(&self) -> bool {
        self.packages.is_empty() && self.files.is_empty()
    }
}

async fn run_search(
    tlmgr: &str,
    pattern: &str,
    files: bool,
    global: bool,
) -> Result<TexUtilityOutput, String> {
    let mut args = vec!["search".to_string()];
    if global {
        args.push("--global".into());
    }
    args.push("--json".into());
    if files {
        args.push("--file".into());
    }
    args.extend(["--".into(), pattern.to_string()]);
    run_tex_utility(Path::new(tlmgr), &args, TLMGR_INFO_TIMEOUT).await
}

fn cross_release_error(output: &TexUtilityOutput) -> Option<String> {
    let text = format!("{}\n{}", output.stdout, output.stderr);
    let start = text.find("Local TeX Live (")?;
    let rest = &text[start..];
    if !rest.contains("is older than remote repository") {
        return None;
    }
    let years: Vec<&str> = rest
        .split('(')
        .skip(1)
        .filter_map(|chunk| chunk.split_once(')'))
        .map(|(year, _)| year.trim())
        .filter(|year| year.len() == 4 && year.chars().all(|c| c.is_ascii_digit()))
        .take(2)
        .collect();
    Some(match years.as_slice() {
        [local, remote] => format!(
            "Your TeX Live ({local}) is older than the package repository ({remote}). Update TeX Live, or install the packages with tlmgr yourself."
        ),
        _ => "Your TeX Live is older than the package repository, so tlmgr refuses the remote lookup. Update TeX Live, or install the packages with tlmgr yourself.".to_string(),
    })
}

async fn search_at(tlmgr: &str, pattern: String, files: bool) -> Result<SearchResult, String> {
    let local = run_search(tlmgr, &pattern, files, false).await?;
    if let Some(error) = cross_release_error(&local) {
        return Err(error);
    }
    if !local.success {
        return Err(package_command_error(&local, "Could not search TeX Live."));
    }
    let result = parse_search_result(&local.stdout)?;
    if !result.is_empty() {
        return Ok(result);
    }
    let global = run_search(tlmgr, &pattern, files, true).await?;
    if let Some(error) = cross_release_error(&global) {
        return Err(error);
    }
    if !global.success {
        return Err(package_command_error(
            &global,
            "Could not reach the TeX Live package repository.",
        ));
    }
    parse_search_result(&global.stdout)
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
    let tlmgr = tlmgr_path()?;
    within_flow_budget(TLMGR_FLOW_BUDGET, install_missing_at(&tlmgr, files)).await
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
    fn scripted_manager(body: &str) -> (tempfile::TempDir, String) {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let script = root.path().join("tlmgr");
        let calls = root.path().join("calls");
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$@\" >> '{}'\n{body}\n",
                calls.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
        (root, script.to_string_lossy().into_owned())
    }

    #[cfg(unix)]
    fn fake_manager(result: &str) -> (tempfile::TempDir, String) {
        scripted_manager(&format!(
            "if [ \"$1\" = search ]; then\ncat <<'RESULT'\n{result}\nRESULT\nelse\nprintf 'Installed\\n'\nfi"
        ))
    }

    #[cfg(unix)]
    const CROSS_RELEASE: &str = "tlmgr: Local TeX Live (2025) is older than remote repository (2026). Cross release updates are only supported with update-tlmgr-latest(.sh/.exe) --update";

    #[cfg(unix)]
    #[tokio::test]
    async fn an_empty_local_search_falls_back_to_the_global_repository() {
        let (root, manager) = scripted_manager(
            "if [ \"$1\" = search ]; then\nif [ \"$2\" = --global ]; then\nprintf '%s\\n' '{\"packages\":{},\"files\":{\"pgf\":[\"texmf-dist/tex/latex/pgf/tikz.sty\"]}}'\nelse\nprintf '%s\\n' '{\"packages\":{},\"files\":{}}'\nfi\nelse\nprintf 'Installed\\n'\nfi",
        );
        install_missing_at(&manager, vec!["tikz.sty".into()])
            .await
            .unwrap();
        let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
        assert!(calls.starts_with("search\n--json\n--file\n--\n"));
        assert!(calls.contains("search\n--global\n--json\n--file\n--\n"));
        assert!(calls.ends_with("install\n--\npgf\n"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_repository_newer_than_the_local_release_is_named_in_the_error() {
        let (root, manager) = scripted_manager(&format!(
            "if [ \"$2\" = --global ]; then\necho '{CROSS_RELEASE}' >&2\nexit 1\nfi\nprintf '%s\\n' '{{\"packages\":{{}},\"files\":{{}}}}'"
        ));
        let error = install_missing_at(&manager, vec!["tikz.sty".into()])
            .await
            .unwrap_err();
        assert!(error.contains("(2025)"), "{error}");
        assert!(error.contains("(2026)"), "{error}");
        assert!(error.contains("Update TeX Live"), "{error}");
        assert!(!std::fs::read_to_string(root.path().join("calls"))
            .unwrap()
            .contains("install\n"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_cross_release_local_search_is_not_retried_globally() {
        let (root, manager) = scripted_manager(&format!("echo '{CROSS_RELEASE}' >&2\nexit 1"));
        let error = install_missing_at(&manager, vec!["tikz.sty".into()])
            .await
            .unwrap_err();
        assert!(error.contains("Update TeX Live"), "{error}");
        assert!(!std::fs::read_to_string(root.path().join("calls"))
            .unwrap()
            .contains("--global"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn an_unreachable_repository_is_reported_instead_of_a_missing_package() {
        let (root, manager) = scripted_manager(
            "if [ \"$2\" = --global ]; then\necho 'tlmgr: repository unavailable' >&2\nexit 1\nfi\nprintf '%s\\n' '{\"packages\":{},\"files\":{}}'",
        );
        let error = install_missing_at(&manager, vec!["tikz.sty".into()])
            .await
            .unwrap_err();
        assert!(error.contains("repository unavailable"), "{error}");
        assert!(!error.contains("original template"), "{error}");
        assert!(!std::fs::read_to_string(root.path().join("calls"))
            .unwrap()
            .contains("install\n"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn unreadable_repository_results_are_reported_instead_of_a_missing_package() {
        let (_root, manager) = scripted_manager(
            "if [ \"$2\" = --global ]; then\nprintf '%s\\n' 'tlmgr: <html>not json</html>'\nexit 0\nfi\nprintf '%s\\n' '{\"packages\":{},\"files\":{}}'",
        );
        let error = install_missing_at(&manager, vec!["tikz.sty".into()])
            .await
            .unwrap_err();
        assert!(
            error.contains("Could not read the TeX Live search results"),
            "{error}"
        );
        assert!(!error.contains("original template"), "{error}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_package_flow_that_outlasts_its_budget_is_stopped_and_says_so() {
        let (_root, manager) = scripted_manager("sleep 30");
        let error = within_flow_budget(
            std::time::Duration::from_millis(150),
            install_missing_at(&manager, vec!["tikz.sty".into()]),
        )
        .await
        .unwrap_err();
        assert!(error.contains("tex.package_operation_timeout"), "{error}");
        assert!(flow_budget_message(TLMGR_FLOW_BUDGET).contains("15 minutes"));
    }

    #[test]
    fn the_cross_release_notice_is_only_read_from_a_real_mismatch() {
        let mismatch = TexUtilityOutput {
            success: false,
            stdout: String::new(),
            stderr: CROSS_RELEASE_FIXTURE.into(),
        };
        assert!(cross_release_error(&mismatch)
            .unwrap()
            .contains("Your TeX Live (2025) is older than the package repository (2026)."));
        let unrelated = TexUtilityOutput {
            success: false,
            stdout: "Local TeX Live (2025) is fine".into(),
            stderr: String::new(),
        };
        assert!(cross_release_error(&unrelated).is_none());
        let unparsed = TexUtilityOutput {
            success: false,
            stdout: "Local TeX Live (rolling) is older than remote repository (next)".into(),
            stderr: String::new(),
        };
        assert!(cross_release_error(&unparsed)
            .unwrap()
            .starts_with("Your TeX Live is older than the package repository"));
    }

    const CROSS_RELEASE_FIXTURE: &str = "tlmgr: Local TeX Live (2025) is older than remote repository (2026). Cross release updates are only supported with update-tlmgr-latest(.sh/.exe) --update";

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
        assert!(calls.starts_with("search\n--json\n--file\n--\n"));
        assert!(!calls.contains("--global"));
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
