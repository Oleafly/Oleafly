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
}
