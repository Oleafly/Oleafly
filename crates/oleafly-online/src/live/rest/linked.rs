use std::time::Duration;

use serde_json::json;

use super::{id_in, json_of, ProjectRest, RestError};
use crate::realtime::events::{plain_id, EntityId};
use crate::session::SessionHandle;

pub const REFRESH_DEADLINE: Duration = Duration::from_secs(240);

impl ProjectRest {
    pub async fn refresh_linked(
        &self,
        session: &SessionHandle,
        file: &EntityId,
        reindex: bool,
        total: Duration,
    ) -> Result<EntityId, RestError> {
        if !plain_id(&file.0) {
            return Err(RestError::Refused {
                status: 400,
                message: "a file id with unexpected characters".into(),
            });
        }
        let path = self.route(&format!("/linked_file/{}/refresh", file.0));
        let body = json!({ "shouldReindexReferences": reindex });
        let response = self
            .write(session, |cookie| {
                self.http.post_unhurried(&path, cookie, total).json(&body)
            })
            .await?;
        let fresh = id_in(&json_of(response).await?, "new_file_id")?;
        if plain_id(&fresh.0) {
            Ok(fresh)
        } else {
            Err(RestError::Unreadable(
                "the new file id has unexpected characters".into(),
            ))
        }
    }
}

#[cfg(test)]
mod tests;
