use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use loro::event::Diff;
use loro::{LoroDoc, TextDelta, UpdateOptions};

use crate::doc::delta_to_operation;
use crate::ot::{split_utf16, utf16_len, Component, OtError, TextOperation};

const DIFF_BUDGET: Duration = Duration::from_millis(400);
const DISTANCE_BUDGET: Duration = Duration::from_millis(40);
const DIFF_TEXT: &str = "diff";
const PAIRED_BLOCK: usize = 4_096;

struct Budget(Instant);

impl Budget {
    fn of(length: Duration) -> Budget {
        Budget(Instant::now() + length)
    }

    fn left_ms(&self) -> Option<f64> {
        let left = self.0.saturating_duration_since(Instant::now());
        (!left.is_zero()).then_some(left.as_secs_f64() * 1_000.0)
    }
}

fn common_prefix(old: &str, new: &str) -> usize {
    old.char_indices()
        .zip(new.chars())
        .find(|((_, a), b)| a != b)
        .map_or(old.len().min(new.len()), |((at, _), _)| at)
}

fn common_suffix(old: &str, new: &str) -> usize {
    old.chars()
        .rev()
        .zip(new.chars().rev())
        .take_while(|(a, b)| a == b)
        .map(|(a, _)| a.len_utf8())
        .sum()
}

fn append(target: &mut TextOperation, extra: &TextOperation) {
    for component in extra.components() {
        match component {
            Component::Retain(count) => target.retain(*count),
            Component::Insert(text) => target.insert(text),
            Component::Delete(count) => target.delete(*count),
        };
    }
}

fn replacement(old: &str, new: &str) -> TextOperation {
    let mut operation = TextOperation::new();
    operation.insert(new).delete(utf16_len(old));
    operation
}

fn scripted(old: &str, new: &str, by_line: bool, budget: &Budget) -> Option<TextOperation> {
    let timeout_ms = budget.left_ms()?;
    let doc = LoroDoc::new();
    let text = doc.get_text(DIFF_TEXT);
    text.insert(0, old).ok()?;
    doc.commit();
    let seen: Arc<Mutex<Vec<Vec<TextDelta>>>> = Arc::default();
    let sink = Arc::clone(&seen);
    let _subscription = doc.subscribe_root(Arc::new(move |event| {
        let mut seen = sink.lock().unwrap_or_else(PoisonError::into_inner);
        for change in &event.events {
            if let Diff::Text(deltas) = &change.diff {
                seen.push(deltas.clone());
            }
        }
    }));
    let options = UpdateOptions {
        timeout_ms: Some(timeout_ms),
        use_refined_diff: false,
    };
    let applied = if by_line {
        text.update_by_line(new, options)
    } else {
        text.update(new, options)
    };
    applied.ok()?;
    doc.commit();
    let batches = std::mem::take(&mut *seen.lock().unwrap_or_else(PoisonError::into_inner));
    let mut current = old.to_owned();
    let mut script = TextOperation::new();
    script.retain(utf16_len(old));
    for deltas in batches {
        let step = delta_to_operation(&current, &deltas).ok()?;
        current = step.apply(&current).ok()?;
        script = script.compose(&step).ok()?;
    }
    (current == new).then_some(script)
}

enum Piece {
    Same(String),
    Changed { removed: String, added: String },
}

fn push_change(pieces: &mut Vec<Piece>, removed: &str, added: &str) {
    if let Some(Piece::Changed {
        removed: before,
        added: put,
    }) = pieces.last_mut()
    {
        before.push_str(removed);
        put.push_str(added);
    } else {
        pieces.push(Piece::Changed {
            removed: removed.to_owned(),
            added: added.to_owned(),
        });
    }
}

fn pieces(old: &str, script: &TextOperation) -> Option<Vec<Piece>> {
    let mut rest = old;
    let mut pieces: Vec<Piece> = Vec::new();
    for component in script.components() {
        match component {
            Component::Retain(count) => {
                let (kept, after) = split_utf16(rest, *count).ok()?;
                pieces.push(Piece::Same(kept.to_owned()));
                rest = after;
            }
            Component::Delete(count) => {
                let (removed, after) = split_utf16(rest, *count).ok()?;
                push_change(&mut pieces, removed, "");
                rest = after;
            }
            Component::Insert(text) => push_change(&mut pieces, "", text),
        }
    }
    rest.is_empty().then_some(pieces)
}

fn from_pieces(pieces: Vec<Piece>, changed: impl Fn(&str, &str) -> TextOperation) -> TextOperation {
    let mut operation = TextOperation::new();
    for piece in pieces {
        match piece {
            Piece::Same(text) => {
                operation.retain(utf16_len(&text));
            }
            Piece::Changed { removed, added } => append(&mut operation, &changed(&removed, &added)),
        }
    }
    operation
}

fn around(old: &str, head: usize, tail: usize, middle: TextOperation) -> TextOperation {
    let mut operation = TextOperation::new();
    operation.retain(utf16_len(&old[..head]));
    append(&mut operation, &middle);
    operation.retain(utf16_len(&old[old.len() - tail..]));
    operation
}

fn trimmed(
    old: &str,
    new: &str,
    middle: impl FnOnce(&str, &str) -> TextOperation,
) -> TextOperation {
    let prefix = common_prefix(old, new);
    let suffix = common_suffix(&old[prefix..], &new[prefix..]);
    let old_middle = &old[prefix..old.len() - suffix];
    let new_middle = &new[prefix..new.len() - suffix];
    let changed = if old_middle.is_empty() || new_middle.is_empty() {
        replacement(old_middle, new_middle)
    } else {
        middle(old_middle, new_middle)
    };
    around(old, prefix, suffix, changed)
}

fn contained(old: &str, new: &str) -> Option<TextOperation> {
    let mut operation = TextOperation::new();
    if let Some(at) = old.find(new) {
        operation
            .delete(utf16_len(&old[..at]))
            .retain(utf16_len(new))
            .delete(utf16_len(&old[at + new.len()..]));
        return Some(operation);
    }
    let at = new.find(old)?;
    operation
        .insert(&new[..at])
        .retain(utf16_len(old))
        .insert(&new[at + old.len()..]);
    Some(operation)
}

fn by_character(old: &str, new: &str, budget: &Budget) -> TextOperation {
    trimmed(old, new, |old, new| {
        contained(old, new)
            .or_else(|| scripted(old, new, false, budget))
            .unwrap_or_else(|| replacement(old, new))
    })
}

fn is_word(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
}

fn tokens(text: &str) -> Vec<&str> {
    let mut tokens = Vec::new();
    let mut word: Option<usize> = None;
    for (index, character) in text.char_indices() {
        if is_word(character) {
            word.get_or_insert(index);
            continue;
        }
        if let Some(start) = word.take() {
            tokens.push(&text[start..index]);
        }
        tokens.push(&text[index..index + character.len_utf8()]);
    }
    if let Some(start) = word {
        tokens.push(&text[start..]);
    }
    tokens
}

fn private_code(index: usize) -> Option<char> {
    let index = u32::try_from(index).ok()?;
    let code = if index < 0xFFFE {
        0xF_0000 + index
    } else {
        0x10_0000 + (index - 0xFFFE)
    };
    char::from_u32(code).filter(|_| code <= 0x10_FFFD)
}

fn encoded<'a>(tokens: &[&'a str], codes: &mut HashMap<&'a str, char>) -> Option<String> {
    let mut encoded = String::with_capacity(tokens.len() * 4);
    for token in tokens {
        let code = match codes.get(token) {
            Some(code) => *code,
            None => {
                let code = private_code(codes.len())?;
                codes.insert(token, code);
                code
            }
        };
        encoded.push(code);
    }
    Some(encoded)
}

fn token_pieces(before: &[&str], after: &[&str], budget: &Budget) -> Option<Vec<Piece>> {
    let mut codes: HashMap<&str, char> = HashMap::new();
    let old_codes = encoded(before, &mut codes)?;
    let new_codes = encoded(after, &mut codes)?;
    let script = scripted(&old_codes, &new_codes, false, budget)?;
    let mut pieces = Vec::new();
    let (mut at_old, mut at_new) = (0, 0);
    for component in script.components() {
        match component {
            Component::Retain(units) => {
                let count = units / 2;
                pieces.push(Piece::Same(before.get(at_old..at_old + count)?.concat()));
                at_old += count;
                at_new += count;
            }
            Component::Delete(units) => {
                let count = units / 2;
                push_change(
                    &mut pieces,
                    &before.get(at_old..at_old + count)?.concat(),
                    "",
                );
                at_old += count;
            }
            Component::Insert(text) => {
                let count = text.chars().count();
                push_change(
                    &mut pieces,
                    "",
                    &after.get(at_new..at_new + count)?.concat(),
                );
                at_new += count;
            }
        }
    }
    (at_old == before.len() && at_new == after.len()).then_some(pieces)
}

fn by_word(old: &str, new: &str, budget: &Budget) -> TextOperation {
    let before = tokens(old);
    let after = tokens(new);
    let prefix = before
        .iter()
        .zip(&after)
        .take_while(|(left, right)| left == right)
        .count();
    let suffix = before[prefix..]
        .iter()
        .rev()
        .zip(after[prefix..].iter().rev())
        .take_while(|(left, right)| left == right)
        .count();
    let bytes = |tokens: &[&str]| tokens.iter().map(|token| token.len()).sum::<usize>();
    let head = bytes(&before[..prefix]);
    let tail = bytes(&before[before.len() - suffix..]);
    let old_middle = &old[head..old.len() - tail];
    let new_middle = &new[head..new.len() - tail];
    let middle = if old_middle.is_empty() || new_middle.is_empty() {
        replacement(old_middle, new_middle)
    } else {
        token_pieces(
            &before[prefix..before.len() - suffix],
            &after[prefix..after.len() - suffix],
            budget,
        )
        .map(|pieces| {
            from_pieces(pieces, |removed, added| {
                by_character(removed, added, budget)
            })
        })
        .unwrap_or_else(|| by_character(old_middle, new_middle, budget))
    };
    around(old, head, tail, middle)
}

fn edited(operation: &TextOperation) -> usize {
    operation
        .components()
        .iter()
        .map(|component| match component {
            Component::Retain(_) => 0,
            Component::Insert(text) => utf16_len(text),
            Component::Delete(count) => *count,
        })
        .sum()
}

fn line_by_line(removed: &str, added: &str, budget: &Budget) -> Option<TextOperation> {
    let before: Vec<&str> = removed.split_inclusive('\n').collect();
    let after: Vec<&str> = added.split_inclusive('\n').collect();
    if before.len() != after.len() {
        return None;
    }
    let mut operation = TextOperation::new();
    for (old, new) in before.into_iter().zip(after) {
        let line = by_word(old, new, budget);
        if edited(&line) * 2 > utf16_len(old) + utf16_len(new) {
            return None;
        }
        append(&mut operation, &line);
    }
    Some(operation)
}

fn by_block(removed: &str, added: &str, budget: &Budget) -> TextOperation {
    (removed.len() + added.len() > PAIRED_BLOCK)
        .then(|| line_by_line(removed, added, budget))
        .flatten()
        .unwrap_or_else(|| by_word(removed, added, budget))
}

fn by_line(old: &str, new: &str, budget: &Budget) -> TextOperation {
    let Some(blocks) = scripted(old, new, true, budget).and_then(|lines| pieces(old, &lines))
    else {
        return line_by_line(old, new, budget).unwrap_or_else(|| replacement(old, new));
    };
    from_pieces(blocks, |removed, added| by_block(removed, added, budget))
}

fn whole_lines(old: &str, new: &str) -> (usize, usize) {
    let prefix = common_prefix(old, new);
    let prefix = old[..prefix].rfind('\n').map_or(0, |at| at + 1);
    let suffix = common_suffix(&old[prefix..], &new[prefix..]);
    let starts_a_line = |text: &str| {
        let start = text.len() - suffix;
        start == 0 || text.as_bytes()[start - 1] == b'\n'
    };
    if suffix == 0 || (starts_a_line(old) && starts_a_line(new)) {
        return (prefix, suffix);
    }
    let start = old.len() - suffix;
    let suffix = old[start..].find('\n').map_or(0, |at| suffix - at - 1);
    (prefix, suffix)
}

fn diff_within(old: &str, new: &str, budget: Duration) -> TextOperation {
    let budget = Budget::of(budget);
    let (head, tail) = whole_lines(old, new);
    let old_middle = &old[head..old.len() - tail];
    let new_middle = &new[head..new.len() - tail];
    let middle = if old_middle.is_empty() || new_middle.is_empty() {
        replacement(old_middle, new_middle)
    } else {
        by_line(old_middle, new_middle, &budget)
    };
    around(old, head, tail, middle)
}

pub fn diff(old: &str, new: &str) -> TextOperation {
    diff_within(old, new, DIFF_BUDGET)
}

pub fn distance(old: &str, new: &str) -> usize {
    if old == new {
        return 0;
    }
    edited(&diff_within(old, new, DISTANCE_BUDGET))
}

fn woven(result: &mut TextOperation, mine: &str, theirs: &str) {
    let prefix = common_prefix(mine, theirs);
    let suffix = common_suffix(&mine[prefix..], &theirs[prefix..]);
    let mine_middle = &mine[prefix..mine.len() - suffix];
    let theirs_middle = &theirs[prefix..theirs.len() - suffix];
    if mine_middle.is_empty() {
        result.retain(utf16_len(theirs));
    } else if theirs_middle.is_empty() {
        result
            .retain(utf16_len(&theirs[..prefix]))
            .insert(mine_middle)
            .retain(utf16_len(&theirs[prefix..]));
    } else {
        result.insert(mine).retain(utf16_len(theirs));
    }
}

fn rest_of(count: usize, step: usize, make: fn(usize) -> Component) -> Option<Component> {
    (count > step).then(|| make(count - step))
}

fn merged(change: &TextOperation, onto: &TextOperation) -> Result<TextOperation, OtError> {
    if change.base_len() != onto.base_len() {
        return Err(OtError::LengthMismatch);
    }
    let mut result = TextOperation::new();
    let mut first = change.components().iter().cloned();
    let mut second = onto.components().iter().cloned();
    let mut a = first.next();
    let mut b = second.next();
    loop {
        match (a.take(), b.take()) {
            (None, None) => break,
            (Some(Component::Insert(mine)), Some(Component::Insert(theirs))) => {
                woven(&mut result, &mine, &theirs);
                a = first.next();
                b = second.next();
            }
            (Some(Component::Insert(mine)), next) => {
                result.insert(&mine);
                a = first.next();
                b = next;
            }
            (next, Some(Component::Insert(theirs))) => {
                result.retain(utf16_len(&theirs));
                a = next;
                b = second.next();
            }
            (None, _) | (_, None) => return Err(OtError::Incompatible),
            (Some(Component::Retain(x)), Some(Component::Retain(y))) => {
                let step = x.min(y);
                result.retain(step);
                a = rest_of(x, step, Component::Retain).or_else(|| first.next());
                b = rest_of(y, step, Component::Retain).or_else(|| second.next());
            }
            (Some(Component::Delete(x)), Some(Component::Delete(y))) => {
                let step = x.min(y);
                a = rest_of(x, step, Component::Delete).or_else(|| first.next());
                b = rest_of(y, step, Component::Delete).or_else(|| second.next());
            }
            (Some(Component::Delete(x)), Some(Component::Retain(y))) => {
                let step = x.min(y);
                result.delete(step);
                a = rest_of(x, step, Component::Delete).or_else(|| first.next());
                b = rest_of(y, step, Component::Retain).or_else(|| second.next());
            }
            (Some(Component::Retain(x)), Some(Component::Delete(y))) => {
                let step = x.min(y);
                a = rest_of(x, step, Component::Retain).or_else(|| first.next());
                b = rest_of(y, step, Component::Delete).or_else(|| second.next());
            }
        }
    }
    Ok(result)
}

pub fn rebase(base: &str, changed: &str, onto: &str) -> Option<TextOperation> {
    let change = diff(base, changed);
    if base == onto {
        return Some(change);
    }
    let other = diff(base, onto);
    merged(&change, &other)
        .ok()
        .filter(|operation| operation.base_len() == utf16_len(onto))
}

#[cfg(test)]
mod tests {
    use super::*;

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

    const ALPHABET: [&str; 8] = ["a", "b", " ", "\n", "é", "😀", "z", "ab "];

    fn random_text(rng: &mut Rng, max: usize) -> String {
        (0..rng.below(max))
            .map(|_| ALPHABET[rng.below(ALPHABET.len())])
            .collect()
    }

    fn edited(rng: &mut Rng, text: &str) -> String {
        let characters: Vec<char> = text.chars().collect();
        let mut out = String::new();
        let mut index = 0;
        while index < characters.len() {
            match rng.below(5) {
                0 => {
                    out.push_str(&random_text(rng, 4));
                }
                1 => {
                    index += 1;
                    continue;
                }
                _ => {}
            }
            out.push(characters[index]);
            index += 1;
        }
        if rng.below(2) == 0 {
            out.push_str(&random_text(rng, 5));
        }
        out
    }

    fn applied(base: &str, changed: &str, onto: &str) -> String {
        rebase(base, changed, onto)
            .expect("the change merges")
            .apply(onto)
            .unwrap()
    }

    #[test]
    fn the_difference_between_two_texts_rebuilds_the_newer_one() {
        let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
        for _ in 0..1_500 {
            let old = random_text(&mut rng, 30);
            let new = if rng.below(3) == 0 {
                random_text(&mut rng, 30)
            } else {
                edited(&mut rng, &old)
            };
            let operation = diff(&old, &new);
            assert_eq!(operation.base_len(), utf16_len(&old));
            assert_eq!(operation.apply(&old).unwrap(), new, "{old:?} -> {new:?}");
            assert_eq!(distance(&old, &old), 0);
        }
    }

    #[test]
    fn edits_far_apart_stay_separate_and_the_text_between_them_is_kept() {
        let operation = diff("one two three four five", "ONE two three four FIVE");
        assert_eq!(
            operation.components(),
            &[
                Component::Insert("ONE".to_owned()),
                Component::Delete(3),
                Component::Retain(16),
                Component::Insert("FIVE".to_owned()),
                Component::Delete(4),
            ]
        );
    }

    #[test]
    fn a_large_text_with_edits_at_both_ends_keeps_the_middle() {
        let middle: String = (0..40_000)
            .map(|line| format!("line {line} of the bibliography\n"))
            .collect();
        let old = format!("% header   \n{middle}% saved 1\n");
        let new = format!("% header\n{middle}% saved 2\n");
        let operation = diff(&old, &new);
        assert_eq!(operation.apply(&old).unwrap(), new);
        assert!(operation
            .components()
            .iter()
            .any(|component| matches!(component, Component::Retain(count) if *count >= utf16_len(&middle))));
        assert_eq!(distance(&old, &new), 5);
    }

    #[test]
    fn a_reformat_of_every_line_keeps_typing_on_those_lines_in_place() {
        let lines: Vec<String> = (0..200)
            .map(|line| format!("    line {line} of the reformatted section   \n"))
            .collect();
        let base: String = lines.concat();
        let reformatted: String = lines
            .iter()
            .map(|line| format!("{}\n", line.trim()))
            .collect();
        let typed = base
            .replace("line 50 of", "line 50 TYPED of")
            .replace("line 150 of", "line 150 TYPED of");
        let expected = reformatted
            .replace("line 50 of", "line 50 TYPED of")
            .replace("line 150 of", "line 150 TYPED of");
        assert_eq!(applied(&base, &reformatted, &typed), expected);
        assert_eq!(applied(&base, &typed, &reformatted), expected);
    }

    #[test]
    fn the_distance_counts_what_was_typed_and_removed() {
        assert_eq!(distance("abc", "abc"), 0);
        assert_eq!(distance("abc", "abXc"), 1);
        assert_eq!(distance("hello world", "hello brave world"), 6);
        assert_eq!(distance("a😀b", "ab"), 2);
    }

    #[test]
    fn an_edit_made_on_both_sides_lands_once() {
        assert_eq!(applied("a b c", "a X b c", "a X b c"), "a X b c");
        assert_eq!(
            applied("alpha beta", "alpha BETA", "alpha BETA"),
            "alpha BETA"
        );
        assert_eq!(applied("x\n", "x\nline\n", "x\nline\n"), "x\nline\n");
    }

    #[test]
    fn typing_that_continues_an_edit_made_on_both_sides_lands_once() {
        assert_eq!(
            applied("start end", "start ab end", "start abcd end"),
            "start abcd end"
        );
        assert_eq!(
            applied("start end", "start abcd end", "start ab end"),
            "start abcd end"
        );
        assert_eq!(
            applied("start end", "start cd end", "start abcd end"),
            "start abcd end"
        );
    }

    #[test]
    fn different_text_typed_at_the_same_place_is_all_kept() {
        assert_eq!(
            applied("list\n", "list\n\\item A\n", "list\n\\item B\n"),
            "list\n\\item A\n\\item B\n"
        );
    }

    #[test]
    fn independent_edits_on_both_sides_both_land() {
        assert_eq!(
            applied("one two three", "ONE two three", "one two THREE"),
            "ONE two THREE"
        );
        assert_eq!(
            applied("a\nb\nc\nd\n", "a\nc\nd\n", "a\nb\nc\nd\ne\n"),
            "a\nc\nd\ne\n"
        );
    }

    #[test]
    fn typing_inside_text_the_other_side_removed_is_kept() {
        let merged = applied("keep remove keep", "keep keep", "keep reXmove keep");
        assert_eq!(merged.matches('X').count(), 1, "{merged}");
        assert!(!merged.contains("mov"), "{merged}");
        assert_eq!(merged.matches("keep").count(), 2, "{merged}");
    }

    #[test]
    fn merging_onto_an_unchanged_base_is_the_change_itself() {
        let operation = rebase("abc", "aXbc", "abc").unwrap();
        assert_eq!(operation.apply("abc").unwrap(), "aXbc");
    }
}
