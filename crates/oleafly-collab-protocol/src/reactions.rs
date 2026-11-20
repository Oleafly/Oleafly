use std::collections::HashMap;
use std::fmt;
use std::hash::Hash;

use serde::{Deserialize, Serialize};

use crate::ids::AccountId;

pub const MAX_EMOJI_CHARS: usize = 16;
pub const MAX_REACTIONS_PER_PERSON: usize = 20;
pub const MAX_REACTION_KEYS: usize = 10_000;
const SEPARATOR: char = '|';
const KEYCAP: char = '\u{20E3}';
const EMOJI_STYLE: char = '\u{FE0F}';
const KEYCAP_BASES: &str = "0123456789#*";
const PICTURES: [(char, char); 18] = [
    ('\u{00A9}', '\u{00A9}'),
    ('\u{00AE}', '\u{00AE}'),
    ('\u{203C}', '\u{203C}'),
    ('\u{2049}', '\u{2049}'),
    ('\u{2122}', '\u{2122}'),
    ('\u{2139}', '\u{2139}'),
    ('\u{2190}', '\u{21FF}'),
    ('\u{2300}', '\u{23FF}'),
    ('\u{24C2}', '\u{24C2}'),
    ('\u{25A0}', '\u{25FF}'),
    ('\u{2600}', '\u{27BF}'),
    ('\u{2900}', '\u{297F}'),
    ('\u{2B00}', '\u{2BFF}'),
    ('\u{3030}', '\u{3030}'),
    ('\u{303D}', '\u{303D}'),
    ('\u{3297}', '\u{3297}'),
    ('\u{3299}', '\u{3299}'),
    ('\u{1F000}', '\u{1FAFF}'),
];
const JOINERS: [(char, char); 3] = [
    ('\u{200D}', '\u{200D}'),
    ('\u{FE0E}', '\u{FE0F}'),
    ('\u{E0020}', '\u{E007F}'),
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reaction {
    pub emoji: String,
    pub by: Vec<AccountId>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReactionKey<'a> {
    pub message: &'a str,
    pub emoji: &'a str,
    pub account: AccountId,
}

impl<'a> ReactionKey<'a> {
    pub fn parse(key: &'a str) -> Option<ReactionKey<'a>> {
        let mut parts = key.split(SEPARATOR);
        let (Some(message), Some(emoji), Some(account), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return None;
        };
        if message.is_empty() || !is_emoji(emoji) {
            return None;
        }
        Some(ReactionKey {
            message,
            emoji,
            account: account.parse().ok()?,
        })
    }
}

impl fmt::Display for ReactionKey<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{}{SEPARATOR}{}{SEPARATOR}{}",
            self.message, self.emoji, self.account
        )
    }
}

fn within(character: char, ranges: &[(char, char)]) -> bool {
    ranges
        .iter()
        .any(|(first, last)| (*first..=*last).contains(&character))
}

pub fn is_emoji(emoji: &str) -> bool {
    let count = emoji.chars().count();
    if count == 0 || count > MAX_EMOJI_CHARS {
        return false;
    }
    if let Some(base) = emoji.strip_suffix(KEYCAP) {
        let mut base = base.strip_suffix(EMOJI_STYLE).unwrap_or(base).chars();
        return matches!(
            (base.next(), base.next()),
            (Some(character), None) if KEYCAP_BASES.contains(character)
        );
    }
    emoji.chars().any(|character| within(character, &PICTURES))
        && emoji
            .chars()
            .all(|character| within(character, &PICTURES) || within(character, &JOINERS))
}

pub fn reactions_counted<'a>(
    keys: impl IntoIterator<Item = &'a str>,
    account: AccountId,
) -> HashMap<&'a str, usize> {
    let mut counted: HashMap<&str, usize> = HashMap::new();
    for key in keys
        .into_iter()
        .filter_map(ReactionKey::parse)
        .filter(|key| key.account == account)
    {
        *counted.entry(key.message).or_default() += 1;
    }
    counted
}

pub fn grouped<M: Ord + Hash>(
    mut found: Vec<(i64, M, String, AccountId)>,
) -> HashMap<M, Vec<Reaction>> {
    found.sort();
    let mut by_message: HashMap<M, Vec<Reaction>> = HashMap::new();
    for (_, message, emoji, account) in found {
        let reactions = by_message.entry(message).or_default();
        match reactions
            .iter_mut()
            .find(|reaction| reaction.emoji == emoji)
        {
            Some(reaction) => reaction.by.push(account),
            None => reactions.push(Reaction {
                emoji,
                by: vec![account],
            }),
        }
    }
    by_message
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(seed: u8) -> AccountId {
        format!("01920000-0000-7000-8000-0000000000{seed:02x}")
            .parse()
            .unwrap()
    }

    #[test]
    fn a_key_names_the_message_the_emoji_and_who_reacted() {
        let key = ReactionKey {
            message: "m1",
            emoji: "👍",
            account: account(1),
        }
        .to_string();
        assert_eq!(key, format!("m1|👍|{}", account(1)));
        assert_eq!(
            ReactionKey::parse(&key),
            Some(ReactionKey {
                message: "m1",
                emoji: "👍",
                account: account(1),
            })
        );
    }

    #[test]
    fn malformed_keys_are_not_reactions() {
        let someone = account(1).to_string();
        for key in [
            String::new(),
            "m1".to_owned(),
            "m1|👍".to_owned(),
            format!("|👍|{someone}"),
            format!("m1||{someone}"),
            "m1|👍|not-an-account".to_owned(),
            format!("m1|👍|{someone}|extra"),
            format!("m1|thumbs up|{someone}"),
        ] {
            assert_eq!(ReactionKey::parse(&key), None, "{key}");
        }
    }

    #[test]
    fn an_emoji_is_a_short_run_of_pictographs_with_their_joiners_and_modifiers() {
        for emoji in [
            "👍",
            "🎉",
            "❤️",
            "😄",
            "👀",
            "🚀",
            "👨‍👩‍👧‍👦",
            "👍🏽",
            "🫱🏻‍🫲🏿",
            "👩🏻‍❤️‍💋‍👨🏼",
            "🏳️‍🌈",
            "🇳🇴",
            "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
            "1️⃣",
            "#️⃣",
            "*⃣",
            "©️",
            "™️",
            "↔️",
            "⌚",
            "〰️",
            "㊙️",
            "🙂‍↔️",
            "🐦‍🔥",
            "🫩",
        ] {
            assert!(is_emoji(emoji), "{emoji}");
        }
        for emoji in [
            "",
            " ",
            "👍 ",
            "a|b",
            "👍|👍",
            "\n",
            "\u{7}",
            "+1",
            "ok",
            "lol",
            "thumbs up",
            "a👍",
            "1",
            "12⃣",
            "x⃣",
            "\u{200D}",
            "\u{FE0F}",
            &"x".repeat(MAX_EMOJI_CHARS),
            &"👍".repeat(MAX_EMOJI_CHARS + 1),
        ] {
            assert!(!is_emoji(emoji), "{emoji:?}");
        }
        assert!(is_emoji(&"👍".repeat(MAX_EMOJI_CHARS)));
    }

    #[test]
    fn reactions_are_counted_per_person_and_message() {
        let keys = [
            format!("m1|👍|{}", account(1)),
            format!("m1|🎉|{}", account(1)),
            format!("m2|👍|{}", account(1)),
            format!("m1|👍|{}", account(2)),
            format!("m1|word|{}", account(1)),
        ];
        let keys = || keys.iter().map(String::as_str);
        let first = reactions_counted(keys(), account(1));
        assert_eq!(first, HashMap::from([("m1", 2), ("m2", 1)]));
        assert_eq!(
            reactions_counted(keys(), account(2)),
            HashMap::from([("m1", 1)])
        );
        assert!(reactions_counted(keys(), account(3)).is_empty());
    }

    #[test]
    fn reactions_group_by_emoji_in_order_of_the_first_and_list_people_in_time_order() {
        let found = vec![
            (30, "m1", "🎉".to_owned(), account(3)),
            (10, "m1", "👍".to_owned(), account(2)),
            (20, "m1", "🎉".to_owned(), account(1)),
            (40, "m1", "👍".to_owned(), account(1)),
            (5, "m2", "👀".to_owned(), account(1)),
        ];
        let grouped = grouped(found);
        assert_eq!(
            grouped["m1"],
            vec![
                Reaction {
                    emoji: "👍".to_owned(),
                    by: vec![account(2), account(1)],
                },
                Reaction {
                    emoji: "🎉".to_owned(),
                    by: vec![account(1), account(3)],
                },
            ]
        );
        assert_eq!(grouped["m2"].len(), 1);
        assert_eq!(
            serde_json::to_value(&grouped["m2"]).unwrap(),
            serde_json::json!([{ "emoji": "👀", "by": [account(1).to_string()] }])
        );
    }
}
