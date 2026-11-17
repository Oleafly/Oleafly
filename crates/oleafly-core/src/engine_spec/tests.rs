use super::*;
use std::process::ExitStatus;

fn strings(args: Vec<OsString>) -> Vec<String> {
    args.into_iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect()
}

#[test]
fn tectonic_args_pin_the_bundle_to_the_oleafly_mirror() {
    // Read once: the override test below sets the variable while tests run.
    let bundle = tex_bundle_url();
    let args = strings(tectonic_args(
        Path::new("out"),
        &[Path::new("src")],
        Path::new("main.tex"),
        Some(&bundle),
        EngineFlags::default(),
    ));
    let position = args
        .iter()
        .position(|arg| arg == "--bundle")
        .expect("--bundle flag present");
    assert_eq!(args[position + 1], bundle);
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

const WARM_CACHE_FAILURE: &str = concat!(
    "warning: failure fetching \"biblatex.sty\" from network (1/3)\n",
    "caused by: unexpected HTTP response code 403 Forbidden for URL https://mirrors.oleafly.com/tex-bundles/tlextras-2022.0r0.tar\n",
    "warning: open of input biblatex.sty failed\n",
    "caused by: failed to download \"biblatex.sty\"; please check your network connection.\n",
);

#[test]
fn a_warm_cache_fetch_failure_retries_even_when_the_compile_exits_zero() {
    let transcript = format!("note: Running TeX ...\n{WARM_CACHE_FAILURE}! LaTeX Error: File `biblatex.sty' not found.\n");
    assert!(bundle_retry_needed(true, &transcript));
    assert!(bundle_retry_needed(false, &transcript));
}

#[test]
fn a_plain_tex_error_never_retries_and_a_cold_failure_retries_only_on_failure() {
    let tex_error = "! LaTeX Error: File `nothere.sty' not found.\n";
    assert!(!bundle_retry_needed(true, tex_error));
    assert!(!bundle_retry_needed(false, tex_error));
    let cold = "error: this bundle isn't cached, and we couldn't get it from the internet";
    assert!(!bundle_retry_needed(true, cold));
    assert!(bundle_retry_needed(false, cold));
}

#[test]
fn a_failed_retry_never_replaces_a_first_run_that_built() {
    assert!(bundle_retry_replaces_first_run(true, true));
    assert!(!bundle_retry_replaces_first_run(true, false));
    assert!(bundle_retry_replaces_first_run(false, true));
    assert!(bundle_retry_replaces_first_run(false, false));
}

#[test]
fn the_excerpt_keeps_the_fetch_lines_and_stays_small() {
    let transcript = format!("noise\n{}more noise\n", WARM_CACHE_FAILURE.repeat(200));
    let excerpt = bundle_fetch_excerpt(&transcript).unwrap();
    assert!(excerpt.starts_with("warning: failure fetching"));
    assert!(excerpt.contains("unexpected HTTP response code 403"));
    assert!(excerpt.contains("please check your network connection"));
    assert!(!excerpt.contains("noise"));
    assert!(excerpt.len() <= 4 * 1024);
    assert_eq!(
        bundle_fetch_excerpt("! Undefined control sequence.\n"),
        None
    );
}

#[test]
fn prefetch_file_names_match_what_tectonic_writes() {
    assert_eq!(
        tectonic_prefetch_file(TEX_BUNDLE_MIRROR_URL),
        "https,58,,47,,47,mirrors.oleafly.com,47,tex-bundles,47,tlextras-2022.0r0.tar.prefetch"
    );
    assert_eq!(
        tectonic_prefetch_file(TEX_BUNDLE_UPSTREAM_URL),
        "https,58,,47,,47,relay.fullyjustified.net,47,default_bundle_v33.tar.prefetch"
    );
}

#[test]
fn the_prefetch_list_fits_what_tectonic_reads_and_starts_with_the_format() {
    let names: Vec<&str> = TECTONIC_PREFETCH_LIST.lines().collect();
    assert!(names.len() <= 512, "{}", names.len());
    assert_eq!(names[0], "tectonic-format-latex.tex");
    assert!(names
        .iter()
        .all(|name| !name.is_empty() && !name.contains('/')));
}

#[test]
fn the_prefetch_list_carries_what_a_markdown_symbol_needs_offline() {
    let names: Vec<&str> = TECTONIC_PREFETCH_LIST.lines().collect();
    for name in [
        "newunicodechar.sty",
        "FreeSerif.otf",
        "FreeSerifBold.otf",
        "FreeSerifItalic.otf",
        "FreeSerifBoldItalic.otf",
        "DejaVuSans.ttf",
        "cmunrm.otf",
        "cmunbx.otf",
        "cmunti.otf",
        "cmunbi.otf",
        "cmunss.otf",
        "cmunsx.otf",
        "cmunsi.otf",
        "cmunso.otf",
        "cmuntt.otf",
        "cmuntb.otf",
        "cmunit.otf",
        "cmuntx.otf",
    ] {
        assert!(names.contains(&name), "{name}");
    }
}

#[test]
fn seeding_writes_a_list_once_and_leaves_tectonics_own_list_alone() {
    let dir = tempfile::tempdir().unwrap();
    let bundles = dir.path().join("bundles");
    std::fs::create_dir_all(bundles.join("data")).unwrap();
    let own = bundles
        .join("data")
        .join(tectonic_prefetch_file("https://own.example/b.tar"));
    std::fs::write(&own, "amsmath.sty\n").unwrap();
    write_tectonic_prefetch(
        &bundles,
        &["https://own.example/b.tar", TEX_BUNDLE_UPSTREAM_URL],
    );
    assert_eq!(std::fs::read_to_string(&own).unwrap(), "amsmath.sty\n");
    let seeded = std::fs::read_to_string(
        bundles
            .join("data")
            .join(tectonic_prefetch_file(TEX_BUNDLE_UPSTREAM_URL)),
    )
    .unwrap();
    assert!(seeded.starts_with("tectonic-format-latex.tex\n"));
    assert!(!seeded.contains('\r'));
}

#[test]
fn seeding_a_fresh_install_creates_the_cache_folder_tectonic_named() {
    let dir = tempfile::tempdir().unwrap();
    let bundles = dir.path().join("Tectonic").join("bundles");
    write_tectonic_prefetch(&bundles, &[TEX_BUNDLE_MIRROR_URL, TEX_BUNDLE_UPSTREAM_URL]);
    for url in [TEX_BUNDLE_MIRROR_URL, TEX_BUNDLE_UPSTREAM_URL] {
        let seeded =
            std::fs::read_to_string(bundles.join("data").join(tectonic_prefetch_file(url)))
                .unwrap();
        assert!(seeded.starts_with("tectonic-format-latex.tex\n"));
    }
}

#[test]
fn seeding_gives_up_quietly_when_the_cache_folder_cant_be_created() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("not-a-folder");
    std::fs::write(&file, "").unwrap();
    write_tectonic_prefetch(&file.join("bundles"), &[TEX_BUNDLE_UPSTREAM_URL]);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "");
}

#[test]
fn the_cache_folder_is_the_last_absolute_line() {
    let dir = tempfile::tempdir().unwrap();
    let output = format!(
        "{}\n\nnote: \"version 2\" Tectonic command-line interface activated\n",
        dir.path().display()
    );
    assert_eq!(
        tectonic_bundle_cache_dir(&output).as_deref(),
        Some(dir.path())
    );
    assert_eq!(tectonic_bundle_cache_dir("relative/bundles\n"), None);
    assert_eq!(tectonic_bundle_cache_dir(""), None);
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
        [
            "\\ifdefined\\pdfglyphtounicode\\else\\def\\pdfglyphtounicode#1#2{}\\fi\n\\ifdefined\\pdfgentounicode\\else\\newcount\\pdfgentounicode\\fi\n\\ifdefined\\pdfminorversion\\else\\newcount\\pdfminorversion\\fi\n\\ifdefined\\pdfmajorversion\\else\\newcount\\pdfmajorversion\\fi\n\\ifdefined\\pdfcompresslevel\\else\\newcount\\pdfcompresslevel\\fi\n\\ifdefined\\pdfobjcompresslevel\\else\\newcount\\pdfobjcompresslevel\\fi\n\\ifdefined\\pdfsuppressptexinfo\\else\\newcount\\pdfsuppressptexinfo\\fi\n\\ifdefined\\pdfsuppresswarningpagegroup\\else\\newcount\\pdfsuppresswarningpagegroup\\fi\n\\ifdefined\\pdfinclusioncopyfonts\\else\\newcount\\pdfinclusioncopyfonts\\fi\n\\ifdefined\\pdfinclusionerrorlevel\\else\\newcount\\pdfinclusionerrorlevel\\fi\n\\ifdefined\\pdfimageresolution\\else\\newcount\\pdfimageresolution\\fi\n\\ifdefined\\pdfpkresolution\\else\\newcount\\pdfpkresolution\\fi\n\\ifdefined\\pdfdecimaldigits\\else\\newcount\\pdfdecimaldigits\\fi\n\\ifdefined\\pdfmapfile\\else\\def\\pdfmapfile#1{}\\fi\n\\ifdefined\\pdfmapline\\else\\def\\pdfmapline#1{}\\fi\n\\ifdefined\\pdftrailerid\\else\\def\\pdftrailerid#1{}\\fi\n\\ifdefined\\pdfinfo\\else\\def\\pdfinfo#1{}\\fi\n\\ifdefined\\DocumentMetadata\\else\\def\\DocumentMetadata#1{\\typeout{Tagging is off: tagged PDF needs LaTeX 2025-11-01 or newer.}}\\fi\n\\ifdefined\\pdfoutput\\AddToHook{package/iftex/before}{\\global\\pdfoutput=0 }\\fi\n",
            T1_ENCODING_SHIM,
            "\\input{\\detokenize{chapters/my paper.tex}}\n"
        ]
        .concat()
    );
    assert!(latex_entry_source("a}b.tex").is_err());
}

#[test]
fn the_entry_neutralizes_pdfoutput_before_iftex_reads_it() {
    let entry = latex_entry_source("main.tex").unwrap();
    let hook = entry.find("\\AddToHook{package/iftex/before}").unwrap();
    assert!(hook < entry.find("\\input{").unwrap());
    assert!(entry.starts_with("\\ifdefined\\pdfglyphtounicode"));
    assert!(entry.contains("\\ifdefined\\pdfoutput\\AddToHook"));
    assert!(!entry.contains("\\def\\pdfoutput"));
    assert!(!entry.contains("\\newcount\\pdfoutput"));
}

#[test]
fn the_entry_prints_the_notice_the_tagging_check_reads() {
    let entry = latex_entry_source("main.tex").unwrap();
    assert!(entry.contains(&format!(
        "\\def\\DocumentMetadata#1{{\\typeout{{{TAGGING_SKIPPED_NOTICE}}}}}"
    )));
    assert_eq!(
        TAGGING_SKIPPED_NOTICE,
        "Tagging is off: tagged PDF needs LaTeX 2025-11-01 or newer."
    );
}

#[test]
fn the_t1_hook_runs_before_the_main_document_and_only_touches_t1() {
    let entry = latex_entry_source("main.tex").unwrap();
    let hook = entry.find("\\AddToHook{package/fontenc/after}").unwrap();
    let input = entry.find("\\input{").unwrap();
    assert!(hook < input);
    assert!(entry.contains("\\def\\OleaflyEightBitEncoding{T1}"));
    assert!(entry.contains("\\ifx\\OleaflyRequestedEncoding\\OleaflyEightBitEncoding"));
    assert!(entry.contains(&format!("\\wlog{{{T1_KEPT_NOTE}}}")));
    let family_hook = "\\AddToHook{begindocument/end}{\\ifx\\OleaflyRequestedEncoding\\OleaflyEightBitEncoding\\ifdefined\\OleaflyRevert\\else\\DeclareRobustCommand\\fontfamily[1]{\\expandafter\\edef\\csname f@family\\endcsname{#1}\\OleaflyIfEncodingFamily{TU}{#1}{}{\\OleaflyIfEncodingFamily{T1}{#1}{\\fontencoding{T1}}{}}}\\fi\\fi}\n";
    let at = entry.find(family_hook).unwrap();
    assert!(entry.find("\\AddToHook{begindocument/before}").unwrap() < at);
    assert!(at < input);
}

#[test]
fn an_offline_entry_leaves_t1_documents_on_their_own_fonts() {
    let offline = latex_entry_source_with("main.tex", None, false).unwrap();
    assert!(!offline.contains("\\OleaflyEightBitEncoding"));
    assert!(!offline.contains("\\AddToHook{package/fontenc/after}"));
    assert_eq!(
        offline,
        latex_entry_source("main.tex")
            .unwrap()
            .replace(T1_ENCODING_SHIM, "")
    );
    assert!(offline.ends_with("\\input{\\detokenize{main.tex}}\n"));
}

#[test]
fn tex_default_file_names_are_lowercase_for_case_sensitive_systems() {
    let files = tex_default_files();
    assert!(files.iter().any(|(name, _)| name == "ctexopts.cfg"));
    assert!(files.iter().any(|(name, _)| name == "tuptm.fd"));
    for (name, _) in &files {
        assert_eq!(*name, name.to_lowercase());
    }
}

#[test]
fn the_ctex_default_sets_only_the_fontset() {
    let files = tex_default_files();
    let (_, cfg) = files
        .iter()
        .find(|(name, _)| name == "ctexopts.cfg")
        .unwrap();
    assert!(cfg.starts_with("\\ProvidesExplFile{ctexopts.cfg}"));
    assert!(cfg.contains("\\ctex_set:nn { option } { fontset = fandol }"));
}

#[test]
fn tu_font_definitions_follow_the_stock_form() {
    let files = tex_default_files();
    let definition = |name: &str| {
        files
            .iter()
            .find(|(file, _)| file == name)
            .map(|(_, contents)| contents.as_str())
            .unwrap()
    };
    let times = definition("tuptm.fd");
    assert!(times.starts_with("\\ProvidesFile{tuptm.fd}\n\\DeclareFontFamily{TU}{ptm}{}\n"));
    assert!(times.contains(
        "\\DeclareFontShape{TU}{ptm}{m}{n}{<->\\UnicodeFontFile{texgyretermes-regular}{\\UnicodeFontTeXLigatures}}{}"
    ));
    assert!(times.contains(
        "\\DeclareFontShape{TU}{ptm}{m}{sl}{<->\\UnicodeFontFile{texgyretermes-regular}{\\UnicodeFontTeXLigatures;slant=0.167}}{}"
    ));
    assert!(times.contains(
        "\\DeclareFontShape{TU}{ptm}{b}{it}{<->\\UnicodeFontFile{texgyretermes-bolditalic}{\\UnicodeFontTeXLigatures}}{}"
    ));
    assert!(times.contains("\\DeclareFontShape{TU}{ptm}{bx}{n}{<->ssub * ptm/b/n}{}"));
    let courier = definition("tupcr.fd");
    assert!(courier.contains("\\DeclareFontFamily{TU}{pcr}{\\hyphenchar\\font=-1}"));
    assert!(courier.contains(
        "\\DeclareFontShape{TU}{pcr}{m}{n}{<->\\UnicodeFontFile{texgyrecursor-regular}{}}{}"
    ));
    assert!(courier.contains(
        "\\DeclareFontShape{TU}{pcr}{m}{sc}{<->\\UnicodeFontFile{texgyrecursor-regular}{+smcp}}{}"
    ));
}

#[test]
fn writing_tex_defaults_is_repeatable_and_keeps_unrelated_files() {
    let directory = tempfile::tempdir().unwrap();
    let defaults = directory.path().join(TEX_DEFAULTS_DIR);
    write_tex_defaults(&defaults).unwrap();
    let cfg = defaults.join("ctexopts.cfg");
    let first = std::fs::metadata(&cfg).unwrap().modified().unwrap();
    std::fs::write(defaults.join("unrelated.txt"), "kept").unwrap();
    write_tex_defaults(&defaults).unwrap();
    assert_eq!(std::fs::metadata(&cfg).unwrap().modified().unwrap(), first);
    assert!(defaults.join("unrelated.txt").is_file());
    assert_eq!(
        std::fs::read_dir(&defaults).unwrap().count(),
        tex_default_files().len() + 1
    );
    std::fs::write(&cfg, "stale").unwrap();
    write_tex_defaults(&defaults).unwrap();
    assert_ne!(std::fs::read_to_string(&cfg).unwrap(), "stale");
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
fn shell_escape_is_restricted_unless_trusted() {
    assert_eq!(shell_escape_arg(false, "texlive"), "-shell-restricted");
    assert_eq!(
        shell_escape_arg(false, "oleafly-tinytex"),
        "-shell-restricted"
    );
    assert_eq!(shell_escape_arg(false, "miktex"), "-no-shell-escape");
    assert_eq!(shell_escape_arg(true, "miktex"), "-shell-escape");
    assert_eq!(shell_escape_arg(true, "texlive"), "-shell-escape");
}

#[test]
fn restricted_miktex_runs_drop_findtexmf_from_the_allow_list() {
    assert_eq!(
        MIKTEX_SHELL_COMMANDS_VARIABLE,
        "MIKTEX_MIKTEX_CORE_ALLOWEDSHELLCOMMANDS"
    );
    let separator = if cfg!(windows) { ';' } else { ':' };
    let commands = restricted_miktex_shell_commands();
    let commands: Vec<&str> = commands.split(separator).collect();
    assert!(commands.contains(&"miktex-epstopdf"));
    assert!(commands.contains(&"makeindex"));
    assert!(commands.contains(&"kpsewhich"));
    assert!(!commands.iter().any(|command| command.contains("findtexmf")));
}

#[test]
fn a_failed_latexmk_run_forgets_only_its_database() {
    let dir = tempfile::tempdir().unwrap();
    let names = [
        "_oleafly_entry.fdb_latexmk",
        "_oleafly_entry.aux",
        "_oleafly_entry.log",
        "fig.v2.fdb_latexmk",
        LATEXMK_BINARY_MARKER,
    ];
    for name in names {
        std::fs::write(dir.path().join(name), b"state").unwrap();
    }
    forget_latexmk_run(&dir.path().join("_oleafly_entry.log"));
    assert!(!dir.path().join("_oleafly_entry.fdb_latexmk").exists());
    for name in &names[1..] {
        assert!(dir.path().join(name).is_file(), "{name}");
    }
    forget_latexmk_run(&dir.path().join("fig.v2.log"));
    assert!(!dir.path().join("fig.v2.fdb_latexmk").exists());
    forget_latexmk_run(&dir.path().join("_oleafly_entry.log"));
}

#[cfg(unix)]
#[test]
fn forgetting_a_latexmk_run_unlinks_a_planted_link_without_following_it() {
    let dir = tempfile::tempdir().unwrap();
    let victim = dir.path().join("victim");
    std::fs::write(&victim, b"keep").unwrap();
    let database = dir.path().join("_oleafly_entry.fdb_latexmk");
    std::os::unix::fs::symlink(&victim, &database).unwrap();
    forget_latexmk_run(&dir.path().join("_oleafly_entry.log"));
    assert!(std::fs::symlink_metadata(&database).is_err());
    assert_eq!(std::fs::read(&victim).unwrap(), b"keep");
}

#[test]
fn latexmk_paths_accept_an_apostrophe_and_name_what_they_refuse() {
    assert_eq!(
        latexmk_relative_path_arg(Path::new("l'article.tex")).unwrap(),
        "./l'article.tex"
    );
    assert_eq!(
        latexmk_relative_path_arg(Path::new("Bob's thesis/main.tex")).unwrap(),
        "./Bob's thesis/main.tex"
    );
    for refused in [
        "paper`touch marker`.tex",
        "paper\";touch marker;\".tex",
        "paper';touch marker;'.tex",
        "paper|touch marker.tex",
    ] {
        let error = latexmk_relative_path_arg(Path::new(refused)).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidInput);
        assert!(error.to_string().contains(refused), "{error}");
    }
}

#[test]
fn the_wrapper_refusal_names_the_main_document() {
    let error = validate_latex_main_document("notes & drafts.tex").unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidInput);
    assert!(error.to_string().contains("notes & drafts.tex"), "{error}");
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
    assert_eq!(
        &args[..5],
        [
            "-norc",
            "-shell-restricted",
            "-lualatex",
            "-r",
            "./.oleafly/build/.oleafly-latexmkrc"
        ]
    );
    for expected in [
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
fn no_perl_or_quoting_ever_reaches_the_latexmk_command_line() {
    for flavor in TexFlavor::ALL {
        for out_dir in [
            "./.oleafly/build",
            "../.oleafly/build",
            "C:/Users/ana/AppData/Roaming/oleafly/linked/x/build",
        ] {
            for (shell_escape, halt_on_error, distribution) in [
                (false, false, "texlive"),
                (true, true, "texlive"),
                (false, true, "tinytex"),
                (false, false, "oleafly-tinytex"),
                (false, false, "miktex"),
                (true, false, "miktex"),
                (false, false, "other"),
            ] {
                let args = latexmk_args(
                    out_dir,
                    "./main.tex",
                    ENTRY_STEM,
                    flavor,
                    EngineFlags {
                        halt_on_error,
                        ..Default::default()
                    },
                    shell_escape,
                    distribution,
                );
                for arg in &args {
                    assert_ne!(arg, "-e", "{flavor:?} {args:?}");
                    assert!(
                        !arg.contains(['\\', '"', '$', '%', '\'', '\n', ';', '{', '}']),
                        "{flavor:?} {arg}"
                    );
                }
                let rc = args.iter().position(|arg| arg == "-r").unwrap();
                assert_eq!(
                    args[rc + 1],
                    format!("{out_dir}/{}", latexmk_rc_file(flavor))
                );
                assert_eq!(args.iter().filter(|arg| *arg == "-r").count(), 1);
                assert!(args.contains(&format!("-outdir={out_dir}")));
            }
        }
    }
}

#[test]
fn every_flavor_keeps_its_own_arguments_and_its_rc_settings() {
    for flavor in TexFlavor::ALL {
        let args = latexmk_args(
            "./.oleafly/build",
            "./main.tex",
            ENTRY_STEM,
            flavor,
            EngineFlags::default(),
            false,
            "texlive",
        );
        let flavor_args = flavor.latexmk_args();
        assert_eq!(&args[2..2 + flavor_args.len()], &flavor_args[..]);
        let rc = latexmk_rc(flavor);
        assert!(rc.starts_with(&flavor.latexmk_rc_settings()));
        for dependency in [
            "add_cus_dep(q/glo/, q/gls/, 0, q/oleafly_glo/);",
            "add_cus_dep(q/acn/, q/acr/, 0, q/oleafly_acn/);",
            "add_cus_dep(q/nlo/, q/nls/, 0, q/oleafly_nlo/);",
            "add_cus_dep(q/slo/, q/sls/, 0, q/oleafly_slo/);",
            "add_cus_dep(q/aux/, q/glstex/, 0, q/oleafly_bib2gls/);",
        ] {
            assert!(
                rc.lines().any(|line| line == dependency),
                "{dependency} is missing for {flavor:?}"
            );
        }
        assert!(!rc.contains("makeglossaries"));
    }
}

#[test]
fn glossary_rules_read_the_style_file_the_document_named() {
    let rc = latexmk_rc(TexFlavor::Pdflatex);
    assert!(rc.contains(r"/\\\@istfilename\{([^}]+\.ist)\}/"));
    assert!(rc.contains(r"/\\\@glsorder\{letter\}/"));
    assert!(rc.contains(r"/^\\glossaryentry/"));
    assert!(rc.contains("$glossary ? undef : q/nomencl.ist/"));
    assert!(rc.contains("oleafly_mi($_[0], undef, q/slg/, q/sls/, q/slo/)"));
    assert!(rc.contains("split(q/ /, $makeindex"));
}

#[test]
fn the_latexmk_rc_compiles_under_perl_for_every_flavor() {
    let required =
        std::env::var_os("CI").is_some() || std::env::var_os("OLEAFLY_REQUIRE_REAL_TEX").is_some();
    let Some(perl) = std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .find_map(|dir| crate::tex_distro::find_tool_in_dir(&dir, "perl"))
    }) else {
        assert!(
            !required,
            "perl must be on PATH to check the latexmk rc file"
        );
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    for flavor in TexFlavor::ALL {
        write_latexmk_rc(dir.path(), flavor).unwrap();
        let rc = dir.path().join(latexmk_rc_file(flavor));
        let output = std::process::Command::new(&perl)
            .arg("-w")
            .arg("-c")
            .arg(&rc)
            .output()
            .unwrap();
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(output.status.success(), "{flavor:?}: {stderr}");
        assert!(stderr.contains("syntax OK"), "{flavor:?}: {stderr}");
        assert!(
            !stderr.contains("Possible unintended interpolation"),
            "{flavor:?}: {stderr}"
        );
        assert!(!stderr.contains("Unterminated"), "{flavor:?}: {stderr}");
    }
    let collapsed = dir.path().join("collapsed.rc");
    std::fs::write(
        &collapsed,
        latexmk_rc(TexFlavor::Pdflatex).replace(r"\\", r"\"),
    )
    .unwrap();
    let output = std::process::Command::new(&perl)
        .arg("-w")
        .arg("-c")
        .arg(&collapsed)
        .output()
        .unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!output.status.success(), "{stderr}");
    assert!(stderr.contains("Unterminated \\g"), "{stderr}");
}

#[test]
fn the_rc_file_replaces_a_planted_one_and_moves_with_the_out_dir() {
    let dir = tempfile::tempdir().unwrap();
    let rc = dir.path().join(latexmk_rc_file(TexFlavor::Uplatex));
    std::fs::write(&rc, "system(q/rm -rf ~/)").unwrap();
    write_latexmk_rc(dir.path(), TexFlavor::Uplatex).unwrap();
    assert_eq!(
        std::fs::read_to_string(&rc).unwrap(),
        latexmk_rc(TexFlavor::Uplatex)
    );
    let mut args = latexmk_args(
        "./.oleafly/build",
        "./paper/main.tex",
        ENTRY_STEM,
        TexFlavor::Pdflatex,
        EngineFlags::default(),
        false,
        "texlive",
    );
    assert!(set_latexmk_out_dir(
        &mut args,
        "/tmp/project/.oleafly/build"
    ));
    assert!(args.contains(&"-outdir=/tmp/project/.oleafly/build".to_string()));
    let at = args.iter().position(|arg| arg == "-r").unwrap();
    assert_eq!(
        args[at + 1],
        "/tmp/project/.oleafly/build/.oleafly-latexmkrc"
    );
    assert!(!set_latexmk_out_dir(&mut ["-norc".to_string()], "/x"));
    let mut uplatex = latexmk_args(
        "./.oleafly/build",
        "./main.tex",
        ENTRY_STEM,
        TexFlavor::Uplatex,
        EngineFlags::default(),
        false,
        "texlive",
    );
    assert!(set_latexmk_out_dir(&mut uplatex, "/tmp/p/.oleafly/build"));
    assert!(uplatex.contains(&"/tmp/p/.oleafly/build/.oleafly-uplatex-latexmkrc".to_string()));
}

#[test]
fn builds_sharing_a_folder_never_rewrite_each_others_rc_file() {
    for first in TexFlavor::ALL {
        for second in TexFlavor::ALL {
            if latexmk_rc_file(first) == latexmk_rc_file(second) {
                assert_eq!(
                    latexmk_rc(first),
                    latexmk_rc(second),
                    "{first:?} {second:?}"
                );
            }
        }
    }
    assert_ne!(
        latexmk_rc_file(TexFlavor::Uplatex),
        latexmk_rc_file(TexFlavor::Pdflatex)
    );
    assert_ne!(
        latexmk_rc_file(TexFlavor::Platex),
        latexmk_rc_file(TexFlavor::Uplatex)
    );
}

#[test]
fn a_shipped_bibliography_changes_only_the_entry_line_that_reads_it() {
    let plain = latex_entry_source("paper/main.tex").unwrap();
    assert_eq!(
        latex_entry_source_with("paper/main.tex", None, true).unwrap(),
        plain
    );
    let shipped = latex_entry_source_with("paper/main.tex", Some("paper/main.bbl"), true).unwrap();
    let hook = "\\AddToHook{begindocument/end}{\\renewcommand{\\bibliography}[1]{\\renewcommand{\\bibliography}[1]{}\\input{\\detokenize{paper/main.bbl}}}}\n";
    assert_eq!(shipped.replace(hook, ""), plain);
    assert!(shipped.ends_with(&format!(
        "{hook}\\input{{\\detokenize{{paper/main.tex}}}}\n"
    )));
    assert!(latex_entry_source_with("paper/main}.tex", Some("x.bbl"), true).is_err());
}

#[test]
fn markdown_pdf_args_sandbox_filter_citeproc_and_bundle_pin() {
    let args = strings(markdown_pdf_args(&MarkdownPdfArgs {
        resource_argument: OsStr::new("--resource-path=/p"),
        tectonic: Path::new("/t/tectonic"),
        project: Path::new("/p"),
        search_folders: &[PathBuf::from("/p")],
        output: Path::new("/b/out.pdf"),
        main: Path::new("/p/main.md"),
        bibliographies: &[PathBuf::from("sources/refs.bib")],
        bundle_url: Some("https://m/x.tar"),
        layout: MarkdownLayout::default(),
    }));
    let bibliography = format!(
        "--metadata=oleafly-fallback-bibliography={}",
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
            "--lua-filter=oleafly-image-compat.lua",
            "--lua-filter=oleafly-markdown-marks.lua",
            "--lua-filter=oleafly-markdown-bibliography.lua",
            bibliography.as_str(),
            "--citeproc",
            "--lua-filter=oleafly-citation-marks.lua",
            "--lua-filter=oleafly-default-fonts.lua",
            "--",
            "/p/main.md"
        ]
    );
}

#[test]
fn markdown_pdf_args_search_the_main_folder_before_the_project() {
    let args = strings(markdown_pdf_args(&MarkdownPdfArgs {
        resource_argument: OsStr::new("--resource-path=/p/notes:/p"),
        tectonic: Path::new("/t/tectonic"),
        project: Path::new("/p"),
        search_folders: &[PathBuf::from("/p/notes"), PathBuf::from("/p")],
        output: Path::new("/b/out.pdf"),
        main: Path::new("/p/notes/main.md"),
        bibliographies: &[],
        bundle_url: None,
        layout: MarkdownLayout::default(),
    }));
    let position = |wanted: &str| args.iter().position(|arg| arg == wanted).unwrap();
    assert!(
        position("--pdf-engine-opt=-Zsearch-path=/p/notes")
            < position("--pdf-engine-opt=-Zsearch-path=/p")
    );
    assert!(!args.iter().any(|arg| arg.starts_with("--bibliography")));
}

#[test]
fn citeproc_sits_between_the_bibliography_filter_and_the_citation_marks() {
    let args = strings(markdown_pdf_args(&MarkdownPdfArgs {
        resource_argument: OsStr::new("--resource-path=/p"),
        tectonic: Path::new("/t/tectonic"),
        project: Path::new("/p"),
        search_folders: &[PathBuf::from("/p")],
        output: Path::new("/b/out.pdf"),
        main: Path::new("/p/main.md"),
        bibliographies: &[],
        bundle_url: None,
        layout: MarkdownLayout::default(),
    }));
    let position = |wanted: String| args.iter().position(|arg| *arg == wanted).unwrap();
    let citeproc = position("--citeproc".to_owned());
    assert!(position(format!("--lua-filter={MARKDOWN_BIBLIOGRAPHY_FILTER_NAME}")) < citeproc);
    assert_eq!(
        position(format!("--lua-filter={CITATION_MARKS_FILTER_NAME}")),
        citeproc + 1
    );
    assert!(position(format!("--lua-filter={DEFAULT_FONTS_FILTER_NAME}")) > citeproc);
}

fn layout_args(layout: MarkdownLayout) -> Vec<String> {
    strings(markdown_pdf_args(&MarkdownPdfArgs {
        resource_argument: OsStr::new("--resource-path=/p"),
        tectonic: Path::new("/t/tectonic"),
        project: Path::new("/p"),
        search_folders: &[PathBuf::from("/p")],
        output: Path::new("/b/out.pdf"),
        main: Path::new("/p/main.md"),
        bibliographies: &[],
        bundle_url: None,
        layout,
    }))
}

fn of_kind(kind: MarkdownKind) -> MarkdownLayout {
    MarkdownLayout {
        kind,
        ..MarkdownLayout::default()
    }
}

fn after_citeproc(args: &[String]) -> Vec<&str> {
    let citeproc = args.iter().position(|arg| arg == "--citeproc").unwrap();
    assert_eq!(
        args[citeproc + 1],
        format!("--lua-filter={CITATION_MARKS_FILTER_NAME}")
    );
    args[citeproc + 2..args.len() - 3]
        .iter()
        .map(String::as_str)
        .collect()
}

#[test]
fn an_article_keeps_the_plain_pandoc_arguments() {
    for layout in [MarkdownLayout::default(), of_kind(MarkdownKind::Article)] {
        let args = layout_args(layout);
        assert!(!args.iter().any(|arg| arg.starts_with("--to=")));
        assert_eq!(after_citeproc(&args), Vec::<&str>::new());
    }
}

#[test]
fn slides_and_posters_are_written_as_beamer() {
    let slides = layout_args(of_kind(MarkdownKind::Slides));
    assert_eq!(
        slides[1..4],
        ["--from=markdown", "--to=beamer", "--standalone"]
    );
    assert_eq!(
        after_citeproc(&slides),
        [
            "--slide-level=2",
            "--metadata=oleafly-document-kind=slides",
            "--lua-filter=oleafly-document-kind.lua"
        ]
    );
    let poster = layout_args(of_kind(MarkdownKind::Poster));
    assert!(poster.iter().any(|arg| arg == "--to=beamer"));
    assert_eq!(
        after_citeproc(&poster)[..2],
        ["--slide-level=0", "--metadata=oleafly-document-kind=poster"]
    );
    let tuned = layout_args(MarkdownLayout {
        kind: MarkdownKind::Slides,
        slide_level: Some(1),
        declares_class: false,
    });
    assert_eq!(after_citeproc(&tuned)[0], "--slide-level=1");
}

#[test]
fn reports_and_books_open_with_chapters_unless_the_class_is_named() {
    for (kind, name) in [
        (MarkdownKind::Report, "report"),
        (MarkdownKind::Book, "book"),
    ] {
        let args = layout_args(of_kind(kind));
        assert!(!args.iter().any(|arg| arg.starts_with("--to=")));
        assert_eq!(
            after_citeproc(&args),
            [
                "--top-level-division=chapter",
                format!("--metadata=oleafly-document-kind={name}").as_str(),
                "--lua-filter=oleafly-document-kind.lua"
            ]
        );
        let named = layout_args(MarkdownLayout {
            declares_class: true,
            ..of_kind(kind)
        });
        assert!(!named
            .iter()
            .any(|arg| arg.starts_with("--top-level-division")));
    }
}

#[test]
fn letters_and_cvs_only_add_the_kind_filter() {
    for (kind, name) in [(MarkdownKind::Letter, "letter"), (MarkdownKind::Cv, "cv")] {
        let args = layout_args(of_kind(kind));
        assert!(!args.iter().any(|arg| arg.starts_with("--to=")));
        assert_eq!(
            after_citeproc(&args),
            [
                format!("--metadata=oleafly-document-kind={name}").as_str(),
                "--lua-filter=oleafly-document-kind.lua"
            ]
        );
    }
}

#[test]
fn front_matter_type_names_the_kind() {
    for (source, expected) in [
        ("---\ntype: slide\n---\n# A\n", MarkdownKind::Slides),
        (
            "---\ntitle: T\ntype: \"slides\"\n---\n",
            MarkdownKind::Slides,
        ),
        (
            "\u{feff}---\ntype: 'Presentation' # talk\n...\n",
            MarkdownKind::Slides,
        ),
        (
            "---\r\ntitle: T\r\ntype: thesis\r\n---\r\n",
            MarkdownKind::Report,
        ),
        ("---\ntype: report\n---\n", MarkdownKind::Report),
        ("---\ntype: book\n---\n", MarkdownKind::Book),
        ("---\ntype: poster\n---\n", MarkdownKind::Poster),
        ("---\ntype: letter\n---\n", MarkdownKind::Letter),
        ("---\ntype: R\u{e9}sum\u{e9}\n---\n", MarkdownKind::Cv),
        ("---\ntype: cv\n---\n", MarkdownKind::Cv),
        ("---\ntype: article\n---\n", MarkdownKind::Article),
    ] {
        assert_eq!(layout_in(source).kind, expected, "{source:?}");
    }
    for source in [
        "# type: slide\n",
        "---\ntype: chapter\n---\n",
        "---\nmeta:\n  type: slide\n---\n",
        "---\ntypes: slide\n---\n",
        "---\ntype: slide\n",
        "text\n---\ntype: slide\n---\n",
    ] {
        assert_eq!(layout_in(source), MarkdownLayout::default(), "{source:?}");
    }
    assert_eq!(
        layout_in("---\ntype: slides\nslide-level: 1\ndocumentclass: memoir\n---\n"),
        MarkdownLayout {
            kind: MarkdownKind::Slides,
            slide_level: Some(1),
            declares_class: true,
        }
    );
    assert_eq!(
        layout_in("---\ntype: slides\nslide-level: 9\n---\n").slide_level,
        None
    );
}

#[test]
fn the_layout_is_read_from_the_document_file() {
    let dir = tempfile::tempdir().unwrap();
    let talk = dir.path().join("talk.md");
    std::fs::write(&talk, "---\ntype: slide\n---\n## One\n").unwrap();
    assert_eq!(markdown_layout(&talk).kind, MarkdownKind::Slides);
    let paper = dir.path().join("paper.md");
    std::fs::write(&paper, "# Paper\n").unwrap();
    assert_eq!(markdown_layout(&paper), MarkdownLayout::default());
    assert_eq!(
        markdown_layout(&dir.path().join("missing.md")),
        MarkdownLayout::default()
    );
}

#[test]
fn every_markdown_filter_is_written_into_the_scratch_folder() {
    let dir = tempfile::tempdir().unwrap();
    write_markdown_filters(dir.path()).unwrap();
    for (name, filter) in MARKDOWN_FILTERS {
        assert!(!filter.is_empty());
        assert_eq!(
            std::fs::read_to_string(dir.path().join(name)).unwrap(),
            filter
        );
    }
}

fn runs(candidate: &Path) -> bool {
    std::process::Command::new(candidate)
        .arg("--version")
        .output()
        .is_ok_and(|output| output.status.success())
}

fn sidecar(program: &str) -> Option<PathBuf> {
    let binaries = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri/binaries");
    let prefix = format!("{program}-");
    let bundled = std::fs::read_dir(binaries)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    name.strip_prefix(&prefix)
                        .is_some_and(|target| !target.starts_with("biber"))
                })
        });
    let executable = if cfg!(windows) {
        format!("{program}.exe")
    } else {
        program.to_owned()
    };
    let on_path = std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .map(|folder| folder.join(&executable));
    bundled.chain(on_path).find(|candidate| runs(candidate))
}

fn pandoc_for(test: &str) -> Option<PathBuf> {
    let found = sidecar("pandoc");
    if found.is_none() {
        eprintln!("{test}: skipped, no pandoc in src-tauri/binaries or on PATH");
    }
    found
}

fn through_the_app_chain(pandoc: &Path, markdown: &str) -> String {
    let dir = tempfile::tempdir().unwrap();
    write_markdown_filters(dir.path()).unwrap();
    let main = dir.path().join("main.md");
    let output = dir.path().join("main.tex");
    std::fs::write(&main, markdown).unwrap();
    let resource = OsString::from(format!("--resource-path={}", dir.path().display()));
    let args = markdown_pdf_args(&MarkdownPdfArgs {
        resource_argument: &resource,
        tectonic: Path::new("tectonic"),
        project: dir.path(),
        search_folders: &[],
        output: &output,
        main: &main,
        bibliographies: &[],
        bundle_url: None,
        layout: layout_in(markdown),
    });
    let run = std::process::Command::new(pandoc)
        .current_dir(dir.path())
        .args(&args)
        .output()
        .unwrap();
    assert!(
        run.status.success(),
        "{markdown}: {}",
        String::from_utf8_lossy(&run.stderr)
    );
    std::fs::read_to_string(output).unwrap()
}

fn assert_groups_nest(latex: &str) {
    let (_, body) = preamble_and_body(latex);
    let mut open = vec![String::from("document")];
    let mut characters = body.char_indices();
    while let Some((at, character)) = characters.next() {
        match character {
            '\\' => {
                let rest = &body[at + 1..];
                let name: String = rest.chars().take_while(char::is_ascii_alphabetic).collect();
                if name.is_empty() {
                    characters.next();
                    continue;
                }
                let environment = rest[name.len()..]
                    .strip_prefix('{')
                    .and_then(|after| after.split_once('}'))
                    .map(|(environment, _)| environment.to_owned());
                match (name.as_str(), environment) {
                    ("begin", Some(environment)) => open.push(environment),
                    ("end", Some(environment)) => {
                        assert_eq!(open.pop(), Some(environment), "{body}");
                    }
                    _ => {}
                }
                for _ in 0..name.len() {
                    characters.next();
                }
                if name == "begin" || name == "end" {
                    while characters.next().is_some_and(|(_, next)| next != '}') {}
                }
            }
            '%' => while characters.next().is_some_and(|(_, next)| next != '\n') {},
            '{' => open.push("{".into()),
            '}' => assert_eq!(open.pop().as_deref(), Some("{"), "{body}"),
            _ => {}
        }
    }
    assert!(open.is_empty(), "{open:?} in {body}");
}

fn with_marks_filter(pandoc: &Path, args: &[&str], markdown: &str) -> String {
    let dir = tempfile::tempdir().unwrap();
    write_markdown_filters(dir.path()).unwrap();
    std::fs::write(dir.path().join("in.md"), markdown).unwrap();
    let output = std::process::Command::new(pandoc)
        .current_dir(dir.path())
        .args(["--from=markdown", "--standalone", "--wrap=none"])
        .args(args)
        .arg(format!("--lua-filter={MARKDOWN_MARKS_FILTER_NAME}"))
        .args(["--", "in.md"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

fn preamble_and_body(latex: &str) -> (&str, &str) {
    latex.split_once("\\begin{document}").unwrap()
}

fn arguments_of<'a>(latex: &'a str, command: &str) -> Vec<&'a str> {
    let opening = format!("\\{command}{{");
    latex
        .match_indices(&opening)
        .map(|(at, _)| {
            let start = at + opening.len();
            let mut depth = 1;
            let end = latex[start..]
                .char_indices()
                .find_map(|(offset, character)| {
                    match character {
                        '{' => depth += 1,
                        '}' => depth -= 1,
                        _ => {}
                    }
                    (depth == 0).then_some(start + offset)
                })
                .unwrap();
            &latex[start..end]
        })
        .collect()
}

fn lines_inside_alignment(body: &str) -> Vec<&str> {
    let mut depth = 0_i32;
    let mut inside = Vec::new();
    for line in body.lines().map(str::trim) {
        if ["center", "flushright", "justify"]
            .iter()
            .any(|environment| line == format!("\\end{{{environment}}}"))
        {
            depth -= 1;
        }
        if depth > 0 {
            inside.push(line);
        }
        if ["center", "flushright", "justify"]
            .iter()
            .any(|environment| line == format!("\\begin{{{environment}}}"))
        {
            depth += 1;
        }
    }
    assert_eq!(depth, 0, "{body}");
    inside
}

#[test]
fn html_marks_colours_and_alignment_reach_latex_like_pandoc_s_own_syntax() {
    let Some(pandoc) = pandoc_for("html_marks_colours_and_alignment_reach_latex") else {
        return;
    };
    let latex = with_marks_filter(
        &pandoc,
        &["--to=latex"],
        "A <u>und</u> <mark>hl</mark> x<sup>2</sup> H<sub>2</sub>O \
         <span data-text-color=\"red!85!black\" style=\"color: rgb(217, 0, 0);\">col</span> \
         <span data-text-color=\"x}\\evil\">bad</span>.\n\n\
         Old [und]{.underline} [hl]{.mark} x^2^ H~2~O.\n\n\
         ::: {.center}\nMid\n:::\n\n::: right\nEnd\n:::\n",
    );
    for wanted in [
        "A \\oleaflyul{und} \\oleaflyhl{hl} x\\textsuperscript{2}",
        "H\\textsubscript{2}O",
        "\\oleaflycolor{1}{col} {bad}.",
        "Old \\oleaflyul{und} \\oleaflyhl{hl} x\\textsuperscript{2} H\\textsubscript{2}O.",
        "\\begin{center}",
        "\\begin{flushright}",
    ] {
        assert!(latex.contains(wanted), "{wanted} in {latex}");
    }
    assert!(!latex.contains("evil"), "{latex}");
}

#[test]
fn visuals_html_fallbacks_for_bold_italic_and_strike_keep_their_formatting() {
    let Some(pandoc) = pandoc_for("visuals_html_fallbacks_for_bold_italic_and_strike") else {
        return;
    };
    let latex = with_marks_filter(
        &pandoc,
        &["--to=latex"],
        "A <strong>strong <u>word</u></strong>s and <em>it</em>x and <del>gone</del>y.\n",
    );
    for wanted in [
        "\\textbf{strong \\oleaflyul{word}}s",
        "\\emph{it}x",
        "\\oleaflyst{gone}y",
    ] {
        assert!(latex.contains(wanted), "{wanted} in {latex}");
    }
    assert!(!latex.contains("strong>"), "{latex}");
}

#[test]
fn nested_marks_share_one_ulem_pass_with_colour_and_notes_outside() {
    let Some(pandoc) = pandoc_for("nested_marks_share_one_ulem_pass") else {
        return;
    };
    let latex = with_marks_filter(
        &pandoc,
        &["--to=latex"],
        "A <u><mark>word</mark></u> ~~<u>s</u>~~ ~~<mark>m</mark>~~ \
         <mark>big </mark><u><mark>w2</mark></u> <mark>big <u>w3</u></mark> \
         <u><span data-text-color=\"red!85!black\" style=\"color: red\">c</span></u> \
         <mark>note[^1] more</mark> [[um]{.mark}]{.underline} [H~2~O]{.mark} \
         <u>**b** [l](https://e.com)</u> <u>中文</u>\n\n[^1]: The <u><mark>n</mark></u>.\n",
    );
    let (preamble, body) = preamble_and_body(&latex);
    for wanted in [
        "\\oleaflymarks{hu}{word}",
        "\\oleaflymarks{us}{s}",
        "\\oleaflymarks{hs}{m}",
        "\\oleaflyhl{big }\\oleaflymarks{hu}{w2}",
        "\\oleaflyhl{big }\\oleaflymarks{hu}{w3}",
        "\\oleaflyul{\\oleaflycolor{1}{c}}",
        "\\oleaflyhl{note}\\footnote{The \\oleaflymarks{hu}{n}.}",
        "\\oleaflymarks{hu}{um}",
        "\\textbf{\\oleaflyul{b}}",
        "\\href{https://e.com}{\\oleaflyul{l}}",
    ] {
        assert!(body.contains(wanted), "{wanted} in {body}");
    }
    for command in ["oleaflyst", "oleaflyul", "oleaflyhl", "oleaflymarks"] {
        for argument in arguments_of(body, command) {
            for inner in [
                "\\oleaflyst{",
                "\\oleaflyul{",
                "\\oleaflyhl{",
                "\\oleaflymarks{",
                "\\footnote",
            ] {
                assert!(!argument.contains(inner), "\\{command}{{{argument}}}");
            }
        }
    }
    for wanted in [
        "\\usepackage[normalem]{ulem}",
        "\\DeclareRobustCommand{\\oleaflyul}[1]{",
        "\\DeclareRobustCommand{\\oleaflyst}[1]{",
        "\\DeclareRobustCommand{\\oleaflyhl}[1]{",
        "\\DeclareRobustCommand{\\oleaflymarks}[2]{",
    ] {
        assert!(preamble.contains(wanted), "{wanted} in {preamble}");
    }
    let plain = with_marks_filter(&pandoc, &["--to=latex"], "Plain *text*.\n");
    assert!(!plain.contains("ulem"), "{plain}");
}

#[test]
fn marks_over_text_without_spaces_keep_places_to_break_the_line() {
    let Some(pandoc) = pandoc_for("marks_over_text_without_spaces_keep_places_to_break_the_line")
    else {
        return;
    };
    let latex = with_marks_filter(
        &pandoc,
        &["--to=latex"],
        "<mark>ภาษาไทยเขียน</mark> <u>https://example.com/a/very/long/path/index.html</u> \
         <mark>中文<span data-text-color=\"teal\">中文，测试</span></mark> \
         <u><mark>long text with spaces</mark></u> <u>short/url</u>\n",
    );
    let (preamble, body) = preamble_and_body(&latex);
    for wanted in [
        "\\oleaflyhl{ภา\\allowbreak{}ษา\\allowbreak{}ไท\\allowbreak{}ย\\allowbreak{}เขี\\allowbreak{}ย\\allowbreak{}น}",
        "\\oleaflyul{https://\\allowbreak{}example.\\allowbreak{}com/\\allowbreak{}a/\\allowbreak{}very/\\allowbreak{}long/\\allowbreak{}path/\\allowbreak{}index.\\allowbreak{}html}",
        "\\oleaflyhl{中文}\\oleaflyhl{\\oleaflycolor{1}{中}\\allowbreak{}\\oleaflycolor{1}{文，}\\allowbreak{}\\oleaflycolor{1}{测}\\allowbreak{}\\oleaflycolor{1}{试}}",
        "\\oleaflymarks{hu}{long text with spaces}",
        "\\oleaflyul{short/url}",
    ] {
        assert!(body.contains(wanted), "{wanted} in {body}");
    }
    assert!(
        preamble.contains(
            "\\@ifpackageloaded{xeCJK}{\\@ifpackageloaded{xeCJKfntef}{}{\\usepackage{xeCJKfntef}}}{}"
        ),
        "{preamble}"
    );
    let chain = through_the_app_chain(&pandoc, "前文 <mark>中文段落</mark> 后文\n");
    assert!(chain.contains("FandolSong-Regular.otf"), "{chain}");
}

#[test]
fn script_detection_reads_the_body_and_not_the_preamble() {
    let Some(pandoc) = pandoc_for("script_detection_reads_the_body_and_not_the_preamble") else {
        return;
    };
    let hebrew = "מילה עברית ארוכה בתוך הגדרה של פקודה חדשה ".repeat(4);
    let english = through_the_app_chain(
        &pandoc,
        &format!(
            "---\nheader-includes: |\n  \\newcommand{{\\heb}}{{{hebrew}}}\n  \\usepackage{{amsmath}}\\usepackage{{booktabs}}\n---\n\n\
             A short English note about the project status today.\n"
        ),
    );
    assert!(!english.contains("pdflang={he}"), "{english}");
    assert!(english.contains("\\oleaflyfonthebrew"), "{english}");
    let hebrew_body = through_the_app_chain(
        &pandoc,
        "\\vspace{1em}\\noindent\\hfill\\relax\\centering\\small שלום עולם זה טקסט קצר\n",
    );
    assert!(hebrew_body.contains("pdflang={he}"), "{hebrew_body}");
}

#[test]
fn a_mark_inside_an_arabic_word_keeps_the_letters_joined() {
    let Some(pandoc) = pandoc_for("a_mark_inside_an_arabic_word_keeps_the_letters_joined") else {
        return;
    };
    let latex = through_the_app_chain(
        &pandoc,
        "---\nlang: ar\n---\n\nكل<mark>مة</mark>ات كل<u>مة</u>ات \
         كل<span data-text-color=\"teal\">مة</span>ات د<u>ر</u>س <mark>كلمة</mark> تامة.\n",
    );
    let (_, body) = preamble_and_body(&latex);
    for wanted in [
        "كل\u{200d}\\oleaflyhl{\u{200d}مة}ات",
        "كل\u{200d}\\oleaflyul{\u{200d}مة}ات",
        "كل\u{200d}\\oleaflycolor{1}{\u{200d}مة}ات",
        "د\\oleaflyul{ر}س",
        " \\oleaflyhl{كلمة} ",
    ] {
        assert!(body.contains(wanted), "{wanted} in {body}");
    }
}

#[test]
fn aligned_list_items_keep_their_marker_at_the_margin() {
    let Some(pandoc) = pandoc_for("aligned_list_items_keep_their_marker_at_the_margin") else {
        return;
    };
    let latex = through_the_app_chain(
        &pandoc,
        "- ::: {.center}\n  First\n  :::\n- Second\n\n\
         ::: {.right}\n## H\n\n- a\n- b\n:::\n",
    );
    assert_groups_nest(&latex);
    let (preamble, body) = preamble_and_body(&latex);
    assert!(preamble.contains("\\def\\oleaflypinlabel{"), "{preamble}");
    for wanted in [
        "\\item\n  {\\centering\\let\\raggedright\\centering\\oleaflypinlabel{}First\\par}",
        "\\tightlist\n\\item\n  {\\raggedleft\\let\\raggedright\\raggedleft\\oleaflypinlabel{}a\\par}",
    ] {
        assert!(body.contains(wanted), "{wanted} in {body}");
    }
    assert!(!body.contains("\\begin{center}"), "{body}");
}

#[test]
fn a_tag_on_one_quote_mark_still_formats_it() {
    let Some(pandoc) = pandoc_for("a_tag_on_one_quote_mark_still_formats_it") else {
        return;
    };
    let latex = with_marks_filter(
        &pandoc,
        &["--to=latex"],
        "Say <strong>\"</strong>fast\" now, \"<strong>fast\"</strong> and <u>\"x\"</u> and \"plain\".\n",
    );
    for wanted in [
        "Say \\textbf{``}fast'' now",
        "``\\textbf{fast''}",
        "\\oleaflyul{``x''}",
        "``plain''",
    ] {
        assert!(latex.contains(wanted), "{wanted} in {latex}");
    }
    assert!(!latex.contains("strong>"), "{latex}");
}

#[test]
fn slides_get_fonts_for_the_scripts_they_use() {
    let Some(pandoc) = pandoc_for("slides_get_fonts_for_the_scripts_they_use") else {
        return;
    };
    let hebrew = through_the_app_chain(
        &pandoc,
        "---\ntype: slides\nlang: he\n---\n\n## שקופית\n\nטקסט <mark>מילה</mark> סוף.\n",
    );
    let (preamble, _) = preamble_and_body(&hebrew);
    assert!(preamble.contains("\\setsansfont"), "{preamble}");
    assert!(preamble.contains("FreeSerif.otf"), "{preamble}");
    let chinese = through_the_app_chain(
        &pandoc,
        "---\ntype: slides\n---\n\n## 幻灯片\n\n前文 <mark>中文段落</mark> 后文\n",
    );
    assert!(chinese.contains("FandolSong-Regular.otf"), "{chinese}");
}

#[test]
fn the_marks_preamble_keeps_every_shape_of_user_header_includes() {
    let Some(pandoc) = pandoc_for("the_marks_preamble_keeps_every_shape_of_user_header_includes")
    else {
        return;
    };
    for front_matter in [
        "header-includes: '\\usepackage{amsthm}'",
        "header-includes:\n  - '\\usepackage{amsthm}'\n  - '\\newcommand{\\foo}{F}'",
        "header-includes: |\n  ```{=latex}\n  \\usepackage{amsthm}\n  ```",
    ] {
        let latex = with_marks_filter(
            &pandoc,
            &["--to=latex"],
            &format!("---\n{front_matter}\n---\n\nA <u><mark>w</mark></u>\n"),
        );
        let (preamble, _) = preamble_and_body(&latex);
        for wanted in ["\\usepackage{amsthm}", "\\usepackage[normalem]{ulem}"] {
            assert!(preamble.contains(wanted), "{front_matter}: {preamble}");
        }
    }
}

#[test]
fn alignment_never_wraps_a_heading_or_a_slide_in_a_raw_environment() {
    let Some(pandoc) = pandoc_for("alignment_never_wraps_a_heading_or_a_slide") else {
        return;
    };
    let breaks = [
        "\\section",
        "\\subsection",
        "\\chapter",
        "\\paragraph",
        "\\begin{frame}",
        "\\end{frame}",
        "\\begin{block}",
        "\\end{block}",
    ];
    let article = with_marks_filter(
        &pandoc,
        &["--to=latex"],
        "::: {.center}\n## One\n:::\n\nBody.\n\n::: {.right}\n# Two\n:::\n\n\
         ::: {.center}\n#### Run in\n\nUnder it\n:::\n\n\
         ::: {#sec .center .keep}\nTarget\n:::\n\nSee [here](#sec).\n",
    );
    let (_, body) = preamble_and_body(&article);
    for line in lines_inside_alignment(body) {
        assert!(
            !breaks.iter().any(|start| line.starts_with(start)),
            "{line} in {body}"
        );
    }
    for wanted in [
        "{\\centering",
        "{\\raggedleft",
        "\\label{sec}",
        "\\begin{center}",
    ] {
        assert!(body.contains(wanted), "{wanted} in {body}");
    }
    for (level, markdown) in [
        (
            "--slide-level=2",
            "::: {.center}\n## Title\n:::\n\nBody\n\n## Slide\n\n::: {.center}\n### Block\n:::\n\n\
             ::: {.incremental .center}\n- a\n- b\n:::\n\n::: {.right}\nA\n\n---\n\nB\n:::\n\n\
             ::: {.justify}\nJustified\n:::\n",
        ),
        (
            "--slide-level=0",
            "::: {.center}\n## Big\n:::\n\nBody\n\n::: {.right}\n## Two\n:::\n",
        ),
    ] {
        let slides = with_marks_filter(&pandoc, &["--to=beamer", level], markdown);
        let (preamble, body) = preamble_and_body(&slides);
        for line in lines_inside_alignment(body) {
            assert!(
                !breaks.iter().any(|start| line.starts_with(start)),
                "{level}: {line} in {body}"
            );
        }
        if level == "--slide-level=2" {
            assert!(body.contains("\\begin{itemize}[<+->]"), "{body}");
            assert!(body.contains("\\begin{justify}"), "{body}");
            assert!(preamble.contains("\\usepackage{ragged2e}"), "{preamble}");
        }
    }
}

#[test]
fn colour_specs_compile_with_their_colour_or_without_it() {
    let Some(pandoc) = pandoc_for("colour_specs_compile_with_their_colour_or_without_it") else {
        return;
    };
    let latex = with_marks_filter(
        &pandoc,
        &["--to=latex"],
        "A <span data-text-color=\"Emerald\">e</span> \
         <span data-text-color=\"Emerald!50!black\">m</span> \
         <span data-text-color=\"[HTML]{FF0000}\">h</span> \
         <span data-text-color=\"[rgb]{0, 0.5, 1}\">r</span> \
         <span data-text-color=\"[HTML]{GG0000}\">g</span> \
         <span data-text-color=\"[rgb]{2,0,0}\">o</span> \
         <span data-text-color=\"x}\\evil\">bad</span> \
         <span data-text-color=\"teal\">t</span>\n",
    );
    let (preamble, body) = preamble_and_body(&latex);
    for wanted in [
        "\\oleaflycolor{1}{e}",
        "\\oleaflycolor{2}{m}",
        "\\oleaflycolor{3}{h}",
        "\\oleaflycolor{4}{r}",
        "{g}",
        "{o}",
        "{bad}",
        "\\oleaflycolor{5}{t}",
    ] {
        assert!(body.contains(wanted), "{wanted} in {body}");
    }
    for unwanted in ["evil", "GG0000", "{2,0,0}"] {
        assert!(!body.contains(unwanted), "{unwanted} in {body}");
    }
    assert!(preamble.contains("dvipsnames]{article}"), "{preamble}");
    for wanted in [
        "\\DeclareRobustCommand{\\oleaflycolor}",
        "\\AtBeginDocument{\\oleafly@trycolor{1}{Emerald}{Emerald}}",
        "\\AtBeginDocument{\\oleafly@trycolor{2}{Emerald,black}{Emerald!50!black}}",
        "\\definecolor{oleafly@color@3}{HTML}{FF0000}",
        "\\definecolor{oleafly@color@4}{rgb}{0,0.5,1}",
        "\\colorlet{oleafly@color@5}{teal}",
    ] {
        assert!(preamble.contains(wanted), "{wanted} in {preamble}");
    }
}

#[test]
fn other_writers_get_the_tags_as_marks_and_nothing_latex() {
    let Some(pandoc) = pandoc_for("other_writers_get_the_tags_as_marks_and_nothing_latex") else {
        return;
    };
    let markdown = "A <u><mark>w</mark></u> ~~<mark>m</mark>~~ x<sup>2</sup> \
                    <span data-text-color=\"red\">r</span>\n\n::: {.center}\nC\n:::\n";
    let typst = with_marks_filter(
        &pandoc,
        &["--to=typst"],
        &format!(
            "{markdown}\n<span data-text-color=\"teal\" style=\"color: rgb(0, 128, 128);\">t</span>(x) \
             <span data-text-color=\"red!85!black\">m</span>\n\n::: {{.right}}\n::: justify\nJ\n:::\n:::\n"
        ),
    );
    for wanted in [
        "#underline[#highlight[w]]",
        "#strike[#highlight[m]]",
        "#super[2]",
        "#text(fill: rgb(\"#ff0000\"))[r];",
        "#text(fill: rgb(\"#008080\"))[t];",
        "#text(fill: rgb(\"#d90000\"))[m];",
        "#block(width: 100%)[#align(center)[\nC\n\n]]",
        "#block(width: 100%)[#align(right)[\n#block(width: 100%)[\n#set par(justify: true)\nJ\n\n]\n]]",
    ] {
        assert!(typst.contains(wanted), "{wanted} in {typst}");
    }
    let quoted = with_marks_filter(
        &pandoc,
        &["--to=typst"],
        "> ::: {.right}\n> Right inside a quote\n> :::\n\n::: {#anchor .center}\nAnchored\n:::\n",
    );
    for wanted in [
        "#quote(block: true)[\n#block(width: 100%)[#align(right)[",
        "#block[\n#block(width: 100%)[#align(center)[\nAnchored\n\n]]\n] <anchor>",
    ] {
        assert!(quoted.contains(wanted), "{wanted} in {quoted}");
    }
    let html = with_marks_filter(&pandoc, &["--to=html"], markdown);
    assert!(html.contains("<u><mark>w</mark></u>"), "{html}");
    for output in [typst, html] {
        for unwanted in ["textcolor", "ulem", "\\begin{center}"] {
            assert!(!output.contains(unwanted), "{unwanted} in {output}");
        }
    }
}

fn docx_with_marks(pandoc: &Path, markdown: &str) -> (String, String) {
    let dir = tempfile::tempdir().unwrap();
    write_markdown_filters(dir.path()).unwrap();
    std::fs::write(
        dir.path().join("dump.lua"),
        "function Pandoc(doc)\n  io.stderr:write(pandoc.write(doc, \"native\"))\nend\n",
    )
    .unwrap();
    std::fs::write(dir.path().join("in.md"), markdown).unwrap();
    let written = std::process::Command::new(pandoc)
        .current_dir(dir.path())
        .args(["--from=markdown", "--to=docx", "--output=out.docx"])
        .arg(format!("--lua-filter={MARKDOWN_MARKS_FILTER_NAME}"))
        .args(["--lua-filter=dump.lua", "--", "in.md"])
        .output()
        .unwrap();
    assert!(
        written.status.success(),
        "{}",
        String::from_utf8_lossy(&written.stderr)
    );
    let read = std::process::Command::new(pandoc)
        .current_dir(dir.path())
        .args(["--from=docx", "--to=commonmark", "--", "out.docx"])
        .output()
        .unwrap();
    assert!(
        read.status.success(),
        "{}",
        String::from_utf8_lossy(&read.stderr)
    );
    (
        String::from_utf8_lossy(&written.stderr).into_owned(),
        String::from_utf8(read.stdout).unwrap(),
    )
}

#[test]
fn docx_gets_text_colour_runs_and_aligned_paragraphs() {
    let Some(pandoc) = pandoc_for("docx_gets_text_colour_runs_and_aligned_paragraphs") else {
        return;
    };
    let (native, _) = docx_with_marks(
        &pandoc,
        "A **b <span data-text-color=\"teal\" style=\"color: rgb(0, 128, 128);\">t & u</span>** \
         <u><span data-text-color=\"[HTML]{336699}\">h</span></u> \
         <span data-text-color=\"teal\">[link](https://e.com)</span>\n\n\
         ::: {.center}\nC <mark>m</mark>\n\n- item\n:::\n\n::: justify\nJ\n:::\n",
    );
    for wanted in [
        "<w:r><w:rPr><w:b/><w:bCs/><w:color w:val=\\\"008080\\\"/></w:rPr><w:t xml:space=\\\"preserve\\\">t</w:t></w:r>",
        "<w:t xml:space=\\\"preserve\\\">&amp;</w:t>",
        "<w:color w:val=\\\"336699\\\"/><w:u w:val=\\\"single\\\"/>",
        "<w:jc w:val=\\\"center\\\"/>",
        "<w:jc w:val=\\\"both\\\"/>",
        "<w:highlight w:val=\\\"yellow\\\"/></w:rPr><w:t xml:space=\\\"preserve\\\">m</w:t>",
        "Link",
        "BulletList",
    ] {
        assert!(native.contains(wanted), "{wanted} in {native}");
    }
}

#[test]
fn docx_aligned_paragraphs_keep_list_numbers_quote_style_direction_and_styles() {
    let Some(pandoc) = pandoc_for("docx_aligned_paragraphs_keep_list_numbers_quote_style") else {
        return;
    };
    let (native, read_back) = docx_with_marks(
        &pandoc,
        "Intro[^n].\n\n[^n]: Note:\n\n    1. note one\n\n\
         - ::: {.center}\n  First item centred\n  :::\n- Second item\n\n\
         1. ::: {.right}\n   Numbered one right\n   :::\n2. Numbered two\n\n\
         - Plain\n  - ::: {.right}\n    Nested right item\n    :::\n\n\
         > ::: {.center}\n> Centred quote line\n> :::\n\n\
         ::: {.center}\nText [styled]{custom-style=\"Strong\"} end.\n:::\n",
    );
    for wanted in [
        "- First item centred\n\n- Second item",
        "1.  Numbered one right\n\n2.  Numbered two",
        "- Plain\n  - Nested right item",
        "> Centred quote line",
    ] {
        assert!(read_back.contains(wanted), "{wanted} in {read_back}");
    }
    for wanted in [
        "<w:numPr><w:ilvl w:val=\\\"0\\\"/><w:numId w:val=\\\"1002\\\"/></w:numPr><w:jc w:val=\\\"center\\\"/>",
        "<w:numPr><w:ilvl w:val=\\\"1\\\"/><w:numId w:val=\\\"1005\\\"/></w:numPr><w:jc w:val=\\\"right\\\"/>",
        "<w:pStyle w:val=\\\"BlockText\\\"/><w:jc w:val=\\\"center\\\"/>",
        "<w:rStyle w:val=\\\"Strong\\\"/>",
    ] {
        assert!(native.contains(wanted), "{wanted} in {native}");
    }
    let (rtl, _) = docx_with_marks(
        &pandoc,
        "---\nlang: he\ndir: rtl\n---\n\n\
         פסקה <span data-text-color=\"teal\" style=\"color: rgb(0, 128, 128);\">צבע</span> סוף.\n\n\
         ::: {.center}\nפסקה ממורכזת.\n:::\n",
    );
    for wanted in [
        "<w:pStyle w:val=\\\"BodyText\\\"/><w:bidi/><w:jc w:val=\\\"center\\\"/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr>",
        "<w:color w:val=\\\"008080\\\"/><w:rtl/>",
    ] {
        assert!(rtl.contains(wanted), "{wanted} in {rtl}");
    }
}

#[test]
fn docx_colour_reaches_quotes_links_and_code_inside_a_coloured_span() {
    let Some(pandoc) = pandoc_for("docx_colour_reaches_quotes_links_and_code") else {
        return;
    };
    let (native, read_back) = docx_with_marks(
        &pandoc,
        "A <span data-text-color=\"teal\">[coloured link](https://e.com) \"quoted\" and `code` \
         and $x^2$</span> end.\n",
    );
    for wanted in [
        "<w:rStyle w:val=\\\"Hyperlink\\\"/><w:color w:val=\\\"008080\\\"/></w:rPr><w:t xml:space=\\\"preserve\\\">coloured</w:t>",
        "<w:color w:val=\\\"008080\\\"/></w:rPr><w:t xml:space=\\\"preserve\\\">\\8220</w:t>",
        "<w:rStyle w:val=\\\"VerbatimChar\\\"/><w:color w:val=\\\"008080\\\"/></w:rPr><w:t xml:space=\\\"preserve\\\">code</w:t>",
    ] {
        assert!(native.contains(wanted), "{wanted} in {native}");
    }
    assert!(
        read_back.contains("[coloured link](https://e.com) \u{201c}quoted\u{201d} and `code`"),
        "{read_back}"
    );
}

#[test]
fn nested_aligned_divs_keep_groups_and_environments_nested_in_the_app_chain() {
    let Some(pandoc) = pandoc_for("nested_aligned_divs_keep_groups_and_environments_nested") else {
        return;
    };
    let nested = "::: {.center}\n::: {.right}\n## H\n\nText\n:::\n:::\n";
    let long = "Justified text long enough to wrap. ".repeat(12);
    for (front_matter, markdown) in [
        ("", nested.to_owned()),
        ("", "::: center\n::: center\n# H\n:::\n:::\n\nBody.\n".to_owned()),
        (
            "",
            "::: center\n::: right\n::: center\n## Deep\n\nDeep text\n:::\nRight\n:::\nCentre\n:::\n"
                .to_owned(),
        ),
        ("", format!("> {}", nested.replace('\n', "\n> "))),
        (
            "",
            "::: {.center}\n::: {.right}\n## One\n:::\n\n::: {.right}\n## Two\n:::\n:::\n".to_owned(),
        ),
        ("type: report\n", nested.replace("## H", "# Chapter")),
        ("type: book\n", nested.replace("## H", "# Chapter\n\n## Section")),
        ("type: cv\n", nested.replace("## H", "# Name")),
        ("type: slides\n", format!("## S\n\n{}", nested.replace("## H", "### Block"))),
        (
            "",
            format!("::: center\nCentred.\n\n::: justify\n## J\n\n{long}\n:::\n:::\n"),
        ),
    ] {
        let latex = through_the_app_chain(
            &pandoc,
            &format!("---\ntitle: T\n{front_matter}---\n\n{markdown}"),
        );
        assert_groups_nest(&latex);
    }
    let report = through_the_app_chain(
        &pandoc,
        "---\ntype: report\n---\n\n::: {.center}\n# Chapter\n:::\n\n::: {.right}\n# Two\n:::\n",
    );
    for wanted in [
        "\\centering\\let\\raggedright\\centering",
        "\\raggedleft\\let\\raggedright\\raggedleft",
    ] {
        assert!(report.contains(wanted), "{wanted} in {report}");
    }
    let justified = through_the_app_chain(
        &pandoc,
        &format!("::: center\nCentred.\n\n::: justify\n{long}\n:::\n:::\n"),
    );
    let (preamble, body) = preamble_and_body(&justified);
    assert!(preamble.contains("\\usepackage{ragged2e}"), "{preamble}");
    let centre = body.find("\\begin{center}").unwrap();
    let justify = body.find("\\begin{justify}").unwrap();
    assert!(centre < justify, "{body}");
}

#[test]
fn marks_in_right_to_left_text_avoid_the_colour_stack() {
    let Some(pandoc) = pandoc_for("marks_in_right_to_left_text_avoid_the_colour_stack") else {
        return;
    };
    let latex = through_the_app_chain(
        &pandoc,
        "---\nlang: he\n---\n\nשלום עולם <mark>מילה</mark> \
         <span data-text-color=\"teal\" style=\"color: rgb(0, 128, 128);\">צבע</span> סוף.\n",
    );
    let (preamble, body) = preamble_and_body(&latex);
    assert!(body.contains("\\oleaflyhl{מילה}"), "{body}");
    assert!(body.contains("\\oleaflycolor{1}{צבע}"), "{body}");
    for wanted in [
        "\\bbl@thetextdir",
        "\\beginL",
        "\\endL",
        "\\addfontfeatures{Color=",
    ] {
        assert!(preamble.contains(wanted), "{wanted} in {preamble}");
    }
}

#[test]
fn the_filter_s_own_latex_never_tips_script_detection() {
    let Some(pandoc) = pandoc_for("the_filter_s_own_latex_never_tips_script_detection") else {
        return;
    };
    let arabic = "مرحبا بالعالم هذا نص عربي";
    for marked in [
        format!("{arabic} <u>كلمة</u>."),
        format!("{arabic} <mark>كلمة</mark> ~~أخرى~~."),
        format!("{arabic} <span data-text-color=\"Emerald\">كلمة</span>."),
        format!("::: {{.center}}\n{arabic} <span data-text-color=\"[HTML]{{336699}}\">كلمة</span>\n:::\n"),
        format!("::: {{.right}}\n## {arabic}\n:::\n"),
    ] {
        let latex = through_the_app_chain(&pandoc, &format!("---\ntitle: ت\n---\n\n{marked}\n"));
        assert!(latex.contains("pdflang={ar}"), "{marked}: {latex}");
    }
}

#[test]
fn marks_in_pdf_metadata_have_a_plain_text_form() {
    let Some(pandoc) = pandoc_for("marks_in_pdf_metadata_have_a_plain_text_form") else {
        return;
    };
    let latex = through_the_app_chain(
        &pandoc,
        "---\ntitle: T\nsubject: 'S <u><mark>x</mark></u> <span data-text-color=\"teal\">c</span>'\n\
         keywords: ['k <mark>y</mark>']\n---\n\nBody.\n",
    );
    let (preamble, _) = preamble_and_body(&latex);
    assert!(
        preamble.contains("pdfsubject={S \\oleaflymarks{hu}{x} \\oleaflycolor{1}{c}}"),
        "{preamble}"
    );
    assert!(
        preamble.contains("\\def\\oleafly@pdf{\\ifdefined\\texorpdfstring"),
        "{preamble}"
    );
    let slides = through_the_app_chain(
        &pandoc,
        "---\ntitle: T\ntype: slides\nsubject: 'S <mark>x</mark>'\nkeywords: ['k <u>y</u>']\n---\n\n## S\n\nBody.\n",
    );
    let (slides_preamble, _) = preamble_and_body(&slides);
    assert!(
        slides_preamble.contains("\\providecommand{\\xmpquote}[1]{#1}"),
        "{slides_preamble}"
    );
    for command in [
        "oleaflyul",
        "oleaflyst",
        "oleaflyhl",
        "oleaflymarks",
        "oleaflycolor",
    ] {
        let definition = preamble
            .split_once(&format!("\\DeclareRobustCommand{{\\{command}}}"))
            .map(|(_, rest)| rest.lines().next().unwrap_or_default())
            .unwrap_or_else(|| panic!("{command} in {preamble}"));
        assert!(
            definition.contains("\\oleafly@pdf{"),
            "{command}: {definition}"
        );
    }
}

#[test]
fn toolbar_marks_leave_soul_names_to_the_user() {
    let Some(pandoc) = pandoc_for("toolbar_marks_leave_soul_names_to_the_user") else {
        return;
    };
    let own = through_the_app_chain(
        &pandoc,
        "---\nheader-includes: '\\newcommand{\\hl}[1]{\\colorbox{yellow}{#1}}'\n---\n\n\
         A <mark>w</mark> <u>u</u> ~~s~~ \\hl{raw}\n",
    );
    let (preamble, body) = preamble_and_body(&own);
    assert!(!preamble.contains("{soul}"), "{preamble}");
    assert!(
        body.contains("\\oleaflyhl{w} \\oleaflyul{u} \\oleaflyst{s}"),
        "{body}"
    );
    for redefined in ["\\hl}", "\\ul}", "\\st}"] {
        for definer in [
            "\\DeclareRobustCommand{",
            "\\newcommand{",
            "\\renewcommand{",
        ] {
            let mentions = preamble.matches(&format!("{definer}{redefined}")).count();
            let allowed = usize::from(definer == "\\newcommand{" && redefined == "\\hl}");
            assert_eq!(mentions, allowed, "{definer}{redefined} in {preamble}");
        }
    }
    let native =
        through_the_app_chain(&pandoc, "A ~~s~~ [m]{.mark} \\sethlcolor{green}\\hl{raw}\n");
    let (preamble, _) = preamble_and_body(&native);
    assert_eq!(
        preamble.matches("\\usepackage{soul}").count(),
        1,
        "{preamble}"
    );
    let user_soul = through_the_app_chain(
        &pandoc,
        "---\nheader-includes:\n  - '\\usepackage{soul}'\n  - '\\sethlcolor{green}'\n---\n\n\
         A \\hl{green} and <mark>yellow</mark>\n",
    );
    let (preamble, body) = preamble_and_body(&user_soul);
    assert_eq!(
        preamble.matches("\\usepackage{soul}").count(),
        1,
        "{preamble}"
    );
    assert!(
        body.contains("\\hl{green} and \\oleaflyhl{yellow}"),
        "{body}"
    );
}

#[test]
fn colour_names_survive_upper_casing_in_running_heads() {
    let Some(pandoc) = pandoc_for("colour_names_survive_upper_casing_in_running_heads") else {
        return;
    };
    let latex = through_the_app_chain(
        &pandoc,
        "---\ntype: book\n---\n\n# Chapter <span data-text-color=\"teal\" style=\"color: x\">t</span>\n\n\
         ## Section <span data-text-color=\"red!85!black\">r</span> \
         <span data-text-color=\"Emerald\">e</span> <span data-text-color=\"[HTML]{336699}\">h</span>\n",
    );
    let (preamble, body) = preamble_and_body(&latex);
    let names = arguments_of(body, "oleaflycolor");
    assert_eq!(names.len(), 4, "{body}");
    assert!(
        names
            .iter()
            .all(|name| name.chars().all(|character| character.is_ascii_digit())),
        "{names:?}"
    );
    for wanted in [
        "\\colorlet{oleafly@color@1}{teal}",
        "\\colorlet{oleafly@color@2}{red!85!black}",
        "\\definecolor{oleafly@color@4}{HTML}{336699}",
    ] {
        assert!(preamble.contains(wanted), "{wanted} in {preamble}");
    }
    assert!(!body.contains("\\textcolor"), "{body}");
}

#[test]
fn raw_footnotes_and_verbatim_inside_marks_still_compile() {
    let Some(pandoc) = pandoc_for("raw_footnotes_and_verbatim_inside_marks_still_compile") else {
        return;
    };
    let latex = through_the_app_chain(
        &pandoc,
        "A ~~text\\footnote{raw}~~ <u>\\verb|x_y|</u> <mark>t\\footnotemark</mark> b\n",
    );
    let (preamble, body) = preamble_and_body(&latex);
    for command in ["oleaflyul", "oleaflyst", "oleaflyhl"] {
        for argument in arguments_of(body, command) {
            assert!(!argument.contains("\\verb"), "\\{command}{{{argument}}}");
        }
    }
    assert!(body.contains("\\oleaflyst{text\\footnote{raw}}"), "{body}");
    for wanted in ["\\let\\footnote\\oleafly@footnote", "\\footnotetext["] {
        assert!(preamble.contains(wanted), "{wanted} in {preamble}");
    }
}

#[test]
fn marks_reach_citations_text_colour_and_scripts_like_visual() {
    let Some(pandoc) = pandoc_for("marks_reach_citations_text_colour_and_scripts_like_visual")
    else {
        return;
    };
    let latex = through_the_app_chain(
        &pandoc,
        "---\nreferences:\n- id: doe\n  type: book\n  author:\n  - family: Doe\n    given: Jane\n  \
         issued:\n    date-parts:\n    - [2020]\n---\n\n\
         A <u>@doe</u> and <mark>[@doe]</mark>. \
         <u><span data-text-color=\"teal\">two words</span></u> \
         <span data-text-color=\"teal\"><u>outside</u></span> <u>x<sup>2</sup></u>\n",
    );
    let (_, body) = preamble_and_body(&latex);
    for wanted in [
        "\\oleaflyul{Doe (2020)}",
        "\\oleaflyhl{(Doe 2020)}",
        "\\oleaflyul{\\oleaflycolor{1}{two} \\oleaflycolor{1}{words}}",
        "\\oleaflycolor{1}{\\oleaflyul{outside}}",
        "\\oleaflyul{x\\textsuperscript{2}}",
    ] {
        assert!(body.contains(wanted), "{wanted} in {body}");
    }
}

const DOE: &str =
    "---\nreferences:\n- id: doe\n  type: book\n  author:\n  - family: Doe\n    given: Jane\n  \
                   issued:\n    date-parts:\n    - [2020]\n---\n\n";

#[test]
fn citation_locators_keep_their_marks_after_citeproc() {
    let Some(pandoc) = pandoc_for("citation_locators_keep_their_marks_after_citeproc") else {
        return;
    };
    let latex = through_the_app_chain(
        &pandoc,
        &format!(
            "{DOE}A [see <u>x</u> @doe, p. <u>3</u>] and [@doe, pp. <mark>12-15</mark>, <u>emphasis</u> added] \
             and @doe [p. ~~7~~] and [@doe, p. <u>3</u>; @doe, p. <u>3</u>] and [@doe, p. 22].\n"
        ),
    );
    let (_, body) = preamble_and_body(&latex);
    let body = body.split_whitespace().collect::<Vec<_>>().join(" ");
    for wanted in [
        "(see \\oleaflyul{x} Doe 2020, \\oleaflyul{3})",
        "(Doe 2020, \\oleaflyhl{12--15}, \\oleaflyul{emphasis} added)",
        "Doe (2020, \\oleaflyst{7})",
        "(Doe 2020, \\oleaflyul{3}; 2020, \\oleaflyul{3})",
        "(Doe 2020, 22)",
    ] {
        assert!(body.contains(wanted), "{wanted} in {body}");
    }
    assert_eq!(body.matches("\\oleaflyul{emphasis}").count(), 1, "{body}");
    let dir = tempfile::tempdir().unwrap();
    write_markdown_filters(dir.path()).unwrap();
    std::fs::write(
        dir.path().join("in.md"),
        format!("{DOE}A [see @doe, p. <u>3</u>] and [@doe, pp. <mark>12-15</mark>] and @doe [p. ~~7~~].\n"),
    )
    .unwrap();
    let written = std::process::Command::new(&pandoc)
        .current_dir(dir.path())
        .args(["--from=markdown", "--to=docx", "--output=out.docx"])
        .arg(format!("--lua-filter={MARKDOWN_MARKS_FILTER_NAME}"))
        .arg("--citeproc")
        .arg(format!("--lua-filter={CITATION_MARKS_FILTER_NAME}"))
        .args(["--", "in.md"])
        .output()
        .unwrap();
    assert!(
        written.status.success(),
        "{}",
        String::from_utf8_lossy(&written.stderr)
    );
    let read = std::process::Command::new(&pandoc)
        .current_dir(dir.path())
        .args([
            "--from=docx",
            "--to=markdown",
            "--wrap=none",
            "--",
            "out.docx",
        ])
        .output()
        .unwrap();
    let docx = String::from_utf8_lossy(&read.stdout);
    for wanted in [
        "(see Doe 2020, [3]{.underline})",
        "(Doe 2020, [12--15]{.mark})",
        "Doe (2020, ~~7~~)",
    ] {
        assert!(docx.contains(wanted), "{wanted} in {docx}");
    }
}

#[test]
fn toolbar_marks_compile_to_pdf_with_the_bundled_tectonic() {
    let test = "toolbar_marks_compile_to_pdf_with_the_bundled_tectonic";
    let Some(pandoc) = pandoc_for(test) else {
        return;
    };
    let Some(bundled) = sidecar("tectonic") else {
        eprintln!("{test}: skipped, no tectonic in src-tauri/binaries or on PATH");
        return;
    };
    let bin = tempfile::tempdir().unwrap();
    let tectonic = bin.path().join(if cfg!(windows) {
        "tectonic.exe"
    } else {
        "tectonic"
    });
    std::fs::copy(bundled, &tectonic).unwrap();
    let bundle = tex_bundle_url();
    let filler = "Filler text that keeps the chapter going onto later pages. ".repeat(160);
    for markdown in [
        "::: {.center}\n::: {.right}\n## H\n\nText\n:::\n:::\n".to_owned(),
        "---\nlang: he\n---\n\nשלום <mark>מילה</mark> <span data-text-color=\"teal\">צבע</span> סוף.\n"
            .to_owned(),
        "---\nsubject: 'S <u><mark>x</mark></u>'\nkeywords: ['k <mark>y</mark>']\n---\n\nBody.\n"
            .to_owned(),
        "---\nheader-includes: '\\newcommand{\\hl}[1]{\\colorbox{yellow}{#1}}'\n---\n\nA <mark>w</mark> \\hl{raw}\n"
            .to_owned(),
        format!("---\ntype: book\n---\n\n# Chapter <span data-text-color=\"teal\">t</span>\n\n{filler}\n"),
        "A ~~text\\footnote{raw}~~ <u>t\\footnote{n}</u> <u>\\verb|x_y|</u> b\n".to_owned(),
        format!(
            "Start <u><mark>{}</mark></u> <u>https://example.com/{}index.html</u> \
             <mark>ภาษาไทยเขียนติดกันโดยไม่มีช่องว่าง<span data-text-color=\"teal\">ระหว่างคำ</span></mark> end.\n",
            "nested marks that have to wrap ".repeat(12),
            "long/path/".repeat(12)
        ),
    ] {
        let dir = tempfile::tempdir().unwrap();
        write_markdown_filters(dir.path()).unwrap();
        let main = dir.path().join("main.md");
        let output = dir.path().join("main.pdf");
        std::fs::write(&main, &markdown).unwrap();
        let resource = OsString::from(format!("--resource-path={}", dir.path().display()));
        let args = markdown_pdf_args(&MarkdownPdfArgs {
            resource_argument: &resource,
            tectonic: &tectonic,
            project: dir.path(),
            search_folders: &[dir.path().to_path_buf()],
            output: &output,
            main: &main,
            bibliographies: &[],
            bundle_url: Some(&bundle),
            layout: layout_in(&markdown),
        });
        let compile = || {
            std::process::Command::new(&pandoc)
                .current_dir(dir.path())
                .args(&args)
                .output()
                .unwrap()
        };
        let mut run = compile();
        if !run.status.success() {
            eprintln!(
                "{test}: retrying once in case the bundle fetch failed: {}",
                String::from_utf8_lossy(&run.stderr)
            );
            run = compile();
        }
        assert!(
            run.status.success() && output.is_file(),
            "{markdown}: {}",
            String::from_utf8_lossy(&run.stderr)
        );
    }
}

#[test]
fn markdown_filters_stay_free_of_lua_comments() {
    for (name, filter) in [
        (MARKDOWN_MARKS_FILTER_NAME, MARKDOWN_MARKS_FILTER),
        (IMAGE_COMPAT_FILTER_NAME, IMAGE_COMPAT_FILTER),
        (
            MARKDOWN_BIBLIOGRAPHY_FILTER_NAME,
            MARKDOWN_BIBLIOGRAPHY_FILTER,
        ),
        (DEFAULT_FONTS_FILTER_NAME, DEFAULT_FONTS_FILTER),
        (DOCUMENT_KIND_FILTER_NAME, DOCUMENT_KIND_FILTER),
        (CITATION_MARKS_FILTER_NAME, CITATION_MARKS_FILTER),
    ] {
        assert!(
            !filter
                .lines()
                .any(|line| line.trim_start().starts_with("--")),
            "{name}"
        );
    }
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
fn bibliographies_in_build_output_and_dot_folders_are_found() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    for (folder, file) in [
        ("out", "refs.bib"),
        (".refs", "library.bib"),
        ("build", "b.bib"),
    ] {
        std::fs::create_dir_all(root.join(folder)).unwrap();
        std::fs::write(root.join(folder).join(file), "@misc{a}").unwrap();
    }
    assert_eq!(
        discover_bibliographies(root).unwrap(),
        [".refs/library.bib", "build/b.bib", "out/refs.bib"]
    );
}

#[test]
fn include_output_dirs_mirror_every_folder_that_holds_tex() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let out = root.join(".oleafly/build");
    for file in [
        "main.tex",
        "Chapter1/chapter1.tex",
        "Chapter2/chapter2.tex",
        "parts/a/section.TEX",
        "figures/plot.pdf",
        ".git/hooks/x.tex",
        "node_modules/pkg/y.tex",
        ".oleafly/build/stale/z.tex",
    ] {
        let path = root.join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "").unwrap();
    }
    assert_eq!(create_include_output_dirs(root, &out).unwrap(), 3);
    for folder in ["Chapter1", "Chapter2", "parts/a"] {
        assert!(out.join(folder).is_dir(), "{folder} should exist");
    }
    // `stale` sits inside the build folder already; it must not be copied
    // into the build folder a second time.
    for folder in ["figures", ".git", "node_modules", ".oleafly"] {
        assert!(!out.join(folder).exists(), "{folder} should not exist");
    }
    // A second build finds them all in place.
    assert_eq!(create_include_output_dirs(root, &out).unwrap(), 0);
}

#[test]
fn include_output_dirs_work_with_a_build_folder_outside_the_project() {
    let project = tempfile::tempdir().unwrap();
    let external = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(project.path().join("ch/one")).unwrap();
    std::fs::write(project.path().join("ch/one/one.tex"), "").unwrap();
    assert_eq!(
        create_include_output_dirs(project.path(), external.path()).unwrap(),
        1
    );
    assert!(external.path().join("ch/one").is_dir());
}

#[test]
fn include_output_dirs_stop_at_the_folder_cap() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let out = tempfile::tempdir().unwrap();
    for index in 0..MAX_INCLUDE_OUTPUT_DIRS + 3 {
        let folder = root.join(format!("f{index:04}"));
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("x.tex"), "").unwrap();
    }
    assert_eq!(
        create_include_output_dirs(root, out.path()).unwrap(),
        MAX_INCLUDE_OUTPUT_DIRS
    );
}

#[test]
fn include_output_dirs_report_a_tree_deeper_than_the_walker_allows() {
    let dir = tempfile::tempdir().unwrap();
    let mut deep = dir.path().to_path_buf();
    for _ in 0..=crate::tree::MAX_DISCOVERY_DEPTH + 1 {
        deep.push("d");
    }
    std::fs::create_dir_all(&deep).unwrap();
    std::fs::write(deep.join("x.tex"), "").unwrap();
    let out = tempfile::tempdir().unwrap();
    assert!(create_include_output_dirs(dir.path(), out.path()).is_err());
    assert_eq!(std::fs::read_dir(out.path()).unwrap().count(), 0);
}

#[test]
fn include_output_dirs_skip_a_missing_project() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("gone");
    assert_eq!(create_include_output_dirs(&missing, dir.path()).unwrap(), 0);
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
fn every_direct_compiler_is_looked_up_on_the_child_path() {
    let dir = tempfile::tempdir().unwrap();
    let path = std::env::join_paths([dir.path()]).unwrap();
    assert_eq!(
        latex_compiler_missing(TexFlavor::Xelatex, &path),
        Some("XeLaTeX")
    );
    assert_eq!(
        latex_compiler_missing(TexFlavor::Lualatex, &path),
        Some("LuaLaTeX")
    );
    assert_eq!(
        latex_compiler_missing(TexFlavor::Pdflatex, &path),
        Some("pdfLaTeX")
    );
    std::fs::write(dir.path().join(crate::tex_distro::exe("xelatex")), b"tool").unwrap();
    assert_eq!(latex_compiler_missing(TexFlavor::Xelatex, &path), None);
    assert_eq!(latex_compiler_missing(TexFlavor::Uplatex, &path), None);
    assert_eq!(latex_compiler_missing(TexFlavor::Platex, &path), None);
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

#[test]
fn a_non_ascii_owned_build_folder_reaches_latexmk_by_its_short_name() {
    let build = Path::new("C:/Users/Jörg/.oleafly/linked/p/build");
    let short = |path: &Path| {
        (path == build).then(|| PathBuf::from("C:/Users/JRG~1/.oleafly/linked/p/build"))
    };
    assert_eq!(
        latexmk_owned_path_text(build, true, &short).as_deref(),
        Some("C:/Users/JRG~1/.oleafly/linked/p/build")
    );
    assert_eq!(
        latexmk_owned_path_text(&build.join("_figure.tex"), true, &short).as_deref(),
        Some("C:/Users/JRG~1/.oleafly/linked/p/build/_figure.tex")
    );
}

#[test]
fn a_non_ascii_owned_build_folder_without_a_short_name_is_refused() {
    let build = Path::new("C:/Users/张三/.oleafly/linked/p/build");
    assert_eq!(latexmk_owned_path_text(build, true, &|_| None), None);
    let unchanged = |path: &Path| Some(path.to_path_buf());
    assert_eq!(latexmk_owned_path_text(build, true, &unchanged), None);
}

#[test]
fn an_ascii_owned_build_folder_keeps_its_own_name() {
    let build = Path::new("C:/Users/ada/.oleafly/linked/p/build");
    let never = |_: &Path| -> Option<PathBuf> { panic!("no short name needed") };
    assert_eq!(
        latexmk_owned_path_text(build, true, &never).as_deref(),
        Some("C:/Users/ada/.oleafly/linked/p/build")
    );
    let unix = Path::new("/home/jörg/.oleafly/linked/p/build");
    assert_eq!(
        latexmk_owned_path_text(unix, false, &never).as_deref(),
        Some("/home/jörg/.oleafly/linked/p/build")
    );
}

#[test]
fn a_bare_argument_a_script_wrapper_would_respell_is_quoted_on_windows() {
    for (arg, quoted) in [
        (
            "-outdir=C:/Users/O'Brien/build",
            "\"-outdir=C:/Users/O'Brien/build\"",
        ),
        ("./fig[1].tex", "\"./fig[1].tex\""),
        ("-r", ""),
        ("./main.tex", ""),
        ("C:/a b/O'Brien.tex", ""),
        ("say\"what'", ""),
        ("C:\\it's\\", "\"C:\\it's\\\\\""),
    ] {
        assert_eq!(wrapper_safe_arg(arg).unwrap_or_default(), quoted, "{arg}");
    }
    assert!(is_windows_batch_script(Path::new("C:/tl/bin/tlmgr.BAT")));
    assert!(is_windows_batch_script(Path::new("quarto.cmd")));
    assert!(!is_windows_batch_script(Path::new("C:/tl/bin/latexmk.exe")));
}

#[test]
fn wrapper_safe_args_keep_every_argument_in_order() {
    let mut command = std::process::Command::new("latexmk");
    add_wrapper_safe_args(
        &mut command,
        Path::new("latexmk"),
        &["-norc", "./O'Neil.tex", "a b"],
    );
    let args: Vec<_> = command.get_args().collect();
    if cfg!(windows) {
        assert_eq!(args, ["-norc", "\"./O'Neil.tex\"", "a b"]);
    } else {
        assert_eq!(args, ["-norc", "./O'Neil.tex", "a b"]);
    }
}
