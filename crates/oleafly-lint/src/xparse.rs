//! xparse argument specifications (`packages/editor/src/latex-xparse.ts`).
//! Offsets are UTF-16 units relative to the specification's content.

use oleafly_preflight::latex::lexical::{is_command_unit, latex_balanced_group_end};
use oleafly_preflight::messages::MessageRef;
use oleafly_preflight::msg;
use oleafly_preflight::text::{is_js_space_unit, CLOSE_BRACE, OPEN_BRACE};

const BACKSLASH: u16 = b'\\' as u16;

#[derive(Clone, Copy)]
enum GroupKind {
    Processor,
    DefaultValue,
    EmbellishmentList,
    DefaultList,
}

fn braced_key(kind: GroupKind) -> &'static str {
    match kind {
        GroupKind::Processor => "latex.xparse.bracedProcessor",
        GroupKind::DefaultValue => "latex.xparse.bracedDefaultValue",
        GroupKind::EmbellishmentList => "latex.xparse.bracedEmbellishmentList",
        GroupKind::DefaultList => "latex.xparse.bracedDefaultList",
    }
}

fn unclosed_key(kind: GroupKind) -> &'static str {
    match kind {
        GroupKind::Processor => "latex.xparse.unclosedProcessor",
        GroupKind::DefaultValue => "latex.xparse.unclosedDefaultValue",
        GroupKind::EmbellishmentList => "latex.xparse.unclosedEmbellishmentList",
        GroupKind::DefaultList => "latex.xparse.unclosedDefaultList",
    }
}

type Issues = Vec<(usize, usize, MessageRef)>;

fn skip_whitespace(source: &[u16], start: usize) -> usize {
    let mut cursor = start;
    while source.get(cursor).copied().is_some_and(is_js_space_unit) {
        cursor += 1;
    }
    cursor
}

fn required_group_end(
    source: &[u16],
    start: usize,
    kind_type: &str,
    kind: GroupKind,
    issues: &mut Issues,
) -> Option<usize> {
    let from = skip_whitespace(source, start);
    if source.get(from) != Some(&OPEN_BRACE) {
        issues.push((
            from.min(source.len().saturating_sub(1)),
            source.len().min((from + 1).max(1)),
            msg!(braced_key(kind), "type" => kind_type),
        ));
        return None;
    }
    let end = latex_balanced_group_end(source, from, OPEN_BRACE, CLOSE_BRACE);
    if end.is_none() {
        issues.push((
            from,
            source.len().min(from + 1),
            msg!(unclosed_key(kind), "type" => kind_type),
        ));
    }
    end
}

fn delimiter_token_end(source: &[u16], start: usize) -> Option<usize> {
    let from = skip_whitespace(source, start);
    let unit = *source.get(from)?;
    if unit == OPEN_BRACE {
        return latex_balanced_group_end(source, from, OPEN_BRACE, CLOSE_BRACE);
    }
    if unit != BACKSLASH {
        return Some(from + 1);
    }
    let mut cursor = from + 1;
    if is_command_unit(source.get(cursor).copied()) {
        while is_command_unit(source.get(cursor).copied()) {
            cursor += 1;
        }
        return Some(cursor);
    }
    Some(source.len().min(cursor + 1))
}

fn skip_modifiers(source: &[u16], start: usize, issues: &mut Issues) -> Option<usize> {
    let mut cursor = start;
    while matches!(source.get(cursor), Some(&0x2b) | Some(&0x21)) {
        cursor = skip_whitespace(source, cursor + 1);
    }
    while source.get(cursor) == Some(&0x3e) {
        let processor_end =
            required_group_end(source, cursor + 1, ">", GroupKind::Processor, issues)?;
        cursor = skip_whitespace(source, processor_end);
    }
    Some(cursor)
}

fn delimited_argument_end(
    source: &[u16],
    kind_type: &str,
    type_from: usize,
    cursor: usize,
    issues: &mut Issues,
) -> Option<usize> {
    let left_end = delimiter_token_end(source, cursor);
    let right_end = left_end.and_then(|left| delimiter_token_end(source, left));
    let (Some(_), Some(right_end)) = (left_end, right_end) else {
        let reach = left_end.unwrap_or(type_from + 1);
        issues.push((
            type_from,
            source.len().min((type_from + 1).max(reach)),
            msg!("latex.xparse.delimiterTokens", "type" => kind_type),
        ));
        return None;
    };
    if kind_type != "R" && kind_type != "D" {
        return Some(right_end);
    }
    required_group_end(
        source,
        right_end,
        kind_type,
        GroupKind::DefaultValue,
        issues,
    )
}

fn argument_end(
    source: &[u16],
    kind_type: &str,
    type_from: usize,
    cursor: usize,
    issues: &mut Issues,
) -> Option<usize> {
    match kind_type {
        "m" | "b" | "v" | "o" | "s" => Some(cursor),
        "O" => required_group_end(source, cursor, kind_type, GroupKind::DefaultValue, issues),
        "t" => match delimiter_token_end(source, cursor) {
            Some(end) => Some(end),
            None => {
                issues.push((type_from, type_from + 1, msg!("latex.xparse.triggerToken")));
                None
            }
        },
        "r" | "R" | "d" | "D" => {
            delimited_argument_end(source, kind_type, type_from, cursor, issues)
        }
        "e" | "E" => {
            let embellishments = required_group_end(
                source,
                cursor,
                kind_type,
                GroupKind::EmbellishmentList,
                issues,
            )?;
            if kind_type != "E" {
                return Some(embellishments);
            }
            required_group_end(
                source,
                embellishments,
                kind_type,
                GroupKind::DefaultList,
                issues,
            )
        }
        _ => {
            issues.push((
                type_from,
                type_from + 1,
                msg!("latex.xparse.unknownType", "type" => kind_type),
            ));
            Some(cursor)
        }
    }
}

/// Problems in an xparse argument specification, as `(from, to, message)`.
pub fn validate_xparse_argument_specification(source: &[u16]) -> Vec<(usize, usize, MessageRef)> {
    let mut issues = Issues::new();
    let mut cursor = 0;
    while cursor < source.len() {
        cursor = skip_whitespace(source, cursor);
        if cursor >= source.len() {
            break;
        }
        let Some(after_modifiers) = skip_modifiers(source, cursor, &mut issues) else {
            return issues;
        };
        cursor = after_modifiers;
        if cursor >= source.len() {
            issues.push((
                source.len().saturating_sub(1),
                source.len(),
                msg!("latex.xparse.modifiersNeedType"),
            ));
            break;
        }
        let type_from = cursor;
        let kind_type = String::from_utf16_lossy(&source[cursor..cursor + 1]);
        cursor += 1;
        match argument_end(source, &kind_type, type_from, cursor, &mut issues) {
            Some(next) => cursor = next,
            None => break,
        }
    }
    issues
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_preflight::text::to_units;

    fn keys(spec: &str) -> Vec<String> {
        validate_xparse_argument_specification(&to_units(spec))
            .into_iter()
            .map(|(_, _, message)| message.key)
            .collect()
    }

    #[test]
    fn accepts_the_documented_types() {
        assert!(
            keys("m o O{x} s t+ r() R(){d} d<> D<>{x} e{^_} E{^_}{{}{}} +m !o >{\\Proc}m")
                .is_empty()
        );
    }

    #[test]
    fn reports_unknown_types_and_missing_groups() {
        assert_eq!(keys("q"), vec!["latex.xparse.unknownType"]);
        assert_eq!(keys("O"), vec!["latex.xparse.bracedDefaultValue"]);
        assert_eq!(keys("+"), vec!["latex.xparse.modifiersNeedType"]);
        assert_eq!(keys("r("), vec!["latex.xparse.delimiterTokens"]);
    }
}
