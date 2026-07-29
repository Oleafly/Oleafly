use flate2::read::GzDecoder;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use crate::paths;

/// TeX scaled points → PDF points (big points / bp).
const SP_TO_BP: f64 = 1.0 / 65781.76;

#[derive(Default)]
struct Doc {
    /// synctex tag → input file path.
    inputs: HashMap<i32, String>,
    nodes: Vec<Node>,
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

fn map_source_line(
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

fn read_synctex_text(project_id: &str, _main_doc: &str) -> Result<String, String> {
    let build = paths::build_dir(project_id)?;
    // Compiles run through the `_oleafly_entry` wrapper, so the synctex file
    // is named after it.
    let path = build.join(format!("{}.synctex.gz", paths::ENTRY_STEM));
    let bytes =
        std::fs::read(&path).map_err(|e| format!("failed to read synctex {path:?}: {e}"))?;
    let mut decoder = GzDecoder::new(&bytes[..]);
    let mut text = String::new();
    decoder
        .read_to_string(&mut text)
        .map_err(|e| format!("failed to gunzip synctex: {e}"))?;
    Ok(text)
}

fn parse(text: &str) -> Doc {
    let mut doc = Doc::default();
    let mut page = 0i32;

    for raw in text.lines() {
        let line = raw.trim_end();
        if line.is_empty() {
            continue;
        }
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
        } else if let Some(rest) = line.strip_prefix('{') {
            // {<page> opens a page block.
            page = rest.trim().parse().unwrap_or(0);
        } else if line.starts_with('[') || line.starts_with('(') {
            if let Some(node) = parse_box(line, page) {
                doc.nodes.push(node);
            }
        }
        // Compact node forms we ignore for now: 'v'/'h' void, 'k' kern, 'g' glue, '$' math.
    }
    doc
}

/// Parse a compact box line: `[tag,line:h,v:width,height,depth` (vbox) or
/// `(tag,line:h,v:width,height,depth` (hbox).
fn parse_box(line: &str, page: i32) -> Option<Node> {
    let rest = &line[1..]; // drop leading [ or (
    let (head, tail) = rest.split_once(':')?;

    let mut head = head.split(',');
    let tag: i32 = head.next()?.parse().ok()?;
    let line_no: i32 = head.next()?.parse().ok()?;

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
    })
}

/// Resolve a synctex tag for a file. Tries exact basename first, then a
/// path-suffix match (handles "sections/intro.tex" against absolute paths).
fn tag_for_file(doc: &Doc, file: &str) -> Option<i32> {
    let want = Path::new(file)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(file);
    if let Some((t, _)) = doc
        .inputs
        .iter()
        .find(|(_, p)| Path::new(p).file_name().and_then(|s| s.to_str()) == Some(want))
    {
        return Some(*t);
    }
    let want_norm = file.replace('\\', "/");
    doc.inputs
        .iter()
        .find(|(_, p)| {
            let p_norm = p.replace('\\', "/");
            p_norm == want_norm || p_norm.ends_with(&want_norm)
        })
        .map(|(t, _)| *t)
}

/// Forward search: (file, line) → tightest box on its page. Returns a rect in
/// PDF bp with origin at the page's top-left (y grows downward).
fn forward(doc: &Doc, file: &str, line: i32) -> Option<SynctexRect> {
    let tag = tag_for_file(doc, file)?;
    let real = |n: &Node| n.height + n.depth >= 4.0 && n.width >= 5.0;

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

/// Inverse search: (page, x, y) in bp → nearest node → (file, line).
fn inverse(doc: &Doc, page: i32, x: f64, y: f64) -> Option<SynctexHit> {
    let best = doc.nodes.iter().filter(|n| n.page == page).min_by(|a, b| {
        let da = dist(a, x, y);
        let db = dist(b, x, y);
        da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
    })?;
    let file = doc
        .inputs
        .get(&best.tag)
        .and_then(|p| {
            Path::new(p)
                .file_name()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_default();
    Some(SynctexHit {
        file,
        line: best.line,
        column: 0,
    })
}

fn dist(n: &Node, x: f64, y: f64) -> f64 {
    // Distance to the box center.
    let cx = n.h + n.width / 2.0;
    let cy = n.v + (n.depth - n.height) / 2.0;
    (cx - x).hypot(cy - y)
}

#[tauri::command]
pub async fn synctex_forward(
    project_id: String,
    main_doc: String,
    file: String,
    line: i32,
) -> Result<Option<SynctexRect>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<SynctexRect>, String> {
        let text = read_synctex_text(&project_id, &main_doc)?;
        let doc = parse(&text);
        Ok(forward(&doc, &file, line))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn synctex_inverse(
    project_id: String,
    main_doc: String,
    page: i32,
    x: f64,
    y: f64,
) -> Result<Option<SynctexHit>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<SynctexHit>, String> {
        let text = read_synctex_text(&project_id, &main_doc)?;
        let doc = parse(&text);
        Ok(inverse(&doc, page, x, y))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn synctex_map_line(
    compiled_source: String,
    current_source: String,
    line: usize,
    current_to_compiled: bool,
) -> Result<Option<usize>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        map_source_line(&compiled_source, &current_source, line, current_to_compiled)
            .map(|mapped| mapped.line)
    })
    .await
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // The fixture is a real compile artifact of the default project. It only
    // exists after the app (or a manual Tectonic run) has compiled that project,
    // so it is absent in CI and fresh checkouts. Return None there and let the
    // test skip rather than fail on missing state.
    fn load_default() -> Option<String> {
        let home = std::env::var_os("HOME")?;
        let p = std::path::PathBuf::from(home)
            .join(".oleafly/projects/default/.oleafly/build/_oleafly_entry.synctex.gz");
        let bytes = std::fs::read(&p).ok()?;
        let mut dec = GzDecoder::new(&bytes[..]);
        let mut s = String::new();
        dec.read_to_string(&mut s).ok()?;
        Some(s)
    }

    #[test]
    fn forward_then_inverse_round_trips() {
        let Some(text) = load_default() else {
            eprintln!("skipping: no compiled default-project synctex fixture present");
            return;
        };
        let doc = parse(&text);
        let tag = tag_for_file(&doc, "main.tex").expect("main.tex has a synctex tag");
        let node = doc
            .nodes
            .iter()
            .find(|n| n.tag == tag && n.line > 0)
            .expect("a main.tex node exists");
        let line = node.line;

        let rect = forward(&doc, "main.tex", line).expect("forward should resolve a known line");
        assert!(rect.page >= 1, "page should be >= 1");
        // A box at the very top margin can sit a hair above the reference point,
        // so allow a small negative y rather than requiring y >= 0.
        assert!(
            rect.y > -5.0 && rect.y < 2000.0,
            "y={} out of range",
            rect.y
        );
        assert!(rect.width > 0.0);

        // Inverse at the box center must round-trip to the same source line.
        let cx = rect.x + rect.width / 2.0;
        let cy = rect.y + rect.height / 2.0;
        let hit = inverse(&doc, rect.page, cx, cy).expect("inverse should hit");
        assert_eq!(hit.file, "main.tex");
        assert_eq!(hit.line, line, "inverse should round-trip to line {line}");
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
}
