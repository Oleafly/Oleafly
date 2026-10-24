//! Numbers in the manuscript that cite a run (`% run: r002`,
//! `// run: r002`, `<!-- run: r002 -->`) must match what the run recorded.

/// The run id after a marker on this line, and the text before the marker.
fn marker(line: &str) -> Option<(&str, String)> {
    for (open, close) in [
        ("<!-- run:", Some("-->")),
        ("% run:", None),
        ("// run:", None),
    ] {
        let Some(at) = line.find(open) else {
            continue;
        };
        let rest = &line[at + open.len()..];
        let rest = match close {
            Some(close) => rest.split(close).next().unwrap_or(rest),
            None => rest,
        };
        let id: String = rest
            .trim()
            .chars()
            .take_while(|character| {
                character.is_ascii_alphanumeric() || *character == '-' || *character == '_'
            })
            .collect();
        if !id.is_empty() {
            return Some((&line[..at], id));
        }
    }
    None
}

/// Decimal numbers (and percentages) in `text`; whole numbers are left out
/// because table rows also hold counts and labels.
fn decimals(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut found = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        let starts = chars[index].is_ascii_digit()
            || (chars[index] == '-' && chars.get(index + 1).is_some_and(char::is_ascii_digit));
        let after_word =
            index > 0 && (chars[index - 1].is_ascii_alphanumeric() || chars[index - 1] == '_');
        if !starts || after_word {
            index += 1;
            continue;
        }
        let begin = index;
        index += 1;
        while index < chars.len() && (chars[index].is_ascii_digit() || chars[index] == '.') {
            index += 1;
        }
        let number: String = chars[begin..index].iter().collect();
        let number = number.trim_end_matches('.').to_owned();
        let percent =
            chars.get(index) == Some(&'%') || chars.get(index..index + 2) == Some(&['\\', '%'][..]);
        if (number.contains('.') || percent) && number.parse::<f64>().is_ok() {
            found.push(number);
        }
    }
    found
}

/// `(line, numbers, run id)` for every line that cites a run. CRLF is fine.
pub fn numbers_with_run_markers(text: &str) -> Vec<(u32, Vec<String>, String)> {
    text.lines()
        .enumerate()
        .filter_map(|(index, line)| {
            let line = line.trim_end_matches('\r');
            let (before, run) = marker(line)?;
            Some((
                u32::try_from(index + 1).unwrap_or(u32::MAX),
                decimals(before),
                run,
            ))
        })
        .collect()
}

fn rounds_to(printed: &str, value: f64) -> bool {
    let decimals = printed
        .split_once('.')
        .map(|(_, fraction)| fraction.len())
        .unwrap_or(0);
    let Ok(printed_value) = printed.parse::<f64>() else {
        return false;
    };
    let rounded = format!("{value:.decimals$}");
    rounded
        .parse::<f64>()
        .is_ok_and(|rounded| (rounded - printed_value).abs() < 1e-12)
}

/// Whether `value` rounds to `printed` at the precision it was printed with,
/// or does so as a percentage.
pub fn number_matches(printed: &str, value: f64) -> bool {
    rounds_to(printed, value) || rounds_to(printed, value * 100.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markers_are_found_in_latex_typst_and_markdown_with_crlf() {
        let text = "Model & 0.913 & 1.25 \\\\ % run: r002\r\n#table[0.88] // run: r003\r\n| acc | 91.3% | <!-- run: r004 -->\r\nNo marker 0.5\r\n";
        let found = numbers_with_run_markers(text);
        assert_eq!(
            found[0],
            (
                1,
                vec!["0.913".to_owned(), "1.25".to_owned()],
                "r002".to_owned()
            )
        );
        assert_eq!(found[1], (2, vec!["0.88".to_owned()], "r003".to_owned()));
        assert_eq!(found[2], (3, vec!["91.3".to_owned()], "r004".to_owned()));
        assert_eq!(found.len(), 3);
    }

    #[test]
    fn printed_precision_decides_a_match() {
        assert!(number_matches("0.91", 0.913));
        assert!(!number_matches("0.92", 0.913));
        assert!(number_matches("91.3", 0.913));
        assert!(number_matches("0.913", 0.913));
    }

    #[test]
    fn words_and_whole_numbers_are_not_checked() {
        assert!(decimals("Table 2 with layer4 and v1.2")
            .iter()
            .all(|number| number != "2" && number != "4"));
        assert_eq!(
            decimals("-0.5 and 12% and 3"),
            vec!["-0.5".to_owned(), "12".to_owned()]
        );
    }
}
