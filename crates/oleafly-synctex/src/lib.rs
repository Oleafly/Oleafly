use flate2::read::GzDecoder;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::io::Read;
use unicode_normalization::UnicodeNormalization;

/// TeX scaled points → PDF points (big points / bp).
pub const SP_TO_BP: f64 = 1.0 / 65781.76;

#[derive(Default)]
pub struct Doc {
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
    /// An `x` (current point) record. pdfTeX writes one after a run of
    /// characters and tags it with the node before the run, so after the first
    /// word of a source line it still names the line above.
    current: bool,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub struct SynctexRect {
    pub page: i32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub struct SynctexLine {
    pub page: i32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub from: f64,
    pub to: f64,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct SynctexForwardHit {
    #[serde(flatten)]
    pub rect: SynctexRect,
    pub lines: Vec<SynctexLine>,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
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
        current: line.starts_with('x'),
    })
}

fn parse_box(line: &str, page: i32, kind: BoxKind, parent: Option<usize>) -> Option<Node> {
    let rest = &line[1..];
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
    let roots = || roots.iter().filter(|root| !root.is_empty());
    roots()
        .find_map(|root| path.strip_prefix(root.as_str())?.strip_prefix('/'))
        .map(str::to_string)
        .or_else(|| {
            FOLDS_CASE
                .then(|| roots().find_map(|root| strip_folded_root(path, root)))
                .flatten()
        })
        .filter(|relative| !relative.is_empty())
}

const FOLDS_CASE: bool = cfg!(any(windows, target_os = "macos"));

fn folded(path: &str) -> String {
    path.to_lowercase()
}

fn strip_folded_root(path: &str, root: &str) -> Option<String> {
    let mut parts = path.split('/');
    for want in root.split('/') {
        if folded(parts.next()?) != folded(want) {
            return None;
        }
    }
    Some(parts.collect::<Vec<_>>().join("/"))
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
    let folded_inputs: Vec<(i32, String, Option<String>)> = inputs
        .iter()
        .map(|(tag, path, relative)| (*tag, folded(path), relative.as_deref().map(folded)))
        .collect();
    let folded_want = folded(&want);
    exact_tag(&inputs, &want, false)
        .or_else(|| exact_tag(&folded_inputs, &folded_want, true))
        .or_else(|| nearby_tag(&inputs, &want))
        .or_else(|| nearby_tag(&folded_inputs, &folded_want))
}

fn exact_tag(inputs: &[(i32, String, Option<String>)], want: &str, unique: bool) -> Option<i32> {
    let mut exact = inputs
        .iter()
        .filter(|(_, path, relative)| relative.as_deref() == Some(want) || path == want);
    let (tag, _, _) = exact.next()?;
    if unique && exact.any(|(other, _, _)| other != tag) {
        return None;
    }
    Some(*tag)
}

fn nearby_tag(inputs: &[(i32, String, Option<String>)], want: &str) -> Option<i32> {
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
    let name = basename(want);
    let mut named = inputs.iter().filter(|(_, path, _)| basename(path) == name);
    match (named.next(), named.next()) {
        (Some((tag, _, _)), None) => Some(*tag),
        _ => None,
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Found {
    Text,
    Box,
    Nearest,
}

pub fn forward(doc: &Doc, file: &str, line: i32, roots: &[String]) -> Option<(SynctexRect, Found)> {
    let tag = tag_for_file(doc, file, roots)?;
    let real = |n: &Node| n.height + n.depth >= 4.0 && n.width >= 5.0;

    if let Some(chosen) = doc
        .marks
        .iter()
        .filter(|mark| mark.tag == tag && mark.line == line)
        .filter_map(|mark| line_box(doc, mark.parent).filter(|&owner| trusted(doc, mark, owner)))
        .map(|owner| &doc.nodes[owner])
        .filter(|n| real(n))
        .min_by(|a, b| {
            a.page
                .cmp(&b.page)
                .then((a.v - a.height).total_cmp(&(b.v - b.height)))
                .then(a.h.total_cmp(&b.h))
        })
    {
        return Some((to_rect(chosen), Found::Text));
    }

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
        return Some((to_rect(chosen), Found::Box));
    }

    let chosen = doc
        .nodes
        .iter()
        .filter(|n| n.tag == tag && real(n))
        .min_by_key(|n| (n.line - line).abs())?;
    Some((to_rect(chosen), Found::Nearest))
}

fn reading_order(a: &SynctexLine, b: &SynctexLine) -> std::cmp::Ordering {
    a.page
        .cmp(&b.page)
        .then(a.y.total_cmp(&b.y))
        .then(a.x.total_cmp(&b.x))
}

const NEIGHBOUR_LINES: i32 = 3;

/// Forward search with every typeset line of the source line attached.
///
/// A source line can leave no record at all: TeX drops the space after a
/// paragraph's last word, so a line holding just that word has none, and the
/// nearest tagged box is then the paragraph's first line. Its words follow the
/// line above and come before the line below, so their typeset lines are
/// offered instead, starting from the last one above.
pub fn forward_hit(
    doc: &Doc,
    file: &str,
    line: i32,
    roots: &[String],
) -> Option<SynctexForwardHit> {
    let (mut rect, found) = forward(doc, file, line, roots)?;
    let Some(tag) = tag_for_file(doc, file, roots) else {
        return Some(SynctexForwardHit {
            rect,
            lines: Vec::new(),
        });
    };
    let mut lines = forward_lines(doc, tag, line);
    if lines.is_empty() && found == Found::Nearest {
        let nearest = |step: i32| {
            (1..=NEIGHBOUR_LINES)
                .map(|distance| forward_lines(doc, tag, line + step * distance))
                .find(|found| !found.is_empty())
                .unwrap_or_default()
        };
        let above = nearest(-1);
        let below = nearest(1);
        if let Some(last) = above.last().or(below.first()) {
            rect = SynctexRect {
                page: last.page,
                x: last.x,
                y: last.y,
                width: last.width,
                height: last.height,
            };
        }
        for candidate in above.into_iter().chain(below) {
            let same = |other: &SynctexLine| {
                other.page == candidate.page && other.x == candidate.x && other.y == candidate.y
            };
            if !lines.iter().any(same) {
                lines.push(candidate);
            }
        }
        lines.sort_by(reading_order);
    }
    Some(SynctexForwardHit { rect, lines })
}

fn forward_lines(doc: &Doc, tag: i32, line: i32) -> Vec<SynctexLine> {
    let real = |n: &Node| n.height + n.depth >= 4.0 && n.width >= 5.0;
    let owners: Vec<(usize, &Mark)> = doc
        .marks
        .iter()
        .filter(|mark| doc.inputs.contains_key(&mark.tag) && !mark.current)
        .filter_map(|mark| {
            line_box(doc, mark.parent)
                .filter(|&owner| trusted(doc, mark, owner))
                .map(|owner| (owner, mark))
        })
        .collect();
    let wanted: Vec<usize> = owners
        .iter()
        .filter(|(_, mark)| mark.tag == tag && mark.line == line)
        .map(|(owner, _)| *owner)
        .collect();
    let mut lines: Vec<SynctexLine> = Vec::new();
    let mut seen: Vec<usize> = Vec::new();
    for owner in wanted {
        if seen.contains(&owner) || !real(&doc.nodes[owner]) {
            continue;
        }
        seen.push(owner);
        let node = &doc.nodes[owner];
        let ours = |mark: &Mark| mark.tag == tag && mark.line == line;
        // The box's own tag and line belong to the glue TeX adds when it
        // breaks the paragraph, unless that is the line we were asked for.
        let mut marks: Vec<&Mark> = owners
            .iter()
            .filter(|(o, mark)| {
                *o == owner && (ours(mark) || (mark.tag, mark.line) != (node.tag, node.line))
            })
            .map(|(_, mark)| *mark)
            .collect();
        marks.sort_by(|a, b| a.h.total_cmp(&b.h));
        let (Some(first), Some(last)) = (
            marks.iter().position(|mark| ours(mark)),
            marks.iter().rposition(|mark| ours(mark)),
        ) else {
            continue;
        };
        let from = first
            .checked_sub(1)
            .map_or(node.h, |previous| marks[previous].h);
        let to = if marks[last + 1..].iter().any(|mark| !ours(mark)) {
            marks[last].h
        } else {
            node.h + node.width
        };
        let rect = to_rect(node);
        lines.push(SynctexLine {
            page: rect.page,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            from,
            to,
        });
    }
    lines.sort_by(reading_order);
    lines
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

/// The page's outermost box. TeX tags it with the line it was reading when the
/// page shipped out.
fn page_box(doc: &Doc, mut index: usize) -> usize {
    while let Some(parent) = doc.nodes[index].parent {
        index = parent;
    }
    index
}

/// Whether a record inside the line box `owner` names the line its text was
/// read from.
///
/// LuaTeX tags some nodes it makes late (font kerns and the glyphs after them)
/// with the line it is reading when the page ships out: a heading from line 12
/// on a page shipped at line 21 holds `k1,21` and `x1,21`, and in a project
/// with `\input` files that line is in another file. A line box holds nothing
/// read after the line that ended it, and a record that repeats the page box's
/// tag and line without being the line box's own is that shipout line.
fn trusted(doc: &Doc, mark: &Mark, owner: usize) -> bool {
    let node = &doc.nodes[owner];
    if mark.tag == node.tag && mark.line > node.line {
        return false;
    }
    let page = &doc.nodes[page_box(doc, owner)];
    (mark.tag, mark.line) != (page.tag, page.line) || (mark.tag, mark.line) == (node.tag, node.line)
}

fn refine_line(doc: &Doc, chosen: usize, x: f64) -> (i32, i32) {
    let node = &doc.nodes[chosen];
    let marks: Vec<&Mark> = doc
        .marks
        .iter()
        .filter(|mark| {
            doc.inputs.contains_key(&mark.tag)
                && within(doc, mark.parent, chosen)
                && trusted(doc, mark, chosen)
        })
        .collect();
    let solid: Vec<&Mark> = marks.iter().copied().filter(|mark| !mark.current).collect();
    let marks = if solid.is_empty() { marks } else { solid };
    // The glue TeX adds when it breaks a paragraph into lines (the left and
    // right skips, the paragraph fill) carries the line that ended the
    // paragraph, which is also the line box's own. That glue sits at the ends
    // of the typeset line, so the box's own records are dropped there; in the
    // middle they come from words read on that line, as in a display that
    // spans several source lines.
    let own = |mark: &&Mark| mark.tag == node.tag && mark.line == node.line;
    let from_text: Vec<&Mark> = match (
        marks.iter().position(|mark| !own(mark)),
        marks.iter().rposition(|mark| !own(mark)),
    ) {
        (Some(first), Some(last)) => marks[first..=last].to_vec(),
        _ => Vec::new(),
    };
    let pool = if from_text.is_empty() {
        marks
    } else {
        from_text
    };
    // A word's records sit inside it and right after it: the space that
    // follows a word is tagged with the word's line, the one before it with
    // the previous word's. Taking the record left of the click put the first
    // word of every source line on the line above. The last word of a typeset
    // line has nothing after it, so fall back to the record on its left.
    //
    // Math is the exception. TeX spaces a formula when it closes, so that
    // glue carries the box's own line however many source lines the formula
    // took, and only the record before the click still names the line the
    // symbol was typed on.
    let after = pool
        .iter()
        .filter(|mark| mark.h >= x)
        .min_by(|a, b| a.h.total_cmp(&b.h));
    let before = pool
        .iter()
        .rev()
        .filter(|mark| mark.h <= x)
        .max_by(|a, b| a.h.total_cmp(&b.h));
    let chosen = match (after, before) {
        (Some(after), Some(before)) if own(after) && !own(before) => Some(before),
        (Some(after), _) => Some(after),
        (None, before) => before,
    };
    chosen.map_or((node.tag, node.line), |mark| (mark.tag, mark.line))
}

fn line_box(doc: &Doc, mut index: Option<usize>) -> Option<usize> {
    while let Some(current) = index {
        let node = &doc.nodes[current];
        if node.kind == BoxKind::Horizontal && node.width > 0.0 {
            return Some(current);
        }
        index = node.parent;
    }
    None
}

/// The biggest SyncTeX file Oleafly opens. A prose book's is a few
/// megabytes, but pages dense with TikZ, pgfplots or tables run to hundreds;
/// a build folder, or an uploaded build, can come from anyone.
pub const MAX_SYNCTEX_FILE_BYTES: u64 = 256 * 1024 * 1024;
/// The most text Oleafly inflates from it: SyncTeX text compresses about
/// tenfold, while gzip stretches a run of zeros a thousand times over.
pub const MAX_SYNCTEX_TEXT_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GunzipError {
    FileTooLarge,
    TextTooLarge,
    Unreadable(String),
}

impl std::fmt::Display for GunzipError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FileTooLarge => formatter
                .write_str("The SyncTeX file is too large (the file), so Oleafly won't read it."),
            Self::TextTooLarge => formatter
                .write_str("The SyncTeX file is too large (its text), so Oleafly won't read it."),
            Self::Unreadable(reason) => write!(formatter, "failed to gunzip synctex: {reason}"),
        }
    }
}

impl std::error::Error for GunzipError {}

/// A `.synctex.gz` file's text, refused when the file or its text is over
/// the limits. Growing the text by fallible reservations means a stream too
/// big for memory is refused rather than aborting, which in WebAssembly
/// would take the whole module down.
pub fn gunzip(
    bytes: &[u8],
    max_file_bytes: u64,
    max_text_bytes: u64,
) -> Result<String, GunzipError> {
    if bytes.len() as u64 > max_file_bytes {
        return Err(GunzipError::FileTooLarge);
    }
    let mut decoder = GzDecoder::new(bytes);
    let mut text: Vec<u8> = Vec::new();
    let mut chunk = [0_u8; 32 * 1024];
    loop {
        let read = match decoder.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => read,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(GunzipError::Unreadable(error.to_string())),
        };
        let Some(data) = chunk.get(..read) else {
            return Err(GunzipError::Unreadable(
                "the decoder overran its buffer".into(),
            ));
        };
        if (text.len() + data.len()) as u64 > max_text_bytes {
            return Err(GunzipError::TextTooLarge);
        }
        text.try_reserve(data.len())
            .map_err(|_| GunzipError::TextTooLarge)?;
        text.extend_from_slice(data);
    }
    String::from_utf8(text)
        .map_err(|_| GunzipError::Unreadable("stream did not contain valid UTF-8".into()))
}

/// The folders the project sat in on the machine that compiled it, most
/// common first, for `forward` and `inverse` to take as roots.
///
/// SyncTeX names inputs by their path on that machine, so an output built
/// elsewhere names folders the reader doesn't have. An input that ends in
/// `/<a project path>` puts the project in the folder before it. The longest
/// such path decides, so `chapters/intro.tex` names the project folder even
/// when the project also has an `intro.tex`. Inputs that match no project
/// path, such as TeX's own files or a build folder kept elsewhere, add
/// nothing. Equally common folders come shallowest first.
pub fn infer_roots<S: AsRef<str>>(doc: &Doc, project_paths: &[S]) -> Vec<String> {
    let wanted: BTreeSet<String> = project_paths
        .iter()
        .map(|path| {
            normalized_path(path.as_ref())
                .trim_start_matches('/')
                .to_string()
        })
        .filter(|path| !path.is_empty())
        .collect();
    let inputs: BTreeSet<String> = doc
        .inputs
        .values()
        .map(|path| normalized_path(path))
        .collect();
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for path in &inputs {
        let cut = path
            .match_indices('/')
            .map(|(index, _)| index)
            .find(|&index| wanted.contains(&path[index + 1..]));
        if let Some(index) = cut.filter(|&index| index > 0) {
            *counts.entry(&path[..index]).or_default() += 1;
        }
    }
    let mut roots: Vec<(&str, usize)> = counts.into_iter().collect();
    let depth = |root: &str| root.matches('/').count();
    roots.sort_by(|(a, a_count), (b, b_count)| {
        b_count
            .cmp(a_count)
            .then(depth(a).cmp(&depth(b)))
            .then(a.cmp(b))
    });
    roots
        .into_iter()
        .map(|(root, _)| root.to_string())
        .collect()
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
    const WRAPPED: &[u8] = include_bytes!("../tests/fixtures/synctex/wrapped-prose.synctex.gz");
    const WRAPPED_INVERSE: &str =
        include_str!("../tests/fixtures/synctex/wrapped-prose.inverse.tsv");
    const WRAPPED_FORWARD: &str =
        include_str!("../tests/fixtures/synctex/wrapped-prose.forward.tsv");
    const LUALATEX: &[u8] =
        include_bytes!("../tests/fixtures/synctex/lualatex-chapters.synctex.gz");
    const LUALATEX_INVERSE: &str =
        include_str!("../tests/fixtures/synctex/lualatex-chapters.inverse.tsv");
    const LUALATEX_FORWARD: &str =
        include_str!("../tests/fixtures/synctex/lualatex-chapters.forward.tsv");

    fn fixture(gz: &[u8]) -> Doc {
        let mut text = String::new();
        GzDecoder::new(gz).read_to_string(&mut text).unwrap();
        parse(&text)
    }

    fn fixture_roots() -> Vec<String> {
        vec!["/p".to_string()]
    }

    fn click_rows(tsv: &str) -> Vec<(i32, f64, f64, &str, i32)> {
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

    type LineSpots<'a> = (&'a str, i32, Vec<(i32, f64)>);

    fn spot_rows(tsv: &str) -> Vec<LineSpots<'_>> {
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

    /// TeX Live's `synctex edit` takes the record left of the click. For the
    /// first word of a source line that is the space ending the line above,
    /// so there it answers one line early: the record before the click names
    /// its line and the one after names ours.
    fn texlive_takes_the_line_above(
        doc: &Doc,
        (page, x, y): (i32, f64, f64),
        texlive: i32,
        ours: i32,
    ) -> bool {
        let Some(chosen) = pick_box(doc, page, x, y) else {
            return false;
        };
        let solid: Vec<&Mark> = doc
            .marks
            .iter()
            .filter(|mark| within(doc, mark.parent, chosen) && !mark.current)
            .collect();
        let before = solid
            .iter()
            .filter(|mark| mark.h <= x)
            .max_by(|a, b| a.h.total_cmp(&b.h));
        let after = solid
            .iter()
            .filter(|mark| mark.h >= x)
            .min_by(|a, b| a.h.total_cmp(&b.h));
        ours == texlive + 1
            && before.map(|mark| mark.line) == Some(texlive)
            && after.map(|mark| mark.line) == Some(ours)
    }

    #[test]
    fn inverse_search_matches_texlive_on_every_word_of_an_include_book() {
        let doc = fixture(BOOK);
        let roots = fixture_roots();
        let clicks = click_rows(BOOK_INVERSE);
        assert!(clicks.len() > 400);
        let mut first_words = 0;
        for (page, x, y, file, line) in &clicks {
            let hit = inverse(&doc, *page, *x, *y, &roots).expect("a word always hits");
            assert_eq!(hit.file, *file, "click on page {page} at ({x}, {y})");
            if hit.line != *line {
                assert!(
                    texlive_takes_the_line_above(&doc, (*page, *x, *y), *line, hit.line),
                    "click on page {page} at ({x}, {y}) gave line {} for {line}",
                    hit.line
                );
                first_words += 1;
            }
        }
        assert!(
            first_words * 50 <= clicks.len(),
            "{first_words} first words"
        );
    }

    #[test]
    fn inverse_search_stays_within_two_lines_of_texlive_in_an_article() {
        let doc = fixture(ARTICLE);
        let roots = fixture_roots();
        let clicks = click_rows(ARTICLE_INVERSE);
        let mut exact = 0;
        for (page, x, y, file, line) in &clicks {
            let hit = inverse(&doc, *page, *x, *y, &roots).expect("a word always hits");
            assert_eq!(hit.file, *file, "click on page {page} at ({x}, {y})");
            assert!(
                (hit.line - line).abs() <= 2,
                "click on page {page} at ({x}, {y}) gave line {} for {line}",
                hit.line
            );
            exact += usize::from(
                hit.line == *line
                    || texlive_takes_the_line_above(&doc, (*page, *x, *y), *line, hit.line),
            );
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
            for (file, line, spots) in spot_rows(tsv) {
                let (rect, _) = forward(&doc, file, line, &roots).expect("a text line has a box");
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
    fn inverse_search_finds_the_line_each_word_was_typed_on() {
        for (gz, tsv, least) in [
            (WRAPPED, WRAPPED_INVERSE, 549),
            (LUALATEX, LUALATEX_INVERSE, 373),
        ] {
            let doc = fixture(gz);
            let roots = fixture_roots();
            let clicks = click_rows(tsv);
            let mut exact = 0;
            for (page, x, y, file, line) in &clicks {
                let hit = inverse(&doc, *page, *x, *y, &roots).expect("a word always hits");
                assert_eq!(hit.file, *file, "click on page {page} at ({x}, {y})");
                assert!(
                    (hit.line - line).abs() <= 1,
                    "click on page {page} at ({x}, {y}) gave line {} for {line}",
                    hit.line
                );
                exact += usize::from(hit.line == *line);
            }
            assert!(exact >= least, "{exact} of {} exact", clicks.len());
        }
    }

    #[test]
    fn forward_search_offers_the_typeset_line_of_every_word() {
        for (gz, tsv) in [(WRAPPED, WRAPPED_FORWARD), (LUALATEX, LUALATEX_FORWARD)] {
            let doc = fixture(gz);
            let roots = fixture_roots();
            for (file, line, spots) in spot_rows(tsv) {
                let hit = forward_hit(&doc, file, line, &roots).expect("a text line has a box");
                for (page, y) in spots {
                    assert!(
                        hit.lines.iter().any(|typeset| {
                            typeset.page == page
                                && y >= typeset.y - 1.0
                                && y <= typeset.y + typeset.height + 1.0
                        }),
                        "{file}:{line} offers no typeset line at page {page}, {y}"
                    );
                }
            }
        }
    }

    const FIRST_WORD: &str = "SyncTeX Version:1\n\
Input:1:/p/main.tex\n\
Content:\n\
{1\n\
[1,4:0,52625288:39468966,52625288,0\n\
(1,9:6578176,6578176:32890880,657818,0\n\
g1,7:9867264,6578176\n\
g1,8:13156352,6578176\n\
x1,7:16445440,6578176\n\
g1,8:16445440,6578176\n\
g1,9:39469056,6578176\n\
)\n\
]\n\
}1\n";

    #[test]
    fn a_click_on_the_first_word_of_a_source_line_resolves_to_that_line() {
        let doc = parse(FIRST_WORD);
        let roots = fixture_roots();
        let at = |x: f64| inverse(&doc, 1, x, 95.0, &roots).unwrap().line;
        assert_eq!(at(125.0), 7);
        assert_eq!(at(175.0), 8);
    }

    #[test]
    fn current_point_records_never_decide_the_line() {
        let doc = parse(FIRST_WORD);
        let roots = fixture_roots();
        assert_eq!(inverse(&doc, 1, 225.0, 95.0, &roots).unwrap().line, 8);
    }

    // LuaTeX tags late kerns with the line it read when the page shipped out:
    // chapter.tex:21 here. The heading is main.tex:12; the paragraph line box
    // ended on line 30 and still holds a kern tagged 31.
    const SHIPOUT: &str = "SyncTeX Version:1\n\
Input:1:/p/main.tex\n\
Input:2:/p/chapter.tex\n\
Content:\n\
{1\n\
[2,21:0,52625288:39468966,52625288,0\n\
(1,12:6578176,6578176:32890880,657818,0\n\
g1,12:7894000,6578176\n\
k2,21:9867264,6578176:65536\n\
x2,21:11000000,6578176\n\
g1,12:13156352,6578176\n\
)\n\
(1,30:6578176,13156352:32890880,657818,0\n\
g1,28:7894000,13156352\n\
k1,31:9867264,13156352:65536\n\
g1,29:13156352,13156352\n\
)\n\
]\n\
}1\n";

    #[test]
    fn lines_recorded_at_shipout_are_not_taken_for_the_text() {
        let doc = parse(SHIPOUT);
        let roots = fixture_roots();
        let heading = inverse(&doc, 1, 160.0, 95.0, &roots).unwrap();
        assert_eq!((heading.file.as_str(), heading.line), ("main.tex", 12));
        assert_eq!(inverse(&doc, 1, 160.0, 195.0, &roots).unwrap().line, 29);
    }

    const DISPLAY: &str = "SyncTeX Version:1\n\
Input:1:/p/main.tex\n\
Content:\n\
{1\n\
[1,4:0,52625288:39468966,52625288,0\n\
(1,34:6578176,6578176:32890880,657818,0\n\
(1,31:6578176,6578176:986726,657818,0\n\
k1,31:7236000,6578176:65536\n\
)\n\
g1,34:8551629,6578176\n\
(1,32:9867264,6578176:986726,657818,0\n\
k1,32:10525000,6578176:65536\n\
)\n\
g1,34:11840717,6578176\n\
)\n\
]\n\
}1\n";

    #[test]
    fn a_formula_s_spacing_does_not_pull_clicks_to_the_line_that_closed_it() {
        let doc = parse(DISPLAY);
        let roots = fixture_roots();
        let at = |x: f64| inverse(&doc, 1, x, 95.0, &roots).unwrap().line;
        assert_eq!(at(120.0), 31);
        assert_eq!(at(170.0), 32);
    }

    const PARAGRAPH_LINE: &str = "SyncTeX Version:1\n\
Input:1:/p/main.tex\n\
Content:\n\
{1\n\
[1,4:0,52625288:39468966,52625288,0\n\
(1,9:6578176,9209000:32890880,657818,0\n\
g1,5:9867264,9209000\n\
g1,8:13156352,9209000\n\
)\n\
(1,9:6578176,6578176:32890880,657818,0\n\
g1,5:9867264,6578176\n\
g1,5:13156352,6578176\n\
)\n\
(1,9:6578176,7894000:32890880,657818,0\n\
g1,5:9867264,7894000\n\
)\n\
]\n\
}1\n";

    #[test]
    fn forward_search_offers_every_typeset_line_of_a_source_line_in_reading_order() {
        let doc = parse(PARAGRAPH_LINE);
        let roots = fixture_roots();
        let hit = forward_hit(&doc, "main.tex", 5, &roots).unwrap();
        let tops: Vec<i64> = hit.lines.iter().map(|line| line.y.round() as i64).collect();
        assert_eq!(tops, [90, 110, 130]);
        assert_eq!(hit.rect.y.round() as i64, 90);
        let (first, last) = (hit.lines[0], hit.lines[2]);
        assert_eq!(
            (first.from.round() as i64, first.to.round() as i64),
            (100, 600)
        );
        assert_eq!(
            (last.from.round() as i64, last.to.round() as i64),
            (100, 150)
        );
    }

    // Line 7 holds only a paragraph's last word, whose space TeX dropped, so
    // it has no record; lines 6 and 8 around it have text.
    const SILENT_LINE: &str = "SyncTeX Version:1\n\
Input:1:/p/main.tex\n\
Content:\n\
{1\n\
[1,4:0,52625288:39468966,52625288,0\n\
(1,9:6578176,6578176:32890880,657818,0\n\
g1,6:9867264,6578176\n\
g1,6:13156352,6578176\n\
)\n\
(1,9:6578176,7894000:32890880,657818,0\n\
g1,6:9867264,7894000\n\
)\n\
(1,12:6578176,10525000:32890880,657818,0\n\
g1,8:9867264,10525000\n\
)\n\
]\n\
}1\n";

    #[test]
    fn a_source_line_without_records_offers_the_typeset_lines_around_it() {
        let doc = parse(SILENT_LINE);
        let roots = fixture_roots();
        let hit = forward_hit(&doc, "main.tex", 7, &roots).unwrap();
        assert_eq!(hit.lines.len(), 3);
        assert_eq!(hit.rect.y.round() as i64, 110);
    }

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
        let (rect, _) = forward(&doc, "chapter.tex", 8, &roots).unwrap();
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

    #[test]
    fn the_limits_leave_room_for_a_large_book() {
        // A TikZ-heavy thesis passes 128 MiB of SyncTeX text, which 0.4.7
        // read without a limit.
        let limits = [MAX_SYNCTEX_FILE_BYTES, MAX_SYNCTEX_TEXT_BYTES];
        assert!(limits[0] >= 256 * 1024 * 1024);
        assert!(limits[1] >= 1024 * 1024 * 1024);
    }

    #[test]
    fn gunzip_unzips_text_within_the_limits() {
        let text = gunzip(
            &gzip(b"SyncTeX Version:1\n"),
            MAX_SYNCTEX_FILE_BYTES,
            MAX_SYNCTEX_TEXT_BYTES,
        );
        assert_eq!(text.unwrap(), "SyncTeX Version:1\n");
    }

    #[test]
    fn gunzip_stops_at_a_gzip_bomb_and_an_oversized_file() {
        let bomb = gzip(&vec![0_u8; 1 << 20]);
        assert!(bomb.len() < 64 * 1024, "{}", bomb.len());
        let error = gunzip(&bomb, 1 << 20, 64 * 1024).unwrap_err();
        assert_eq!(error, GunzipError::TextTooLarge);
        assert!(error.to_string().contains("its text"), "{error}");
        assert_eq!(gunzip(&bomb, 1 << 20, 1 << 20).unwrap().len(), 1 << 20);
        let error = gunzip(&bomb, 1024, 1 << 30).unwrap_err();
        assert_eq!(error, GunzipError::FileTooLarge);
        assert!(error.to_string().contains("the file"), "{error}");
    }

    #[test]
    fn gunzip_refuses_what_is_not_gzipped_text() {
        let limits = (MAX_SYNCTEX_FILE_BYTES, MAX_SYNCTEX_TEXT_BYTES);
        for bytes in [
            b"SyncTeX Version:1\n".to_vec(),
            gzip(&[0xff, 0xfe, 0x00]),
            gzip(b"SyncTeX Version:1\n")[..12].to_vec(),
            Vec::new(),
        ] {
            let error = gunzip(&bytes, limits.0, limits.1).unwrap_err();
            assert!(
                matches!(error, GunzipError::Unreadable(_)),
                "{bytes:?} gave {error:?}"
            );
        }
    }

    fn inputs(paths: &[&str]) -> Doc {
        let mut text = String::from("SyncTeX Version:1\n");
        for (tag, path) in paths.iter().enumerate() {
            text.push_str(&format!("Input:{}:{path}\n", tag + 1));
        }
        parse(&text)
    }

    #[test]
    fn inferred_roots_name_the_folder_the_project_was_compiled_in() {
        let project = ["main.tex", "chapters/intro.tex"];
        let unix = inputs(&[
            "/home/ana/thesis/./main.tex",
            "/home/ana/thesis/chapters/intro.tex",
            "/usr/share/texmf/tex/latex/base/article.cls",
        ]);
        assert_eq!(infer_roots(&unix, &project), ["/home/ana/thesis"]);
        let windows = inputs(&[
            "C:\\Users\\Ana\\Thesis\\main.tex",
            "C:\\Users\\Ana\\Thesis\\chapters\\intro.tex",
        ]);
        assert_eq!(infer_roots(&windows, &project), ["C:/Users/Ana/Thesis"]);
    }

    #[test]
    fn inferred_roots_take_the_longest_project_path_an_input_ends_in() {
        let doc = inputs(&["/w/book/chapters/intro.tex"]);
        let project = ["intro.tex", "chapters/intro.tex", "/main.tex"];
        assert_eq!(infer_roots(&doc, &project), ["/w/book"]);
    }

    #[test]
    fn inferred_roots_are_empty_when_no_input_ends_in_a_project_path() {
        let doc = inputs(&["/w/book/main.tex", "main.tex", "/other.tex"]);
        assert!(infer_roots(&doc, &["notes.tex"]).is_empty());
        assert!(infer_roots::<&str>(&doc, &[]).is_empty());
        assert!(infer_roots(&doc, &["other.tex"]).is_empty());
    }

    #[test]
    fn inferred_roots_put_the_most_common_first_and_ties_shallowest_first() {
        let doc = inputs(&[
            "/b/deep/main.tex",
            "/a/x.tex",
            "/a/y.tex",
            "/c/main.tex",
            "/b/deep/x.tex",
            "/b/deep/y.tex",
        ]);
        let project = ["main.tex", "x.tex", "y.tex"];
        assert_eq!(infer_roots(&doc, &project), ["/b/deep", "/a", "/c"]);
        let tied = inputs(&["/z/deep/main.tex", "/y/main.tex", "/x/main.tex"]);
        assert_eq!(infer_roots(&tied, &["main.tex"]), ["/x", "/y", "/z/deep"]);
    }

    #[test]
    fn an_input_spelled_with_other_case_is_found_when_no_exact_match_exists() {
        let doc = inputs(&[
            "/p/main.tex",
            "/p/Chapters/Intro.tex",
            "/p/Notes/Same.tex",
            "/p/notes/same.tex",
            "/p/Parts/X/One.tex",
            "/p/parts/y/one.tex",
        ]);
        let roots = vec!["/p".to_string()];
        assert_eq!(tag_for_file(&doc, "chapters/intro.tex", &roots), Some(2));
        assert_eq!(tag_for_file(&doc, "CHAPTERS/INTRO.TEX", &[]), Some(2));
        assert_eq!(tag_for_file(&doc, "intro.tex", &roots), Some(2));
        assert_eq!(tag_for_file(&doc, "notes/same.tex", &roots), Some(4));
        assert_eq!(tag_for_file(&doc, "Notes/Same.tex", &roots), Some(3));
        assert_eq!(tag_for_file(&doc, "NOTES/SAME.TEX", &roots), None);
        assert_eq!(tag_for_file(&doc, "parts/x/one.tex", &roots), Some(5));
        assert_eq!(tag_for_file(&doc, "one.tex", &roots), Some(6));
        assert_eq!(tag_for_file(&doc, "ONE.TEX", &roots), None);
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn a_root_spelled_with_other_case_still_names_the_project_on_case_insensitive_disks() {
        let doc = inputs(&["/Users/Ana/Thesis/Chapters/Intro.tex"]);
        let roots = vec!["/Users/ana/thesis".to_string()];
        assert_eq!(tag_for_file(&doc, "Chapters/Intro.tex", &roots), Some(1));
        assert_eq!(
            project_relative("/Users/Ana/Thesis/Chapters/Intro.tex", &roots).as_deref(),
            Some("Chapters/Intro.tex")
        );
        assert_eq!(project_relative("/Users/Ana/Other/a.tex", &roots), None);
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    #[test]
    fn a_root_spelled_with_other_case_is_another_folder_on_case_sensitive_disks() {
        let roots = vec!["/home/ana/thesis".to_string()];
        assert_eq!(project_relative("/home/Ana/Thesis/main.tex", &roots), None);
    }

    #[test]
    fn a_file_outside_the_inferred_root_keeps_its_full_path() {
        let doc = parse(
            "SyncTeX Version:1\n\
Input:1:/data/build/_oleafly_entry.tex\n\
Input:2:/home/ana/thesis/main.tex\n\
Content:\n\
{1\n\
[1,3:4736286,4736286:22609920,655360,0\n\
[2,7:4736286,9736286:22609920,655360,0\n\
}1\n",
        );
        let roots = infer_roots(&doc, &["main.tex"]);
        assert_eq!(roots, ["/home/ana/thesis"]);
        let at = |y: f64| inverse(&doc, 1, 100.0, y, &roots).unwrap().file;
        assert_eq!(
            at(4_736_286.0 * SP_TO_BP - 5.0),
            "/data/build/_oleafly_entry.tex"
        );
        assert_eq!(at(9_736_286.0 * SP_TO_BP - 5.0), "main.tex");
        assert_eq!(tag_for_file(&doc, "main.tex", &roots), Some(2));
    }

    #[test]
    fn an_output_built_on_another_machine_searches_like_one_built_here() {
        let mut text = String::new();
        GzDecoder::new(BOOK).read_to_string(&mut text).unwrap();
        let elsewhere = parse(&text.replace(":/p/", ":D:\\Users\\Ana Lucía\\Book\\"));
        let here = parse(&text);
        let project = [
            "main.tex",
            "chapters/intro.tex",
            "chapters/methods.tex",
            "chapters/results.tex",
        ];
        let inferred = infer_roots(&elsewhere, &project);
        assert_eq!(inferred, ["D:/Users/Ana Lucía/Book"]);
        let roots = fixture_roots();
        for (page, x, y, _, _) in click_rows(BOOK_INVERSE) {
            assert_eq!(
                inverse(&elsewhere, page, x, y, &inferred),
                inverse(&here, page, x, y, &roots),
                "click on page {page} at ({x}, {y})"
            );
        }
        for (file, line, _) in spot_rows(BOOK_FORWARD) {
            assert_eq!(
                forward_hit(&elsewhere, file, line, &inferred),
                forward_hit(&here, file, line, &roots),
                "{file}:{line}"
            );
        }
    }
}
