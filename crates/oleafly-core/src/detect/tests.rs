use super::*;
use std::sync::atomic::AtomicBool;
use tempfile::TempDir;

const ARTICLE: &str = "\\documentclass{article}\n\\begin{document}\nText.\n\\end{document}\n";

fn tree(files: &[(&str, &str)]) -> TempDir {
    let directory = TempDir::new().unwrap();
    write_files(directory.path(), files);
    directory
}

fn write_files(root: &Path, files: &[(&str, &str)]) {
    for (path, content) in files {
        let file = root.join(path);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, content).unwrap();
    }
}

fn detect(directory: &TempDir) -> Detection {
    detect_main_document(directory.path(), &DetectOptions::default()).unwrap()
}

fn detect_with(directory: &TempDir, options: DetectOptions<'_>) -> Detection {
    detect_main_document(directory.path(), &options).unwrap()
}

fn paths(detection: &Detection) -> Vec<&str> {
    detection
        .candidates
        .iter()
        .map(|candidate| candidate.path.as_str())
        .collect()
}

fn candidate<'a>(detection: &'a Detection, path: &str) -> &'a Candidate {
    detection
        .candidates
        .iter()
        .find(|candidate| candidate.path == path)
        .unwrap_or_else(|| panic!("{path} is not a candidate: {:?}", paths(detection)))
}

fn auto(detection: &Detection, main: &str, source: DetectionSource) {
    assert_eq!(
        (
            detection.decision,
            detection.main.as_deref(),
            detection.source
        ),
        (Decision::Auto, Some(main), source),
        "{detection:#?}"
    );
}

#[test]
fn magic_comments_follow_the_shared_editor_tolerance() {
    let cases: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../../tests/fixtures/tex-magic-comments.json")).unwrap();
    assert!(cases.len() >= 15);
    for case in cases {
        let text = case["text"].as_str().unwrap();
        let parsed = tex_magic_comments(text);
        assert_eq!(parsed.root.as_deref(), case["root"].as_str(), "{text:?}");
        assert_eq!(
            parsed.program.as_deref(),
            case["program"].as_str(),
            "{text:?}"
        );
    }
}

#[test]
fn a_thesis_with_chapters_follows_the_root_comment_consensus() {
    let chapter = "% !TeX root = ../thesis.tex\n\\chapter{One}\n";
    let directory = tree(&[
        (
            "thesis.tex",
            "\\documentclass{report}\n\\title{Lattice Methods}\n\\begin{document}\n\\include{chapters/one}\n\\include{chapters/two}\n\\bibliography{refs}\n\\end{document}\n",
        ),
        ("chapters/one.tex", chapter),
        ("chapters/two.tex", chapter),
        ("frontmatter/abstract.tex", "\\chapter*{Abstract}\n"),
        (
            "figures/lattice.tex",
            "\\documentclass{standalone}\n\\begin{document}x\\end{document}\n",
        ),
        ("refs.bib", "@book{k, title={T}}\n"),
    ]);
    let detection = detect(&directory);
    auto(&detection, "thesis.tex", DetectionSource::TexRoot);
    assert_eq!(detection.compile_dir, None);
    let thesis = candidate(&detection, "thesis.tex");
    assert_eq!((thesis.tier, thesis.kind), (Tier::S, DocumentKind::Book));
    assert_eq!(thesis.title.as_deref(), Some("Lattice Methods"));
    assert!(thesis.reasons.contains(&Reason::IncludesFiles));
    assert!(thesis.reasons.contains(&Reason::HasBibliography));
    assert!(!paths(&detection).contains(&"chapters/one.tex"));
}

#[test]
fn an_include_cycle_does_not_hide_its_document() {
    let directory = tree(&[
        (
            "report.tex",
            "\\documentclass{article}\n\\begin{document}\n\\input{d1}\n\\end{document}\n",
        ),
        ("d1.tex", "\\input{d2}\n"),
        ("d2.tex", "\\input{report}\n\\input{leaf}\n"),
        (
            "leaf.tex",
            "\\documentclass{article}\n\\begin{document}\n\\end{document}\n",
        ),
    ]);
    let detection = detect(&directory);
    auto(&detection, "report.tex", DetectionSource::Scan);
    assert_eq!(paths(&detection), ["report.tex"]);
}

#[test]
fn a_thesis_without_root_comments_is_found_by_structure() {
    let directory = tree(&[
        (
            "dissertation.tex",
            "\\documentclass{memoir}\n\\begin{document}\n\\include{chapters/one}\n\\end{document}\n",
        ),
        ("chapters/one.tex", "\\chapter{One}\n"),
    ]);
    auto(
        &detect(&directory),
        "dissertation.tex",
        DetectionSource::Scan,
    );
}

#[test]
fn a_subfiles_project_names_its_root_through_the_class_option() {
    let directory = tree(&[
        (
            "main.tex",
            "\\documentclass{article}\n\\usepackage{subfiles}\n\\begin{document}\n\\subfile{sections/intro}\n\\subfile{sections/method}\n\\end{document}\n",
        ),
        (
            "sections/intro.tex",
            "\\documentclass[../main.tex]{subfiles}\n\\begin{document}\nIntro.\n\\end{document}\n",
        ),
        (
            "sections/method.tex",
            "\\documentclass[../main]{subfiles}\n\\begin{document}\nMethod.\n\\end{document}\n",
        ),
    ]);
    let detection = detect(&directory);
    auto(&detection, "main.tex", DetectionSource::Subfiles);
    assert_eq!(paths(&detection), ["main.tex"]);
}

#[test]
fn an_arxiv_dump_uses_its_readme_and_otherwise_asks() {
    let files = [
        (
            "ms.tex",
            "\\documentclass[twocolumn]{aastex631}\n\\begin{document}\n\\input{sec1}\n\\bibliography{refs}\n\\end{document}\n",
        ),
        ("sec1.tex", "\\section{Data}\n"),
        ("ms.bbl", "\\begin{thebibliography}{1}\\end{thebibliography}\n"),
        ("aastex631.cls", "\\NeedsTeXFormat{LaTeX2e}\n"),
        ("response.tex", ARTICLE),
    ];
    let declared = tree(&files);
    write_files(
        declared.path(),
        &[(
            "00README.json",
            r#"{"process":{"compiler":"pdflatex"},"sources":[{"filename":"ms.tex","usage":"toplevel"},{"filename":"sec1.tex","usage":"include"}]}"#,
        )],
    );
    auto(&detect(&declared), "ms.tex", DetectionSource::ArxivReadme);

    let undeclared = tree(&files);
    let detection = detect(&undeclared);
    assert_eq!(detection.decision, Decision::Ask);
    assert_eq!(paths(&detection), ["ms.tex", "response.tex"]);

    let legacy = tree(&[(
        "paper.tex",
        "\\documentstyle[12pt]{article}\n\\begin{document}\nOld.\n\\end{document}\n",
    )]);
    auto(&detect(&legacy), "paper.tex", DetectionSource::Scan);
}

#[test]
fn a_zipped_project_compiles_from_its_wrapper_folder() {
    let directory = tree(&[
        (
            "My Paper/main.tex",
            "\\documentclass{article}\n\\begin{document}\n\\input{sections/intro}\n\\includegraphics{figures/plot}\n\\end{document}\n",
        ),
        ("My Paper/sections/intro.tex", "Intro.\n"),
        ("My Paper/figures/plot.pdf", "%PDF-1.5\n"),
        ("My Paper/output.bbl", ""),
    ]);
    let detection = detect(&directory);
    auto(&detection, "My Paper/main.tex", DetectionSource::Scan);
    assert_eq!(detection.compile_dir.as_deref(), Some("My Paper"));
}

#[test]
fn a_paper_with_slides_and_a_poster_opens_the_paper() {
    let directory = tree(&[
        ("paper.tex", ARTICLE),
        (
            "slides.tex",
            "\\documentclass{beamer}\n\\begin{document}\n\\end{document}\n",
        ),
        (
            "poster.tex",
            "\\documentclass[a0paper]{tikzposter}\n\\begin{document}\n\\end{document}\n",
        ),
        (
            "banner.tex",
            "\\documentclass{beamer}\n\\usepackage{beamerposter}\n\\begin{document}\n\\end{document}\n",
        ),
    ]);
    let detection = detect(&directory);
    auto(&detection, "paper.tex", DetectionSource::Scan);
    assert_eq!(
        candidate(&detection, "slides.tex").kind,
        DocumentKind::Presentation
    );
    assert_eq!(
        candidate(&detection, "poster.tex").kind,
        DocumentKind::Poster
    );
    assert_eq!(
        candidate(&detection, "banner.tex").kind,
        DocumentKind::Poster
    );
}

#[test]
fn two_independent_articles_ask_with_the_paper_first() {
    let directory = tree(&[("response.tex", ARTICLE), ("paper.tex", ARTICLE)]);
    let detection = detect(&directory);
    assert_eq!(detection.decision, Decision::Ask);
    assert_eq!(detection.main, None);
    assert_eq!(paths(&detection), ["paper.tex", "response.tex"]);
    assert_eq!(detection.best(), Some("paper.tex"));
}

#[test]
fn a_code_repository_opens_its_paper_subfolder() {
    let directory = tree(&[
        ("README.md", "# Tool\n\nUsage.\n"),
        ("CHANGELOG.md", "# Changes\n"),
        ("src/app.py", "print('x')\n"),
        ("node_modules/pkg/doc.tex", ARTICLE),
        (".venv/lib/notes.tex", ARTICLE),
        ("build/paper.tex", ARTICLE),
        (
            "paper/main.tex",
            "\\documentclass{article}\n\\begin{document}\n\\input{sections/intro}\n\\includegraphics[width=\\linewidth]{figures/plot}\n\\bibliography{refs}\n\\end{document}\n",
        ),
        ("paper/sections/intro.tex", "Intro.\n"),
        ("paper/figures/plot.png", "png"),
        ("paper/refs.bib", "@book{k, title={T}}\n"),
    ]);
    let detection = detect(&directory);
    auto(&detection, "paper/main.tex", DetectionSource::Scan);
    assert_eq!(detection.compile_dir.as_deref(), Some("paper"));
    assert_eq!(paths(&detection), ["paper/main.tex"]);
}

#[test]
fn standalone_figures_never_outrank_a_document() {
    let figure = "\\documentclass[border=4pt]{standalone}\n\\begin{document}\nx\n\\end{document}\n";
    let with_paper = tree(&[
        ("main.tex", ARTICLE),
        ("figures/a.tex", figure),
        ("figures/b.tex", figure),
    ]);
    auto(&detect(&with_paper), "main.tex", DetectionSource::RootMain);

    let only_figures = tree(&[("figures/a.tex", figure), ("figures/b.tex", figure)]);
    let detection = detect(&only_figures);
    assert_eq!(detection.decision, Decision::Ask);
    assert!(detection
        .candidates
        .iter()
        .all(|candidate| candidate.tier == Tier::W
            && candidate.reasons.contains(&Reason::StandaloneFigure)));

    let one_figure = tree(&[("figure.tex", figure)]);
    auto(&detect(&one_figure), "figure.tex", DetectionSource::Scan);
}

#[test]
fn leftover_copies_do_not_displace_the_real_main() {
    let with_main = tree(&[
        ("main.tex", ARTICLE),
        ("old_main.tex", ARTICLE),
        ("main-backup.tex", ARTICLE),
    ]);
    auto(&detect(&with_main), "main.tex", DetectionSource::RootMain);

    let without_main = tree(&[("thesis_old.tex", ARTICLE), ("thesis.tex", ARTICLE)]);
    let detection = detect(&without_main);
    assert_eq!(detection.decision, Decision::Ask);
    assert_eq!(paths(&detection), ["thesis.tex", "thesis_old.tex"]);
}

#[test]
fn a_typst_template_package_opens_its_template_entrypoint() {
    let directory = tree(&[
        (
            "typst.toml",
            "[package]\nname = \"report\"\nentrypoint = \"lib.typ\"\n\n[template]\npath = \"template\" # scaffold\nentrypoint = \"main.typ\"\n",
        ),
        ("lib.typ", "#let report(body) = {\n  body\n}\n"),
        (
            "template/main.typ",
            "#import \"@preview/report:0.1.0\": report\n#show: report\n= Findings\n",
        ),
    ]);
    auto(
        &detect(&directory),
        "template/main.typ",
        DetectionSource::TypstToml,
    );
}

#[test]
fn a_typst_project_skips_imported_and_library_files() {
    let directory = tree(&[
        (
            "main.typ",
            "#import \"lib.typ\": conf\n#show: conf\n#set document(title: \"Handbook\")\n#include \"chapters/one.typ\"\n",
        ),
        ("lib.typ", "#let conf(doc) = {\n  doc\n}\n"),
        ("chapters/one.typ", "= One\nText.\n"),
        ("chapters/draft.typ", "= Draft\nText.\n"),
    ]);
    let detection = detect(&directory);
    auto(&detection, "main.typ", DetectionSource::RootMain);
    assert_eq!(paths(&detection), ["main.typ", "chapters/draft.typ"]);
    assert_eq!(
        candidate(&detection, "main.typ").title.as_deref(),
        Some("Handbook")
    );
}

#[test]
fn markdown_and_quarto_folders_open_only_named_documents() {
    let quarto = tree(&[
        ("_quarto.yml", "project:\n  type: book\n"),
        ("index.qmd", "# Book\n"),
        ("README.md", "# Readme\n"),
    ]);
    let detection = detect(&quarto);
    assert_eq!(
        (detection.decision, detection.main),
        (Decision::NoMain, None)
    );

    let paper = tree(&[
        ("paper.md", "---\ntitle: \"Field Notes\"\n---\nText.\n"),
        ("README.md", "# Readme\n"),
        ("LICENSE.md", "MIT\n"),
    ]);
    let detection = detect(&paper);
    auto(&detection, "paper.md", DetectionSource::Scan);
    assert_eq!(
        candidate(&detection, "paper.md").title.as_deref(),
        Some("Field Notes")
    );

    let notes = tree(&[("notes.md", "Notes.\n"), ("draft.md", "Draft.\n")]);
    assert_eq!(detect(&notes).decision, Decision::Ask);

    let single = tree(&[("notes.md", "Notes.\n")]);
    assert_eq!(detect(&single).decision, Decision::Ask);
}

#[test]
fn a_broad_folder_never_opens_a_deep_guess_after_a_truncated_scan() {
    let mut files: Vec<(String, String)> = (0..40)
        .map(|index| (format!("folder{index:02}/notes.txt"), "x".to_owned()))
        .collect();
    files.push(("zz/deep/paper.tex".to_owned(), ARTICLE.to_owned()));
    let borrowed: Vec<(&str, &str)> = files
        .iter()
        .map(|(path, content)| (path.as_str(), content.as_str()))
        .collect();
    let small = DetectOptions {
        limits: DetectLimits {
            max_entries: 60,
            ..DetectLimits::default()
        },
        ..DetectOptions::default()
    };
    let directory = tree(&borrowed);
    write_files(directory.path(), &[("aa/paper.tex", ARTICLE)]);
    let detection = detect_with(&directory, small);
    assert!(detection.truncated);
    assert_eq!(detection.decision, Decision::Ask);
    assert_eq!(paths(&detection), ["aa/paper.tex"]);

    write_files(directory.path(), &[("paper.tex", ARTICLE)]);
    let detection = detect_with(&directory, small);
    assert!(detection.truncated);
    auto(&detection, "paper.tex", DetectionSource::Scan);
}

#[test]
fn a_nested_oleafly_project_is_a_boundary() {
    let directory = tree(&[
        ("report.tex", ARTICLE),
        (
            "sub/project.json",
            r#"{"name":"Sub","main_doc":"paper.tex","engine":"xetex"}"#,
        ),
        ("sub/paper.tex", ARTICLE),
    ]);
    let detection = detect(&directory);
    auto(&detection, "report.tex", DetectionSource::Scan);
    assert_eq!(paths(&detection), ["report.tex"]);

    let only_nested = tree(&[
        ("sub/project.json", r#"{"main_doc":"paper.tex"}"#),
        ("sub/paper.tex", ARTICLE),
    ]);
    assert_eq!(detect(&only_nested).decision, Decision::NoMain);

    let large = large_manifest("main.tex");
    let beside_a_readme = tree(&[
        ("README.md", "# Outer\n"),
        ("inner/project.json", &large),
        ("inner/main.tex", ARTICLE),
    ]);
    assert_eq!(detect(&beside_a_readme).decision, Decision::NoMain);
    let large = large_manifest("paper.tex");
    let beside_a_report = tree(&[
        ("report.tex", ARTICLE),
        ("sub/project.json", &large),
        ("sub/paper.tex", ARTICLE),
    ]);
    let detection = detect(&beside_a_report);
    auto(&detection, "report.tex", DetectionSource::Scan);
    assert_eq!(paths(&detection), ["report.tex"]);
}

fn large_manifest(main_doc: &str) -> String {
    let packages: serde_json::Map<String, serde_json::Value> = (0..4_000)
        .map(|index| (format!("package-{index:05}"), "2026/01/01 v1.0".into()))
        .collect();
    let manifest = serde_json::json!({
        "name": "Thesis",
        "main_doc": main_doc,
        "engine": "xetex",
        "tex": {"distribution": "mactex", "packages": packages},
    })
    .to_string();
    assert!(manifest.len() > 128 * 1024, "{}", manifest.len());
    manifest
}

#[test]
fn a_monorepo_with_foreign_project_files_is_scanned_through() {
    let directory = tree(&[
        (
            "project.json",
            r#"{"name":"workspace","$schema":"node_modules/nx/schemas/project-schema.json","targets":{}}"#,
        ),
        ("nx.json", "{}"),
        (
            "apps/web/project.json",
            r#"{"name":"web","sourceRoot":"apps/web/src","projectType":"application"}"#,
        ),
        ("apps/web/src/main.ts", "export {};\n"),
        ("node_modules/katex/doc.tex", ARTICLE),
        ("docs/paper/main.tex", ARTICLE),
    ]);
    let detection = detect(&directory);
    auto(&detection, "docs/paper/main.tex", DetectionSource::Scan);
    assert_eq!(paths(&detection), ["docs/paper/main.tex"]);
}

#[test]
fn a_saved_choice_and_an_oleafly_manifest_win_before_any_scan() {
    let directory = tree(&[
        ("main.tex", ARTICLE),
        ("notes/draft.tex", ARTICLE),
        (
            "project.json",
            r#"{"name":"P","main_doc":"notes/draft.tex","engine":"xetex"}"#,
        ),
    ]);
    auto(
        &detect(&directory),
        "notes/draft.tex",
        DetectionSource::Manifest,
    );
    let saved = detect_with(
        &directory,
        DetectOptions {
            saved_main: Some("main.tex"),
            ..DetectOptions::default()
        },
    );
    auto(&saved, "main.tex", DetectionSource::SavedChoice);
    assert!(saved.candidates.is_empty());
    for stale in ["deleted.tex", "../main.tex", "notes.txt"] {
        let detection = detect_with(
            &directory,
            DetectOptions {
                saved_main: Some(stale),
                ..DetectOptions::default()
            },
        );
        auto(&detection, "notes/draft.tex", DetectionSource::Manifest);
    }

    let large = large_manifest("notes/draft.tex");
    let recorded = tree(&[
        ("main.tex", ARTICLE),
        ("notes/draft.tex", ARTICLE),
        ("project.json", &large),
    ]);
    auto(
        &detect(&recorded),
        "notes/draft.tex",
        DetectionSource::Manifest,
    );
}

fn evicted(path: &Path, _metadata: &std::fs::Metadata) -> bool {
    path.file_name()
        .and_then(OsStr::to_str)
        .is_some_and(|name| {
            matches!(
                name,
                "project.json" | "latexmkrc" | ".latexmkrc" | "00README.json" | "typst.toml"
            ) || name.starts_with("cloud")
        })
}

#[test]
fn evicted_metadata_files_and_mains_are_never_read() {
    let options = DetectOptions {
        placeholder: evicted,
        ..DetectOptions::default()
    };
    let manifest = tree(&[
        ("main.tex", ARTICLE),
        ("notes/draft.tex", ARTICLE),
        (
            "project.json",
            r#"{"name":"P","main_doc":"notes/draft.tex","engine":"xetex"}"#,
        ),
    ]);
    auto(
        &detect_with(&manifest, options),
        "main.tex",
        DetectionSource::RootMain,
    );

    let declared = tree(&[
        (".latexmkrc", "@default_files = ('thesis');\n"),
        ("latexmkrc", "@default_files = ('thesis');\n"),
        (
            "00README.json",
            r#"{"sources":[{"filename":"thesis.tex","usage":"toplevel"}]}"#,
        ),
        ("thesis.tex", ARTICLE),
        ("main.tex", ARTICLE),
    ]);
    auto(
        &detect_with(&declared, options),
        "main.tex",
        DetectionSource::RootMain,
    );

    let typst = tree(&[
        (
            "typst.toml",
            "[package]\nname = \"report\"\nentrypoint = \"lib.typ\"\n\n[template]\npath = \"template\"\nentrypoint = \"main.typ\"\n",
        ),
        ("lib.typ", "#let report(body) = {\n  body\n}\n"),
        ("template/main.typ", "= Findings\n"),
        ("template/appendix.typ", "= Appendix\n"),
    ]);
    let detection = detect_with(&typst, options);
    assert_eq!(detection.decision, Decision::Ask, "{detection:#?}");
    assert_eq!(detection.source, DetectionSource::Scan);

    let nested = tree(&[
        ("report.tex", ARTICLE),
        (
            "sub/project.json",
            r#"{"name":"Sub","main_doc":"paper.tex","engine":"xetex"}"#,
        ),
        ("sub/paper.tex", ARTICLE),
    ]);
    assert_eq!(
        paths(&detect_with(&nested, options)),
        ["report.tex", "sub/paper.tex"]
    );

    let saved = tree(&[
        (
            "paper/cloud-main.tex",
            "\\documentclass{article}\n\\begin{document}\n\\input{sections/intro}\n\\end{document}\n",
        ),
        ("paper/sections/intro.tex", "Intro.\n"),
    ]);
    let detection = detect_with(
        &saved,
        DetectOptions {
            saved_main: Some("paper/cloud-main.tex"),
            ..options
        },
    );
    auto(
        &detection,
        "paper/cloud-main.tex",
        DetectionSource::SavedChoice,
    );
    assert_eq!(detection.compile_dir, None);
    assert_eq!(
        compile_dir_for(saved.path(), "paper/cloud-main.tex").as_deref(),
        Some("paper")
    );
}

#[test]
fn a_latexmkrc_default_file_is_honoured_without_running_perl() {
    let directory = tree(&[
        (
            ".latexmkrc",
            "# system('touch owned');\n$pdf_mode = 1;\n@default_files = ('thesis'); # the real one\n",
        ),
        ("thesis.tex", ARTICLE),
        ("main.tex", ARTICLE),
    ]);
    auto(
        &detect(&directory),
        "thesis.tex",
        DetectionSource::Latexmkrc,
    );
    assert!(!directory.path().join("owned").exists());

    let two = tree(&[
        ("latexmkrc", "@default_files = qw(paper.tex slides.tex);\n"),
        ("paper.tex", ARTICLE),
        (
            "slides.tex",
            "\\documentclass{beamer}\n\\begin{document}\n\\end{document}\n",
        ),
        ("other.tex", ARTICLE),
    ]);
    let detection = detect(&two);
    assert_eq!(detection.decision, Decision::Ask);
    assert_eq!(detection.source, DetectionSource::Latexmkrc);
    assert_eq!(paths(&detection), ["paper.tex", "slides.tex"]);
}

#[test]
fn conflicting_root_comments_ask_with_the_most_voted_first() {
    let directory = tree(&[
        ("thesis.tex", ARTICLE),
        ("old.tex", ARTICLE),
        ("chapters/a.tex", "% !TeX root = ../thesis.tex\n"),
        ("chapters/b.tex", "% !TeX root = ../thesis.tex\n"),
        ("drafts/c.tex", "% !TeX root = ../old.tex\n"),
        ("drafts/d.tex", "% !TeX root = ../missing.tex\n"),
    ]);
    let detection = detect(&directory);
    assert_eq!(detection.decision, Decision::Ask);
    assert_eq!(detection.source, DetectionSource::TexRoot);
    assert_eq!(paths(&detection), ["thesis.tex", "old.tex"]);
    assert!(detection.candidates[0].reasons.contains(&Reason::Declared));
}

#[test]
fn a_root_comment_deep_in_a_monorepo_does_not_decide_for_the_whole_folder() {
    let directory = tree(&[
        ("fixtures/demo/main.tex", ARTICLE),
        (
            "fixtures/demo/chapters/one.tex",
            "% !TeX root = ../main.tex\n",
        ),
        ("docs/report.tex", ARTICLE),
        (
            "talks/slides.tex",
            "\\documentclass{beamer}\n\\begin{document}\n\\end{document}\n",
        ),
    ]);
    let detection = detect(&directory);
    assert_eq!(detection.decision, Decision::Ask);
    assert_eq!(detection.source, DetectionSource::TexRoot);
    assert_eq!(
        paths(&detection),
        [
            "fixtures/demo/main.tex",
            "docs/report.tex",
            "talks/slides.tex"
        ]
    );

    std::fs::remove_file(directory.path().join("docs/report.tex")).unwrap();
    auto(
        &detect(&directory),
        "fixtures/demo/main.tex",
        DetectionSource::TexRoot,
    );
}

#[test]
fn detection_is_deterministic_under_any_directory_order() {
    let files = [
        ("paper.tex", ARTICLE),
        ("response.tex", ARTICLE),
        ("b/deep.tex", ARTICLE),
        ("a/notes.md", "Notes.\n"),
        (
            "c/fig.tex",
            "\\documentclass{standalone}\n\\begin{document}\\end{document}\n",
        ),
        ("a/b/c/d.typ", "= D\n"),
        ("Z.tex", ARTICLE),
    ];
    let forward = tree(&files);
    let mut reversed = files;
    reversed.reverse();
    let backward = tree(&reversed);
    let mut interleaved = files;
    interleaved.sort_by_key(|(path, _)| path.len() % 3);
    let shuffled = tree(&interleaved);
    let expected = detect(&forward);
    assert_eq!(detect(&backward).candidates, expected.candidates);
    assert_eq!(detect(&shuffled).candidates, expected.candidates);
    assert_eq!(detect(&backward).decision, expected.decision);
    assert_eq!(
        paths(&expected),
        [
            "paper.tex",
            "response.tex",
            "Z.tex",
            "b/deep.tex",
            "a/b/c/d.typ",
            "a/notes.md",
            "c/fig.tex"
        ]
    );
}

#[test]
fn a_zero_deadline_truncates_before_reading_anything() {
    let zero = DetectOptions {
        limits: DetectLimits {
            deadline: Duration::ZERO,
            ..DetectLimits::default()
        },
        ..DetectOptions::default()
    };
    let directory = tree(&[("chapters/paper.tex", ARTICLE)]);
    let detection = detect_with(&directory, zero);
    assert!(detection.truncated);
    assert_eq!(detection.decision, Decision::NoMain);

    write_files(directory.path(), &[("main.tex", ARTICLE)]);
    let detection = detect_with(&directory, zero);
    auto(&detection, "main.tex", DetectionSource::RootMain);
    assert!(detection.truncated);
}

#[test]
fn cancelling_stops_the_scan() {
    let directory = tree(&[("chapters/paper.tex", ARTICLE)]);
    let cancel = AtomicBool::new(true);
    let detection = detect_with(
        &directory,
        DetectOptions {
            cancel: Some(&cancel),
            ..DetectOptions::default()
        },
    );
    assert!(detection.truncated);
    assert_eq!(detection.decision, Decision::NoMain);
}

#[test]
fn listing_a_directory_stops_at_the_entry_budget_and_when_interrupted() {
    let directory = TempDir::new().unwrap();
    for index in 0..50 {
        std::fs::write(directory.path().join(format!("f{index:02}.txt")), "").unwrap();
    }
    let (all, cut) = list_directory(directory.path(), 50, || false).unwrap();
    assert!(!cut);
    let names: Vec<_> = all.iter().map(std::fs::DirEntry::file_name).collect();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!((names.len(), names), (50, sorted));

    let (some, cut) = list_directory(directory.path(), 10, || false).unwrap();
    assert_eq!((some.len(), cut), (10, true));

    let mut polls = 0;
    let (stopped, cut) = list_directory(directory.path(), 50, || {
        polls += 1;
        polls > 3
    })
    .unwrap();
    assert_eq!((stopped.len(), cut, polls), (3, true, 4));

    let flat = DetectOptions {
        limits: DetectLimits {
            max_entries: 20,
            ..DetectLimits::default()
        },
        ..DetectOptions::default()
    };
    let detection = detect_with(&directory, flat);
    assert!(detection.truncated);
    assert_eq!(detection.decision, Decision::NoMain);
}

#[test]
fn a_generated_huge_tree_finishes_inside_the_deadline() {
    let directory = TempDir::new().unwrap();
    for folder in 0..210 {
        let path = directory.path().join(format!("d{folder:03}"));
        std::fs::create_dir(&path).unwrap();
        for file in 0..100 {
            std::fs::write(path.join(format!("f{file:03}.txt")), "").unwrap();
        }
    }
    write_files(directory.path(), &[("d000/paper.tex", ARTICLE)]);
    let started = Instant::now();
    let detection = detect(&directory);
    assert!(started.elapsed() < DETECT_DEADLINE + Duration::from_secs(1));
    assert!(detection.truncated);
    assert_eq!(detection.decision, Decision::Ask);
    assert_eq!(paths(&detection), ["d000/paper.tex"]);

    write_files(directory.path(), &[("main.tex", ARTICLE)]);
    auto(&detect(&directory), "main.tex", DetectionSource::RootMain);
}

fn cloud_named(path: &Path, _metadata: &std::fs::Metadata) -> bool {
    path.file_name()
        .and_then(OsStr::to_str)
        .is_some_and(|name| name.starts_with("cloud"))
}

#[test]
fn placeholders_are_listed_but_never_read_or_opened() {
    let options = DetectOptions {
        placeholder: cloud_named,
        ..DetectOptions::default()
    };
    let directory = tree(&[("cloud-main.tex", ARTICLE)]);
    let detection = detect_with(&directory, options);
    assert_eq!(detection.decision, Decision::Ask);
    let placeholder = candidate(&detection, "cloud-main.tex");
    assert_eq!(placeholder.tier, Tier::W);
    assert_eq!(placeholder.class, None);
    assert!(placeholder.reasons.contains(&Reason::Placeholder));

    let with_local = tree(&[("cloud-main.tex", ARTICLE), ("paper.tex", ARTICLE)]);
    auto(
        &detect_with(&with_local, options),
        "paper.tex",
        DetectionSource::Scan,
    );
}

#[test]
fn a_folder_of_fragments_has_no_main_document() {
    let directory = tree(&[("notes.txt", "x"), ("fragment.tex", "\\section{Only}\n")]);
    let detection = detect(&directory);
    assert_eq!(detection.decision, Decision::NoMain);
    assert!(detection.candidates.is_empty());
    assert!(!detection.truncated);
}

#[test]
fn the_compile_directory_follows_where_the_includes_resolve() {
    let directory = tree(&[
        (
            "paper/local.tex",
            "\\documentclass{article}\n\\begin{document}\n\\input{sections/a}\n\\input{sections/b}\n\\end{document}\n",
        ),
        ("paper/sections/a.tex", ""),
        ("paper/sections/b.tex", ""),
        (
            "paper/rooted.tex",
            "\\documentclass{article}\n\\begin{document}\n\\input{paper/sections/a}\n\\end{document}\n",
        ),
        (
            "paper/upward.tex",
            "\\documentclass{article}\n\\begin{document}\n\\input{sections/a}\n\\input{../shared/macros}\n\\end{document}\n",
        ),
        ("shared/macros.tex", ""),
        (
            "paper/figures.tex",
            "\\documentclass{article}\n\\begin{document}\n\\includegraphics{plots/one}\n\\addbibresource{refs.bib}\n\\end{document}\n",
        ),
        ("paper/plots/one.pdf", ""),
        ("paper/refs.bib", ""),
        ("top.tex", ARTICLE),
        ("notes.md", "x"),
    ]);
    let root = directory.path();
    assert_eq!(
        compile_dir_for(root, "paper/local.tex").as_deref(),
        Some("paper")
    );
    assert_eq!(compile_dir_for(root, "paper/rooted.tex"), None);
    assert_eq!(compile_dir_for(root, "paper/upward.tex"), None);
    assert_eq!(
        compile_dir_for(root, "paper/figures.tex").as_deref(),
        Some("paper")
    );
    assert_eq!(compile_dir_for(root, "top.tex"), None);
    assert_eq!(compile_dir_for(root, "notes.md"), None);
    assert_eq!(compile_dir_for(root, "missing/main.tex"), None);
}

#[test]
fn commented_out_markup_does_not_count() {
    let directory = tree(&[
        ("a.tex", "%\\documentclass{article}\n%\\begin{document}\n"),
        (
            "b.tex",
            "\\documentclass{article}\n\\begin{document}\n% \\input{a}\n100\\% done\n\\end{document}\n",
        ),
    ]);
    let detection = detect(&directory);
    auto(&detection, "b.tex", DetectionSource::Scan);
    assert!(!candidate(&detection, "b.tex")
        .reasons
        .contains(&Reason::IncludesFiles));
}

#[test]
fn detection_serializes_for_the_open_folder_picker() {
    let directory = tree(&[("paper.tex", ARTICLE), ("response.tex", ARTICLE)]);
    let value = serde_json::to_value(detect(&directory)).unwrap();
    assert_eq!(value["decision"], "ask");
    assert_eq!(value["source"], "scan");
    assert_eq!(value["candidates"][0]["tier"], "s");
    assert_eq!(value["candidates"][0]["family"], "latex");
    assert_eq!(value["candidates"][0]["kind"], "document");
    assert_eq!(value["candidates"][0]["reasons"][0], "top_level");
    assert!(value["main"].is_null());
    assert!(value["compile_dir"].is_null());
}

#[test]
fn every_research_seed_opens_on_its_main_document() {
    let seeds = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/research-seeds");
    let mut checked = 0;
    for entry in std::fs::read_dir(&seeds).unwrap().flatten() {
        let seed = entry.path();
        if !seed.is_dir() {
            continue;
        }
        let expected = ["main.tex", "main.typ", "figure.tex"]
            .into_iter()
            .find(|name| seed.join(name).is_file())
            .unwrap_or_else(|| panic!("{} has no known main document", seed.display()));
        let detection = detect_main_document(&seed, &DetectOptions::default()).unwrap();
        assert_eq!(
            (detection.decision, detection.main.as_deref()),
            (Decision::Auto, Some(expected)),
            "{}",
            seed.display()
        );
        checked += 1;
    }
    assert!(checked >= 20, "only {checked} research seeds found");
}
