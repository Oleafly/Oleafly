use std::collections::HashMap;

use loro::{LoroMap, LoroValue, ValueOrContainer};
use oleafly_collab_protocol::ids::AccountId;
use oleafly_collab_protocol::reactions::{grouped, is_emoji, Reaction, ReactionKey};

use crate::comments::{loro_error, refused, Judge};
use crate::CollabError;

pub(crate) fn checked_emoji(emoji: &str) -> Result<&str, CollabError> {
    if is_emoji(emoji) {
        Ok(emoji)
    } else {
        Err(refused(400, "invalid", "a reaction needs a single emoji"))
    }
}

pub(crate) fn read(map: &LoroMap, judge: &Judge<'_>) -> HashMap<String, Vec<Reaction>> {
    let mut found = Vec::new();
    map.for_each(|key, value| {
        let ValueOrContainer::Value(LoroValue::I64(at)) = value else {
            return;
        };
        let Some(parsed) = ReactionKey::parse(key) else {
            return;
        };
        if judge.wrote(map, &[key], parsed.account) {
            found.push((
                at,
                parsed.message.to_owned(),
                parsed.emoji.to_owned(),
                parsed.account,
            ));
        }
    });
    grouped(found)
}

pub(crate) fn set(
    map: &LoroMap,
    judge: &Judge<'_>,
    message: &str,
    emoji: &str,
    by: AccountId,
    at: Option<i64>,
) -> Result<bool, CollabError> {
    let key = ReactionKey {
        message,
        emoji,
        account: by,
    }
    .to_string();
    let stored = map.get(&key);
    let held = matches!(stored, Some(ValueOrContainer::Value(LoroValue::I64(_))))
        && judge.wrote(map, &[&key], by);
    match at {
        Some(at) if !held => map.insert(&key, at).map_err(loro_error)?,
        None if stored.is_some() => map.delete(&key).map_err(loro_error)?,
        _ => return Ok(false),
    }
    Ok(true)
}
