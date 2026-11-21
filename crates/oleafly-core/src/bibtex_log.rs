// The message shapes follow LaTeX Workshop's src/parse/parser/bibtexlog.ts
// (https://github.com/James-Yu/LaTeX-Workshop, commit becabe2, MIT License,
// (c) James Yu).

const MAX_MESSAGES: usize = 50;
const SOURCE_LINE: &str = " : ";
const WARNING: &str = "Warning--";
const ENTRY_NOT_FOUND: &str = "I didn't find a database entry for \"";
const WARNING_PLACE: &str = "--line ";
const ERROR_PLACE: &str = "---line ";
const OF_FILE: &str = " of file ";
const WHILE_EXECUTING: &str = "while executing";
const WHILE_READING: &str = "---while reading file ";
const BAD_CROSS_REFERENCE: &str = "A bad cross reference---";
const REFERS_TO: &str = "refers to entry ";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BibtexMessage {
    pub error: bool,
    pub message: String,
    pub place: Option<(String, u32)>,
    pub missing_entry: Option<String>,
}

fn place(text: &str) -> Option<(String, u32)> {
    let (line, file) = text.split_once(OF_FILE)?;
    Some((file.trim_end().to_owned(), line.parse().ok()?))
}

fn warning(text: &str, next: &str) -> Option<BibtexMessage> {
    let place = next.strip_prefix(WARNING_PLACE).and_then(place);
    let missing_entry = text
        .strip_prefix(ENTRY_NOT_FOUND)
        .and_then(|rest| rest.split('"').next())
        .map(str::to_owned);
    (place.is_some() || missing_entry.is_some()).then(|| BibtexMessage {
        error: false,
        message: text.trim_end().to_owned(),
        place,
        missing_entry,
    })
}

fn error(message: &str, place: Option<(String, u32)>) -> BibtexMessage {
    BibtexMessage {
        error: true,
        message: message.trim_end().to_owned(),
        place,
        missing_entry: None,
    }
}

pub fn parse_bibtex_log(log: &str) -> Vec<BibtexMessage> {
    let lines: Vec<&str> = crate::compile_log::head(log).lines().collect();
    let mut out = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if out.len() == MAX_MESSAGES {
            break;
        }
        if line.starts_with(SOURCE_LINE) {
            continue;
        }
        let next = lines.get(index + 1).copied().unwrap_or_default();
        if let Some(text) = line.strip_prefix(WARNING) {
            out.extend(warning(text, next));
        } else if let Some((text, rest)) = line.split_once(ERROR_PLACE) {
            let text = if text.is_empty() || text == WHILE_EXECUTING {
                index.checked_sub(1).map_or("", |previous| lines[previous])
            } else {
                text
            };
            out.extend(place(rest).map(|found| error(text, Some(found))));
        } else if let Some((text, _)) = line.split_once(WHILE_READING) {
            out.push(error(text, None));
        } else if line.starts_with(BAD_CROSS_REFERENCE) {
            let text = if next.starts_with(REFERS_TO) {
                format!("{line}\n{next}")
            } else {
                (*line).to_owned()
            };
            out.push(error(&text, None));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found(error: bool, message: &str, file: &str, line: u32) -> BibtexMessage {
        BibtexMessage {
            error,
            message: message.to_owned(),
            place: Some((file.to_owned(), line)),
            missing_entry: None,
        }
    }

    #[test]
    fn an_entry_error_and_a_later_command_error_stay_apart() {
        let log = [
            "This is BibTeX, Version 0.99d (TeX Live 2025)",
            "Database file #1: refs.bib",
            "I was expecting a `,' or a `}'---line 5 of file refs.bib",
            " :   title = {A}",
            " :           ^",
            "(Error may have been on previous line)",
            "I'm skipping whatever remains of this entry",
            "Illegal, another \\bibdata command---line 3 of file main.aux",
            " : \\bibdata",
            " :         {refs}",
            "I'm skipping whatever remains of this command",
            "(There were 2 error messages)",
        ]
        .join("\n");
        assert_eq!(
            parse_bibtex_log(&log),
            [
                found(true, "I was expecting a `,' or a `}'", "refs.bib", 5),
                found(true, "Illegal, another \\bibdata command", "main.aux", 3),
            ]
        );
    }

    #[test]
    fn an_error_whose_place_sits_on_its_own_line_takes_the_message_above() {
        let log = [
            "I couldn't open database file refs.bib",
            "---line 3 of file job.aux",
            " : \\bibdata{refs",
            " :              }",
            "I'm skipping whatever remains of this command",
            "You can't pop an empty literal stack for entry knuth84",
            "while executing---line 1049 of file plain.bst",
        ]
        .join("\n");
        assert_eq!(
            parse_bibtex_log(&log),
            [
                found(true, "I couldn't open database file refs.bib", "job.aux", 3),
                found(
                    true,
                    "You can't pop an empty literal stack for entry knuth84",
                    "plain.bst",
                    1049
                ),
            ]
        );
    }

    #[test]
    fn a_warning_with_a_place_is_kept_and_a_field_warning_is_not() {
        let log = [
            "Warning--I'm ignoring urban2010's extra \"year\" field",
            "--line 12 of file refs.bib",
            "Warning--empty journal in knuth1984",
            "(There were 2 warnings)",
        ]
        .join("\n");
        assert_eq!(
            parse_bibtex_log(&log),
            [found(
                false,
                "I'm ignoring urban2010's extra \"year\" field",
                "refs.bib",
                12
            )]
        );
    }

    #[test]
    fn a_citation_with_no_entry_names_its_key() {
        let messages =
            parse_bibtex_log("Warning--I didn't find a database entry for \"missing2020\"\n");
        assert_eq!(messages.len(), 1);
        assert!(!messages[0].error);
        assert_eq!(messages[0].missing_entry.as_deref(), Some("missing2020"));
        assert_eq!(messages[0].place, None);
    }

    #[test]
    fn errors_without_a_place_keep_their_message() {
        let log = [
            "I found no \\citation commands---while reading file main.aux",
            "A bad cross reference---entry \"child\"",
            "refers to entry \"parent\", which doesn't exist",
        ]
        .join("\n");
        let messages = parse_bibtex_log(&log);
        assert_eq!(
            messages
                .iter()
                .map(|message| (message.error, message.message.as_str(), &message.place))
                .collect::<Vec<_>>(),
            [
                (true, "I found no \\citation commands", &None),
                (
                    true,
                    "A bad cross reference---entry \"child\"\nrefers to entry \"parent\", which doesn't exist",
                    &None
                ),
            ]
        );
    }

    #[test]
    fn a_source_line_that_looks_like_a_message_is_not_one() {
        let log = [
            "Repeated entry---line 9 of file refs.bib",
            " : @article{knuth84,",
            " :   note = {Warning--see---line 3 of file x}",
            "I'm skipping whatever remains of this entry",
        ]
        .join("\n");
        assert_eq!(
            parse_bibtex_log(&log),
            [found(true, "Repeated entry", "refs.bib", 9)]
        );
    }

    #[test]
    fn a_long_log_stays_bounded_and_an_empty_one_is_empty() {
        let log = "Repeated entry---line 9 of file refs.bib\n".repeat(200);
        assert_eq!(parse_bibtex_log(&log).len(), MAX_MESSAGES);
        assert!(parse_bibtex_log("").is_empty());
    }
}
