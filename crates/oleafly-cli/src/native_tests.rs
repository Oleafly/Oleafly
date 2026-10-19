use super::*;
use oleafly_core::{InitOptions, ProjectManifest};
use std::sync::Mutex;
use tempfile::TempDir;

fn workspace_for_engine(
    directory: &TempDir,
    engine: Engine,
    tex_flavor: Option<&str>,
) -> Workspace {
    let main_document = engine.default_main_document();
    std::fs::write(directory.path().join(main_document), "document").unwrap();
    Workspace::from_manifest(
        directory.path(),
        ProjectManifest {
            name: "Compiler contract".into(),
            main_doc: main_document.into(),
            engine: engine.manifest_name().into(),
            tex_flavor: tex_flavor.map(str::to_string),
            ..ProjectManifest::default()
        },
    )
    .unwrap()
}

fn arguments(command: &BuildCommand) -> Vec<String> {
    command
        .arguments
        .iter()
        .map(|value| value.to_string_lossy().into_owned())
        .collect()
}

/// Arguments without the per-build staging folder.
fn stable_arguments(command: &BuildCommand) -> Vec<String> {
    arguments(command)
        .into_iter()
        .filter(|argument| !argument.contains(".oleafly-staging-"))
        .collect()
}

fn environment(command: &BuildCommand) -> BTreeMap<&'static str, String> {
    command
        .environment
        .iter()
        .map(|(name, value)| (*name, value.to_string_lossy().into_owned()))
        .collect()
}

fn temp_environment(command: &BuildCommand) -> Vec<(&'static str, OsString)> {
    command
        .environment
        .iter()
        .filter(|(name, _)| TEMP_DIRECTORY_VARIABLES.contains(name))
        .cloned()
        .collect()
}

fn compiler_fixture(directory: &TempDir, failure: bool) -> PathBuf {
    crate::support::compiler_fixture(directory.path(), failure)
}

fn launch<'a>(
    executable: &'a Path,
    arguments: &'a [OsString],
    working_directory: &'a Path,
    environment: &'a [(&'static str, OsString)],
) -> Launch<'a> {
    Launch {
        executable,
        arguments,
        working_directory,
        environment,
        unset: &[],
        variables: &[],
    }
}

#[tokio::test]
async fn compiler_output_keeps_characters_split_between_reads() {
    let text = "kapitoly/úvod.typ:1:9: error: x";
    let bytes = text.as_bytes();
    let cut = text.find('ú').unwrap() + 1;
    let emitted = Arc::new(Mutex::new(String::new()));
    let sink_emitted = emitted.clone();
    let sink = CompilerLog::new(move |chunk| sink_emitted.lock().unwrap().push_str(chunk));
    let output = read_stream((&bytes[..cut]).chain(&bytes[cut..]), sink)
        .await
        .unwrap();
    assert_eq!(output, text);
    assert_eq!(*emitted.lock().unwrap(), text);
}

#[test]
fn build_options_name_the_flags_each_engine_ignores() {
    let none = BuildOptions::default();
    let all = BuildOptions {
        offline: true,
        fast: true,
        halt_on_error: true,
    };
    let every_flag = vec!["--offline", "--fast", "--halt-on-error"];
    for engine in [
        Engine::Tectonic,
        Engine::Latexmk,
        Engine::Typst,
        Engine::Markdown,
    ] {
        assert!(ignored_flags(none, engine).is_empty());
    }
    assert!(ignored_flags(all, Engine::Tectonic).is_empty());
    assert_eq!(ignored_flags(all, Engine::Latexmk), vec!["--fast"]);
    assert_eq!(
        ignored_flags(all, Engine::Typst),
        vec!["--fast", "--halt-on-error"]
    );
    assert_eq!(ignored_flags(all, Engine::Markdown), every_flag);
    let offline_only = BuildOptions {
        offline: true,
        ..BuildOptions::default()
    };
    assert!(ignored_flags(offline_only, Engine::Typst).is_empty());
    assert_eq!(
        ignored_flags(offline_only, Engine::Markdown),
        vec!["--offline"]
    );
    assert!(ignored_flags(offline_only, Engine::Latexmk).is_empty());
}

#[test]
fn debug_build_records_the_compilation_target() {
    assert!(option_env!("OLEAFLY_BUILD_TARGET").is_some_and(|target| !target.is_empty()));
}

#[test]
fn output_fingerprint_includes_length_and_contents() {
    let directory = TempDir::new().unwrap();
    let first = directory.path().join("first.pdf");
    let second = directory.path().join("second.pdf");
    std::fs::write(&first, "one").unwrap();
    std::fs::write(&second, "two").unwrap();
    let first_id = fingerprint_file(&first).unwrap();
    let second_id = fingerprint_file(&second).unwrap();
    assert!(first_id.starts_with("pdf-sha256:3:"));
    assert_ne!(first_id, second_id);
}

#[test]
fn pandoc_engine_alias_uses_a_recognized_executable_name() {
    let directory = TempDir::new().unwrap();
    let source = directory.path().join(executable_name("tectonic-target"));
    std::fs::write(&source, "compiler").unwrap();
    let (path, alias) = pandoc_engine_path(&source).unwrap();
    assert_eq!(
        path.file_name().and_then(|value| value.to_str()),
        Some(executable_name("tectonic").as_str())
    );
    assert_eq!(std::fs::read(&path).unwrap(), b"compiler");
    let alias_directory = path.parent().unwrap().to_path_buf();
    drop(alias);
    assert!(!alias_directory.exists());
}

#[test]
fn latexmk_flavor_detects_unicode_documents() {
    let directory = TempDir::new().unwrap();
    let source = directory.path().join("main.tex");
    std::fs::write(&source, "\\usepackage{fontspec}").unwrap();
    assert_eq!(detect_latexmk_flavor(&source).unwrap(), TexFlavor::Xelatex);
}

#[test]
fn latexmk_flavor_honors_magic_comments_and_safe_default() {
    let directory = TempDir::new().unwrap();
    let source = directory.path().join("main.tex");
    for (content, expected) in [
        ("% !TeX program = xelatex", TexFlavor::Xelatex),
        ("% !TeX engine = lualatex", TexFlavor::Lualatex),
        ("% !TeX program = pdflatex", TexFlavor::Pdflatex),
        ("% !TeX program = uplatex", TexFlavor::Uplatex),
        ("% !TeX program = platex", TexFlavor::Platex),
        ("\\documentclass[uplatex]{jsarticle}", TexFlavor::Uplatex),
        ("\\documentclass{article}", TexFlavor::Pdflatex),
    ] {
        std::fs::write(&source, content).unwrap();
        assert_eq!(detect_latexmk_flavor(&source).unwrap(), expected);
    }
}

#[cfg(unix)]
#[test]
fn latexmk_finds_bibliographies_in_a_folder_named_with_a_colon() {
    let tools_directory = TempDir::new().unwrap();
    let latexmk = tools_directory.path().join(executable_name("latexmk"));
    std::fs::write(&latexmk, "tool").unwrap();
    let compiler = NativeCompiler::new(BuildTools {
        latexmk: Some(latexmk),
        ..BuildTools::default()
    });
    let parent = TempDir::new().unwrap();
    let search_paths = |folder: &str| -> BTreeMap<&'static str, String> {
        let project = parent.path().join(folder);
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("main.tex"), "document").unwrap();
        let workspace = Workspace::from_manifest(
            &project,
            ProjectManifest {
                name: folder.into(),
                main_doc: "main.tex".into(),
                engine: Engine::Latexmk.manifest_name().into(),
                ..ProjectManifest::default()
            },
        )
        .unwrap();
        let build = workspace.prepare_build().unwrap();
        environment(
            &compiler
                .command(&build, BuildOptions::default(), true)
                .unwrap(),
        )
        .into_iter()
        .filter(|(name, _)| oleafly_core::BIBTEX_SEARCH_VARIABLES.contains(name))
        .collect()
    };
    let colon = search_paths("Thesis 2024:25");
    for name in oleafly_core::BIBTEX_SEARCH_VARIABLES {
        assert!(colon[name].starts_with("../..:"), "{name} {colon:?}");
    }
    assert!(search_paths("Thesis 2024-25").is_empty());
}

#[test]
fn compiler_commands_preserve_every_engine_contract() {
    let tools_directory = TempDir::new().unwrap();
    let tectonic = tools_directory.path().join(executable_name("tectonic"));
    let latexmk = tools_directory.path().join(executable_name("latexmk"));
    let typst = tools_directory.path().join(executable_name("typst"));
    let pandoc = tools_directory.path().join(executable_name("pandoc"));
    for tool in [&tectonic, &latexmk, &typst, &pandoc] {
        std::fs::write(tool, "tool").unwrap();
    }
    let tools = BuildTools {
        tectonic: Some(tectonic.clone()),
        latexmk: Some(latexmk.clone()),
        typst: Some(typst.clone()),
        pandoc: Some(pandoc.clone()),
        ..BuildTools::default()
    };
    let compiler = NativeCompiler::new(tools.clone());
    let options = BuildOptions {
        offline: true,
        fast: true,
        halt_on_error: true,
    };

    let tectonic_directory = TempDir::new().unwrap();
    let tectonic_workspace = workspace_for_engine(&tectonic_directory, Engine::Tectonic, None);
    let tectonic_build = tectonic_workspace.prepare_build().unwrap();
    let tectonic_command = compiler.command(&tectonic_build, options, true).unwrap();
    let tectonic_arguments = arguments(&tectonic_command);
    assert_eq!(tectonic_command.executable, tectonic);
    assert!(tectonic_arguments
        .windows(2)
        .any(|pair| pair == ["-X", "compile"]));
    assert!(tectonic_arguments
        .iter()
        .any(|value| value == "--only-cached"));
    assert!(tectonic_arguments
        .windows(2)
        .any(|pair| pair == ["--reruns", "0"]));
    assert!(!tectonic_arguments
        .iter()
        .any(|value| value == "continue-on-errors"));
    assert!(tectonic_command
        .produced_output
        .ends_with("_oleafly_entry.pdf"));

    let latexmk_directory = TempDir::new().unwrap();
    let latexmk_workspace =
        workspace_for_engine(&latexmk_directory, Engine::Latexmk, Some("lualatex"));
    let latexmk_build = latexmk_workspace.prepare_build().unwrap();
    let latexmk_command = compiler.command(&latexmk_build, options, true).unwrap();
    let latexmk_arguments = arguments(&latexmk_command);
    assert_eq!(latexmk_command.executable, latexmk);
    assert!(latexmk_arguments
        .iter()
        .any(|value| value == "-shell-restricted"));
    assert!(!latexmk_arguments
        .iter()
        .any(|value| value == "-shell-escape"));
    assert!(latexmk_arguments.iter().any(|value| value == "-lualatex"));
    assert!(latexmk_arguments
        .iter()
        .any(|value| value == "-halt-on-error"));
    assert!(latexmk_arguments
        .iter()
        .any(|value| value == "-latexoption=--nosocket"));
    assert!(latexmk_arguments
        .iter()
        .any(|value| value == "-jobname=_oleafly_entry"));

    let typst_directory = TempDir::new().unwrap();
    let typst_workspace = workspace_for_engine(&typst_directory, Engine::Typst, None);
    let typst_build = typst_workspace.prepare_build().unwrap();
    let typst_command = compiler.command(&typst_build, options, true).unwrap();
    let typst_arguments = arguments(&typst_command);
    assert_eq!(typst_command.executable, typst);
    assert_eq!(&typst_arguments[..2], ["--color=never", "compile"]);
    assert!(typst_arguments
        .windows(2)
        .any(|pair| pair == ["--diagnostic-format", "human"]));
    assert!(typst_command
        .produced_output
        .ends_with("_oleafly_entry.pdf"));

    let markdown_directory = TempDir::new().unwrap();
    let markdown_workspace = workspace_for_engine(&markdown_directory, Engine::Markdown, None);
    std::fs::create_dir(markdown_directory.path().join("references")).unwrap();
    std::fs::write(
        markdown_directory.path().join("references/library.bib"),
        "@book{source}",
    )
    .unwrap();
    std::fs::create_dir(markdown_directory.path().join("node_modules")).unwrap();
    std::fs::write(
        markdown_directory.path().join("node_modules/ignored.bib"),
        "@book{ignored}",
    )
    .unwrap();
    let markdown_build = markdown_workspace.prepare_build().unwrap();
    let markdown_command = compiler
        .command_with(
            &markdown_build,
            options,
            &injected_scratch_bases(markdown_directory.path(), markdown_build.build_directory()),
            true,
        )
        .unwrap();
    let markdown_arguments = arguments(&markdown_command);
    assert_eq!(markdown_command.executable, pandoc);
    assert!(markdown_arguments.iter().any(|value| value == "--citeproc"));
    let bibliography = plain_path(markdown_build.project_root())
        .join("references")
        .join("library.bib");
    assert!(markdown_arguments
        .iter()
        .any(|value| value == &format!("--bibliography={}", bibliography.display())));
    assert!(!markdown_arguments
        .iter()
        .any(|value| value.contains("ignored.bib")));
    assert!(markdown_arguments
        .iter()
        .any(|value| value == &format!("--pdf-engine={}", tectonic.display())));

    for engine in [
        Engine::Tectonic,
        Engine::Latexmk,
        Engine::Typst,
        Engine::Markdown,
    ] {
        assert_eq!(
            tools.for_engine(engine),
            match engine {
                Engine::Tectonic => Some(tectonic.as_path()),
                Engine::Latexmk => Some(latexmk.as_path()),
                Engine::Typst => Some(typst.as_path()),
                Engine::Markdown => Some(pandoc.as_path()),
            }
        );
    }
    assert_eq!(tools.required_for_engine(Engine::Tectonic).len(), 1);
    assert_eq!(tools.required_for_engine(Engine::Latexmk).len(), 1);
    assert_eq!(tools.required_for_engine(Engine::Typst).len(), 1);
    assert_eq!(tools.required_for_engine(Engine::Markdown).len(), 2);
}

#[test]
fn tectonic_builds_write_the_entry_shim_and_pin_the_bundle() {
    let tools_directory = TempDir::new().unwrap();
    let tectonic = tools_directory.path().join(executable_name("tectonic"));
    std::fs::write(&tectonic, "tool").unwrap();
    let compiler = NativeCompiler::new(BuildTools {
        tectonic: Some(tectonic),
        ..BuildTools::default()
    });
    let project = TempDir::new().unwrap();
    let build = workspace_for_engine(&project, Engine::Tectonic, None)
        .prepare_build()
        .unwrap();
    let command = compiler
        .command(&build, BuildOptions::default(), true)
        .unwrap();
    let pinned = arguments(&command);
    let position = pinned
        .iter()
        .position(|argument| argument == "--bundle")
        .unwrap();
    assert_eq!(pinned[position + 1], tex_bundle_url());
    let outdir = pinned
        .windows(2)
        .find(|pair| pair[0] == "--outdir")
        .map(|pair| PathBuf::from(&pair[1]))
        .unwrap();
    assert!(outdir.starts_with(build.build_directory()));
    assert!(outdir
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with(".oleafly-staging-"));
    let entry = build.build_directory().join(ENTRY_TEX);
    assert_eq!(PathBuf::from(pinned.last().unwrap()), entry);
    assert_eq!(
        std::fs::read_to_string(&entry).unwrap(),
        latex_entry_source("main.tex").unwrap()
    );
    assert!(command.bundle_pinned);
    let unpinned = compiler
        .command(&build, BuildOptions::default(), false)
        .unwrap();
    assert!(!arguments(&unpinned)
        .iter()
        .any(|argument| argument == "--bundle"));
    let staging = outdir.clone();
    drop(command);
    assert!(!staging.exists());
}

#[test]
fn nested_mains_search_the_compile_directory_first() {
    let tools_directory = TempDir::new().unwrap();
    let tectonic = tools_directory.path().join(executable_name("tectonic"));
    std::fs::write(&tectonic, "tool").unwrap();
    let compiler = NativeCompiler::new(BuildTools {
        tectonic: Some(tectonic),
        ..BuildTools::default()
    });
    let project = TempDir::new().unwrap();
    std::fs::create_dir(project.path().join("paper")).unwrap();
    std::fs::write(project.path().join("paper/main.tex"), "document").unwrap();
    let workspace = Workspace::from_manifest(
        project.path(),
        ProjectManifest {
            main_doc: "paper/main.tex".into(),
            engine: "tectonic".into(),
            compile_dir: Some("paper".into()),
            ..ProjectManifest::default()
        },
    )
    .unwrap();
    let build = workspace.prepare_build().unwrap();
    let arguments = arguments(
        &compiler
            .command(&build, BuildOptions::default(), true)
            .unwrap(),
    );
    let root = build.project_root().display().to_string();
    let nested = build.project_root().join("paper").display().to_string();
    let first = arguments
        .iter()
        .position(|argument| argument == &format!("search-path={nested}"))
        .unwrap();
    let second = arguments
        .iter()
        .position(|argument| argument == &format!("search-path={root}"))
        .unwrap();
    assert!(first < second);
}

#[test]
fn latexmk_uses_restricted_shell_escape_except_on_miktex() {
    assert_eq!(
        engine_spec::shell_escape_arg(false, "texlive"),
        "-shell-restricted"
    );
    assert_eq!(
        engine_spec::shell_escape_arg(false, "miktex"),
        "-no-shell-escape"
    );
    let tools_directory = TempDir::new().unwrap();
    let latexmk = tools_directory.path().join(executable_name("latexmk"));
    std::fs::write(&latexmk, "tool").unwrap();
    let compiler = NativeCompiler::new(BuildTools {
        latexmk: Some(latexmk),
        ..BuildTools::default()
    });
    let project = TempDir::new().unwrap();
    let build = workspace_for_engine(&project, Engine::Latexmk, Some("pdflatex"))
        .prepare_build()
        .unwrap();
    let arguments = arguments(
        &compiler
            .command(&build, BuildOptions::default(), true)
            .unwrap(),
    );
    assert!(
        !arguments.iter().any(|argument| argument == "-shell-escape"),
        "{arguments:?}"
    );
    assert!(arguments
        .iter()
        .any(|argument| argument == "-shell-restricted" || argument == "-no-shell-escape"));
}

#[test]
fn latexmk_rebuilds_from_scratch_after_a_tex_distribution_switch() {
    let tools_directory = TempDir::new().unwrap();
    let latexmk = tools_directory.path().join(executable_name("latexmk"));
    std::fs::write(&latexmk, "tool").unwrap();
    let compiler = NativeCompiler::new(BuildTools {
        latexmk: Some(latexmk.clone()),
        ..BuildTools::default()
    });
    let project = TempDir::new().unwrap();
    let build = workspace_for_engine(&project, Engine::Latexmk, Some("pdflatex"))
        .prepare_build()
        .unwrap();
    std::fs::write(
        build
            .build_directory()
            .join(engine_spec::LATEXMK_BINARY_MARKER),
        "/other/latexmk",
    )
    .unwrap();
    let first = arguments(
        &compiler
            .command(&build, BuildOptions::default(), true)
            .unwrap(),
    );
    assert_eq!(first[0], "-gg");
    engine_spec::record_latexmk_binary(build.build_directory(), &latexmk);
    let second = arguments(
        &compiler
            .command(&build, BuildOptions::default(), true)
            .unwrap(),
    );
    assert_ne!(second[0], "-gg");
}

#[test]
fn lualatex_runs_without_openin_paranoia() {
    let tools_directory = TempDir::new().unwrap();
    let latexmk = tools_directory.path().join(executable_name("latexmk"));
    std::fs::write(&latexmk, "tool").unwrap();
    let compiler = NativeCompiler::new(BuildTools {
        latexmk: Some(latexmk),
        ..BuildTools::default()
    });
    for (flavor, unset) in [("lualatex", true), ("xelatex", false), ("pdflatex", false)] {
        let project = TempDir::new().unwrap();
        let build = workspace_for_engine(&project, Engine::Latexmk, Some(flavor))
            .prepare_build()
            .unwrap();
        let command = compiler
            .command(&build, BuildOptions::default(), true)
            .unwrap();
        assert_eq!(command.unset.contains(&"openin_any"), unset, "{flavor}");
    }
}

#[test]
fn markdown_builds_sandbox_pandoc_and_add_the_mermaid_filter() {
    let tools_directory = TempDir::new().unwrap();
    let compiler = fake_markdown_compiler(tools_directory.path());
    let project = TempDir::new().unwrap();
    let build = workspace_for_engine(&project, Engine::Markdown, None)
        .prepare_build()
        .unwrap();
    let command = compiler
        .command_with(
            &build,
            BuildOptions::default(),
            &injected_scratch_bases(project.path(), build.build_directory()),
            true,
        )
        .unwrap();
    let arguments = arguments(&command);
    for expected in ["--sandbox", "--citeproc", "--pdf-engine-opt=--bundle"] {
        assert!(
            arguments.iter().any(|argument| argument == expected),
            "{expected} {arguments:?}"
        );
    }
    assert!(arguments
        .iter()
        .any(|argument| argument == &format!("--lua-filter={MERMAID_FIGURES_FILTER_NAME}")));
    assert_eq!(
        std::fs::read_to_string(command.working_directory.join(MERMAID_FIGURES_FILTER_NAME))
            .unwrap(),
        MERMAID_FIGURES_FILTER
    );
    assert!(command.bundle_pinned);
}

#[test]
fn discovery_prefers_the_cli_folder_then_the_app_then_path() {
    let cli = TempDir::new().unwrap();
    let app = TempDir::new().unwrap();
    let path_dir = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    let tool = |folder: &Path| {
        let path = folder.join(executable_name("tectonic"));
        std::fs::write(&path, "tool").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        path.canonicalize().unwrap()
    };
    let in_cli = tool(cli.path());
    let in_app = tool(app.path());
    let on_path = tool(path_dir.path());
    let local = tool(project.path());
    let discovery = Discovery {
        workspace_root: project.path().canonicalize().unwrap(),
        cli_dir: Some(cli.path().to_path_buf()),
        app: Some(InstalledApp {
            executable: app.path().join("oleafly"),
            bin_dir: app.path().to_path_buf(),
            resources_dir: None,
        }),
        path: Some(std::env::join_paths([project.path(), path_dir.path()]).unwrap()),
        ..Discovery::default()
    };
    let found = |discovery: &Discovery| BuildTools::discover_with(discovery).tectonic;
    assert_eq!(found(&discovery), Some(in_cli.clone()));
    std::fs::remove_file(&in_cli).unwrap();
    assert_eq!(found(&discovery), Some(in_app.clone()));
    std::fs::remove_file(&in_app).unwrap();
    assert_eq!(found(&discovery), Some(on_path.clone()));
    std::fs::remove_file(&on_path).unwrap();
    assert_eq!(
        found(&discovery),
        None,
        "the project-local {} must never be chosen",
        local.display()
    );
}

#[cfg(unix)]
#[test]
fn latexmk_comes_from_the_tex_search_not_beside_the_cli() {
    use std::os::unix::fs::PermissionsExt;
    let cli = TempDir::new().unwrap();
    let data = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    let make = |path: &Path| {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "tool").unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    };
    make(&cli.path().join("latexmk"));
    let discovery = Discovery {
        workspace_root: project.path().canonicalize().unwrap(),
        cli_dir: Some(cli.path().to_path_buf()),
        tex: TexSearch {
            data_root: Some(data.path().to_path_buf()),
            ..TexSearch::default()
        },
        ..Discovery::default()
    };
    // A TeX installed on this machine can be found; the copy beside the CLI
    // never is.
    let system = BuildTools::discover_with(&discovery).latexmk;
    assert_ne!(
        system,
        Some(cli.path().join("latexmk").canonicalize().unwrap())
    );
    let platform = oleafly_core::tex_distro::host_platform_dirs()[0];
    let managed = data
        .path()
        .join("tinytex")
        .join("bin")
        .join(platform)
        .join("latexmk");
    make(&managed);
    // The managed copy, unless a full TeX on this machine stays first.
    let chosen = BuildTools::discover_with(&discovery).latexmk;
    assert!(
        chosen == Some(managed.canonicalize().unwrap()) || (system.is_some() && chosen == system),
        "{chosen:?}"
    );
}

#[test]
fn the_tectonic_biber_beside_tectonic_is_recorded() {
    let tools = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    for name in ["tectonic", "tectonic-biber"] {
        let path = tools.path().join(executable_name(name));
        std::fs::write(&path, "tool").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
    let discovery = Discovery {
        workspace_root: project.path().canonicalize().unwrap(),
        cli_dir: Some(tools.path().to_path_buf()),
        ..Discovery::default()
    };
    let found = BuildTools::discover_with(&discovery);
    assert!(found.tectonic.is_some());
    assert_eq!(
        found
            .tectonic_biber
            .as_deref()
            .and_then(Path::file_name)
            .map(|name| name.to_string_lossy().into_owned()),
        Some(executable_name("tectonic-biber"))
    );
    assert_eq!(found.sources.get("tectonic"), Some(&"bundled"));
}

fn snapshot(root: &Path) -> Vec<(PathBuf, u64, Option<std::time::SystemTime>)> {
    fn visit(
        root: &Path,
        path: &Path,
        out: &mut Vec<(PathBuf, u64, Option<std::time::SystemTime>)>,
    ) {
        let metadata = std::fs::symlink_metadata(path).unwrap();
        out.push((
            path.strip_prefix(root).unwrap().to_path_buf(),
            metadata.len(),
            metadata.modified().ok(),
        ));
        if metadata.is_dir() {
            for entry in std::fs::read_dir(path).unwrap() {
                visit(root, &entry.unwrap().path(), out);
            }
        }
    }
    let mut out = Vec::new();
    visit(root, root, &mut out);
    out.sort();
    out
}

fn outside_the_build_directory(
    entries: Vec<(PathBuf, u64, Option<std::time::SystemTime>)>,
) -> Vec<(PathBuf, u64, Option<std::time::SystemTime>)> {
    entries
        .into_iter()
        .filter(|(path, _, _)| !path.starts_with(".oleafly"))
        .collect()
}

fn record(executable: &Path) -> BTreeMap<String, String> {
    std::fs::read_to_string(executable.with_extension("record"))
        .unwrap()
        .lines()
        .filter_map(|line| line.split_once('='))
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect()
}

fn assert_everything_resolved(recorded: &BTreeMap<String, String>) {
    // Pandoc runs with --sandbox, so it reads no images itself; Tectonic
    // finds every one through the project search path.
    for (name, expected) in [
        ("images", "3"),
        ("inputs", "2"),
        ("inputs_from_search_path", "2"),
        ("citation", "true"),
        ("csl", "true"),
        ("cwd_is_tmp", "true"),
    ] {
        assert_eq!(recorded[name], expected, "{name}: {recorded:?}");
    }
    let in_scratch: u32 = recorded["images_in_scratch"].parse().unwrap();
    let from_search_path: u32 = recorded["images_from_search_path"].parse().unwrap();
    assert_eq!(in_scratch + from_search_path, 3, "{recorded:?}");
}

fn project_file(project: &Path, relative: &str, content: &[u8]) {
    let path = project.join(relative);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, content).unwrap();
}

fn markdown_project(root: &Path, name: &str) -> PathBuf {
    const ONE_PIXEL_PNG: [u8; 70] = [
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240,
        31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ];
    const MARKER_CSL: &str = concat!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n",
        "<style xmlns=\"http://purl.org/net/xbiblio/csl\" class=\"in-text\" version=\"1.0\">\n",
        "<info><title>Marker</title><id>marker</id>",
        "<updated>2026-01-01T00:00:00+00:00</updated></info>\n",
        "<citation><layout prefix=\"[CSLMARK \" suffix=\"]\">",
        "<text variable=\"citation-number\"/></layout></citation>\n",
        "<bibliography><layout><text variable=\"title\"/></layout></bibliography>\n",
        "</style>\n",
    );
    let project = root.join(name);
    project_file(
        &project,
        "main.md",
        concat!(
            "---\n",
            "title: Notes\n",
            "csl: styles/marker.csl\n",
            "header-includes:\n",
            "  - \\input{macros}\n",
            "  - \\input{tex/extra}\n",
            "---\n\n",
            "\\MACROTEXT{} and \\EXTRATEXT{}.\n\n",
            "As @knuth shows.\n\n",
            "![Root](root.png)\n\n",
            "![A plot](figs/plot.png)\n\n",
            "\\includegraphics{figs/raw.png}\n",
        )
        .as_bytes(),
    );
    for image in ["root.png", "figs/plot.png", "figs/raw.png"] {
        project_file(&project, image, &ONE_PIXEL_PNG);
    }
    project_file(&project, "macros.tex", b"\\newcommand{\\MACROTEXT}{M}\n");
    project_file(&project, "tex/extra.tex", b"\\newcommand{\\EXTRATEXT}{E}\n");
    project_file(
        &project,
        "sources/refs.bib",
        b"@book{knuth, author={Donald Knuth}, title={KnuthTitle}, year={1984}}\n",
    );
    project_file(&project, "styles/marker.csl", MARKER_CSL.as_bytes());
    project
}

fn external_build(root: &Path, name: &str) -> PathBuf {
    let directory = root.join(name);
    std::fs::create_dir_all(&directory).unwrap();
    directory
}

fn markdown_manifest() -> ProjectManifest {
    ProjectManifest {
        name: "Pandoc temp".into(),
        main_doc: "main.md".into(),
        engine: Engine::Markdown.manifest_name().into(),
        ..ProjectManifest::default()
    }
}

fn real_pandoc() -> Option<PathBuf> {
    let pandoc = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../src-tauri/binaries")
        .join(format!(
            "pandoc-{}{}",
            option_env!("OLEAFLY_BUILD_TARGET")?,
            std::env::consts::EXE_SUFFIX
        ));
    pandoc.is_file().then(|| pandoc.canonicalize().unwrap())
}

fn injected_scratch_bases(root: &Path, build: &Path) -> EngineScratchBases {
    let system = root.join("system tmp");
    std::fs::create_dir_all(&system).unwrap();
    EngineScratchBases {
        system,
        owned: Some(root.join("data").join(ENGINE_TEMP_DIR)),
        build: build.to_path_buf(),
    }
}

fn hostile_scratch_bases(root: &Path) -> (PathBuf, EngineScratchBases) {
    let system = root.join("tmp #1");
    std::fs::create_dir_all(&system).unwrap();
    let bases = EngineScratchBases {
        system: system.clone(),
        owned: Some(root.join("data {x}").join(ENGINE_TEMP_DIR)),
        build: root.join("build 50%"),
    };
    (system, bases)
}

fn fake_markdown_compiler(directory: &Path) -> NativeCompiler {
    let tectonic = directory.join(executable_name("tectonic"));
    let pandoc = directory.join(executable_name("pandoc"));
    let typst = directory.join(executable_name("typst"));
    for tool in [&tectonic, &pandoc, &typst] {
        std::fs::write(tool, "tool").unwrap();
    }
    NativeCompiler::new(BuildTools {
        tectonic: Some(tectonic),
        pandoc: Some(pandoc),
        typst: Some(typst),
        ..BuildTools::default()
    })
}

#[test]
fn markdown_commands_run_pandoc_from_a_fresh_scratch_folder_with_project_paths() {
    let tools_directory = TempDir::new().unwrap();
    let compiler = fake_markdown_compiler(tools_directory.path());
    let root = TempDir::new().unwrap();
    let project = markdown_project(root.path(), "Paper #2 {50% & more}");
    let workspace = Workspace::from_manifest_with_build(
        &project,
        markdown_manifest(),
        oleafly_core::BuildLocation::External(external_build(root.path(), "build")),
    )
    .unwrap();
    let before = snapshot(&project);
    let build = workspace.prepare_build().unwrap();
    let injected = plain_path(&root.path().canonicalize().unwrap());
    let safe_bases = injected_scratch_bases(root.path(), build.build_directory());
    let expected_parent = oleafly_core::tex_safe_path(&injected)
        .then(|| plain_path(&safe_bases.system.canonicalize().unwrap()));
    let first = compiler
        .command_with(&build, BuildOptions::default(), &safe_bases, true)
        .unwrap();
    let second = compiler
        .command_with(&build, BuildOptions::default(), &safe_bases, true)
        .unwrap();
    let scratch = |command: &BuildCommand| PathBuf::from(&temp_environment(command)[0].1);
    assert_ne!(scratch(&first), scratch(&second));
    assert_eq!(
        temp_environment(&first),
        TEMP_DIRECTORY_VARIABLES.map(|name| (name, scratch(&first).into_os_string()))
    );
    assert_eq!(first.working_directory, scratch(&first));
    let project_root = plain_path(build.project_root());
    let first_arguments = arguments(&first);
    assert_eq!(
        first_arguments[0],
        format!("--resource-path={}", project_root.display())
    );
    for expected in [
        format!("--pdf-engine-opt=-Zsearch-path={}", project_root.display()),
        format!(
            "--bibliography={}",
            project_root.join("sources").join("refs.bib").display()
        ),
        project_root.join("main.md").display().to_string(),
    ] {
        assert!(
            first_arguments.contains(&expected),
            "{expected} {first_arguments:?}"
        );
    }
    let first_scratch = scratch(&first);
    assert!(first_scratch.is_dir());
    assert!(first_scratch.starts_with(&injected));
    match &expected_parent {
        Some(parent) => {
            assert_eq!(first_scratch.parent(), Some(parent.as_path()));
            assert!(oleafly_core::tex_safe_path(&first_scratch));
        }
        None => assert!(first_scratch.to_string_lossy().ends_with('~')),
    }
    assert!(!first_scratch.starts_with(&project));
    assert!(!first_scratch.starts_with(project.canonicalize().unwrap()));
    let first_stable = stable_arguments(&first);
    drop(first);
    assert!(!first_scratch.exists());

    let (system, bases) = hostile_scratch_bases(root.path());
    let fallback = compiler
        .command_with(&build, BuildOptions::default(), &bases, true)
        .unwrap();
    let fallback_scratch = scratch(&fallback);
    assert!(fallback_scratch.to_string_lossy().ends_with('~'));
    assert_eq!(fallback.working_directory, fallback_scratch);
    assert_eq!(stable_arguments(&fallback), first_stable);
    assert!(std::fs::read_dir(&system).unwrap().next().is_none());
    drop(fallback);
    assert!(!fallback_scratch.exists());
    assert_eq!(snapshot(&project), before);

    let typst_directory = TempDir::new().unwrap();
    let typst_build = workspace_for_engine(&typst_directory, Engine::Typst, None)
        .prepare_build()
        .unwrap();
    let typst_command = compiler
        .command(&typst_build, BuildOptions::default(), true)
        .unwrap();
    assert!(typst_command.environment.is_empty());
    assert_eq!(typst_command.working_directory, typst_build.project_root());
}

#[test]
fn a_pinned_typst_runs_the_resolved_binary_and_a_missing_pin_blocks_the_build() {
    let tools_directory = TempDir::new().unwrap();
    let unpinned = tools_directory.path().join(executable_name("typst"));
    let pinned = tools_directory.path().join("pinned-typst");
    for tool in [&unpinned, &pinned] {
        std::fs::write(tool, "tool").unwrap();
    }
    let typst_directory = TempDir::new().unwrap();
    let build = workspace_for_engine(&typst_directory, Engine::Typst, None)
        .prepare_build()
        .unwrap();
    let mut tools = BuildTools {
        typst: Some(unpinned.clone()),
        ..BuildTools::default()
    };
    let unpinned_arguments = stable_arguments(
        &NativeCompiler::new(tools.clone())
            .command(&build, BuildOptions::default(), true)
            .unwrap(),
    );

    tools.use_pinned_typst(Ok(PinnedTypst {
        path: pinned.clone(),
        capabilities: capabilities_for("0.11.1").clone(),
        version: ToolchainVersion::parse("0.11.1").unwrap(),
    }));
    let command = NativeCompiler::new(tools.clone())
        .command(&build, BuildOptions::default(), true)
        .unwrap();
    assert_eq!(command.executable, pinned);
    assert_eq!(stable_arguments(&command), unpinned_arguments);
    assert_eq!(tools.typst_pin_error(), None);
    assert_eq!(tools.typst_version_label(), "0.11.1");

    tools.use_pinned_typst(Err("this project pins Typst 0.12.0".into()));
    assert_eq!(tools.typst, None);
    let error = NativeCompiler::new(tools.clone())
        .command(&build, BuildOptions::default(), true)
        .err()
        .unwrap();
    assert_eq!(error.kind(), ErrorKind::MissingTool);
    assert_eq!(error.message(), "this project pins Typst 0.12.0");
    assert_eq!(
        tools.typst_pin_error(),
        Some("this project pins Typst 0.12.0")
    );
}

#[cfg(windows)]
#[test]
fn markdown_commands_hand_pandoc_project_paths_without_the_verbatim_prefix() {
    let tools_directory = TempDir::new().unwrap();
    let compiler = fake_markdown_compiler(tools_directory.path());
    let root = TempDir::new().unwrap();
    let project = markdown_project(root.path(), "Paper");
    let workspace = Workspace::from_manifest(&project, markdown_manifest()).unwrap();
    let build = workspace.prepare_build().unwrap();
    assert!(build.project_root().to_string_lossy().starts_with(r"\\?\"));
    let command = compiler
        .command_with(
            &build,
            BuildOptions::default(),
            &injected_scratch_bases(root.path(), build.build_directory()),
            true,
        )
        .unwrap();
    let plain = plain_path(build.project_root());
    assert!(plain
        .to_string_lossy()
        .starts_with(|letter: char| letter.is_ascii_alphabetic()));
    let arguments = arguments(&command);
    for expected in [
        format!("--resource-path={}", plain.display()),
        format!("--pdf-engine-opt=-Zsearch-path={}", plain.display()),
        format!(
            "--bibliography={}",
            plain.join("sources").join("refs.bib").display()
        ),
        plain.join("main.md").display().to_string(),
        "--sandbox".to_string(),
    ] {
        assert!(arguments.contains(&expected), "{expected} {arguments:?}");
    }
    let output_prefix = format!(
        "--output={}",
        plain.join(".oleafly").join("build").display()
    );
    assert!(arguments
        .iter()
        .any(|argument| argument.starts_with(&output_prefix)
            && argument.contains(".oleafly-staging-")));
    assert!(
        arguments.iter().all(|argument| !argument.contains(r"\\?\")),
        "{arguments:?}"
    );
}

#[tokio::test]
async fn markdown_builds_hand_pandoc_a_scratch_temp_folder_and_remove_it_afterwards() {
    let tools = TempDir::new().unwrap();
    let pandoc = crate::support::rust_fixture(tools.path(), "pandoc_recorder.rs", "pandoc", None);
    let tectonic = tools.path().join(executable_name("tectonic"));
    std::fs::write(&tectonic, "tool").unwrap();
    let compiler = NativeCompiler::new(BuildTools {
        pandoc: Some(pandoc.clone()),
        tectonic: Some(tectonic),
        ..BuildTools::default()
    });
    let root = TempDir::new().unwrap();
    let project = markdown_project(
        root.path(),
        if cfg!(windows) {
            "Bob's notes; ${HOME}"
        } else {
            "Bob's notes: ${HOME}"
        },
    );
    let workspace = Workspace::from_manifest_with_build(
        &project,
        markdown_manifest(),
        oleafly_core::BuildLocation::External(external_build(root.path(), "build")),
    )
    .unwrap();
    let before = snapshot(&project);
    let result = compiler
        .build(&workspace, BuildOptions::default())
        .await
        .unwrap();
    assert!(result.ok, "{}", result.log);
    let recorded = record(&pandoc);
    let scratch = PathBuf::from(&recorded["TMP"]);
    for name in TEMP_DIRECTORY_VARIABLES {
        assert_eq!(recorded[name], recorded["TMP"], "{name}");
        assert_eq!(recorded[&format!("{name}_EXISTS")], "true", "{name}");
    }
    assert_eq!(recorded["cwd_is_tmp"], "true");
    assert_eq!(
        recorded["defaults"],
        r#"{"resource-path":["${OLEAFLY_PANDOC_RESOURCE_PATH}"]}"#
    );
    assert_eq!(
        PathBuf::from(&recorded["resource_path"]),
        plain_path(&project.canonicalize().unwrap())
    );
    assert!(scratch
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("oleafly-engine-"));
    assert!(!scratch.exists());
    assert!(!scratch.starts_with(project.canonicalize().unwrap()));
    assert_eq!(snapshot(&project), before);
    assert!(result.output.is_some_and(|output| output.is_file()));
}

#[tokio::test]
async fn real_pandoc_builds_markdown_in_a_folder_whose_name_tex_cannot_read() {
    let Some(pandoc) = real_pandoc() else {
        return;
    };
    let tools = TempDir::new().unwrap();
    let tectonic = crate::support::rust_fixture(tools.path(), "tex_checker.rs", "tectonic", None);
    let compiler = NativeCompiler::new(BuildTools {
        pandoc: Some(pandoc),
        tectonic: Some(tectonic.clone()),
        ..BuildTools::default()
    });
    let root = TempDir::new().unwrap();
    let project = markdown_project(root.path(), "Paper #2 {50% & more}");
    let in_tree = Workspace::from_manifest(&project, markdown_manifest()).unwrap();
    in_tree.prepare_build().unwrap();
    let before = snapshot(&project);
    let external = Workspace::from_manifest_with_build(
        &project,
        markdown_manifest(),
        oleafly_core::BuildLocation::External(external_build(root.path(), "build")),
    )
    .unwrap();
    for workspace in [&external, &in_tree] {
        let result = compiler
            .build(workspace, BuildOptions::default())
            .await
            .unwrap();
        assert!(result.ok, "{}", result.log);
        assert!(result.output.is_some_and(|output| output.is_file()));
        let recorded = record(&tectonic);
        assert_everything_resolved(&recorded);
        let scratch = PathBuf::from(&recorded["TMP"]);
        assert!(scratch
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("oleafly-engine-"));
        assert!(!scratch.exists());
    }
    assert_eq!(
        outside_the_build_directory(snapshot(&project)),
        outside_the_build_directory(before)
    );
}

async fn run_markdown_command(
    command: &BuildCommand,
    extra: Option<(&'static str, OsString)>,
) -> (String, ExitStatus) {
    let mut environment = command.environment.clone();
    environment.extend(extra);
    run_command(
        &launch(
            &command.executable,
            &command.arguments,
            &command.working_directory,
            &environment,
        ),
        Duration::from_secs(60),
        &CompilerLog::default(),
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn real_pandoc_uses_relative_media_paths_when_no_temp_folder_is_safe_for_tex() {
    let Some(pandoc) = real_pandoc() else {
        return;
    };
    let tools = TempDir::new().unwrap();
    let tectonic = crate::support::rust_fixture(tools.path(), "tex_checker.rs", "tectonic", None);
    let compiler = NativeCompiler::new(BuildTools {
        pandoc: Some(pandoc),
        tectonic: Some(tectonic.clone()),
        ..BuildTools::default()
    });
    let root = TempDir::new().unwrap();
    let project = markdown_project(root.path(), "Paper #2 {50% & more}");
    let workspace = Workspace::from_manifest_with_build(
        &project,
        markdown_manifest(),
        oleafly_core::BuildLocation::External(external_build(root.path(), "linked 50%")),
    )
    .unwrap();
    let before = snapshot(&project);
    let build = workspace.prepare_build().unwrap();
    let (system, bases) = hostile_scratch_bases(root.path());
    let command = compiler
        .command_with(&build, BuildOptions::default(), &bases, true)
        .unwrap();
    let scratch = command.working_directory.clone();
    assert!(scratch.to_string_lossy().ends_with('~'));
    let (log, status) = run_markdown_command(&command, None).await;
    assert!(status.success(), "{log}");
    let recorded = record(&tectonic);
    assert_everything_resolved(&recorded);
    assert!(command.produced_output.is_file());
    assert!(std::fs::read_dir(&system).unwrap().next().is_none());
    assert_eq!(snapshot(&project), before);
    drop(command);
    assert!(!scratch.exists());
}

#[tokio::test]
async fn real_pandoc_with_a_cygwin_uname_on_the_path_writes_nothing_into_the_project() {
    let Some(pandoc) = real_pandoc() else {
        return;
    };
    let tools = TempDir::new().unwrap();
    let tectonic = crate::support::rust_fixture(tools.path(), "tex_checker.rs", "tectonic", None);
    let cygwin = TempDir::new().unwrap();
    crate::support::rust_fixture(cygwin.path(), "cygwin_uname.rs", "uname", None);
    let compiler = NativeCompiler::new(BuildTools {
        pandoc: Some(pandoc),
        tectonic: Some(tectonic.clone()),
        ..BuildTools::default()
    });
    let root = TempDir::new().unwrap();
    let project = markdown_project(root.path(), "Cygwin notes");
    let workspace = Workspace::from_manifest_with_build(
        &project,
        markdown_manifest(),
        oleafly_core::BuildLocation::External(external_build(root.path(), "build")),
    )
    .unwrap();
    let before = snapshot(&project);
    let build = workspace.prepare_build().unwrap();
    let command = compiler
        .command_with(
            &build,
            BuildOptions::default(),
            &injected_scratch_bases(root.path(), build.build_directory()),
            true,
        )
        .unwrap();
    let scratch = command.working_directory.clone();
    let inherited = std::env::var_os("PATH").unwrap_or_default();
    let path = std::env::join_paths(
        std::iter::once(cygwin.path().to_path_buf()).chain(std::env::split_paths(&inherited)),
    )
    .unwrap();
    let (log, status) = run_markdown_command(&command, Some(("PATH", path))).await;
    assert!(status.success(), "{log}");
    assert_everything_resolved(&record(&tectonic));
    assert_eq!(snapshot(&project), before);
    drop(command);
    assert!(!scratch.exists());
}

async fn assert_real_pandoc_finds_project_files_in(names: &[&str]) {
    let Some(pandoc) = real_pandoc() else {
        return;
    };
    let tools = TempDir::new().unwrap();
    let tectonic = crate::support::rust_fixture(tools.path(), "tex_checker.rs", "tectonic", None);
    let compiler = NativeCompiler::new(BuildTools {
        pandoc: Some(pandoc),
        tectonic: Some(tectonic.clone()),
        ..BuildTools::default()
    });
    let root = TempDir::new().unwrap();
    for name in names {
        let project = markdown_project(root.path(), name);
        let workspace = Workspace::from_manifest(&project, markdown_manifest()).unwrap();
        let build = workspace.prepare_build().unwrap();
        let before = snapshot(&project);
        let command = compiler
            .command_with(
                &build,
                BuildOptions::default(),
                &injected_scratch_bases(root.path(), build.build_directory()),
                true,
            )
            .unwrap();
        let scratch = command.working_directory.clone();
        let (log, status) = run_markdown_command(&command, None).await;
        assert!(status.success(), "{name}: {log}");
        assert_everything_resolved(&record(&tectonic));
        assert!(command.produced_output.is_file(), "{name}");
        drop(command);
        assert!(!scratch.exists(), "{name}");
        assert_eq!(
            outside_the_build_directory(snapshot(&project)),
            outside_the_build_directory(before),
            "{name}"
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn real_pandoc_finds_project_files_when_the_folder_name_has_a_colon_or_a_variable() {
    assert_real_pandoc_finds_project_files_in(&[
        "Thesis 2024:25",
        "Notes ${HOME} x",
        "Draft 1:2 ${HOME} $x ${.} ${USERDATA} ${OLEAFLY_UNDEFINED}",
    ])
    .await;
}

#[cfg(windows)]
#[tokio::test]
async fn real_pandoc_finds_project_files_when_the_folder_name_has_a_semicolon_or_a_variable() {
    assert_real_pandoc_finds_project_files_in(&[
        "Smith; Jones",
        "Notes ${USERPROFILE} x",
        "Draft 1;2 ${HOME} $x ${.} ${USERDATA} ${OLEAFLY_UNDEFINED}",
    ])
    .await;
}

#[test]
fn compiler_commands_reject_unsafe_or_incomplete_toolchains() {
    let project = TempDir::new().unwrap();
    let workspace = workspace_for_engine(&project, Engine::Tectonic, None);
    let prepared = workspace.prepare_build().unwrap();
    let local_tool = project.path().join(executable_name("tectonic"));
    std::fs::write(&local_tool, "tool").unwrap();
    let error = match NativeCompiler::new(BuildTools {
        tectonic: Some(local_tool),
        ..BuildTools::default()
    })
    .command(&prepared, BuildOptions::default(), true)
    {
        Ok(_) => panic!("project-local compiler was accepted"),
        Err(error) => error,
    };
    assert_eq!(error.kind(), ErrorKind::UnsafePath);

    let tools_directory = TempDir::new().unwrap();
    let pandoc = tools_directory.path().join(executable_name("pandoc"));
    std::fs::write(&pandoc, "tool").unwrap();
    let markdown_project = TempDir::new().unwrap();
    let markdown = workspace_for_engine(&markdown_project, Engine::Markdown, None);
    let error = match NativeCompiler::new(BuildTools {
        pandoc: Some(pandoc),
        ..BuildTools::default()
    })
    .command(
        &markdown.prepare_build().unwrap(),
        BuildOptions::default(),
        true,
    ) {
        Ok(_) => panic!("incomplete Markdown toolchain was accepted"),
        Err(error) => error,
    };
    assert_eq!(error.kind(), ErrorKind::MissingTool);
    assert!(error.to_string().contains("both pandoc and tectonic"));
}

#[test]
fn tex_errors_include_line_numbers_and_explanations() {
    let errors = parse_errors(
        Engine::Tectonic,
        "! Undefined control sequence.\nl.42 \\badcommand",
    );
    assert_eq!(errors[0].line, Some(42));
    assert_eq!(errors[0].kind, "error");
    assert!(errors[0].explanation.is_some());
}

#[test]
fn diagnostics_preserve_each_engines_user_visible_shape() {
    let typst = parse_errors(
        Engine::Typst,
        "paper.typ:7:2: error: broken\nC:\\paper.typ:8:3: warning: careful\nnoise",
    );
    assert_eq!(typst.len(), 2);
    assert_eq!(typst[0].file.as_deref(), Some("paper.typ"));
    assert_eq!(typst[0].line, Some(7));
    assert_eq!(typst[0].column, Some(3));
    assert_eq!(typst[1].kind, "warning");
    assert_eq!(typst[1].file.as_deref(), Some("C:\\paper.typ"));
    assert_eq!((typst[1].line, typst[1].column), (Some(8), Some(4)));

    let markdown = parse_errors(
        Engine::Markdown,
        "warning: missing title\npandoc: failed to render\nordinary output",
    );
    assert_eq!(markdown.len(), 2);
    assert_eq!(markdown[0].kind, "warning");
    assert_eq!(markdown[1].kind, "error");

    let tectonic = parse_errors(
        Engine::Tectonic,
        "! First error\nl.12 \\first\n! Second error\nwithout a line",
    );
    assert_eq!(tectonic[0].line, Some(12));
    assert_eq!(tectonic[1].line, None);
    assert_eq!(parse_errors(Engine::Latexmk, "normal output"), Vec::new());
}

#[test]
fn engine_output_follows_the_tex_log_only_on_failure() {
    let combined = with_engine_output_on_failure("file log".into(), "engine said this", false);
    assert!(combined.starts_with("file log"));
    assert!(combined.contains(ENGINE_OUTPUT_MARKER));
    assert!(combined.ends_with("engine said this"));
    assert_eq!(
        with_engine_output_on_failure("file log".into(), "engine said this", true),
        "file log"
    );
    assert_eq!(
        with_engine_output_on_failure("file log".into(), "  ", false),
        "file log"
    );
}

const TYPST_LOGS: [(&str, &str); 6] = [
    (
        "0.11.1",
        include_str!("../../oleafly-core/tests/fixtures/typst-log/0.11.1.log"),
    ),
    (
        "0.12.0",
        include_str!("../../oleafly-core/tests/fixtures/typst-log/0.12.0.log"),
    ),
    (
        "0.13.1",
        include_str!("../../oleafly-core/tests/fixtures/typst-log/0.13.1.log"),
    ),
    (
        "0.14.2",
        include_str!("../../oleafly-core/tests/fixtures/typst-log/0.14.2.log"),
    ),
    (
        "0.15.0",
        include_str!("../../oleafly-core/tests/fixtures/typst-log/0.15.0.log"),
    ),
    (
        "0.15.1",
        include_str!("../../oleafly-core/tests/fixtures/typst-log/0.15.1.log"),
    ),
];

fn typst_log_case(log: &str, name: &str) -> String {
    let marker = format!("=== {name}\n");
    let start = log.find(&marker).expect("fixture case") + marker.len();
    let rest = &log[start..];
    rest[..rest.find("=== ").unwrap_or(rest.len())].to_owned()
}

#[test]
fn typst_human_diagnostics_keep_hints_columns_and_the_calling_line() {
    let errors = parse_errors(
        Engine::Typst,
        "error: unknown variable: foo\n  \u{250c}\u{2500} main.typ:3:1\n  \u{2502}\n3 \u{2502} $foo$ and text.\n  \u{2502}  ^^^\n  \u{2502}\n  = hint: try adding spaces: `f o o`\n  = hint: or quote it: `\"foo\"`\n\nwarning: unknown font family: x\n  \u{250c}\u{2500} C:\\Users\\ada\\paper\\chapters\\intro.typ:1:16\n  \u{2502}\n1 \u{2502} #set text(font: \"X\")\n  \u{2502}                 ^^^\n\n",
    );
    assert_eq!(
        errors,
        [
            BuildError {
                line: Some(3),
                file: Some("main.typ".into()),
                message: "unknown variable: foo".into(),
                kind: "error".into(),
                column: Some(2),
                hints: vec![
                    "try adding spaces: `f o o`".into(),
                    "or quote it: `\"foo\"`".into()
                ],
                explanation: None,
            },
            BuildError {
                line: Some(1),
                file: Some("C:\\Users\\ada\\paper\\chapters\\intro.typ".into()),
                message: "unknown font family: x".into(),
                kind: "warning".into(),
                column: Some(17),
                hints: Vec::new(),
                explanation: None,
            },
        ]
    );
    for (version, log) in TYPST_LOGS {
        let traced = parse_errors(Engine::Typst, &typst_log_case(log, "package_trace"));
        assert_eq!(traced.len(), 1, "{version}");
        assert_eq!(traced[0].file.as_deref(), Some("main.typ"), "{version}");
        assert_eq!((traced[0].line, traced[0].column), (Some(4), Some(2)));
        let case = typst_log_case(log, "math_hints");
        let hinted = parse_errors(Engine::Typst, &case);
        assert_eq!(hinted[0].message, "unknown variable: foo", "{version}");
        assert_eq!(hinted[0].column, Some(2), "{version}");
        assert_eq!(
            hinted[0].hints.len(),
            case.matches("= hint:").count(),
            "{version}"
        );
    }
}

#[test]
fn an_unpinned_typst_uses_the_capabilities_of_the_version_it_reports() {
    let mut tools = BuildTools::default();
    assert_eq!(
        tools.typst_capabilities(),
        capabilities_for(&bundled_typst_version().to_string())
    );
    assert_eq!(
        tools.typst_version_label(),
        bundled_typst_version().to_string()
    );
    tools.use_typst_version(ToolchainVersion::parse("0.11.1"));
    assert_eq!(tools.typst_capabilities(), capabilities_for("0.11.1"));
    assert_eq!(tools.typst_version_label(), "0.11.1");
    tools.use_typst_version(None);
    assert_eq!(
        tools.typst_capabilities(),
        capabilities_for(&bundled_typst_version().to_string())
    );
}

#[test]
fn typst_commands_carry_the_project_settings_the_version_supports() {
    let tools_directory = TempDir::new().unwrap();
    let typst = tools_directory.path().join(executable_name("typst"));
    std::fs::write(&typst, "tool").unwrap();
    let project = TempDir::new().unwrap();
    let build = workspace_for_engine(&project, Engine::Typst, None)
        .prepare_build()
        .unwrap();
    let settings = TypstSettings {
        packages: Some(crate::typst_settings::PackageDirs {
            package_path: PathBuf::from("/data/typst/packages"),
            cache_path: PathBuf::from("/data/typst/packages-cache"),
        }),
        font_dirs: vec![PathBuf::from("/project/fonts")],
        ignore_system_fonts: true,
        inputs: vec![("draft".into(), "true".into())],
        creation_timestamp: Some(7),
        offline: true,
    };
    let mut tools = BuildTools {
        typst: Some(typst),
        ..BuildTools::default()
    };
    let command = |tools: &BuildTools| {
        NativeCompiler::new(tools.clone())
            .with_typst_settings(settings.clone())
            .command(&build, BuildOptions::default(), true)
            .unwrap()
    };
    let current = command(&tools);
    let current_arguments = arguments(&current);
    for pair in [
        ["--package-path", "/data/typst/packages"],
        ["--package-cache-path", "/data/typst/packages-cache"],
        ["--font-path", "/project/fonts"],
        ["--input", "draft=true"],
        ["--creation-timestamp", "7"],
    ] {
        assert!(
            current_arguments.windows(2).any(|window| window == pair),
            "{pair:?} {current_arguments:?}"
        );
    }
    assert!(current_arguments.contains(&"--ignore-system-fonts".to_string()));
    let environment = environment(&current);
    assert_eq!(environment["TYPST_PACKAGE_PATH"], "/data/typst/packages");
    assert_eq!(environment["SOURCE_DATE_EPOCH"], "7");
    assert_eq!(environment["HTTPS_PROXY"], "http://127.0.0.1:9");

    tools.use_typst_version(ToolchainVersion::parse("0.11.1"));
    let old_arguments = arguments(&command(&tools));
    for absent in [
        "--package-path",
        "--package-cache-path",
        "--ignore-system-fonts",
        "--creation-timestamp",
    ] {
        assert!(!old_arguments.iter().any(|argument| argument == absent));
    }
    assert!(old_arguments
        .windows(2)
        .any(|window| window == ["--input", "draft=true"]));
}

fn real_typst() -> Option<PathBuf> {
    let typst = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../src-tauri/binaries")
        .join(format!(
            "typst-{}{}",
            option_env!("OLEAFLY_BUILD_TARGET")?,
            std::env::consts::EXE_SUFFIX
        ));
    typst.is_file().then(|| typst.canonicalize().unwrap())
}

#[tokio::test]
async fn real_typst_builds_with_vendored_packages_and_variant_inputs_offline() {
    let Some(typst) = real_typst() else {
        return;
    };
    let project = TempDir::new().unwrap();
    let data = TempDir::new().unwrap();
    let package = "typst-packages/local/greet/0.1.0";
    project_file(
        project.path(),
        &format!("{package}/typst.toml"),
        b"[package]\nname = \"greet\"\nversion = \"0.1.0\"\nentrypoint = \"lib.typ\"\n",
    );
    project_file(
        project.path(),
        &format!("{package}/lib.typ"),
        b"#let hello(name) = [Hello #name]\n",
    );
    project_file(
        project.path(),
        "main.typ",
        b"#import \"@local/greet:0.1.0\": hello\n#assert.eq(sys.inputs.at(\"who\"), \"reviewer\")\n#hello(sys.inputs.at(\"who\"))\n",
    );
    let spec: oleafly_core::TypstSpec = serde_json::from_value(serde_json::json!({
        "vendor_packages": true,
        "inputs": {"who": "everyone"},
        "variants": {"review": {"inputs": {"who": "reviewer"}}}
    }))
    .unwrap();
    let workspace = Workspace::from_manifest(
        project.path(),
        ProjectManifest {
            main_doc: "main.typ".into(),
            engine: "typst".into(),
            typst: Some(spec.clone()),
            ..ProjectManifest::default()
        },
    )
    .unwrap();
    let settings = |variant: Option<&str>| {
        TypstSettings::resolve(&crate::typst_settings::SettingsRequest {
            spec: Some(&spec),
            project_root: workspace.root(),
            data_root: Some(data.path()),
            variant,
            offline: true,
            commit_time: None,
        })
    };
    let compiler = |variant: Option<&str>| {
        NativeCompiler::new(BuildTools {
            typst: Some(typst.clone()),
            ..BuildTools::default()
        })
        .with_typst_settings(settings(variant))
    };
    let result = compiler(Some("review"))
        .build(&workspace, BuildOptions::default())
        .await
        .unwrap();
    assert!(result.ok, "{}", result.log);
    assert!(result.output.is_some_and(|output| output.is_file()));

    let base = compiler(None)
        .build(&workspace, BuildOptions::default())
        .await
        .unwrap();
    assert!(!base.ok);
    assert!(
        base.errors[0].message.contains("assertion"),
        "{:?}",
        base.errors
    );
    assert!(base.previous_output.is_some());

    std::fs::write(
        project.path().join("main.typ"),
        "= Draft\n\n$foo$ and text.\n",
    )
    .unwrap();
    let failed = compiler(None)
        .build(&workspace, BuildOptions::default())
        .await
        .unwrap();
    assert!(!failed.ok);
    let error = &failed.errors[0];
    assert_eq!(error.message, "unknown variable: foo", "{}", failed.log);
    assert_eq!(error.file.as_deref(), Some("main.typ"));
    assert_eq!((error.line, error.column), (Some(3), Some(2)));
    assert!(!error.hints.is_empty(), "{}", failed.log);
    assert_eq!(failed.diagnostics[0].file.as_deref(), Some("main.typ"));
}

#[test]
fn compiler_output_is_utf8_safe_and_bounded() {
    let mut output = "x".repeat(MAX_LOG_BYTES - 1);
    append_bounded(&mut output, "éclair".as_bytes());
    assert_eq!(output.len(), MAX_LOG_BYTES);
    assert!(output.ends_with(LOG_TRUNCATION_MARKER));
    assert!(!output.contains('é'));
    let length = output.len();
    append_bounded(&mut output, b"ignored");
    assert_eq!(output.len(), length);

    let mut exact = "x".repeat(MAX_LOG_BYTES);
    append_bounded(&mut exact, b"");
    assert!(!exact.ends_with(LOG_TRUNCATION_MARKER));
    append_bounded(&mut exact, b"overflow");
    assert_eq!(exact.len(), MAX_LOG_BYTES);
    assert!(exact.ends_with(LOG_TRUNCATION_MARKER));
}

#[tokio::test]
async fn native_builds_keep_the_last_good_pdf_when_a_build_fails() {
    let tools_directory = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    let workspace = workspace_for_engine(&project, Engine::Tectonic, None);
    let success_compiler = NativeCompiler::new(BuildTools {
        tectonic: Some(compiler_fixture(&tools_directory, false)),
        ..BuildTools::default()
    });

    let result = success_compiler
        .build(&workspace, BuildOptions::default())
        .await
        .unwrap();
    assert!(result.ok, "{}", result.log);
    assert!(result.log.contains("fixture-ok:main.tex"), "{}", result.log);
    assert!(result.errors.is_empty());
    let pdf = result.output.clone().unwrap();
    assert!(pdf.ends_with("_oleafly_entry.pdf") && pdf.is_file());
    assert!(result
        .output_id
        .as_deref()
        .is_some_and(|value| value.starts_with("pdf-sha256:")));
    assert!(result.fresh);
    let good = std::fs::read(&pdf).unwrap();

    let failed_compiler = NativeCompiler::new(BuildTools {
        tectonic: Some(compiler_fixture(&tools_directory, true)),
        ..BuildTools::default()
    });
    let result = failed_compiler
        .build(&workspace, BuildOptions::default())
        .await
        .unwrap();
    assert!(!result.ok);
    assert!(!result.fresh);
    assert_eq!(result.output, None);
    assert_eq!(result.output_id, None);
    assert_eq!(result.previous_output.as_deref(), Some(pdf.as_path()));
    assert_eq!(std::fs::read(&pdf).unwrap(), good);
    assert_eq!(result.errors.len(), 1);
    assert_eq!(result.errors[0].message, "Fixture failure");
    let leftovers: Vec<_> = std::fs::read_dir(workspace.build_dir_path())
        .unwrap()
        .filter_map(std::result::Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(oleafly_core::build_output::STAGING_PREFIX)
        })
        .collect();
    assert!(leftovers.is_empty());
}

#[tokio::test]
async fn the_bundle_fallback_retries_without_the_mirror() {
    let tools_directory = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    let workspace = workspace_for_engine(&project, Engine::Tectonic, None);
    // A fixture that fails only while `--bundle` is given, through the
    // command-line switch the integration tests use; here the arguments are
    // checked directly.
    let compiler = NativeCompiler::new(BuildTools {
        tectonic: Some(compiler_fixture(&tools_directory, false)),
        ..BuildTools::default()
    });
    let build = workspace.prepare_build().unwrap();
    let pinned = arguments(
        &compiler
            .command(&build, BuildOptions::default(), true)
            .unwrap(),
    );
    let unpinned = arguments(
        &compiler
            .command(&build, BuildOptions::default(), false)
            .unwrap(),
    );
    assert!(pinned.iter().any(|argument| argument == "--bundle"));
    assert!(!unpinned.iter().any(|argument| argument == "--bundle"));
    assert!(is_bundle_fetch_failure(
        "error: this bundle isn't cached, and we couldn't get it from the internet"
    ));
}

fn image_project(engine: Engine, main: &str) -> (TempDir, Workspace) {
    let project = TempDir::new().unwrap();
    let workspace = workspace_for_engine(&project, engine, None);
    std::fs::write(project.path().join(engine.default_main_document()), main).unwrap();
    std::fs::create_dir_all(project.path().join("figures")).unwrap();
    std::fs::write(project.path().join("figures/plot.png"), b"").unwrap();
    std::fs::write(project.path().join("figures/unused.png"), b"").unwrap();
    (project, workspace)
}

const EMPTY_PLOT: &str =
    "The image figures/plot.png is empty. Export the image again or replace the file.";

#[tokio::test]
async fn failed_tex_builds_name_a_broken_image_in_the_log_errors_and_stream() {
    let (_project, workspace) = image_project(Engine::Tectonic, "document");
    let streamed = Arc::new(Mutex::new(String::new()));
    let sink = streamed.clone();
    let compiler =
        NativeCompiler::new(BuildTools::default()).with_log(CompilerLog::new(move |text| {
            sink.lock().unwrap().push_str(text)
        }));
    let build = workspace.prepare_build().unwrap();
    let mut log =
        "! Unable to load picture or PDF file 'figures/plot.png'.\nl.6 \\includegraphics{figures/plot.png}\n".to_string();
    let mut errors = parse_errors(Engine::Tectonic, &log);
    let original = errors.clone();
    compiler
        .explain_image_failures(&build, &mut log, &mut errors)
        .await;
    let note = format!("\n[Oleafly] {EMPTY_PLOT}\n");
    assert_eq!(errors[0], BuildError::plain(EMPTY_PLOT.into()));
    assert_eq!(errors[1..], original[..]);
    assert!(log.ends_with(&note));
    assert_eq!(*streamed.lock().unwrap(), note);
}

#[tokio::test]
async fn failures_without_image_evidence_keep_their_log_and_errors() {
    let (_project, workspace) =
        image_project(Engine::Tectonic, "\\includegraphics{figures/plot.png}");
    let compiler = NativeCompiler::new(BuildTools::default());
    let build = workspace.prepare_build().unwrap();
    for original in [
        "! Fixture failure",
        "! Undefined control sequence.\nl.4 \\foo\nlibpng warning: iCCP: known incorrect sRGB profile\n",
    ] {
        let mut log = original.to_string();
        let mut errors = parse_errors(Engine::Tectonic, &log);
        let before = errors.clone();
        compiler.explain_image_failures(&build, &mut log, &mut errors).await;
        assert_eq!(log, original);
        assert_eq!(errors, before);
    }
}

#[test]
fn image_check_runs_only_for_failed_tex_builds() {
    assert!(image_check_applies(false, Engine::Tectonic));
    assert!(image_check_applies(false, Engine::Latexmk));
    assert!(!image_check_applies(true, Engine::Tectonic));
    assert!(!image_check_applies(true, Engine::Latexmk));
    assert!(!image_check_applies(false, Engine::Typst));
    assert!(!image_check_applies(false, Engine::Markdown));
}

#[tokio::test]
async fn native_builds_explain_broken_images_only_when_a_tex_build_fails() {
    let tools = TempDir::new().unwrap();
    let success = NativeCompiler::new(BuildTools {
        tectonic: Some(compiler_fixture(&tools, false)),
        ..BuildTools::default()
    });
    let failure = NativeCompiler::new(BuildTools {
        tectonic: Some(compiler_fixture(&tools, true)),
        ..BuildTools::default()
    });
    let with_evidence = "\\includegraphics{figures/plot.png}\n% fixture-libpng-error\n";
    let (_project, workspace) = image_project(Engine::Tectonic, with_evidence);

    let result = success
        .build(&workspace, BuildOptions::default())
        .await
        .unwrap();
    assert!(result.ok);
    assert!(result.log.contains("libpng error: IHDR: CRC error"));
    assert!(!result.log.contains("[Oleafly]"));
    assert!(result.errors.is_empty());

    let result = failure
        .build(&workspace, BuildOptions::default())
        .await
        .unwrap();
    assert!(!result.ok);
    assert_eq!(
        result
            .errors
            .iter()
            .map(|error| error.message.as_str())
            .collect::<Vec<_>>(),
        [EMPTY_PLOT]
    );
    assert!(result.log.ends_with(&format!("\n[Oleafly] {EMPTY_PLOT}\n")));

    let (_project, workspace) =
        image_project(Engine::Tectonic, "\\includegraphics{figures/plot.png}\n");
    let result = failure
        .build(&workspace, BuildOptions::default())
        .await
        .unwrap();
    assert!(!result.ok);
    assert_eq!(result.errors.len(), 1);
    assert_eq!(result.errors[0].message, "Fixture failure");
    assert!(!result.log.contains("[Oleafly]"));
}

#[tokio::test]
async fn native_compiler_rejects_missing_tools() {
    let directory = TempDir::new().unwrap();
    let workspace = Workspace::init(directory.path(), InitOptions::default()).unwrap();
    let compiler = NativeCompiler::new(BuildTools::default());
    let error = compiler
        .build(&workspace, BuildOptions::default())
        .await
        .unwrap_err();
    assert_eq!(error.kind, CliErrorKind::MissingTool);
}

#[tokio::test]
async fn a_second_build_of_a_project_waits_and_then_times_out() {
    let tools = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    let workspace = workspace_for_engine(&project, Engine::Tectonic, None);
    let build_dir = workspace
        .prepare_build()
        .unwrap()
        .build_directory()
        .to_path_buf();
    let held = BuildLock::try_acquire(&build_dir).unwrap().unwrap();
    let waited = Arc::new(Mutex::new(0));
    let counter = waited.clone();
    let compiler = NativeCompiler::new(BuildTools {
        tectonic: Some(compiler_fixture(&tools, false)),
        ..BuildTools::default()
    })
    .with_timeout(Duration::from_millis(300))
    .with_lock_wait(Some(Arc::new(move || *counter.lock().unwrap() += 1)));
    let error = compiler
        .build(&workspace, BuildOptions::default())
        .await
        .unwrap_err();
    assert_eq!(error.code, "conflict.build_running");
    assert!(error.retryable);
    assert_eq!(*waited.lock().unwrap(), 1);
    drop(held);
    let result = compiler
        .with_timeout(Duration::from_secs(60))
        .build(&workspace, BuildOptions::default())
        .await
        .unwrap();
    assert!(result.ok);
}

#[tokio::test]
async fn contained_command_captures_output() {
    let executable = std::env::current_exe().unwrap();
    let arguments = [
        OsString::from("--exact"),
        OsString::from("native::tests::contained_command_child"),
        OsString::from("--nocapture"),
    ];
    let working_directory = TempDir::new().unwrap();
    let captured = Arc::new(Mutex::new(String::new()));
    let captured_output = Arc::clone(&captured);
    let sink = CompilerLog::new(move |value| {
        captured_output.lock().unwrap().push_str(value);
    });
    let (output, status) = run_command(
        &launch(&executable, &arguments, working_directory.path(), &[]),
        Duration::from_secs(60),
        &sink,
    )
    .await
    .unwrap();
    assert!(status.success());
    assert!(output.contains("core-ok"));
    assert!(captured.lock().unwrap().contains("core-ok"));
}

#[test]
fn contained_command_child() {
    print!("core-ok");
}

#[tokio::test]
async fn compiler_deadline_covers_a_process_with_closed_output_on_windows_too() {
    let directory = TempDir::new().unwrap();
    let started = Instant::now();
    let arguments = [
        OsString::from("-e"),
        OsString::from(
            "require('fs').closeSync(1);require('fs').closeSync(2);setInterval(()=>{},1000)",
        ),
    ];
    let error = run_command(
        &launch(Path::new("node"), &arguments, directory.path(), &[]),
        Duration::from_millis(250),
        &CompilerLog::default(),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("timed out"));
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[tokio::test]
async fn compiler_completion_stops_descendants_holding_log_pipes() {
    let directory = TempDir::new().unwrap();
    let arguments = [OsString::from("-e"), OsString::from(
        "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',1,2]});process.stdout.write('compiled');process.exit(0)")];
    let (output, status) = run_command(
        &launch(Path::new("node"), &arguments, directory.path(), &[]),
        Duration::from_secs(60),
        &CompilerLog::default(),
    )
    .await
    .unwrap();
    assert!(status.success());
    assert_eq!(output, "compiled");
}

#[cfg(unix)]
#[tokio::test]
async fn contained_command_times_out() {
    let shell = PathBuf::from("/bin/sh").canonicalize().unwrap();
    let arguments = [OsString::from("-c"), OsString::from("sleep 30")];
    let error = run_command(
        &launch(&shell, &arguments, Path::new("/"), &[]),
        Duration::from_millis(50),
        &CompilerLog::default(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.kind(), ErrorKind::Build);
    assert!(error.to_string().contains("timed out"));
}

#[cfg(unix)]
#[tokio::test]
async fn compiler_crashes_are_named_in_the_log() {
    let shell = PathBuf::from("/bin/sh").canonicalize().unwrap();
    let arguments = [OsString::from("-c"), OsString::from("kill -ABRT $$")];
    let (_, status) = run_command(
        &launch(&shell, &arguments, Path::new("/"), &[]),
        Duration::from_secs(10),
        &CompilerLog::default(),
    )
    .await
    .unwrap();
    assert!(!status.success());
    assert!(compiler_crash_note(&status).unwrap().contains("SIGABRT"));
}

#[tokio::test]
async fn unset_variables_never_reach_the_compiler() {
    let executable = std::env::current_exe().unwrap();
    let arguments = [
        OsString::from("--exact"),
        OsString::from("native::tests::print_openin_any"),
        OsString::from("--nocapture"),
    ];
    let directory = TempDir::new().unwrap();
    let run = |unset: &'static [&'static str]| {
        let executable = executable.clone();
        let arguments = arguments.clone();
        let directory = directory.path().to_path_buf();
        async move {
            run_command(
                &Launch {
                    executable: &executable,
                    arguments: &arguments,
                    working_directory: &directory,
                    environment: &[],
                    unset,
                    variables: &[],
                },
                Duration::from_secs(60),
                &CompilerLog::default(),
            )
            .await
            .unwrap()
            .0
        }
    };
    assert!(run(&[]).await.contains("openin_any=p"));
    assert!(run(&["openin_any"]).await.contains("openin_any=unset"));
}

#[test]
fn print_openin_any() {
    match std::env::var("openin_any") {
        Ok(value) => print!("openin_any={value}"),
        Err(_) => print!("openin_any=unset"),
    }
}

#[test]
fn latexmk_runs_in_the_compile_directory_and_writes_to_the_build_directory() {
    let tools_directory = TempDir::new().unwrap();
    let latexmk = tools_directory.path().join(executable_name("latexmk"));
    std::fs::write(&latexmk, "tool").unwrap();
    let compiler = NativeCompiler::new(BuildTools {
        latexmk: Some(latexmk),
        ..BuildTools::default()
    });
    let directory = TempDir::new().unwrap();
    std::fs::create_dir(directory.path().join("paper")).unwrap();
    std::fs::write(directory.path().join("paper/main.tex"), "document").unwrap();
    let manifest = ProjectManifest {
        main_doc: "paper/main.tex".into(),
        engine: "latexmk".into(),
        tex_flavor: Some("pdflatex".into()),
        ..ProjectManifest::default()
    };
    let root = Workspace::from_manifest(directory.path(), manifest.clone()).unwrap();
    let root_command = compiler
        .command(
            &root.prepare_build().unwrap(),
            BuildOptions::default(),
            true,
        )
        .unwrap();
    let root_arguments = arguments(&root_command);
    assert!(root_arguments.contains(&"-outdir=./.oleafly/build".to_string()));
    assert_eq!(root_arguments.last().unwrap(), "./paper/main.tex");
    assert_eq!(root_command.working_directory, root.root());
    assert!(!environment(&root_command).contains_key("TEXMFOUTPUT"));

    let nested = Workspace::from_manifest(
        directory.path(),
        ProjectManifest {
            compile_dir: Some("paper".into()),
            ..manifest
        },
    )
    .unwrap();
    let nested_command = compiler
        .command(
            &nested.prepare_build().unwrap(),
            BuildOptions::default(),
            true,
        )
        .unwrap();
    let nested_arguments = arguments(&nested_command);
    assert!(nested_arguments.contains(&"-outdir=../.oleafly/build".to_string()));
    assert_eq!(nested_arguments.last().unwrap(), "./main.tex");
    assert_eq!(
        nested_command.working_directory,
        nested.root().join("paper")
    );
}

#[cfg(unix)]
#[test]
fn latexmk_writes_a_linked_folders_build_through_texmfoutput() {
    let tools_directory = TempDir::new().unwrap();
    let latexmk = tools_directory.path().join(executable_name("latexmk"));
    std::fs::write(&latexmk, "tool").unwrap();
    let compiler = NativeCompiler::new(BuildTools {
        latexmk: Some(latexmk),
        ..BuildTools::default()
    });
    let root = TempDir::new().unwrap();
    let project = root.path().join("thesis");
    std::fs::create_dir(&project).unwrap();
    std::fs::write(project.join("main.tex"), "document").unwrap();
    let workspace = Workspace::from_manifest_with_build(
        &project,
        ProjectManifest {
            main_doc: "main.tex".into(),
            engine: "latexmk".into(),
            tex_flavor: Some("pdflatex".into()),
            ..ProjectManifest::default()
        },
        oleafly_core::BuildLocation::External(external_build(root.path(), "linked-build")),
    )
    .unwrap();
    let build = workspace.prepare_build().unwrap();
    let command = compiler
        .command(&build, BuildOptions::default(), true)
        .unwrap();
    let absolute = build.build_directory().display().to_string();
    assert!(arguments(&command).contains(&format!("-outdir={absolute}")));
    assert_eq!(environment(&command).get("TEXMFOUTPUT"), Some(&absolute));
}

#[test]
fn relative_paths_climb_out_of_the_compile_directory() {
    assert_eq!(
        relative_to(Path::new("/p/paper/sub"), Path::new("/p/.oleafly/build")),
        Some(PathBuf::from("../../.oleafly/build"))
    );
    assert_eq!(
        relative_to(Path::new("/p"), Path::new("/p/.oleafly/build")),
        Some(PathBuf::from(".oleafly/build"))
    );
    assert_eq!(dotted(Path::new(".oleafly/build")), "./.oleafly/build");
    assert_eq!(dotted(Path::new("../.oleafly/build")), "../.oleafly/build");
}

#[test]
fn intermediate_files_seed_a_fresh_staging_folder() {
    let build = TempDir::new().unwrap();
    for name in [
        "_oleafly_entry.aux",
        "_oleafly_entry.toc",
        "chapter.aux",
        "_oleafly_entry.pdf",
        "_oleafly_entry.log",
    ] {
        std::fs::write(build.path().join(name), name).unwrap();
    }
    let staging = OutputStaging::create(build.path()).unwrap();
    seed_staging(build.path(), staging.path());
    let mut seeded: Vec<String> = std::fs::read_dir(staging.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    seeded.sort();
    assert_eq!(
        seeded,
        ["_oleafly_entry.aux", "_oleafly_entry.toc", "chapter.aux"]
    );
}
