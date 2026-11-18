use std::ops::Range;

const TICK: u8 = b'`';

fn tick_run_end(bytes: &[u8], from: usize) -> usize {
    let mut end = from;
    while bytes.get(end) == Some(&TICK) {
        end += 1;
    }
    end
}

fn closing_run(bytes: &[u8], from: usize, width: usize) -> Option<usize> {
    let mut at = from;
    while at < bytes.len() {
        if bytes[at] == TICK {
            let end = tick_run_end(bytes, at);
            if end - at == width {
                return Some(end);
            }
            at = end;
        } else {
            at += 1;
        }
    }
    None
}

fn escapes(bytes: &[u8], at: usize) -> bool {
    bytes[at] == b'\\' && bytes.get(at + 1).is_some_and(u8::is_ascii_punctuation)
}

pub fn code_spans(body: &str) -> Vec<Range<usize>> {
    let bytes = body.as_bytes();
    let mut spans = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        if escapes(bytes, at) {
            at += 2;
        } else if bytes[at] == TICK {
            let open = tick_run_end(bytes, at);
            match closing_run(bytes, open, open - at) {
                Some(end) => {
                    spans.push(at..end);
                    at = end;
                }
                None => at = open,
            }
        } else {
            at += 1;
        }
    }
    spans
}

#[derive(Clone, Copy)]
struct Piece {
    character: char,
    marker: bool,
}

fn code_text(inner: &str) -> &str {
    let padded = inner.len() >= 2
        && inner.starts_with(' ')
        && inner.ends_with(' ')
        && !inner.chars().all(|character| character == ' ');
    if padded {
        &inner[1..inner.len() - 1]
    } else {
        inner
    }
}

fn pieces_of(body: &str) -> Vec<Piece> {
    let bytes = body.as_bytes();
    let mut spans = code_spans(body).into_iter().peekable();
    let mut pieces = Vec::with_capacity(body.len());
    let mut at = 0;
    while at < body.len() {
        if let Some(span) = spans.next_if(|span| span.start == at) {
            let width = tick_run_end(bytes, at) - at;
            let inner = code_text(&body[span.start + width..span.end - width]);
            pieces.extend(inner.chars().map(|character| Piece {
                character,
                marker: false,
            }));
            at = span.end;
            continue;
        }
        if escapes(bytes, at) {
            pieces.push(Piece {
                character: char::from(bytes[at + 1]),
                marker: false,
            });
            at += 2;
            continue;
        }
        let Some(character) = body[at..].chars().next() else {
            break;
        };
        pieces.push(Piece {
            character,
            marker: true,
        });
        at += character.len_utf8();
    }
    pieces
}

struct Delimiter {
    marker: char,
    width: usize,
    inside_words: bool,
    alone: bool,
}

impl Delimiter {
    fn same(&self, piece: Option<&Piece>) -> bool {
        piece.is_some_and(|piece| piece.marker && piece.character == self.marker)
    }

    fn run(&self, pieces: &[Piece], at: usize) -> bool {
        let whole = pieces.get(at..at + self.width).is_some_and(|run| {
            run.iter()
                .all(|piece| piece.marker && piece.character == self.marker)
        });
        let before = at.checked_sub(1).and_then(|index| pieces.get(index));
        whole && (!self.alone || !(self.same(before) || self.same(pieces.get(at + self.width))))
    }

    fn opens(&self, pieces: &[Piece], at: usize) -> bool {
        let after = pieces.get(at + self.width);
        let before = at.checked_sub(1).and_then(|index| pieces.get(index));
        self.run(pieces, at)
            && after.is_some_and(|piece| !piece.character.is_whitespace())
            && (self.inside_words || before.is_none_or(|piece| !piece.character.is_alphanumeric()))
    }

    fn closes(&self, pieces: &[Piece], at: usize) -> bool {
        let before = at.checked_sub(1).and_then(|index| pieces.get(index));
        let after = pieces.get(at + self.width);
        self.run(pieces, at)
            && before.is_some_and(|piece| !piece.character.is_whitespace())
            && (self.inside_words || after.is_none_or(|piece| !piece.character.is_alphanumeric()))
    }

    fn unwrap(&self, pieces: Vec<Piece>) -> Vec<Piece> {
        let closers: Vec<usize> = (0..pieces.len())
            .filter(|at| self.closes(&pieces, *at))
            .collect();
        let mut removed = vec![false; pieces.len()];
        let mut next = 0;
        let mut at = 0;
        while at + self.width <= pieces.len() {
            if !self.opens(&pieces, at) {
                at += 1;
                continue;
            }
            while closers
                .get(next)
                .is_some_and(|close| *close <= at + self.width)
            {
                next += 1;
            }
            let Some(&close) = closers.get(next) else {
                break;
            };
            for index in (at..at + self.width).chain(close..close + self.width) {
                removed[index] = true;
            }
            at = close + self.width;
            next += 1;
        }
        pieces
            .into_iter()
            .zip(removed)
            .filter_map(|(piece, gone)| (!gone).then_some(piece))
            .collect()
    }
}

const DELIMITERS: [Delimiter; 4] = [
    Delimiter {
        marker: '*',
        width: 2,
        inside_words: true,
        alone: false,
    },
    Delimiter {
        marker: '~',
        width: 2,
        inside_words: true,
        alone: false,
    },
    Delimiter {
        marker: '_',
        width: 1,
        inside_words: false,
        alone: false,
    },
    Delimiter {
        marker: '*',
        width: 1,
        inside_words: true,
        alone: true,
    },
];

pub fn plain_text(body: &str) -> String {
    DELIMITERS
        .iter()
        .fold(pieces_of(body), |pieces, delimiter| {
            delimiter.unwrap(pieces)
        })
        .into_iter()
        .map(|piece| piece.character)
        .collect()
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::*;

    #[test]
    fn bold_italic_strike_and_code_markers_go_and_their_text_stays() {
        assert_eq!(
            plain_text("**Bold** and _italic_ and ~~struck~~ and `code`"),
            "Bold and italic and struck and code"
        );
        assert_eq!(plain_text("**_both_** here"), "both here");
        assert_eq!(plain_text("x**bold**y"), "xboldy");
    }

    #[test]
    fn single_asterisk_italic_goes_like_underscore_italic() {
        assert_eq!(
            plain_text("Does the diagonal block count towards *k*? We said **no** on Thursday."),
            "Does the diagonal block count towards k? We said no on Thursday."
        );
        assert_eq!(plain_text("***both*** here"), "both here");
        assert_eq!(plain_text("*a **b** c*"), "a b c");
        for body in ["2 * 3 * 4", "* not italic *", "2 ** 3", "a*"] {
            assert_eq!(plain_text(body), body);
        }
    }

    #[test]
    fn list_markers_and_mentions_stay() {
        let lists = "- first\n- second\n1. one\n2. two";
        assert_eq!(plain_text(lists), lists);
        assert_eq!(
            plain_text("@Ana Lima can you check?"),
            "@Ana Lima can you check?"
        );
        assert_eq!(plain_text("- **bold** item"), "- bold item");
    }

    #[test]
    fn lone_or_spaced_markers_are_plain_characters() {
        for body in [
            "snake_case_name and file_name.tex",
            "2 ** 3 and 4 ** 5",
            "**open but never closed",
            "a ~ b ~~ c",
            "_ alone _",
            "`unclosed code",
            "****",
        ] {
            assert_eq!(plain_text(body), body);
        }
    }

    #[test]
    fn code_keeps_markers_and_escapes_become_their_characters() {
        assert_eq!(plain_text("`**not bold**`"), "**not bold**");
        assert_eq!(plain_text("`` a ` b ``"), "a ` b");
        assert_eq!(plain_text("\\*\\*not bold\\*\\*"), "**not bold**");
        assert_eq!(plain_text("\\`not code\\`"), "`not code`");
        assert_eq!(plain_text("a \\\\ b and \\section"), "a \\ b and \\section");
    }

    #[test]
    fn code_spans_are_found_by_byte_range_and_skip_escaped_ticks() {
        let body = "see `@Ana` and ``a`b`` but \\`@Bo\\` and 🦊 `x`";
        let spans: Vec<&str> = code_spans(body)
            .into_iter()
            .map(|span| &body[span])
            .collect();
        assert_eq!(spans, ["`@Ana`", "``a`b``", "`x`"]);
        assert!(code_spans("`never closed").is_empty());
    }

    #[test]
    fn many_unclosed_markers_stay_quick() {
        let body = "**a _b ~~c ".repeat(2_000);
        let started = Instant::now();
        assert_eq!(plain_text(&body), body);
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
