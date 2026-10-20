use super::*;
use std::process::ExitStatus;

fn strings(args: Vec<OsString>) -> Vec<String> {
    args.into_iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect()
}

#[test]
fn tectonic_args_pin_the_bundle_to_the_oleafly_mirror() {
    let args = strings(tectonic_args(
        Path::new("out"),
        &[Path::new("src")],
        Path::new("main.tex"),
        Some(&tex_bundle_url()),
        EngineFlags::default(),
    ));
    let position = args
        .iter()
        .position(|arg| arg == "--bundle")
        .expect("--bundle flag present");
    assert_eq!(args[position + 1], tex_bundle_url());
    assert!(TEX_BUNDLE_MIRROR_URL.starts_with("https://mirrors.oleafly.com/"));
}

#[test]
fn offline_compiles_keep_the_bundle_pin_alongside_only_cached() {
    let flags = EngineFlags {
        offline: true,
        ..Default::default()
    };
    let args = strings(tectonic_args(
        Path::new("out"),
        &[Path::new("src")],
        Path::new("main.tex"),
        Some("https://m/x.tar"),
        flags,
    ));
    assert!(args.iter().any(|arg| arg == "--only-cached"));
    assert!(args.iter().any(|arg| arg == "--bundle"));
}

#[test]
fn bundle_fetch_failures_are_distinguished_from_tex_errors() {
    for log in [
        "error: this bundle isn't cached, and we couldn't get it from the internet",
        "caused by: unexpected HTTP response code 429 Too Many Requests for URL https://mirrors.oleafly.com/tex-bundles/tlextras-2022.0r0.tar",
        "note: failed to download \"msbm10.tfm\"",
    ] {
        assert!(is_bundle_fetch_failure(log), "{log}");
    }
    for log in [
        "! Undefined control sequence.\nl.19 \\oops",
        "main.tex:4: Package fontspec Error: The font \"Nope\" cannot be found.",
        "",
    ] {
        assert!(!is_bundle_fetch_failure(log), "{log:?}");
    }
}

#[test]
fn stripping_the_bundle_flag_removes_the_flag_and_its_url() {
    let args: Vec<String> = [
        "-X",
        "compile",
        "--bundle",
        "https://example.test/b.tar",
        "main.tex",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    let stripped = args_without_bundle(&args);
    assert_eq!(stripped, vec!["-X", "compile", "main.tex"]);
    assert_eq!(args_without_bundle(&stripped), stripped);

    let pandoc: Vec<OsString> = [
        "--standalone",
        "--pdf-engine-opt=--bundle",
        "--pdf-engine-opt=https://example.test/b.tar",
        "main.md",
    ]
    .into_iter()
    .map(OsString::from)
    .collect();
    assert_eq!(
        strings(args_without_bundle(&pandoc)),
        vec!["--standalone", "main.md"]
    );
}

#[test]
fn latex_wrapper_rejects_tex_interpolation_characters() {
    for path in [
        "main}.tex",
        "main%comment.tex",
        "main\\evil.tex",
        "main\n.tex",
    ] {
        assert!(validate_latex_main_document(path).is_err(), "{path:?}");
    }
    assert!(validate_latex_main_document("chapters/my paper-1.tex").is_ok());
}

#[test]
fn latexmk_absolute_paths_refuse_what_latexmk_would_hand_to_a_shell() {
    for safe in [
        "/Users/ada/.oleafly/linked/linked-x/build",
        "/Users/O'Brien/Jürgen Müller/論文/a#b%c~d&e{f}^g;h(i)[j],k:l!m",
    ] {
        assert_eq!(
            latexmk_absolute_path_text(Path::new(safe), false).as_deref(),
            Some(safe)
        );
    }
    for unsafe_path in [
        "/Users/a\"b/build",
        "/Users/a`b/build",
        "/Users/a$b/build",
        "/Users/a\\b/build",
        "/Users/a\nb/build",
        "relative/build",
        "/Users/ada/../build",
    ] {
        assert_eq!(
            latexmk_absolute_path_text(Path::new(unsafe_path), false),
            None,
            "{unsafe_path:?}"
        );
    }
    assert_eq!(
        latexmk_absolute_path_text(Path::new(r"\\?\C:\Users\ada\.oleafly\linked\x\build"), true)
            .as_deref(),
        Some("C:/Users/ada/.oleafly/linked/x/build")
    );
    for refused in [
        r"\\?\UNC\server\share\build",
        r"\\server\share\build",
        r"C:\Users\100%\build",
        r"C:\Users\a!b\build",
    ] {
        assert_eq!(
            latexmk_absolute_path_text(Path::new(refused), true),
            None,
            "{refused}"
        );
    }
}

#[test]
fn the_entry_shim_neutralizes_pdftex_primitives_and_inputs_the_main_document() {
    assert_eq!(
        latex_entry_source("chapters/my paper.tex").unwrap(),
        "\\ifdefined\\pdfglyphtounicode\\else\\def\\pdfglyphtounicode#1#2{}\\fi\n\\ifdefined\\pdfgentounicode\\else\\newcount\\pdfgentounicode\\fi\n\\input{\\detokenize{chapters/my paper.tex}}\n"
    );
    assert!(latex_entry_source("a}b.tex").is_err());
}

#[test]
fn tectonic_args_put_the_compile_directory_before_the_project_on_the_search_path() {
    let args = strings(tectonic_args(
        Path::new("/b"),
        &[Path::new("/p/paper"), Path::new("/p")],
        Path::new("/b/_oleafly_entry.tex"),
        Some("https://m/x.tar"),
        EngineFlags::default(),
    ));
    assert_eq!(&args[..4], ["-X", "compile", "--bundle", "https://m/x.tar"]);
    let first = args
        .iter()
        .position(|arg| arg == "search-path=/p/paper")
        .unwrap();
    assert!(first < args.iter().position(|arg| arg == "search-path=/p").unwrap());
    assert_eq!(args.last().unwrap(), "/b/_oleafly_entry.tex");
    assert!(args
        .windows(2)
        .any(|pair| pair == ["-Z", "continue-on-errors"]));
}

#[test]
fn shell_escape_is_restricted_except_on_miktex_or_when_trusted() {
    assert_eq!(shell_escape_arg(false, "texlive"), "-shell-restricted");
    assert_eq!(
        shell_escape_arg(false, "oleafly-tinytex"),
        "-shell-restricted"
    );
    assert_eq!(shell_escape_arg(false, "miktex"), "-no-shell-escape");
    assert_eq!(shell_escape_arg(true, "miktex"), "-shell-escape");
}

#[test]
fn latexmk_args_match_the_app_contract() {
    let args = latexmk_args(
        "./.oleafly/build",
        "./main.tex",
        ENTRY_STEM,
        TexFlavor::Lualatex,
        EngineFlags {
            halt_on_error: true,
            ..Default::default()
        },
        false,
        "texlive",
    );
    assert_eq!(&args[..2], ["-norc", "-shell-restricted"]);
    for expected in [
        "-lualatex",
        "-interaction=nonstopmode",
        "-synctex=1",
        "-outdir=./.oleafly/build",
        "-jobname=_oleafly_entry",
        "-halt-on-error",
        "-latexoption=--nosocket",
    ] {
        assert!(args.iter().any(|arg| arg == expected), "{expected}");
    }
    assert_eq!(args.last().unwrap(), "./main.tex");
}

#[test]
fn markdown_pdf_args_sandbox_filter_citeproc_and_bundle_pin() {
    let args = strings(markdown_pdf_args(&MarkdownPdfArgs {
        resource_argument: OsStr::new("--resource-path=/p"),
        tectonic: Path::new("/t/tectonic"),
        project: Path::new("/p"),
        output: Path::new("/b/out.pdf"),
        main: Path::new("/p/main.md"),
        bibliographies: &[PathBuf::from("sources/refs.bib")],
        bundle_url: Some("https://m/x.tar"),
    }));
    // A slash-relative bibliography comes out with the platform's separator.
    let bibliography = format!(
        "--bibliography={}",
        Path::new("/p").join("sources").join("refs.bib").display()
    );
    assert_eq!(
        args,
        [
            "--resource-path=/p",
            "--from=markdown",
            "--standalone",
            "--pdf-engine=/t/tectonic",
            "--pdf-engine-opt=--bundle",
            "--pdf-engine-opt=https://m/x.tar",
            "--pdf-engine-opt=-Zsearch-path=/p",
            "--output=/b/out.pdf",
            "--sandbox",
            "--lua-filter=oleafly-mermaid-figures.lua",
            "--citeproc",
            bibliography.as_str(),
            "--",
            "/p/main.md"
        ]
    );
}

#[test]
fn bibliographies_skip_generated_dirs_symlinks_and_placeholders() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    for (folder, file) in [
        ("refs", "a.bib"),
        ("node_modules", "x.bib"),
        (".oleafly", "y.bib"),
        (".git", "z.bib"),
    ] {
        std::fs::create_dir_all(root.join(folder)).unwrap();
        std::fs::write(root.join(folder).join(file), "@misc{a}").unwrap();
    }
    #[cfg(unix)]
    {
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("w.bib"), "@misc{w}").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("linked")).unwrap();
    }
    assert_eq!(
        discover_bibliographies(root).unwrap(),
        vec!["refs/a.bib".to_string()]
    );
}

#[test]
fn crash_notes_name_the_signal_or_exception() {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        assert!(compiler_crash_note(&ExitStatus::from_raw(libc::SIGSEGV))
            .unwrap()
            .contains("SIGSEGV"));
        assert!(compiler_crash_note(&ExitStatus::from_raw(0)).is_none());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::ExitStatusExt;
        assert!(compiler_crash_note(&ExitStatus::from_raw(0xC000_0005))
            .unwrap()
            .contains("0xC0000005"));
    }
}

#[test]
fn the_bundle_url_can_be_overridden_but_not_blanked() {
    static ENV: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = ENV
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let previous = std::env::var_os(TEX_BUNDLE_URL_VARIABLE);
    std::env::set_var(TEX_BUNDLE_URL_VARIABLE, " ");
    assert_eq!(tex_bundle_url(), TEX_BUNDLE_MIRROR_URL);
    std::env::set_var(TEX_BUNDLE_URL_VARIABLE, "https://x/y.tar");
    assert_eq!(tex_bundle_url(), "https://x/y.tar");
    match previous {
        Some(value) => std::env::set_var(TEX_BUNDLE_URL_VARIABLE, value),
        None => std::env::remove_var(TEX_BUNDLE_URL_VARIABLE),
    }
}

#[test]
fn dvi_compilers_need_their_engine_and_dvipdfmx_beside_latexmk() {
    let dir = tempfile::tempdir().unwrap();
    let tool = |name: &str| {
        let path = dir.path().join(crate::tex_distro::exe(name));
        std::fs::write(&path, b"tool").unwrap();
        path
    };
    let latexmk = tool("latexmk");
    assert_eq!(
        dvi_toolchain_missing(TexFlavor::Uplatex, &latexmk),
        Some("upLaTeX")
    );
    tool("uplatex");
    tool("dvipdfmx");
    assert_eq!(dvi_toolchain_missing(TexFlavor::Uplatex, &latexmk), None);
    assert_eq!(dvi_toolchain_missing(TexFlavor::Pdflatex, &latexmk), None);
}

#[test]
fn a_switched_latexmk_forces_one_full_rebuild() {
    let dir = tempfile::tempdir().unwrap();
    let latexmk = dir.path().join("latexmk");
    std::fs::write(&latexmk, b"tool").unwrap();
    let out = dir.path().join("build");
    assert!(latexmk_binary_changed(&out, &latexmk));
    record_latexmk_binary(&out, &latexmk);
    assert!(!latexmk_binary_changed(&out, &latexmk));
}
