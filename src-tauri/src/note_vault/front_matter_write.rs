use super::*;

pub(super) struct FrontMatter<'a> {
    pub(super) lines: Option<Vec<&'a str>>,
    pub(super) body: &'a str,
}

pub(super) fn split_front_matter(text: &str) -> FrontMatter<'_> {
    match oleafly_core::front_matter::split(text) {
        Some(front) => {
            let (lines, body) = front.into_parts();
            FrontMatter {
                lines: Some(lines),
                body,
            }
        }
        None => FrontMatter {
            lines: None,
            body: text,
        },
    }
}

pub(super) fn front_value(lines: &[&str], key: &str) -> Option<String> {
    oleafly_core::front_matter::scalar(lines, key)
}

pub(super) fn plain_safe(value: &str) -> bool {
    if value.is_empty() || value != value.trim() || value.contains('\n') {
        return false;
    }
    if value.starts_with([
        '-', '?', ':', ',', '[', ']', '{', '}', '#', '&', '*', '!', '|', '>', '\'', '"', '%', '@',
        '`',
    ]) {
        return false;
    }
    if value.contains(": ") || value.contains(" #") || value.ends_with(':') {
        return false;
    }
    let lower = value.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "true" | "false" | "yes" | "no" | "on" | "off" | "null" | "~"
    ) {
        return false;
    }
    let digits = value.strip_prefix(['+', '-']).unwrap_or(value);
    let numeric = !digits.is_empty()
        && digits.split_once('.').map_or_else(
            || digits.bytes().all(|byte| byte.is_ascii_digit()),
            |(whole, fraction)| {
                !whole.is_empty()
                    && !fraction.is_empty()
                    && whole.bytes().all(|byte| byte.is_ascii_digit())
                    && fraction.bytes().all(|byte| byte.is_ascii_digit())
            },
        );
    !numeric
}

pub(super) fn yaml_scalar(value: &str) -> String {
    if plain_safe(value) {
        value.to_string()
    } else {
        serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
    }
}

pub(super) fn continues(line: &str) -> bool {
    line.starts_with([' ', '\t']) || line == "-" || line.starts_with("- ")
}

pub(super) fn without_keys(lines: &[&str], keys: &[&str]) -> Vec<String> {
    let mut kept = Vec::with_capacity(lines.len());
    let mut skipping = false;
    for line in lines {
        if skipping && continues(line) {
            continue;
        }
        skipping = key_of(line).is_some_and(|key| keys.contains(&key));
        if !skipping {
            kept.push((*line).to_string());
        }
    }
    kept
}

pub(super) fn same_tag(item: &str, tag: &str) -> bool {
    let item = item.trim().trim_matches(['"', '\'']).trim();
    let item = item.strip_prefix('#').unwrap_or(item);
    item.to_lowercase() == tag.to_lowercase()
}

pub(super) fn add_tag(lines: &mut Vec<String>, tag: &str) {
    let Some(at) = lines.iter().position(|line| key_of(line) == Some("tags")) else {
        lines.push("tags:".to_string());
        lines.push(format!("  - {tag}"));
        return;
    };
    let value = value_of(&lines[at]).to_string();
    if value.is_empty() {
        let mut end = at + 1;
        let mut indent = None;
        while end < lines.len() && continues(&lines[end]) {
            let trimmed = lines[end].trim_start();
            if let Some(item) = trimmed.strip_prefix('-') {
                if indent.is_none() {
                    indent = Some(lines[end][..lines[end].len() - trimmed.len()].to_string());
                }
                if same_tag(item, tag) {
                    return;
                }
            }
            end += 1;
        }
        let indent = indent.unwrap_or_else(|| "  ".to_string());
        lines.insert(end, format!("{indent}- {tag}"));
        return;
    }
    if let Some(inner) = value
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
    {
        let inner = inner.trim();
        if inner.split(',').any(|item| same_tag(item, tag)) {
            return;
        }
        lines[at] = if inner.is_empty() {
            format!("tags: [{tag}]")
        } else {
            format!("tags: [{inner}, {tag}]")
        };
        return;
    }
    let text = scalar_value(&value).unwrap_or_default();
    if text
        .split([',', ' '])
        .filter(|item| !item.trim().is_empty())
        .any(|item| same_tag(item, tag))
    {
        return;
    }
    let joined = if text.contains(',') {
        format!("{text}, {tag}")
    } else if text.is_empty() {
        tag.to_string()
    } else {
        format!("{text} {tag}")
    };
    lines[at] = format!("tags: {}", yaml_scalar(&joined));
}

pub(super) fn folder_tag(rel: &str) -> Option<String> {
    let (folder, _) = rel.rsplit_once('/')?;
    let parts: Vec<String> = folder
        .split('/')
        .map(|part| {
            let cleaned: String = part
                .chars()
                .map(|c| if c.is_whitespace() { '-' } else { c })
                .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_'))
                .collect();
            cleaned.trim_matches('-').to_string()
        })
        .filter(|part| !part.is_empty())
        .collect();
    let tag = parts.join("/");
    tag.chars().any(|c| !c.is_ascii_digit()).then_some(tag)
}

pub(super) fn full_note_title(front: Option<&[&str]>, body: &str, rel: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    let title: String = front
        .and_then(|lines| front_value(lines, "title"))
        .or_else(|| first_title_heading(body))
        .unwrap_or_else(|| file_stem(base_name(rel)).trim().to_string())
        .nfc()
        .collect();
    let title = title.trim();
    if title.is_empty() {
        UNTITLED.to_string()
    } else {
        title.to_string()
    }
}

pub(super) fn note_title(front: Option<&[&str]>, body: &str, rel: &str) -> String {
    truncate_chars(&full_note_title(front, body, rel), MAX_TITLE_CHARS)
        .trim()
        .to_string()
}

pub(super) fn imported_source(
    front: Option<&[&str]>,
    title: &str,
    id: &str,
    tag: Option<&str>,
    body: &str,
) -> String {
    let mut lines = Vec::new();
    let mut titled = false;
    if let Some(front) = front {
        titled = front_value(front, "title").is_some();
        let mut managed = vec!["kind", "id"];
        if !titled {
            managed.push("title");
        }
        lines = without_keys(front, &managed);
        let declared = front_value(front, "kind").as_deref() == Some(NOTE_KIND);
        if let Some(old) = front_value(front, "id").filter(|_| !declared) {
            lines.push(format!("imported-id: {}", yaml_scalar(&old)));
        }
    }
    if !titled {
        lines.push(format!("title: {}", yaml_scalar(title)));
    }
    lines.push(format!("kind: {NOTE_KIND}"));
    lines.push(format!("id: {id}"));
    if let Some(tag) = tag {
        add_tag(&mut lines, tag);
    }
    let mut out = String::from("---\n");
    for line in lines {
        out.push_str(&line);
        out.push('\n');
    }
    out.push_str("---\n");
    if front.is_none() && !body.is_empty() && !body.starts_with('\n') {
        out.push('\n');
    }
    out.push_str(body);
    out
}

pub(super) fn exported_front_matter(text: &str) -> (String, &str) {
    let split = split_front_matter(text);
    let Some(lines) = split.lines else {
        return (String::new(), text);
    };
    let kept = without_keys(&lines, &["kind", "id"]);
    if kept.iter().all(|line| line.trim().is_empty()) {
        return (String::new(), split.body.trim_start_matches('\n'));
    }
    let mut out = String::from("---\n");
    for line in kept {
        out.push_str(&line);
        out.push('\n');
    }
    out.push_str("---\n");
    (out, split.body)
}
