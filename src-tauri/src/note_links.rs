use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

use oleafly_core::markdown_scan::{
    line_body, link_tail, matching_brackets, run_at, CodeSpans, FenceLine, Fences,
};
use serde::Serialize;

const SNIPPET_CHARS: usize = 120;
const SNAP_CHARS: usize = 20;
const SNIPPET_WINDOW: usize = 4 * SNIPPET_CHARS;
const MAX_ID_CHARS: usize = 128;
const SCHEME: &str = "oleafly://";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkKind {
    Note,
    Project,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LinkTarget {
    pub kind: LinkKind,
    pub id: String,
    pub snippet: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteLinks {
    pub project_id: String,
    pub note_id: Option<String>,
    pub title: String,
    pub links: Vec<LinkTarget>,
}

struct ScannedLinks {
    note_id: Option<String>,
    links: Vec<LinkTarget>,
}

static CACHE: crate::note_index::ParsedCache<ScannedLinks> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn scan_links(text: &str) -> ScannedLinks {
    let scanned = scan_note(String::new(), String::new(), text);
    ScannedLinks {
        note_id: scanned.note_id,
        links: scanned.links,
    }
}

#[tauri::command]
pub async fn note_links() -> Result<Vec<NoteLinks>, String> {
    tauri::async_runtime::spawn_blocking(note_links_blocking)
        .await
        .map_err(|error| format!("listing note links failed: {error}"))?
}

pub(crate) fn note_links_blocking() -> Result<Vec<NoteLinks>, String> {
    let entries = crate::note_index::notes()?;
    let mut seen = HashSet::new();
    let mut found = Vec::new();
    for entry in entries.iter() {
        match crate::note_index::read_parsed(
            &CACHE,
            entry,
            crate::note_index::LockMode::Bounded,
            scan_links,
        ) {
            Ok(Some((path, scanned, _))) => {
                seen.insert(path);
                found.push(NoteLinks {
                    project_id: entry.id.clone(),
                    note_id: scanned.note_id.clone(),
                    title: entry.title.clone(),
                    links: scanned.links.clone(),
                });
            }
            Ok(None) => {}
            Err(error) => {
                let _ = crate::project::append_app_log(format!(
                    "Skipping links in note {:?}: {error}",
                    entry.id
                ));
            }
        }
    }
    crate::note_index::keep_only(&CACHE, &seen);
    Ok(found)
}

pub(crate) fn scan_note(project_id: String, title: String, text: &str) -> NoteLinks {
    let front_matter = oleafly_core::front_matter::split(text);
    let body = front_matter
        .as_ref()
        .map_or(text.strip_prefix('\u{feff}').unwrap_or(text), |front| {
            front.body()
        });
    let lines: Vec<&str> = body
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect();
    NoteLinks {
        project_id,
        note_id: front_matter.and_then(|front| front.scalar("id")),
        title,
        links: link_targets(&lines),
    }
}

pub(crate) fn is_linkable_id(id: &str) -> bool {
    !id.is_empty()
        && id.chars().count() <= MAX_ID_CHARS
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub(crate) fn parse_note_link(href: &str) -> Option<(LinkKind, String)> {
    let href = href.trim();
    let head = href.get(..SCHEME.len())?;
    if !head.eq_ignore_ascii_case(SCHEME) {
        return None;
    }
    let rest = &href[SCHEME.len()..];
    let (host, path) = rest.split_once('/')?;
    let kind = if host.eq_ignore_ascii_case("note") {
        LinkKind::Note
    } else if host.eq_ignore_ascii_case("project") {
        LinkKind::Project
    } else {
        return None;
    };
    let path = path.split_once('#').map_or(path, |(id, _)| id);
    let id = path.strip_suffix('/').unwrap_or(path);
    is_linkable_id(id).then(|| (kind, id.to_string()))
}

struct Piece {
    text: Vec<char>,
    target: Option<(LinkKind, String)>,
}

struct ParsedLink {
    label: Vec<char>,
    destination: String,
    end: usize,
}

fn plain_fragment(chars: &[char]) -> Vec<char> {
    let mut out = Vec::with_capacity(chars.len());
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        if c == '\\' && index + 1 < chars.len() {
            index += 1;
            out.push(chars[index]);
        } else if c == '~' && chars.get(index + 1) == Some(&'~') {
            index += 1;
        } else if c != '*' && c != '`' {
            out.push(if c == '|' { ' ' } else { c });
        }
        index += 1;
    }
    out
}

fn link_at(chars: &[char], start: usize, brackets: &HashMap<usize, usize>) -> Option<ParsedLink> {
    let close = *brackets.get(&start)?;
    let (destination, end) = link_tail(chars, close + 1)?;
    Some(ParsedLink {
        label: plain_fragment(&chars[start + 1..close]),
        destination: chars[destination].iter().collect(),
        end,
    })
}

pub(crate) fn has_scheme(url: &str) -> bool {
    let mut chars = url.chars();
    if !chars.next().is_some_and(|c| c.is_ascii_alphabetic()) {
        return false;
    }
    for c in chars {
        if c == ':' {
            return true;
        }
        if !(c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-')) {
            return false;
        }
    }
    false
}

fn autolink_at(chars: &[char], start: usize) -> Option<(Vec<char>, usize)> {
    let mut index = start + 1;
    while index < chars.len() && chars[index] != '>' {
        if matches!(chars[index], '<' | ' ' | '\t') {
            return None;
        }
        index += 1;
    }
    if index >= chars.len() {
        return None;
    }
    let url = chars[start + 1..index].to_vec();
    has_scheme(&url.iter().collect::<String>()).then_some((url, index + 1))
}

fn line_pieces(line: &str) -> Vec<Piece> {
    let chars: Vec<char> = line_body(line).chars().collect();
    let brackets = if chars.contains(&'[') {
        matching_brackets(&chars, b'[', b']')
    } else {
        HashMap::new()
    };
    let spans = CodeSpans::new(&chars);
    let mut pieces = Vec::new();
    let mut run: Vec<char> = Vec::new();
    let flush = |run: &mut Vec<char>, pieces: &mut Vec<Piece>| {
        if !run.is_empty() {
            pieces.push(Piece {
                text: plain_fragment(run),
                target: None,
            });
            run.clear();
        }
    };
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        if c == '\\' && index + 1 < chars.len() {
            run.extend_from_slice(&chars[index..index + 2]);
            index += 2;
            continue;
        }
        if c == '`' {
            let ticks = run_at(&chars, index, b'`');
            match spans.close(index, ticks, chars.len()) {
                Some(close) => {
                    flush(&mut run, &mut pieces);
                    pieces.push(Piece {
                        text: chars[index + ticks..close].to_vec(),
                        target: None,
                    });
                    index = close + ticks;
                }
                None => {
                    run.extend_from_slice(&chars[index..index + ticks]);
                    index += ticks;
                }
            }
            continue;
        }
        let image = c == '!' && chars.get(index + 1) == Some(&'[');
        if c == '[' || image {
            if let Some(link) = link_at(&chars, if image { index + 1 } else { index }, &brackets) {
                flush(&mut run, &mut pieces);
                pieces.push(Piece {
                    text: link.label,
                    target: parse_note_link(&link.destination),
                });
                index = link.end;
                continue;
            }
        }
        if c == '<' {
            if let Some((url, end)) = autolink_at(&chars, index) {
                flush(&mut run, &mut pieces);
                let target = parse_note_link(&url.iter().collect::<String>());
                pieces.push(Piece { text: url, target });
                index = end;
                continue;
            }
        }
        run.push(c);
        index += 1;
    }
    flush(&mut run, &mut pieces);
    pieces
}

fn collapsed(chars: impl IntoIterator<Item = char>) -> Vec<char> {
    let mut out: Vec<char> = Vec::new();
    for c in chars {
        let space = c.is_whitespace();
        if space && out.last().is_none_or(|last| *last == ' ') {
            continue;
        }
        out.push(if space { ' ' } else { c });
    }
    out
}

fn snippet_of(flat: &[char], link_start: usize, link_end: usize) -> String {
    let before_from = link_start.saturating_sub(SNIPPET_WINDOW);
    let after_to = flat.len().min(link_end + SNIPPET_WINDOW);
    let cut_before = before_from > 0;
    let cut_after = after_to < flat.len();
    let before = collapsed(flat[before_from..link_start].iter().copied());
    let mut link = collapsed(flat[link_start..link_end].iter().copied());
    while link.last() == Some(&' ') {
        link.pop();
    }
    let mut chars = collapsed(
        before
            .iter()
            .copied()
            .chain(link.iter().copied())
            .chain(flat[link_end..after_to].iter().copied()),
    );
    while chars.last() == Some(&' ') {
        chars.pop();
    }
    if !cut_before && !cut_after && chars.len() <= SNIPPET_CHARS {
        return chars.into_iter().collect();
    }
    let link_start = before.len();
    let link_end = link_start + link.len();
    let centred = link_start.saturating_sub((SNIPPET_CHARS.saturating_sub(link.len())) / 2);
    let mut start = if link.len() >= SNIPPET_CHARS {
        link_start
    } else {
        centred.min(chars.len().saturating_sub(SNIPPET_CHARS))
    };
    let mut end = chars.len().min(start + SNIPPET_CHARS);
    let cut_start = start > 0 || cut_before;
    let cut_end = end < chars.len() || cut_after;
    if cut_start {
        if let Some(space) = chars[start..].iter().position(|c| *c == ' ') {
            let space = start + space;
            if space < start + SNAP_CHARS && space < link_start {
                start = space + 1;
            }
        }
    }
    if cut_end {
        let scan = &chars[..chars.len().min(end + 1)];
        if let Some(space) = scan.iter().rposition(|c| *c == ' ') {
            if space + SNAP_CHARS > end && space >= link_end {
                end = space;
            }
        }
    }
    let text: String = chars[start..end].iter().collect();
    format!(
        "{}{}{}",
        if cut_start { "…" } else { "" },
        text.trim(),
        if cut_end { "…" } else { "" }
    )
}

fn link_targets(lines: &[&str]) -> Vec<LinkTarget> {
    let mut seen = HashSet::new();
    let mut found = Vec::new();
    let mut fences = Fences::default();
    for line in lines {
        if fences.line(line) != FenceLine::Text {
            continue;
        }
        let pieces = line_pieces(line);
        if pieces.iter().all(|piece| piece.target.is_none()) {
            continue;
        }
        let mut flat = Vec::new();
        let mut starts = Vec::with_capacity(pieces.len());
        for piece in &pieces {
            starts.push(flat.len());
            flat.extend_from_slice(&piece.text);
        }
        for (index, piece) in pieces.iter().enumerate() {
            let Some((kind, id)) = &piece.target else {
                continue;
            };
            if seen.insert((*kind, id.clone())) {
                found.push(LinkTarget {
                    kind: *kind,
                    id: id.clone(),
                    snippet: snippet_of(&flat, starts[index], starts[index] + piece.text.len()),
                });
            }
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn links(text: &str) -> Vec<(LinkKind, String, String)> {
        scan_note("p".into(), "T".into(), text)
            .links
            .into_iter()
            .map(|link| (link.kind, link.id, link.snippet))
            .collect()
    }

    fn one(kind: LinkKind, id: &str, snippet: &str) -> (LinkKind, String, String) {
        (kind, id.to_string(), snippet.to_string())
    }

    #[test]
    fn reads_the_note_id_and_the_targets_it_links_to() {
        let text = "---\ntitle: Abstract\nid: 'note-2'\nkind: note\n---\n\nSee [Masking ablation](oleafly://note/note-1) and the [Encoder study](oleafly://project/p_9 \"study\").\n";
        let scanned = scan_note("lib-1".into(), "Abstract".into(), text);
        assert_eq!(scanned.project_id, "lib-1");
        assert_eq!(scanned.note_id.as_deref(), Some("note-2"));
        assert_eq!(scanned.title, "Abstract");
        assert_eq!(
            links(text),
            vec![
                one(
                    LinkKind::Note,
                    "note-1",
                    "See Masking ablation and the Encoder study."
                ),
                one(
                    LinkKind::Project,
                    "p_9",
                    "See Masking ablation and the Encoder study."
                ),
            ]
        );
        let json = serde_json::to_value(&scanned).unwrap();
        assert_eq!(json["projectId"], "lib-1");
        assert_eq!(json["noteId"], "note-2");
        assert_eq!(json["links"][0]["kind"], "note");
        assert_eq!(json["links"][1]["kind"], "project");
    }

    #[test]
    fn front_matter_is_optional_and_the_last_id_wins() {
        assert_eq!(
            scan_note("p".into(), "T".into(), "No front matter.").note_id,
            None
        );
        assert_eq!(
            scan_note(
                "p".into(),
                "T".into(),
                "\u{feff}---\nid: a\nid: \"b\"\n---\n"
            )
            .note_id,
            Some("b".into())
        );
        assert_eq!(
            scan_note("p".into(), "T".into(), "---\nid:   \n---\n").note_id,
            None
        );
        assert_eq!(
            scan_note("p".into(), "T".into(), "---\nid: a\n").note_id,
            None
        );
        assert_eq!(
            scan_note("p".into(), "T".into(), "---\r\nidentity: a\r\n...\r\n").note_id,
            None
        );
        assert_eq!(
            links("---\nid: a\n---\n[x](oleafly://note/b)"),
            vec![one(LinkKind::Note, "b", "x")]
        );
        assert_eq!(
            links("---\n[x](oleafly://note/b)\n"),
            vec![one(LinkKind::Note, "b", "x")]
        );
    }

    #[test]
    fn reads_the_id_like_the_other_front_matter_readers() {
        let id = |text: &str| scan_note("p".into(), "T".into(), text).note_id;
        assert_eq!(id("---  \nid : abc # old\n---\n").as_deref(), Some("abc"));
        assert_eq!(
            id("---\nid: \"a # b\" # c\n...\t\n").as_deref(),
            Some("a # b")
        );
        assert_eq!(id("---\nid: # none\n---\n"), None);
        assert_eq!(
            links("\u{feff}[x](oleafly://note/b)"),
            vec![one(LinkKind::Note, "b", "x")]
        );
    }

    #[test]
    fn matches_brackets_in_one_pass() {
        let line = format!("{}[x](oleafly://note/far)", "[".repeat(200_000));
        let found = links(&line);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].1, "far");
        assert!(found[0].2.starts_with('…') && found[0].2.ends_with("[[x"));
    }

    #[test]
    fn snippets_of_very_long_lines_look_only_near_the_link() {
        let words = |count: usize, word: &str| vec![word; count].join(" ");
        let many: String = (0..5_000)
            .map(|index| format!("[n{index}](oleafly://note/n{index})"))
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(links(&many).len(), 5_000);
        let text = format!(
            "{} [Target](oleafly://note/a) {}\n",
            words(2_000, "before"),
            words(2_000, "after")
        );
        let snippet = &links(&text)[0].2;
        assert!(snippet.starts_with("…before"), "{snippet}");
        assert!(snippet.ends_with("after…"), "{snippet}");
        assert!(snippet.contains("before Target after"), "{snippet}");
        assert!(snippet.chars().count() <= SNIPPET_CHARS + 2);
        let spaced = format!("x{}[T](oleafly://note/a)", " ".repeat(SNIPPET_WINDOW * 2));
        assert_eq!(links(&spaced)[0].2, "…T");
    }

    #[test]
    fn parses_only_note_and_project_links_with_safe_ids() {
        assert_eq!(
            parse_note_link("oleafly://note/abc-1"),
            Some((LinkKind::Note, "abc-1".into()))
        );
        assert_eq!(
            parse_note_link(" OLEAFLY://Project/x_y/ "),
            Some((LinkKind::Project, "x_y".into()))
        );
        for bad in [
            "oleafly://note/",
            "oleafly://note/a/b",
            "oleafly://note/a b",
            "oleafly://note/a.b",
            "oleafly://note/a?x=1",
            "oleafly://template/a",
            "oleafly://note",
            "oleafl",
            "https://note/a",
            "oleafly:note/a",
        ] {
            assert_eq!(parse_note_link(bad), None, "{bad}");
        }
        assert!(is_linkable_id(&"a".repeat(MAX_ID_CHARS)));
        assert!(!is_linkable_id(&"a".repeat(MAX_ID_CHARS + 1)));
        assert!(!is_linkable_id(""));
    }

    #[test]
    fn skips_code_and_other_links() {
        let text = "```\n[a](oleafly://note/fenced)\n```\n~~~md\n[b](oleafly://note/tilde)\n~~~\nUse `[c](oleafly://note/code)` or ``[d](oleafly://note/x)``.\n![e](assets/e.png) [f](https://example.org) [g](oleafly://template/a/b)\n";
        assert!(links(text).is_empty());
    }

    #[test]
    fn a_fence_of_another_kind_does_not_end_the_code_block() {
        let text = "~~~\n```\n[a](oleafly://note/inside)\n~~~\n[b](oleafly://note/after)\n````md\n```\n[c](oleafly://note/nested)\n````\n``` js\n";
        assert_eq!(links(text), vec![one(LinkKind::Note, "after", "b")]);
    }

    #[test]
    fn callout_markers_stay_out_of_link_snippets() {
        assert_eq!(
            links("> [!note]+ See [x](oleafly://note/a)\n[!tip] [y](oleafly://note/b)\n## \n"),
            vec![
                one(LinkKind::Note, "a", "See x"),
                one(LinkKind::Note, "b", "[!tip] y"),
            ]
        );
    }

    #[test]
    fn long_backtick_runs_are_read_in_one_pass() {
        let line = format!(
            "{} [x](oleafly://note/a) {}`code`",
            "`".repeat(200_000),
            "``` ".repeat(20_000)
        );
        let started = std::time::Instant::now();
        let found = links(&line);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].1, "a");
        assert!(started.elapsed() < std::time::Duration::from_secs(10));
    }

    #[test]
    fn counts_embeds_and_heading_links_as_links_to_the_note() {
        let text = "![Masking](oleafly://note/a)\nSee [Results](oleafly://note/b#results-2) and [again](oleafly://note/a#intro).\n![Paper](oleafly://project/p#x)\n";
        assert_eq!(
            links(text),
            vec![
                one(LinkKind::Note, "a", "Masking"),
                one(LinkKind::Note, "b", "See Results and again."),
                one(LinkKind::Project, "p", "Paper"),
            ]
        );
        assert_eq!(
            parse_note_link("oleafly://note/abc#heading"),
            Some((LinkKind::Note, "abc".into()))
        );
        assert_eq!(
            parse_note_link("oleafly://note/abc/#heading"),
            Some((LinkKind::Note, "abc".into()))
        );
        assert_eq!(parse_note_link("oleafly://note/#heading"), None);
    }

    #[test]
    fn reads_autolinks_angle_destinations_and_block_markers() {
        let text = "## [Heading link](oleafly://note/h)\n> - [x] Task [Ref](<oleafly://project/p>) done\n1. <oleafly://note/auto> and <https://example.org>\n| a | [Cell](oleafly://note/c) |\n";
        assert_eq!(
            links(text),
            vec![
                one(LinkKind::Note, "h", "Heading link"),
                one(LinkKind::Project, "p", "Task Ref done"),
                one(
                    LinkKind::Note,
                    "auto",
                    "oleafly://note/auto and https://example.org"
                ),
                one(LinkKind::Note, "c", "a Cell"),
            ]
        );
    }

    #[test]
    fn keeps_the_first_mention_and_plain_text_around_it() {
        let text = "First **bold** [A\\] *b*](oleafly://note/a) ~~gone~~ \\*kept\\*.\nAgain [A](oleafly://note/a).\n";
        assert_eq!(
            links(text),
            vec![one(LinkKind::Note, "a", "First bold A] b gone *kept*.")]
        );
    }

    #[test]
    fn handles_unclosed_and_odd_markup() {
        let text = "[open](oleafly://note/a\n[x] (oleafly://note/b)\n[y](<oleafly://note/c)\n[z](oleafly://note/d \"t)\n<oleafly://note/e\n<not a link> `unclosed [w](oleafly://note/f)\n[nested [inner] text](oleafly://note/g) [](oleafly://note/h) [p](a(b)c)\n#nospace [q](oleafly://note/i)\n12345678901. [r](oleafly://note/j)\n-x [s](oleafly://note/k)\n- [ ]x [t](oleafly://note/l)\n[never closed (oleafly://note/m)\n``a`b`` [u](oleafly://note/n)\n<b>[v](oleafly://note/o)</b>\n";
        assert_eq!(
            links(text),
            vec![
                one(LinkKind::Note, "f", "<not a link> unclosed w"),
                one(LinkKind::Note, "g", "nested [inner] text p"),
                one(LinkKind::Note, "h", "nested [inner] text p"),
                one(LinkKind::Note, "i", "#nospace q"),
                one(LinkKind::Note, "j", "12345678901. r"),
                one(LinkKind::Note, "k", "-x s"),
                one(LinkKind::Note, "l", "[ ]x t"),
                one(LinkKind::Note, "n", "a`b u"),
                one(LinkKind::Note, "o", "<b>v</b>"),
            ]
        );
    }

    #[test]
    fn reads_escaped_characters_inside_a_destination_and_a_title() {
        let text = r#"[a](<oleafly://note/a\>>) [b](oleafly://note/b "t \" q") [c](x\)y) end\ "#;
        assert_eq!(links(text), vec![one(LinkKind::Note, "b", "a b c end")]);
    }

    #[test]
    fn cuts_long_lines_around_the_link() {
        let words = |count: usize, word: &str| vec![word; count].join(" ");
        let text = format!(
            "{} [Target](oleafly://note/a) {}\n",
            words(30, "before"),
            words(30, "after")
        );
        let snippet = &links(&text)[0].2;
        assert!(snippet.starts_with("…before"), "{snippet}");
        assert!(snippet.ends_with("after…"), "{snippet}");
        assert!(snippet.contains("before Target after"), "{snippet}");
        assert!(snippet.chars().count() <= SNIPPET_CHARS + 2);

        let start = format!("[Target](oleafly://note/a) {}\n", words(40, "after"));
        let snippet = &links(&start)[0].2;
        assert!(snippet.starts_with("Target after"), "{snippet}");
        assert!(snippet.ends_with('…'));

        let end = format!("{} [Target](oleafly://note/a)\n", words(40, "before"));
        let snippet = &links(&end)[0].2;
        assert!(snippet.starts_with('…'));
        assert!(snippet.ends_with("before Target"), "{snippet}");

        let long = format!(
            "x [{}](oleafly://note/a) y\n",
            "Long".repeat(SNIPPET_CHARS / 2)
        );
        let snippet = &links(&long)[0].2;
        assert!(snippet.starts_with("…Long"));
        assert!(snippet.ends_with('…'));

        let unbroken = format!(
            "{}[T](oleafly://note/a){}\n",
            "b".repeat(90),
            "a".repeat(90)
        );
        let snippet = &links(&unbroken)[0].2;
        assert_eq!(snippet.chars().count(), SNIPPET_CHARS + 2);
    }

    fn test_dir(label: &str) -> std::path::PathBuf {
        tempfile::Builder::new()
            .prefix(&format!("oleafly-{label}-"))
            .tempdir()
            .unwrap()
            .keep()
    }

    #[test]
    fn lists_the_links_of_every_library_note() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let root = test_dir("note-links");
        std::env::set_var("OLEAFLY_DATA_DIR", &root);
        let target = crate::project::create_note_project_from(
            "Masking".into(),
            "---\nkind: note\nid: n-1\n---\n\nThe target.\n".into(),
            None,
        )
        .unwrap();
        let source = crate::project::create_note_project_from(
            "Abstract".into(),
            format!(
                "---\nkind: note\nid: n-2\n---\n\nSee [Masking](oleafly://note/n-1) in [Paper](oleafly://project/{target}).\n"
            ),
            None,
        )
        .unwrap();
        let big = crate::project::create_note_project_from(
            "Big".into(),
            format!(
                "{}\n[Late](oleafly://note/n-1)\n",
                "x".repeat(crate::note_index::MAX_NOTE_BYTES as usize)
            ),
            None,
        )
        .unwrap();
        let mut listed = note_links_blocking().unwrap();
        listed.sort_by(|left, right| left.title.cmp(&right.title));
        assert_eq!(listed.len(), 3);
        assert_eq!(listed[0].project_id, source);
        assert_eq!(listed[0].note_id.as_deref(), Some("n-2"));
        assert_eq!(
            listed[0].links,
            vec![
                LinkTarget {
                    kind: LinkKind::Note,
                    id: "n-1".into(),
                    snippet: "See Masking in Paper.".into(),
                },
                LinkTarget {
                    kind: LinkKind::Project,
                    id: target.clone(),
                    snippet: "See Masking in Paper.".into(),
                },
            ]
        );
        assert_eq!(listed[1].project_id, big);
        assert!(listed[1].links.is_empty());
        assert_eq!(listed[2].project_id, target);
        assert_eq!(listed[2].note_id.as_deref(), Some("n-1"));

        let dir = crate::paths::project_dir(&target).unwrap();
        std::fs::remove_file(dir.join(crate::project::NOTE_FILE)).unwrap();
        let after = note_links_blocking().unwrap();
        assert!(after.iter().all(|note| note.project_id != target));
        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
    }
}
