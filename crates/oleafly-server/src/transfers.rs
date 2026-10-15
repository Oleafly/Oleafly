use std::collections::HashMap;
use std::pin::Pin;
use std::sync::{Arc, Mutex, PoisonError};
use std::task::{Context, Poll};
use std::time::Duration;

use axum::body::{Body, Bytes, HttpBody};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::Response;
use http_body::{Frame, SizeHint};
use oleafly_collab_protocol::ids::AccountId;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use crate::error::ServerError;
use crate::routes::read_body_within;

const TOOK_TOO_LONG: &str = "The upload took too long. Try again.";
const TOO_BUSY: &str = "The server is busy with other large files. Try again in a moment.";
const KIB: u64 = 1024;
// A large download goes to the connection in copied pieces of this size,
// so what the connection holds never pins the whole file.
const SEND_PIECE: usize = 64 * 1024;
// Smaller transfers pass without waiting for room in the budget.
pub const SMALL_TRANSFER: u64 = 1024 * 1024;
pub const DEFAULT_TRANSFER_BUDGET: u64 = 256 * 1024 * 1024;
// How long a large transfer waits for room in the budget before the server
// answers that it is busy.
pub const TRANSFER_WAIT: Duration = Duration::from_secs(30);
// Large transfers one account may have under way at once, so one person
// reading many files slowly can't hold the budget everyone shares.
pub const LARGE_TRANSFERS_PER_ACCOUNT: usize = 4;

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

type Accounts = Arc<Mutex<HashMap<AccountId, usize>>>;

// Files and snapshots are held whole in memory while they are uploaded or
// downloaded. Each large transfer takes its size from one shared budget and
// waits while the budget is spent, so many people opening a project at
// once take turns instead of holding every file at the same time.
#[derive(Clone)]
pub struct Transfers {
    timing: Arc<Mutex<UploadTiming>>,
    gate: Arc<Mutex<Gate>>,
    wait: Arc<Mutex<Duration>>,
    accounts: Accounts,
}

impl Default for Transfers {
    fn default() -> Transfers {
        Transfers::with_budget(DEFAULT_TRANSFER_BUDGET)
    }
}

pub struct TransferPermit(Option<Held>);

struct AccountTurn {
    accounts: Accounts,
    account: AccountId,
}

impl Drop for AccountTurn {
    fn drop(&mut self) {
        let mut accounts = self.accounts.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(count) = accounts.get_mut(&self.account) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                accounts.remove(&self.account);
            }
        }
    }
}

struct Held {
    _budget: Option<OwnedSemaphorePermit>,
    _account: AccountTurn,
    deadline: Duration,
}

struct Unsent {
    bytes: Bytes,
    _held: Held,
}

// A large download. When its send deadline passes, a timer drops what is
// left of it, with its budget share and the account's turn, even while the
// connection waits on a client that stopped reading and so asks the body
// for nothing more. Asking after that fails, and the connection is closed.
struct Deadlined {
    unsent: Arc<Mutex<Option<Unsent>>>,
    left: u64,
    timer: tokio::task::AbortHandle,
}

impl Drop for Deadlined {
    fn drop(&mut self) {
        self.timer.abort();
        let unsent = self
            .unsent
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        drop(unsent);
    }
}

impl HttpBody for Deadlined {
    type Data = Bytes;
    type Error = std::io::Error;

    fn poll_frame(
        self: Pin<&mut Self>,
        _context: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, std::io::Error>>> {
        let this = self.get_mut();
        if this.left == 0 {
            return Poll::Ready(None);
        }
        let mut unsent = this.unsent.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(rest) = unsent.as_mut() else {
            return Poll::Ready(Some(Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "the client did not read the download before its deadline",
            ))));
        };
        let front = rest.bytes.split_to(rest.bytes.len().min(SEND_PIECE));
        let piece = Bytes::copy_from_slice(&front);
        if rest.bytes.is_empty() {
            *unsent = None;
        }
        drop(unsent);
        this.left = this.left.saturating_sub(piece.len() as u64);
        Poll::Ready(Some(Ok(Frame::data(piece))))
    }

    fn is_end_stream(&self) -> bool {
        self.left == 0
    }

    fn size_hint(&self) -> SizeHint {
        SizeHint::with_exact(self.left)
    }
}

impl TransferPermit {
    // Sends the bytes as the response body. Their budget share and the
    // account's turn go back once they are sent, once the client goes, or
    // at the send deadline, when what is left is dropped and the response
    // ends, so a client that stops reading can't keep them.
    pub fn keep_with(self, bytes: Bytes) -> Body {
        let Some(held) = self.0 else {
            return Body::from(bytes);
        };
        let deadline = held.deadline;
        let left = bytes.len() as u64;
        let unsent = Arc::new(Mutex::new(Some(Unsent { bytes, _held: held })));
        let expiring = Arc::clone(&unsent);
        let timer = tokio::spawn(async move {
            tokio::time::sleep(deadline).await;
            let expired = expiring
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .take();
            drop(expired);
        })
        .abort_handle();
        Body::new(Deadlined {
            unsent,
            left,
            timer,
        })
    }
}

// A busy answer says when to try again.
pub async fn retry_soon(mut response: Response) -> Response {
    if response.status() == StatusCode::SERVICE_UNAVAILABLE
        && !response.headers().contains_key(header::RETRY_AFTER)
    {
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("5"));
    }
    response
}

fn busy() -> ServerError {
    ServerError::Refused {
        status: StatusCode::SERVICE_UNAVAILABLE,
        code: "server_busy",
        message: TOO_BUSY.to_string(),
    }
}

impl Transfers {
    pub fn with_budget(bytes: u64) -> Transfers {
        Transfers {
            timing: Arc::new(Mutex::new(UploadTiming::default())),
            gate: Arc::new(Mutex::new(Gate::for_bytes(bytes))),
            wait: Arc::new(Mutex::new(TRANSFER_WAIT)),
            accounts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn set_budget(&self, bytes: u64) {
        *self.gate.lock().unwrap_or_else(PoisonError::into_inner) = Gate::for_bytes(bytes);
    }

    pub fn set_wait(&self, wait: Duration) {
        *self.wait.lock().unwrap_or_else(PoisonError::into_inner) = wait;
    }

    fn turn_for(&self, account: AccountId) -> Option<AccountTurn> {
        let mut accounts = self.accounts.lock().unwrap_or_else(PoisonError::into_inner);
        let count = accounts.entry(account).or_insert(0);
        if *count >= LARGE_TRANSFERS_PER_ACCOUNT {
            return None;
        }
        *count += 1;
        Some(AccountTurn {
            accounts: Arc::clone(&self.accounts),
            account,
        })
    }

    pub async fn hold(
        &self,
        account: AccountId,
        bytes: u64,
    ) -> Result<TransferPermit, ServerError> {
        if bytes < SMALL_TRANSFER {
            return Ok(TransferPermit(None));
        }
        let turn = self.turn_for(account).ok_or(ServerError::RateLimited)?;
        let (permits, total) = {
            let gate = self.gate.lock().unwrap_or_else(PoisonError::into_inner);
            (Arc::clone(&gate.permits), gate.total)
        };
        let wanted = u32::try_from(bytes.div_ceil(KIB))
            .unwrap_or(u32::MAX)
            .min(total);
        let wait = *self.wait.lock().unwrap_or_else(PoisonError::into_inner);
        let permit = tokio::time::timeout(wait, permits.acquire_many_owned(wanted))
            .await
            .map_err(|_| busy())?
            .ok();
        Ok(TransferPermit(Some(Held {
            _budget: permit,
            _account: turn,
            deadline: self.timing().limit_for(bytes),
        })))
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

    #[tokio::test]
    async fn large_transfers_take_turns_within_the_budget() {
        let transfers = Transfers::with_budget(4 * SMALL_TRANSFER);
        let account = AccountId::new_v7();
        let first = transfers
            .hold(account, 3 * SMALL_TRANSFER)
            .await
            .expect("room");
        let small = transfers
            .hold(account, SMALL_TRANSFER - 1)
            .await
            .expect("room");
        assert!(small.0.is_none());
        let waiting = transfers.hold(account, 2 * SMALL_TRANSFER);
        tokio::pin!(waiting);
        assert!(
            tokio::time::timeout(Duration::from_millis(50), &mut waiting)
                .await
                .is_err(),
            "a transfer that does not fit waits"
        );
        let sending = first.keep_with(Bytes::from(vec![7u8; 16]));
        assert!(
            tokio::time::timeout(Duration::from_millis(50), &mut waiting)
                .await
                .is_err(),
            "the permit stays while the download is under way"
        );
        drop(sending);
        let second = tokio::time::timeout(Duration::from_secs(1), waiting)
            .await
            .expect("room once the first transfer's bytes are gone")
            .expect("room");
        assert!(second.0.is_some());
        drop(second);
        let larger_than_the_budget = tokio::time::timeout(
            Duration::from_secs(1),
            transfers.hold(account, 64 * SMALL_TRANSFER),
        )
        .await
        .expect("a transfer larger than the budget takes all of it rather than waiting forever")
        .expect("room");
        assert!(larger_than_the_budget.0.is_some());
    }

    #[tokio::test]
    async fn a_transfer_that_waits_too_long_hears_the_server_is_busy() {
        let transfers = Transfers::with_budget(2 * SMALL_TRANSFER);
        transfers.set_wait(Duration::from_millis(50));
        let _spent = transfers
            .hold(AccountId::new_v7(), 2 * SMALL_TRANSFER)
            .await
            .expect("room");
        let refused = transfers
            .hold(AccountId::new_v7(), 2 * SMALL_TRANSFER)
            .await
            .err()
            .expect("the server is busy");
        assert_eq!(refused.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(refused.code(), "server_busy");
    }

    async fn next_piece(body: &mut Body) -> Option<Result<Frame<Bytes>, axum::Error>> {
        std::future::poll_fn(|context| Pin::new(&mut *body).poll_frame(context)).await
    }

    #[tokio::test(start_paused = true)]
    async fn a_download_whose_client_stops_reading_lets_go_at_its_deadline() {
        let transfers = Transfers::with_budget(2 * SMALL_TRANSFER);
        transfers.set_timing(UploadTiming {
            grace: Duration::from_secs(5),
            min_rate: u64::MAX,
        });
        let account = AccountId::new_v7();
        let mut sending = transfers
            .hold(account, 2 * SMALL_TRANSFER)
            .await
            .expect("room")
            .keep_with(Bytes::from(vec![7u8; 2 * SMALL_TRANSFER as usize]));
        let first = next_piece(&mut sending)
            .await
            .expect("a first piece")
            .expect("on time");
        assert_eq!(
            first.into_data().map(|piece| piece.len()).ok(),
            Some(SEND_PIECE)
        );
        let waiting = transfers.hold(AccountId::new_v7(), 2 * SMALL_TRANSFER);
        tokio::pin!(waiting);
        assert!(
            tokio::time::timeout(Duration::from_secs(4), &mut waiting)
                .await
                .is_err(),
            "the share stays while the download is on time"
        );
        let next = tokio::time::timeout(Duration::from_secs(2), waiting)
            .await
            .expect("the share comes back at the deadline")
            .expect("room");
        assert!(next.0.is_some());
        assert!(
            !transfers.accounts.lock().unwrap().contains_key(&account),
            "the account's turn comes back at the deadline"
        );
        assert!(
            matches!(next_piece(&mut sending).await, Some(Err(_))),
            "asking for more after the deadline fails, so the response ends"
        );
    }

    #[tokio::test]
    async fn a_download_read_to_the_end_is_sent_whole_in_pieces() {
        let transfers = Transfers::with_budget(4 * SMALL_TRANSFER);
        let content: Vec<u8> = (0..2 * SMALL_TRANSFER as usize)
            .map(|index| (index % 251) as u8)
            .collect();
        let mut sending = transfers
            .hold(AccountId::new_v7(), 2 * SMALL_TRANSFER)
            .await
            .expect("room")
            .keep_with(Bytes::from(content.clone()));
        assert_eq!(sending.size_hint().exact(), Some(content.len() as u64));
        let mut received = Vec::new();
        while let Some(piece) = next_piece(&mut sending).await {
            received.extend_from_slice(&piece.expect("on time").into_data().expect("data"));
        }
        assert_eq!(received, content);
        assert!(sending.is_end_stream());
    }

    #[tokio::test]
    async fn one_account_has_at_most_four_large_transfers_under_way() {
        let transfers = Transfers::with_budget(64 * SMALL_TRANSFER);
        let account = AccountId::new_v7();
        let mut under_way = Vec::new();
        for _ in 0..LARGE_TRANSFERS_PER_ACCOUNT {
            under_way.push(
                transfers
                    .hold(account, SMALL_TRANSFER)
                    .await
                    .expect("room")
                    .keep_with(Bytes::from(vec![1u8; 8])),
            );
        }
        assert!(matches!(
            transfers.hold(account, SMALL_TRANSFER).await,
            Err(ServerError::RateLimited)
        ));
        assert!(transfers
            .hold(AccountId::new_v7(), SMALL_TRANSFER)
            .await
            .is_ok());
        under_way.pop();
        assert!(transfers.hold(account, SMALL_TRANSFER).await.is_ok());
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
