use super::*;

pub(super) fn escape_label(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if matches!(c, '['..=']') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

pub(super) fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(next) = chars.peek().copied().filter(char::is_ascii_punctuation) {
                out.push(next);
                chars.next();
                continue;
            }
        }
        out.push(c);
    }
    out
}

pub(super) fn link_labels(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        if c == '\\' && index + 1 < chars.len() {
            out.push(c);
            out.push(chars[index + 1]);
            index += 2;
            continue;
        }
        if c == '[' && chars.get(index + 1) == Some(&'[') {
            if let Some(close) = (index + 2..chars.len().saturating_sub(1))
                .find(|&at| chars[at] == ']' && chars[at + 1] == ']')
            {
                let inner: String = chars[index + 2..close].iter().collect();
                let shown = inner
                    .split_once('|')
                    .map_or(inner.as_str(), |(_, alias)| alias);
                out.push_str(shown);
                index = close + 2;
                continue;
            }
        }
        let image = c == '!' && chars.get(index + 1) == Some(&'[');
        let open = if image { index + 1 } else { index };
        if c == '[' || image {
            let close = (open + 1..chars.len()).find(|&at| chars[at] == ']');
            if let Some(close) = close.filter(|close| chars.get(close + 1) == Some(&'(')) {
                if let Some(end) = (close + 2..chars.len()).find(|&at| chars[at] == ')') {
                    out.extend(&chars[open + 1..close]);
                    index = end + 1;
                    continue;
                }
            }
        }
        out.push(c);
        index += 1;
    }
    out
}

pub(super) fn code_contents(text: &str) -> String {
    let bytes = text.as_bytes();
    let spans = CodeSpans::new(bytes);
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'`' {
            index += 1;
            continue;
        }
        let run = run_at(bytes, index, b'`');
        match spans.close(index, run, bytes.len()) {
            Some(close) => {
                out.push_str(&text[copied..index]);
                out.push_str(&text[index + run..close]);
                copied = close + run;
                index = close + run;
            }
            None => index += run,
        }
    }
    out.push_str(&text[copied..]);
    out
}

pub(super) fn without_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('<') {
        let Some(close) = rest[open + 1..].find('>').filter(|close| *close > 0) else {
            break;
        };
        out.push_str(&rest[..open]);
        rest = &rest[open + close + 2..];
    }
    out.push_str(rest);
    out
}

pub(super) fn unwrap_pair(text: &str, marker: &str) -> Option<String> {
    let mut from = 0;
    while let Some(found) = text[from..].find(marker) {
        let open = from + found;
        let inner = open + marker.len();
        if let Some(first) = text[inner..].chars().next().filter(|c| !c.is_whitespace()) {
            let mut search = inner + first.len_utf8();
            while let Some(next) = text.get(search..).and_then(|rest| rest.find(marker)) {
                let close = search + next;
                if text[..close]
                    .chars()
                    .next_back()
                    .is_some_and(|c| !c.is_whitespace())
                {
                    return Some(format!(
                        "{}{}{}",
                        &text[..open],
                        &text[inner..close],
                        &text[close + marker.len()..]
                    ));
                }
                search = close + 1;
            }
        }
        from = open + 1;
        while !text.is_char_boundary(from) {
            from += 1;
        }
    }
    None
}

pub(super) fn plain_heading(text: &str) -> String {
    let mut plain = without_tags(&code_contents(&link_labels(text)));
    'unwrap: loop {
        for marker in ["**", "__", "~~", "==", "*", "_"] {
            if let Some(next) = unwrap_pair(&plain, marker) {
                plain = next;
                continue 'unwrap;
            }
        }
        break;
    }
    unescape(&plain)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn heading_slug(text: &str) -> String {
    text.trim()
        .to_lowercase()
        .chars()
        .filter_map(|c| {
            if c == ' ' {
                Some('-')
            } else if c.is_alphanumeric()
                || unicode_normalization::char::is_combining_mark(c)
                || c == '_'
                || c == '-'
            {
                Some(c)
            } else {
                None
            }
        })
        .collect()
}

pub(super) fn encode_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            )
        {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

pub(super) fn atx_heading(line: &str) -> Option<(usize, &str)> {
    let trimmed = line.trim_start_matches(' ');
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    let level = trimmed.bytes().take_while(|byte| *byte == b'#').count();
    if level == 0 || level > 6 {
        return None;
    }
    let rest = &trimmed[level..];
    if !(rest.is_empty() || rest.starts_with([' ', '\t'])) {
        return None;
    }
    let rest = rest.trim();
    let without_closing = rest.trim_end_matches('#');
    let text = if without_closing.is_empty() || without_closing.ends_with([' ', '\t']) {
        without_closing.trim_end()
    } else {
        rest
    };
    let text = oleafly_core::markdown_scan::block_id_suffix(text)
        .map_or(text, |(end, _)| text[..end].trim_end());
    Some((level, text))
}

pub(super) fn headings(body: &str) -> Vec<(String, String)> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut found = Vec::new();
    for block in blocks(body) {
        let Block::Line(line) = block else {
            continue;
        };
        let Some((_, text)) = atx_heading(line) else {
            continue;
        };
        let plain = plain_heading(text);
        let original = heading_slug(&plain);
        let count = seen.entry(original.clone()).or_insert(0);
        let slug = if *count == 0 {
            original
        } else {
            format!("{original}-{count}")
        };
        *count += 1;
        found.push((slug, plain));
    }
    found
}

pub(super) fn first_title_heading(body: &str) -> Option<String> {
    blocks(body).into_iter().find_map(|block| match block {
        Block::Line(line) => atx_heading(line)
            .filter(|(level, _)| *level == 1)
            .map(|(_, text)| plain_heading(text))
            .filter(|text| !text.is_empty()),
        Block::Fence { .. } => None,
    })
}

pub(super) enum Block<'a> {
    Line(&'a str),
    Fence {
        open: &'a str,
        info: &'a str,
        lines: Vec<&'a str>,
        close: Option<&'a str>,
    },
}

pub(super) fn blocks(body: &str) -> Vec<Block<'_>> {
    let mut found = Vec::new();
    let mut fences = Fences::default();
    for line in body.split('\n') {
        match fences.read(line) {
            (FenceLine::Opens, info) => found.push(Block::Fence {
                open: line,
                info: info.unwrap_or_default(),
                lines: Vec::new(),
                close: None,
            }),
            (FenceLine::Inside, _) => {
                if let Some(Block::Fence { lines, .. }) = found.last_mut() {
                    lines.push(line);
                }
            }
            (FenceLine::Closes, _) => {
                if let Some(Block::Fence { close, .. }) = found.last_mut() {
                    *close = Some(line);
                }
            }
            (FenceLine::Text, _) => found.push(Block::Line(line)),
        }
    }
    found
}

pub(super) fn join_blocks(parts: Vec<String>) -> String {
    parts.join("\n")
}

pub(super) fn fence_lines(open: &str, lines: &[String], close: Option<&str>) -> String {
    let mut parts = vec![open.to_string()];
    parts.extend(lines.iter().cloned());
    if let Some(close) = close {
        parts.push(close.to_string());
    }
    parts.join("\n")
}

fn block_kind(info: &str) -> String {
    let info = info.trim();
    info.strip_prefix("{=")
        .and_then(|inner| inner.strip_suffix('}'))
        .filter(|inner| !inner.is_empty())
        .unwrap_or(info)
        .trim()
        .to_lowercase()
}

pub(super) fn is_notebook_info(info: &str) -> bool {
    block_kind(info) == NOTEBOOK_INFO
}

const TABLE_FENCES: &[&str] = &["csv", "tsv"];
const TABLE_OPTIONS: &[&str] = &["path", "sheet", "thousands"];
const MOLECULE_FENCES: &[&str] = &["molecule", "pdb", "mol", "sdf", "xyz", "cif", "mol2"];
const MOLECULE_OPTIONS: &[&str] = &["path", "format", "style", "color", "colour"];

pub(super) struct FenceAsset {
    pub(super) at: usize,
    pub(super) prefix: String,
    pub(super) value: String,
}

impl FenceAsset {
    pub(super) fn replaced(&self, value: &str) -> String {
        format!("{}{value}", self.prefix)
    }
}

pub(super) fn fence_asset(info: &str, lines: &[&str]) -> Option<FenceAsset> {
    let kind = block_kind(info);
    if kind == NOTEBOOK_INFO {
        let at = lines.iter().position(|line| !line.trim().is_empty())?;
        let line = lines[at];
        let indent = &line[..line.len() - line.trim_start().len()];
        return Some(FenceAsset {
            at,
            prefix: indent.to_string(),
            value: line.trim().to_string(),
        });
    }
    let keys = if TABLE_FENCES.contains(&kind.as_str()) {
        TABLE_OPTIONS
    } else if MOLECULE_FENCES.contains(&kind.as_str()) {
        MOLECULE_OPTIONS
    } else {
        return None;
    };
    let mut path = None;
    for (at, line) in lines.iter().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let Some((key, value_at)) =
            option_line(line).filter(|(key, _)| keys.contains(&key.as_str()))
        else {
            break;
        };
        if key == "path" {
            path = Some(FenceAsset {
                at,
                prefix: line[..value_at].to_string(),
                value: line[value_at..].trim().to_string(),
            });
        }
    }
    path.filter(|asset| !asset.value.is_empty())
}

fn option_line(line: &str) -> Option<(String, usize)> {
    let start = line.len() - line.trim_start().len();
    let rest = &line[start..];
    let key_len = rest
        .char_indices()
        .take_while(|(at, c)| {
            if *at == 0 {
                c.is_ascii_alphabetic()
            } else {
                c.is_ascii_alphanumeric() || *c == '_' || *c == '-'
            }
        })
        .count();
    if key_len == 0 {
        return None;
    }
    let after_key = &rest[key_len..];
    let colon = after_key.len() - after_key.trim_start().len();
    if !after_key[colon..].starts_with(':') {
        return None;
    }
    let after_colon = &after_key[colon + 1..];
    let gap = after_colon.len() - after_colon.trim_start().len();
    Some((
        rest[..key_len].to_ascii_lowercase(),
        start + key_len + colon + 1 + gap,
    ))
}

pub(super) enum Token<'a> {
    Wiki {
        embed: bool,
        inner: &'a str,
    },
    Link {
        embed: bool,
        label: &'a str,
        destination: String,
    },
}

pub(super) struct LineMarks {
    pub(super) brackets: HashMap<usize, usize>,
    pub(super) wiki_closes: Vec<usize>,
}

impl LineMarks {
    pub(super) fn of(line: &str) -> Self {
        let bytes = line.as_bytes();
        if !bytes.contains(&b'[') {
            return Self {
                brackets: HashMap::new(),
                wiki_closes: Vec::new(),
            };
        }
        Self {
            brackets: matching_brackets(bytes, b'[', b']'),
            wiki_closes: bytes
                .windows(2)
                .enumerate()
                .filter(|(_, pair)| *pair == b"]]")
                .map(|(at, _)| at)
                .collect(),
        }
    }

    pub(super) fn wiki_close(&self, from: usize) -> Option<usize> {
        let at = self.wiki_closes.partition_point(|close| *close < from);
        self.wiki_closes.get(at).copied()
    }
}

pub(super) fn token_at<'a>(
    line: &'a str,
    open: usize,
    embed: bool,
    marks: &LineMarks,
) -> Option<(Token<'a>, usize)> {
    let bytes = line.as_bytes();
    if bytes.get(open + 1) == Some(&b'[') {
        let inner_start = open + 2;
        if let Some(close) = marks.wiki_close(inner_start) {
            let inner = &line[inner_start..close];
            if !inner.trim().is_empty() && !inner.contains('[') && !inner.contains(']') {
                return Some((Token::Wiki { embed, inner }, close + 2));
            }
        }
    }
    let close = *marks.brackets.get(&open)?;
    let (destination, end) = link_tail(bytes, close + 1)?;
    Some((
        Token::Link {
            embed,
            label: &line[open + 1..close],
            destination: line.get(destination)?.to_string(),
        },
        end,
    ))
}

pub(super) fn rewrite_inline<F>(line: &str, mut on_token: F) -> String
where
    F: FnMut(&Token<'_>) -> Option<String>,
{
    let bytes = line.as_bytes();
    let marks = LineMarks::of(line);
    let spans = CodeSpans::new(bytes);
    let mut out = String::with_capacity(line.len());
    let mut copied = 0;
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'\\' {
            index += 2;
            continue;
        }
        if byte == b'`' {
            let run = run_at(bytes, index, b'`');
            index = spans
                .close(index, run, bytes.len())
                .map_or(index + run, |close| close + run);
            continue;
        }
        let embed = byte == b'!' && bytes.get(index + 1) == Some(&b'[');
        if byte != b'[' && !embed {
            index += 1;
            continue;
        }
        let open = if embed { index + 1 } else { index };
        if let Some((token, end)) = token_at(line, open, embed, &marks) {
            if let Some(replacement) = on_token(&token) {
                out.push_str(&line[copied..index]);
                out.push_str(&replacement);
                copied = end;
            }
            index = end;
            continue;
        }
        index += 1;
    }
    out.push_str(&line[copied..]);
    out
}

pub(super) fn split_wiki(inner: &str) -> (&str, Option<&str>) {
    match inner.find('|') {
        Some(at) => {
            let target = &inner[..at];
            (
                target.strip_suffix('\\').unwrap_or(target),
                Some(inner[at + 1..].trim()),
            )
        }
        None => (inner, None),
    }
}

pub(super) fn split_fragment(target: &str) -> (&str, Option<&str>) {
    match target.split_once('#') {
        Some((name, fragment)) => (name.trim(), Some(fragment.trim())),
        None => (target.trim(), None),
    }
}

pub(super) enum LinkFragment {
    Heading(String),
    Block(String),
}

impl LinkFragment {
    pub(super) fn href(&self) -> String {
        match self {
            Self::Heading(heading) => {
                let slug = heading_slug(&plain_heading(heading));
                if slug.is_empty() {
                    String::new()
                } else {
                    format!("#{}", encode_component(&slug))
                }
            }
            Self::Block(id) => format!("#^{id}"),
        }
    }

    pub(super) fn label(&self) -> String {
        match self {
            Self::Heading(heading) => heading.clone(),
            Self::Block(id) => format!("^{id}"),
        }
    }
}

pub(super) fn link_fragment(fragment: Option<&str>) -> Option<LinkFragment> {
    let fragment = fragment?;
    if let Some(id) = fragment.strip_prefix('^') {
        return crate::note_links::link_block(&format!("#^{}", id.trim())).map(LinkFragment::Block);
    }
    let heading = fragment.rsplit('#').next().unwrap_or(fragment).trim();
    (!heading.is_empty()).then(|| LinkFragment::Heading(heading.to_string()))
}

pub(super) fn size_alias(alias: &str) -> bool {
    let (width, height) = alias.split_once('x').unwrap_or((alias, "0"));
    !width.is_empty()
        && width.bytes().all(|byte| byte.is_ascii_digit())
        && height.bytes().all(|byte| byte.is_ascii_digit())
}

pub(super) fn display_name(name: &str) -> String {
    let cut = name.len().saturating_sub(3);
    match (name.get(..cut), name.get(cut..)) {
        (Some(stem), Some(extension)) if extension.eq_ignore_ascii_case(".md") => stem.to_string(),
        _ => name.to_string(),
    }
}
