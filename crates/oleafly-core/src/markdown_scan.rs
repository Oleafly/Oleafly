use std::collections::HashMap;
use std::ops::Range;

pub trait Unit: Copy + PartialEq {
    fn ascii(self) -> Option<u8>;
}

impl Unit for u8 {
    fn ascii(self) -> Option<u8> {
        self.is_ascii().then_some(self)
    }
}

impl Unit for char {
    fn ascii(self) -> Option<u8> {
        self.is_ascii().then_some(self as u8)
    }
}

fn is<T: Unit>(item: Option<&T>, byte: u8) -> bool {
    item.and_then(|item| item.ascii()) == Some(byte)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fence {
    pub marker: u8,
    pub run: usize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Container {
    quotes: usize,
    list_indent: usize,
}

const MAX_INDENT: usize = 3;

fn is_blank(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t')
}

fn leading_blanks(text: &str) -> usize {
    text.bytes().take_while(|byte| is_blank(*byte)).count()
}

const JS_SPACES: [char; 14] = [
    '\t', '\n', '\u{b}', '\u{c}', '\r', ' ', '\u{a0}', '\u{1680}', '\u{2028}', '\u{2029}',
    '\u{202f}', '\u{205f}', '\u{3000}', '\u{feff}',
];

fn is_js_space(character: char) -> bool {
    ('\u{2000}'..='\u{200a}').contains(&character) || JS_SPACES.contains(&character)
}

fn quote_prefix(line: &str) -> (usize, usize) {
    let mut offset = 0;
    let mut quotes = 0;
    loop {
        let rest = &line[offset..];
        let indent = leading_blanks(rest);
        if indent > MAX_INDENT || rest.as_bytes().get(indent) != Some(&b'>') {
            return (offset, quotes);
        }
        let gap = usize::from(
            rest.as_bytes()
                .get(indent + 1)
                .copied()
                .is_some_and(is_blank),
        );
        offset += indent + 1 + gap;
        quotes += 1;
    }
}

fn list_marker_len(text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    let indent = leading_blanks(text);
    if indent > MAX_INDENT {
        return None;
    }
    let marker_end = match bytes.get(indent)? {
        b'*' | b'+' | b'-' => indent + 1,
        b'0'..=b'9' => {
            let digits = bytes[indent..]
                .iter()
                .take_while(|byte| byte.is_ascii_digit())
                .count();
            if digits > 9 || !matches!(bytes.get(indent + digits), Some(b'.' | b')')) {
                return None;
            }
            indent + digits + 1
        }
        _ => return None,
    };
    let gap = leading_blanks(&text[marker_end..]);
    if !(1..=4).contains(&gap) {
        return None;
    }
    let end = marker_end + gap;
    match text[end..].chars().next() {
        Some(next) if is_js_space(next) => None,
        _ => Some(end),
    }
}

fn continuation(line: &str, container: Container) -> Option<usize> {
    let (offset, quotes) = quote_prefix(line);
    if quotes != container.quotes {
        return None;
    }
    if container.list_indent == 0 {
        return Some(offset);
    }
    (leading_blanks(&line[offset..]) >= container.list_indent)
        .then_some(offset + container.list_indent)
}

fn opening(line: &str, item: Option<Container>) -> (usize, Container) {
    let (quote_offset, quotes) = quote_prefix(line);
    let (mut offset, mut list_indent) = item
        .and_then(|item| continuation(line, item).map(|offset| (offset, item.list_indent)))
        .unwrap_or((quote_offset, 0));
    if let Some(length) = list_marker_len(&line[offset..]) {
        offset += length;
        list_indent += length;
    }
    (
        offset,
        Container {
            quotes,
            list_indent,
        },
    )
}

fn fence_open(content: &str) -> Option<(Fence, &str)> {
    let indent = leading_blanks(content);
    if indent > MAX_INDENT {
        return None;
    }
    let rest = &content[indent..];
    let marker = *rest.as_bytes().first()?;
    if marker != b'`' && marker != b'~' {
        return None;
    }
    let run = rest.bytes().take_while(|byte| *byte == marker).count();
    if run < 3 || content.contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
        return None;
    }
    let info = &rest[run..];
    if marker == b'`' && info.contains('`') {
        return None;
    }
    Some((Fence { marker, run }, info.trim()))
}

fn fence_closes(content: &str, fence: Fence) -> bool {
    let indent = leading_blanks(content);
    if indent > MAX_INDENT {
        return false;
    }
    let rest = &content[indent..];
    let run = rest
        .bytes()
        .take_while(|byte| *byte == fence.marker)
        .count();
    run >= fence.run && rest[run..].bytes().all(is_blank)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FenceLine {
    Opens,
    Inside,
    Closes,
    Text,
}

#[derive(Clone, Debug, Default)]
pub struct Fences {
    open: Option<(Fence, Container)>,
    items: Vec<Container>,
}

impl Fences {
    pub fn line(&mut self, line: &str) -> FenceLine {
        self.read(line).0
    }

    pub fn read<'a>(&mut self, line: &'a str) -> (FenceLine, Option<&'a str>) {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if let Some((fence, container)) = self.open {
            if continuation(line, container)
                .is_some_and(|offset| fence_closes(&line[offset..], fence))
            {
                self.open = None;
                return (FenceLine::Closes, None);
            }
            return (FenceLine::Inside, None);
        }
        self.leave_ended_items(line);
        let (offset, container) = opening(line, self.items.last().copied());
        let opened = fence_open(&line[offset..]);
        if container.list_indent > self.items.last().map_or(0, |item| item.list_indent) {
            self.items.push(container);
        }
        match opened {
            Some((fence, info)) => {
                self.open = Some((fence, container));
                (FenceLine::Opens, Some(info))
            }
            None => (FenceLine::Text, None),
        }
    }

    fn leave_ended_items(&mut self, line: &str) {
        if line.chars().all(is_js_space) {
            return;
        }
        while let Some(item) = self.items.last() {
            if continuation(line, *item).is_some() {
                return;
            }
            self.items.pop();
        }
    }

    pub fn is_open(&self) -> bool {
        self.open.is_some()
    }
}

pub fn run_at<T: Unit>(items: &[T], start: usize, byte: u8) -> usize {
    items[start.min(items.len())..]
        .iter()
        .take_while(|item| item.ascii() == Some(byte))
        .count()
}

#[derive(Debug, Default)]
pub struct CodeSpans {
    runs: HashMap<usize, Vec<usize>>,
}

impl CodeSpans {
    pub fn new<T: Unit>(items: &[T]) -> Self {
        let mut runs: HashMap<usize, Vec<usize>> = HashMap::new();
        let mut index = 0;
        while index < items.len() {
            if items[index].ascii() != Some(b'`') {
                index += 1;
                continue;
            }
            let run = run_at(items, index, b'`');
            runs.entry(run).or_default().push(index);
            index += run;
        }
        Self { runs }
    }

    pub fn close(&self, open: usize, run: usize, limit: usize) -> Option<usize> {
        let starts = self.runs.get(&run)?;
        let at = starts.partition_point(|start| *start < open + run);
        starts.get(at).copied().filter(|close| close + run <= limit)
    }
}

pub fn matching_brackets<T: Unit>(items: &[T], open: u8, close: u8) -> HashMap<usize, usize> {
    let mut pairs = HashMap::new();
    let mut stack = Vec::new();
    let mut index = 0;
    while index < items.len() {
        match items[index].ascii() {
            Some(b'\\') => {
                index += 2;
                continue;
            }
            Some(byte) if byte == open => stack.push(index),
            Some(byte) if byte == close => {
                if let Some(at) = stack.pop() {
                    pairs.insert(at, index);
                }
            }
            _ => {}
        }
        index += 1;
    }
    pairs
}

pub fn skip_spaces<T: Unit>(items: &[T], start: usize) -> usize {
    let mut index = start;
    while matches!(
        items.get(index).and_then(|item| item.ascii()),
        Some(b' ' | b'\t')
    ) {
        index += 1;
    }
    index
}

pub fn destination_at<T: Unit>(items: &[T], start: usize) -> Option<(Range<usize>, usize)> {
    if is(items.get(start), b'<') {
        let mut index = start + 1;
        while index < items.len() && !matches!(items[index].ascii(), Some(b'>' | b'<')) {
            index += if items[index].ascii() == Some(b'\\') {
                2
            } else {
                1
            };
        }
        if !is(items.get(index), b'>') {
            return None;
        }
        return Some((start + 1..index, index + 1));
    }
    let mut index = start;
    let mut depth = 0usize;
    while index < items.len() {
        match items[index].ascii() {
            Some(b' ' | b'\t') => break,
            Some(b'\\') => {
                index += 2;
                continue;
            }
            Some(b'(') => depth += 1,
            Some(b')') if depth == 0 => break,
            Some(b')') => depth -= 1,
            _ => {}
        }
        index += 1;
    }
    let end = index.min(items.len());
    Some((start.min(end)..end, end))
}

pub fn title_end<T: Unit>(items: &[T], start: usize) -> Option<usize> {
    let quote = match items.get(start).and_then(|item| item.ascii()) {
        Some(quote @ (b'"' | b'\'')) => quote,
        _ => return Some(start),
    };
    let mut index = start + 1;
    while index < items.len() && items[index].ascii() != Some(quote) {
        index += if items[index].ascii() == Some(b'\\') {
            2
        } else {
            1
        };
    }
    (index < items.len()).then_some(index + 1)
}

pub fn link_tail<T: Unit>(items: &[T], paren: usize) -> Option<(Range<usize>, usize)> {
    if !is(items.get(paren), b'(') {
        return None;
    }
    let (destination, end) = destination_at(items, skip_spaces(items, paren + 1))?;
    let index = skip_spaces(items, title_end(items, skip_spaces(items, end))?);
    is(items.get(index), b')').then_some((destination, index + 1))
}

pub fn block_marker_len(text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    let spaces_after = |at: usize| {
        bytes[at.min(bytes.len())..]
            .iter()
            .take_while(|byte| matches!(byte, b' ' | b'\t'))
            .count()
    };
    match bytes.first()? {
        b'#' => {
            let hashes = bytes.iter().take_while(|byte| **byte == b'#').count();
            let gap = spaces_after(hashes);
            (hashes <= 6 && (gap > 0 || hashes == bytes.len())).then_some(hashes + gap)
        }
        b'>' => Some(1 + usize::from(matches!(bytes.get(1), Some(b' ' | b'\t')))),
        b'-' | b'*' | b'+' => {
            let gap = spaces_after(1);
            if gap == 0 {
                return None;
            }
            let at = 1 + gap;
            let task = bytes.get(at) == Some(&b'[')
                && matches!(bytes.get(at + 1), Some(b' ' | b'x' | b'X'))
                && bytes.get(at + 2) == Some(&b']');
            let task_gap = if task { spaces_after(at + 3) } else { 0 };
            Some(if task && task_gap > 0 {
                at + 3 + task_gap
            } else {
                at
            })
        }
        b'0'..=b'9' => {
            let digits = bytes
                .iter()
                .take_while(|byte| byte.is_ascii_digit())
                .count();
            if digits > 9 || !matches!(bytes.get(digits), Some(b'.' | b')')) {
                return None;
            }
            let gap = spaces_after(digits + 1);
            (gap > 0).then_some(digits + 1 + gap)
        }
        _ => None,
    }
}

pub fn callout_marker_len(text: &str) -> Option<usize> {
    let rest = text.strip_prefix("[!")?;
    let close = rest.find(']')?;
    let name = &rest[..close];
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return None;
    }
    let after = &rest[close + 1..];
    if after.starts_with('(') {
        return None;
    }
    let fold = usize::from(after.starts_with(['+', '-']));
    Some(2 + close + 1 + fold)
}

pub fn line_body(line: &str) -> &str {
    let mut rest = line.trim_start();
    let mut quoted = false;
    loop {
        if let Some(length) = block_marker_len(rest) {
            quoted = rest.starts_with('>');
            rest = rest[length..].trim_start();
            continue;
        }
        match callout_marker_len(rest).filter(|_| quoted) {
            Some(length) => {
                quoted = false;
                rest = rest[length..].trim_start();
            }
            None => return rest,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(text: &str) -> Vec<FenceLine> {
        let mut fences = Fences::default();
        text.split('\n').map(|line| fences.line(line)).collect()
    }

    #[test]
    fn fences_close_only_on_the_same_marker_with_a_run_as_long() {
        use FenceLine::*;
        assert_eq!(
            kinds("~~~\n```\n#inside\n~~~\ntext"),
            vec![Opens, Inside, Inside, Closes, Text]
        );
        assert_eq!(
            kinds("````md\n```\n````\nafter"),
            vec![Opens, Inside, Closes, Text]
        );
        assert_eq!(
            kinds("```\n``` not a close\n  ```\nafter"),
            vec![Opens, Inside, Closes, Text]
        );
        assert_eq!(kinds("``` a`b\n#x"), vec![Text, Text]);
        assert_eq!(kinds("~~~ a`b\n~~~"), vec![Opens, Closes]);
        assert_eq!(kinds("``\n- ```js\n\t```"), vec![Text, Opens, Inside]);
        assert_eq!(
            fence_open("   ```notebook run"),
            Some((
                Fence {
                    marker: b'`',
                    run: 3
                },
                "notebook run"
            ))
        );
        assert_eq!(
            Fences::default().read("   ```notebook run"),
            (Opens, Some("notebook run"))
        );
        assert_eq!(Fences::default().read("text"), (Text, None));
        let mut open = Fences::default();
        open.line("~~~~");
        assert!(open.is_open());
        open.line("~~~~~ ");
        assert!(!open.is_open());
    }

    fn marks(text: &str) -> String {
        let mut fences = Fences::default();
        text.split('\n')
            .map(|line| match fences.line(line) {
                FenceLine::Text => '.',
                _ => 'c',
            })
            .collect()
    }

    #[test]
    fn four_spaces_of_indent_are_code_text_not_a_fence() {
        assert_eq!(marks("    ```\nplain [[x]]\n    ```"), "...");
        assert_eq!(marks("text\n\n    ```\nb\n    ```"), ".....");
        assert_eq!(marks("\t\t\t\t```\nb"), "..");
        assert_eq!(marks("   ```\nb\n   ```\nc"), "ccc.");
        assert_eq!(marks("1. a\n\ntext\n\n    ```\n    b\n    ```"), ".......");
    }

    #[test]
    fn fences_count_their_indent_from_the_list_item_that_holds_them() {
        assert_eq!(
            marks("- item\n  - nested\n    ```\n    [[Kept]]\n    ```\n[[Out]]"),
            "..ccc."
        );
        assert_eq!(marks("1. a\n\n    ```\n    b\n    ```\nc"), "..ccc.");
        assert_eq!(
            marks("1.  Run:\n    ```sh\n    make\n    ```\n2.  Done"),
            ".ccc."
        );
        assert_eq!(marks("- a\n\n      ```\n      b"), "....");
        assert_eq!(marks("- a\n     ```\n     b\n     ```"), ".ccc");
        assert_eq!(
            marks("1. a\n   - b\n\n     ```\n     c\n     ```"),
            "...ccc"
        );
        assert_eq!(
            marks("1. Run\n   ```sh\n\n   make\n   ```\n2. Compile"),
            ".cccc."
        );
        assert_eq!(
            marks("*   a\n    *   b\n    ```sh\n    cd x\n    ```\n*   c"),
            "..ccc."
        );
        assert_eq!(marks("10. a\n    - b\n    ```\n    x\n    ```"), "..ccc");
        assert_eq!(marks("- a\n\n```\nb\n```"), "..ccc");
        assert_eq!(marks("-     a\n    ```\nb"), "...");
        assert_eq!(marks("1234567890. a\n   ```\nb"), ".cc");
    }

    #[test]
    fn fences_open_at_a_list_marker_and_inside_block_quotes() {
        assert_eq!(marks("- ```sh\n  make\n  ```\nafter"), "ccc.");
        assert_eq!(marks("- ```sh\n make\n ```\n  ```\nafter"), "cccc.");
        assert_eq!(marks("> ```\n> b\n> ```\nc"), "ccc.");
        assert_eq!(marks(">```\n>b\n>```"), "ccc");
        assert_eq!(marks("> > ~~~\n> > b\n> > ~~~"), "ccc");
        assert_eq!(marks("> ```\nb\n```\n> ```\nc"), "cccc.");
        assert_eq!(marks("```\n> b\n```"), "ccc");
        assert_eq!(marks("para\n```\nb\n```"), ".ccc");
        assert_eq!(marks("    > ```\nb"), "..");
    }

    #[test]
    fn fence_lines_drop_one_carriage_return_and_refuse_other_line_ends() {
        assert_eq!(marks("a\r\n```sh\r\nb\r\n```\r\nc"), ".ccc.");
        assert_eq!(marks("```sh\rx\nb"), "..");
        assert_eq!(marks("~~~\u{2028}\nb"), "..");
        assert_eq!(marks("```\u{2029}sh\nb"), "..");
        assert_eq!(marks("```\n```\r\r\nb"), "ccc");
        assert_eq!(marks("- a\n\u{a0}\n  ```\nb"), "..cc");
        assert_eq!(marks("-\u{a0}```\nb"), "..");
    }

    #[test]
    fn code_spans_match_a_run_of_the_same_length() {
        let chars: Vec<char> = "a ``b`c`` d `e` `f".chars().collect();
        let spans = CodeSpans::new(&chars);
        assert_eq!(run_at(&chars, 2, b'`'), 2);
        assert_eq!(spans.close(2, 2, chars.len()), Some(7));
        assert_eq!(spans.close(12, 1, chars.len()), Some(14));
        assert_eq!(spans.close(16, 1, chars.len()), None);
        assert_eq!(spans.close(12, 1, 14), None);
        let bytes = "\\``x`".as_bytes();
        let spans = CodeSpans::new(bytes);
        assert_eq!(run_at(bytes, 2, b'`'), 1);
        assert_eq!(spans.close(2, 1, bytes.len()), Some(4));
    }

    #[test]
    fn code_spans_stay_linear_on_long_unmatched_runs() {
        let mut line = String::new();
        for length in 1..2_000 {
            line.push_str(&"`".repeat(length));
            line.push('x');
        }
        let bytes = line.as_bytes();
        let spans = CodeSpans::new(bytes);
        let started = std::time::Instant::now();
        let mut index = 0;
        let mut found = 0;
        while index < bytes.len() {
            if bytes[index] != b'`' {
                index += 1;
                continue;
            }
            let run = run_at(bytes, index, b'`');
            if spans.close(index, run, bytes.len()).is_some() {
                found += 1;
            }
            index += run;
        }
        assert_eq!(found, 0);
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
    }

    #[test]
    fn brackets_pair_up_and_skip_escapes() {
        let chars: Vec<char> = "[a [b] \\] c] [d [e".chars().collect();
        let pairs = matching_brackets(&chars, b'[', b']');
        assert_eq!(pairs.get(&0), Some(&11));
        assert_eq!(pairs.get(&3), Some(&5));
        assert_eq!(pairs.len(), 2);
        assert_eq!(
            matching_brackets("[é](x)".as_bytes(), b'[', b']').get(&0),
            Some(&3)
        );
    }

    #[test]
    fn link_tails_read_destinations_and_titles() {
        let tail = |text: &str| {
            let chars: Vec<char> = text.chars().collect();
            link_tail(&chars, 0)
                .map(|(range, end)| (chars[range].iter().collect::<String>(), end == chars.len()))
        };
        assert_eq!(tail("(a(b)c)"), Some(("a(b)c".into(), true)));
        assert_eq!(tail("( <a b> \"t (x)\" )"), Some(("a b".into(), true)));
        assert_eq!(tail("(x 't \\' q')"), Some(("x".into(), true)));
        assert_eq!(tail("(a b)"), None);
        assert_eq!(tail("(<a)"), None);
        assert_eq!(tail("(a \"open)"), None);
        assert_eq!(tail("(a\\"), None);
        assert_eq!(tail("x(a)"), None);
        let bytes = "(é)".as_bytes();
        let (range, end) = link_tail(bytes, 0).unwrap();
        assert_eq!(std::str::from_utf8(&bytes[range]).unwrap(), "é");
        assert_eq!(end, bytes.len());
        assert_eq!(destination_at(&['a', '\\'], 0), Some((0..2, 2)));
    }

    #[test]
    fn block_markers_and_line_bodies() {
        assert_eq!(line_body("## Heading"), "Heading");
        assert_eq!(line_body("##"), "");
        assert_eq!(line_body("#tag"), "#tag");
        assert_eq!(line_body("####### seven"), "####### seven");
        assert_eq!(line_body("> - [x] Task done"), "Task done");
        assert_eq!(line_body("- [ ]x"), "[ ]x");
        assert_eq!(line_body("12. item"), "item");
        assert_eq!(line_body("12345678901. no"), "12345678901. no");
        assert_eq!(line_body("> [!note]+ Callout title"), "Callout title");
        assert_eq!(line_body(">[!tip] [x](y)"), "[x](y)");
        assert_eq!(line_body("[!note] not a callout"), "[!note] not a callout");
        assert_eq!(line_body("> [!bad name] kept"), "[!bad name] kept");
        assert_eq!(line_body("> [!see](x) link"), "[!see](x) link");
        assert_eq!(callout_marker_len("[!warning]- x"), Some(11));
    }
}
