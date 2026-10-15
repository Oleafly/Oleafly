use std::collections::HashMap;
use std::pin::Pin;
use std::sync::{Arc, Mutex, PoisonError};
use std::task::{Context, Poll, Waker};
use std::time::Duration;

use axum::body::{Body, Bytes, HttpBody};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::Response;
use http_body::{Frame, SizeHint};
use oleafly_collab_protocol::ids::AccountId;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use crate::blobs::{BlobReader, Pieces};
use crate::error::ServerError;
use crate::routes::read_body_within;

const TOOK_TOO_LONG: &str = "The upload took too long. Try again.";
const TOO_BUSY: &str = "The server is busy with other large files. Try again in a moment.";
const KIB: u64 = 1024;
// Bytes already in memory go to the connection in copied pieces of this
// size, so what the connection holds never pins all of them.
#[cfg(test)]
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
// The share of the budget one account's large transfers may hold together.
// A transfer the account starts with nothing else under way may take more,
// up to the whole budget, so a large snapshot still goes through.
pub const ACCOUNT_SHARE_DIVISOR: u32 = 2;

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

#[derive(Default)]
struct UnderWay {
    transfers: usize,
    kib: u32,
}

type Accounts = Arc<Mutex<HashMap<AccountId, UnderWay>>>;

// Uploads are held whole in memory, and downloads are read from the store
// in pieces as the client takes them. Each large transfer takes its size
// from one shared budget and waits while the budget is spent, so many
// people opening a project at once take turns, and how many large
// downloads keep a file or a bucket read open stays bounded.
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
    kib: u32,
}

impl Drop for AccountTurn {
    fn drop(&mut self) {
        let mut accounts = self.accounts.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(under_way) = accounts.get_mut(&self.account) {
            under_way.transfers = under_way.transfers.saturating_sub(1);
            under_way.kib = under_way.kib.saturating_sub(self.kib);
            if under_way.transfers == 0 {
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
    pieces: Pieces,
    _held: Held,
}

struct Sending {
    unsent: Option<Unsent>,
    // The connection, while it waits for the store's next piece.
    waiting: Option<Waker>,
}

fn sending_of(shared: &Mutex<Sending>) -> std::sync::MutexGuard<'_, Sending> {
    shared.lock().unwrap_or_else(PoisonError::into_inner)
}

// A large download. When its send deadline passes, a timer drops what is
// left of it, with its budget share and the account's turn, even while the
// connection waits on a client that stopped reading and so asks the body
// for nothing more, and wakes a connection waiting on the store. Asking
// after that fails, and the connection is closed.
struct Deadlined {
    sending: Arc<Mutex<Sending>>,
    left: u64,
    timer: tokio::task::AbortHandle,
}

impl Drop for Deadlined {
    fn drop(&mut self) {
        self.timer.abort();
        let unsent = sending_of(&self.sending).unsent.take();
        drop(unsent);
    }
}

fn ended_early() -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::UnexpectedEof,
        "the stored file ended before its length",
    )
}

impl HttpBody for Deadlined {
    type Data = Bytes;
    type Error = std::io::Error;

    fn poll_frame(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, std::io::Error>>> {
        let this = self.get_mut();
        if this.left == 0 {
            return Poll::Ready(None);
        }
        let mut sending = sending_of(&this.sending);
        let Some(rest) = sending.unsent.as_mut() else {
            return Poll::Ready(Some(Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "the client did not read the download before its deadline",
            ))));
        };
        match rest.pieces.as_mut().poll_next(context) {
            Poll::Pending => {
                sending.waiting = Some(context.waker().clone());
                Poll::Pending
            }
            Poll::Ready(Some(Ok(piece))) => {
                this.left = this.left.saturating_sub(piece.len() as u64);
                if this.left == 0 {
                    sending.unsent = None;
                }
                Poll::Ready(Some(Ok(Frame::data(piece))))
            }
            Poll::Ready(failed) => {
                sending.unsent = None;
                Poll::Ready(Some(Err(failed.map_or_else(ended_early, |failed| {
                    failed.err().unwrap_or_else(ended_early)
                }))))
            }
        }
    }

    fn is_end_stream(&self) -> bool {
        self.left == 0
    }

    fn size_hint(&self) -> SizeHint {
        SizeHint::with_exact(self.left)
    }
}

// The response body for a large download. Its budget share and the
// account's turn go back once its last piece is out, once the client goes,
// or at the send deadline, when what is left is dropped and the response
// ends, so a client that stops reading can't keep them.
fn deadlined(held: Held, pieces: Pieces, left: u64) -> Body {
    let deadline = held.deadline;
    let sending = Arc::new(Mutex::new(Sending {
        unsent: Some(Unsent {
            pieces,
            _held: held,
        }),
        waiting: None,
    }));
    let expiring = Arc::clone(&sending);
    let timer = tokio::spawn(async move {
        tokio::time::sleep(deadline).await;
        let (expired, waiting) = {
            let mut sending = sending_of(&expiring);
            (sending.unsent.take(), sending.waiting.take())
        };
        drop(expired);
        if let Some(waiting) = waiting {
            waiting.wake();
        }
    })
    .abort_handle();
    Body::new(Deadlined {
        sending,
        left,
        timer,
    })
}

impl TransferPermit {
    // Sends a stored file as the response body. A small one is read whole
    // first, so a damaged one is refused before anything goes out. A large
    // one is read from the store a piece at a time as the client takes it,
    // and a damaged one ends in an error before its last piece.
    pub async fn send(self, reader: BlobReader) -> Result<Body, ServerError> {
        let Some(held) = self.0 else {
            let bytes = reader.read_all().await.map_err(|error| {
                ServerError::Internal(format!("could not read a stored file: {error}"))
            })?;
            return Ok(Body::from(bytes));
        };
        let left = reader.size();
        Ok(deadlined(held, reader.pieces(), left))
    }

    // Sends bytes already in memory, in copied pieces.
    #[cfg(test)]
    fn keep_with(self, bytes: Bytes) -> Body {
        let Some(held) = self.0 else {
            return Body::from(bytes);
        };
        let left = bytes.len() as u64;
        let pieces = futures_util::stream::unfold(bytes, |mut rest| async move {
            if rest.is_empty() {
                return None;
            }
            let front = rest.split_to(rest.len().min(SEND_PIECE));
            Some((Ok(Bytes::copy_from_slice(&front)), rest))
        });
        deadlined(held, Box::pin(pieces), left)
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

    fn turn_for(&self, account: AccountId, kib: u32, total: u32) -> Option<AccountTurn> {
        let mut accounts = self.accounts.lock().unwrap_or_else(PoisonError::into_inner);
        let under_way = accounts.entry(account).or_default();
        let share = total / ACCOUNT_SHARE_DIVISOR;
        if under_way.transfers >= LARGE_TRANSFERS_PER_ACCOUNT
            || (under_way.transfers > 0 && under_way.kib.saturating_add(kib) > share)
        {
            return None;
        }
        under_way.transfers += 1;
        under_way.kib = under_way.kib.saturating_add(kib);
        Some(AccountTurn {
            accounts: Arc::clone(&self.accounts),
            account,
            kib,
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
        let (permits, total) = {
            let gate = self.gate.lock().unwrap_or_else(PoisonError::into_inner);
            (Arc::clone(&gate.permits), gate.total)
        };
        let wanted = u32::try_from(bytes.div_ceil(KIB))
            .unwrap_or(u32::MAX)
            .min(total);
        let turn = self
            .turn_for(account, wanted, total)
            .ok_or(ServerError::RateLimited)?;
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
        let waiting = transfers.hold(AccountId::new_v7(), 2 * SMALL_TRANSFER);
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

    struct Woken(std::sync::atomic::AtomicBool);

    impl std::task::Wake for Woken {
        fn wake(self: Arc<Self>) {
            self.0.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_download_waiting_on_its_store_ends_at_its_deadline() {
        let transfers = Transfers::with_budget(2 * SMALL_TRANSFER);
        transfers.set_timing(UploadTiming {
            grace: Duration::from_secs(5),
            min_rate: u64::MAX,
        });
        let held = transfers
            .hold(AccountId::new_v7(), 2 * SMALL_TRANSFER)
            .await
            .expect("room")
            .0
            .expect("a large transfer");
        let mut sending = deadlined(
            held,
            Box::pin(futures_util::stream::pending()),
            2 * SMALL_TRANSFER,
        );
        let woken = Arc::new(Woken(std::sync::atomic::AtomicBool::new(false)));
        let waker = Waker::from(Arc::clone(&woken));
        let mut context = Context::from_waker(&waker);
        assert!(Pin::new(&mut sending).poll_frame(&mut context).is_pending());
        tokio::time::sleep(Duration::from_secs(6)).await;
        assert!(
            woken.0.load(std::sync::atomic::Ordering::SeqCst),
            "the deadline wakes a connection waiting on the store"
        );
        assert!(matches!(
            Pin::new(&mut sending).poll_frame(&mut context),
            Poll::Ready(Some(Err(_)))
        ));
        assert!(transfers
            .hold(AccountId::new_v7(), 2 * SMALL_TRANSFER)
            .await
            .is_ok());
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

    #[tokio::test]
    async fn one_account_holds_at_most_half_the_budget_with_more_than_one_transfer() {
        let transfers = Transfers::with_budget(8 * SMALL_TRANSFER);
        let account = AccountId::new_v7();
        let first = transfers
            .hold(account, 3 * SMALL_TRANSFER)
            .await
            .expect("room");
        assert!(matches!(
            transfers.hold(account, 2 * SMALL_TRANSFER).await,
            Err(ServerError::RateLimited)
        ));
        let _small = transfers
            .hold(account, SMALL_TRANSFER)
            .await
            .expect("still within half");
        let _other = transfers
            .hold(AccountId::new_v7(), 4 * SMALL_TRANSFER)
            .await
            .expect("another account's room");
        drop(first);
        assert!(transfers.hold(account, 3 * SMALL_TRANSFER).await.is_ok());
        let alone = AccountId::new_v7();
        let whole = Transfers::with_budget(8 * SMALL_TRANSFER);
        assert!(
            whole.hold(alone, 6 * SMALL_TRANSFER).await.is_ok(),
            "a transfer with nothing else under way may take more than half"
        );
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
