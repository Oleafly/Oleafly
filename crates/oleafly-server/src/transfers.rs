use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::http::{header, HeaderMap};

use crate::error::ServerError;
use crate::routes::read_body_within;

const TOOK_TOO_LONG: &str = "The upload took too long. Try again.";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UploadTiming {
    pub grace: Duration,
    pub min_rate: u64,
}

impl Default for UploadTiming {
    fn default() -> UploadTiming {
        UploadTiming {
            grace: Duration::from_secs(30),
            min_rate: 64 * 1024,
        }
    }
}

impl UploadTiming {
    pub fn limit_for(&self, bytes: u64) -> Duration {
        self.grace
            .saturating_add(Duration::from_secs(bytes / self.min_rate.max(1)))
    }
}

#[derive(Clone, Default)]
pub struct Transfers {
    timing: Arc<Mutex<UploadTiming>>,
}

impl Transfers {
    pub fn set_timing(&self, timing: UploadTiming) {
        *self.timing.lock().unwrap_or_else(PoisonError::into_inner) = timing;
    }

    pub fn timing(&self) -> UploadTiming {
        *self.timing.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub async fn read_body(
        &self,
        body: Body,
        headers: &HeaderMap,
        limit: u64,
    ) -> Result<Option<Bytes>, ServerError> {
        let declared = declared_length(headers);
        if declared.is_some_and(|length| length > limit) {
            return Ok(None);
        }
        let within = self.timing().limit_for(declared.unwrap_or(limit));
        tokio::time::timeout(within, read_body_within(body, limit))
            .await
            .map_err(|_| ServerError::BadRequest(TOOK_TOO_LONG.to_string()))?
    }
}

pub fn declared_length(headers: &HeaderMap) -> Option<u64> {
    headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn an_upload_may_take_longer_the_more_it_carries() {
        let timing = UploadTiming::default();
        assert_eq!(timing.limit_for(0), Duration::from_secs(30));
        assert_eq!(timing.limit_for(64 * 1024 * 10), Duration::from_secs(40));
        let unlimited = UploadTiming {
            min_rate: 0,
            ..timing
        };
        assert!(unlimited.limit_for(u64::MAX) >= Duration::from_secs(30));
    }

    #[tokio::test]
    async fn a_body_declared_larger_than_the_limit_is_refused_unread() {
        let transfers = Transfers::default();
        let mut headers = HeaderMap::new();
        headers.insert(header::CONTENT_LENGTH, HeaderValue::from_static("2048"));
        let read = transfers
            .read_body(Body::from(vec![1u8; 16]), &headers, 1024)
            .await
            .expect("the request is answered");
        assert!(read.is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn a_body_that_stops_arriving_ends_after_its_time() {
        let transfers = Transfers::default();
        transfers.set_timing(UploadTiming {
            grace: Duration::from_secs(2),
            min_rate: u64::MAX,
        });
        let (_keep_open, waiting) = tokio::sync::mpsc::channel::<()>(1);
        let stalled = stalled_body(waiting);
        let read = transfers.read_body(stalled, &HeaderMap::new(), 1024).await;
        assert_eq!(
            read,
            Err(ServerError::BadRequest(TOOK_TOO_LONG.to_string()))
        );
    }

    fn stalled_body(mut waiting: tokio::sync::mpsc::Receiver<()>) -> Body {
        use futures_util::stream;
        Body::from_stream(stream::poll_fn(move |context| {
            waiting
                .poll_recv(context)
                .map(|_| None::<Result<Bytes, std::io::Error>>)
        }))
    }
}
