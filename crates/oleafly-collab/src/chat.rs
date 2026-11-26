use std::collections::HashSet;

use loro::event::{ContainerDiff, Diff};
use loro::{Container, ContainerID, LoroDoc, LoroList, LoroMap, LoroValue, ValueOrContainer};
use oleafly_collab_protocol::ids::{AccountId, ChatMessageId};
use oleafly_collab_protocol::reactions::Reaction;
use oleafly_collab_protocol::schema::{AT, AUTHOR, BODY, DELETED, ID, MENTIONS, STAMPED};
pub use oleafly_collab_protocol::schema::{CHAT, CHAT_REACTIONS};
use serde::{Deserialize, Serialize};

use crate::comments::{
    accounts_of, flag_of, loro_error, mention_value, number_of, parsed, refused, string_of, unique,
    Judge,
};
use crate::doc::ProjectDoc;
use crate::reactions::checked_emoji;
use crate::CollabError;

pub const MAX_CHAT_CHARS: usize = 4_000;
pub const MAX_CHAT_PAGE: usize = 200;
const WRITTEN: [&str; 5] = [ID, AUTHOR, AT, BODY, MENTIONS];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage<Id = ChatMessageId, Who = AccountId> {
    pub id: Id,
    pub author: Who,
    pub at: i64,
    pub body: String,
    pub deleted: bool,
    pub verified: bool,
    #[serde(default)]
    pub reactions: Vec<Reaction>,
    #[serde(default)]
    pub pending: bool,
    #[serde(default = "Vec::new")]
    pub mentions: Vec<Who>,
    #[serde(default)]
    pub edited_at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatMention {
    pub message_id: ChatMessageId,
    pub author: AccountId,
    pub mentions: Vec<AccountId>,
}

pub(crate) fn chat_gone() -> CollabError {
    refused(404, "not_found", "this message is gone")
}

pub(crate) fn is_chat_root(id: &ContainerID) -> bool {
    matches!(id, ContainerID::Root { name, .. } if name.as_str() == CHAT || name.as_str() == CHAT_REACTIONS)
}

pub(crate) fn in_chat(doc: &LoroDoc, container: &ContainerID) -> bool {
    match container {
        ContainerID::Root { .. } => is_chat_root(container),
        ContainerID::Normal { .. } => doc
            .get_path_to_container(container)
            .and_then(|path| path.into_iter().next())
            .is_some_and(|(root, _)| is_chat_root(&root)),
    }
}

pub(crate) fn record(mentioned: &mut Vec<ContainerID>, change: &ContainerDiff<'_>) -> bool {
    let rooted = match change.path.first() {
        Some((root, _)) => is_chat_root(root),
        None => is_chat_root(change.target),
    };
    if rooted {
        if let Diff::Map(delta) = &change.diff {
            if change.path.len() == 2 && delta.updated.contains_key(MENTIONS) {
                mentioned.push(change.target.clone());
            }
        }
    }
    rooted
}

fn chat_of(map: &LoroMap, judge: &Judge<'_>) -> Option<ChatMessage> {
    let LoroValue::Map(fields) = map.get_deep_value() else {
        return None;
    };
    let deleted = flag_of(fields.get(DELETED));
    let author: AccountId = parsed(fields.get(AUTHOR))?;
    let keys: &[&str] = if deleted { &STAMPED } else { &WRITTEN };
    Some(ChatMessage {
        id: parsed(fields.get(ID))?,
        author,
        at: number_of(fields.get(AT)).unwrap_or_default(),
        body: if deleted {
            String::new()
        } else {
            string_of(fields.get(BODY)).unwrap_or_default()
        },
        deleted,
        verified: judge.wrote(map, keys, author),
        reactions: Vec::new(),
        pending: false,
        mentions: if deleted {
            Vec::new()
        } else {
            accounts_of(fields.get(MENTIONS))
        },
        edited_at: None,
    })
}

pub fn checked_chat_body(
    body: &str,
    limit: usize,
    length: fn(&str) -> usize,
) -> Result<&str, CollabError> {
    let body = body.trim();
    if body.is_empty() {
        return Err(refused(400, "empty", "a message needs some text"));
    }
    if length(body) > limit {
        return Err(refused(413, "too_large", "this message is too long"));
    }
    Ok(body)
}

struct Found {
    map: LoroMap,
    message: ChatMessage,
}

impl ProjectDoc {
    fn chat_list(&self) -> LoroList {
        self.loro().get_list(CHAT)
    }

    fn chat_reactions(&self) -> LoroMap {
        self.loro().get_map(CHAT_REACTIONS)
    }

    fn chat_entries(&self) -> Vec<Found> {
        let list = self.chat_list();
        let judge = self.judge();
        (0..list.len())
            .filter_map(|index| {
                let Some(ValueOrContainer::Container(Container::Map(map))) = list.get(index) else {
                    return None;
                };
                Some(Found {
                    message: chat_of(&map, &judge)?,
                    map,
                })
            })
            .collect()
    }

    fn chat_entry(&self, id: ChatMessageId) -> Result<Found, CollabError> {
        let list = self.chat_list();
        let judge = self.judge();
        (0..list.len())
            .find_map(|index| {
                let Some(ValueOrContainer::Container(Container::Map(map))) = list.get(index) else {
                    return None;
                };
                let named = matches!(
                    map.get(ID),
                    Some(ValueOrContainer::Value(LoroValue::String(found)))
                        if found.as_str().parse::<ChatMessageId>().ok() == Some(id)
                );
                if !named {
                    return None;
                }
                chat_of(&map, &judge).map(|message| Found { map, message })
            })
            .ok_or_else(chat_gone)
    }

    pub fn chat_messages(&self, before: Option<ChatMessageId>, limit: usize) -> Vec<ChatMessage> {
        let messages: Vec<ChatMessage> = self
            .chat_entries()
            .into_iter()
            .map(|found| found.message)
            .collect();
        let end = before
            .and_then(|before| messages.iter().position(|message| message.id == before))
            .unwrap_or(messages.len());
        let limit = limit.clamp(1, MAX_CHAT_PAGE);
        let mut page = messages[end.saturating_sub(limit)..end].to_vec();
        let shown: HashSet<String> = page
            .iter()
            .filter(|message| !message.deleted)
            .map(|message| message.id.to_string())
            .collect();
        let mut reactions = crate::reactions::read(&self.chat_reactions(), &self.judge(), &shown);
        for message in page.iter_mut().filter(|message| !message.deleted) {
            message.reactions = reactions
                .remove(&message.id.to_string())
                .unwrap_or_default();
        }
        page
    }

    pub fn send_chat(
        &mut self,
        author: AccountId,
        at: i64,
        body: &str,
        mentions: &[AccountId],
    ) -> Result<ChatMessage, CollabError> {
        self.writable()?;
        let body = checked_chat_body(body, MAX_CHAT_CHARS, |text| text.chars().count())?;
        let mentions = unique(mentions);
        let id = ChatMessageId::new_v7();
        let map = self
            .chat_list()
            .push_container(LoroMap::new())
            .map_err(loro_error)?;
        map.insert(ID, id.to_string()).map_err(loro_error)?;
        map.insert(AUTHOR, author.to_string()).map_err(loro_error)?;
        map.insert(AT, at).map_err(loro_error)?;
        map.insert(BODY, body).map_err(loro_error)?;
        map.insert(MENTIONS, mention_value(&mentions))
            .map_err(loro_error)?;
        self.loro().commit();
        Ok(ChatMessage {
            id,
            author,
            at,
            body: body.to_owned(),
            deleted: false,
            verified: true,
            reactions: Vec::new(),
            pending: false,
            mentions,
            edited_at: None,
        })
    }

    pub(crate) fn chat_mentions(&self, containers: Vec<ContainerID>) -> Vec<ChatMention> {
        let judge = self.judge();
        let mut seen = std::collections::HashSet::new();
        containers
            .into_iter()
            .filter(|container| seen.insert(container.clone()))
            .filter_map(|container| {
                let message = chat_of(&self.loro().get_map(container), &judge)?;
                (message.verified && !message.deleted && !message.mentions.is_empty()).then_some(
                    ChatMention {
                        message_id: message.id,
                        author: message.author,
                        mentions: message.mentions,
                    },
                )
            })
            .collect()
    }

    pub fn chat_author(&self, id: ChatMessageId) -> Result<AccountId, CollabError> {
        self.chat_entry(id).map(|found| found.message.author)
    }

    pub fn delete_chat(&mut self, id: ChatMessageId, by: AccountId) -> Result<(), CollabError> {
        self.writable()?;
        let found = self.chat_entry(id)?;
        if found.message.author != by {
            return Err(refused(
                403,
                "not_yours",
                "only the person who wrote a message can delete it",
            ));
        }
        if found.message.deleted {
            return Ok(());
        }
        found.map.insert(DELETED, true).map_err(loro_error)?;
        found.map.insert(BODY, "").map_err(loro_error)?;
        self.loro().commit();
        Ok(())
    }

    pub fn react_to_chat(
        &mut self,
        id: ChatMessageId,
        emoji: &str,
        by: AccountId,
        at: i64,
    ) -> Result<(), CollabError> {
        self.writable()?;
        let emoji = checked_emoji(emoji)?;
        if self.chat_entry(id)?.message.deleted {
            return Err(chat_gone());
        }
        let message = id.to_string();
        if crate::reactions::set(
            &self.chat_reactions(),
            &self.judge(),
            &message,
            emoji,
            by,
            Some(at),
        )? {
            self.loro().commit();
        }
        Ok(())
    }

    pub fn unreact_to_chat(
        &mut self,
        id: ChatMessageId,
        emoji: &str,
        by: AccountId,
    ) -> Result<(), CollabError> {
        self.writable()?;
        let emoji = checked_emoji(emoji)?;
        let message = id.to_string();
        if crate::reactions::set(
            &self.chat_reactions(),
            &self.judge(),
            &message,
            emoji,
            by,
            None,
        )? {
            self.loro().commit();
        }
        Ok(())
    }

    pub fn clear_chat(&mut self) -> Result<usize, CollabError> {
        self.writable()?;
        let mut cleared = 0;
        for found in self.chat_entries() {
            if found.message.deleted {
                continue;
            }
            found.map.insert(DELETED, true).map_err(loro_error)?;
            found.map.insert(BODY, "").map_err(loro_error)?;
            cleared += 1;
        }
        let reactions = self.chat_reactions();
        let keys: Vec<String> = reactions.keys().map(|key| key.to_string()).collect();
        for key in &keys {
            reactions.delete(key).map_err(loro_error)?;
        }
        if cleared > 0 || !keys.is_empty() {
            self.loro().commit();
        }
        Ok(cleared)
    }
}

#[cfg(test)]
mod tests {
    use oleafly_collab_protocol::projects::ProjectRole;

    use super::*;

    fn account(seed: u8) -> AccountId {
        format!("01920000-0000-7000-8000-0000000000{seed:02x}")
            .parse()
            .unwrap()
    }

    fn pair() -> (ProjectDoc, ProjectDoc) {
        let mut owner = ProjectDoc::create().unwrap();
        owner.set_author(&account(1).to_string(), "Owen");
        let mut member = ProjectDoc::load(&owner.snapshot().unwrap()).unwrap();
        member.set_author(&account(2).to_string(), "Mia");
        (owner, member)
    }

    fn sync(from: &ProjectDoc, to: &mut ProjectDoc) {
        to.import(&from.export_since(&to.version()).unwrap())
            .unwrap();
    }

    fn bodies(doc: &ProjectDoc) -> Vec<(String, bool)> {
        doc.chat_messages(None, 50)
            .into_iter()
            .map(|message| (message.body, message.deleted))
            .collect()
    }

    #[test]
    fn messages_reach_everyone_in_order_and_older_ones_come_in_pages() {
        let (mut owner, mut member) = pair();
        for index in 0..5 {
            owner
                .send_chat(account(1), index, &format!("note {index}"), &[])
                .unwrap();
        }
        sync(&owner, &mut member);
        let sent = member.send_chat(account(2), 9, "  reply  ", &[]).unwrap();
        assert_eq!(sent.body, "reply");
        sync(&member, &mut owner);
        let all = owner.chat_messages(None, 50);
        assert_eq!(all.len(), 6);
        assert_eq!(all.last().unwrap().body, "reply");
        assert!(all.iter().all(|message| message.verified));
        let latest = owner.chat_messages(None, 2);
        assert_eq!(
            latest
                .iter()
                .map(|message| message.body.as_str())
                .collect::<Vec<_>>(),
            ["note 4", "reply"]
        );
        let older = owner.chat_messages(Some(latest[0].id), 3);
        assert_eq!(
            older
                .iter()
                .map(|message| message.body.as_str())
                .collect::<Vec<_>>(),
            ["note 1", "note 2", "note 3"]
        );
    }

    #[test]
    fn people_delete_only_their_own_messages_and_the_owner_can_clear_all() {
        let (mut owner, mut member) = pair();
        let first = owner.send_chat(account(1), 1, "mine", &[]).unwrap();
        sync(&owner, &mut member);
        let second = member.send_chat(account(2), 2, "theirs", &[]).unwrap();
        assert!(matches!(
            member.delete_chat(first.id, account(2)),
            Err(CollabError::Api { code, .. }) if code == "not_yours"
        ));
        member.delete_chat(second.id, account(2)).unwrap();
        assert_eq!(
            bodies(&member),
            [("mine".to_owned(), false), (String::new(), true)]
        );
        sync(&member, &mut owner);
        assert_eq!(owner.chat_author(second.id).unwrap(), account(2));
        assert_eq!(owner.clear_chat().unwrap(), 1);
        assert_eq!(
            bodies(&owner),
            [(String::new(), true), (String::new(), true)]
        );
        sync(&owner, &mut member);
        assert!(member
            .chat_messages(None, 50)
            .iter()
            .all(|message| message.deleted && message.verified));
    }

    #[test]
    fn an_empty_or_overlong_message_is_refused() {
        let (mut owner, _) = pair();
        assert!(matches!(
            owner.send_chat(account(1), 1, "   ", &[]),
            Err(CollabError::Api { code, .. }) if code == "empty"
        ));
        assert!(matches!(
            owner.send_chat(account(1), 1, &"x".repeat(MAX_CHAT_CHARS + 1), &[]),
            Err(CollabError::Api { code, .. }) if code == "too_large"
        ));
        assert!(owner.chat_messages(None, 50).is_empty());
    }

    #[test]
    fn the_length_check_counts_with_the_measure_it_is_given() {
        let astral = "\u{1F600}".repeat(3);
        let units = |text: &str| text.encode_utf16().count();
        assert_eq!(
            checked_chat_body(&astral, 3, |text| text.chars().count()).unwrap(),
            astral
        );
        assert!(matches!(
            checked_chat_body(&astral, 5, units),
            Err(CollabError::Api { code, .. }) if code == "too_large"
        ));
        assert_eq!(checked_chat_body(&astral, 6, units).unwrap(), astral);
    }

    fn reaction(emoji: &str, by: &[AccountId]) -> Reaction {
        Reaction {
            emoji: emoji.to_owned(),
            by: by.to_vec(),
        }
    }

    fn reactions_of(doc: &ProjectDoc) -> Vec<Vec<Reaction>> {
        doc.chat_messages(None, 50)
            .into_iter()
            .map(|message| message.reactions)
            .collect()
    }

    #[test]
    fn reactions_from_two_people_merge_and_can_be_taken_back() {
        let (mut owner, mut member) = pair();
        let first = owner.send_chat(account(1), 1, "lunch?", &[]).unwrap();
        sync(&owner, &mut member);
        owner.react_to_chat(first.id, "👍", account(1), 10).unwrap();
        member
            .react_to_chat(first.id, "🍕", account(2), 15)
            .unwrap();
        member
            .react_to_chat(first.id, "👍", account(2), 20)
            .unwrap();
        sync(&owner, &mut member);
        sync(&member, &mut owner);
        let expected = vec![vec![
            reaction("👍", &[account(1), account(2)]),
            reaction("🍕", &[account(2)]),
        ]];
        assert_eq!(reactions_of(&owner), expected);
        assert_eq!(reactions_of(&member), expected);
        member.unreact_to_chat(first.id, "👍", account(2)).unwrap();
        member.unreact_to_chat(first.id, "👍", account(2)).unwrap();
        sync(&member, &mut owner);
        assert_eq!(
            reactions_of(&owner),
            vec![vec![
                reaction("👍", &[account(1)]),
                reaction("🍕", &[account(2)])
            ]]
        );
        assert!(matches!(
            owner.react_to_chat(first.id, "two words", account(1), 30),
            Err(CollabError::Api { code, .. }) if code == "invalid"
        ));
    }

    #[test]
    fn a_deleted_message_drops_its_reactions_and_clearing_removes_them_all() {
        let (mut owner, mut member) = pair();
        let first = owner.send_chat(account(1), 1, "one", &[]).unwrap();
        let second = owner.send_chat(account(1), 2, "two", &[]).unwrap();
        sync(&owner, &mut member);
        member.react_to_chat(first.id, "👀", account(2), 3).unwrap();
        member
            .react_to_chat(second.id, "🎉", account(2), 4)
            .unwrap();
        sync(&member, &mut owner);
        owner.delete_chat(first.id, account(1)).unwrap();
        assert_eq!(
            reactions_of(&owner),
            vec![Vec::new(), vec![reaction("🎉", &[account(2)])]]
        );
        assert!(matches!(
            owner.react_to_chat(first.id, "👍", account(1), 5),
            Err(CollabError::Api { code, .. }) if code == "not_found"
        ));
        owner.clear_chat().unwrap();
        assert!(owner.loro().get_map(CHAT_REACTIONS).is_empty());
        sync(&owner, &mut member);
        assert!(reactions_of(&member).iter().all(Vec::is_empty));
    }

    #[test]
    fn a_reaction_in_someone_elses_name_is_not_shown() {
        let (mut owner, mut member) = pair();
        let sent = owner.send_chat(account(1), 1, "hello", &[]).unwrap();
        sync(&owner, &mut member);
        member.react_to_chat(sent.id, "👍", account(1), 2).unwrap();
        member.react_to_chat(sent.id, "👋", account(2), 3).unwrap();
        let mut authors = crate::comments::Authorship::default();
        authors.vouch([
            (owner.peer_id(), account(1)),
            (member.peer_id(), account(2)),
        ]);
        owner.set_authorship(authors);
        sync(&member, &mut owner);
        assert_eq!(
            reactions_of(&owner),
            vec![vec![reaction("👋", &[account(2)])]]
        );
    }

    const PICKED: [&str; 21] = [
        "👍", "🎉", "❤️", "😄", "👀", "🚀", "🍕", "👋", "🙏", "🔥", "✅", "💯", "🤔", "😂", "🥳",
        "👏", "🙌", "😮", "😢", "🇳🇴", "1️⃣",
    ];

    #[test]
    fn one_person_adds_at_most_twenty_reactions_to_a_message() {
        let (mut owner, _) = pair();
        let first = owner.send_chat(account(1), 1, "vote", &[]).unwrap();
        let second = owner.send_chat(account(1), 2, "again", &[]).unwrap();
        for (at, emoji) in (0_i64..).zip(&PICKED[..20]) {
            owner
                .react_to_chat(first.id, emoji, account(1), at)
                .unwrap();
        }
        assert!(matches!(
            owner.react_to_chat(first.id, PICKED[20], account(1), 30),
            Err(CollabError::Api { code, .. }) if code == "invalid"
        ));
        owner.react_to_chat(first.id, "👍", account(1), 31).unwrap();
        owner
            .react_to_chat(second.id, PICKED[20], account(1), 32)
            .unwrap();
        owner.unreact_to_chat(first.id, "👍", account(1)).unwrap();
        owner
            .react_to_chat(first.id, PICKED[20], account(1), 33)
            .unwrap();
        assert_eq!(reactions_of(&owner)[0].len(), 20);
    }

    #[test]
    fn a_full_reactions_map_takes_no_new_reaction_and_a_page_reads_only_its_own() {
        let (mut owner, _) = pair();
        let sent = owner.send_chat(account(1), 1, "hello", &[]).unwrap();
        let reactions = owner.loro().get_map(CHAT_REACTIONS);
        for _ in 0..oleafly_collab_protocol::reactions::MAX_REACTION_KEYS {
            let elsewhere = ChatMessageId::new_v7();
            reactions
                .insert(&format!("{elsewhere}|👍|{}", account(2)), 1)
                .unwrap();
        }
        owner.loro().commit();
        assert_eq!(reactions_of(&owner), vec![Vec::new()]);
        assert!(matches!(
            owner.react_to_chat(sent.id, "👍", account(1), 2),
            Err(CollabError::Api { code, .. }) if code == "invalid"
        ));
        reactions
            .delete(reactions.keys().next().unwrap().as_ref())
            .unwrap();
        owner.loro().commit();
        owner.react_to_chat(sent.id, "👍", account(1), 3).unwrap();
        assert_eq!(
            reactions_of(&owner),
            vec![vec![reaction("👍", &[account(1)])]]
        );
    }

    #[test]
    fn a_chat_mention_is_kept_with_the_message_and_handed_out_once() {
        let owner = ProjectDoc::create().unwrap();
        let snapshot = owner.snapshot().unwrap();
        let mut owner = crate::live::LiveProject::new(owner, 0, ProjectRole::Owner);
        let mut member = crate::live::LiveProject::new(
            ProjectDoc::load(&snapshot).unwrap(),
            0,
            ProjectRole::Editor,
        );
        let sent = member
            .comment_doc()
            .send_chat(account(2), 1, "@Owen look", &[account(1), account(1)])
            .unwrap();
        assert_eq!(sent.mentions, vec![account(1)]);
        member
            .comment_doc()
            .send_chat(account(2), 2, "no one", &[])
            .unwrap();
        let outgoing = member.next_outgoing().unwrap().unwrap();
        assert!(owner.import_update(1, &outgoing.payload).unwrap());
        assert_eq!(
            owner.take_chat_mentions(),
            vec![ChatMention {
                message_id: sent.id,
                author: account(2),
                mentions: vec![account(1)],
            }]
        );
        assert!(owner.take_chat_mentions().is_empty());
        let read = owner.doc().chat_messages(None, 10);
        assert_eq!(read[0].mentions, vec![account(1)]);
        assert!(read[1].mentions.is_empty());
        member.acknowledged(outgoing.batch, 1);
        member
            .comment_doc()
            .delete_chat(sent.id, account(2))
            .unwrap();
        assert!(member.doc().chat_messages(None, 10)[0].mentions.is_empty());
    }

    #[test]
    fn a_message_from_before_reactions_existed_still_reads() {
        let old = serde_json::json!({
            "id": ChatMessageId::new_v7().to_string(),
            "author": account(1).to_string(),
            "at": 1,
            "body": "hi",
            "deleted": false,
            "verified": true
        });
        let read: ChatMessage = serde_json::from_value(old).unwrap();
        assert!(read.reactions.is_empty());
        assert_eq!(read.edited_at, None);
        let wire = serde_json::to_value(&read).unwrap();
        assert_eq!(wire["editedAt"], serde_json::Value::Null);
        let online: ChatMessage<String, String> = serde_json::from_value(serde_json::json!({
            "id": "6b04e5f6c0ffee0010000001",
            "author": "6b04e5f6c0ffee0020000001",
            "at": 2,
            "body": "edited",
            "deleted": false,
            "verified": true,
            "editedAt": 3
        }))
        .unwrap();
        assert_eq!(
            (online.id.as_str(), online.edited_at),
            ("6b04e5f6c0ffee0010000001", Some(3))
        );
    }

    #[test]
    fn a_message_written_in_someone_elses_name_is_not_verified() {
        let (owner, mut member) = pair();
        let mut owner = owner;
        owner.set_authorship(crate::comments::Authorship::default());
        let forged = member
            .send_chat(account(1), 1, "I am the owner", &[])
            .unwrap();
        let mut authors = crate::comments::Authorship::default();
        authors.vouch([(member.peer_id(), account(2))]);
        owner.set_authorship(authors);
        sync(&member, &mut owner);
        let read = owner.chat_messages(None, 50);
        assert_eq!(read[0].id, forged.id);
        assert!(!read[0].verified);
    }
}
