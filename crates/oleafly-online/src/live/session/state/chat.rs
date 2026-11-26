use super::{now_ms, Notice, State};
use crate::live::session::chat::{ChatChange, ChatEntry, ChatSupport};
use crate::live::session::review::ReviewWriteError;
use crate::realtime::events::{ChatEvent, ThreadMessage};

const PENDING_KEPT: usize = 32;
const PENDING_FOR_MS: i64 = 2 * 60 * 1000;
const CLOCK_SKEW_MS: i64 = 60 * 1000;
pub(in crate::live::session) const LOCAL_MESSAGE: &str = "local-";

fn client_id() -> String {
    let bytes: [u8; 16] = rand::random();
    let hex = oleafly_core::encoding::hex_lower(&bytes);
    format!(
        "{}-{}-4{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[13..16],
        &hex[16..20],
        &hex[20..32]
    )
}

fn now() -> i64 {
    i64::try_from(now_ms()).unwrap_or(i64::MAX)
}

fn stamp(message: &ThreadMessage) -> i64 {
    message.timestamp.unwrap_or_default()
}

fn order(entry: &ChatEntry) -> (i64, &str) {
    (stamp(&entry.message), entry.message.id.as_str())
}

fn tombstone(entry: &mut ChatEntry) -> bool {
    if entry.deleted {
        return false;
    }
    entry.deleted = true;
    entry.message.content.clear();
    entry.message.edited_at = None;
    true
}

fn live(message: ThreadMessage) -> ChatEntry {
    ChatEntry {
        message,
        deleted: false,
        pending: false,
    }
}

struct Pending {
    key: u64,
    content: String,
    at: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::live::session) struct ChatTicket {
    since: u64,
    started: i64,
}

pub(in crate::live::session) enum Paged {
    Ready(Vec<ChatEntry>),
    Fetch(Option<i64>),
}

pub(in crate::live::session) struct ChatBook {
    support: ChatSupport,
    client_id: String,
    messages: Vec<ChatEntry>,
    loaded: bool,
    complete: bool,
    stale: bool,
    fetches: Vec<u64>,
    replay: Vec<(u64, ChatEvent)>,
    seq: u64,
    pending: Vec<Pending>,
    sent: Vec<(u64, ThreadMessage)>,
    claimed: Vec<String>,
    next_key: u64,
    dirty: bool,
    others: bool,
    support_dirty: bool,
    trouble: Option<String>,
}

impl Default for ChatBook {
    fn default() -> ChatBook {
        ChatBook {
            support: ChatSupport::default(),
            client_id: client_id(),
            messages: Vec::new(),
            loaded: false,
            complete: false,
            stale: false,
            fetches: Vec::new(),
            replay: Vec::new(),
            seq: 0,
            pending: Vec::new(),
            sent: Vec::new(),
            claimed: Vec::new(),
            next_key: 0,
            dirty: false,
            others: false,
            support_dirty: false,
            trouble: None,
        }
    }
}

impl ChatBook {
    fn position(&self, id: &str) -> Option<usize> {
        self.messages
            .iter()
            .position(|entry| entry.message.id == id)
    }

    fn upsert(&mut self, message: ThreadMessage) -> bool {
        let fresh = live(message);
        if let Some(index) = self.position(&fresh.message.id) {
            if self.messages[index] == fresh {
                return false;
            }
            self.messages.remove(index);
        }
        let at = self
            .messages
            .partition_point(|entry| order(entry) <= order(&fresh));
        self.messages.insert(at, fresh);
        true
    }

    fn live_count(entries: &[ChatEntry]) -> usize {
        entries.iter().filter(|entry| !entry.deleted).count()
    }

    fn tail(entries: &[ChatEntry], limit: usize) -> Vec<ChatEntry> {
        let mut found = 0;
        let mut start = entries.len();
        while start > 0 && found < limit {
            start -= 1;
            if !entries[start].deleted {
                found += 1;
            }
        }
        while start > 0 && entries[start - 1].deleted {
            start -= 1;
        }
        entries[start..].to_vec()
    }

    fn confirm(&mut self, message: &ThreadMessage) {
        let Some(index) = self
            .pending
            .iter()
            .position(|pending| pending.content == message.content)
        else {
            return;
        };
        let pending = self.pending.remove(index);
        self.sent.push((pending.key, message.clone()));
        if self.sent.len() > PENDING_KEPT {
            self.sent.remove(0);
        }
    }

    fn merged(&mut self, page: Vec<ThreadMessage>, from: Option<i64>, until: i64) -> bool {
        let mut changed = false;
        for entry in &mut self.messages {
            let at = stamp(&entry.message);
            let covered = from.is_none_or(|from| at >= from) && at <= until;
            if covered && !page.iter().any(|message| message.id == entry.message.id) {
                changed |= tombstone(entry);
            }
        }
        for message in page {
            changed |= self.upsert(message);
        }
        changed
    }

    fn begin(&mut self) -> ChatTicket {
        self.fetches.push(self.seq);
        ChatTicket {
            since: self.seq,
            started: now(),
        }
    }

    fn end(&mut self, ticket: ChatTicket) -> Vec<ChatEvent> {
        if let Some(index) = self.fetches.iter().position(|since| *since == ticket.since) {
            self.fetches.remove(index);
        }
        let again: Vec<ChatEvent> = self
            .replay
            .iter()
            .filter(|(seq, _)| *seq >= ticket.since)
            .map(|(_, event)| event.clone())
            .collect();
        match self.fetches.iter().min() {
            Some(oldest) => self.replay.retain(|(seq, _)| seq >= oldest),
            None => self.replay.clear(),
        }
        again
    }

    fn note(&mut self, event: ChatEvent) {
        if !self.fetches.is_empty() {
            self.replay.push((self.seq, event));
        }
        self.seq += 1;
    }
}

impl State {
    fn chat_mine(&self, user: Option<&str>) -> bool {
        user == Some(self.me.as_str())
    }

    pub(in crate::live::session) fn chat_support(&self) -> ChatSupport {
        self.chat.support
    }

    pub(in crate::live::session) fn chat_client_id(&self) -> String {
        self.chat.client_id.clone()
    }

    pub(in crate::live::session) fn set_chat_support(&mut self, available: bool) {
        let support = ChatSupport {
            probed: true,
            available: available && !self.project.restricted,
        };
        if support != self.chat.support {
            self.chat.support = support;
            self.chat.support_dirty = true;
        }
        if !support.available {
            let had = !self.chat.messages.is_empty();
            self.forget_chat_messages();
            self.chat.dirty |= had;
        }
    }

    fn forget_chat_messages(&mut self) {
        let book = &mut self.chat;
        book.messages.clear();
        book.loaded = false;
        book.complete = false;
        book.stale = false;
        book.replay.clear();
        book.pending.clear();
        book.sent.clear();
        book.claimed.clear();
    }

    pub(in crate::live::session) fn forget_chat(&mut self) {
        self.forget_chat_messages();
        self.chat.support = ChatSupport::default();
        self.chat.trouble = None;
    }

    pub(in crate::live::session) fn chat_rejoined(&mut self) {
        self.chat.stale = true;
    }

    pub(in crate::live::session) fn chat_fetch_wanted(&self) -> bool {
        self.chat.stale
            && self.chat.support.available
            && !self.project.restricted
            && self.ended.is_none()
    }

    pub(in crate::live::session) fn take_chat_fetch(&mut self) -> Option<ChatTicket> {
        if !self.chat_fetch_wanted() {
            return None;
        }
        self.chat.stale = false;
        Some(self.chat.begin())
    }

    pub(in crate::live::session) fn begin_chat_fetch(&mut self) -> ChatTicket {
        self.chat.begin()
    }

    pub(in crate::live::session) fn chat_writable(&self) -> Result<(), ReviewWriteError> {
        if self.ended.is_some() {
            return Err(ReviewWriteError::Ended);
        }
        if self.project.restricted {
            return Err(ReviewWriteError::Restricted);
        }
        let support = self.chat.support;
        if support.probed && !support.available {
            return Err(ReviewWriteError::Absent);
        }
        Ok(())
    }

    pub(in crate::live::session) fn chat_editable(&self, id: &str) -> Result<(), ReviewWriteError> {
        self.chat_writable()?;
        let gone = id.starts_with(LOCAL_MESSAGE)
            || self
                .chat
                .position(id)
                .is_some_and(|index| self.chat.messages[index].deleted);
        if gone {
            return Err(ReviewWriteError::Gone);
        }
        Ok(())
    }

    fn replay_chat(&mut self, ticket: ChatTicket) -> bool {
        let mut changed = false;
        for event in self.chat.end(ticket) {
            changed |= self.apply_chat(event);
        }
        changed
    }

    pub(in crate::live::session) fn chat_fetched(
        &mut self,
        ticket: ChatTicket,
        page: Vec<ThreadMessage>,
        limit: usize,
    ) {
        let newest_before = self
            .chat
            .messages
            .last()
            .map(|entry| stamp(&entry.message))
            .filter(|_| self.chat.loaded);
        self.saw_messages(&page);
        let full = page.len() >= limit;
        let from = full.then(|| page.iter().map(stamp).min()).flatten();
        let arrived = page.iter().any(|message| {
            newest_before.is_some_and(|newest| stamp(message) > newest)
                && !self.chat_mine(message.user_id.as_deref())
        });
        let me = self.me.clone();
        for message in page
            .iter()
            .filter(|message| message.user_id.as_deref() == Some(me.as_str()))
        {
            self.chat.confirm(message);
        }
        let mut changed = self.chat.merged(page, from, ticket.started);
        self.chat.complete |= !full;
        let cutoff = now() - PENDING_FOR_MS;
        self.chat.pending.retain(|pending| pending.at >= cutoff);
        changed |= self.replay_chat(ticket);
        self.chat.loaded = true;
        self.chat.others |= arrived;
        self.chat.dirty |= changed || self.chat.trouble.is_some() || newest_before.is_none();
        self.chat.trouble = None;
    }

    pub(in crate::live::session) fn chat_older_fetched(
        &mut self,
        ticket: ChatTicket,
        before: i64,
        page: Vec<ThreadMessage>,
        limit: usize,
    ) {
        self.saw_messages(&page);
        let full = page.len() >= limit;
        let from = full.then(|| page.iter().map(stamp).min()).flatten();
        self.chat.complete |= !full;
        let mut changed = self.chat.merged(page, from, before.saturating_sub(1));
        changed |= self.replay_chat(ticket);
        self.chat.dirty |= changed;
    }

    pub(in crate::live::session) fn chat_fetch_failed(&mut self, ticket: ChatTicket) {
        if self.replay_chat(ticket) {
            self.chat.dirty = true;
        }
    }

    pub(in crate::live::session) fn chat_trouble(&mut self, reason: String) {
        if self.chat.trouble.as_ref() != Some(&reason) {
            self.chat.trouble = Some(reason);
            self.chat.dirty = true;
        }
    }

    pub(in crate::live::session) fn chat_event(&mut self, event: ChatEvent) {
        let support = self.chat.support;
        if self.project.restricted || (support.probed && !support.available) {
            return;
        }
        self.chat.note(event.clone());
        if self.apply_chat(event) {
            self.chat.dirty = true;
        }
    }

    fn apply_chat(&mut self, event: ChatEvent) -> bool {
        match event {
            ChatEvent::New { message, client_id } => {
                let message = *message;
                self.saw_messages(std::slice::from_ref(&message));
                let echo = client_id.as_deref() == Some(self.chat.client_id.as_str());
                let mine = echo || self.chat_mine(message.user_id.as_deref());
                if echo {
                    self.chat.confirm(&message);
                }
                let known = self
                    .chat
                    .position(&message.id)
                    .is_some_and(|index| !self.chat.messages[index].deleted);
                if known {
                    return false;
                }
                self.chat.others |= !mine;
                self.chat.upsert(message)
            }
            ChatEvent::Edited {
                message,
                user_id,
                content,
            } => {
                let mine = self.chat_mine(user_id.as_deref());
                let Some(index) = self.chat.position(&message) else {
                    return false;
                };
                let entry = &mut self.chat.messages[index];
                if entry.deleted || entry.message.content == content {
                    return false;
                }
                entry.message.content = content;
                entry.message.edited_at = Some(now());
                self.chat.others |= !mine;
                true
            }
            ChatEvent::Deleted { message, user_id } => {
                let mine = self.chat_mine(user_id.as_deref());
                let Some(index) = self.chat.position(&message) else {
                    return false;
                };
                let removed = tombstone(&mut self.chat.messages[index]);
                self.chat.others |= removed && !mine;
                removed
            }
        }
    }

    pub(in crate::live::session) fn chat_page(
        &self,
        before: Option<&str>,
        limit: usize,
    ) -> Result<Paged, ReviewWriteError> {
        self.chat_writable()?;
        let book = &self.chat;
        let oldest = book.messages.first().map(|entry| stamp(&entry.message));
        let entries = match before {
            Some(id) => &book.messages[..book.position(id).ok_or(ReviewWriteError::Gone)?],
            None if !book.loaded => return Ok(Paged::Fetch(None)),
            None => &book.messages[..],
        };
        if book.complete || ChatBook::live_count(entries) >= limit {
            return Ok(Paged::Ready(ChatBook::tail(entries, limit)));
        }
        Ok(Paged::Fetch(oldest))
    }

    pub(in crate::live::session) fn chat_served(
        &self,
        before: Option<&str>,
        limit: usize,
    ) -> Vec<ChatEntry> {
        let book = &self.chat;
        let entries = match before {
            Some(id) => match book.position(id) {
                Some(index) => &book.messages[..index],
                None => &[],
            },
            None => &book.messages[..],
        };
        ChatBook::tail(entries, limit)
    }

    pub(in crate::live::session) fn begin_chat_send(&mut self, content: &str) -> (u64, i64) {
        let book = &mut self.chat;
        book.next_key += 1;
        let at = now();
        book.pending.push(Pending {
            key: book.next_key,
            content: content.to_string(),
            at,
        });
        if book.pending.len() > PENDING_KEPT {
            book.pending.remove(0);
        }
        (book.next_key, at)
    }

    pub(in crate::live::session) fn take_chat_echo(&mut self, key: u64) -> Option<ThreadMessage> {
        let index = self.chat.sent.iter().position(|(sent, _)| *sent == key)?;
        Some(self.chat.sent.remove(index).1)
    }

    pub(in crate::live::session) fn cancel_chat_send(&mut self, key: u64) {
        self.chat.pending.retain(|pending| pending.key != key);
    }

    pub(in crate::live::session) fn adopt_chat_send(
        &mut self,
        key: u64,
        recent: Vec<ThreadMessage>,
        content: &str,
        since: i64,
    ) -> Option<ThreadMessage> {
        self.saw_messages(&recent);
        if let Some(echo) = self.take_chat_echo(key) {
            return Some(echo);
        }
        let found = recent
            .into_iter()
            .filter(|message| {
                self.chat_mine(message.user_id.as_deref())
                    && message.content == content
                    && stamp(message) >= since.saturating_sub(CLOCK_SKEW_MS)
                    && !self.chat.claimed.contains(&message.id)
            })
            .max_by_key(stamp)?;
        self.cancel_chat_send(key);
        Some(found)
    }

    pub(in crate::live::session) fn provisional_chat(
        &self,
        key: u64,
        content: &str,
        at: i64,
    ) -> ChatEntry {
        ChatEntry {
            message: ThreadMessage {
                id: format!("{LOCAL_MESSAGE}{key}"),
                user_id: Some(self.me.clone()),
                content: content.to_string(),
                timestamp: Some(at),
                edited_at: None,
                user: Some(self.me_as_user()),
            },
            deleted: false,
            pending: true,
        }
    }

    pub(in crate::live::session) fn chat_entry(&self, id: &str) -> Option<ChatEntry> {
        let index = self.chat.position(id)?;
        Some(self.chat.messages[index].clone())
    }

    pub(in crate::live::session) fn chat_sent(&mut self, message: ThreadMessage) -> ChatEntry {
        self.chat.claimed.push(message.id.clone());
        if self.chat.claimed.len() > PENDING_KEPT {
            self.chat.claimed.remove(0);
        }
        let known = self
            .chat
            .position(&message.id)
            .is_some_and(|index| !self.chat.messages[index].deleted);
        if !known && self.chat.upsert(message.clone()) {
            self.chat.dirty = true;
        }
        self.chat_entry(&message.id)
            .unwrap_or_else(|| live(message))
    }

    pub(in crate::live::session) fn chat_edited(
        &mut self,
        id: &str,
        content: &str,
    ) -> Result<ChatEntry, ReviewWriteError> {
        let event = ChatEvent::Edited {
            message: id.to_string(),
            user_id: Some(self.me.clone()),
            content: content.to_string(),
        };
        self.chat.note(event.clone());
        if self.apply_chat(event) {
            self.chat.dirty = true;
        }
        self.chat_entry(id)
            .filter(|entry| !entry.deleted)
            .ok_or(ReviewWriteError::Gone)
    }

    pub(in crate::live::session) fn chat_deleted(&mut self, id: &str) {
        let event = ChatEvent::Deleted {
            message: id.to_string(),
            user_id: Some(self.me.clone()),
        };
        self.chat.note(event.clone());
        if self.apply_chat(event) {
            self.chat.dirty = true;
        }
    }

    pub(in crate::live::session) fn report_chat(&mut self) {
        let book = &mut self.chat;
        if !book.dirty && !book.support_dirty {
            return;
        }
        let change = ChatChange {
            local: !std::mem::take(&mut book.others),
            support: std::mem::take(&mut book.support_dirty),
            trouble: book.trouble.clone(),
        };
        book.dirty = false;
        self.notices.push(Notice::Chat(change));
    }
}
