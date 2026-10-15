use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::http::{header, HeaderMap};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use crate::error::ServerError;
use crate::routes::read_body_within;

const TOOK_TOO_LONG: &str = "The upload took too long. Try again.";
const KIB: u64 = 1024;
// Smaller transfers pass without waiting for room in the budget.
pub const SMALL_TRANSFER: u64 = 1024 * 1024;
pub const DEFAULT_TRANSFER_BUDGET: u64 = 256 * 1024 * 1024;

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

struct Gate {
    permits: Arc<Semaphore>,
    total: u32,
}

impl Gate {
    fn for_bytes(bytes: u64) -> Gate {
        let total = u32::try_from(bytes.div_ceil(KIB).max(1)).unwrap_or(u32::MAX);
        Gate {
            permits: Arc::new(Semaphore::new(total as usize)),
            total,
        }
    }
}

// Files and snapshots are held whole in memory while they are uploaded or
// downloaded. Each large transfer takes its size from one shared budget and
// waits while the budget is spent, so many people opening a project at
// once take turns instead of holding every file at the same time.
#[derive(Clone)]
pub struct Transfers {
    timing: Arc<Mutex<UploadTiming>>,
    gate: Arc<Mutex<Gate>>,
}

impl Default for Transfers {
    fn default() -> Transfers {
        Transfers::with_budget(DEFAULT_TRANSFER_BUDGET)
    }
}

pub struct TransferPermit(Option<OwnedSemaphorePermit>);

struct HeldBytes {
    bytes: Bytes,
    _permit: TransferPermit,
}

impl AsRef<[u8]> for HeldBytes {
    fn as_ref(&self) -> &[u8] {
        &self.bytes
    }
}

impl TransferPermit {
    // Ties the permit to the bytes, so it goes back only once the response
    // that carries them has been sent and dropped.
    pub fn keep_with(self, bytes: Bytes) -> Bytes {
        if self.0.is_none() {
            return bytes;
        }
        Bytes::from_owner(HeldBytes {
            bytes,
            _permit: self,
        })
    }
}

impl Transfers {
    pub fn with_budget(bytes: u64) -> Transfers {
        Transfers {
            timing: Arc::new(Mutex::new(UploadTiming::default())),
            gate: Arc::new(Mutex::new(Gate::for_bytes(bytes))),
        }
    }

    pub fn set_budget(&self, bytes: u64) {
        *self.gate.lock().unwrap_or_else(PoisonError::into_inner) = Gate::for_bytes(bytes);
    }

    pub async fn hold(&self, bytes: u64) -> TransferPermit {
        if bytes < SMALL_TRANSFER {
            return TransferPermit(None);
        }
        let (permits, total) = {
            let gate = self.gate.lock().unwrap_or_else(PoisonError::into_inner);
            (Arc::clone(&gate.permits), gate.total)
        };
        let wanted = u32::try_from(bytes.div_ceil(KIB))
            .unwrap_or(u32::MAX)
            .min(total);
        TransferPermit(permits.acquire_many_owned(wanted).await.ok())
    }

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

    #[tokio::test]
    async fn large_transfers_take_turns_within_the_budget() {
        let transfers = Transfers::with_budget(4 * SMALL_TRANSFER);
        let first = transfers.hold(3 * SMALL_TRANSFER).await;
        let small = transfers.hold(SMALL_TRANSFER - 1).await;
        assert!(small.0.is_none());
        let waiting = transfers.hold(2 * SMALL_TRANSFER);
        tokio::pin!(waiting);
        assert!(
            tokio::time::timeout(Duration::from_millis(50), &mut waiting)
                .await
                .is_err(),
            "a transfer that does not fit waits"
        );
        let sent = first.keep_with(Bytes::from(vec![7u8; 16]));
        let copy = sent.clone();
        drop(sent);
        assert!(
            tokio::time::timeout(Duration::from_millis(50), &mut waiting)
                .await
                .is_err(),
            "the permit stays while the bytes are still held"
        );
        drop(copy);
        let second = tokio::time::timeout(Duration::from_secs(1), waiting)
            .await
            .expect("room once the first transfer's bytes are gone");
        assert!(second.0.is_some());
        drop(second);
        let larger_than_the_budget =
            tokio::time::timeout(Duration::from_secs(1), transfers.hold(64 * SMALL_TRANSFER))
                .await
                .expect(
                    "a transfer larger than the budget takes all of it rather than waiting forever",
                );
        assert!(larger_than_the_budget.0.is_some());
    }

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
