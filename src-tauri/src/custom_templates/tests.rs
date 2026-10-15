use std::io::Write as _;
use std::path::Path;

use super::*;
use crate::templates::{instantiate_from, read_manifest};

const ARTICLE: &str = "\\documentclass{IEEEtran}\n\\begin{document}\nBody.\n\\end{document}\n";

fn zip_file(dir: &Path, entries: &[(&str, &[u8])]) -> PathBuf {
    let path = dir.join("template.zip");
    let mut writer = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
    let options = zip::write::SimpleFileOptions::default();
    for (name, body) in entries {
        writer.start_file(*name, options).unwrap();
        writer.write_all(body).unwrap();
    }
    writer.finish().unwrap();
    path
}

fn write(path: &Path, body: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, body).unwrap();
}

fn draft(name: &str) -> TemplateDraft {
    TemplateDraft {
        name: name.to_string(),
        ..TemplateDraft::default()
    }
}

fn entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn a_zip_keeps_every_file_and_projects_from_it_are_independent_copies() {
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("custom");
    let archive = zip_file(
        work.path(),
        &[
            ("ieee-template/main.tex", ARTICLE.as_bytes()),
            ("ieee-template/IEEEtran.cls", b"% class"),
            ("ieee-template/LICENSE", b"LPPL"),
            ("ieee-template/preview.png", b"not gallery metadata"),
            ("ieee-template/template.json", b"{\"their\":\"file\"}"),
            ("ieee-template/figures/plot.pdf", b"%PDF-1.5"),
            ("ieee-template/fonts/Body.otf", b"font"),
            ("__MACOSX/ieee-template/._main.tex", b"junk"),
        ],
    );
    let id = publish_template(
        &root,
        &[],
        TemplateSource::Archive(&archive),
        draft("IEEE Conference"),
    )
    .unwrap();
    assert!(id.starts_with("ieee-conference-"), "{id}");
    let dir = root.join(&id);
    let manifest = read_manifest(&dir).unwrap();
    assert_eq!(manifest.name, "IEEE Conference");
    assert_eq!(manifest.category, "Custom");
    assert_eq!(manifest.main_doc, "main.tex");
    assert_eq!(manifest.engine, "xetex");
    assert_eq!(manifest.files_dir.as_deref(), Some("files"));
    assert_eq!(manifest.tex_flavor, None);
    assert!(!dir.join("files").join("__MACOSX").exists());

    let first = work.path().join("first");
    let second = work.path().join("second");
    for project in [&first, &second] {
        std::fs::create_dir_all(project).unwrap();
        instantiate_from(&dir, project).unwrap();
        assert_eq!(
            entries(project),
            [
                "IEEEtran.cls",
                "LICENSE",
                "figures",
                "fonts",
                "main.tex",
                "preview.png",
                "template.json"
            ]
        );
        assert!(project.join("figures/plot.pdf").is_file());
        assert!(project.join("fonts/Body.otf").is_file());
    }
    std::fs::write(first.join("main.tex"), "changed").unwrap();
    assert_eq!(
        std::fs::read_to_string(second.join("main.tex")).unwrap(),
        ARTICLE
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("files/main.tex")).unwrap(),
        ARTICLE
    );
    assert_eq!(entries(&root), [id]);
}

#[test]
fn a_folder_is_copied_and_a_folder_holding_the_store_is_refused() {
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("store").join("custom");
    let source = work.path().join("thesis");
    write(&source.join("thesis.tex"), ARTICLE);
    write(&source.join("chapters/intro.tex"), "Intro");
    write(&source.join(".git/HEAD"), "ref");
    let id =
        publish_template(&root, &[], TemplateSource::Folder(&source), draft("Thesis")).unwrap();
    let files = root.join(&id).join("files");
    assert!(files.join("chapters/intro.tex").is_file());
    assert!(!files.join(".git").exists());
    assert_eq!(
        read_manifest(&root.join(&id)).unwrap().main_doc,
        "thesis.tex"
    );

    let error = publish_template(
        &root,
        &[],
        TemplateSource::Folder(work.path()),
        draft("Everything"),
    )
    .unwrap_err();
    assert!(error.contains("template.folder_holds_templates"), "{error}");
    assert_eq!(entries(&root), [id]);
}

#[test]
fn a_project_leaves_its_settings_history_and_build_output_behind() {
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("custom");
    let project = work.path().join("project");
    write(&project.join("paper.tex"), ARTICLE);
    write(
        &project.join("project.json"),
        "{\"main_doc\":\"paper.tex\"}",
    );
    write(&project.join(".oleafly/build/paper.pdf"), "%PDF");
    write(&project.join(".git/HEAD"), "ref");
    write(&project.join("refs.bib"), "@book{x}");
    write(
        &project.join("sections/project.json"),
        "kept: not the settings file",
    );
    let id = publish_template(
        &root,
        &[],
        TemplateSource::Project(&project),
        TemplateDraft {
            name: "Lab paper".into(),
            main_doc: Some("paper.tex".into()),
            tex_flavor: Some("pdflatex".into()),
            preview_png: decode_preview(Some(&format!("data:image/png;base64,{}", base64_png()))),
            ..TemplateDraft::default()
        },
    )
    .unwrap();
    let dir = root.join(&id);
    assert_eq!(
        entries(&dir.join("files")),
        ["paper.tex", "refs.bib", "sections"]
    );
    assert!(dir.join("files/sections/project.json").is_file());
    assert!(dir.join("preview.png").is_file());
    let manifest = read_manifest(&dir).unwrap();
    assert_eq!(manifest.main_doc, "paper.tex");
    assert_eq!(manifest.tex_flavor.as_deref(), Some("pdflatex"));
}

fn base64_png() -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let mut png = PNG_SIGNATURE.to_vec();
    png.extend_from_slice(b"rest of a png");
    STANDARD.encode(png)
}

#[test]
fn the_main_document_prefers_the_given_one_and_falls_back_to_detection() {
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("custom");
    let source = work.path().join("source");
    write(&source.join("main.tex"), ARTICLE);
    write(&source.join("slides/talk.tex"), ARTICLE);
    let chosen = publish_template(
        &root,
        &[],
        TemplateSource::Folder(&source),
        TemplateDraft {
            name: "Talk".into(),
            main_doc: Some("slides\\talk.tex".into()),
            ..TemplateDraft::default()
        },
    )
    .unwrap();
    assert_eq!(
        read_manifest(&root.join(chosen)).unwrap().main_doc,
        "slides/talk.tex"
    );
    for missing in ["gone.tex", "../main.tex", "C:/main.tex", "slides"] {
        let detected = publish_template(
            &root,
            &[],
            TemplateSource::Folder(&source),
            TemplateDraft {
                name: "Paper".into(),
                main_doc: Some(missing.into()),
                ..TemplateDraft::default()
            },
        )
        .unwrap();
        assert_eq!(
            read_manifest(&root.join(detected)).unwrap().main_doc,
            "main.tex",
            "{missing}"
        );
    }
}

#[test]
fn a_source_without_a_document_fails_and_leaves_nothing_behind() {
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("custom");
    let archive = zip_file(work.path(), &[("notes.txt", b"no document here")]);
    let error = publish_template(
        &root,
        &[],
        TemplateSource::Archive(&archive),
        draft("Notes"),
    )
    .unwrap_err();
    assert!(error.contains("project.import_no_main"), "{error}");
    assert!(entries(&root).is_empty());

    let not_a_zip = work.path().join("broken.zip");
    std::fs::write(&not_a_zip, "plain text").unwrap();
    assert!(publish_template(
        &root,
        &[],
        TemplateSource::Archive(&not_a_zip),
        draft("Broken")
    )
    .is_err());
    assert!(entries(&root).is_empty());
}

#[test]
fn names_are_required_and_ids_are_unique_and_safe() {
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("custom");
    let source = work.path().join("source");
    write(&source.join("main.typ"), "= Title");
    let error =
        publish_template(&root, &[], TemplateSource::Folder(&source), draft("   ")).unwrap_err();
    assert!(error.contains("template.name_required"), "{error}");
    let first =
        publish_template(&root, &[], TemplateSource::Folder(&source), draft("Report")).unwrap();
    let second =
        publish_template(&root, &[], TemplateSource::Folder(&source), draft("Report")).unwrap();
    assert_ne!(first, second);
    let unicode = publish_template(
        &root,
        &[],
        TemplateSource::Folder(&source),
        draft("修士論文"),
    )
    .unwrap();
    assert!(unicode.starts_with("template-"), "{unicode}");
    assert!(crate::templates::is_valid_id(&unicode));
    assert_eq!(
        slug("  Ünïversity --- Thesis (v2)  "),
        "n-versity-thesis-v2"
    );
    assert_eq!(slug(&"x".repeat(80)).len(), SLUG_LIMIT);
    let manifest = read_manifest(&root.join(first)).unwrap();
    assert_eq!(manifest.engine, "typst");
}

#[test]
fn a_compiler_is_kept_only_for_latex_and_only_when_known() {
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("custom");
    let latex = work.path().join("latex");
    write(&latex.join("main.tex"), ARTICLE);
    let typst = work.path().join("typst");
    write(&typst.join("main.typ"), "= Title");
    for (source, flavor, expected) in [
        (&latex, "xelatex", Some("xelatex")),
        (&latex, "bogus", None),
        (&typst, "pdflatex", None),
    ] {
        let id = publish_template(
            &root,
            &[],
            TemplateSource::Folder(source),
            TemplateDraft {
                name: "Compiler".into(),
                tex_flavor: Some(flavor.into()),
                ..TemplateDraft::default()
            },
        )
        .unwrap();
        assert_eq!(
            read_manifest(&root.join(id)).unwrap().tex_flavor.as_deref(),
            expected,
            "{flavor}"
        );
    }
}

#[test]
fn previews_must_be_png() {
    assert!(decode_preview(Some(&base64_png())).is_some());
    assert!(decode_preview(Some("data:image/png;base64,aGVsbG8=")).is_none());
    assert!(decode_preview(Some("not base64")).is_none());
    assert!(decode_preview(None).is_none());
}

#[test]
fn stale_leftovers_are_swept_and_fresh_ones_are_left_alone() {
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("custom");
    let fresh = root.join(format!("{STAGING_PREFIX}fresh"));
    let old_download = root.join(format!("{DOWNLOAD_PREFIX}old.zip"));
    let new_download = root.join(format!("{DOWNLOAD_PREFIX}new.zip"));
    write(&fresh.join("files/main.tex"), ARTICLE);
    write(&old_download, "zip");
    write(&new_download, "zip");
    std::fs::File::options()
        .write(true)
        .open(&old_download)
        .unwrap()
        .set_modified(SystemTime::now() - STALE_AFTER - Duration::from_secs(60))
        .unwrap();
    sweep_stale_staging(&root);
    assert!(!old_download.exists());
    assert!(new_download.exists());
    assert!(fresh.exists());
}

#[test]
fn projects_from_a_template_use_its_compiler() {
    let _guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let default = crate::project::template_engine("main.tex", None).unwrap();
    assert_eq!(default.1, None);
    assert_eq!(
        crate::project::template_engine("main.tex", Some("pdflatex")).unwrap(),
        ("latexmk".to_string(), Some("pdflatex".to_string()))
    );
    assert_eq!(
        crate::project::template_engine("main.tex", Some("bogus")).unwrap(),
        default
    );
    assert_eq!(
        crate::project::template_engine("main.typ", Some("pdflatex")).unwrap(),
        ("typst".to_string(), None)
    );
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[test]
fn an_online_project_keeps_its_single_folder_where_a_picked_zip_is_unwrapped() {
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("custom");
    let archive = zip_file(
        work.path(),
        &[
            ("thesis/main.tex", ARTICLE.as_bytes()),
            ("thesis/chapters/intro.tex", b"Intro"),
        ],
    );
    let picked = publish_template(
        &root,
        &[],
        TemplateSource::Archive(&archive),
        draft("Picked"),
    )
    .unwrap();
    assert_eq!(
        read_manifest(&root.join(&picked)).unwrap().main_doc,
        "main.tex"
    );
    assert!(root
        .join(&picked)
        .join("files/chapters/intro.tex")
        .is_file());

    let online = publish_template(
        &root,
        &[],
        TemplateSource::OnlineProject(&archive),
        TemplateDraft {
            name: "Online".into(),
            main_doc: Some("thesis/main.tex".into()),
            ..TemplateDraft::default()
        },
    )
    .unwrap();
    assert_eq!(
        read_manifest(&root.join(&online)).unwrap().main_doc,
        "thesis/main.tex"
    );
    assert!(root
        .join(&online)
        .join("files/thesis/chapters/intro.tex")
        .is_file());
}
