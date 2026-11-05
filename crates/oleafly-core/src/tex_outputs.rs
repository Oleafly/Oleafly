use std::collections::BTreeMap;
use std::path::Path;

use crate::engine_spec::{discover_bibliographies, validate_latex_main_document, ENTRY_STEM};
use crate::tex_errors::CompileError;
use crate::tex_flavor::uncommented_preamble;
use crate::TexFlavor;

const SOURCE_SNIFF_BYTES: u64 = 512 * 1024;
const LOG_FILE_OPEN: &str = "File `";
const LOG_FILE_CLOSE: &str = "' not found";

pub const LATEXMK_INDEX_RULES: [&str; 5] = [
    r"sub oleafly_mi { my ($path, $style, $log, $out, $in) = @_; my $base = basename($path); local $ENV{openin_any} = q/r/; pushd(dirname($path)); my $sheet = $style // qq/$base.ist/; my @order = (); if (!defined $style && open(my $aux, q/</, qq/$base.aux/)) { for (<$aux>) { @order = (q/-l/) if /\\\@glsorder\{letter\}/; $sheet = basename($1) if /\\\@istfilename\{([^}]+\.ist)\}/; } close($aux); } my $code = 0; if (defined $style || -e $sheet) { $code = system(q/makeindex/, @order, q/-s/, $sheet, q/-t/, qq/$base.$log/, q/-o/, qq/$base.$out/, qq/$base.$in/); } elsif (open(my $empty, q/>/, qq/$base.$out/)) { close($empty); } popd(); return $code; }",
    r"add_cus_dep(q/glo/, q/gls/, 0, q/oleafly_glo/); sub oleafly_glo { oleafly_mi($_[0], undef, q/glg/, q/gls/, q/glo/) }",
    r"add_cus_dep(q/acn/, q/acr/, 0, q/oleafly_acn/); sub oleafly_acn { oleafly_mi($_[0], undef, q/alg/, q/acr/, q/acn/) }",
    r"add_cus_dep(q/nlo/, q/nls/, 0, q/oleafly_nlo/); sub oleafly_nlo { my $glossary = 0; if (open(my $list, q/</, qq/$_[0].nlo/)) { $glossary = grep { /^\\glossaryentry/ } <$list>; close($list); } oleafly_mi($_[0], $glossary ? undef : q/nomencl.ist/, q/nlg/, q/nls/, q/nlo/) }",
    r"add_cus_dep(q/slo/, q/sls/, 0, q/oleafly_slo/); sub oleafly_slo { oleafly_mi($_[0], undef, q/slg/, q/sls/, q/slo/) }",
];

#[derive(Clone, Copy, PartialEq, Eq)]
enum IndexKind {
    Index,
    Glossary,
}

const INDEX_OUTPUTS: [(&str, &str, IndexKind); 5] = [
    ("ind", "idx", IndexKind::Index),
    ("nls", "nlo", IndexKind::Index),
    ("gls", "glo", IndexKind::Glossary),
    ("acr", "acn", IndexKind::Glossary),
    ("sls", "slo", IndexKind::Glossary),
];

const AUX_NEW_GLOSSARY: &str = "\\@newglossary{";
const BLG_OPEN_FAILED: &str = "I couldn't open database file ";
const PARENT_FOLDER: &str = "../";

const UNICODE_ENGINE_LOG_LINES: [(&str, TexFlavor); 5] = [
    ("fontspec package requires either XeTeX", TexFlavor::Xelatex),
    (
        "Package unicode-math Error: Cannot be run with pdftex",
        TexFlavor::Xelatex,
    ),
    ("xeCJK package requires XeTeX", TexFlavor::Xelatex),
    ("LuaTeX is required for this package", TexFlavor::Lualatex),
    ("This package requires Lua(HB)(La)TeX", TexFlavor::Lualatex),
];

pub fn source_head(path: &Path) -> Option<String> {
    use std::io::Read;
    let file = std::fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take(SOURCE_SNIFF_BYTES).read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

pub fn shipped_bibliography(project_root: &Path, main_document: &str) -> Option<String> {
    let bbl = crate::slash_path(&Path::new(main_document).with_extension("bbl"));
    validate_latex_main_document(&bbl).ok()?;
    let metadata = std::fs::symlink_metadata(project_root.join(&bbl)).ok()?;
    if !metadata.is_file() || crate::is_cloud_placeholder(&metadata) {
        return None;
    }
    let preamble = uncommented_preamble(&source_head(&project_root.join(main_document))?);
    if preamble.contains("biblatex") || preamble.contains("\\addbibresource") {
        return None;
    }
    discover_bibliographies(project_root)
        .ok()?
        .is_empty()
        .then_some(bbl)
}

pub fn seed_shipped_bibliography(
    project_root: &Path,
    bbl: &str,
    out_dir: &Path,
) -> std::io::Result<()> {
    let bytes = std::fs::read(project_root.join(bbl))?;
    std::fs::create_dir_all(out_dir)?;
    crate::atomic::write_atomic(&out_dir.join(format!("{ENTRY_STEM}.bbl")), &bytes)
}

pub fn shipped_bibliography_note(bbl: &str) -> String {
    format!("\n[Oleafly] This project has no .bib files, so the bibliography comes from {bbl}.\n")
}

pub fn jobname_bibliography_warning(source: &str) -> Option<CompileError> {
    let code: String = source
        .lines()
        .map(crate::tex_flavor::strip_comment)
        .collect();
    let uses_jobname = ["\\bibliography{\\jobname", "\\addbibresource{\\jobname"]
        .iter()
        .any(|command| code.contains(command));
    uses_jobname.then(|| CompileError {
        message: "\\jobname doesn't name your main file in this build".into(),
        kind: "warning".into(),
        explanation: Some(format!(
            "Oleafly compiles this document under the job name {ENTRY_STEM}, so a bibliography named with \\jobname isn't found. Write the .bib file's name instead."
        )),
        code: Some("tex.jobname_bibliography".into()),
        ..Default::default()
    })
}

fn non_empty_file(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
}

fn empty_file(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|metadata| metadata.is_file() && metadata.len() == 0)
}

fn list_unbuilt(log: &str, out_dir: &Path, stem: &str, output: &str, source: &str) -> bool {
    let built = out_dir.join(format!("{stem}.{output}"));
    non_empty_file(&out_dir.join(format!("{stem}.{source}")))
        && !non_empty_file(&built)
        && (empty_file(&built) || log.contains(&format!("No file {stem}.{output}.")))
}

fn unbuilt_kind(log: &str, out_dir: &Path, stem: &str, kind: IndexKind) -> bool {
    INDEX_OUTPUTS
        .iter()
        .filter(|(_, _, candidate)| *candidate == kind)
        .any(|(output, source, _)| list_unbuilt(log, out_dir, stem, output, source))
}

fn new_glossary_files(line: &str) -> Option<(&str, &str)> {
    let fields = line
        .trim_end()
        .strip_prefix(AUX_NEW_GLOSSARY)?
        .strip_suffix('}')?;
    let mut fields = fields.split("}{").skip(2);
    let (output, source) = (fields.next()?, fields.next()?);
    let plain =
        |name: &str| !name.is_empty() && name.bytes().all(|byte| byte.is_ascii_alphanumeric());
    (fields.next().is_none() && plain(output) && plain(source)).then_some((output, source))
}

fn unbuilt_custom_glossary(log: &str, out_dir: &Path, stem: &str) -> bool {
    let Some(aux) = source_head(&out_dir.join(format!("{stem}.aux"))) else {
        return false;
    };
    aux.lines()
        .filter_map(new_glossary_files)
        .filter(|(output, _)| !INDEX_OUTPUTS.iter().any(|(known, ..)| known == output))
        .any(|(output, source)| list_unbuilt(log, out_dir, stem, output, source))
}

fn index_warning(code: &str, message: &str, explanation: &str) -> CompileError {
    CompileError {
        message: message.into(),
        kind: "warning".into(),
        explanation: Some(explanation.into()),
        code: Some(code.into()),
        ..Default::default()
    }
}

fn glossary_not_built_warning() -> CompileError {
    index_warning(
        "tex.glossary_not_built",
        "An index or glossary wasn't built",
        "The index or glossary is missing from the PDF because makeindex didn't build it. Oleafly doesn't run xindy or build lists added with \\newglossary. Remove the xindy option if the document sets it, or use \\makenoidxglossaries, which needs no external tool. Any makeindex messages are in the log.",
    )
}

pub fn unbuilt_index_warnings(
    log: &str,
    out_dir: &Path,
    stem: &str,
    bundled: bool,
) -> Vec<CompileError> {
    let index = unbuilt_kind(log, out_dir, stem, IndexKind::Index);
    let glossary = unbuilt_kind(log, out_dir, stem, IndexKind::Glossary);
    let custom = unbuilt_custom_glossary(log, out_dir, stem);
    if !bundled {
        return (index || glossary || custom)
            .then(glossary_not_built_warning)
            .into_iter()
            .collect();
    }
    let mut warnings = Vec::new();
    if index {
        warnings.push(index_warning(
            "tex.index_needs_latexmk",
            "The index wasn't built",
            "Tectonic can't run makeindex, so the index or nomenclature is missing from the PDF. Switch this project to latexmk to build it.",
        ));
    }
    if glossary {
        warnings.push(index_warning(
            "tex.glossary_needs_latexmk",
            "The glossary wasn't built",
            "Tectonic can't run makeindex, so the glossary or acronym list is missing from the PDF. Switch this project to latexmk to build it, or use \\makenoidxglossaries, which needs no external tool.",
        ));
    }
    if custom {
        warnings.push(glossary_not_built_warning());
    }
    warnings
}

pub fn unicode_engine_error(log: &str) -> Option<CompileError> {
    let flavor = UNICODE_ENGINE_LOG_LINES
        .iter()
        .find(|(line, _)| log.contains(line))
        .map(|(_, flavor)| *flavor)?;
    Some(CompileError {
        message: format!("This document needs {}", flavor.label()),
        kind: "error".into(),
        explanation: Some(format!(
            "A package in this document needs {label}, and Auto picked another compiler. Switch to {label} and compile again.",
            label = flavor.label()
        )),
        code: Some("tex.needs_unicode_engine".into()),
        params: BTreeMap::from([
            ("compiler".to_owned(), flavor.as_str().to_owned()),
            ("label".to_owned(), flavor.label().to_owned()),
        ]),
        ..Default::default()
    })
}

pub fn latexmk_biber_mismatch_error(log: &str) -> Option<CompileError> {
    (log.contains("versions are incompatible") || log.contains("control file version")).then(|| {
        CompileError {
            message: "Biber and biblatex come from different releases".into(),
            kind: "error".into(),
            explanation: Some(
                "This TeX distribution has a Biber and a biblatex that don't match, so the bibliography can't be built. Update both with the distribution's package manager, or install TinyTeX from Settings > Engines > LaTeX. The log shows both versions.".into(),
            ),
            code: Some("tex.latexmk_biber_mismatch".into()),
            ..Default::default()
        }
    })
}

fn missing_files(log: &str) -> impl Iterator<Item = &str> {
    log.lines().filter_map(|line| {
        let at = line.find(LOG_FILE_OPEN)? + LOG_FILE_OPEN.len();
        let (name, _) = line[at..].split_once(LOG_FILE_CLOSE)?;
        Some(name)
    })
}

pub fn nested_input_error(
    project_root: &Path,
    main_document: &str,
    log: &str,
) -> Option<CompileError> {
    let (folder, _) = main_document.rsplit_once('/')?;
    let file = missing_files(log).find(|name| {
        !name.is_empty()
            && !Path::new(name).is_absolute()
            && project_root.join(folder).join(name).is_file()
            && !project_root.join(name).is_file()
    })?;
    let suggestion = format!("{folder}/{file}");
    Some(CompileError {
        message: format!("{file} is in {folder}, not in the folder this compile reads from"),
        kind: "error".into(),
        explanation: Some(format!(
            "This compile reads paths from the project folder. Write the path as {suggestion}, or set compile_dir to {folder} in project.json so paths start from that folder."
        )),
        code: Some("tex.input_relative_to_main".into()),
        params: BTreeMap::from([
            ("file".to_owned(), file.to_owned()),
            ("folder".to_owned(), folder.to_owned()),
            ("suggestion".to_owned(), suggestion),
        ]),
        ..Default::default()
    })
}

pub fn bibliography_above_main_error(out_dir: &Path, stem: &str) -> Option<CompileError> {
    let blg = source_head(&out_dir.join(format!("{stem}.blg")))?;
    let file = blg.lines().find_map(|line| {
        let (_, file) = line.split_once(BLG_OPEN_FAILED)?;
        Some(file.trim_end()).filter(|file| file.starts_with(PARENT_FOLDER))
    })?;
    let name = file.trim_start_matches(PARENT_FOLDER);
    let command = format!(
        "\\bibliography{{{}}}",
        name.strip_suffix(".bib").unwrap_or(name)
    );
    Some(CompileError {
        message: format!("BibTeX can't open {file}"),
        kind: "error".into(),
        explanation: Some(format!(
            "BibTeX runs from the build folder, so a path that starts with ../ doesn't reach {file}. Write {command} instead. If BibTeX still can't find the file, copy it next to the main file."
        )),
        code: Some("tex.bibliography_above_main".into()),
        params: BTreeMap::from([
            ("file".to_owned(), file.to_owned()),
            ("command".to_owned(), command),
        ]),
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(files: &[(&str, &str)]) -> tempfile::TempDir {
        let directory = tempfile::tempdir().unwrap();
        for (path, content) in files {
            let file = directory.path().join(path);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, content).unwrap();
        }
        directory
    }

    const PLAIN: &str = "\\documentclass{article}\n\\begin{document}\n\\cite{k}\n\\bibliography{refs}\n\\end{document}\n";

    #[test]
    fn a_shipped_bbl_counts_only_when_no_bib_file_exists() {
        let shipped = project(&[("main.tex", PLAIN), ("main.bbl", "list")]);
        assert_eq!(
            shipped_bibliography(shipped.path(), "main.tex").as_deref(),
            Some("main.bbl")
        );
        let nested = project(&[("paper/ms.tex", PLAIN), ("paper/ms.bbl", "list")]);
        assert_eq!(
            shipped_bibliography(nested.path(), "paper/ms.tex").as_deref(),
            Some("paper/ms.bbl")
        );
        let with_bib = project(&[
            ("main.tex", PLAIN),
            ("main.bbl", "list"),
            ("refs/refs.bib", ""),
        ]);
        assert_eq!(shipped_bibliography(with_bib.path(), "main.tex"), None);
        let without_bbl = project(&[("main.tex", PLAIN), ("other.bbl", "list")]);
        assert_eq!(shipped_bibliography(without_bbl.path(), "main.tex"), None);
    }

    #[test]
    fn biblatex_keeps_its_own_control_files() {
        for source in [
            "\\documentclass{article}\n\\usepackage[backend=biber]{biblatex}\n\\begin{document}\n\\end{document}\n",
            "\\documentclass{article}\n\\addbibresource{refs.bib}\n\\begin{document}\n\\end{document}\n",
        ] {
            let directory = project(&[("main.tex", source), ("main.bbl", "list")]);
            assert_eq!(shipped_bibliography(directory.path(), "main.tex"), None);
        }
        let commented = project(&[
            (
                "main.tex",
                "\\documentclass{article}\n% \\usepackage{biblatex}\n\\begin{document}\n\\end{document}\n",
            ),
            ("main.bbl", "list"),
        ]);
        assert_eq!(
            shipped_bibliography(commented.path(), "main.tex").as_deref(),
            Some("main.bbl")
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_bbl_is_not_trusted() {
        let elsewhere = project(&[("secret.txt", "private")]);
        let directory = project(&[("main.tex", PLAIN)]);
        std::os::unix::fs::symlink(
            elsewhere.path().join("secret.txt"),
            directory.path().join("main.bbl"),
        )
        .unwrap();
        assert_eq!(shipped_bibliography(directory.path(), "main.tex"), None);
    }

    #[test]
    fn seeding_writes_the_list_under_the_job_name_every_time() {
        let directory = project(&[("main.bbl", "first")]);
        let out = directory.path().join(".oleafly").join("build");
        seed_shipped_bibliography(directory.path(), "main.bbl", &out).unwrap();
        let seeded = out.join(format!("{ENTRY_STEM}.bbl"));
        assert_eq!(std::fs::read_to_string(&seeded).unwrap(), "first");
        std::fs::write(directory.path().join("main.bbl"), "second").unwrap();
        seed_shipped_bibliography(directory.path(), "main.bbl", &out).unwrap();
        assert_eq!(std::fs::read_to_string(&seeded).unwrap(), "second");
    }

    #[test]
    fn jobname_in_a_bibliography_command_gets_a_warning() {
        for source in [
            "\\bibliography{\\jobname}\n",
            "\\addbibresource{\\jobname.bib}\n",
        ] {
            let warning = jobname_bibliography_warning(source).unwrap();
            assert_eq!(warning.kind, "warning");
            assert_eq!(warning.code.as_deref(), Some("tex.jobname_bibliography"));
        }
        assert!(jobname_bibliography_warning("\\bibliography{refs}\n").is_none());
        assert!(jobname_bibliography_warning("% \\bibliography{\\jobname}\n").is_none());
    }

    fn codes(warnings: &[CompileError]) -> Vec<&str> {
        warnings
            .iter()
            .map(|warning| warning.code.as_deref().unwrap_or_default())
            .collect()
    }

    #[test]
    fn tectonic_names_each_list_it_could_not_build() {
        let out = project(&[("job.idx", "\\indexentry{a}{1}"), ("job.glo", "entry")]);
        let log = "No file job.ind.\nNo file job.gls.\n";
        assert_eq!(
            codes(&unbuilt_index_warnings(log, out.path(), "job", true)),
            ["tex.index_needs_latexmk", "tex.glossary_needs_latexmk"]
        );
        for warning in unbuilt_index_warnings(log, out.path(), "job", true) {
            assert_eq!(warning.kind, "warning");
        }
    }

    #[test]
    fn nomencl_and_acronyms_count_as_their_list() {
        let out = project(&[("job.nlo", "entry"), ("job.acn", "entry")]);
        assert_eq!(
            codes(&unbuilt_index_warnings(
                "No file job.nls.\nNo file job.acr.\n",
                out.path(),
                "job",
                true
            )),
            ["tex.index_needs_latexmk", "tex.glossary_needs_latexmk"]
        );
    }

    #[test]
    fn no_warning_without_entries_or_without_the_log_line() {
        let empty = project(&[("job.idx", ""), ("job.glo", "")]);
        assert!(unbuilt_index_warnings(
            "No file job.ind.\nNo file job.gls.\n",
            empty.path(),
            "job",
            true
        )
        .is_empty());
        let built = project(&[("job.idx", "entry"), ("job.ind", "built")]);
        assert!(unbuilt_index_warnings("all good\n", built.path(), "job", true).is_empty());
        let noidx = project(&[]);
        assert!(unbuilt_index_warnings("all good\n", noidx.path(), "job", true).is_empty());
    }

    #[test]
    fn latexmk_gets_one_warning_for_any_list_that_stayed_missing() {
        let out = project(&[("job.idx", "entry"), ("job.glo", "entry")]);
        assert_eq!(
            codes(&unbuilt_index_warnings(
                "No file job.ind.\nNo file job.gls.\n",
                out.path(),
                "job",
                false
            )),
            ["tex.glossary_not_built"]
        );
    }

    #[test]
    fn a_skipped_xindy_glossary_is_reported_under_latexmk() {
        let out = project(&[("job.glo", "entry"), ("job.xdy", "style"), ("job.gls", "")]);
        assert_eq!(
            codes(&unbuilt_index_warnings(
                "all good\n",
                out.path(),
                "job",
                false
            )),
            ["tex.glossary_not_built"]
        );
    }

    #[test]
    fn a_list_with_entries_and_an_empty_output_is_reported_without_an_xdy_file() {
        let glossary = project(&[("job.glo", "entry"), ("job.gls", "")]);
        assert_eq!(
            codes(&unbuilt_index_warnings(
                "all good\n",
                glossary.path(),
                "job",
                false
            )),
            ["tex.glossary_not_built"]
        );
        let numbers = project(&[("job.nlo", "entry"), ("job.nls", "")]);
        assert_eq!(
            codes(&unbuilt_index_warnings(
                "all good\n",
                numbers.path(),
                "job",
                false
            )),
            ["tex.glossary_not_built"]
        );
    }

    #[test]
    fn a_list_that_was_built_never_counts_as_missing() {
        for (source, output) in [
            ("job.idx", "job.ind"),
            ("job.glo", "job.gls"),
            ("job.acn", "job.acr"),
            ("job.slo", "job.sls"),
        ] {
            let out = project(&[(source, "entry"), (output, "built")]);
            let log = format!("No file {output}.\n");
            assert!(
                unbuilt_index_warnings(&log, out.path(), "job", false).is_empty(),
                "{output}"
            );
        }
    }

    #[test]
    fn the_symbols_list_counts_as_a_glossary() {
        let out = project(&[("job.slo", "entry")]);
        assert_eq!(
            codes(&unbuilt_index_warnings(
                "No file job.sls.\n",
                out.path(),
                "job",
                true
            )),
            ["tex.glossary_needs_latexmk"]
        );
    }

    #[test]
    fn a_list_from_newglossary_is_read_from_the_aux_file() {
        let aux =
            "\\relax\n\\@newglossary{main}{glg}{gls}{glo}\n\\@newglossary{terms}{tlg}{tls}{tlo}\n";
        let out = project(&[("job.aux", aux), ("job.tlo", "entry")]);
        let log = "No file job.tls.\n";
        assert_eq!(
            codes(&unbuilt_index_warnings(log, out.path(), "job", false)),
            ["tex.glossary_not_built"]
        );
        assert_eq!(
            codes(&unbuilt_index_warnings(log, out.path(), "job", true)),
            ["tex.glossary_not_built"]
        );
        let built = project(&[("job.aux", aux), ("job.tlo", "entry"), ("job.tls", "built")]);
        assert!(unbuilt_index_warnings(log, built.path(), "job", false).is_empty());
        let unused = project(&[("job.aux", aux), ("job.tlo", "entry")]);
        assert!(unbuilt_index_warnings("all good\n", unused.path(), "job", false).is_empty());
    }

    #[test]
    fn a_standard_list_named_in_the_aux_file_gets_one_warning() {
        let aux =
            "\\@newglossary{numbers}{nlg}{nls}{nlo}\n\\@newglossary{symbols}{slg}{sls}{slo}\n";
        let out = project(&[("job.aux", aux), ("job.nlo", "entry"), ("job.slo", "entry")]);
        let log = "No file job.nls.\nNo file job.sls.\n";
        assert_eq!(
            codes(&unbuilt_index_warnings(log, out.path(), "job", true)),
            ["tex.index_needs_latexmk", "tex.glossary_needs_latexmk"]
        );
    }

    #[test]
    fn only_plain_extensions_are_read_from_the_aux_file() {
        assert_eq!(
            new_glossary_files("\\@newglossary{terms}{tlg}{tls}{tlo}\r"),
            Some(("tls", "tlo"))
        );
        for line in [
            "\\@newglossary{terms}{tlg}{../../secret}{tlo}",
            "\\@newglossary{terms}{tlg}{tls}",
            "\\@newglossary{terms}{tlg}{tls}{tlo}{extra}",
            "\\@newglossary{terms}{tlg}{}{tlo}",
            "\\relax",
        ] {
            assert_eq!(new_glossary_files(line), None, "{line}");
        }
    }

    #[test]
    fn a_failed_bibtex_path_above_the_build_folder_gets_its_own_error() {
        let out = project(&[(
            "job.blg",
            "The style file: plain.bst\nI couldn't open database file ../shared/refs.bib\n---line 3 of file job.aux\n",
        )]);
        let error = bibliography_above_main_error(out.path(), "job").unwrap();
        assert_eq!(error.kind, "error");
        assert_eq!(error.code.as_deref(), Some("tex.bibliography_above_main"));
        assert_eq!(error.params["file"], "../shared/refs.bib");
        assert_eq!(error.params["command"], "\\bibliography{shared/refs}");
    }

    #[test]
    fn other_bibtex_failures_keep_their_own_message() {
        let nested = project(&[("job.blg", "I couldn't open database file refs.bib\n")]);
        assert!(bibliography_above_main_error(nested.path(), "job").is_none());
        let clean = project(&[("job.blg", "Database file #1: refs.bib\n")]);
        assert!(bibliography_above_main_error(clean.path(), "job").is_none());
        let missing = project(&[]);
        assert!(bibliography_above_main_error(missing.path(), "job").is_none());
    }

    #[test]
    fn index_rules_stay_free_of_double_quotes_and_percent_signs() {
        for rule in LATEXMK_INDEX_RULES {
            assert!(!rule.contains('"'), "{rule}");
            assert!(!rule.contains('%'), "{rule}");
            assert!(!rule.contains('\n'), "{rule}");
            assert!(!rule.contains("makeglossaries"), "{rule}");
        }
    }

    #[test]
    fn a_refused_package_names_the_compiler_the_document_needs() {
        for (log, compiler) in [
            ("! Fatal Package fontspec Error: The fontspec package requires either XeTeX or\n(fontspec)                   LuaTeX.\n", "xelatex"),
            ("! Package unicode-math Error: Cannot be run with pdftex!\n", "xelatex"),
            ("! Critical Package xeCJK Error: The xeCJK package requires XeTeX to function.\n", "xelatex"),
            ("! Package luacode Error: LuaTeX is required for this package. Aborting..\n", "lualatex"),
            ("! Package luatexja-core Error: This package requires Lua(HB)(La)TeX.\n", "lualatex"),
        ] {
            let error = unicode_engine_error(log).unwrap();
            assert_eq!(error.kind, "error");
            assert_eq!(error.code.as_deref(), Some("tex.needs_unicode_engine"));
            assert_eq!(error.params["compiler"], compiler);
        }
        assert!(unicode_engine_error("! Undefined control sequence.\n").is_none());
    }

    #[test]
    fn a_biber_version_clash_gets_its_own_error() {
        for log in [
            "ERROR - Error: Found biblatex control file version 3.11, expected version 3.10.\n",
            "This means that your biber (2.20) and biblatex (3.21) versions are incompatible.\n",
        ] {
            let error = latexmk_biber_mismatch_error(log).unwrap();
            assert_eq!(error.code.as_deref(), Some("tex.latexmk_biber_mismatch"));
        }
        assert!(latexmk_biber_mismatch_error("WARN - Duplicate entry\n").is_none());
    }

    #[test]
    fn a_file_beside_a_nested_main_is_named_with_the_working_spelling() {
        let directory = project(&[("paper/main.tex", ""), ("paper/sections/intro.tex", "")]);
        let error = nested_input_error(
            directory.path(),
            "paper/main.tex",
            "! LaTeX Error: File `sections/intro.tex' not found.\n",
        )
        .unwrap();
        assert_eq!(error.code.as_deref(), Some("tex.input_relative_to_main"));
        assert_eq!(error.params["suggestion"], "paper/sections/intro.tex");
        assert_eq!(error.params["folder"], "paper");
    }

    #[test]
    fn only_a_file_that_really_sits_beside_the_main_gets_the_note() {
        let directory = project(&[
            ("paper/main.tex", ""),
            ("paper/both.tex", ""),
            ("both.tex", ""),
            ("main.tex", ""),
            ("sections/intro.tex", ""),
        ]);
        let log = |file: &str| format!("! LaTeX Error: File `{file}' not found.\n");
        assert!(
            nested_input_error(directory.path(), "paper/main.tex", &log("nothing.tex")).is_none()
        );
        assert!(nested_input_error(directory.path(), "paper/main.tex", &log("both.tex")).is_none());
        assert!(
            nested_input_error(directory.path(), "main.tex", &log("sections/intro.tex")).is_none()
        );
    }
}
