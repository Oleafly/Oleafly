use std::time::Duration;

use super::linked::Raced;
use super::OverleafSession;
use crate::live::rest::{RestError, SPELLING_DEADLINE};
use crate::realtime::page::plain_word;

pub const SPELL_BATCH: usize = 200;
const BATCH_DEADLINE: Duration = Duration::from_secs(120);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SpellStop {
    Ended,
    Full,
    TimedOut,
    Refused(RestError),
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Spelled {
    pub learned: Vec<String>,
    pub unlearned: Vec<String>,
    pub stopped: Option<SpellStop>,
}

fn stop_of(error: RestError) -> SpellStop {
    match error {
        RestError::Refused {
            status: 400,
            message,
        } if message.to_ascii_lowercase().contains("dictionary size") => SpellStop::Full,
        other => SpellStop::Refused(other),
    }
}

impl OverleafSession {
    pub fn learned_words(&self) -> Option<Vec<String>> {
        self.rest.learned_words()
    }

    pub async fn spell(&self, learn: &[String], unlearn: &[String]) -> Spelled {
        let mut spelled = Spelled::default();
        if self.shared.is_stopping() || self.shared.lock().ended.is_some() {
            spelled.stopped = Some(SpellStop::Ended);
            return spelled;
        }
        let deadline = tokio::time::Instant::now() + BATCH_DEADLINE;
        let work = unlearn
            .iter()
            .map(|word| (word, false))
            .chain(learn.iter().map(|word| (word, true)))
            .take(SPELL_BATCH);
        for (word, learning) in work {
            if !plain_word(word) {
                continue;
            }
            let left = deadline.saturating_duration_since(tokio::time::Instant::now());
            if left.is_zero() {
                spelled.stopped = Some(SpellStop::TimedOut);
                break;
            }
            let session = self.shared.session();
            let call = self.rest.spell(&session, word, learning);
            let outcome = match self.raced(SPELLING_DEADLINE.min(left), call).await {
                Raced::Done(outcome) => outcome.map_err(stop_of),
                Raced::TimedOut(_) => Err(SpellStop::TimedOut),
                Raced::Stopped => Err(SpellStop::Ended),
            };
            match outcome {
                Ok(()) if learning => spelled.learned.push(word.clone()),
                Ok(()) => spelled.unlearned.push(word.clone()),
                Err(stop) => {
                    spelled.stopped = Some(stop);
                    break;
                }
            }
        }
        spelled
    }
}
