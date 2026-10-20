//! PDF facts for the submission rules, read with lopdf the way the app reads
//! them with pdf.js (`packages/preflight/src/pdf-extract.ts`): page view
//! boxes and rotation, outline items, links, form fields, attachments,
//! encryption, the author, creator and producer, and the fonts text uses.

use std::collections::{HashSet, VecDeque};
use std::fmt;
use std::sync::LazyLock;

use lopdf::content::Content;
use lopdf::{Dictionary, Document, Object, ObjectId};

use crate::jsre::JsRegex;
use crate::text::js_trim;
use crate::types::{FontFact, PdfFacts, PdfPageFacts};

/// Larger PDFs are not read.
pub const MAX_PDF_BYTES: u64 = 256 * 1024 * 1024;

const LETTER_SIZE: [f64; 4] = [0.0, 0.0, 612.0, 792.0];
const MAX_DEPTH: usize = 64;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PdfFactsError {
    TooLarge { bytes: u64 },
    Unreadable(String),
}

impl fmt::Display for PdfFactsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooLarge { bytes } => write!(
                f,
                "the PDF is {bytes} bytes, more than the {MAX_PDF_BYTES} bytes oleafly reads"
            ),
            Self::Unreadable(reason) => f.write_str(reason),
        }
    }
}

impl std::error::Error for PdfFactsError {}

static HEADER_VERSION: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"%PDF-([0-9]+\.[0-9]+)"));

/// `%PDF-x.y` in the first 16 bytes, the way the app reads the header.
fn header_version(bytes: &[u8]) -> Option<String> {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(16)]).into_owned();
    HEADER_VERSION
        .first_str(&head)
        .and_then(|found| found.group(&head, 1).map(str::to_string))
}

/// Whether the file declares an encryption dictionary. Read from the bytes
/// because a reader that decrypts on load may drop the trailer entry.
fn declares_encryption(bytes: &[u8]) -> bool {
    const KEY: &[u8] = b"/Encrypt";
    bytes.windows(KEY.len()).enumerate().any(|(index, window)| {
        window == KEY
            && bytes
                .get(index + KEY.len())
                .is_none_or(|next| !next.is_ascii_alphanumeric())
    })
}

fn widen<T: Into<f64>>(value: T) -> f64 {
    value.into()
}

fn deref<'a>(doc: &'a Document, object: &'a Object) -> Option<&'a Object> {
    match object {
        Object::Reference(id) => doc.get_object(*id).ok(),
        other => Some(other),
    }
}

fn number(doc: &Document, object: &Object) -> Option<f64> {
    match deref(doc, object)? {
        Object::Integer(value) => Some(*value as f64),
        Object::Real(value) => Some(widen(*value)),
        _ => None,
    }
}

fn dict<'a>(doc: &'a Document, object: &'a Object) -> Option<&'a Dictionary> {
    match deref(doc, object)? {
        Object::Dictionary(dict) => Some(dict),
        Object::Stream(stream) => Some(&stream.dict),
        _ => None,
    }
}

fn get<'a>(doc: &'a Document, dict: &'a Dictionary, key: &[u8]) -> Option<&'a Object> {
    dict.get(key).ok().and_then(|object| deref(doc, object))
}

fn name<'a>(doc: &'a Document, dict: &'a Dictionary, key: &[u8]) -> Option<&'a [u8]> {
    match get(doc, dict, key)? {
        Object::Name(name) => Some(name.as_slice()),
        _ => None,
    }
}

/// `stringToPDFString`: UTF-16 with a byte order mark, UTF-8 with one, or
/// PDFDocEncoding.
fn pdf_text(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        let units: Vec<u16> = rest
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u16::from_be_bytes(*pair))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        let units: Vec<u16> = rest
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u16::from_le_bytes(*pair))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    bytes.iter().map(|&byte| pdf_doc_char(byte)).collect()
}

fn pdf_doc_char(byte: u8) -> char {
    const LOW: [u32; 8] = [0x2d8, 0x2c7, 0x2c6, 0x2d9, 0x2dd, 0x2db, 0x2da, 0x2dc];
    const HIGH: [u32; 33] = [
        0x2022, 0x2020, 0x2021, 0x2026, 0x2014, 0x2013, 0x192, 0x2044, 0x2039, 0x203a, 0x2212,
        0x2030, 0x201e, 0x201c, 0x201d, 0x2018, 0x2019, 0x201a, 0x2122, 0xfb01, 0xfb02, 0x141,
        0x152, 0x160, 0x178, 0x17d, 0x131, 0x142, 0x153, 0x161, 0x17e, 0, 0x20ac,
    ];
    let mapped = match byte {
        0x18..=0x1f => LOW[usize::from(byte - 0x18)],
        0x80..=0xa0 => HIGH[usize::from(byte - 0x80)],
        _ => 0,
    };
    if mapped == 0 {
        char::from(byte)
    } else {
        char::from_u32(mapped).unwrap_or(char::from(byte))
    }
}

/// An inheritable page attribute: the page's own value, else the nearest
/// ancestor's.
fn inherited<'a>(doc: &'a Document, page: &'a Dictionary, key: &[u8]) -> Option<&'a Object> {
    let mut node = page;
    for _ in 0..MAX_DEPTH {
        if let Some(value) = get(doc, node, key) {
            return Some(value);
        }
        node = get(doc, node, b"Parent").and_then(|parent| dict(doc, parent))?;
    }
    None
}

fn normal_rect(doc: &Document, object: &Object) -> Option<[f64; 4]> {
    let Object::Array(items) = deref(doc, object)? else {
        return None;
    };
    if items.len() != 4 {
        return None;
    }
    let mut values = [0.0; 4];
    for (slot, item) in values.iter_mut().zip(items) {
        *slot = number(doc, item)?;
    }
    Some([
        values[0].min(values[2]),
        values[1].min(values[3]),
        values[0].max(values[2]),
        values[1].max(values[3]),
    ])
}

fn bounding_box(doc: &Document, page: &Dictionary, key: &[u8]) -> Option<[f64; 4]> {
    let rect = normal_rect(doc, inherited(doc, page, key)?)?;
    (rect[2] - rect[0] > 0.0 && rect[3] - rect[1] > 0.0).then_some(rect)
}

fn intersect(a: [f64; 4], b: [f64; 4]) -> Option<[f64; 4]> {
    let x_low = a[0].min(a[2]).max(b[0].min(b[2]));
    let x_high = a[0].max(a[2]).min(b[0].max(b[2]));
    let y_low = a[1].min(a[3]).max(b[1].min(b[3]));
    let y_high = a[1].max(a[3]).min(b[1].max(b[3]));
    (x_low <= x_high && y_low <= y_high).then_some([x_low, y_low, x_high, y_high])
}

/// pdf.js `Page.view`: the crop box clipped to the media box.
fn page_view(doc: &Document, page: &Dictionary) -> [f64; 4] {
    let media = bounding_box(doc, page, b"MediaBox").unwrap_or(LETTER_SIZE);
    let crop = bounding_box(doc, page, b"CropBox").unwrap_or(media);
    if crop != media {
        if let Some(view) = intersect(crop, media) {
            if view[2] - view[0] > 0.0 && view[3] - view[1] > 0.0 {
                return view;
            }
        }
    }
    media
}

/// pdf.js `Page.rotate`: a multiple of 90 normalised to 0–270, else 0.
fn page_rotation(doc: &Document, page: &Dictionary) -> i32 {
    let rotate = inherited(doc, page, b"Rotate")
        .and_then(|value| number(doc, value))
        .unwrap_or(0.0);
    if rotate % 90.0 != 0.0 {
        return 0;
    }
    let normalized = if rotate >= 360.0 {
        rotate % 360.0
    } else if rotate < 0.0 {
        ((rotate % 360.0) + 360.0) % 360.0
    } else {
        rotate
    };
    normalized as i32
}

fn page_facts(doc: &Document, page: &Dictionary) -> PdfPageFacts {
    let view = page_view(doc, page);
    let rotation = page_rotation(doc, page);
    let (width, height) = (view[2] - view[0], view[3] - view[1]);
    if rotation % 180 == 0 {
        PdfPageFacts {
            width,
            height,
            rotation,
        }
    } else {
        PdfPageFacts {
            width: height,
            height: width,
            rotation,
        }
    }
}

/// Counts outline items breadth first; an item that is not a dictionary
/// makes pdf.js give up, which the app reports as no outline.
fn outline_count(doc: &Document) -> u32 {
    let Some(catalog) = doc.catalog().ok() else {
        return 0;
    };
    let Some(outlines) = get(doc, catalog, b"Outlines").and_then(|object| dict(doc, object)) else {
        return 0;
    };
    let Ok(Object::Reference(first)) = outlines.get(b"First") else {
        return 0;
    };
    let mut processed: HashSet<ObjectId> = HashSet::from([*first]);
    let mut queue: VecDeque<ObjectId> = VecDeque::from([*first]);
    let mut count = 0u32;
    while let Some(id) = queue.pop_front() {
        let Ok(object) = doc.get_object(id) else {
            continue;
        };
        let Object::Dictionary(item) = object else {
            return 0;
        };
        count += 1;
        for key in [b"First".as_slice(), b"Next".as_slice()] {
            if let Ok(Object::Reference(next)) = item.get(key) {
                if processed.insert(*next) {
                    queue.push_back(*next);
                }
            }
        }
    }
    count
}

/// Hidden (2) and NoView (32) annotations are not displayed.
fn annotation_displayed(doc: &Document, annotation: &Dictionary) -> bool {
    let flags = get(doc, annotation, b"F")
        .and_then(|value| number(doc, value))
        .unwrap_or(0.0) as i64;
    flags & (2 | 32) == 0
}

fn annotation_counts(doc: &Document, page: &Dictionary) -> (u32, u32) {
    let Some(Object::Array(annotations)) = get(doc, page, b"Annots") else {
        return (0, 0);
    };
    let mut links = 0;
    let mut widgets = 0;
    for annotation in annotations {
        let Some(annotation) = dict(doc, annotation) else {
            continue;
        };
        if !annotation_displayed(doc, annotation) {
            continue;
        }
        match name(doc, annotation, b"Subtype") {
            Some(b"Link") => links += 1,
            Some(b"Widget") => widgets += 1,
            _ => {}
        }
    }
    (links, widgets)
}

/// Distinct names in the `/Names /EmbeddedFiles` tree. A kid that appears
/// twice makes pdf.js reject the tree, which the app reports as none.
fn attachment_count(doc: &Document) -> u32 {
    let Some(catalog) = doc.catalog().ok() else {
        return 0;
    };
    let Some(names) = get(doc, catalog, b"Names").and_then(|object| dict(doc, object)) else {
        return 0;
    };
    let Ok(root) = names.get(b"EmbeddedFiles") else {
        return 0;
    };
    let mut processed: HashSet<ObjectId> = HashSet::new();
    if let Object::Reference(id) = root {
        processed.insert(*id);
    }
    let mut queue: VecDeque<&Object> = VecDeque::from([root]);
    let mut keys: HashSet<String> = HashSet::new();
    while let Some(node) = queue.pop_front() {
        let Some(node) = dict(doc, node) else {
            continue;
        };
        if let Ok(kids) = node.get(b"Kids") {
            let Some(Object::Array(kids)) = deref(doc, kids) else {
                continue;
            };
            for kid in kids {
                if let Object::Reference(id) = kid {
                    if !processed.insert(*id) {
                        return 0;
                    }
                }
                queue.push_back(kid);
            }
            continue;
        }
        let Some(Object::Array(entries)) = get(doc, node, b"Names") else {
            continue;
        };
        for pair in entries.chunks(2) {
            if let Some(Object::String(key, _)) = deref(doc, &pair[0]) {
                keys.insert(pdf_text(key));
            }
        }
    }
    keys.len() as u32
}

fn info_string(doc: &Document, info: Option<&Dictionary>, key: &[u8]) -> Option<String> {
    let Some(Object::String(bytes, _)) = get(doc, info?, key) else {
        return None;
    };
    let text = pdf_text(bytes);
    let trimmed = js_trim(&text);
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

static XMP_CREATOR: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?is)<dc:creator(?:\s[^>]*)?>(.*?)</dc:creator\s*>"));
static XMP_SEQUENCE: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(r"(?is)^\s*<rdf:(?:seq|bag|alt)(?:\s[^>]*)?>(.*?)</rdf:(?:seq|bag|alt)\s*>")
});
static XMP_ITEM: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?is)<rdf:li(?:\s[^>]*)?>(.*?)</rdf:li\s*>"));
static XML_TAG: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"<[^>]*>"));

fn decode_xml_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        let tail = &rest[start..];
        let Some(end) = tail.find(';').filter(|&end| end <= 10) else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let entity = &tail[1..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .or_else(|| {
                    entity
                        .strip_prefix('#')
                        .and_then(|decimal| decimal.parse().ok())
                })
                .and_then(char::from_u32),
        };
        match decoded {
            Some(ch) => {
                out.push(ch);
                rest = &tail[end + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// `dc:creator` from the XMP packet: the items of its sequence, joined.
fn xmp_creator(doc: &Document) -> Option<String> {
    let catalog = doc.catalog().ok()?;
    let Object::Stream(stream) = get(doc, catalog, b"Metadata")? else {
        return None;
    };
    let bytes = stream
        .decompressed_content()
        .unwrap_or_else(|_| stream.content.clone());
    let xml = String::from_utf8_lossy(&bytes).into_owned();
    let creator = XMP_CREATOR.first_str(&xml)?;
    let body = creator.group(&xml, 1)?;
    let sequence = XMP_SEQUENCE.first_str(body)?;
    let items = sequence.group(body, 1)?;
    let names: Vec<String> =
        XMP_ITEM
            .captures_str(items)
            .0
            .iter()
            .filter_map(|item| item.group(items, 1))
            .map(|item| {
                let without_tags = XML_TAG.captures_str(item).0.iter().rev().fold(
                    item.to_string(),
                    |mut out, tag| {
                        out.replace_range(tag.start..tag.end, "");
                        out
                    },
                );
                js_trim(&decode_xml_entities(&without_tags)).to_string()
            })
            .filter(|name| !name.is_empty())
            .collect();
    (!names.is_empty()).then(|| names.join(", "))
}

struct FontScan<'a> {
    doc: &'a Document,
    fonts: Vec<FontFact>,
    seen_forms: HashSet<ObjectId>,
}

fn font_fact(doc: &Document, font: &Dictionary, resource_name: &[u8]) -> FontFact {
    let subtype = name(doc, font, b"Subtype");
    let descendant = if subtype == Some(b"Type0") {
        match get(doc, font, b"DescendantFonts") {
            Some(Object::Array(fonts)) => fonts.first().and_then(|first| dict(doc, first)),
            _ => None,
        }
    } else {
        None
    };
    let described = descendant.unwrap_or(font);
    let descriptor = get(doc, described, b"FontDescriptor").and_then(|object| dict(doc, object));
    let base_font = name(doc, described, b"BaseFont").or_else(|| name(doc, font, b"BaseFont"));
    let font_name = match (
        descriptor.and_then(|descriptor| name(doc, descriptor, b"FontName")),
        base_font,
    ) {
        (Some(declared), _) => String::from_utf8_lossy(declared).into_owned(),
        (None, Some(base)) => String::from_utf8_lossy(base).replace([',', '_'], "-"),
        (None, None) => String::from_utf8_lossy(resource_name).into_owned(),
    };
    let embedded = if subtype == Some(b"Type3") {
        None
    } else {
        Some(descriptor.is_some_and(|descriptor| {
            [b"FontFile".as_slice(), b"FontFile2", b"FontFile3"]
                .iter()
                .any(|key| descriptor.has(key))
        }))
    };
    FontFact {
        name: font_name,
        embedded,
    }
}

fn record_font(scan: &mut FontScan, fact: FontFact) {
    // `Map.set`: a repeated name keeps its place and takes the new value.
    match scan
        .fonts
        .iter_mut()
        .find(|existing| existing.name == fact.name)
    {
        Some(existing) => existing.embedded = fact.embedded,
        None => scan.fonts.push(fact),
    }
}

fn resource<'a>(
    doc: &'a Document,
    resources: Option<&'a Dictionary>,
    kind: &[u8],
    key: &[u8],
) -> Option<&'a Dictionary> {
    let group = get(doc, resources?, kind).and_then(|object| dict(doc, object))?;
    get(doc, group, key).and_then(|object| dict(doc, object))
}

fn scan_content(scan: &mut FontScan, content: &[u8], resources: Option<&Dictionary>, depth: usize) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(decoded) = Content::decode(content) else {
        return;
    };
    let doc = scan.doc;
    for operation in decoded.operations {
        match operation.operator.as_str() {
            "Tf" => {
                let Some(Object::Name(font_name)) = operation.operands.first() else {
                    continue;
                };
                if let Some(font) = resource(doc, resources, b"Font", font_name) {
                    let fact = font_fact(doc, font, font_name);
                    record_font(scan, fact);
                }
            }
            "Do" => {
                let Some(Object::Name(xobject_name)) = operation.operands.first() else {
                    continue;
                };
                let Some(Object::Dictionary(group)) =
                    resources.and_then(|resources| get(doc, resources, b"XObject"))
                else {
                    continue;
                };
                let Ok(Object::Reference(id)) = group.get(xobject_name) else {
                    continue;
                };
                if !scan.seen_forms.insert(*id) {
                    continue;
                }
                let Ok(Object::Stream(form)) = doc.get_object(*id) else {
                    continue;
                };
                if name(doc, &form.dict, b"Subtype") != Some(b"Form") {
                    continue;
                }
                let inner = get(doc, &form.dict, b"Resources")
                    .and_then(|object| dict(doc, object))
                    .or(resources);
                let bytes = form
                    .decompressed_content()
                    .unwrap_or_else(|_| form.content.clone());
                scan_content(scan, &bytes, inner, depth + 1);
            }
            _ => {}
        }
    }
}

fn page_content(doc: &Document, page: &Dictionary) -> Vec<u8> {
    let streams: Vec<&Object> = match page.get(b"Contents") {
        Ok(Object::Array(items)) => items.iter().collect(),
        Ok(object) => match deref(doc, object) {
            Some(Object::Array(items)) => items.iter().collect(),
            Some(_) => vec![object],
            None => Vec::new(),
        },
        Err(_) => Vec::new(),
    };
    let mut content = Vec::new();
    for object in streams {
        if let Some(Object::Stream(stream)) = deref(doc, object) {
            let bytes = stream
                .decompressed_content()
                .unwrap_or_else(|_| stream.content.clone());
            content.extend_from_slice(&bytes);
            content.push(b'\n');
        }
    }
    content
}

fn read_document(bytes: &[u8]) -> Result<PdfFacts, PdfFactsError> {
    let doc =
        Document::load_mem(bytes).map_err(|error| PdfFactsError::Unreadable(error.to_string()))?;
    let mut pages = Vec::new();
    let mut link_count = 0;
    let mut form_field_count = 0;
    let mut scan = FontScan {
        doc: &doc,
        fonts: Vec::new(),
        seen_forms: HashSet::new(),
    };
    let page_ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
    if page_ids.is_empty() {
        return Err(PdfFactsError::Unreadable(
            "the PDF has no pages".to_string(),
        ));
    }
    for id in &page_ids {
        let page = match doc.get_object(*id) {
            Ok(Object::Dictionary(page)) => page,
            _ => {
                return Err(PdfFactsError::Unreadable(
                    "a page is not a dictionary".to_string(),
                ))
            }
        };
        pages.push(page_facts(&doc, page));
        let (links, widgets) = annotation_counts(&doc, page);
        link_count += links;
        form_field_count += widgets;
        let resources = inherited(&doc, page, b"Resources").and_then(|object| dict(&doc, object));
        let content = page_content(&doc, page);
        scan_content(&mut scan, &content, resources, 0);
    }
    let fonts = std::mem::take(&mut scan.fonts);
    let info = doc
        .trailer
        .get(b"Info")
        .ok()
        .and_then(|object| dict(&doc, object));
    let author = info_string(&doc, info, b"Author").or_else(|| xmp_creator(&doc));
    Ok(PdfFacts {
        version: header_version(bytes),
        page_count: pages.len() as u32,
        pages,
        outline_count: outline_count(&doc),
        link_count,
        attachment_count: attachment_count(&doc),
        form_field_count,
        restricted: Some(declares_encryption(bytes) || doc.trailer.has(b"Encrypt")),
        author,
        creator: info_string(&doc, info, b"Creator"),
        producer: info_string(&doc, info, b"Producer"),
        fonts,
    })
}

/// Reads the facts of a PDF. A broken, encrypted or huge file is an error,
/// never a panic.
pub fn read_pdf_facts(bytes: &[u8]) -> Result<PdfFacts, PdfFactsError> {
    if bytes.len() as u64 > MAX_PDF_BYTES {
        return Err(PdfFactsError::TooLarge {
            bytes: bytes.len() as u64,
        });
    }
    match std::panic::catch_unwind(|| read_document(bytes)) {
        Ok(result) => result,
        Err(_) => Err(PdfFactsError::Unreadable(
            "the PDF reader stopped on this file".to_string(),
        )),
    }
}

/// Page sizes rounded to 0.1 pt and fonts sorted by name, the form the
/// golden facts are stored in.
pub fn normalized_facts(mut facts: PdfFacts) -> PdfFacts {
    for page in &mut facts.pages {
        page.width = crate::text::js_round(page.width * 10.0) / 10.0;
        page.height = crate::text::js_round(page.height * 10.0) / 10.0;
    }
    facts
        .fonts
        .sort_by(|left, right| left.name.cmp(&right.name));
    facts
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn font_names(facts: &PdfFacts) -> HashMap<String, Option<bool>> {
        facts
            .fonts
            .iter()
            .map(|font| (font.name.clone(), font.embedded))
            .collect()
    }

    /// A minimal PDF with a correct cross-reference table.
    fn pdf(objects: &[&str], trailer_extra: &str) -> Vec<u8> {
        let mut out = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (index, body) in objects.iter().enumerate() {
            offsets.push(out.len());
            out.extend_from_slice(format!("{} 0 obj\n{body}\nendobj\n", index + 1).as_bytes());
        }
        let xref = out.len();
        out.extend_from_slice(
            format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes(),
        );
        for offset in offsets {
            out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        out.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R {trailer_extra}>>\nstartxref\n{xref}\n%%EOF\n",
                objects.len() + 1
            )
            .as_bytes(),
        );
        out
    }

    fn one_page(page: &str) -> Vec<u8> {
        pdf(
            &[
                "<< /Type /Catalog /Pages 2 0 R >>",
                "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                page,
            ],
            "",
        )
    }

    #[test]
    fn garbage_bytes_are_an_error_not_a_panic() {
        assert!(matches!(
            read_pdf_facts(b"%PDF-1.7\nnot really"),
            Err(PdfFactsError::Unreadable(_))
        ));
    }

    #[test]
    fn rotated_pages_swap_width_and_height() {
        let facts = read_pdf_facts(&one_page(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate 90 >>",
        ))
        .unwrap();
        assert_eq!(
            facts.pages,
            vec![PdfPageFacts {
                width: 792.0,
                height: 612.0,
                rotation: 90
            }]
        );
        assert_eq!(facts.version.as_deref(), Some("1.4"));
        assert_eq!(facts.restricted, Some(false));
    }

    #[test]
    fn crop_box_is_intersected_with_media_box() {
        let facts = read_pdf_facts(&one_page(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /CropBox [-10 -10 300 400] >>",
        ))
        .unwrap();
        assert_eq!(
            (facts.pages[0].width, facts.pages[0].height),
            (300.0, 400.0)
        );
    }

    #[test]
    fn inherited_media_box_and_odd_rotation() {
        let bytes = pdf(
            &[
                "<< /Type /Catalog /Pages 2 0 R >>",
                "<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 595 842] /Rotate 45 >>",
                "<< /Type /Page /Parent 2 0 R >>",
            ],
            "",
        );
        let facts = read_pdf_facts(&bytes).unwrap();
        assert_eq!(
            facts.pages[0],
            PdfPageFacts {
                width: 595.0,
                height: 842.0,
                rotation: 0
            }
        );
    }

    #[test]
    fn outline_cycles_terminate() {
        let bytes = pdf(
            &[
                "<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R >>",
                "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
                "<< /Type /Outlines /First 5 0 R /Count 1 >>",
                "<< /Title (Intro) /Parent 4 0 R /Next 5 0 R >>",
            ],
            "",
        );
        assert_eq!(read_pdf_facts(&bytes).unwrap().outline_count, 1);
    }

    #[test]
    fn links_fonts_and_info_are_read() {
        let bytes = pdf(
            &[
                "<< /Type /Catalog /Pages 2 0 R >>",
                "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R /Annots [7 0 R] >>",
                "<< /Length 26 >>\nstream\nBT /F1 12 Tf (Hello) Tj ET\nendstream",
                "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
                "<< /Type /Font /Subtype /Type1 /BaseFont /Unused >>",
                "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] >>",
                "<< /Author (Ana Example) /Producer (pdf-lib) >>",
            ],
            "/Info 8 0 R ",
        );
        let facts = read_pdf_facts(&bytes).unwrap();
        assert_eq!(facts.link_count, 1);
        assert_eq!(facts.author.as_deref(), Some("Ana Example"));
        assert_eq!(facts.producer.as_deref(), Some("pdf-lib"));
        let fonts = font_names(&facts);
        assert_eq!(fonts.len(), 1);
        assert_eq!(fonts["Helvetica"], Some(false));
    }

    #[test]
    fn encryption_is_detected_from_the_trailer_key() {
        assert!(declares_encryption(b"trailer << /Encrypt 5 0 R >>"));
        assert!(!declares_encryption(b"<< /EncryptMetadata false >>"));
    }

    #[test]
    fn pdf_doc_encoding_maps_the_special_range() {
        assert_eq!(pdf_text(&[0x41, 0x80, 0xa0]), "A•€");
        assert_eq!(pdf_text(&[0xFE, 0xFF, 0x00, 0x41]), "A");
    }
}
