use std::time::Duration;

use serde_json::json;

use super::{ProjectRest, RestError};
use crate::realtime::page::plain_word;
use crate::session::SessionHandle;

pub const SPELLING_DEADLINE: Duration = Duration::from_secs(15);

impl ProjectRest {
    pub fn learned_words(&self) -> Option<Vec<String>> {
        self.page.learned_words()
    }

    pub async fn spell(
        &self,
        session: &SessionHandle,
        word: &str,
        learn: bool,
    ) -> Result<(), RestError> {
        if !plain_word(word) {
            return Err(RestError::Refused {
                status: 400,
                message: "a word Overleaf can't keep".into(),
            });
        }
        let path = if learn {
            "/spelling/learn"
        } else {
            "/spelling/unlearn"
        };
        let body = json!({ "word": word });
        self.write(session, |cookie| self.http.post(path, cookie).json(&body))
            .await
            .map(drop)
    }
}

#[cfg(test)]
mod tests;
