use loro::event::ContainerDiff;
use loro::{Container, ContainerID, LoroList, LoroMap, LoroValue, ValueOrContainer};
use oleafly_collab_protocol::ids::{AccountId, ChatMessageId};
use serde::Serialize;

use crate::comments::{flag_of, number_of, parsed, string_of};
use crate::doc::ProjectDoc;
use crate::CollabError;

pub const CHAT: &str = "chat";
pub const MAX_CHAT_CHARS: usize = 4_000;
pub const MAX_CHAT_PAGE: usize = 200;
const ID: &str = "id";
const AUTHOR: &str = "author";
const AT: &str = "at";
const BODY: &str = "body";
const DELETED: &str = "deleted";
const WRITTEN: [&str; 4] = [ID, AUTHOR, AT, BODY];
const STAMPED: [&str; 3] = [ID, AUTHOR, AT];

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: ChatMessageId,
    pub author: AccountId,
    pub at: i64,
    pub body: String,
    pub deleted: bool,
    pub verified: bool,
}

fn loro_error<T: std::fmt::Debug>(error: T) -> CollabError {
    CollabError::Corrupt(format!("{error:?}"))
}

fn refused(status: u16, code: &str, message: &str) -> CollabError {
    CollabError::Api {
        status,
        code: code.to_owned(),
        message: message.to_owned(),
    }
}

pub(crate) fn chat_gone() -> CollabError {
    refused(404, "not_found", "this message is gone")
}

fn is_chat_root(id: &ContainerID) -> bool {
    matches!(id, ContainerID::Root { name, .. } if name.as_str() == CHAT)
}

pub(crate) fn record(change: &ContainerDiff<'_>) -> bool {
    match change.path.first() {
        Some((root, _)) => is_chat_root(root),
        None => is_chat_root(change.target),
    }
}

fn checked_body(body: &str) -> Result<&str, CollabError> {
    let body = body.trim();
    if body.is_empty() {
        return Err(refused(400, "empty", "a message needs some text"));
    }
    if body.chars().count() > MAX_CHAT_CHARS {
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

    fn chat_entries(&self) -> Vec<Found> {
        let list = self.chat_list();
        let judge = self.judge();
        (0..list.len())
            .filter_map(|index| {
                let Some(ValueOrContainer::Container(Container::Map(map))) = list.get(index) else {
                    return None;
                };
                let LoroValue::Map(fields) = map.get_deep_value() else {
                    return None;
                };
                let deleted = flag_of(fields.get(DELETED));
                let author: AccountId = parsed(fields.get(AUTHOR))?;
                let keys: &[&str] = if deleted { &STAMPED } else { &WRITTEN };
                Some(Found {
                    message: ChatMessage {
                        id: parsed(fields.get(ID))?,
                        author,
                        at: number_of(fields.get(AT)).unwrap_or_default(),
                        body: if deleted {
                            String::new()
                        } else {
                            string_of(fields.get(BODY)).unwrap_or_default()
                        },
                        deleted,
                        verified: judge.wrote(&map, keys, author),
                    },
                    map,
                })
            })
            .collect()
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
        messages[end.saturating_sub(limit)..end].to_vec()
    }

    pub fn send_chat(
        &mut self,
        author: AccountId,
        at: i64,
        body: &str,
    ) -> Result<ChatMessage, CollabError> {
        self.writable()?;
        let body = checked_body(body)?;
        let id = ChatMessageId::new_v7();
        let map = self
            .chat_list()
            .push_container(LoroMap::new())
            .map_err(loro_error)?;
        map.insert(ID, id.to_string()).map_err(loro_error)?;
        map.insert(AUTHOR, author.to_string()).map_err(loro_error)?;
        map.insert(AT, at).map_err(loro_error)?;
        map.insert(BODY, body).map_err(loro_error)?;
        self.loro().commit();
        Ok(ChatMessage {
            id,
            author,
            at,
            body: body.to_owned(),
            deleted: false,
            verified: true,
        })
    }

    pub fn chat_author(&self, id: ChatMessageId) -> Result<AccountId, CollabError> {
        self.chat_entries()
            .into_iter()
            .find(|found| found.message.id == id)
            .map(|found| found.message.author)
            .ok_or_else(chat_gone)
    }

    pub fn delete_chat(&mut self, id: ChatMessageId, by: AccountId) -> Result<(), CollabError> {
        self.writable()?;
        let found = self
            .chat_entries()
            .into_iter()
            .find(|found| found.message.id == id)
            .ok_or_else(chat_gone)?;
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
        if cleared > 0 {
            self.loro().commit();
        }
        Ok(cleared)
    }
}

#[cfg(test)]
mod tests {
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
                .send_chat(account(1), index, &format!("note {index}"))
                .unwrap();
        }
        sync(&owner, &mut member);
        let sent = member.send_chat(account(2), 9, "  reply  ").unwrap();
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
        let first = owner.send_chat(account(1), 1, "mine").unwrap();
        sync(&owner, &mut member);
        let second = member.send_chat(account(2), 2, "theirs").unwrap();
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
            owner.send_chat(account(1), 1, "   "),
            Err(CollabError::Api { code, .. }) if code == "empty"
        ));
        assert!(matches!(
            owner.send_chat(account(1), 1, &"x".repeat(MAX_CHAT_CHARS + 1)),
            Err(CollabError::Api { code, .. }) if code == "too_large"
        ));
        assert!(owner.chat_messages(None, 50).is_empty());
    }

    #[test]
    fn a_message_written_in_someone_elses_name_is_not_verified() {
        let (owner, mut member) = pair();
        let mut owner = owner;
        owner.set_authorship(crate::comments::Authorship::default());
        let forged = member.send_chat(account(1), 1, "I am the owner").unwrap();
        let mut authors = crate::comments::Authorship::default();
        authors.vouch([(member.peer_id(), account(2))]);
        owner.set_authorship(authors);
        sync(&member, &mut owner);
        let read = owner.chat_messages(None, 50);
        assert_eq!(read[0].id, forged.id);
        assert!(!read[0].verified);
    }
}
