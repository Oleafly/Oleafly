#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TexFlavor {
    Pdflatex,
    Xelatex,
    Lualatex,
    Uplatex,
    Platex,
}

impl TexFlavor {
    pub const ALL: [Self; 5] = [
        Self::Pdflatex,
        Self::Xelatex,
        Self::Lualatex,
        Self::Uplatex,
        Self::Platex,
    ];

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|flavor| flavor.as_str() == value.trim())
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pdflatex => "pdflatex",
            Self::Xelatex => "xelatex",
            Self::Lualatex => "lualatex",
            Self::Uplatex => "uplatex",
            Self::Platex => "platex",
        }
    }

    pub const fn label(self) -> &'static str {
        match self {
            Self::Pdflatex => "pdfLaTeX",
            Self::Xelatex => "XeLaTeX",
            Self::Lualatex => "LuaLaTeX",
            Self::Uplatex => "upLaTeX",
            Self::Platex => "pLaTeX",
        }
    }

    pub const fn goes_through_dvi(self) -> bool {
        matches!(self, Self::Uplatex | Self::Platex)
    }

    pub fn from_magic_program(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "xelatex" => Some(Self::Xelatex),
            "lualatex" => Some(Self::Lualatex),
            "pdflatex" | "latex" => Some(Self::Pdflatex),
            "uplatex" => Some(Self::Uplatex),
            "platex" => Some(Self::Platex),
            _ => None,
        }
    }

    pub fn latexmk_args(self) -> Vec<String> {
        match self {
            Self::Pdflatex => vec!["-pdf".into()],
            Self::Xelatex => vec!["-xelatex".into()],
            Self::Lualatex => vec!["-lualatex".into()],
            Self::Uplatex => dvi_route("uplatex", "upbibtex", "upmendex"),
            Self::Platex => dvi_route("platex", "pbibtex", "mendex"),
        }
    }
}

fn dvi_route(latex: &str, bibtex: &str, makeindex: &str) -> Vec<String> {
    vec![
        "-pdfdvi".into(),
        format!("-latex={latex} %O %S"),
        "-e".into(),
        "$dvipdf = q/dvipdfmx %O -o %D %S/".into(),
        "-e".into(),
        format!("$bibtex = q/{bibtex} %O %S/"),
        "-e".into(),
        format!("$makeindex = q/{makeindex} %O -o %D %S/"),
    ]
}

const UNICODE_ENGINE_MARKERS: [&str; 10] = [
    "fontspec",
    "polyglossia",
    "unicode-math",
    "\\setmainfont",
    "\\setmainhangulfont",
    "\\sethangulfont",
    "\\setsanshangulfont",
    "\\setmonohangulfont",
    "\\setmainhanjafont",
    "\\sethanjafont",
];
const ENGINE_CONDITIONALS: [&str; 13] = [
    "\\ifxetex",
    "\\ifXeTeX",
    "\\ifluatex",
    "\\ifLuaTeX",
    "\\ifPDFTeX",
    "\\ifpdftex",
    "\\iftutex",
    "\\XeTeXversion",
    "\\luatexversion",
    "\\XeTeXrevision",
    "\\directlua",
    "\\ifpdf",
    "\\sys_if_engine_",
];

pub fn tex_program_flavor(source: &str) -> Option<TexFlavor> {
    crate::detect::tex_program_magic(source).and_then(TexFlavor::from_magic_program)
}

pub fn detect_tex_flavor(source: &str) -> TexFlavor {
    tex_program_flavor(source)
        .or_else(|| source_tex_flavor(source))
        .unwrap_or(TexFlavor::Pdflatex)
}

pub fn source_tex_flavor(source: &str) -> Option<TexFlavor> {
    let preamble = uncommented_preamble(source);
    loaded_flavor(&preamble).or_else(|| {
        UNICODE_ENGINE_MARKERS
            .iter()
            .any(|marker| preamble.contains(marker))
            .then_some(TexFlavor::Xelatex)
    })
}

pub(crate) fn branches_on_engine(source: &str) -> bool {
    ENGINE_CONDITIONALS
        .iter()
        .any(|conditional| source.contains(conditional))
}

pub(crate) fn followed_file_flavor(source: &str) -> Option<TexFlavor> {
    if branches_on_engine(source) {
        return None;
    }
    let preamble = uncommented_preamble(source);
    loaded_flavor(&preamble).or_else(|| {
        used_packages(&preamble)
            .iter()
            .any(|name| matches!(name.as_str(), "fontspec" | "polyglossia" | "unicode-math"))
            .then_some(TexFlavor::Xelatex)
    })
}

fn loaded_flavor(preamble: &str) -> Option<TexFlavor> {
    let packages = used_packages(preamble);
    if packages
        .iter()
        .any(|name| name.starts_with("luatexja") || name == "luatexko")
    {
        return Some(TexFlavor::Lualatex);
    }
    if let Some(flavor) =
        document_class(preamble).and_then(|(class, options)| class_flavor(&class, &options))
    {
        return Some(flavor);
    }
    packages
        .iter()
        .any(|name| matches!(name.as_str(), "ctex" | "xeCJK" | "zxjatype" | "xetexko"))
        .then_some(TexFlavor::Xelatex)
}

fn class_flavor(class: &str, options: &[String]) -> Option<TexFlavor> {
    let has = |name: &str| options.iter().any(|option| option == name);
    match class {
        "ujarticle" | "ujbook" | "ujreport" | "utarticle" | "utbook" | "utreport" => {
            Some(TexFlavor::Uplatex)
        }
        "jarticle" | "jbook" | "jreport" | "tarticle" | "tbook" | "treport" => {
            Some(TexFlavor::Platex)
        }
        "jsarticle" | "jsbook" | "jsreport" => Some(if has("uplatex") {
            TexFlavor::Uplatex
        } else {
            TexFlavor::Platex
        }),
        "jlreq" => Some(if has("platex") {
            TexFlavor::Platex
        } else if has("lualatex") || has("luatex") {
            TexFlavor::Lualatex
        } else {
            TexFlavor::Uplatex
        }),
        "ctexart" | "ctexbook" | "ctexrep" | "ctexbeamer" => Some(TexFlavor::Xelatex),
        _ if class.starts_with("ltj") => Some(TexFlavor::Lualatex),
        _ if class.starts_with("bxjs") => {
            if has("xelatex") {
                Some(TexFlavor::Xelatex)
            } else if has("lualatex") || has("luatex") {
                Some(TexFlavor::Lualatex)
            } else if has("uplatex") {
                Some(TexFlavor::Uplatex)
            } else if has("platex") {
                Some(TexFlavor::Platex)
            } else {
                None
            }
        }
        _ => None,
    }
}

pub(crate) fn uncommented_preamble(source: &str) -> String {
    let mut preamble = String::new();
    for line in source.lines() {
        let code = strip_comment(line);
        if let Some(index) = code.find("\\begin{document}") {
            preamble.push_str(&code[..index]);
            break;
        }
        preamble.push_str(code);
        preamble.push('\n');
    }
    preamble
}

pub(crate) fn strip_comment(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut backslashes = 0;
    for (index, byte) in bytes.iter().enumerate() {
        match byte {
            b'\\' => backslashes += 1,
            b'%' if backslashes % 2 == 0 => return &line[..index],
            _ => backslashes = 0,
        }
    }
    line
}

fn document_class(preamble: &str) -> Option<(String, Vec<String>)> {
    let start = ["\\documentclass", "\\LoadClass"]
        .iter()
        .find_map(|command| Some(preamble.find(command)? + command.len()))?;
    let (options, rest) = optional_argument(&preamble[start..]);
    let (class, _) = required_argument(rest)?;
    Some((
        class.trim().to_string(),
        split_list(options.unwrap_or_default()),
    ))
}

fn used_packages(preamble: &str) -> Vec<String> {
    let mut packages = Vec::new();
    for command in ["\\usepackage", "\\RequirePackage"] {
        let mut rest = preamble;
        while let Some(index) = rest.find(command) {
            rest = &rest[index + command.len()..];
            if rest.starts_with(|character: char| character.is_ascii_alphabetic()) {
                continue;
            }
            let (_, after_options) = optional_argument(rest);
            if let Some((list, after)) = required_argument(after_options) {
                packages.extend(split_list(list));
                rest = after;
            }
        }
    }
    packages
}

fn optional_argument(text: &str) -> (Option<&str>, &str) {
    let trimmed = text.trim_start();
    match trimmed.strip_prefix('[') {
        Some(inside) => match balanced_end(inside, ']') {
            Some(end) => (Some(&inside[..end]), &inside[end + 1..]),
            None => (None, text),
        },
        None => (None, trimmed),
    }
}

fn required_argument(text: &str) -> Option<(&str, &str)> {
    let inside = text.trim_start().strip_prefix('{')?;
    let end = balanced_end(inside, '}')?;
    Some((&inside[..end], &inside[end + 1..]))
}

fn balanced_end(text: &str, close: char) -> Option<usize> {
    let mut depth = 0usize;
    for (index, character) in text.char_indices() {
        if character == close && depth == 0 {
            return Some(index);
        }
        match character {
            '{' => depth += 1,
            '}' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    None
}

fn split_list(list: &str) -> Vec<String> {
    list.split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_manifest_value_and_nothing_else() {
        for flavor in TexFlavor::ALL {
            assert_eq!(
                TexFlavor::parse(&format!(" {} ", flavor.as_str())),
                Some(flavor)
            );
        }
        assert_eq!(TexFlavor::parse("auto"), None);
        assert_eq!(TexFlavor::parse("UPLATEX"), None);
        assert_eq!(TexFlavor::parse("uplatex --shell-escape"), None);
    }

    #[test]
    fn magic_programs_name_only_known_compilers() {
        assert_eq!(
            TexFlavor::from_magic_program("upLaTeX"),
            Some(TexFlavor::Uplatex)
        );
        assert_eq!(
            TexFlavor::from_magic_program("platex"),
            Some(TexFlavor::Platex)
        );
        assert_eq!(
            TexFlavor::from_magic_program("latex"),
            Some(TexFlavor::Pdflatex)
        );
        assert_eq!(TexFlavor::from_magic_program("uplatex -kanji=utf8"), None);
        assert_eq!(TexFlavor::from_magic_program("/bin/sh"), None);
    }

    #[test]
    fn japanese_engines_compile_through_dvipdfmx_with_matching_bibtex_and_index() {
        let args = TexFlavor::Uplatex.latexmk_args();
        assert_eq!(args[0], "-pdfdvi");
        assert!(args.contains(&"-latex=uplatex %O %S".to_string()));
        assert!(args.contains(&"$dvipdf = q/dvipdfmx %O -o %D %S/".to_string()));
        assert!(args.contains(&"$bibtex = q/upbibtex %O %S/".to_string()));
        assert!(args.contains(&"$makeindex = q/upmendex %O -o %D %S/".to_string()));
        let platex = TexFlavor::Platex.latexmk_args();
        assert!(platex.contains(&"-latex=platex %O %S".to_string()));
        assert!(platex.contains(&"$bibtex = q/pbibtex %O %S/".to_string()));
        assert!(platex.contains(&"$makeindex = q/mendex %O -o %D %S/".to_string()));
        assert_eq!(
            TexFlavor::Lualatex.latexmk_args(),
            vec!["-lualatex".to_string()]
        );
        assert!(TexFlavor::Uplatex.goes_through_dvi() && !TexFlavor::Xelatex.goes_through_dvi());
    }

    #[test]
    fn japanese_classes_pick_uplatex_or_platex() {
        for (source, expected) in [
            (
                "\\documentclass[uplatex,dvipdfmx]{jsarticle}",
                TexFlavor::Uplatex,
            ),
            (
                "\\documentclass[a4paper, uplatex]{jsbook}",
                TexFlavor::Uplatex,
            ),
            ("\\documentclass[dvipdfmx]{jsarticle}", TexFlavor::Platex),
            ("\\documentclass{jreport}", TexFlavor::Platex),
            ("\\documentclass{ujarticle}", TexFlavor::Uplatex),
            ("\\documentclass[paper=a4]{jlreq}", TexFlavor::Uplatex),
            ("\\documentclass[platex]{jlreq}", TexFlavor::Platex),
            ("\\documentclass[lualatex]{jlreq}", TexFlavor::Lualatex),
            ("\\documentclass{ltjsarticle}", TexFlavor::Lualatex),
            (
                "\\documentclass[xelatex,ja=standard]{bxjsarticle}",
                TexFlavor::Xelatex,
            ),
            (
                "\\documentclass[uplatex,dvipdfmx]{bxjsbook}",
                TexFlavor::Uplatex,
            ),
            (
                "\\documentclass{jlreq}\n\\usepackage{luatexja-fontspec}",
                TexFlavor::Lualatex,
            ),
        ] {
            assert_eq!(source_tex_flavor(source), Some(expected), "{source}");
        }
        assert_eq!(source_tex_flavor("\\documentclass{bxjsarticle}"), None);
    }

    #[test]
    fn chinese_documents_pick_xelatex() {
        for source in [
            "\\documentclass[UTF8]{ctexart}",
            "\\documentclass{ctexbook}",
            "\\documentclass{article}\n\\usepackage[UTF8]{ctex}",
            "\\documentclass{article}\n\\usepackage{amsmath, xeCJK}",
        ] {
            assert_eq!(
                source_tex_flavor(source),
                Some(TexFlavor::Xelatex),
                "{source}"
            );
        }
    }

    #[test]
    fn korean_documents_pick_the_engine_their_package_needs() {
        for (source, expected) in [
            (
                "\\documentclass{article}\n\\usepackage{kotex}\n\\setmainhangulfont{UnBatang.ttf}",
                Some(TexFlavor::Xelatex),
            ),
            (
                "\\documentclass{article}\n\\usepackage{kotex}\n\\setsanshangulfont{UnDotum.ttf}",
                Some(TexFlavor::Xelatex),
            ),
            (
                "\\documentclass{article}\n\\usepackage{kotex}\n\\setmainhanjafont{UnBatang.ttf}",
                Some(TexFlavor::Xelatex),
            ),
            (
                "\\documentclass{article}\n\\usepackage{xetexko}",
                Some(TexFlavor::Xelatex),
            ),
            (
                "\\documentclass{article}\n\\usepackage{luatexko}",
                Some(TexFlavor::Lualatex),
            ),
            ("\\documentclass{article}\n\\usepackage{kotex}", None),
        ] {
            assert_eq!(source_tex_flavor(source), expected, "{source}");
        }
    }

    #[test]
    fn engine_markers_only_count_in_live_preamble_text() {
        assert_eq!(
            source_tex_flavor(
                "\\documentclass{article}\n% \\usepackage{fontspec}\n\\usepackage{CJKutf8}\n\\begin{document}\nx\n\\end{document}\n"
            ),
            None
        );
        assert_eq!(
            source_tex_flavor(
                "\\documentclass{article}\n\\begin{document}\nThe fontspec package.\n\\end{document}\n"
            ),
            None
        );
        assert_eq!(
            detect_tex_flavor("\\documentclass{article}\n% \\setmainfont{Georgia}\n"),
            TexFlavor::Pdflatex
        );
        assert_eq!(
            source_tex_flavor("\\RequirePackage{fontspec}\n\\documentclass{article}\n"),
            Some(TexFlavor::Xelatex)
        );
    }

    #[test]
    fn every_program_comment_spelling_names_the_compiler() {
        for (source, expected) in [
            ("% !TEX TS-program = xelatex\n", Some(TexFlavor::Xelatex)),
            ("% !TeX ts-program = LuaLaTeX\n", Some(TexFlavor::Lualatex)),
            ("%!TEX TS-program=pdflatex\n", Some(TexFlavor::Pdflatex)),
            ("% !TEX engine = lualatex\n", Some(TexFlavor::Lualatex)),
            ("% !TeX program = uplatex\n", Some(TexFlavor::Uplatex)),
            ("% !TEX TS-program = /bin/sh\n", None),
            ("% !TEX engine = lualatex --shell-escape\n", None),
            ("\\documentclass{article}\n", None),
        ] {
            assert_eq!(tex_program_flavor(source), expected, "{source}");
        }
        let far_down = format!("{}% !TEX TS-program = xelatex\n", "%\n".repeat(99));
        assert_eq!(tex_program_flavor(&far_down), Some(TexFlavor::Xelatex));
        let too_far = format!("{}% !TEX TS-program = xelatex\n", "%\n".repeat(100));
        assert_eq!(tex_program_flavor(&too_far), None);
    }

    #[test]
    fn a_followed_file_counts_only_when_it_needs_the_engine() {
        assert_eq!(
            followed_file_flavor("\\RequirePackage{fontspec}\n\\setmainfont{Georgia}\n"),
            Some(TexFlavor::Xelatex)
        );
        assert_eq!(
            followed_file_flavor("\\LoadClass[UTF8]{ctexart}\n"),
            Some(TexFlavor::Xelatex)
        );
        assert_eq!(
            followed_file_flavor("\\usepackage{luatexja}\n"),
            Some(TexFlavor::Lualatex)
        );
        assert_eq!(
            followed_file_flavor(
                "\\RequirePackage{iftex}\n\\ifxetex\n\\RequirePackage{fontspec}\n\\else\n\\RequirePackage[T1]{fontenc}\n\\fi\n"
            ),
            None
        );
        assert_eq!(
            followed_file_flavor("\\@ifpackageloaded{fontspec}{\\setmainfont{Georgia}}{}\n"),
            None
        );
    }

    #[test]
    fn every_engine_test_spelling_counts_as_a_branch() {
        for source in [
            "\\ifdefined\\XeTeXrevision\\fi\n",
            "\\ifdefined\\directlua\\fi\n",
            "\\ifpdf\\fi\n",
            "\\sys_if_engine_xetex:TF{}{}\n",
            "\\ifxetex\\fi\n",
        ] {
            assert!(branches_on_engine(source), "{source}");
            assert_eq!(
                followed_file_flavor(&format!("{source}\\RequirePackage{{fontspec}}\n")),
                None
            );
        }
        assert!(!branches_on_engine("\\RequirePackage{fontspec}\n"));
    }

    #[test]
    fn comments_and_the_document_body_do_not_count() {
        assert_eq!(
            source_tex_flavor("% \\documentclass[uplatex]{jsarticle}\n\\documentclass{article}"),
            None
        );
        assert_eq!(
            source_tex_flavor("\\documentclass{article}\n\\begin{document}\n\\usepackage{ctex}\n"),
            None
        );
        assert_eq!(
            source_tex_flavor("\\documentclass{article} 100\\% % {jsarticle}\n"),
            None
        );
        assert_eq!(
            source_tex_flavor("\\documentclass{article}\n\\usepackagex{ctex}\n"),
            None
        );
    }

    #[test]
    fn unicode_font_packages_still_pick_xelatex() {
        assert_eq!(
            source_tex_flavor("\\documentclass{article}\n\\usepackage{fontspec}"),
            Some(TexFlavor::Xelatex)
        );
        assert_eq!(source_tex_flavor("\\documentclass{article}"), None);
    }

    #[test]
    fn class_options_with_braces_and_line_breaks_parse() {
        assert_eq!(
            source_tex_flavor("\\documentclass[\n  paper={a4},\n  uplatex,\n]{jsarticle}"),
            Some(TexFlavor::Uplatex)
        );
    }
}
