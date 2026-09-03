use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::project::{
    rel_slash, scan_should_stop, ScanCancellation, MAX_WALK_DEPTH, MCP_SCAN_DEADLINE,
    MCP_SEARCH_ENTRY_SCAN_LIMIT, MCP_SEARCH_FILE_SCAN_LIMIT,
};
use crate::project_sources::{MAX_SOURCE_BATCH_BYTES, MAX_SOURCE_FILE_BYTES};

const CHUNK_LINES: usize = 40;
const CHUNK_OVERLAP: usize = 8;
const MAX_UNITS_PER_CHUNK: usize = 1_800;
const DEFAULT_CHUNKS_RETURNED: usize = 5;
const MAX_CHUNKS_RETURNED: usize = 8;
const MAX_FILES: usize = 40;
const MAX_FILE_UNITS: usize = 80_000;
const MAX_FILE_READ_BYTES: usize = MAX_FILE_UNITS * 3 + 4;
const _: () = assert!(MAX_FILES * MAX_FILE_READ_BYTES < MAX_SOURCE_BATCH_BYTES);
const MAX_QUERY_TOKENS: usize = 32;
const MAX_TOKEN_HITS: usize = 8;
const MAX_OVERRIDES: usize = 512;
const WALK_CUT_SHORT: &str = "The project scan stopped before it reached every source file.";
const INDEXABLE_SUFFIXES: [&str; 5] = [".tex", ".typ", ".md", ".markdown", ".bib"];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RagOverride {
    pub path: String,
    pub text: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RagRequest {
    pub query: String,
    #[serde(default)]
    pub top_k: Option<usize>,
    #[serde(default)]
    pub overrides: Vec<RagOverride>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RagChunk {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub text: String,
    pub score: f64,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct RagLimits {
    pub files: usize,
    pub scanned_entries: usize,
    pub scanned_files: usize,
    pub file_bytes: usize,
    pub total_bytes: usize,
    pub deadline: Instant,
}

impl RagLimits {
    pub(crate) fn starting_now() -> Self {
        Self {
            files: MAX_FILES,
            scanned_entries: MCP_SEARCH_ENTRY_SCAN_LIMIT,
            scanned_files: MCP_SEARCH_FILE_SCAN_LIMIT,
            file_bytes: MAX_SOURCE_FILE_BYTES,
            total_bytes: MAX_SOURCE_BATCH_BYTES,
            deadline: Instant::now() + MCP_SCAN_DEADLINE,
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct IndexableWalk {
    pub paths: Vec<String>,
    pub scanned_entries: usize,
    pub scanned_files: usize,
    pub truncated: bool,
}

fn is_indexable(name: &str) -> bool {
    let lower = name.to_lowercase();
    INDEXABLE_SUFFIXES
        .iter()
        .any(|suffix| lower.ends_with(suffix))
}

fn walk_indexable(
    root: &Path,
    dir: &Path,
    out: &mut IndexableWalk,
    limits: RagLimits,
    cancelled: &AtomicBool,
    depth: usize,
) {
    if scan_should_stop(cancelled, limits.deadline)
        || out.paths.len() >= limits.files
        || out.scanned_entries >= limits.scanned_entries
        || out.scanned_files >= limits.scanned_files
    {
        out.truncated = true;
        return;
    }
    if depth >= MAX_WALK_DEPTH {
        out.truncated = true;
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    let mut items = Vec::new();
    for entry in entries {
        if scan_should_stop(cancelled, limits.deadline)
            || out.scanned_entries >= limits.scanned_entries
        {
            out.truncated = true;
            break;
        }
        out.scanned_entries += 1;
        if let Ok(entry) = entry {
            items.push(entry);
        }
    }
    items.sort_by_key(|entry| entry.file_name());

    for entry in items {
        if scan_should_stop(cancelled, limits.deadline) || out.paths.len() >= limits.files {
            out.truncated = true;
            break;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ".oleafly" || name == ".git" {
            continue;
        }
        let file_type = match entry.file_type() {
            Ok(file_type) if !file_type.is_symlink() => file_type,
            _ => continue,
        };
        let path = entry.path();
        if file_type.is_dir() {
            walk_indexable(root, &path, out, limits, cancelled, depth + 1);
            if out.truncated {
                break;
            }
            continue;
        }
        if !is_indexable(&name) {
            continue;
        }
        if out.scanned_files >= limits.scanned_files {
            out.truncated = true;
            break;
        }
        out.scanned_files += 1;
        out.paths.push(rel_slash(root, &path));
    }
}

pub(crate) fn collect_indexable(
    root: &Path,
    limits: RagLimits,
    cancelled: &AtomicBool,
) -> IndexableWalk {
    let mut out = IndexableWalk::default();
    walk_indexable(root, root, &mut out, limits, cancelled, 0);
    out
}

fn read_capped(path: &Path, allowed: usize) -> Option<Vec<u8>> {
    let file = std::fs::File::open(path).ok()?;
    let mut bytes = Vec::with_capacity(allowed.min(64 * 1024));
    file.take(allowed as u64).read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

fn is_js_whitespace(ch: char) -> bool {
    matches!(
        ch,
        '\u{9}'
            | '\u{a}'
            | '\u{b}'
            | '\u{c}'
            | '\u{d}'
            | '\u{20}'
            | '\u{a0}'
            | '\u{1680}'
            | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_whitespace)
}

fn truncate_utf16(text: &str, units: usize) -> &str {
    let mut used = 0usize;
    for (offset, ch) in text.char_indices() {
        let width = ch.len_utf16();
        if used + width > units {
            return &text[..offset];
        }
        used += width;
    }
    text
}

pub(crate) fn tokenize(input: &str) -> Vec<String> {
    let lowered = input.to_lowercase();
    let mut tokens = Vec::new();
    let mut current = String::new();
    for ch in lowered.chars() {
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_' || ch == '\\' {
            current.push(ch);
            continue;
        }
        if current.len() >= 2 {
            tokens.push(current.clone());
        }
        current.clear();
    }
    if current.len() >= 2 {
        tokens.push(current);
    }
    tokens
}

pub(crate) fn query_tokens(query: &str) -> Vec<String> {
    let mut tokens = tokenize(query);
    tokens.truncate(MAX_QUERY_TOKENS);
    tokens
}

pub(crate) fn chunk_file(path: &str, content: &str) -> Vec<RagChunk> {
    let capped = truncate_utf16(content, MAX_FILE_UNITS);
    let lines: Vec<&str> = capped.split('\n').collect();
    let step = CHUNK_LINES - CHUNK_OVERLAP;
    let mut out = Vec::new();
    let mut start = 0usize;
    while start < lines.len() {
        let slice = &lines[start..(start + CHUNK_LINES).min(lines.len())];
        if slice.is_empty() {
            break;
        }
        let joined = slice.join("\n");
        let trimmed = js_trim(&joined);
        if !trimmed.is_empty() {
            out.push(RagChunk {
                path: path.to_string(),
                start_line: u32::try_from(start + 1).unwrap_or(u32::MAX),
                end_line: u32::try_from(start + slice.len()).unwrap_or(u32::MAX),
                text: truncate_utf16(trimmed, MAX_UNITS_PER_CHUNK).to_string(),
                score: 0.0,
            });
            if start + CHUNK_LINES >= lines.len() {
                break;
            }
        }
        start += step;
    }
    out
}

pub(crate) fn score_chunk(tokens: &[String], text: &str) -> f64 {
    if tokens.is_empty() {
        return 0.0;
    }
    let body = text.to_lowercase();
    let mut score = 0.0f64;
    let mut seen: HashSet<&str> = HashSet::new();
    for token in tokens {
        if !seen.insert(token.as_str()) {
            continue;
        }
        let mut cursor = 0usize;
        let mut hits = 0usize;
        while hits < MAX_TOKEN_HITS {
            match body[cursor..].find(token.as_str()) {
                Some(offset) => {
                    hits += 1;
                    cursor += offset + token.len();
                }
                None => break,
            }
        }
        if hits > 0 {
            score += hits as f64 * (1.0 + (token.len() as f64 / 8.0).min(2.0));
        }
    }
    score
}

pub(crate) fn rank_chunks(
    tokens: &[String],
    sources: &[(String, String)],
    top_k: usize,
) -> Vec<RagChunk> {
    let mut chunks: Vec<RagChunk> = Vec::new();
    for (path, content) in sources {
        for mut chunk in chunk_file(path, content) {
            let score = score_chunk(tokens, &chunk.text);
            if score > 0.0 {
                chunk.score = score;
                chunks.push(chunk);
            }
        }
    }
    chunks.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    chunks.truncate(top_k);
    chunks
}

fn validate(request: &RagRequest) -> Result<(), String> {
    if request.overrides.len() > MAX_OVERRIDES {
        return Err(format!(
            "The request carries {} open buffers, which is more than the {} buffer limit.",
            request.overrides.len(),
            MAX_OVERRIDES
        ));
    }
    let total: usize = request.overrides.iter().map(|entry| entry.text.len()).sum();
    if total > MAX_SOURCE_BATCH_BYTES {
        return Err(format!(
            "The request carries {total} bytes of open buffers, which is more than the {MAX_SOURCE_BATCH_BYTES} byte limit."
        ));
    }
    Ok(())
}

pub(crate) fn retrieve(
    root: &Path,
    request: &RagRequest,
    limits: RagLimits,
    cancelled: &AtomicBool,
) -> Result<Vec<RagChunk>, String> {
    let tokens = query_tokens(request.query.trim());
    if tokens.is_empty() {
        return Ok(Vec::new());
    }
    let top_k = request
        .top_k
        .unwrap_or(DEFAULT_CHUNKS_RETURNED)
        .min(MAX_CHUNKS_RETURNED);
    if top_k == 0 {
        return Ok(Vec::new());
    }
    let overrides: HashMap<&str, &str> = request
        .overrides
        .iter()
        .map(|entry| (entry.path.as_str(), entry.text.as_str()))
        .collect();

    let walk = collect_indexable(root, limits, cancelled);
    if walk.truncated && walk.paths.len() < limits.files {
        return Err(WALK_CUT_SHORT.to_string());
    }
    let mut sources: Vec<(String, String)> = Vec::with_capacity(walk.paths.len());
    let mut consumed = 0usize;
    for path in walk.paths {
        if let Some(text) = overrides.get(path.as_str()) {
            sources.push((path, (*text).to_string()));
            continue;
        }
        let remaining = limits.total_bytes.saturating_sub(consumed);
        if remaining == 0 {
            break;
        }
        let allowed = limits.file_bytes.min(MAX_FILE_READ_BYTES).min(remaining);
        let Some(bytes) = read_capped(&root.join(&path), allowed) else {
            continue;
        };
        consumed = consumed.saturating_add(bytes.len());
        sources.push((path, String::from_utf8_lossy(&bytes).into_owned()));
    }
    Ok(rank_chunks(&tokens, &sources, top_k))
}

#[tauri::command]
pub async fn rag_retrieve(
    project_id: String,
    request: RagRequest,
) -> Result<Vec<RagChunk>, String> {
    let (mut cancellation, cancelled) = ScanCancellation::new();
    let limits = RagLimits::starting_now();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<RagChunk>, String> {
        validate(&request)?;
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
        let root = crate::paths::project_dir(&project_id)?;
        retrieve(&root, &request, limits, &cancelled)
    })
    .await
    .map_err(|error| error.to_string())?;
    cancellation.disarm();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;
    use std::time::{Duration, Instant};

    fn never_cancelled() -> AtomicBool {
        AtomicBool::new(false)
    }

    fn tokens(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    fn sources(entries: &[(&str, &str)]) -> Vec<(String, String)> {
        entries
            .iter()
            .map(|(path, content)| ((*path).to_string(), (*content).to_string()))
            .collect()
    }

    fn request(query: &str, top_k: Option<usize>, overrides: &[(&str, &str)]) -> RagRequest {
        RagRequest {
            query: query.to_string(),
            top_k,
            overrides: overrides
                .iter()
                .map(|(path, text)| RagOverride {
                    path: (*path).to_string(),
                    text: (*text).to_string(),
                })
                .collect(),
        }
    }

    struct Tree {
        _directory: tempfile::TempDir,
        root: PathBuf,
    }

    fn tree() -> Tree {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().to_path_buf();
        Tree {
            _directory: directory,
            root,
        }
    }

    fn write(tree: &Tree, rel: &str, bytes: &[u8]) {
        let full = tree.root.join(rel);
        std::fs::create_dir_all(full.parent().unwrap()).unwrap();
        std::fs::write(full, bytes).unwrap();
    }

    fn walk_paths(tree: &Tree) -> Vec<String> {
        let cancelled = never_cancelled();
        collect_indexable(&tree.root, RagLimits::starting_now(), &cancelled).paths
    }

    fn retrieve_from(tree: &Tree, request: &RagRequest) -> Vec<RagChunk> {
        let cancelled = never_cancelled();
        retrieve(&tree.root, request, RagLimits::starting_now(), &cancelled).unwrap()
    }

    fn normalize_newlines(bytes: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(bytes.len());
        let mut index = 0usize;
        while index < bytes.len() {
            if bytes[index] == b'\r' && bytes.get(index + 1) == Some(&b'\n') {
                index += 1;
                continue;
            }
            out.push(bytes[index]);
            index += 1;
        }
        out
    }

    fn lines_of(count: usize, body: &str) -> String {
        (0..count)
            .map(|index| format!("{body}{index}"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn tokenize_lowercases_and_keeps_backslashes_underscores_and_digits() {
        assert_eq!(
            tokenize("\\Section{Hello_World} 42 -- ok"),
            tokens(&["\\section", "hello_world", "42", "ok"])
        );
    }

    #[test]
    fn tokenize_drops_runs_shorter_than_two_characters() {
        assert_eq!(tokenize("a b c d"), Vec::<String>::new());
        assert_eq!(tokenize("a ab abc"), tokens(&["ab", "abc"]));
        assert_eq!(tokenize("   "), Vec::<String>::new());
    }

    #[test]
    fn tokenize_treats_every_other_character_as_a_separator() {
        assert_eq!(
            tokenize("café; naïve — ok"),
            tokens(&["caf", "na", "ve", "ok"])
        );
    }

    #[test]
    fn query_tokens_are_capped_at_thirty_two() {
        let query = (0..50)
            .map(|index| format!("token{index}"))
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(query_tokens(&query).len(), MAX_QUERY_TOKENS);
        assert_eq!(query_tokens(&query)[0], "token0");
        assert_eq!(query_tokens(&query)[31], "token31");
    }

    #[test]
    fn chunk_windows_advance_by_thirty_two_lines_and_overlap_by_eight() {
        let chunks = chunk_file("main.tex", &lines_of(100, "line"));
        let spans: Vec<(u32, u32)> = chunks
            .iter()
            .map(|chunk| (chunk.start_line, chunk.end_line))
            .collect();
        assert_eq!(spans, vec![(1, 40), (33, 72), (65, 100)]);
        assert!(chunks[0].text.starts_with("line0\nline1\n"));
        assert!(chunks[1].text.starts_with("line32\n"));
        assert!(chunks[2].text.ends_with("line99"));
    }

    #[test]
    fn a_file_shorter_than_one_window_is_a_single_chunk() {
        let chunks = chunk_file("main.tex", "one\ntwo\nthree");
        assert_eq!(chunks.len(), 1);
        assert_eq!((chunks[0].start_line, chunks[0].end_line), (1, 3));
        assert_eq!(chunks[0].text, "one\ntwo\nthree");
    }

    #[test]
    fn a_blank_window_is_skipped_without_ending_the_walk() {
        let mut lines: Vec<String> = (0..32).map(|index| format!("x{index}")).collect();
        lines.extend((0..68).map(|_| String::new()));
        let chunks = chunk_file("main.tex", &lines.join("\n"));
        assert_eq!(chunks.len(), 1);
        assert_eq!((chunks[0].start_line, chunks[0].end_line), (1, 40));
        assert!(chunks[0].text.ends_with("x31"));
    }

    #[test]
    fn chunk_text_is_trimmed_the_way_javascript_trims() {
        let chunks = chunk_file("main.tex", "\u{feff}  \n\thello\n  \u{a0}");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text, "hello");
        assert_eq!((chunks[0].start_line, chunks[0].end_line), (1, 3));
    }

    #[test]
    fn chunk_text_is_capped_at_eighteen_hundred_characters() {
        let chunks = chunk_file("main.tex", &"x".repeat(2_000));
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text.chars().count(), MAX_UNITS_PER_CHUNK);
    }

    #[test]
    fn the_chunk_cap_counts_utf16_units_like_javascript() {
        let chunks = chunk_file("main.tex", &"\u{1f600}".repeat(1_000));
        assert_eq!(chunks[0].text.chars().count(), MAX_UNITS_PER_CHUNK / 2);
        let chunks = chunk_file("main.tex", &"漢".repeat(2_000));
        assert_eq!(chunks[0].text.chars().count(), MAX_UNITS_PER_CHUNK);
    }

    #[test]
    fn only_the_first_eighty_thousand_characters_of_a_file_are_chunked() {
        let content = format!("{}\nneedle", "a".repeat(MAX_FILE_UNITS));
        let chunks = chunk_file("main.tex", &content);
        assert_eq!(chunks.len(), 1);
        assert_eq!((chunks[0].start_line, chunks[0].end_line), (1, 1));
        assert_eq!(score_chunk(&tokens(&["needle"]), &chunks[0].text), 0.0);
    }

    #[test]
    fn token_hits_are_capped_at_eight_per_chunk() {
        let text = "ab ".repeat(12);
        assert_eq!(score_chunk(&tokens(&["ab"]), &text), 8.0 * 1.25);
        assert_eq!(score_chunk(&tokens(&["ab"]), "ab ab ab"), 3.0 * 1.25);
    }

    #[test]
    fn overlapping_matches_are_counted_once_and_scan_forward() {
        assert_eq!(score_chunk(&tokens(&["aa"]), "aaa"), 1.25);
        assert_eq!(score_chunk(&tokens(&["aa"]), "aaaa"), 2.0 * 1.25);
    }

    #[test]
    fn longer_tokens_weigh_more_up_to_a_length_of_sixteen() {
        assert_eq!(score_chunk(&tokens(&["ab"]), "ab"), 1.25);
        assert_eq!(score_chunk(&tokens(&["abcdefgh"]), "abcdefgh"), 2.0);
        assert_eq!(
            score_chunk(&tokens(&["abcdefghijklmnop"]), "abcdefghijklmnop"),
            3.0
        );
        assert_eq!(
            score_chunk(
                &tokens(&["abcdefghijklmnopqrstuvwx"]),
                "abcdefghijklmnopqrstuvwx"
            ),
            3.0
        );
    }

    #[test]
    fn a_repeated_query_token_is_counted_once() {
        assert_eq!(
            score_chunk(&tokens(&["ab", "ab", "ab"]), "ab ab"),
            score_chunk(&tokens(&["ab"]), "ab ab")
        );
    }

    #[test]
    fn scoring_is_case_insensitive_and_an_empty_token_list_scores_zero() {
        assert_eq!(score_chunk(&tokens(&["needle"]), "NEEDLE"), 1.75);
        assert_eq!(score_chunk(&[], "needle"), 0.0);
    }

    #[test]
    fn ranking_puts_the_highest_score_first_and_keeps_source_order_on_a_tie() {
        let ranked = rank_chunks(
            &tokens(&["needle"]),
            &sources(&[
                ("a.tex", "needle"),
                ("b.tex", "needle needle needle"),
                ("c.tex", "needle"),
            ]),
            8,
        );
        assert_eq!(
            ranked
                .iter()
                .map(|chunk| chunk.path.as_str())
                .collect::<Vec<_>>(),
            vec!["b.tex", "a.tex", "c.tex"]
        );
        assert_eq!(ranked[0].score, 3.0 * 1.75);
        assert_eq!(ranked[1].score, ranked[2].score);
    }

    #[test]
    fn chunks_that_score_zero_are_dropped() {
        let ranked = rank_chunks(
            &tokens(&["needle"]),
            &sources(&[("a.tex", "haystack"), ("b.tex", "needle")]),
            8,
        );
        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0].path, "b.tex");
    }

    #[test]
    fn ranking_returns_at_most_top_k_chunks() {
        let content = lines_of(400, "needle line ");
        let ranked = rank_chunks(&tokens(&["needle"]), &sources(&[("a.tex", &content)]), 3);
        assert_eq!(ranked.len(), 3);
        assert_eq!(
            rank_chunks(&tokens(&["needle"]), &sources(&[("a.tex", &content)]), 0).len(),
            0
        );
    }

    #[test]
    fn the_walk_lists_indexable_files_in_sorted_depth_first_order() {
        let tree = tree();
        write(&tree, "main.tex", b"main");
        write(&tree, "refs.bib", b"refs");
        write(&tree, "notes.markdown", b"notes");
        write(&tree, "slides.typ", b"slides");
        write(&tree, "readme.MD", b"readme");
        write(&tree, "chapters/two.tex", b"two");
        write(&tree, "chapters/one.tex", b"one");
        write(&tree, "appendix/a.tex", b"a");
        assert_eq!(
            walk_paths(&tree),
            vec![
                "appendix/a.tex",
                "chapters/one.tex",
                "chapters/two.tex",
                "main.tex",
                "notes.markdown",
                "readme.MD",
                "refs.bib",
                "slides.typ",
            ]
        );
    }

    #[test]
    fn the_walk_skips_project_metadata_and_files_that_are_not_indexable() {
        let tree = tree();
        write(&tree, "main.tex", b"main");
        write(&tree, "main.pdf", b"pdf");
        write(&tree, "figure.png", b"png");
        write(&tree, "notes.txt", b"txt");
        write(&tree, "styles.sty", b"sty");
        write(&tree, ".oleafly/build/main.tex", b"build");
        write(&tree, ".git/objects/head.tex", b"git");
        assert_eq!(walk_paths(&tree), vec!["main.tex"]);
    }

    #[test]
    fn the_walk_stops_after_forty_files() {
        let tree = tree();
        for index in 0..60 {
            write(&tree, &format!("file{index:03}.tex"), b"body");
        }
        let cancelled = never_cancelled();
        let walk = collect_indexable(&tree.root, RagLimits::starting_now(), &cancelled);
        assert_eq!(walk.paths.len(), MAX_FILES);
        assert_eq!(walk.paths[0], "file000.tex");
        assert_eq!(walk.paths[39], "file039.tex");
        assert!(walk.truncated);
    }

    #[test]
    fn the_walk_reports_truncation_once_the_deadline_has_passed() {
        let tree = tree();
        write(&tree, "main.tex", b"main");
        let cancelled = never_cancelled();
        let limits = RagLimits {
            deadline: Instant::now() - Duration::from_secs(1),
            ..RagLimits::starting_now()
        };
        let walk = collect_indexable(&tree.root, limits, &cancelled);
        assert!(walk.paths.is_empty());
        assert!(walk.truncated);
    }

    #[test]
    fn the_walk_stops_once_the_entry_budget_is_spent() {
        let tree = tree();
        for index in 0..10 {
            write(&tree, &format!("file{index}.tex"), b"body");
        }
        let cancelled = never_cancelled();
        let limits = RagLimits {
            scanned_entries: 4,
            ..RagLimits::starting_now()
        };
        let walk = collect_indexable(&tree.root, limits, &cancelled);
        assert_eq!(walk.paths.len(), 4);
        assert!(walk.truncated);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_is_neither_indexed_nor_followed() {
        let tree = tree();
        write(&tree, "main.tex", b"main");
        write(&tree, "outside/secret.tex", b"secret");
        std::os::unix::fs::symlink(tree.root.join("outside"), tree.root.join("linked")).unwrap();
        std::os::unix::fs::symlink(tree.root.join("main.tex"), tree.root.join("alias.tex"))
            .unwrap();
        assert_eq!(walk_paths(&tree), vec!["main.tex", "outside/secret.tex"]);
    }

    #[test]
    fn an_override_replaces_the_copy_on_disk() {
        let tree = tree();
        write(&tree, "main.tex", b"saved text");
        let saved = retrieve_from(&tree, &request("saved", None, &[]));
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].text, "saved text");

        let edited = retrieve_from(
            &tree,
            &request("unsaved", None, &[("main.tex", "unsaved text")]),
        );
        assert_eq!(edited.len(), 1);
        assert_eq!(edited[0].text, "unsaved text");
        assert!(retrieve_from(
            &tree,
            &request("saved", None, &[("main.tex", "edited text")])
        )
        .is_empty());
    }

    #[test]
    fn an_override_for_a_path_the_walk_never_reached_is_ignored() {
        let tree = tree();
        write(&tree, "main.tex", b"body");
        let chunks = retrieve_from(
            &tree,
            &request(
                "needle",
                None,
                &[
                    ("untracked.tex", "needle"),
                    ("../escape.tex", "needle"),
                    (".git/config.tex", "needle"),
                ],
            ),
        );
        assert!(chunks.is_empty());
    }

    #[test]
    fn invalid_bytes_decode_lossily_and_line_endings_are_left_alone() {
        let tree = tree();
        write(&tree, "refs.bib", b"@article{key, author={Jos\xe9}}");
        write(&tree, "crlf.tex", b"alpha\r\nbeta\r\n");
        let chunks = retrieve_from(&tree, &request("author alpha", None, &[]));
        let by_path = |path: &str| {
            chunks
                .iter()
                .find(|chunk| chunk.path == path)
                .unwrap()
                .text
                .clone()
        };
        assert!(by_path("refs.bib").contains('\u{FFFD}'));
        assert_eq!(by_path("crlf.tex"), "alpha\r\nbeta");
    }

    #[cfg(unix)]
    #[test]
    fn a_file_the_process_cannot_open_is_skipped() {
        use std::os::unix::fs::PermissionsExt;

        let tree = tree();
        write(&tree, "open.tex", b"needle here");
        write(&tree, "sealed.tex", b"needle there");
        let sealed = tree.root.join("sealed.tex");
        std::fs::set_permissions(&sealed, std::fs::Permissions::from_mode(0o000)).unwrap();
        let chunks = retrieve_from(&tree, &request("needle", None, &[]));
        std::fs::set_permissions(&sealed, std::fs::Permissions::from_mode(0o600)).unwrap();

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].path, "open.tex");
    }

    #[test]
    fn a_query_with_no_usable_tokens_retrieves_nothing() {
        let tree = tree();
        write(&tree, "main.tex", b"a b c");
        assert!(retrieve_from(&tree, &request("   ", None, &[])).is_empty());
        assert!(retrieve_from(&tree, &request("a b c", None, &[])).is_empty());
        assert!(retrieve_from(&tree, &request("- ; .", None, &[])).is_empty());
    }

    #[test]
    fn top_k_defaults_to_five_and_is_clamped_to_eight() {
        let tree = tree();
        for index in 0..12 {
            write(
                &tree,
                &format!("file{index:02}.tex"),
                format!("needle {index}").as_bytes(),
            );
        }
        assert_eq!(retrieve_from(&tree, &request("needle", None, &[])).len(), 5);
        assert_eq!(
            retrieve_from(&tree, &request("needle", Some(50), &[])).len(),
            MAX_CHUNKS_RETURNED
        );
        assert_eq!(
            retrieve_from(&tree, &request("needle", Some(2), &[])).len(),
            2
        );
        assert!(retrieve_from(&tree, &request("needle", Some(0), &[])).is_empty());
    }

    #[test]
    fn a_file_larger_than_the_per_file_cap_still_yields_its_first_chunk() {
        let tree = tree();
        let body = format!("needle\n{}", "x".repeat(3_000_000));
        write(&tree, "main.tex", body.as_bytes());
        let chunks = retrieve_from(&tree, &request("needle", None, &[]));
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].text.starts_with("needle\n"));
    }

    #[test]
    fn reads_stop_once_the_batch_budget_is_spent() {
        let tree = tree();
        write(&tree, "a.tex", b"needle a");
        write(&tree, "b.tex", b"needle b");
        let cancelled = never_cancelled();
        let limits = RagLimits {
            total_bytes: 8,
            ..RagLimits::starting_now()
        };
        let chunks = retrieve(
            &tree.root,
            &request("needle", None, &[]),
            limits,
            &cancelled,
        )
        .unwrap();
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].path, "a.tex");
    }

    #[test]
    fn a_walk_cut_short_by_a_budget_is_an_error_so_the_caller_can_fall_back() {
        let tree = tree();
        for index in 0..40 {
            write(&tree, &format!("figures/plot{index:03}.md"), b"noise");
        }
        write(&tree, "main.tex", b"needle here");
        let cancelled = never_cancelled();

        let spent = RagLimits {
            scanned_entries: 6,
            ..RagLimits::starting_now()
        };
        let walk = collect_indexable(&tree.root, spent, &cancelled);
        assert!(walk.truncated);
        assert!(walk.paths.len() < MAX_FILES);
        assert!(!walk.paths.iter().any(|path| path == "main.tex"));
        assert_eq!(
            retrieve(&tree.root, &request("needle", None, &[]), spent, &cancelled).unwrap_err(),
            WALK_CUT_SHORT
        );

        let expired = RagLimits {
            deadline: Instant::now() - Duration::from_secs(1),
            ..RagLimits::starting_now()
        };
        assert_eq!(
            retrieve(
                &tree.root,
                &request("needle", None, &[]),
                expired,
                &cancelled
            )
            .unwrap_err(),
            WALK_CUT_SHORT
        );
    }

    #[test]
    fn a_walk_that_only_reaches_the_file_cap_still_answers() {
        let tree = tree();
        for index in 0..60 {
            write(&tree, &format!("file{index:03}.tex"), b"needle body");
        }
        let cancelled = never_cancelled();
        let walk = collect_indexable(&tree.root, RagLimits::starting_now(), &cancelled);
        assert!(walk.truncated);
        assert_eq!(walk.paths.len(), MAX_FILES);
        assert_eq!(
            retrieve_from(&tree, &request("needle", Some(3), &[])).len(),
            3
        );
    }

    #[test]
    fn a_large_file_no_longer_spends_more_budget_than_chunking_can_use() {
        let tree = tree();
        let bulk = "x".repeat(MAX_SOURCE_BATCH_BYTES / 10);
        for index in 0..10 {
            write(&tree, &format!("bulk{index:02}.bib"), bulk.as_bytes());
        }
        write(&tree, "needle.tex", b"needle here");
        assert_eq!(walk_paths(&tree).len(), 11);

        let chunks = retrieve_from(&tree, &request("needle", None, &[]));
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].path, "needle.tex");
    }

    #[test]
    fn a_seed_copy_collapses_crlf_so_a_windows_checkout_scores_the_same_bytes() {
        let tree = tree();
        write(
            &tree,
            "main.tex",
            &normalize_newlines(b"alpha\r\nbeta\rgamma\r\n"),
        );
        let chunks = retrieve_from(&tree, &request("alpha", None, &[]));
        assert_eq!(chunks[0].text, "alpha\nbeta\rgamma");
    }

    #[test]
    fn too_many_or_too_large_open_buffers_are_rejected() {
        let too_many = RagRequest {
            query: "needle".into(),
            top_k: None,
            overrides: (0..MAX_OVERRIDES + 1)
                .map(|index| RagOverride {
                    path: format!("file{index}.tex"),
                    text: String::new(),
                })
                .collect(),
        };
        assert_eq!(
            validate(&too_many).unwrap_err(),
            "The request carries 513 open buffers, which is more than the 512 buffer limit."
        );

        let too_large = RagRequest {
            query: "needle".into(),
            top_k: None,
            overrides: vec![RagOverride {
                path: "main.tex".into(),
                text: "x".repeat(MAX_SOURCE_BATCH_BYTES + 1),
            }],
        };
        assert!(validate(&too_large)
            .unwrap_err()
            .starts_with("The request carries 10000001 bytes of open buffers,"));
        assert!(validate(&request("needle", None, &[("main.tex", "x")])).is_ok());
    }

    #[test]
    fn the_request_rejects_unknown_fields_and_defaults_its_optional_members() {
        let parsed: RagRequest = serde_json::from_str(r#"{"query":"needle"}"#).unwrap();
        assert_eq!(parsed.query, "needle");
        assert!(parsed.top_k.is_none());
        assert!(parsed.overrides.is_empty());

        let parsed: RagRequest = serde_json::from_str(
            r#"{"query":"needle","topK":4,"overrides":[{"path":"main.tex","text":"body"}]}"#,
        )
        .unwrap();
        assert_eq!(parsed.top_k, Some(4));
        assert_eq!(parsed.overrides[0].path, "main.tex");

        assert!(serde_json::from_str::<RagRequest>(r#"{"query":"a","extra":1}"#).is_err());
        assert!(serde_json::from_str::<RagRequest>(
            r#"{"query":"a","overrides":[{"path":"a","text":"b","c":1}]}"#
        )
        .is_err());
    }

    #[test]
    fn chunks_serialize_with_the_keys_the_typescript_interface_declares() {
        let value = serde_json::to_value(RagChunk {
            path: "main.tex".into(),
            start_line: 1,
            end_line: 40,
            text: "body".into(),
            score: 2.5,
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "path": "main.tex",
                "startLine": 1,
                "endLine": 40,
                "text": "body",
                "score": 2.5
            })
        );
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenCase {
        project: String,
        query: String,
        top_k: usize,
        files: usize,
        chunks: Vec<RagChunk>,
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Golden {
        projects: Vec<String>,
        cases: Vec<GoldenCase>,
    }

    fn seed_root(project: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("fixtures")
            .join("research-seeds")
            .join(project)
    }

    fn seed_copy(project: &str) -> Tree {
        let seed = seed_root(project);
        let cancelled = never_cancelled();
        let paths = collect_indexable(&seed, RagLimits::starting_now(), &cancelled).paths;
        assert!(!paths.is_empty(), "{project} has no indexable seed files");
        let tree = tree();
        for rel in &paths {
            let bytes = std::fs::read(seed.join(rel)).unwrap();
            write(&tree, rel, &normalize_newlines(&bytes));
        }
        tree
    }

    fn golden() -> Golden {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("rag")
            .join("golden.json");
        let raw = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("{} could not be read: {error}", path.display()));
        serde_json::from_str(&raw).unwrap()
    }

    #[test]
    fn the_rust_port_matches_the_typescript_scorer_on_the_seed_corpus() {
        let golden = golden();
        assert_eq!(golden.projects.len(), 3);
        assert_eq!(golden.cases.len(), 30);
        let cancelled = never_cancelled();
        let roots: Vec<(String, Tree)> = golden
            .projects
            .iter()
            .map(|project| (project.clone(), seed_copy(project)))
            .collect();
        let mut scored = 0usize;
        for case in &golden.cases {
            let root = &roots
                .iter()
                .find(|(name, _)| name == &case.project)
                .unwrap_or_else(|| panic!("{} is not one of the golden projects", case.project))
                .1
                .root;
            let limits = RagLimits::starting_now();
            let walk = collect_indexable(root, limits, &cancelled);
            assert_eq!(
                walk.paths.len(),
                case.files,
                "{} listed a different file count",
                case.project
            );
            let actual = retrieve(
                root,
                &request(&case.query, Some(case.top_k), &[]),
                limits,
                &cancelled,
            )
            .unwrap();
            assert_eq!(
                actual, case.chunks,
                "{} / {:?} diverged from the TypeScript scorer",
                case.project, case.query
            );
            if !case.chunks.is_empty() {
                scored += 1;
            }
        }
        assert_eq!(scored, 24);
    }

    struct TestProject {
        _directory: tempfile::TempDir,
        _env_guard: std::sync::MutexGuard<'static, ()>,
        id: String,
        root: PathBuf,
    }

    impl Drop for TestProject {
        fn drop(&mut self) {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }
    }

    fn project(id: &str) -> TestProject {
        let env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let root = crate::paths::create_project_dir(id).unwrap();
        TestProject {
            _directory: directory,
            _env_guard: env_guard,
            id: id.to_string(),
            root,
        }
    }

    #[test]
    fn the_command_retrieves_from_a_project_and_reports_a_missing_one() {
        let project = project("rag-command");
        std::fs::write(project.root.join("main.tex"), b"needle in the haystack").unwrap();
        std::fs::write(project.root.join("main.pdf"), b"needle").unwrap();

        let chunks = tauri::async_runtime::block_on(rag_retrieve(
            project.id.clone(),
            request("needle", Some(4), &[]),
        ))
        .unwrap();
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].path, "main.tex");
        assert_eq!(chunks[0].start_line, 1);
        assert_eq!(chunks[0].end_line, 1);
        assert_eq!(chunks[0].text, "needle in the haystack");

        let overridden = tauri::async_runtime::block_on(rag_retrieve(
            project.id.clone(),
            request("rewritten", Some(4), &[("main.tex", "rewritten buffer")]),
        ))
        .unwrap();
        assert_eq!(overridden[0].text, "rewritten buffer");

        let error = tauri::async_runtime::block_on(rag_retrieve(
            "rag-command-absent".to_string(),
            request("needle", None, &[]),
        ))
        .unwrap_err();
        assert!(error.contains("rag-command-absent"));

        let rejected = tauri::async_runtime::block_on(rag_retrieve(
            project.id.clone(),
            RagRequest {
                query: "needle".into(),
                top_k: None,
                overrides: (0..MAX_OVERRIDES + 1)
                    .map(|index| RagOverride {
                        path: format!("file{index}.tex"),
                        text: String::new(),
                    })
                    .collect(),
            },
        ))
        .unwrap_err();
        assert!(rejected.contains("open buffers"));
    }

    fn median(samples: &mut [f64]) -> f64 {
        samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
        samples[samples.len() / 2]
    }

    #[test]
    #[ignore = "benchmark: run with cargo test -p oleafly rag_retrieve_benchmark -- --ignored --nocapture"]
    fn rag_retrieve_benchmark() {
        let tree = tree();
        let seed = seed_root("computational-physics-phd-thesis");
        let cancelled = never_cancelled();
        let base = collect_indexable(&seed, RagLimits::starting_now(), &cancelled).paths;
        let mut written = 0usize;
        for copy in 0..6 {
            for rel in &base {
                let target = if copy == 0 {
                    rel.clone()
                } else {
                    rel.replace(".tex", &format!("-{copy}.tex"))
                        .replace(".bib", &format!("-{copy}.bib"))
                };
                let bytes = std::fs::read(seed.join(rel)).unwrap();
                write(&tree, &target, &normalize_newlines(&bytes));
                written += 1;
            }
        }
        let walk = collect_indexable(&tree.root, RagLimits::starting_now(), &cancelled);
        let query = "adaptive lattice refinement solver convergence validation";

        let mut samples = Vec::new();
        for _ in 0..20 {
            let start = Instant::now();
            let chunks = retrieve(
                &tree.root,
                &request(query, Some(4), &[]),
                RagLimits::starting_now(),
                &cancelled,
            )
            .unwrap();
            samples.push(start.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(chunks.len(), 4);
        }
        let bytes: usize = walk
            .paths
            .iter()
            .map(|rel| std::fs::metadata(tree.root.join(rel)).unwrap().len() as usize)
            .sum();
        println!(
            "thesis-x6: {written} files on disk, {} walked and read ({bytes} bytes)",
            walk.paths.len()
        );
        println!(
            "rag_retrieve walk + read + chunk + score: median {:.2} ms over 20 runs",
            median(&mut samples)
        );
    }
}
