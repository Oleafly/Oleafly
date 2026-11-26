use std::sync::Arc;
use std::time::Duration;

use super::{OverleafSession, Shared};
use crate::live::rest::{ProjectRest, ReviewError};
use crate::realtime::events::ReviewUser;
use crate::realtime::project::Role;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Standing {
    Member,
    Invited,
    Former,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Person {
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub role: Option<Role>,
    pub standing: Standing,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct People {
    pub people: Vec<Person>,
    pub link_shared: bool,
}

pub(super) async fn fetch_invites(
    shared: &Arc<Shared>,
    rest: &ProjectRest,
    deadline: Duration,
) -> Option<String> {
    let session = shared.session();
    match tokio::time::timeout(deadline, rest.invites(&session)).await {
        Ok(Ok(invites)) => {
            shared.with(|state| state.invites_fetched(invites));
            None
        }
        Ok(Err(error)) => Some(format!("the invites could not be read: {error}")),
        Err(_) => Some(format!(
            "the invites did not arrive within {} s",
            deadline.as_secs()
        )),
    }
}

pub(super) async fn fetch_change_authors(
    shared: &Arc<Shared>,
    rest: &ProjectRest,
    deadline: Duration,
) -> Option<String> {
    let session = shared.session();
    match tokio::time::timeout(deadline, rest.changes_users(&session)).await {
        Ok(Ok(users)) => {
            shared.with(|state| {
                state.authors_fetched(users);
                state.report_people();
            });
            None
        }
        Ok(Err(ReviewError::Absent)) => None,
        Ok(Err(error)) => Some(format!("the change authors could not be read: {error}")),
        Err(_) => Some(format!(
            "the change authors did not arrive within {} s",
            deadline.as_secs()
        )),
    }
}

impl OverleafSession {
    pub fn people(&self) -> People {
        self.shared.lock().people_view()
    }

    pub fn know_people<'a>(&self, users: impl IntoIterator<Item = &'a ReviewUser>) {
        self.shared.with(|state| {
            for user in users {
                state.saw_user(user);
            }
            state.report_people();
        });
    }
}
