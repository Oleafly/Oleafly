use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime};

use super::{
    coverage_database, uncovered_by, TypstCompileSettings, COVERAGE_PROBE_LIMIT,
    PLACEHOLDER_FAMILIES,
};
use crate::app_error::AppError;
use crate::document_engine::CompileError;

const MAX_SOURCE_FILES: usize = 256;
const MAX_SOURCE_BYTES: u64 = 8 * 1024 * 1024;
const PROBES_PER_BLOCK: usize = 4;
const PROBE_GROUPS: usize = 4;
const SAMPLE_CHARACTERS: usize = 6;
const COVERED_TTL: Duration = Duration::from_secs(10 * 60);
const UNCOVERED_TTL: Duration = Duration::from_secs(30);
const CJK_FONT_PACK: &str = "typst-cjk";
const ICON_FONT_PACK: &str = "typst-icons";
const PLACEHOLDER_CODE: &str = "typst.placeholder_glyphs";
const MISSING_CODE: &str = "typst.missing_glyphs";
const MISSING_WITH_PACK_CODE: &str = "typst.missing_glyphs_pack";
const MISSING_SEALED_CODE: &str = "typst.missing_glyphs_sealed";

const EMBEDDED_RANGES: [(u32, u32); 86] = [
    (0x0041, 0x0477),
    (0x047A, 0x04F9),
    (0x04FC, 0x04FF),
    (0x0510, 0x0513),
    (0x051A, 0x051D),
    (0x0531, 0x0559),
    (0x0561, 0x0587),
    (0x05B0, 0x05F2),
    (0x0615, 0x0615),
    (0x0621, 0x063A),
    (0x0640, 0x0655),
    (0x065A, 0x065A),
    (0x0674, 0x0674),
    (0x0679, 0x067B),
    (0x067E, 0x0680),
    (0x0683, 0x0684),
    (0x0686, 0x0687),
    (0x0691, 0x0691),
    (0x0698, 0x0698),
    (0x06A4, 0x06A4),
    (0x06A9, 0x06A9),
    (0x06AF, 0x06AF),
    (0x06BE, 0x06BE),
    (0x06CC, 0x06CC),
    (0x0900, 0x097F),
    (0x0E81, 0x0E84),
    (0x0E87, 0x0E88),
    (0x0E8A, 0x0E8A),
    (0x0E8D, 0x0E8D),
    (0x0E94, 0x0E97),
    (0x0E99, 0x0E9F),
    (0x0EA1, 0x0EA7),
    (0x0EAA, 0x0EAB),
    (0x0EAD, 0x0EBC),
    (0x0ECD, 0x0ECD),
    (0x10D0, 0x10FC),
    (0x13A0, 0x13FD),
    (0x1D00, 0x1D00),
    (0x1D02, 0x1D02),
    (0x1D07, 0x1D0B),
    (0x1D0D, 0x1D0D),
    (0x1D14, 0x1D19),
    (0x1D1C, 0x1D1F),
    (0x1D2C, 0x1D2E),
    (0x1D30, 0x1D3C),
    (0x1D3E, 0x1D67),
    (0x1D77, 0x1D78),
    (0x1D7B, 0x1D7B),
    (0x1D85, 0x1D85),
    (0x1D90, 0x1D93),
    (0x1D97, 0x1D97),
    (0x1D9B, 0x1DB7),
    (0x1DB9, 0x1DBF),
    (0x1E00, 0x2184),
    (0x24B6, 0x24E9),
    (0x2C60, 0x2C71),
    (0x2C74, 0x2C77),
    (0x2C79, 0x2C7A),
    (0x2C7C, 0x2CF3),
    (0xA46A, 0xA46B),
    (0xA640, 0xA641),
    (0xA648, 0xA649),
    (0xA656, 0xA657),
    (0xA71B, 0xA727),
    (0xA72D, 0xA72D),
    (0xA730, 0xA730),
    (0xA735, 0xA735),
    (0xA765, 0xA765),
    (0xA78B, 0xA78E),
    (0xA790, 0xA791),
    (0xA7AA, 0xA7AA),
    (0xA7F8, 0xA7F9),
    (0xAB66, 0xAB66),
    (0xAB70, 0xABBF),
    (0xFB00, 0xFB06),
    (0xFB1D, 0xFB4F),
    (0xFB52, 0xFB81),
    (0xFB8A, 0xFB95),
    (0xFB9E, 0xFB9F),
    (0xFBAA, 0xFBAD),
    (0xFBE8, 0xFBE9),
    (0xFBFC, 0xFBFF),
    (0xFE70, 0xFEFC),
    (0x10140, 0x10174),
    (0x1D400, 0x1D7CB),
    (0x1EE00, 0x1EEBB),
];

const CJK_RANGES: [(u32, u32); 10] = [
    (0x1100, 0x11FF),
    (0x2E80, 0x2FDF),
    (0x3000, 0x31FF),
    (0x3400, 0x4DBF),
    (0x4E00, 0x9FFF),
    (0xA960, 0xA97F),
    (0xAC00, 0xD7FF),
    (0xF900, 0xFAFF),
    (0xFF00, 0xFFEF),
    (0x20000, 0x323AF),
];

const EMOJI_RANGE: (u32, u32) = (0x1F300, 0x1FAFF);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct GlyphCheck {
    pub(crate) pdf: PathBuf,
    pub(crate) project_dir: PathBuf,
    pub(crate) main_document: String,
    pub(crate) settings: TypstCompileSettings,
}

struct CoverageCache {
    font_dirs: Vec<(PathBuf, Option<SystemTime>)>,
    ignore_system_fonts: bool,
    loaded: Instant,
    database: fontdb::Database,
    known: HashMap<char, bool>,
}

impl CoverageCache {
    fn serves(
        &self,
        font_dirs: &[(PathBuf, Option<SystemTime>)],
        ignore_system_fonts: bool,
    ) -> bool {
        let lifetime = if self.known.values().all(|covered| *covered) {
            COVERED_TTL
        } else {
            UNCOVERED_TTL
        };
        self.font_dirs == font_dirs
            && self.ignore_system_fonts == ignore_system_fonts
            && self.loaded.elapsed() < lifetime
    }

    fn uncovered(&mut self, probes: &str) -> String {
        let unknown: String = probes
            .chars()
            .filter(|character| !self.known.contains_key(character))
            .collect();
        if !unknown.is_empty() {
            let missing = uncovered_by(&self.database, &unknown);
            for character in unknown.chars() {
                self.known.insert(character, !missing.contains(character));
            }
        }
        probes
            .chars()
            .filter(|character| self.known.get(character) == Some(&false))
            .collect()
    }
}

#[derive(PartialEq, Eq)]
struct PdfIdentity {
    path: PathBuf,
    len: u64,
    modified: Option<SystemTime>,
}

static COVERAGE: Mutex<Option<CoverageCache>> = Mutex::new(None);
static LAST_PLACEHOLDER_SCAN: Mutex<Option<(PdfIdentity, bool)>> = Mutex::new(None);

fn in_ranges(character: char, ranges: &[(u32, u32)]) -> bool {
    let code = character as u32;
    let following = ranges.partition_point(|(start, _)| *start <= code);
    ranges[..following]
        .last()
        .is_some_and(|(_, end)| code <= *end)
}

fn is_cjk(character: char) -> bool {
    in_ranges(character, &CJK_RANGES)
}

fn is_emoji(character: char) -> bool {
    in_ranges(character, &[EMOJI_RANGE])
}

fn needs_outside_font(character: char) -> bool {
    is_emoji(character) || (character.is_alphabetic() && !in_ranges(character, &EMBEDDED_RANGES))
}

fn comment_closing(rest: &str, previous: char) -> Option<&'static str> {
    if rest.starts_with("/*") {
        Some("*/")
    } else if rest.starts_with("//") && previous != ':' {
        Some("\n")
    } else {
        None
    }
}

fn without_comments(source: &str) -> String {
    let mut kept = String::with_capacity(source.len());
    let mut in_string = false;
    let mut previous = '\n';
    let mut rest = source;
    while let Some(character) = rest.chars().next() {
        if let Some(closing) = comment_closing(rest, previous).filter(|_| !in_string) {
            let body = &rest[2..];
            match body.find(closing) {
                Some(end) => rest = &body[end + closing.len()..],
                None => break,
            }
            continue;
        }
        match character {
            '"' => in_string = !in_string,
            '\n' => in_string = false,
            _ => {}
        }
        let mut width = character.len_utf8();
        if character == '\\' {
            width += rest[1..].chars().next().map_or(0, char::len_utf8);
        }
        kept.push_str(&rest[..width]);
        previous = character;
        rest = &rest[width..];
    }
    kept
}

fn imported_paths(text: &str) -> impl Iterator<Item = &str> {
    text.lines().flat_map(|line| {
        line.match_indices(".typ\"").filter_map(move |(end, _)| {
            let start = line[..end].rfind('"')? + 1;
            Some(&line[start..end + ".typ".len()])
        })
    })
}

fn read_source(path: &Path) -> Option<String> {
    let size = std::fs::metadata(path).ok()?.len();
    if size > MAX_SOURCE_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn project_sources(project_dir: &Path, main_document: &str) -> Vec<String> {
    let Ok(root) = project_dir.canonicalize() else {
        return Vec::new();
    };
    let mut pending = vec![root.join(main_document)];
    let mut visited = BTreeSet::new();
    let mut texts = Vec::new();
    while let Some(path) = pending.pop() {
        if visited.len() >= MAX_SOURCE_FILES {
            break;
        }
        let Ok(path) = path.canonicalize() else {
            continue;
        };
        if !path.starts_with(&root) || !visited.insert(path.clone()) {
            continue;
        }
        let Some(source) = read_source(&path) else {
            continue;
        };
        let text = without_comments(&source);
        let folder = path.parent().unwrap_or(&root);
        for imported in imported_paths(&text) {
            pending.push(match imported.strip_prefix('/') {
                Some(relative) => root.join(relative),
                None => folder.join(imported),
            });
        }
        texts.push(text);
    }
    texts
}

fn probe_group(character: char) -> usize {
    match character as u32 {
        0x1100..=0x11FF | 0xA960..=0xA97F | 0xAC00..=0xD7FF => 0,
        0x3040..=0x31FF => 1,
        _ if is_cjk(character) => 2,
        _ => 3,
    }
}

fn glyph_probes(texts: &[String]) -> String {
    let budget = COVERAGE_PROBE_LIMIT / PROBE_GROUPS;
    let mut seen = BTreeSet::new();
    let mut per_block: HashMap<u32, usize> = HashMap::new();
    let mut probes: [String; PROBE_GROUPS] = Default::default();
    let mut counts = [0_usize; PROBE_GROUPS];
    for character in texts
        .iter()
        .flat_map(|text| text.chars())
        .filter(|character| needs_outside_font(*character))
    {
        let group = probe_group(character);
        let block = per_block.entry(character as u32 >> 8).or_default();
        if counts[group] >= budget || *block >= PROBES_PER_BLOCK || !seen.insert(character) {
            continue;
        }
        counts[group] += 1;
        *block += 1;
        probes[group].push(character);
    }
    probes.concat()
}

fn font_dir_stamps(settings: &TypstCompileSettings) -> Vec<(PathBuf, Option<SystemTime>)> {
    settings
        .font_dirs
        .iter()
        .map(|directory| {
            let modified = std::fs::metadata(directory)
                .and_then(|meta| meta.modified())
                .ok();
            (directory.clone(), modified)
        })
        .collect()
}

fn cached_uncovered(settings: &TypstCompileSettings, probes: &str) -> String {
    let font_dirs = font_dir_stamps(settings);
    let mut cache = COVERAGE.lock().unwrap_or_else(PoisonError::into_inner);
    if !cache
        .as_ref()
        .is_some_and(|cache| cache.serves(&font_dirs, settings.ignore_system_fonts))
    {
        *cache = None;
    }
    cache
        .get_or_insert_with(|| CoverageCache {
            font_dirs,
            ignore_system_fonts: settings.ignore_system_fonts,
            loaded: Instant::now(),
            database: coverage_database(settings),
            known: HashMap::new(),
        })
        .uncovered(probes)
}

fn pdf_names_placeholder_font(pdf: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(pdf) else {
        return false;
    };
    let identity = PdfIdentity {
        path: pdf.to_owned(),
        len: metadata.len(),
        modified: metadata.modified().ok(),
    };
    let mut last = LAST_PLACEHOLDER_SCAN
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    if let Some((_, found)) = last.as_ref().filter(|(seen, _)| *seen == identity) {
        return *found;
    }
    let found = std::fs::read(pdf).is_ok_and(|bytes| names_placeholder_font(&bytes));
    *last = Some((identity, found));
    found
}

fn names_placeholder_font(pdf: &[u8]) -> bool {
    PLACEHOLDER_FAMILIES.iter().any(|family| {
        let marker = format!("+{family}");
        pdf.windows(marker.len())
            .any(|window| window == marker.as_bytes())
    })
}

fn pack_covering(uncovered: &str, settings: &TypstCompileSettings) -> Option<&'static str> {
    let wanted = if uncovered.chars().any(is_cjk) {
        CJK_FONT_PACK
    } else if uncovered.chars().any(is_emoji) {
        ICON_FONT_PACK
    } else {
        return None;
    };
    let installed = settings
        .font_dirs
        .iter()
        .any(|directory| directory.ends_with(wanted));
    (!installed).then_some(wanted)
}

fn coded_warning(error: AppError, message: String) -> CompileError {
    let params: BTreeMap<String, String> = error.params.clone();
    let code = error.code.to_owned();
    CompileError {
        explanation: crate::app_error::english(&String::from(error)),
        kind: "warning".to_owned(),
        message,
        code: Some(code),
        params,
        ..CompileError::default()
    }
}

fn placeholder_warning() -> CompileError {
    coded_warning(
        AppError::new(PLACEHOLDER_CODE)
            .param("bodyFont", "Body font")
            .param("documentSettings", "Document settings"),
        "some characters use a placeholder font".to_owned(),
    )
}

fn missing_glyph_warning(uncovered: &str, settings: &TypstCompileSettings) -> CompileError {
    let sample: String = uncovered
        .chars()
        .take(SAMPLE_CHARACTERS)
        .map(String::from)
        .collect::<Vec<_>>()
        .join(" ");
    let message = format!("no font has these characters: {sample}");
    let error = if settings.ignore_system_fonts {
        AppError::new(MISSING_SEALED_CODE)
            .param("sample", &sample)
            .param("systemFonts", "Use system fonts")
            .param("standardBuild", "Standard build")
    } else if let Some(pack) = pack_covering(uncovered, settings) {
        AppError::new(MISSING_WITH_PACK_CODE)
            .param("sample", &sample)
            .param("pack", pack)
    } else {
        AppError::new(MISSING_CODE).param("sample", &sample)
    };
    coded_warning(error, message)
}

impl GlyphCheck {
    pub(crate) fn warnings(&self) -> Vec<CompileError> {
        let probes = glyph_probes(&project_sources(&self.project_dir, &self.main_document));
        let uncovered = if probes.is_empty() {
            String::new()
        } else {
            cached_uncovered(&self.settings, &probes)
        };
        let mut warnings = Vec::new();
        if pdf_names_placeholder_font(&self.pdf) {
            warnings.push(placeholder_warning());
        }
        if !uncovered.is_empty() {
            warnings.push(missing_glyph_warning(&uncovered, &self.settings));
        }
        warnings
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sources(texts: &[&str]) -> Vec<String> {
        texts.iter().map(|text| (*text).to_owned()).collect()
    }

    #[test]
    fn the_placeholder_scan_reads_font_names_in_the_pdf_bytes() {
        assert!(names_placeholder_font(
            b"<< /BaseFont /FLDKKC+LastResort-Identity-H >>"
        ));
        assert!(!names_placeholder_font(
            b"<< /BaseFont /FLDKKC+LibertinusSerif-Regular >> LastResort"
        ));
        assert!(!names_placeholder_font(b""));
    }

    #[test]
    fn probes_skip_scripts_the_embedded_fonts_draw() {
        let text = "Hello Ελληνικά Русский עברית العربية हिन्दी 2 + 2 — “x” ∑";
        assert_eq!(glyph_probes(&sources(&[text])), "");
    }

    #[test]
    fn probes_keep_scripts_that_need_another_font() {
        let probes = glyph_probes(&sources(&["한글 中文 かな ภาษา বাংলা 🚀"]));
        for character in ['한', '中', 'か', 'ภ', 'ব', '🚀'] {
            assert!(probes.contains(character), "{character} in {probes}");
        }
    }

    #[test]
    fn the_range_tables_stay_sorted_for_the_lookup() {
        for ranges in [&EMBEDDED_RANGES[..], &CJK_RANGES[..]] {
            assert!(ranges.iter().all(|(start, end)| start <= end));
            assert!(ranges.windows(2).all(|pair| pair[0].1 < pair[1].0));
        }
    }

    #[test]
    fn the_range_lookup_sees_both_ends_and_the_gaps_between() {
        let ranges = [(0x10, 0x20), (0x30, 0x30)];
        for (code, inside) in [
            (0x0F, false),
            (0x10, true),
            (0x20, true),
            (0x21, false),
            (0x30, true),
            (0x31, false),
        ] {
            let character = char::from_u32(code).unwrap();
            assert_eq!(in_ranges(character, &ranges), inside, "{code:x}");
        }
    }

    fn assert_probed(character: char) {
        let probes = glyph_probes(&sources(&[&character.to_string()]));
        assert!(probes.contains(character), "U+{:04X}", character as u32);
    }

    #[test]
    fn probes_keep_letters_the_embedded_fonts_lack() {
        for urdu in ['\u{0688}', '\u{06BA}', '\u{06C1}', '\u{06D2}'] {
            assert_probed(urdu);
        }
        for character in [
            '\u{0500}', '\u{0750}', '\u{0EC0}', '\u{10A0}', '\u{1C80}', '\u{2D00}', '\u{A643}',
            '\u{A729}', '\u{AB50}', '\u{FB50}', '\u{FDF2}',
        ] {
            assert_probed(character);
        }
    }

    #[test]
    fn probes_keep_letters_only_newer_typst_versions_draw() {
        for character in ['\u{0478}', '\u{10FD}', '\u{1D01}', '\u{1D86}', '\u{FB13}'] {
            assert_probed(character);
        }
    }

    #[test]
    fn probes_skip_letters_every_catalog_version_draws() {
        let drawn: String = [
            '\u{0628}', '\u{064E}', '\u{067E}', '\u{06AF}', '\u{06CC}', '\u{10D0}', '\u{13A0}',
            '\u{1D00}', '\u{2C81}', '\u{AB70}', '\u{FB01}', '\u{FB56}', '\u{FEFB}',
        ]
        .into_iter()
        .collect();
        assert_eq!(glyph_probes(&sources(&[&drawn])), "");
    }

    #[test]
    fn a_page_of_han_cannot_crowd_out_thai() {
        let han: String = (0x4E00..0x9000)
            .filter_map(char::from_u32)
            .take(4000)
            .collect();
        let probes = glyph_probes(&sources(&[&han, "ภาษาไทย"]));
        assert!(probes.contains('ภ'), "{probes}");
        assert!(probes.chars().count() <= COVERAGE_PROBE_LIMIT);
    }

    #[test]
    fn a_page_of_han_cannot_crowd_out_hangul_or_kana() {
        let han: String = (0x4E00..0x9000)
            .filter_map(char::from_u32)
            .take(4000)
            .collect();
        let probes = glyph_probes(&sources(&[&han, "한글 かな"]));
        assert!(probes.contains('한'), "{probes}");
        assert!(probes.contains('か'), "{probes}");
        assert!(probes.chars().count() <= COVERAGE_PROBE_LIMIT);
    }

    #[test]
    fn comments_do_not_count_as_document_text() {
        let text = without_comments("Hello // ไทย\n/* 한글\n中文 */ World\n");
        assert_eq!(text, "Hello  World\n");
        assert_eq!(glyph_probes(&[text]), "");
        assert_eq!(without_comments("open /* 한글"), "open ");
        assert_eq!(without_comments("no comments"), "no comments");
    }

    #[test]
    fn links_and_strings_are_not_comments() {
        for kept in [
            "#link(\"https://example.com\")[한글 링크]\n= 제목\n",
            "See https://example.com for 한글.\n",
            "#let path = \"a//b/*c\"\n한글\n",
            "An escaped \\// slash\n",
        ] {
            assert_eq!(without_comments(kept), kept);
        }
        assert_eq!(
            without_comments("#link(\"https://example.com\")[한글] // ไทย\nnext\n"),
            "#link(\"https://example.com\")[한글] next\n"
        );
    }

    #[test]
    fn escaped_quotes_and_stray_quotes_cannot_hide_a_comment() {
        assert_eq!(
            without_comments("#let a = \"say \\\"hi\\\"\" // ไทย\nnext\n"),
            "#let a = \"say \\\"hi\\\"\" next\n"
        );
        assert_eq!(
            without_comments("#let a = \"C:\\\\\" // ไทย\nnext\n"),
            "#let a = \"C:\\\\\" next\n"
        );
        assert_eq!(
            without_comments("A 5\" screen\n// ไทย\nnext\n"),
            "A 5\" screen\nnext\n"
        );
    }

    #[test]
    fn neighbouring_comments_all_go() {
        assert_eq!(without_comments("/*/ ไทย */next"), "next");
        assert_eq!(without_comments("// ไทย\n// 한글\nnext"), "next");
    }

    #[test]
    fn import_paths_do_not_depend_on_quotes_pairing_up() {
        for (text, expected) in [
            (
                "#link(\"https://example.com\")[site]\n#include \"chapters/ko.typ\"\n",
                vec!["chapters/ko.typ"],
            ),
            (
                "An \"unbalanced quote in prose\n#include \"ko.typ\"\n",
                vec!["ko.typ"],
            ),
            (
                "#for name in (\"a.typ\", \"b.typ\") { include name }\n",
                vec!["a.typ", "b.typ"],
            ),
            (
                "#import \"a.typ\": x\n#import \"@preview/cetz:0.2.2\"\n",
                vec!["a.typ"],
            ),
            ("A note about main.typ\" in prose\n", vec![]),
        ] {
            assert_eq!(imported_paths(text).collect::<Vec<_>>(), expected, "{text}");
        }
    }

    #[test]
    fn sources_after_a_link_are_still_read() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(
            root.path().join("main.typ"),
            "#link(\"https://example.com\")[กรุงเทพ]\n#include \"ko.typ\"\n",
        )
        .unwrap();
        std::fs::write(root.path().join("ko.typ"), "한글").unwrap();
        let joined = project_sources(root.path(), "main.typ").join("\n");
        assert!(joined.contains("กรุงเทพ"), "{joined}");
        assert!(joined.contains("한글"), "{joined}");
    }

    #[test]
    fn sources_follow_imports_and_stay_inside_the_project() {
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().join("project");
        std::fs::create_dir_all(root.join("chapters")).unwrap();
        std::fs::write(outer.path().join("outside.typ"), "กรุงเทพ").unwrap();
        std::fs::write(
            root.join("main.typ"),
            "#include \"chapters/one.typ\"\n#import \"../outside.typ\": x\n#import \"@preview/cetz:0.2.2\"\n",
        )
        .unwrap();
        std::fs::write(
            root.join("chapters/one.typ"),
            "#import \"/shared.typ\": y\n한글\n#include \"one.typ\"\n",
        )
        .unwrap();
        std::fs::write(root.join("shared.typ"), "中文").unwrap();
        std::fs::write(root.join("unused.typ"), "বাংলা").unwrap();
        let joined = project_sources(&root, "main.typ").join("\n");
        assert!(joined.contains("한글"));
        assert!(joined.contains("中文"));
        assert!(!joined.contains("กรุงเทพ"));
        assert!(!joined.contains("বাংলা"));
    }

    #[test]
    fn missing_glyph_warnings_name_the_action_that_can_work() {
        let open = TypstCompileSettings::default();
        let sealed = TypstCompileSettings {
            ignore_system_fonts: true,
            ..TypstCompileSettings::default()
        };
        let installed = TypstCompileSettings {
            font_dirs: vec![PathBuf::from("assets")
                .join("typst-fonts")
                .join("typst-cjk")],
            ..TypstCompileSettings::default()
        };
        let cjk = missing_glyph_warning("한글", &open);
        assert_eq!(cjk.code.as_deref(), Some(MISSING_WITH_PACK_CODE));
        assert_eq!(cjk.params["pack"], CJK_FONT_PACK);
        assert_eq!(cjk.params["sample"], "한 글");
        assert_eq!(cjk.kind, "warning");
        let emoji = missing_glyph_warning("🚀", &open);
        assert_eq!(emoji.params["pack"], ICON_FONT_PACK);
        let thai = missing_glyph_warning("ก", &open);
        assert_eq!(thai.code.as_deref(), Some(MISSING_CODE));
        let done = missing_glyph_warning("한글", &installed);
        assert_eq!(done.code.as_deref(), Some(MISSING_CODE));
        let closed = missing_glyph_warning("한글", &sealed);
        assert_eq!(closed.code.as_deref(), Some(MISSING_SEALED_CODE));
        assert!(!closed.params.contains_key("pack"));
        for warning in [&cjk, &thai, &closed, &placeholder_warning()] {
            let explanation = warning.explanation.as_deref().unwrap();
            assert!(!explanation.contains("{{"), "{explanation}");
        }
    }

    #[test]
    fn a_remembered_font_list_expires_sooner_when_it_found_a_gap() {
        let font_dirs = || vec![(PathBuf::from("fonts"), None)];
        let cache = |covered: bool, age: Duration| CoverageCache {
            font_dirs: font_dirs(),
            ignore_system_fonts: false,
            loaded: Instant::now().checked_sub(age).unwrap(),
            database: fontdb::Database::new(),
            known: HashMap::from([('한', covered)]),
        };
        let minute = Duration::from_secs(60);
        assert!(cache(true, minute).serves(&font_dirs(), false));
        assert!(!cache(true, COVERED_TTL + minute).serves(&font_dirs(), false));
        assert!(cache(false, Duration::ZERO).serves(&font_dirs(), false));
        assert!(!cache(false, minute).serves(&font_dirs(), false));
        assert!(!cache(true, Duration::ZERO).serves(&font_dirs(), true));
        let moved = vec![(PathBuf::from("fonts"), Some(SystemTime::UNIX_EPOCH))];
        assert!(!cache(true, Duration::ZERO).serves(&moved, false));
    }

    #[test]
    fn the_font_list_answers_each_character_once_and_keeps_what_it_learned() {
        let mut cache = CoverageCache {
            font_dirs: Vec::new(),
            ignore_system_fonts: true,
            loaded: Instant::now(),
            database: fontdb::Database::new(),
            known: HashMap::from([('a', true)]),
        };
        assert_eq!(cache.uncovered("a한"), "한");
        assert_eq!(cache.known.get(&'한'), Some(&false));
        assert_eq!(cache.uncovered("글한a"), "글한");
        assert_eq!(cache.known.len(), 3);
    }

    #[test]
    fn the_placeholder_scan_reads_a_pdf_again_only_after_it_changes() {
        let root = tempfile::tempdir().unwrap();
        let pdf = root.path().join("main.pdf");
        std::fs::write(&pdf, b"%PDF-1.7 +LastResort").unwrap();
        assert!(pdf_names_placeholder_font(&pdf));
        std::fs::write(&pdf, b"%PDF-1.7 plain text only").unwrap();
        assert!(!pdf_names_placeholder_font(&pdf));
        assert!(!pdf_names_placeholder_font(&root.path().join("gone.pdf")));
    }

    #[test]
    fn a_compile_without_probe_characters_reads_no_font_list() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("main.typ"), "= Hello").unwrap();
        std::fs::write(root.path().join("main.pdf"), b"%PDF-1.7 +LastResort").unwrap();
        let check = GlyphCheck {
            pdf: root.path().join("main.pdf"),
            project_dir: root.path().to_owned(),
            main_document: "main.typ".to_owned(),
            settings: TypstCompileSettings::default(),
        };
        let warnings = check.warnings();
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].code.as_deref(), Some(PLACEHOLDER_CODE));
    }

    #[test]
    fn a_sealed_project_reports_text_no_project_font_covers() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("main.typ"), "한글").unwrap();
        std::fs::write(root.path().join("main.pdf"), b"%PDF-1.7").unwrap();
        let check = GlyphCheck {
            pdf: root.path().join("main.pdf"),
            project_dir: root.path().to_owned(),
            main_document: "main.typ".to_owned(),
            settings: TypstCompileSettings {
                ignore_system_fonts: true,
                ..TypstCompileSettings::default()
            },
        };
        let warnings = check.warnings();
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].code.as_deref(), Some(MISSING_SEALED_CODE));
        assert_eq!(warnings[0].params["sample"], "한 글");
    }
}
