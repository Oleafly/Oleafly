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
fn every_flavor_gets_the_glossary_and_nomenclature_rules_after_its_own_arguments() {
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
        for dependency in [
            "add_cus_dep(q/glo/, q/gls/",
            "add_cus_dep(q/acn/, q/acr/",
            "add_cus_dep(q/nlo/, q/nls/",
        ] {
            let at = args
                .iter()
                .position(|arg| arg.contains(dependency))
                .unwrap_or_else(|| panic!("{dependency} is missing for {flavor:?}"));
            assert_eq!(args[at - 1], "-e");
        }
        assert_eq!(args.last().unwrap(), "./main.tex");
    }
}

#[test]
fn the_symbols_list_and_its_makeindex_step_reach_every_flavor() {
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
        let at = args
            .iter()
            .position(|arg| arg.contains("add_cus_dep(q/slo/, q/sls/"))
            .unwrap_or_else(|| panic!("the symbols rule is missing for {flavor:?}"));
        assert_eq!(args[at - 1], "-e");
        assert!(args[at].contains("oleafly_mi($_[0], undef, q/slg/, q/sls/, q/slo/)"));
    }
}

#[test]
fn glossary_rules_read_the_style_file_the_document_named() {
    let rules = crate::tex_outputs::LATEXMK_INDEX_RULES;
    assert!(rules[0].contains(r"\\\@istfilename\{([^}]+\.ist)\}"));
    let numbers = rules
        .iter()
        .find(|rule| rule.contains("add_cus_dep(q/nlo/"))
        .unwrap();
    assert!(numbers.contains(r"/^\\glossaryentry/"));
    assert!(numbers.contains("$glossary ? undef : q/nomencl.ist/"));
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
            "--lua-filter=oleafly-markdown-bibliography.lua",
            bibliography.as_str(),
            "--citeproc",
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
fn the_bibliography_filter_runs_before_citeproc_and_fonts_after_it() {
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
    args[citeproc + 1..args.len() - 3]
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

#[test]
fn markdown_filters_stay_free_of_lua_comments() {
    for (name, filter) in [
        (IMAGE_COMPAT_FILTER_NAME, IMAGE_COMPAT_FILTER),
        (
            MARKDOWN_BIBLIOGRAPHY_FILTER_NAME,
            MARKDOWN_BIBLIOGRAPHY_FILTER,
        ),
        (DEFAULT_FONTS_FILTER_NAME, DEFAULT_FONTS_FILTER),
        (DOCUMENT_KIND_FILTER_NAME, DOCUMENT_KIND_FILTER),
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
