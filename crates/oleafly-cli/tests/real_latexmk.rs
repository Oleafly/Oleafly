use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::TempDir;

const ENTRY_LOG: &str = ".oleafly/build/_oleafly_entry.log";

fn real_tex_ready() -> bool {
    let search = oleafly_core::tex_distro::TexSearch::from_env();
    if oleafly_core::tex_distro::find_tex_tool(&search, "latexmk").is_some() {
        return true;
    }
    assert!(
        std::env::var_os("OLEAFLY_REQUIRE_REAL_TEX").is_none(),
        "OLEAFLY_REQUIRE_REAL_TEX is set but latexmk is not on PATH"
    );
    eprintln!("skipped: latexmk is not installed");
    false
}

fn tool_ready(name: &str) -> bool {
    let search = oleafly_core::tex_distro::TexSearch::from_env();
    let found = oleafly_core::tex_distro::find_tex_tool(&search, name).is_some();
    assert!(
        found || std::env::var_os("OLEAFLY_REQUIRE_REAL_TEX").is_none(),
        "OLEAFLY_REQUIRE_REAL_TEX is set but {name} is not on PATH"
    );
    found
}

fn project(folder: &str, manifest: Value, files: &[(&str, &str)]) -> (TempDir, PathBuf) {
    let scratch = TempDir::new().unwrap();
    let root = scratch.path().join(folder);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("project.json"), manifest.to_string()).unwrap();
    for (name, text) in files {
        let path = root.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
    (scratch, root)
}

fn build(root: &Path) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .args(["--json", "--log", "full", "build"])
        .current_dir(root)
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "oleaflyc printed no JSON ({error})\nstdout: {}\nstderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    });
    let log = value["build"]["log"].as_str().unwrap_or_default();
    assert!(
        !log.contains("Stopping because") && !log.contains("Unterminated"),
        "latexmk stopped before LaTeX ran:\n{log}"
    );
    assert_eq!(value["ok"], true, "{value:#}");
    value
}

fn built(root: &Path, extension: &str) -> bool {
    std::fs::metadata(root.join(format!(".oleafly/build/_oleafly_entry.{extension}")))
        .is_ok_and(|metadata| metadata.len() > 0)
}

#[test]
#[ignore = "runs the installed TeX distribution"]
fn real_latexmk_builds_every_list_the_rc_file_knows() {
    if !real_tex_ready() {
        return;
    }
    let (_scratch, root) = project(
        "O'Neil [lists]",
        serde_json::json!({"name": "lists", "main_doc": "O'Neil[1].tex", "engine": "latexmk", "tex_flavor": "pdflatex"}),
        &[(
            "O'Neil[1].tex",
            "\\documentclass{article}\n\\usepackage[acronym,symbols,order=letter]{glossaries}\n\\usepackage{nomencl}\n\\usepackage{makeidx}\n\\makeglossaries\n\\makenomenclature\n\\makeindex\n\\newglossaryentry{sea lion}{name={sea lion},description={a mammal}}\n\\newglossaryentry{seal}{name={seal},description={a mammal}}\n\\newacronym{gpu}{GPU}{graphics processing unit}\n\\newglossaryentry{c}{type=symbols,name={\\ensuremath{c}},description={speed}}\n\\begin{document}\n\\gls{sea lion} \\gls{seal} \\gls{gpu} \\gls{c}\\index{word} $c$\\nomenclature{$c$}{speed of light}\n\\printglossaries\n\\printnomenclature\n\\printindex\n\\end{document}\n",
        )],
    );
    build(&root);
    for extension in ["gls", "acr", "sls", "nls", "ind"] {
        assert!(built(&root, extension), "{extension} was not built");
    }
    let glossary = std::fs::read_to_string(root.join(".oleafly/build/_oleafly_entry.gls")).unwrap();
    assert!(
        glossary.find("{seal}").unwrap() < glossary.find("{sea lion}").unwrap(),
        "order=letter did not reach makeindex as -l\n{glossary}"
    );
}

#[test]
#[ignore = "runs the installed TeX distribution"]
fn real_latexmk_builds_a_bib2gls_glossary_and_follows_a_chapter() {
    if !real_tex_ready() || !tool_ready("bib2gls") {
        return;
    }
    let (_scratch, root) = project(
        "record",
        serde_json::json!({"name": "record", "main_doc": "main.tex", "engine": "latexmk", "tex_flavor": "pdflatex"}),
        &[
            (
                "terms.bib",
                "@entry{duck,name={duck},description={a waterbird}}\n@entry{goose,name={goose},description={a waterbird}}\n",
            ),
            (
                "main.tex",
                "\\documentclass{article}\n\\usepackage[record]{glossaries-extra}\n\\GlsXtrLoadResources[src={terms}]\n\\begin{document}\nMain.\n\\include{chapter}\n\\printunsrtglossaries\n\\end{document}\n",
            ),
        ],
    );
    for chapter in ["\\gls{duck}\n", "\\gls{duck} and \\gls{goose}\n"] {
        std::fs::write(root.join("chapter.tex"), chapter).unwrap();
        build(&root);
        assert!(
            built(&root, "glstex"),
            "bib2gls built nothing for {chapter}"
        );
        let log = std::fs::read_to_string(root.join(ENTRY_LOG)).unwrap();
        assert!(!log.contains("has not been defined"), "{chapter}\n{log}");
    }
}

#[test]
#[ignore = "runs the installed TeX distribution"]
fn real_latexmk_builds_a_nested_main_with_lualatex() {
    if !real_tex_ready() || !tool_ready("lualatex") {
        return;
    }
    let (_scratch, root) = project(
        "nested",
        serde_json::json!({"name": "nested", "main_doc": "paper/main.tex", "engine": "latexmk", "tex_flavor": "lualatex", "compile_dir": "paper"}),
        &[
            (
                "paper/main.tex",
                "\\documentclass{article}\n\\usepackage{makeidx}\n\\makeindex\n\\begin{document}\n\\input{sections/intro}\n\\printindex\n\\end{document}\n",
            ),
            ("paper/sections/intro.tex", "Intro.\\index{intro}\n"),
        ],
    );
    build(&root);
    assert!(
        built(&root, "ind"),
        "the index of a nested main was not built"
    );
    assert!(built(&root, "pdf"));
}
