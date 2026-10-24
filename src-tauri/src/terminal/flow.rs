//! Output flow control. The pump batches what the shell writes (a few
//! milliseconds or 64 KiB per message) and stops reading once the frontend
//! has 2 MiB it has not acknowledged, so `yes` or a huge log cannot flood
//! the webview. Reading resumes when the backlog drops below 512 KiB.

use std::sync::mpsc::Receiver;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

pub(crate) const FLOW_HIGH_WATERMARK: usize = 2 * 1024 * 1024;
pub(crate) const FLOW_LOW_WATERMARK: usize = 512 * 1024;
pub(crate) const OUTPUT_BATCH_BYTES: usize = 64 * 1024;
pub(crate) const OUTPUT_BATCH_WINDOW: Duration = Duration::from_millis(5);
pub(crate) const OUTPUT_READ_BYTES: usize = 16 * 1024;
pub(crate) const OUTPUT_QUEUE_CHUNKS: usize = 32;

#[derive(Default)]
struct FlowState {
    unacked: usize,
    paused: bool,
    closed: bool,
    /// When output was last sent.
    last_output: Option<Instant>,
}

/// Bytes sent to the frontend and not yet acknowledged, for one session.
pub(crate) struct OutputFlow {
    state: Mutex<FlowState>,
    resumed: Condvar,
}

impl OutputFlow {
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(FlowState::default()),
            resumed: Condvar::new(),
        })
    }

    fn lock(&self) -> MutexGuard<'_, FlowState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Count bytes just sent. Above the high watermark the pump pauses.
    pub(crate) fn charge(&self, bytes: usize) {
        let mut state = self.lock();
        state.last_output = Some(Instant::now());
        state.unacked = state.unacked.saturating_add(bytes);
        if state.unacked > FLOW_HIGH_WATERMARK {
            state.paused = true;
        }
    }

    /// Count bytes the frontend has parsed. Wakes the pump once the backlog
    /// is below the low watermark.
    pub(crate) fn ack(&self, bytes: usize) {
        let mut state = self.lock();
        state.unacked = state.unacked.saturating_sub(bytes);
        if state.paused && state.unacked < FLOW_LOW_WATERMARK {
            state.paused = false;
            self.resumed.notify_all();
        }
    }

    /// True at once unless paused. While paused, blocks until the backlog
    /// drains (true) or the session closes (false, the output is dropped).
    pub(crate) fn wait_for_room(&self) -> bool {
        let mut state = self.lock();
        while state.paused && !state.closed {
            state = self
                .resumed
                .wait(state)
                .unwrap_or_else(PoisonError::into_inner);
        }
        !state.paused
    }

    /// Whether output was sent within the last `window`.
    #[cfg_attr(not(windows), allow(dead_code))]
    pub(crate) fn output_within(&self, window: Duration) -> bool {
        self.lock()
            .last_output
            .is_some_and(|at| at.elapsed() < window)
    }

    /// The session is stopping: release a paused pump.
    pub(crate) fn close(&self) {
        let mut state = self.lock();
        state.closed = true;
        self.resumed.notify_all();
    }

    #[cfg(test)]
    pub(crate) fn unacked(&self) -> usize {
        self.lock().unacked
    }
}

/// The next message's worth of output. Waits for a first chunk (None once
/// the reader has ended). After a quiet spell (`last_flush` older than the
/// window, or never), it sends that chunk with whatever is already queued,
/// so typing echoes at once; during a stream it keeps collecting until the
/// window passes or `max` bytes are in.
pub(crate) fn next_batch(
    rx: &Receiver<Vec<u8>>,
    last_flush: Option<Instant>,
    window: Duration,
    max: usize,
) -> Option<Vec<u8>> {
    let mut batch = rx.recv().ok()?;
    let idle = last_flush.is_none_or(|at| at.elapsed() >= window);
    if idle {
        while batch.len() < max {
            match rx.try_recv() {
                Ok(chunk) => batch.extend_from_slice(&chunk),
                Err(_) => break,
            }
        }
        return Some(batch);
    }
    let deadline = Instant::now() + window;
    while batch.len() < max {
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            break;
        };
        match rx.recv_timeout(remaining) {
            Ok(chunk) => batch.extend_from_slice(&chunk),
            Err(_) => break,
        }
    }
    Some(batch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{channel, sync_channel};

    fn waiter(flow: &Arc<OutputFlow>) -> std::sync::mpsc::Receiver<bool> {
        let (sender, receiver) = channel();
        let flow = Arc::clone(flow);
        std::thread::spawn(move || {
            let _ = sender.send(flow.wait_for_room());
        });
        receiver
    }

    #[test]
    fn flow_pauses_above_the_high_watermark_and_resumes_below_the_low_one() {
        let flow = OutputFlow::new();
        flow.charge(FLOW_HIGH_WATERMARK + 1);
        let waited = waiter(&flow);
        assert!(waited.recv_timeout(Duration::from_millis(100)).is_err());

        flow.ack(FLOW_HIGH_WATERMARK + 1 - FLOW_LOW_WATERMARK);
        assert_eq!(flow.unacked(), FLOW_LOW_WATERMARK);
        assert!(waited.recv_timeout(Duration::from_millis(100)).is_err());

        flow.ack(1);
        assert_eq!(waited.recv_timeout(Duration::from_secs(2)), Ok(true));
    }

    #[test]
    fn flow_below_the_high_watermark_never_waits() {
        let flow = OutputFlow::new();
        flow.charge(FLOW_HIGH_WATERMARK);
        assert!(flow.wait_for_room());
    }

    #[test]
    fn closing_a_paused_flow_releases_the_waiter() {
        let flow = OutputFlow::new();
        flow.charge(FLOW_HIGH_WATERMARK * 2);
        let waited = waiter(&flow);
        assert!(waited.recv_timeout(Duration::from_millis(100)).is_err());
        flow.close();
        assert_eq!(waited.recv_timeout(Duration::from_secs(2)), Ok(false));

        let open = OutputFlow::new();
        open.close();
        assert!(open.wait_for_room());
    }

    #[test]
    fn output_counts_as_recent_only_within_the_window() {
        let flow = OutputFlow::new();
        assert!(!flow.output_within(Duration::from_secs(60)));
        flow.charge(1);
        assert!(flow.output_within(Duration::from_secs(60)));
        std::thread::sleep(Duration::from_millis(20));
        assert!(!flow.output_within(Duration::from_millis(10)));
    }

    #[test]
    fn ack_saturates_at_zero() {
        let flow = OutputFlow::new();
        flow.ack(10);
        assert_eq!(flow.unacked(), 0);
        flow.charge(5);
        flow.ack(10);
        assert_eq!(flow.unacked(), 0);
    }

    #[test]
    fn next_batch_sends_an_idle_chunk_without_waiting() {
        let (sender, receiver) = sync_channel(4);
        sender.send(vec![b'x'; 10]).unwrap();
        let started = Instant::now();
        let batch = next_batch(&receiver, None, Duration::from_secs(5), OUTPUT_BATCH_BYTES);
        assert_eq!(batch, Some(vec![b'x'; 10]));
        assert!(started.elapsed() < Duration::from_secs(2));
        drop(sender);
    }

    #[test]
    fn next_batch_joins_chunks_that_arrive_within_the_window() {
        let (sender, receiver) = sync_channel(4);
        for chunk in [b"a", b"b", b"c"] {
            sender.send(chunk.to_vec()).unwrap();
        }
        let batch = next_batch(
            &receiver,
            Some(Instant::now()),
            Duration::from_millis(50),
            OUTPUT_BATCH_BYTES,
        );
        assert_eq!(batch.as_deref(), Some(&b"abc"[..]));
    }

    #[test]
    fn next_batch_waits_for_the_rest_of_a_stream() {
        let (sender, receiver) = sync_channel(4);
        sender.send(b"first ".to_vec()).unwrap();
        let late = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            sender.send(b"second".to_vec()).unwrap();
        });
        let batch = next_batch(&receiver, Some(Instant::now()), Duration::from_secs(2), 12);
        late.join().unwrap();
        assert_eq!(batch.as_deref(), Some(&b"first second"[..]));
    }

    #[test]
    fn next_batch_stops_at_the_byte_cap() {
        let (sender, receiver) = sync_channel(16);
        for _ in 0..10 {
            sender.send(vec![0u8; OUTPUT_READ_BYTES]).unwrap();
        }
        let batch = next_batch(&receiver, None, OUTPUT_BATCH_WINDOW, OUTPUT_BATCH_BYTES).unwrap();
        assert!(
            (OUTPUT_BATCH_BYTES..=OUTPUT_BATCH_BYTES + OUTPUT_READ_BYTES).contains(&batch.len()),
            "{}",
            batch.len()
        );
        let rest: usize = receiver.try_iter().map(|chunk| chunk.len()).sum();
        assert_eq!(batch.len() + rest, 10 * OUTPUT_READ_BYTES);
    }

    #[test]
    fn next_batch_returns_none_after_the_reader_ends() {
        let (sender, receiver) = sync_channel::<Vec<u8>>(1);
        drop(sender);
        assert_eq!(
            next_batch(&receiver, None, OUTPUT_BATCH_WINDOW, OUTPUT_BATCH_BYTES),
            None
        );
    }
}
