//! SyncTeX forward and inverse search (moved from the app).
use flate2::read::GzDecoder;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use unicode_normalization::UnicodeNormalization;

use crate::DocError;
use std::path::Path;

/// TeX scaled points → PDF points (big points / bp).
pub const SP_TO_BP: f64 = 1.0 / 65781.76;

#[derive(Default)]
pub struct Doc {
    /// synctex tag → input file path.
    inputs: BTreeMap<i32, String>,
    nodes: Vec<Node>,
    marks: Vec<Mark>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum BoxKind {
    Vertical,
    Horizontal,
}

struct Node {
    page: i32,
    tag: i32,
    line: i32,
    /// All in bp.
    h: f64,
    v: f64,
    width: f64,
    height: f64,
    depth: f64,
    kind: BoxKind,
    parent: Option<usize>,
}

struct Mark {
    tag: i32,
    line: i32,
    h: f64,
    parent: Option<usize>,
}

#[derive(Serialize, Clone, Copy)]
pub struct SynctexRect {
    pub page: i32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Serialize)]
pub struct SynctexHit {
    pub file: String,
    pub line: i32,
    pub column: i32,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct SynctexMappedLine {
    pub line: usize,
    pub exact: bool,
}

#[derive(Clone, Copy, Debug)]
struct LinePair {
    compiled: usize,
    current: usize,
}

const MAX_LCS_CELLS_PER_GAP: usize = 100_000;
const MAX_LCS_CELLS_TOTAL: usize = 400_000;

fn unique_line_anchors(compiled: &[&str], current: &[&str]) -> Vec<LinePair> {
    let mut compiled_occurrences: HashMap<&str, (usize, usize)> = HashMap::new();
    let mut current_occurrences: HashMap<&str, (usize, usize)> = HashMap::new();
    for (index, line) in compiled.iter().copied().enumerate() {
        let entry = compiled_occurrences.entry(line).or_insert((0, index));
        entry.0 += 1;
        entry.1 = index;
    }
    for (index, line) in current.iter().copied().enumerate() {
        let entry = current_occurrences.entry(line).or_insert((0, index));
        entry.0 += 1;
        entry.1 = index;
    }
    let mut candidates: Vec<LinePair> = compiled_occurrences
        .iter()
        .filter_map(|(line, &(count, compiled_index))| {
            let &(current_count, current_index) = current_occurrences.get(line)?;
            (count == 1 && current_count == 1).then_some(LinePair {
                compiled: compiled_index,
                current: current_index,
            })
        })
        .collect();
    candidates.sort_by_key(|pair| pair.compiled);
    if candidates.len() < 2 {
        return candidates;
    }

    // Patience diff: retain the longest increasing sequence of current line
    // positions so moved unique lines cannot become misleading anchors.
    let mut tails: Vec<usize> = Vec::new();
    let mut tail_candidates: Vec<usize> = Vec::new();
    let mut previous = vec![None; candidates.len()];
    for (index, candidate) in candidates.iter().enumerate() {
        let position = tails.partition_point(|value| *value < candidate.current);
        if position > 0 {
            previous[index] = Some(tail_candidates[position - 1]);
        }
        if position == tails.len() {
            tails.push(candidate.current);
            tail_candidates.push(index);
        } else {
            tails[position] = candidate.current;
            tail_candidates[position] = index;
        }
    }
    let mut anchors = Vec::with_capacity(tails.len());
    let Some(mut cursor) = tail_candidates.last().copied() else {
        return anchors;
    };
    loop {
        anchors.push(candidates[cursor]);
        let Some(prior) = previous[cursor] else {
            break;
        };
        cursor = prior;
    }
    anchors.reverse();
    anchors
}

fn lcs_pairs(
    compiled: &[&str],
    current: &[&str],
    compiled_start: usize,
    compiled_end: usize,
    current_start: usize,
    current_end: usize,
) -> Vec<LinePair> {
    let compiled_count = compiled_end - compiled_start;
    let current_count = current_end - current_start;
    if compiled_count == 0 || current_count == 0 {
        return Vec::new();
    }
    let columns = current_count + 1;
    let mut table = vec![0u32; (compiled_count + 1) * columns];
    for compiled_offset in (0..compiled_count).rev() {
        for current_offset in (0..current_count).rev() {
            let cell = compiled_offset * columns + current_offset;
            table[cell] = if compiled[compiled_start + compiled_offset]
                == current[current_start + current_offset]
            {
                table[(compiled_offset + 1) * columns + current_offset + 1] + 1
            } else {
                table[(compiled_offset + 1) * columns + current_offset]
                    .max(table[compiled_offset * columns + current_offset + 1])
            };
        }
    }

    let mut pairs = Vec::new();
    let mut compiled_offset = 0;
    let mut current_offset = 0;
    while compiled_offset < compiled_count && current_offset < current_count {
        if compiled[compiled_start + compiled_offset] == current[current_start + current_offset] {
            pairs.push(LinePair {
                compiled: compiled_start + compiled_offset,
                current: current_start + current_offset,
            });
            compiled_offset += 1;
            current_offset += 1;
        } else if table[(compiled_offset + 1) * columns + current_offset]
            >= table[compiled_offset * columns + current_offset + 1]
        {
            compiled_offset += 1;
        } else {
            current_offset += 1;
        }
    }
    pairs
}

#[allow(clippy::too_many_arguments)]
fn add_gap_matches(
    compiled: &[&str],
    current: &[&str],
    mut compiled_start: usize,
    mut compiled_end: usize,
    mut current_start: usize,
    mut current_end: usize,
    pairs: &mut Vec<LinePair>,
    lcs_budget: &mut usize,
) {
    while compiled_start < compiled_end
        && current_start < current_end
        && compiled[compiled_start] == current[current_start]
    {
        pairs.push(LinePair {
            compiled: compiled_start,
            current: current_start,
        });
        compiled_start += 1;
        current_start += 1;
    }
    let mut suffix = Vec::new();
    while compiled_start < compiled_end
        && current_start < current_end
        && compiled[compiled_end - 1] == current[current_end - 1]
    {
        compiled_end -= 1;
        current_end -= 1;
        suffix.push(LinePair {
            compiled: compiled_end,
            current: current_end,
        });
    }
    let cells = (compiled_end - compiled_start).saturating_mul(current_end - current_start);
    if cells > 0 && cells <= MAX_LCS_CELLS_PER_GAP && cells <= *lcs_budget {
        *lcs_budget -= cells;
        pairs.extend(lcs_pairs(
            compiled,
            current,
            compiled_start,
            compiled_end,
            current_start,
            current_end,
        ));
    }
    suffix.reverse();
    pairs.extend(suffix);
}

fn source_line_map(compiled_source: &str, current_source: &str) -> Vec<LinePair> {
    let compiled: Vec<&str> = compiled_source.split('\n').collect();
    let current: Vec<&str> = current_source.split('\n').collect();
    let anchors = unique_line_anchors(&compiled, &current);
    let mut pairs = Vec::new();
    let mut compiled_start = 0;
    let mut current_start = 0;
    let mut lcs_budget = MAX_LCS_CELLS_TOTAL;
    for anchor in anchors {
        add_gap_matches(
            &compiled,
            &current,
            compiled_start,
            anchor.compiled,
            current_start,
            anchor.current,
            &mut pairs,
            &mut lcs_budget,
        );
        pairs.push(anchor);
        compiled_start = anchor.compiled + 1;
        current_start = anchor.current + 1;
    }
    add_gap_matches(
        &compiled,
        &current,
        compiled_start,
        compiled.len(),
        current_start,
        current.len(),
        &mut pairs,
        &mut lcs_budget,
    );
    pairs.sort_by_key(|pair| (pair.compiled, pair.current));
    pairs
}

pub fn map_source_line(
    compiled_source: &str,
    current_source: &str,
    line: usize,
    current_to_compiled: bool,
) -> Option<SynctexMappedLine> {
    let pairs = source_line_map(compiled_source, current_source);
    if pairs.is_empty() {
        return None;
    }
    let source_line_count = if current_to_compiled {
        current_source.split('\n').count()
    } else {
        compiled_source.split('\n').count()
    };
    let source_index = line
        .saturating_sub(1)
        .min(source_line_count.saturating_sub(1));
    let source_position = |pair: &LinePair| {
        if current_to_compiled {
            pair.current
        } else {
            pair.compiled
        }
    };
    let target_position = |pair: &LinePair| {
        if current_to_compiled {
            pair.compiled
        } else {
            pair.current
        }
    };
    let insertion = pairs.partition_point(|pair| source_position(pair) < source_index);
    if let Some(pair) = pairs.get(insertion) {
        if source_position(pair) == source_index {
            return Some(SynctexMappedLine {
                line: target_position(pair) + 1,
                exact: true,
            });
        }
    }
    let before = insertion.checked_sub(1).and_then(|index| pairs.get(index));
    let after = pairs.get(insertion);
    let nearest = match (before, after) {
        (Some(before), Some(after)) => {
            if source_index - source_position(before) <= source_position(after) - source_index {
                before
            } else {
                after
            }
        }
        (Some(before), None) => before,
        (None, Some(after)) => after,
        (None, None) => return None,
    };
    Some(SynctexMappedLine {
        line: target_position(nearest) + 1,
        exact: false,
    })
}

pub fn parse(text: &str) -> Doc {
    let mut doc = Doc::default();
    let mut page = 0i32;
    let mut open: Vec<Option<usize>> = Vec::new();

    for raw in text.lines() {
        let line = raw.trim_end();
        if let Some(rest) = line.strip_prefix("Input:") {
            // Input:<tag>:<path>
            if let Some(idx) = rest.find(':') {
                if let Ok(tag) = rest[..idx].parse::<i32>() {
                    let path = &rest[idx + 1..];
                    if !path.is_empty() {
                        doc.inputs.insert(tag, path.to_string());
                    }
                }
            }
            continue;
        }
        let parent = open.iter().rev().find_map(|slot| *slot);
        match line.chars().next() {
            Some('{') => {
                page = line[1..].trim().parse().unwrap_or(0);
                open.clear();
            }
            Some(open_char @ ('[' | '(')) => {
                let kind = if open_char == '(' {
                    BoxKind::Horizontal
                } else {
                    BoxKind::Vertical
                };
                let node = parse_box(line, page, kind, parent);
                open.push(node.as_ref().map(|_| doc.nodes.len()));
                doc.nodes.extend(node);
            }
            Some(']' | ')') => {
                open.pop();
            }
            Some('k' | 'g' | 'x' | '$') => doc.marks.extend(parse_mark(line, parent)),
            _ => {}
        }
    }
    doc
}

fn tag_and_line(head: &str) -> Option<(i32, i32)> {
    let mut head = head.split(',');
    let tag = head.next()?.parse().ok()?;
    let line = head.next()?.parse().ok()?;
    Some((tag, line))
}

fn parse_mark(line: &str, parent: Option<usize>) -> Option<Mark> {
    let (head, tail) = line[1..].split_once(':')?;
    let (tag, line_no) = tag_and_line(head)?;
    let h: f64 = tail.split([',', ':']).next()?.parse().ok()?;
    Some(Mark {
        tag,
        line: line_no,
        h: h * SP_TO_BP,
        parent,
    })
}

/// Parse a compact box line: `[tag,line:h,v:width,height,depth` (vbox) or
/// `(tag,line:h,v:width,height,depth` (hbox).
fn parse_box(line: &str, page: i32, kind: BoxKind, parent: Option<usize>) -> Option<Node> {
    let rest = &line[1..]; // drop leading [ or (
    let (head, tail) = rest.split_once(':')?;
    let (tag, line_no) = tag_and_line(head)?;

    let mut tail = tail.splitn(2, ':');
    let hv = tail.next()?;
    let whd = tail.next().unwrap_or("0,0,0");

    let mut hv = hv.split(',');
    let h: f64 = hv.next()?.parse().ok()?;
    let v: f64 = hv.next()?.parse().ok()?;

    let mut whd = whd.split(',');
    let width: f64 = whd.next().and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let height: f64 = whd.next().and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let depth: f64 = whd.next().and_then(|s| s.parse().ok()).unwrap_or(0.0);

    Some(Node {
        page,
        tag,
        line: line_no,
        h: h * SP_TO_BP,
        v: v * SP_TO_BP,
        width: width * SP_TO_BP,
        height: height * SP_TO_BP,
        depth: depth * SP_TO_BP,
        kind,
        parent,
    })
}

pub fn normalized_path(path: &str) -> String {
    let slashed = path.replace('\\', "/");
    let parts: Vec<&str> = slashed.split('/').filter(|part| *part != ".").collect();
    parts.join("/").nfc().collect()
}

fn project_relative(path: &str, roots: &[String]) -> Option<String> {
    roots
        .iter()
        .filter(|root| !root.is_empty())
        .find_map(|root| path.strip_prefix(root.as_str())?.strip_prefix('/'))
        .filter(|relative| !relative.is_empty())
        .map(str::to_string)
}

fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

pub fn tag_for_file(doc: &Doc, file: &str, roots: &[String]) -> Option<i32> {
    let want = normalized_path(file);
    if want.is_empty() {
        return None;
    }
    let inputs: Vec<(i32, String, Option<String>)> = doc
        .inputs
        .iter()
        .map(|(tag, path)| {
            let path = normalized_path(path);
            let relative = project_relative(&path, roots);
            (*tag, path, relative)
        })
        .collect();
    if let Some((tag, _, _)) = inputs
        .iter()
        .find(|(_, path, relative)| relative.as_deref() == Some(want.as_str()) || *path == want)
    {
        return Some(*tag);
    }
    let suffix = format!("/{want}");
    let depth = |path: &str| path.matches('/').count();
    let containing: Vec<&(i32, String, Option<String>)> = inputs
        .iter()
        .filter(|(_, path, _)| path.ends_with(&suffix))
        .collect();
    if let Some(shallowest) = containing.iter().map(|(_, path, _)| depth(path)).min() {
        let mut closest = containing
            .iter()
            .filter(|(_, path, _)| depth(path) == shallowest);
        return match (closest.next(), closest.next()) {
            (Some((tag, _, _)), None) => Some(*tag),
            _ => None,
        };
    }
    let name = basename(&want);
    let mut named = inputs.iter().filter(|(_, path, _)| basename(path) == name);
    match (named.next(), named.next()) {
        (Some((tag, _, _)), None) => Some(*tag),
        _ => None,
    }
}

/// Forward search: (file, line) → tightest box on its page. Returns a rect in
/// PDF bp with origin at the page's top-left (y grows downward).
pub fn forward(doc: &Doc, file: &str, line: i32, roots: &[String]) -> Option<SynctexRect> {
    let tag = tag_for_file(doc, file, roots)?;
    let real = |n: &Node| n.height + n.depth >= 4.0 && n.width >= 5.0;

    if let Some(chosen) = doc
        .marks
        .iter()
        .filter(|mark| mark.tag == tag && mark.line == line)
        .filter_map(|mark| line_box(doc, mark.parent))
        .filter(|n| real(n))
        .min_by(|a, b| {
            a.page
                .cmp(&b.page)
                .then((a.v - a.height).total_cmp(&(b.v - b.height)))
                .then(a.h.total_cmp(&b.h))
        })
    {
        return Some(to_rect(chosen));
    }

    // Prefer an exact-line match; among those, the tightest (smallest) real box.
    let exact: Vec<&Node> = doc
        .nodes
        .iter()
        .filter(|n| n.tag == tag && n.line == line && real(n))
        .collect();
    if let Some(chosen) = exact.into_iter().min_by(|a, b| {
        (a.width * (a.height + a.depth))
            .partial_cmp(&(b.width * (b.height + b.depth)))
            .unwrap_or(std::cmp::Ordering::Equal)
    }) {
        return Some(to_rect(chosen));
    }

    // No exact match: nearest real node by line distance.
    let chosen = doc
        .nodes
        .iter()
        .filter(|n| n.tag == tag && real(n))
        .min_by_key(|n| (n.line - line).abs())?;
    Some(to_rect(chosen))
}

fn to_rect(n: &Node) -> SynctexRect {
    SynctexRect {
        page: n.page,
        x: n.h,
        y: n.v - n.height,
        width: n.width,
        height: n.height + n.depth,
    }
}

/// Inverse search: (page, x, y) in bp → (file, line).
pub fn inverse(doc: &Doc, page: i32, x: f64, y: f64, roots: &[String]) -> Option<SynctexHit> {
    let chosen = pick_box(doc, page, x, y)?;
    let (tag, line) = refine_line(doc, chosen, x);
    let file = doc
        .inputs
        .get(&tag)
        .map(|path| {
            let path = normalized_path(path);
            project_relative(&path, roots).unwrap_or(path)
        })
        .unwrap_or_default();
    Some(SynctexHit {
        file,
        line,
        column: 0,
    })
}

fn contains(n: &Node, x: f64, y: f64) -> bool {
    x >= n.h && x <= n.h + n.width && y >= n.v - n.height && y <= n.v + n.depth
}

fn edge_distance(n: &Node, x: f64, y: f64) -> f64 {
    let dx = (n.h - x).max(x - (n.h + n.width)).max(0.0);
    let dy = (n.v - n.height - y).max(y - (n.v + n.depth)).max(0.0);
    dx.hypot(dy)
}

fn area(n: &Node) -> f64 {
    n.width * (n.height + n.depth)
}

fn within(doc: &Doc, mut index: Option<usize>, ancestor: usize) -> bool {
    while let Some(current) = index {
        if current == ancestor {
            return true;
        }
        index = doc.nodes[current].parent;
    }
    false
}

fn smallest(doc: &Doc, candidates: impl Iterator<Item = usize>) -> Option<usize> {
    candidates.min_by(|&a, &b| area(&doc.nodes[a]).total_cmp(&area(&doc.nodes[b])))
}

fn nearest(doc: &Doc, candidates: impl Iterator<Item = usize>, x: f64, y: f64) -> Option<usize> {
    candidates.min_by(|&a, &b| {
        let (a, b) = (&doc.nodes[a], &doc.nodes[b]);
        edge_distance(a, x, y)
            .total_cmp(&edge_distance(b, x, y))
            .then(area(a).total_cmp(&area(b)))
    })
}

fn pick_box(doc: &Doc, page: i32, x: f64, y: f64) -> Option<usize> {
    let on_page: Vec<usize> = (0..doc.nodes.len())
        .filter(|&index| doc.nodes[index].page == page)
        .collect();
    let named = |index: &usize| doc.inputs.contains_key(&doc.nodes[*index].tag);
    let lines: Vec<usize> = on_page
        .iter()
        .copied()
        .filter(|index| {
            let node = &doc.nodes[*index];
            named(index) && node.kind == BoxKind::Horizontal && node.width > 0.0
        })
        .collect();
    let under = |index: &usize| contains(&doc.nodes[*index], x, y);
    if let Some(line) = smallest(doc, lines.iter().copied().filter(under)) {
        return Some(line);
    }
    let mut containers: Vec<usize> = on_page.iter().copied().filter(under).collect();
    containers.sort_by(|&a, &b| area(&doc.nodes[a]).total_cmp(&area(&doc.nodes[b])));
    containers
        .into_iter()
        .find_map(|container| {
            let inside = lines
                .iter()
                .copied()
                .filter(|&line| within(doc, Some(line), container));
            nearest(doc, inside, x, y)
        })
        .or_else(|| nearest(doc, lines.iter().copied(), x, y))
        .or_else(|| nearest(doc, on_page.iter().copied().filter(named), x, y))
}

fn refine_line(doc: &Doc, chosen: usize, x: f64) -> (i32, i32) {
    let node = &doc.nodes[chosen];
    let marks: Vec<&Mark> = doc
        .marks
        .iter()
        .filter(|mark| doc.inputs.contains_key(&mark.tag) && within(doc, mark.parent, chosen))
        .collect();
    let from_text: Vec<&Mark> = marks
        .iter()
        .copied()
        .filter(|mark| mark.tag != node.tag || mark.line != node.line)
        .collect();
    let pool = if from_text.is_empty() {
        marks
    } else {
        from_text
    };
    pool.iter()
        .rev()
        .filter(|mark| mark.h <= x)
        .max_by(|a, b| a.h.total_cmp(&b.h))
        .or_else(|| pool.iter().min_by(|a, b| a.h.total_cmp(&b.h)))
        .map_or((node.tag, node.line), |mark| (mark.tag, mark.line))
}

fn line_box(doc: &Doc, mut index: Option<usize>) -> Option<&Node> {
    while let Some(current) = index {
        let node = &doc.nodes[current];
        if node.kind == BoxKind::Horizontal && node.width > 0.0 {
            return Some(node);
        }
        index = node.parent;
    }
    None
}

/// The biggest SyncTeX file `read_synctex` opens. A 1000-page book's is a few
/// megabytes; a build folder can come from anyone.
const MAX_SYNCTEX_FILE_BYTES: u64 = 64 * 1024 * 1024;
/// The most text `read_synctex` inflates from it (gzip stretches a run of
/// zeros a thousand times over).
const MAX_SYNCTEX_TEXT_BYTES: u64 = 128 * 1024 * 1024;

/// The SyncTeX file of the last LaTeX build in `build_dir`, unzipped.
/// Creates nothing. A link in the build folder is refused rather than read
/// through, and a file or its text over the limits above is refused too.
pub fn read_synctex(build_dir: &Path) -> Result<String, DocError> {
    read_synctex_limited(build_dir, MAX_SYNCTEX_FILE_BYTES, MAX_SYNCTEX_TEXT_BYTES)
}

fn read_synctex_limited(
    build_dir: &Path,
    max_file_bytes: u64,
    max_text_bytes: u64,
) -> Result<String, DocError> {
    // Compiles run through the `_oleafly_entry` wrapper, so the synctex file
    // is named after it.
    let path = build_dir.join(format!(
        "{}.synctex.gz",
        oleafly_core::engine_spec::ENTRY_STEM
    ));
    let opened = std::fs::symlink_metadata(&path).and_then(|metadata| {
        if metadata.is_file() {
            std::fs::File::open(&path)
        } else {
            Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "it isn't a regular file",
            ))
        }
    });
    let file = match opened {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(DocError::new(
                "synctex.not_compiled",
                "This project hasn't been compiled with SyncTeX yet.",
            ));
        }
        Err(error) => {
            return Err(DocError::other(format!(
                "failed to read synctex {path:?}: {error}"
            )))
        }
    };
    let too_big = |what: &str| {
        DocError::other(format!(
            "The SyncTeX file is too large ({what}), so Oleafly won't read it."
        ))
    };
    let length = file
        .metadata()
        .map_err(|error| DocError::other(format!("failed to read synctex {path:?}: {error}")))?
        .len();
    if length > max_file_bytes {
        return Err(too_big("the file"));
    }
    let mut text = String::new();
    GzDecoder::new(file.take(max_file_bytes))
        .take(max_text_bytes + 1)
        .read_to_string(&mut text)
        .map_err(|error| DocError::other(format!("failed to gunzip synctex: {error}")))?;
    if text.len() as u64 > max_text_bytes {
        return Err(too_big("its text"));
    }
    Ok(text)
}

/// The project folder as SyncTeX may spell it (as given, and resolved).
pub fn project_roots(root: &Path) -> Vec<String> {
    let mut roots = vec![normalized_path(&root.to_string_lossy())];
    if let Ok(canonical) = root.canonicalize() {
        let canonical = normalized_path(&canonical.to_string_lossy());
        if !roots.contains(&canonical) {
            roots.push(canonical);
        }
    }
    roots
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOOK: &[u8] = include_bytes!("../tests/fixtures/synctex/include-book.synctex.gz");
    const BOOK_INVERSE: &str = include_str!("../tests/fixtures/synctex/include-book.inverse.tsv");
    const BOOK_FORWARD: &str = include_str!("../tests/fixtures/synctex/include-book.forward.tsv");
    const ARTICLE: &[u8] = include_bytes!("../tests/fixtures/synctex/academic-article.synctex.gz");
    const ARTICLE_INVERSE: &str =
        include_str!("../tests/fixtures/synctex/academic-article.inverse.tsv");
    const ARTICLE_FORWARD: &str =
        include_str!("../tests/fixtures/synctex/academic-article.forward.tsv");

    fn fixture(gz: &[u8]) -> Doc {
        let mut text = String::new();
        GzDecoder::new(gz).read_to_string(&mut text).unwrap();
        parse(&text)
    }

    fn fixture_roots() -> Vec<String> {
        vec!["/p".to_string()]
    }

    fn texlive_clicks(tsv: &str) -> Vec<(i32, f64, f64, &str, i32)> {
        tsv.lines()
            .filter(|row| !row.is_empty())
            .map(|row| {
                let cells: Vec<&str> = row.split('\t').collect();
                (
                    cells[0].parse().unwrap(),
                    cells[1].parse().unwrap(),
                    cells[2].parse().unwrap(),
                    cells[3],
                    cells[4].parse().unwrap(),
                )
            })
            .collect()
    }

    type TexliveSpots<'a> = (&'a str, i32, Vec<(i32, f64)>);

    fn texlive_spots(tsv: &str) -> Vec<TexliveSpots<'_>> {
        tsv.lines()
            .filter(|row| !row.is_empty())
            .map(|row| {
                let cells: Vec<&str> = row.split('\t').collect();
                let spots = cells[2]
                    .split(',')
                    .map(|spot| {
                        let (page, v) = spot.split_once(':').unwrap();
                        (page.parse().unwrap(), v.parse().unwrap())
                    })
                    .collect();
                (cells[0], cells[1].parse().unwrap(), spots)
            })
            .collect()
    }

    #[test]
    fn inverse_search_matches_texlive_on_every_word_of_an_include_book() {
        let doc = fixture(BOOK);
        let roots = fixture_roots();
        let clicks = texlive_clicks(BOOK_INVERSE);
        assert!(clicks.len() > 400);
        for (page, x, y, file, line) in clicks {
            let hit = inverse(&doc, page, x, y, &roots).expect("a word always hits");
            assert_eq!(
                (hit.file.as_str(), hit.line),
                (file, line),
                "click on page {page} at ({x}, {y})"
            );
        }
    }

    #[test]
    fn inverse_search_stays_within_two_lines_of_texlive_in_an_article() {
        let doc = fixture(ARTICLE);
        let roots = fixture_roots();
        let clicks = texlive_clicks(ARTICLE_INVERSE);
        let mut exact = 0;
        for (page, x, y, file, line) in &clicks {
            let hit = inverse(&doc, *page, *x, *y, &roots).expect("a word always hits");
            assert_eq!(hit.file, *file, "click on page {page} at ({x}, {y})");
            assert!(
                (hit.line - line).abs() <= 2,
                "click on page {page} at ({x}, {y}) gave line {} for {line}",
                hit.line
            );
            exact += usize::from(hit.line == *line);
        }
        assert!(
            exact * 100 >= clicks.len() * 95,
            "{exact} of {} exact",
            clicks.len()
        );
    }

    #[test]
    fn forward_search_lands_on_a_line_texlive_reports() {
        for (gz, tsv) in [(BOOK, BOOK_FORWARD), (ARTICLE, ARTICLE_FORWARD)] {
            let doc = fixture(gz);
            let roots = fixture_roots();
            for (file, line, spots) in texlive_spots(tsv) {
                let rect = forward(&doc, file, line, &roots).expect("a text line has a box");
                let covered = spots.iter().any(|&(page, v)| {
                    page == rect.page && v >= rect.y - 1.0 && v <= rect.y + rect.height + 1.0
                });
                assert!(
                    covered,
                    "{file}:{line} went to page {} at {}",
                    rect.page, rect.y
                );
            }
        }
    }

    #[test]
    fn a_click_below_the_last_paragraph_of_a_chapter_opens_that_chapter() {
        let doc = fixture(BOOK);
        let roots = fixture_roots();
        for (page, chapter) in [
            (5, "chapters/intro.tex"),
            (9, "chapters/methods.tex"),
            (13, "chapters/results.tex"),
        ] {
            for (x, y) in [(120.0, 530.0), (300.0, 560.0), (440.0, 640.0)] {
                let hit = inverse(&doc, page, x, y, &roots).expect("the page has text");
                assert_eq!(hit.file, chapter, "page {page} at ({x}, {y})");
            }
        }
    }

    const PARAGRAPH: &str = "SyncTeX Version:1\n\
Input:1:/p/main.tex\n\
Input:2:/p/chapter.tex\n\
Input:3:\n\
Content:\n\
{1\n\
[1,4:0,52625288:39468966,52625288,0\n\
(2,9:6578176,6578176:32890790,657818,0\n\
g2,9:6578176,6578176\n\
k2,7:7894000,6578176:65536\n\
g2,7:9867000,6578176\n\
g2,8:13156000,6578176\n\
)\n\
(3,5:6578176,13156352:32890790,657818,0\n\
g3,5:6578176,13156352\n\
)\n\
(1,4:6578176,49343220:32890790,0,0\n\
)\n\
]\n\
}1\n\
{2\n\
[3,1:0,52625288:39468966,52625288,0\n\
]\n\
}2\n";

    #[test]
    fn a_click_resolves_to_the_line_each_word_was_read_from() {
        let doc = parse(PARAGRAPH);
        let roots = fixture_roots();
        let at = |x: f64| inverse(&doc, 1, x, 95.0, &roots).unwrap();
        assert_eq!(
            (at(101.0).file.as_str(), at(101.0).line),
            ("chapter.tex", 7)
        );
        assert_eq!(at(140.0).line, 7);
        assert_eq!(at(210.0).line, 8);
    }

    #[test]
    fn boxes_without_a_file_name_never_become_the_hit() {
        let doc = parse(PARAGRAPH);
        let roots = fixture_roots();
        let hit = inverse(&doc, 1, 150.0, 195.0, &roots).unwrap();
        assert_eq!(hit.file, "chapter.tex");
        assert!(inverse(&doc, 2, 150.0, 195.0, &roots).is_none());
    }

    #[test]
    fn forward_search_finds_a_line_inside_a_paragraph() {
        let doc = parse(PARAGRAPH);
        let roots = fixture_roots();
        let rect = forward(&doc, "chapter.tex", 8, &roots).unwrap();
        assert_eq!(rect.page, 1);
        assert!((rect.y - 90.0).abs() < 1.0, "y = {}", rect.y);
    }

    const DUPLICATE_BASENAMES: &str = "SyncTeX Version:1\n\
Input:1:/p/build/_oleafly_entry.tex\n\
Input:2:/p/main.tex\n\
Input:8:/p/cast/a/intro.tex\n\
Input:9:/p/./cast/b/intro.tex\n\
Input:10:/p/kapitoly/u\u{301}vod.tex\n\
Content:\n\
{1\n\
[8,3:4736286,4736286:22609920,655360,0\n\
[9,3:4736286,9736286:22609920,655360,0\n\
[10,2:4736286,14736286:22609920,655360,0\n\
}1\n";

    #[test]
    fn forward_search_tells_files_with_the_same_basename_apart() {
        let roots = vec!["/p".to_string()];
        for _ in 0..8 {
            let doc = parse(DUPLICATE_BASENAMES);
            assert_eq!(tag_for_file(&doc, "cast/a/intro.tex", &roots), Some(8));
            assert_eq!(tag_for_file(&doc, "cast/b/intro.tex", &roots), Some(9));
        }
        let doc = parse(DUPLICATE_BASENAMES);
        assert_eq!(tag_for_file(&doc, "intro.tex", &roots), None);
        assert_eq!(tag_for_file(&doc, "main.tex", &roots), Some(2));
        assert_eq!(tag_for_file(&doc, "./main.tex", &roots), Some(2));
        assert_eq!(
            tag_for_file(&doc, "kapitoly/\u{fa}vod.tex", &roots),
            Some(10)
        );
        assert_eq!(tag_for_file(&doc, "cast/b/intro.tex", &[]), Some(9));
        assert_eq!(tag_for_file(&doc, "b/intro.tex", &[]), Some(9));
    }

    #[test]
    fn inverse_search_reports_the_project_relative_path() {
        let doc = parse(DUPLICATE_BASENAMES);
        let roots = vec!["/p".to_string()];
        let y = 9_736_286.0 * SP_TO_BP - 5.0;
        let hit = inverse(&doc, 1, 100.0, y, &roots).expect("inverse should hit");
        assert_eq!(hit.file, "cast/b/intro.tex");
        assert_eq!(hit.line, 3);
        let outside = inverse(&doc, 1, 100.0, y, &[]).expect("inverse should hit");
        assert_eq!(outside.file, "/p/cast/b/intro.tex");
    }

    #[test]
    fn stale_line_map_translates_insertions_in_both_directions() {
        let compiled = "alpha\nbeta\ngamma";
        let current = "alpha\ninserted\nbeta\ngamma";
        assert_eq!(
            map_source_line(compiled, current, 4, true),
            Some(SynctexMappedLine {
                line: 3,
                exact: true
            })
        );
        assert_eq!(
            map_source_line(compiled, current, 3, false),
            Some(SynctexMappedLine {
                line: 4,
                exact: true
            })
        );
        assert_eq!(
            map_source_line(compiled, current, 2, true),
            Some(SynctexMappedLine {
                line: 1,
                exact: false
            })
        );
    }

    #[test]
    fn stale_line_map_refuses_unrelated_documents() {
        assert_eq!(map_source_line("alpha\nbeta", "one\ntwo", 1, true), None);
    }

    #[test]
    fn stale_line_map_handles_large_small_delta_documents() {
        let compiled = (0..20_000)
            .map(|index| format!("unique source line {index}"))
            .collect::<Vec<_>>()
            .join("\n");
        let mut current_lines = compiled.lines().map(str::to_owned).collect::<Vec<_>>();
        current_lines.insert(10_000, "one local insertion".to_string());
        let current = current_lines.join("\n");
        assert_eq!(
            map_source_line(&compiled, &current, 19_000, true),
            Some(SynctexMappedLine {
                line: 18_999,
                exact: true
            })
        );
    }

    fn gzip(bytes: &[u8]) -> Vec<u8> {
        use flate2::{write::GzEncoder, Compression};
        use std::io::Write;
        let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
        encoder.write_all(bytes).unwrap();
        encoder.finish().unwrap()
    }

    fn synctex_file(build: &Path) -> std::path::PathBuf {
        build.join("_oleafly_entry.synctex.gz")
    }

    #[test]
    fn read_synctex_unzips_a_file_within_the_limits() {
        let build = tempfile::tempdir().unwrap();
        std::fs::write(synctex_file(build.path()), gzip(b"SyncTeX Version:1\n")).unwrap();
        assert_eq!(read_synctex(build.path()).unwrap(), "SyncTeX Version:1\n");
    }

    #[test]
    fn read_synctex_stops_at_a_gzip_bomb_and_an_oversized_file() {
        let build = tempfile::tempdir().unwrap();
        // 1 MiB of zeros is a few kilobytes of gzip (how few depends on the
        // deflate backend the workspace's features pick).
        let bomb = gzip(&vec![0_u8; 1 << 20]);
        assert!(bomb.len() < 64 * 1024, "{}", bomb.len());
        std::fs::write(synctex_file(build.path()), &bomb).unwrap();
        let error = read_synctex_limited(build.path(), 1 << 20, 64 * 1024).unwrap_err();
        assert!(error.message.contains("its text"), "{error}");
        // Just under the limit still reads.
        assert_eq!(
            read_synctex_limited(build.path(), 1 << 20, 1 << 20)
                .unwrap()
                .len(),
            1 << 20
        );
        let error = read_synctex_limited(build.path(), 1024, 1 << 30).unwrap_err();
        assert!(error.message.contains("the file"), "{error}");
    }

    #[cfg(unix)]
    #[test]
    fn read_synctex_does_not_read_through_a_link() {
        let build = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let real = elsewhere.path().join("other.synctex.gz");
        std::fs::write(&real, gzip(b"SyncTeX Version:1\n")).unwrap();
        std::os::unix::fs::symlink(&real, synctex_file(build.path())).unwrap();
        let error = read_synctex(build.path()).unwrap_err();
        assert_eq!(error.code, "doc.failed");
        assert!(error.message.contains("regular file"), "{error}");
    }

    #[test]
    fn read_synctex_names_a_missing_file_and_creates_nothing() {
        let directory = tempfile::tempdir().unwrap();
        let build = directory.path().join("build");
        let error = read_synctex(&build).unwrap_err();
        assert_eq!(error.code, "synctex.not_compiled");
        assert!(!build.exists());
    }
}
