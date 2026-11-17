use std::collections::HashMap;
use std::fmt;
use std::hash::Hash;

use serde::{Deserialize, Serialize};

use crate::ids::AccountId;

pub const MAX_EMOJI_CHARS: usize = 16;
const SEPARATOR: char = '|';

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

pub fn is_emoji(emoji: &str) -> bool {
    let count = emoji.chars().count();
    count > 0
        && count <= MAX_EMOJI_CHARS
        && emoji.chars().all(|character| {
            character != SEPARATOR && !character.is_whitespace() && !character.is_control()
        })
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
    fn an_emoji_is_short_and_has_no_spaces_bars_or_control_characters() {
        for emoji in ["👍", "🎉", "👨‍👩‍👧‍👦", "❤️", "+1", "🇳🇴"] {
            assert!(is_emoji(emoji), "{emoji}");
        }
        for emoji in [
            "",
            " ",
            "👍 ",
            "a|b",
            "\n",
            "\u{7}",
            &"x".repeat(MAX_EMOJI_CHARS + 1),
        ] {
            assert!(!is_emoji(emoji), "{emoji:?}");
        }
        assert!(is_emoji(&"x".repeat(MAX_EMOJI_CHARS)));
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
