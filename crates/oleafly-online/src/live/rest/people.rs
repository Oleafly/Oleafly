use super::review::reviewed;
use super::{json_of, ProjectRest, RestError};
use crate::live::rest::ReviewError;
use crate::realtime::events::ReviewUser;
use crate::realtime::project::Invite;
use crate::session::SessionHandle;

impl ProjectRest {
    pub async fn invites(&self, session: &SessionHandle) -> Result<Vec<Invite>, ReviewError> {
        let response = self
            .get(session, &self.route("/invites"))
            .await
            .map_err(reviewed)?;
        let reply = json_of(response).await?;
        let listed = reply
            .get("invites")
            .filter(|invites| invites.is_array())
            .ok_or_else(|| RestError::Unreadable("the invites are not a list".into()))?;
        Ok(Invite::list_from_value(listed))
    }

    pub async fn changes_users(
        &self,
        session: &SessionHandle,
    ) -> Result<Vec<ReviewUser>, ReviewError> {
        let response = self
            .get(session, &self.route("/changes/users"))
            .await
            .map_err(reviewed)?;
        let reply = json_of(response).await?;
        let listed = reply
            .as_array()
            .ok_or_else(|| RestError::Unreadable("the change authors are not a list".into()))?;
        Ok(listed.iter().filter_map(ReviewUser::from_value).collect())
    }
}
