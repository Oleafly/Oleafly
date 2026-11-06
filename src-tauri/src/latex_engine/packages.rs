use super::{
    acquire_tex_runtime_read, acquire_tex_runtime_write, check_tlmgr_self_update, run_tex_utility,
    tlmgr_is_managed, tlmgr_path, tlmgr_run_at, tlmgr_wants_self_update, validate_package_names,
    within_flow_budget, AppState, PackageMutation, Path, TexUtilityOutput, TinytexMutationGuard,
    TLMGR_FLOW_BUDGET, TLMGR_INFO_TIMEOUT, TLMGR_REPOSITORY_TIMEOUT,
};
use crate::app_error::AppError;
use std::collections::{BTreeMap, BTreeSet};

const ARCHIVED_REPOSITORY_ROOT: &str = "https://ftp.math.utah.edu/pub/tex/historic/systems/texlive";
const INSTALLABLE_EXTENSIONS: [&str; 16] = [
    "sty", "cls", "clo", "def", "fd", "ldf", "bbx", "cbx", "lbx", "bst", "tfm", "vf", "pfb", "otf",
    "ttf", "ttc",
];
const TIKZ_LIBRARY_SUFFIX: &str = ".code.tex";
const PROVIDER_ROOTS: [&str; 3] = ["texmf-dist/tex/", "texmf-dist/bibtex/", "texmf-dist/fonts/"];

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

fn is_installable_file(file: &str) -> bool {
    file.to_ascii_lowercase().ends_with(TIKZ_LIBRARY_SUFFIX)
        || file.rsplit_once('.').is_some_and(|(_, extension)| {
            INSTALLABLE_EXTENSIONS
                .iter()
                .any(|known| extension.eq_ignore_ascii_case(known))
        })
}

fn validate_files(files: &[String]) -> Result<(), String> {
    if files.is_empty() || files.len() > 8 {
        return Err(AppError::new("tex.missing_files_count").into());
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
            || !is_installable_file(file)
        {
            return Err(AppError::new("tex.invalid_package_file")
                .param("file", file)
                .into());
        }
    }
    Ok(())
}

impl SearchResult {
    fn is_empty(&self) -> bool {
        self.packages.is_empty() && self.files.is_empty()
    }
}

pub(super) fn with_repository(args: &[String], repository: Option<&str>) -> Vec<String> {
    let mut command = args.to_vec();
    if let Some(repository) = repository {
        let at = command
            .iter()
            .position(|arg| arg == "--")
            .unwrap_or(command.len());
        command.splice(at..at, ["--repository".to_string(), repository.to_string()]);
    }
    command
}

async fn run_search(
    tlmgr: &str,
    pattern: &str,
    files: bool,
    global: bool,
    repository: Option<&str>,
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
    let timeout = if global {
        TLMGR_REPOSITORY_TIMEOUT
    } else {
        TLMGR_INFO_TIMEOUT
    };
    run_tex_utility(
        Path::new(tlmgr),
        &with_repository(&args, repository),
        timeout,
    )
    .await
    .map_err(|error| match global && is_utility_timeout(&error) {
        true => repository_timed_out(repository),
        false => error,
    })
}

pub(super) fn configured_repository(tlmgr: &str) -> Option<String> {
    oleafly_core::download_sources::tex_repository(tlmgr_is_managed(tlmgr))
}

fn is_utility_timeout(error: &str) -> bool {
    error.contains(" timed out after ") && error.ends_with(" and was stopped")
}

pub(super) fn repository_timed_out(repository: Option<&str>) -> String {
    match repository.and_then(oleafly_core::download_sources::host_of) {
        Some(host) => AppError::new("tex.repository_timed_out")
            .param("host", host)
            .into(),
        None => AppError::new("tex.repository_timed_out_default").into(),
    }
}

fn cross_release_years(output: &TexUtilityOutput) -> Option<Vec<String>> {
    let text = format!("{}\n{}", output.stdout, output.stderr);
    let start = text.find("Local TeX Live (")?;
    let rest = &text[start..];
    if !rest.contains("is older than remote repository") {
        return None;
    }
    Some(
        rest.split('(')
            .skip(1)
            .filter_map(|chunk| chunk.split_once(')'))
            .map(|(year, _)| year.trim().to_string())
            .filter(|year| year.len() == 4 && year.chars().all(|c| c.is_ascii_digit()))
            .take(2)
            .collect(),
    )
}

fn is_cross_release_refusal(output: &TexUtilityOutput) -> bool {
    cross_release_years(output).is_some()
}

pub(super) fn cross_release_refusal(output: &TexUtilityOutput, managed: bool) -> Option<String> {
    let years = cross_release_years(output)?;
    Some(match (managed, years.as_slice()) {
        (true, [local, remote]) => AppError::new("tex.managed_tinytex_outdated")
            .param("local", local)
            .param("remote", remote)
            .into(),
        (false, [local, remote]) => AppError::new("tex.texlive_older_than_repository")
            .param("local", local)
            .param("remote", remote)
            .into(),
        _ => AppError::new("tex.texlive_release_mismatch").into(),
    })
}

pub(super) fn archived_repository(output: &TexUtilityOutput) -> Option<String> {
    let years = cross_release_years(output)?;
    let local = years.first()?;
    Some(format!("{ARCHIVED_REPOSITORY_ROOT}/{local}/tlnet-final"))
}

pub(super) fn system_manager_error(manager: &str) -> String {
    AppError::new("tex.packages_use_system_manager")
        .param("manager", manager)
        .into()
}

pub(super) fn system_manager_refusal(output: &TexUtilityOutput) -> Option<String> {
    let text = format!("{}\n{}", output.stdout, output.stderr);
    if text.contains("destroy the Fedora TeXLive install") {
        return Some(system_manager_error("dnf"));
    }
    (text.contains("running on Debian, switching to user mode")
        && text.contains("user mode not initialized"))
    .then(|| system_manager_error("apt"))
}

async fn search_with_archive(
    tlmgr: &str,
    pattern: &str,
    files: bool,
    global: bool,
) -> Result<TexUtilityOutput, String> {
    let configured = configured_repository(tlmgr);
    let output = run_search(tlmgr, pattern, files, global, configured.as_deref()).await?;
    check_tlmgr_self_update(tlmgr, &output)?;
    if let Some(error) = system_manager_refusal(&output) {
        return Err(error);
    }
    let Some(refusal) = cross_release_refusal(&output, tlmgr_is_managed(tlmgr)) else {
        return Ok(output);
    };
    if let Some(repository) = archived_repository(&output) {
        let archived = run_search(tlmgr, pattern, files, global, Some(&repository)).await?;
        if archived.success
            && !is_cross_release_refusal(&archived)
            && !tlmgr_wants_self_update(&archived)
        {
            return Ok(archived);
        }
    }
    Err(refusal)
}

async fn search_at(
    tlmgr: &str,
    pattern: String,
    files: bool,
    complete: impl Fn(&SearchResult) -> bool,
) -> Result<SearchResult, String> {
    let local = search_with_archive(tlmgr, &pattern, files, false).await?;
    if !local.success {
        return Err(package_command_error(&local, "Could not search TeX Live."));
    }
    let result = parse_search_result(&local.stdout)?;
    if complete(&result) {
        return Ok(result);
    }
    let global = search_with_archive(tlmgr, &pattern, files, true).await?;
    if !global.success {
        return Err(package_command_error(
            &global,
            "Could not reach the TeX Live package repository.",
        ));
    }
    parse_search_result(&global.stdout)
}

fn parse_plain_file_search(stdout: &str) -> Option<SearchResult> {
    let mut files: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut owner: Option<String> = None;
    for line in stdout.lines() {
        if let Some(path) = line.strip_prefix('\t') {
            files
                .get_mut(owner.as_ref()?)?
                .push(path.trim().to_string());
        } else if let Some(name) = line.trim_end().strip_suffix(':') {
            files.entry(name.to_string()).or_default();
            owner = Some(name.to_string());
        } else if !(line.trim().is_empty()
            || line.starts_with('(')
            || line.starts_with("tlmgr: package repository"))
        {
            return None;
        }
    }
    Some(SearchResult {
        packages: BTreeMap::new(),
        files,
    })
}

fn parse_search_result(stdout: &str) -> Result<SearchResult, String> {
    let Some(start) = stdout.find('{') else {
        if let Some(result) = parse_plain_file_search(stdout) {
            return Ok(result);
        }
        return serde_json::from_str(stdout)
            .map_err(|error| format!("Could not read the TeX Live search results: {error}"));
    };
    serde_json::from_str(&stdout[start..])
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
    let result = search_at(&tlmgr, literal_pattern(query), false, |result| {
        !result.is_empty()
    })
    .await?;
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

fn file_providers(result: &SearchResult, file: &str) -> Vec<String> {
    result
        .files
        .iter()
        .filter(|(name, paths)| {
            validate_package_names(std::slice::from_ref(name)).is_ok()
                && paths.iter().any(|path| {
                    PROVIDER_ROOTS.iter().any(|root| path.starts_with(root))
                        && !path.starts_with("texmf-dist/tex/latex-dev/")
                        && path.rsplit('/').next() == Some(file)
                })
        })
        .map(|(name, _)| name.clone())
        .collect()
}

fn resolve_providers(result: SearchResult, files: &[String]) -> Result<Vec<String>, String> {
    let mut packages = BTreeSet::new();
    for file in files {
        let providers = file_providers(&result, file);
        match providers.as_slice() {
            [name] => {
                packages.insert(name.clone());
            }
            [] => {
                return Err(AppError::new("tex.package_no_provider")
                    .param("file", file)
                    .into())
            }
            _ => {
                return Err(AppError::new("tex.package_several_providers")
                    .param("file", file)
                    .param("packages", providers.join(", "))
                    .into())
            }
        }
    }
    Ok(packages.into_iter().collect())
}

async fn file_is_visible(kpsewhich: &Path, file: &str) -> bool {
    run_tex_utility(kpsewhich, &[file.to_string()], TLMGR_INFO_TIMEOUT)
        .await
        .map_or(true, |output| !output.stdout.trim().is_empty())
}

async fn confirm_files_arrived(tlmgr: &str, files: &[String]) -> Result<(), String> {
    let Some(kpsewhich) = Path::new(tlmgr)
        .parent()
        .and_then(|dir| crate::tex_distro::find_tool_in_dir(dir, "kpsewhich"))
    else {
        return Ok(());
    };
    let mut absent = Vec::new();
    for file in files {
        if !file_is_visible(&kpsewhich, file).await {
            absent.push(file.as_str());
        }
    }
    if absent.is_empty() {
        return Ok(());
    }
    Err(AppError::new("tex.package_install_had_no_effect")
        .param("files", absent.join(", "))
        .into())
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
    let result = search_at(tlmgr, pattern, true, |result| {
        files
            .iter()
            .all(|file| !file_providers(result, file).is_empty())
    })
    .await?;
    let packages = resolve_providers(result, &files)?;
    let outcome = tlmgr_run_at(tlmgr, "install", packages).await?;
    confirm_files_arrived(tlmgr, &files).await?;
    Ok(outcome)
}

#[tauri::command]
pub async fn tlmgr_install_missing(
    state: tauri::State<'_, AppState>,
    files: Vec<String>,
) -> Result<String, String> {
    validate_files(&files)?;
    let _mutation = TinytexMutationGuard::acquire_maintenance()?;
    let _quit_gate = PackageMutation::start();
    let _compile = state.compile_lock.lock().await;
    let _figure_compile = state.figure_compile_lock.lock().await;
    let _runtime = acquire_tex_runtime_write()?;
    let tlmgr = tlmgr_path()?;
    within_flow_budget(TLMGR_FLOW_BUDGET, install_missing_at(&tlmgr, files)).await
}

#[cfg(test)]
mod tests {
    use super::{
        archived_repository, cross_release_refusal, cross_release_years, is_cross_release_refusal,
        is_utility_timeout, literal_pattern, package_command_error, parse_search_result,
        repository_timed_out, resolve_providers, search_packages, validate_files, with_repository,
        SearchResult, TexUtilityOutput,
    };
    #[cfg(unix)]
    use super::{install_missing_at, within_flow_budget, TLMGR_FLOW_BUDGET};
    #[cfg(unix)]
    use crate::latex_engine::flow_budget_message;

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
        let shown = |error: String| crate::app_error::english(&error).unwrap_or(error);
        assert!(
            shown(resolve_providers(results(serde_json::json!({})), &files).unwrap_err())
                .contains("original template")
        );
        let result = results(
            serde_json::json!({"a": ["texmf-dist/tex/latex/a/thesis.cls"], "b": ["texmf-dist/tex/latex/b/thesis.cls"]}),
        );
        assert!(shown(resolve_providers(result, &files).unwrap_err()).contains("Several"));
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
        let root = tempfile::tempdir().unwrap();
        let script = root.path().join("tlmgr");
        let calls = root.path().join("calls");
        let contents = format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" >> '{}'\n{body}\n",
            calls.display()
        );
        crate::latex_engine::tests::write_test_script(&script, &contents);
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
    async fn self_update_refusals_stop_missing_file_installation_at_each_stage() {
        for stage in ["local", "global", "install"] {
            let (root, manager) = scripted_manager(&format!(
                "if [ '{stage}' = local ] || [ '{stage}' = global -a \"$2\" = --global ] || [ \"$1\" = install ]; then\necho 'tlmgr itself needs to be updated' >&2\nexit 0\nfi\nif [ '{stage}' = install ]; then\nprintf '%s\\n' '{{\"packages\":{{}},\"files\":{{\"pgf\":[\"texmf-dist/tex/latex/pgf/tikz.sty\"]}}}}'\nelse\nprintf '%s\\n' '{{\"packages\":{{}},\"files\":{{}}}}'\nfi"
            ));
            let error = install_missing_at(&manager, vec!["tikz.sty".into()])
                .await
                .unwrap_err();
            assert!(
                error.contains("tlmgr itself needs to be updated"),
                "{error}"
            );
            assert!(error.contains("tlmgr update --self"), "{error}");
            let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
            let local = "search\n--json\n--file\n--\n(^|/)(tikz\\.sty)$\n";
            let expected = match stage {
                "local" => local.to_string(),
                "global" => {
                    format!("{local}search\n--global\n--json\n--file\n--\n(^|/)(tikz\\.sty)$\n")
                }
                _ => format!("{local}install\n--\npgf\n"),
            };
            assert_eq!(calls, expected);
        }
    }

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
        let shown = crate::app_error::english(&error).unwrap_or_default();
        assert!(shown.contains("TeX Live 2025"), "{error}");
        assert!(shown.contains("2026 repository"), "{error}");
        assert!(shown.contains("Update TeX Live"), "{error}");
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
        assert!(
            crate::app_error::english(&error).is_some_and(|text| text.contains("Update TeX Live")),
            "{error}"
        );
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
        assert!(is_cross_release_refusal(&mismatch));
        assert_eq!(
            cross_release_years(&mismatch).unwrap(),
            vec!["2025".to_string(), "2026".to_string()]
        );
        let unrelated = TexUtilityOutput {
            success: false,
            stdout: "Local TeX Live (2025) is fine".into(),
            stderr: String::new(),
        };
        assert!(!is_cross_release_refusal(&unrelated));
        let unparsed = TexUtilityOutput {
            success: false,
            stdout: "Local TeX Live (rolling) is older than remote repository (next)".into(),
            stderr: String::new(),
        };
        assert!(is_cross_release_refusal(&unparsed));
        assert_eq!(
            cross_release_years(&unparsed).unwrap(),
            Vec::<String>::new()
        );
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

    #[test]
    fn the_installable_extensions_cover_every_kind_of_missing_tex_file() {
        for file in [
            "t1foo.fd",
            "uwmj31.tfm",
            "pdftex.def",
            "ngerman.ldf",
            "size14.clo",
            "apa.bbx",
            "apa.cbx",
            "IEEEtran.bst",
            "fandol.otf",
            "FontName-Regular.TTF",
            "tikzlibraryquantikz2.code.tex",
        ] {
            assert!(validate_files(&[file.into()]).is_ok(), "{file}");
        }
        for file in [
            "main.tex",
            "refs.bib",
            "figure.pdf",
            "notes.code",
            "code.tex",
        ] {
            assert!(validate_files(&[file.into()]).is_err(), "{file}");
        }
    }

    #[test]
    fn older_tlmgr_plain_file_results_are_read_like_json() {
        let stdout = "(running on Debian, switching to user mode!)\n(see /usr/share/doc/texlive-base/README.tlmgr-on-Debian.md)\ntlmgr: package repository https://example.test (not verified)\ncjk:\n\ttexmf-dist/tex/latex/cjk/texinput/CJKutf8.sty\n";
        let result = parse_search_result(stdout).unwrap();
        assert_eq!(
            resolve_providers(result, &["CJKutf8.sty".to_string()]).unwrap(),
            ["cjk"]
        );
        let empty = parse_search_result("(running on Debian, switching to user mode!)\n").unwrap();
        assert!(empty.is_empty());
        assert!(parse_search_result("").unwrap().is_empty());
        for unreadable in ["\ttexmf-dist/orphan.sty\n", "tlmgr: mirror failed\n"] {
            assert!(parse_search_result(unreadable).is_err(), "{unreadable}");
        }
    }

    #[test]
    fn invalid_file_lists_are_coded_for_translation() {
        let none = validate_files(&[]).unwrap_err();
        assert!(none.contains("tex.missing_files_count"), "{none}");
        let bad = validate_files(&["main.tex".into()]).unwrap_err();
        assert!(bad.contains("tex.invalid_package_file"), "{bad}");
        assert!(bad.contains("main.tex"), "{bad}");
    }

    #[test]
    fn providers_are_found_outside_tex_but_documentation_copies_never_count() {
        let result = results(serde_json::json!({
            "ieeetran": ["texmf-dist/bibtex/bst/ieeetran/IEEEtran.bst"],
            "confproc": ["texmf-dist/doc/latex/confproc/example/IEEEtran.bst"],
            "uhc": ["texmf-dist/fonts/tfm/uhc/umj/uwmj31.tfm"],
            "biblatex-apa": ["texmf-dist/tex/latex/biblatex-apa/apa.bbx"],
            "fandol": ["texmf-dist/fonts/opentype/public/fandol/FandolSong-Regular.otf"]
        }));
        let files = [
            "IEEEtran.bst",
            "uwmj31.tfm",
            "apa.bbx",
            "FandolSong-Regular.otf",
        ]
        .map(String::from);
        assert_eq!(
            resolve_providers(result, &files).unwrap(),
            ["biblatex-apa", "fandol", "ieeetran", "uhc"]
        );
    }

    #[test]
    fn provider_failures_are_coded_and_keep_the_file_name() {
        let files = ["thesis.cls".into()];
        let none = resolve_providers(results(serde_json::json!({})), &files).unwrap_err();
        assert!(
            none.contains("\"code\":\"tex.package_no_provider\""),
            "{none}"
        );
        assert!(none.contains("\"file\":\"thesis.cls\""), "{none}");
        let result = results(serde_json::json!({
            "a": ["texmf-dist/tex/latex/a/thesis.cls"],
            "b": ["texmf-dist/tex/latex/b/thesis.cls"]
        }));
        let several = resolve_providers(result, &files).unwrap_err();
        assert!(
            several.contains("\"code\":\"tex.package_several_providers\""),
            "{several}"
        );
        assert!(several.contains("\"packages\":\"a, b\""), "{several}");
    }

    #[test]
    fn a_repository_search_that_runs_out_of_time_names_the_host() {
        let named = repository_timed_out(Some("https://mirror.ctan.org/systems/texlive/tlnet"));
        assert!(named.contains("\"tex.repository_timed_out\""), "{named}");
        assert!(named.contains("mirror.ctan.org"), "{named}");
        let unnamed = repository_timed_out(None);
        assert!(
            unnamed.contains("\"tex.repository_timed_out_default\""),
            "{unnamed}"
        );
        assert!(is_utility_timeout(
            "/opt/TinyTeX/bin/tlmgr timed out after 600 seconds and was stopped"
        ));
        assert!(!is_utility_timeout("tlmgr: cannot reach the repository"));
    }

    #[test]
    fn repository_arguments_stay_ahead_of_the_operands() {
        let args = ["install", "--", "cjk"].map(String::from);
        assert_eq!(with_repository(&args, None), args);
        assert_eq!(
            with_repository(&args, Some("https://example.test")),
            [
                "install",
                "--repository",
                "https://example.test",
                "--",
                "cjk"
            ]
        );
        let update = ["update", "--self"].map(String::from);
        assert_eq!(
            with_repository(&update, Some("https://example.test")),
            ["update", "--self", "--repository", "https://example.test"]
        );
    }

    #[test]
    fn the_release_gap_is_coded_for_each_kind_of_tree() {
        let refused = TexUtilityOutput {
            success: false,
            stdout: String::new(),
            stderr: CROSS_RELEASE_FIXTURE.into(),
        };
        let managed = cross_release_refusal(&refused, true).unwrap();
        assert!(
            managed.contains("tex.managed_tinytex_outdated"),
            "{managed}"
        );
        assert!(managed.contains("\"local\":\"2025\""), "{managed}");
        let system = cross_release_refusal(&refused, false).unwrap();
        assert!(
            system.contains("tex.texlive_older_than_repository"),
            "{system}"
        );
        assert!(system.contains("\"remote\":\"2026\""), "{system}");
        assert_eq!(
            archived_repository(&refused).as_deref(),
            Some("https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2025/tlnet-final")
        );
        let unparsed = TexUtilityOutput {
            success: false,
            stdout: "Local TeX Live (rolling) is older than remote repository (next)".into(),
            stderr: String::new(),
        };
        assert!(cross_release_refusal(&unparsed, true)
            .unwrap()
            .contains("tex.texlive_release_mismatch"));
        assert_eq!(archived_repository(&unparsed), None);
        let unrelated = TexUtilityOutput {
            success: false,
            stdout: "tlmgr: package not present".into(),
            stderr: String::new(),
        };
        assert_eq!(cross_release_refusal(&unrelated, true), None);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_refused_global_search_is_retried_against_the_frozen_repository() {
        let (root, manager) = scripted_manager(&format!(
            "case \"$*\" in\n*--global*--repository*) printf '%s\\n' '{{\"packages\":{{}},\"files\":{{\"pgf\":[\"texmf-dist/tex/latex/pgf/tikz.sty\"]}}}}'\nexit 0 ;;\n*--global*) echo '{CROSS_RELEASE}' >&2\nexit 1 ;;\nsearch*) printf '%s\\n' '{{\"packages\":{{}},\"files\":{{}}}}'\nexit 0 ;;\nesac\ncase \"$*\" in\n*--repository*) printf 'Installed\\n' ;;\n*) echo '{CROSS_RELEASE}' >&2\nexit 1 ;;\nesac"
        ));
        install_missing_at(&manager, vec!["tikz.sty".into()])
            .await
            .unwrap();
        let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
        let archive =
            "--repository\nhttps://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2025/tlnet-final\n";
        assert!(
            calls.contains(&format!("search\n--global\n--json\n--file\n{archive}--\n")),
            "{calls}"
        );
        assert!(
            calls.ends_with(&format!("install\n{archive}--\npgf\n")),
            "{calls}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_debian_search_refusal_points_at_the_system_package_manager() {
        let (root, manager) = scripted_manager(
            "echo '(running on Debian, switching to user mode!)'\necho 'tlmgr: user mode not initialized, please read the documentation!' >&2\nexit 2",
        );
        let error = install_missing_at(&manager, vec!["tikz.sty".into()])
            .await
            .unwrap_err();
        assert!(error.contains("tex.packages_use_system_manager"), "{error}");
        assert!(error.contains("\"manager\":\"apt\""), "{error}");
        assert!(!std::fs::read_to_string(root.path().join("calls"))
            .unwrap()
            .contains("install\n"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_local_result_for_some_files_still_searches_the_repository_for_the_rest() {
        let (root, manager) = scripted_manager(
            "if [ \"$1\" = search ]; then\nif [ \"$2\" = --global ]; then\nprintf '%s\\n' '{\"packages\":{},\"files\":{\"psnfss\":[\"texmf-dist/tex/latex/psnfss/t1put.fd\"],\"utopia\":[\"texmf-dist/fonts/tfm/adobe/utopia/putr8t.tfm\"]}}'\nelse\nprintf '%s\\n' '{\"packages\":{},\"files\":{\"psnfss\":[\"texmf-dist/tex/latex/psnfss/t1put.fd\"]}}'\nfi\nelse\nprintf 'Installed\\n'\nfi",
        );
        install_missing_at(&manager, vec!["t1put.fd".into(), "putr8t.tfm".into()])
            .await
            .unwrap();
        let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
        assert!(
            calls.contains("search\n--global\n--json\n--file\n--\n"),
            "{calls}"
        );
        assert!(calls.ends_with("install\n--\npsnfss\nutopia\n"), "{calls}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_local_result_for_every_file_never_reaches_the_repository() {
        let (root, manager) = fake_manager(
            r#"{"packages":{},"files":{"pgf":["texmf-dist/tex/latex/pgf/tikz.sty"]}}"#,
        );
        install_missing_at(&manager, vec!["tikz.sty".into()])
            .await
            .unwrap();
        let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
        assert!(!calls.contains("--global"), "{calls}");
    }

    #[cfg(unix)]
    fn manager_with_kpsewhich(answer: &str) -> (tempfile::TempDir, String) {
        let (root, manager) = fake_manager(
            r#"{"packages":{},"files":{"pgf":["texmf-dist/tex/latex/pgf/tikz.sty"]}}"#,
        );
        crate::latex_engine::tests::write_test_script(
            &root.path().join("kpsewhich"),
            &format!("#!/bin/sh\n{answer}\n"),
        );
        (root, manager)
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn an_install_that_leaves_the_file_missing_is_reported() {
        let (_root, manager) = manager_with_kpsewhich("exit 1");
        let error = install_missing_at(&manager, vec!["tikz.sty".into()])
            .await
            .unwrap_err();
        assert!(
            error.contains("tex.package_install_had_no_effect"),
            "{error}"
        );
        assert!(error.contains("tikz.sty"), "{error}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn an_install_is_confirmed_by_the_distribution_it_changed() {
        let (root, manager) = manager_with_kpsewhich("printf '%s\\n' \"/tex/$1\"");
        install_missing_at(&manager, vec!["tikz.sty".into()])
            .await
            .unwrap();
        assert!(std::fs::read_to_string(root.path().join("calls"))
            .unwrap()
            .ends_with("install\n--\npgf\n"));
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
