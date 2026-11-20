use std::collections::{HashMap, HashSet};

use loro::{LoroMap, LoroValue, ValueOrContainer};
use oleafly_collab_protocol::ids::AccountId;
use oleafly_collab_protocol::reactions::{
    grouped, is_emoji, reactions_counted, Reaction, ReactionKey, MAX_REACTIONS_PER_PERSON,
    MAX_REACTION_KEYS,
};

use crate::comments::{loro_error, refused, Judge};
use crate::CollabError;

pub(crate) fn checked_emoji(emoji: &str) -> Result<&str, CollabError> {
    if is_emoji(emoji) {
        Ok(emoji)
    } else {
        Err(refused(400, "invalid", "a reaction needs a single emoji"))
    }
}

fn message_of(key: &str) -> &str {
    key.split('|').next().unwrap_or_default()
}

pub(crate) fn read(
    map: &LoroMap,
    judge: &Judge<'_>,
    messages: &HashSet<String>,
) -> HashMap<String, Vec<Reaction>> {
    if messages.is_empty() {
        return HashMap::new();
    }
    let mut found = Vec::new();
    map.for_each(|key, value| {
        if !messages.contains(message_of(key)) {
            return;
        }
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

fn room_for(map: &LoroMap, message: &str, by: AccountId) -> Result<(), CollabError> {
    if map.len() >= MAX_REACTION_KEYS {
        return Err(refused(
            409,
            "invalid",
            "no more reactions fit in this conversation",
        ));
    }
    let theirs: Vec<String> = map
        .keys()
        .filter(|key| message_of(key) == message)
        .map(|key| key.to_string())
        .collect();
    let counted = reactions_counted(theirs.iter().map(String::as_str), by);
    if counted.get(message).copied().unwrap_or_default() >= MAX_REACTIONS_PER_PERSON {
        return Err(refused(
            409,
            "invalid",
            "you already added the most reactions one person can add to a message",
        ));
    }
    Ok(())
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
        Some(at) if !held => {
            if stored.is_none() {
                room_for(map, message, by)?;
            }
            map.insert(&key, at).map_err(loro_error)?
        }
        None if stored.is_some() => map.delete(&key).map_err(loro_error)?,
        _ => return Ok(false),
    }
    Ok(true)
}
