use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Component {
    Retain(usize),
    Insert(String),
    Delete(usize),
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TextOperation {
    ops: Vec<Component>,
    base_len: usize,
    target_len: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum OtError {
    #[error("the change does not fit the document")]
    LengthMismatch,
    #[error("the changes do not line up")]
    Incompatible,
    #[error("the change splits a character in two")]
    SplitsCharacter,
}

pub fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

pub(crate) fn split_utf16(text: &str, at: usize) -> Result<(&str, &str), OtError> {
    let mut units = 0;
    for (index, character) in text.char_indices() {
        if units == at {
            return Ok(text.split_at(index));
        }
        units += character.len_utf16();
        if units > at {
            return Err(OtError::SplitsCharacter);
        }
    }
    if units == at {
        Ok((text, ""))
    } else {
        Err(OtError::LengthMismatch)
    }
}

fn remainder(
    count: usize,
    step: usize,
    rebuild: fn(usize) -> Component,
    rest: &mut impl Iterator<Item = Component>,
) -> Option<Component> {
    if count > step {
        Some(rebuild(count - step))
    } else {
        rest.next()
    }
}

impl TextOperation {
    pub fn new() -> TextOperation {
        TextOperation::default()
    }

    pub fn between(old: &str, new: &str) -> TextOperation {
        let prefix: usize = old
            .chars()
            .zip(new.chars())
            .take_while(|(a, b)| a == b)
            .map(|(a, _)| a.len_utf8())
            .sum();
        let (old_rest, new_rest) = (&old[prefix..], &new[prefix..]);
        let suffix: usize = old_rest
            .chars()
            .rev()
            .zip(new_rest.chars().rev())
            .take_while(|(a, b)| a == b)
            .map(|(a, _)| a.len_utf8())
            .sum();
        let removed = &old_rest[..old_rest.len() - suffix];
        let added = &new_rest[..new_rest.len() - suffix];
        let mut operation = TextOperation::new();
        operation
            .retain(utf16_len(&old[..prefix]))
            .delete(utf16_len(removed))
            .insert(added)
            .retain(utf16_len(&old_rest[old_rest.len() - suffix..]));
        operation
    }

    pub fn components(&self) -> &[Component] {
        &self.ops
    }

    pub fn base_len(&self) -> usize {
        self.base_len
    }

    pub fn target_len(&self) -> usize {
        self.target_len
    }

    pub fn is_noop(&self) -> bool {
        self.ops.iter().all(|op| matches!(op, Component::Retain(_)))
    }

    pub fn retain(&mut self, count: usize) -> &mut TextOperation {
        if count == 0 {
            return self;
        }
        self.base_len += count;
        self.target_len += count;
        if let Some(Component::Retain(last)) = self.ops.last_mut() {
            *last += count;
        } else {
            self.ops.push(Component::Retain(count));
        }
        self
    }

    pub fn insert(&mut self, text: &str) -> &mut TextOperation {
        if text.is_empty() {
            return self;
        }
        self.target_len += utf16_len(text);
        let length = self.ops.len();
        match self.ops.last_mut() {
            Some(Component::Insert(last)) => last.push_str(text),
            Some(Component::Delete(_)) => {
                if length >= 2 {
                    if let Component::Insert(previous) = &mut self.ops[length - 2] {
                        previous.push_str(text);
                        return self;
                    }
                }
                self.ops
                    .insert(length - 1, Component::Insert(text.to_owned()));
            }
            _ => self.ops.push(Component::Insert(text.to_owned())),
        }
        self
    }

    pub fn delete(&mut self, count: usize) -> &mut TextOperation {
        if count == 0 {
            return self;
        }
        self.base_len += count;
        if let Some(Component::Delete(last)) = self.ops.last_mut() {
            *last += count;
        } else {
            self.ops.push(Component::Delete(count));
        }
        self
    }

    fn push(&mut self, component: Component) {
        match component {
            Component::Retain(count) => self.retain(count),
            Component::Insert(text) => self.insert(&text),
            Component::Delete(count) => self.delete(count),
        };
    }

    pub fn apply(&self, document: &str) -> Result<String, OtError> {
        if utf16_len(document) != self.base_len {
            return Err(OtError::LengthMismatch);
        }
        let mut output = String::with_capacity(document.len());
        let mut rest = document;
        for op in &self.ops {
            match op {
                Component::Retain(count) => {
                    let (kept, after) = split_utf16(rest, *count)?;
                    output.push_str(kept);
                    rest = after;
                }
                Component::Insert(text) => output.push_str(text),
                Component::Delete(count) => {
                    rest = split_utf16(rest, *count)?.1;
                }
            }
        }
        output.push_str(rest);
        Ok(output)
    }

    pub fn compose(&self, other: &TextOperation) -> Result<TextOperation, OtError> {
        if self.target_len != other.base_len {
            return Err(OtError::LengthMismatch);
        }
        let mut result = TextOperation::new();
        let mut first = self.ops.iter().cloned();
        let mut second = other.ops.iter().cloned();
        let mut a = first.next();
        let mut b = second.next();
        loop {
            match (a.take(), b.take()) {
                (None, None) => break,
                (Some(Component::Delete(count)), next) => {
                    result.delete(count);
                    a = first.next();
                    b = next;
                }
                (next, Some(Component::Insert(text))) => {
                    result.insert(&text);
                    a = next;
                    b = second.next();
                }
                (None, _) | (_, None) => return Err(OtError::Incompatible),
                (Some(Component::Retain(x)), Some(Component::Retain(y))) => {
                    let step = x.min(y);
                    result.retain(step);
                    a = remainder(x, step, Component::Retain, &mut first);
                    b = remainder(y, step, Component::Retain, &mut second);
                }
                (Some(Component::Insert(text)), Some(Component::Delete(y))) => {
                    let length = utf16_len(&text);
                    let step = length.min(y);
                    a = if length > step {
                        Some(Component::Insert(split_utf16(&text, step)?.1.to_owned()))
                    } else {
                        first.next()
                    };
                    b = remainder(y, step, Component::Delete, &mut second);
                }
                (Some(Component::Insert(text)), Some(Component::Retain(y))) => {
                    let length = utf16_len(&text);
                    let step = length.min(y);
                    let (head, tail) = split_utf16(&text, step)?;
                    result.insert(head);
                    a = if length > step {
                        Some(Component::Insert(tail.to_owned()))
                    } else {
                        first.next()
                    };
                    b = remainder(y, step, Component::Retain, &mut second);
                }
                (Some(Component::Retain(x)), Some(Component::Delete(y))) => {
                    let step = x.min(y);
                    result.delete(step);
                    a = remainder(x, step, Component::Retain, &mut first);
                    b = remainder(y, step, Component::Delete, &mut second);
                }
            }
        }
        Ok(result)
    }

    pub fn transform(
        client: &TextOperation,
        server: &TextOperation,
    ) -> Result<(TextOperation, TextOperation), OtError> {
        if client.base_len != server.base_len {
            return Err(OtError::LengthMismatch);
        }
        let mut client_prime = TextOperation::new();
        let mut server_prime = TextOperation::new();
        let mut first = client.ops.iter().cloned();
        let mut second = server.ops.iter().cloned();
        let mut a = first.next();
        let mut b = second.next();
        loop {
            match (a.take(), b.take()) {
                (None, None) => break,
                (Some(Component::Insert(text)), next) => {
                    server_prime.retain(utf16_len(&text));
                    client_prime.insert(&text);
                    a = first.next();
                    b = next;
                }
                (next, Some(Component::Insert(text))) => {
                    client_prime.retain(utf16_len(&text));
                    server_prime.insert(&text);
                    a = next;
                    b = second.next();
                }
                (None, _) | (_, None) => return Err(OtError::Incompatible),
                (Some(Component::Retain(x)), Some(Component::Retain(y))) => {
                    let step = x.min(y);
                    client_prime.retain(step);
                    server_prime.retain(step);
                    a = remainder(x, step, Component::Retain, &mut first);
                    b = remainder(y, step, Component::Retain, &mut second);
                }
                (Some(Component::Delete(x)), Some(Component::Delete(y))) => {
                    let step = x.min(y);
                    a = remainder(x, step, Component::Delete, &mut first);
                    b = remainder(y, step, Component::Delete, &mut second);
                }
                (Some(Component::Delete(x)), Some(Component::Retain(y))) => {
                    let step = x.min(y);
                    client_prime.delete(step);
                    a = remainder(x, step, Component::Delete, &mut first);
                    b = remainder(y, step, Component::Retain, &mut second);
                }
                (Some(Component::Retain(x)), Some(Component::Delete(y))) => {
                    let step = x.min(y);
                    server_prime.delete(step);
                    a = remainder(x, step, Component::Retain, &mut first);
                    b = remainder(y, step, Component::Delete, &mut second);
                }
            }
        }
        Ok((client_prime, server_prime))
    }
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum Wire {
    Count(i64),
    Text(String),
}

impl Serialize for TextOperation {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let wire: Vec<Wire> = self
            .ops
            .iter()
            .map(|op| match op {
                Component::Retain(count) => Wire::Count(*count as i64),
                Component::Insert(text) => Wire::Text(text.clone()),
                Component::Delete(count) => Wire::Count(-(*count as i64)),
            })
            .collect();
        wire.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for TextOperation {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let wire = Vec::<Wire>::deserialize(deserializer)?;
        let mut operation = TextOperation::new();
        for item in wire {
            match item {
                Wire::Count(0) => return Err(D::Error::custom("an operation step cannot be zero")),
                Wire::Count(count) if count > 0 => {
                    operation.push(Component::Retain(count as usize));
                }
                Wire::Count(count) => {
                    operation.push(Component::Delete(count.unsigned_abs() as usize))
                }
                Wire::Text(text) if text.is_empty() => {
                    return Err(D::Error::custom("an inserted text cannot be empty"))
                }
                Wire::Text(text) => operation.push(Component::Insert(text)),
            }
        }
        Ok(operation)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn op(build: impl FnOnce(&mut TextOperation)) -> TextOperation {
        let mut operation = TextOperation::new();
        build(&mut operation);
        operation
    }

    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }

        fn below(&mut self, bound: usize) -> usize {
            if bound == 0 {
                0
            } else {
                (self.next() % bound as u64) as usize
            }
        }
    }

    const ALPHABET: [&str; 6] = ["a", "b", "\n", "é", "😀", "z"];

    fn random_text(rng: &mut Rng, max: usize) -> String {
        (0..rng.below(max))
            .map(|_| ALPHABET[rng.below(ALPHABET.len())])
            .collect()
    }

    fn random_operation(rng: &mut Rng, document: &str) -> TextOperation {
        let mut operation = TextOperation::new();
        let characters: Vec<char> = document.chars().collect();
        let mut index = 0;
        while index < characters.len() {
            let span = 1 + rng.below((characters.len() - index).min(4));
            let units: usize = characters[index..index + span]
                .iter()
                .map(|c| c.len_utf16())
                .sum();
            match rng.below(3) {
                0 => {
                    operation.retain(units);
                }
                1 => {
                    operation.delete(units);
                }
                _ => {
                    operation.insert(&random_text(rng, 3));
                    operation.retain(units);
                }
            }
            index += span;
        }
        if rng.below(2) == 0 {
            operation.insert(&random_text(rng, 4));
        }
        operation
    }

    #[test]
    fn steps_merge_and_inserts_stay_before_deletes() {
        let built = op(|o| {
            o.retain(2)
                .retain(1)
                .delete(1)
                .insert("x")
                .insert("y")
                .delete(2);
        });
        assert_eq!(
            built.components(),
            &[
                Component::Retain(3),
                Component::Insert("xy".to_owned()),
                Component::Delete(3)
            ]
        );
        assert_eq!(built.base_len(), 6);
        assert_eq!(built.target_len(), 5);
    }

    #[test]
    fn lengths_count_utf16_units() {
        let emoji = op(|o| {
            o.retain(2).insert("😀");
        });
        assert_eq!(emoji.target_len(), 4);
        assert_eq!(emoji.apply("😀").unwrap(), "😀😀");
        assert_eq!(
            op(|o| {
                o.retain(1).delete(1);
            })
            .apply("😀"),
            Err(OtError::SplitsCharacter)
        );
        assert_eq!(emoji.apply("ab c"), Err(OtError::LengthMismatch));
    }

    #[test]
    fn the_wire_form_is_numbers_and_strings() {
        let operation = op(|o| {
            o.retain(5).insert("hi").delete(2);
        });
        let json = serde_json::to_string(&operation).unwrap();
        assert_eq!(json, r#"[5,"hi",-2]"#);
        assert_eq!(
            serde_json::from_str::<TextOperation>(&json).unwrap(),
            operation
        );
        assert!(serde_json::from_str::<TextOperation>("[0]").is_err());
        assert!(serde_json::from_str::<TextOperation>(r#"[""]"#).is_err());
    }

    #[test]
    fn a_client_insert_goes_before_a_server_insert_at_the_same_place() {
        let client = op(|o| {
            o.retain(1).insert("C").retain(1);
        });
        let server = op(|o| {
            o.retain(1).insert("S").retain(1);
        });
        let (client_prime, server_prime) = TextOperation::transform(&client, &server).unwrap();
        let via_server = client_prime.apply(&server.apply("ab").unwrap()).unwrap();
        let via_client = server_prime.apply(&client.apply("ab").unwrap()).unwrap();
        assert_eq!(via_server, "aCSb");
        assert_eq!(via_client, "aCSb");
    }

    #[test]
    fn random_concurrent_edits_converge_and_compose() {
        let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
        for _ in 0..2_000 {
            let document = random_text(&mut rng, 12);
            let a = random_operation(&mut rng, &document);
            let b = random_operation(&mut rng, &document);
            let (a_prime, b_prime) = TextOperation::transform(&a, &b).unwrap();
            let left = b_prime.apply(&a.apply(&document).unwrap()).unwrap();
            let right = a_prime.apply(&b.apply(&document).unwrap()).unwrap();
            assert_eq!(left, right, "document {document:?} a {a:?} b {b:?}");
            let after_a = a.apply(&document).unwrap();
            let c = random_operation(&mut rng, &after_a);
            let composed = a.compose(&c).unwrap();
            assert_eq!(
                composed.apply(&document).unwrap(),
                c.apply(&after_a).unwrap()
            );
        }
    }

    #[test]
    fn the_change_between_two_texts_applies_and_merges_with_another() {
        let base = "one two three";
        let disk = "one 2 three";
        let doc = "one two three four";
        let from_disk = TextOperation::between(base, disk);
        assert_eq!(from_disk.apply(base).unwrap(), disk);
        let from_doc = TextOperation::between(base, doc);
        let (disk_after_doc, _) = TextOperation::transform(&from_disk, &from_doc).unwrap();
        assert_eq!(disk_after_doc.apply(doc).unwrap(), "one 2 three four");
        assert!(TextOperation::between("same", "same").is_noop());
        let emoji = TextOperation::between("a😀b", "a😀😀b");
        assert_eq!(emoji.apply("a😀b").unwrap(), "a😀😀b");
    }

    #[test]
    fn operations_on_different_documents_are_refused() {
        let a = op(|o| {
            o.retain(3);
        });
        let b = op(|o| {
            o.retain(4);
        });
        assert_eq!(
            TextOperation::transform(&a, &b),
            Err(OtError::LengthMismatch)
        );
        assert_eq!(a.compose(&b), Err(OtError::LengthMismatch));
    }
}
