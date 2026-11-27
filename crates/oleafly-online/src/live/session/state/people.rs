use std::collections::{BTreeMap, BTreeSet};

use super::{Notice, State};
use crate::live::session::people::{People, Person, Standing};
use crate::realtime::events::{ReviewUser, Thread, ThreadMessage};
use crate::realtime::project::{Invite, Role};

const LINK_SHARED: &str = "tokenBased";

#[derive(Default)]
pub(in crate::live::session) struct PeopleBook {
    seen: BTreeMap<String, ReviewUser>,
    invites_wanted: bool,
    authors_wanted: bool,
    dirty: bool,
}

fn named(text: &Option<String>) -> String {
    text.clone().unwrap_or_default()
}

impl State {
    fn on_roster(&self, id: &str) -> bool {
        self.project.members.all().any(|member| member.id == id)
    }

    pub(in crate::live::session) fn saw_user(&mut self, user: &ReviewUser) {
        let known = self.people.seen.get(&user.id);
        let richer = known.is_none_or(|known| {
            known != user
                && (user.first_name.is_some() || user.last_name.is_some() || user.email.is_some())
        });
        if !richer {
            return;
        }
        let former = !self.on_roster(&user.id);
        self.people.seen.insert(user.id.clone(), user.clone());
        self.people.dirty |= former;
    }

    pub(in crate::live::session) fn saw_messages(&mut self, messages: &[ThreadMessage]) {
        for user in messages.iter().filter_map(|message| message.user.as_ref()) {
            self.saw_user(user);
        }
    }

    pub(in crate::live::session) fn saw_threads(&mut self, threads: &[Thread]) {
        for thread in threads {
            self.saw_messages(&thread.messages);
            if let Some(by) = thread
                .resolved
                .as_ref()
                .and_then(|resolution| resolution.by.as_ref())
            {
                self.saw_user(by);
            }
        }
    }

    pub(in crate::live::session) fn want_invites(&mut self) {
        if self.project.role == Role::Owner && !self.project.restricted {
            self.people.invites_wanted = true;
        }
    }

    pub(in crate::live::session) fn invite_fetch_wanted(&self) -> bool {
        self.people.invites_wanted && self.ended.is_none()
    }

    pub(in crate::live::session) fn take_invite_fetch(&mut self) -> bool {
        std::mem::take(&mut self.people.invites_wanted) && self.ended.is_none()
    }

    pub(in crate::live::session) fn invites_fetched(&mut self, invites: Vec<Invite>) {
        if self.project.members.invites != invites {
            self.project.members.invites = invites;
            self.notices.push(Notice::MembersChanged);
        }
    }

    pub(in crate::live::session) fn want_change_authors(&mut self) {
        if !self.project.restricted {
            self.people.authors_wanted = true;
        }
    }

    pub(in crate::live::session) fn authors_fetch_wanted(&self) -> bool {
        self.people.authors_wanted && self.ended.is_none()
    }

    pub(in crate::live::session) fn take_authors_fetch(&mut self) -> bool {
        std::mem::take(&mut self.people.authors_wanted) && self.ended.is_none()
    }

    pub(in crate::live::session) fn authors_fetched(&mut self, users: Vec<ReviewUser>) {
        for user in &users {
            self.saw_user(user);
        }
    }

    pub(in crate::live::session) fn forget_people(&mut self) {
        self.people = PeopleBook::default();
    }

    pub(in crate::live::session) fn report_people(&mut self) {
        if std::mem::take(&mut self.people.dirty) {
            self.notices.push(Notice::MembersChanged);
        }
    }

    pub(in crate::live::session) fn people_view(&self) -> People {
        let members = &self.project.members;
        let mut people: Vec<Person> = members
            .all()
            .map(|member| Person {
                id: member.id.clone(),
                first_name: member.first_name.clone(),
                last_name: member.last_name.clone(),
                email: member.email.clone(),
                role: Some(member.role),
                standing: Standing::Member,
            })
            .collect();
        let emails: BTreeSet<String> = members
            .all()
            .map(|member| member.email.trim().to_lowercase())
            .filter(|email| !email.is_empty())
            .collect();
        people.extend(
            members
                .invites
                .iter()
                .filter(|invite| !emails.contains(&invite.email.to_lowercase()))
                .map(|invite| Person {
                    id: invite.id.clone(),
                    first_name: String::new(),
                    last_name: String::new(),
                    email: invite.email.clone(),
                    role: Some(invite.role),
                    standing: Standing::Invited,
                }),
        );
        people.extend(
            self.people
                .seen
                .values()
                .filter(|user| !self.on_roster(&user.id))
                .map(|user| Person {
                    id: user.id.clone(),
                    first_name: named(&user.first_name),
                    last_name: named(&user.last_name),
                    email: named(&user.email),
                    role: None,
                    standing: Standing::Former,
                }),
        );
        People {
            people,
            link_shared: self.project.public_access.as_deref() == Some(LINK_SHARED),
        }
    }
}
