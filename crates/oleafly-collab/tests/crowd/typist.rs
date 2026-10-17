#![allow(dead_code)]

use oleafly_collab::editor::DocMessage;
use oleafly_collab::ot::{utf16_len, Component, OtError, TextOperation};

pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed ^ 0x5DEE_CE66_D1CE_4E5B)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    pub fn below(&mut self, bound: usize) -> usize {
        if bound == 0 {
            return 0;
        }
        (self.next_u64() % bound as u64) as usize
    }

    pub fn chance(&mut self, percent: u64) -> bool {
        self.next_u64() % 100 < percent
    }

    pub fn between(&mut self, low: u64, high: u64) -> u64 {
        if high <= low {
            return low;
        }
        low + self.next_u64() % (high - low + 1)
    }

    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len())]
    }
}

pub const NAMES: &[&str] = &[
    "Bob Smith",
    "Dana Lee",
    "Evan Park",
    "Farah Khan",
    "Gabriel Silva",
    "Hana Sato",
    "Ivan Petrov",
    "Jamal Wright",
    "Keiko Tanaka",
    "Liam Murphy",
    "Maya Patel",
    "Noah Fischer",
    "Olivia Rossi",
    "Pablo Garcia",
    "Quinn Taylor",
    "Rosa Martinez",
    "Samir Haddad",
    "Tara Singh",
    "Umar Farouk",
    "Vera Novak",
    "Wei Zhang",
    "Ximena Lopez",
    "Yusuf Demir",
    "Zoe Clarke",
    "Aiden Brooks",
    "Bianca Costa",
    "Chen Wu",
    "Diego Ramos",
    "Elena Ivanova",
    "Felix Wagner",
    "Grace Kim",
    "Hugo Laurent",
    "Isla Grant",
    "Jonas Berg",
    "Kavya Rao",
    "Lucas Moreau",
    "Mina Choi",
    "Nadia Hassan",
    "Oscar Lindqvist",
    "Priya Nair",
    "Rafael Souza",
    "Sofia Greco",
    "Tomas Novotny",
    "Uma Iyer",
    "Viktor Horvath",
    "Wren Okafor",
    "Yara Haddad",
    "Zain Malik",
    "Amara Obi",
    "Bruno Keller",
    "Clara Jensen",
    "Dmitri Volkov",
    "Esther Cohen",
    "Fiona Walsh",
    "Goran Petrovic",
    "Helen Zhou",
    "Ines Duarte",
    "Jun Ito",
    "Kofi Mensah",
    "Leila Ahmadi",
    "Mateo Herrera",
    "Nina Kowalski",
];

pub const WORDS: &[&str] = &[
    "model",
    "results",
    "data",
    "method",
    "analysis",
    "sample",
    "error",
    "bound",
    "theorem",
    "proof",
    "lemma",
    "baseline",
    "variance",
    "estimate",
    "network",
    "signal",
    "protocol",
    "latency",
    "throughput",
    "dataset",
    "figure",
    "table",
    "section",
    "appendix",
    "parameter",
    "gradient",
    "kernel",
    "cluster",
    "sensor",
    "trial",
    "cohort",
    "measure",
    "effect",
    "regime",
    "boundary",
    "solver",
    "matrix",
    "vector",
    "graph",
    "cache",
    "replica",
    "server",
    "client",
];

pub const PHRASES: &[&str] = &[
    "as shown in the previous section",
    "we observe that",
    "the results suggest a clear trend",
    "in contrast to prior work",
    "under mild assumptions",
    "see Table 2 for details",
    "this holds for every sample",
    "with high probability",
    "the error stays below one percent",
    "we leave this to future work",
    "following the standard setup",
    "the baseline fails here",
    "a simple argument shows",
    "on all three datasets",
    "as expected",
    "which matches the theory",
    "after a short warm-up",
    "for a fixed budget",
];

pub const SPICE: &[&str] = &["é", "ü", "π", "→", "≤", "😀", "Ω", "ß", "∑"];

pub fn phrase(rng: &mut Rng) -> String {
    let mut text = match rng.below(10) {
        0..=4 => format!("{} ", rng.pick(WORDS)),
        5..=8 => format!("{} ", rng.pick(PHRASES)),
        _ => format!("{} {} ", rng.pick(WORDS), rng.pick(SPICE)),
    };
    if rng.chance(8) {
        text.insert(0, '\n');
    }
    text
}

pub fn keystroke(rng: &mut Rng) -> String {
    if rng.chance(3) {
        return (*rng.pick(SPICE)).to_owned();
    }
    let letters = b"etaoinshrdlucmfwypvbgk  ";
    let letter = letters[rng.below(letters.len())];
    char::from(letter).to_string()
}

pub fn byte_index(text: &str, unit: usize) -> usize {
    let mut units = 0;
    for (index, character) in text.char_indices() {
        let width = character.len_utf16();
        if units + width > unit {
            return index;
        }
        units += width;
    }
    text.len()
}

pub fn unit_index(text: &str, byte: usize) -> usize {
    let mut byte = byte.min(text.len());
    while !text.is_char_boundary(byte) {
        byte -= 1;
    }
    utf16_len(&text[..byte])
}

pub fn random_unit(text: &str, rng: &mut Rng) -> usize {
    if text.is_empty() {
        return 0;
    }
    unit_index(text, rng.below(text.len() + 1))
}

pub fn insertion(total: usize, at: usize, text: &str) -> TextOperation {
    let mut operation = TextOperation::new();
    operation.retain(at).insert(text).retain(total - at);
    operation
}

pub fn deletion(total: usize, at: usize, count: usize) -> TextOperation {
    let mut operation = TextOperation::new();
    operation
        .retain(at)
        .delete(count)
        .retain(total - at - count);
    operation
}

pub fn map_position(operation: &TextOperation, position: usize) -> usize {
    let mut old = 0;
    let mut new = 0;
    for component in operation.components() {
        match component {
            Component::Retain(count) => {
                if position <= old + count {
                    return new + position - old;
                }
                old += count;
                new += count;
            }
            Component::Insert(text) => {
                if position == old {
                    return new;
                }
                new += utf16_len(text);
            }
            Component::Delete(count) => {
                if position <= old + count {
                    return new;
                }
                old += count;
            }
        }
    }
    new
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reaction {
    Nothing,
    Send(u64, TextOperation),
    Resync,
}

pub struct EditorDoc {
    pub file_id: String,
    pub generation: u64,
    pub content: String,
    pub length: usize,
    pub server_rev: u64,
    pub outstanding: Option<TextOperation>,
    pub buffer: Option<TextOperation>,
    pub cursor: usize,
    pub resets: u64,
    pub resyncs: u64,
    pub lost_edits: u64,
}

impl EditorDoc {
    pub fn opened(file_id: &str, generation: u64, rev: u64, text: String) -> EditorDoc {
        let length = utf16_len(&text);
        EditorDoc {
            file_id: file_id.to_owned(),
            generation,
            content: text,
            length,
            server_rev: rev,
            outstanding: None,
            buffer: None,
            cursor: 0,
            resets: 0,
            resyncs: 0,
            lost_edits: 0,
        }
    }

    pub fn reopened(&mut self, generation: u64, rev: u64, text: String) {
        if self.buffer.is_some() {
            self.lost_edits += 1;
        }
        self.resyncs += 1;
        self.generation = generation;
        self.server_rev = rev;
        self.outstanding = None;
        self.buffer = None;
        self.length = utf16_len(&text);
        self.content = text;
        self.cursor = self.cursor.min(self.length);
    }

    pub fn synchronized(&self) -> bool {
        self.outstanding.is_none() && self.buffer.is_none()
    }

    fn clamp_cursor(&mut self) -> usize {
        let byte = byte_index(&self.content, self.cursor.min(self.length));
        self.cursor = unit_index(&self.content, byte);
        self.cursor
    }

    pub fn jump(&mut self, unit: usize) {
        self.cursor = unit.min(self.length);
        self.clamp_cursor();
    }

    pub fn jump_random(&mut self, rng: &mut Rng) {
        self.cursor = random_unit(&self.content, rng);
    }

    fn local(&mut self, operation: TextOperation) -> Result<Option<(u64, TextOperation)>, OtError> {
        if operation.is_noop() {
            return Ok(None);
        }
        self.content = operation.apply(&self.content)?;
        self.length = operation.target_len();
        if self.outstanding.is_none() {
            self.outstanding = Some(operation.clone());
            return Ok(Some((self.server_rev, operation)));
        }
        self.buffer = Some(match self.buffer.take() {
            Some(buffer) => buffer.compose(&operation)?,
            None => operation,
        });
        Ok(None)
    }

    pub fn type_text(&mut self, text: &str) -> Result<Option<(u64, TextOperation)>, OtError> {
        let at = self.clamp_cursor();
        let operation = insertion(self.length, at, text);
        let sent = self.local(operation)?;
        self.cursor = at + utf16_len(text);
        Ok(sent)
    }

    pub fn backspace(
        &mut self,
        characters: usize,
    ) -> Result<Option<(u64, TextOperation)>, OtError> {
        let at = self.clamp_cursor();
        let end = byte_index(&self.content, at);
        let start = self.content[..end]
            .char_indices()
            .rev()
            .take(characters)
            .last()
            .map_or(end, |(index, _)| index);
        let count = utf16_len(&self.content[start..end]);
        if count == 0 {
            return Ok(None);
        }
        let operation = deletion(self.length, at - count, count);
        let sent = self.local(operation)?;
        self.cursor = at - count;
        Ok(sent)
    }

    pub fn delete_ahead(
        &mut self,
        characters: usize,
    ) -> Result<Option<(u64, TextOperation)>, OtError> {
        let at = self.clamp_cursor();
        let start = byte_index(&self.content, at);
        let end = self.content[start..]
            .char_indices()
            .nth(characters)
            .map_or(self.content.len(), |(index, _)| start + index);
        let count = utf16_len(&self.content[start..end]);
        if count == 0 {
            return Ok(None);
        }
        let operation = deletion(self.length, at, count);
        self.local(operation)
    }

    pub fn receive(&mut self, message: DocMessage) -> Reaction {
        match message {
            DocMessage::Ack { rev, length } => {
                if self.outstanding.is_none() {
                    return Reaction::Resync;
                }
                self.server_rev = rev;
                if let Some(buffer) = self.buffer.take() {
                    self.outstanding = Some(buffer.clone());
                    return Reaction::Send(rev, buffer);
                }
                self.outstanding = None;
                if self.length != length {
                    return Reaction::Resync;
                }
                Reaction::Nothing
            }
            DocMessage::Remote { rev, op, length } => match self.remote(rev, op, length) {
                Ok(reaction) => reaction,
                Err(_) => Reaction::Resync,
            },
            DocMessage::Reset { rev, text } => {
                if !self.synchronized() {
                    self.lost_edits += 1;
                }
                self.resets += 1;
                self.server_rev = rev;
                self.outstanding = None;
                self.buffer = None;
                self.length = utf16_len(&text);
                self.content = text;
                self.clamp_cursor();
                Reaction::Nothing
            }
        }
    }

    fn remote(
        &mut self,
        rev: u64,
        operation: TextOperation,
        length: usize,
    ) -> Result<Reaction, OtError> {
        let mut operation = operation;
        if let Some(outstanding) = self.outstanding.take() {
            let (outstanding, after) = TextOperation::transform(&outstanding, &operation)?;
            self.outstanding = Some(outstanding);
            operation = after;
            if let Some(buffer) = self.buffer.take() {
                let (buffer, after) = TextOperation::transform(&buffer, &operation)?;
                self.buffer = Some(buffer);
                operation = after;
            }
        }
        self.server_rev = rev;
        self.content = operation.apply(&self.content)?;
        self.length = operation.target_len();
        self.cursor = map_position(&operation, self.cursor);
        if self.outstanding.is_none() && self.length != length {
            return Ok(Reaction::Resync);
        }
        Ok(Reaction::Nothing)
    }
}
