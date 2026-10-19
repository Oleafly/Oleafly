//! Writes a run's events to the store and tells the host about them.
//! Streamed text merges into one row per segment (at most 32 KiB). Rows are
//! written by one writer thread per queue on one connection, in batches
//! (every 250 ms or 64 rows). A text delta only adds to the writer's copy of
//! its segment, which is saved once per batch, and deltas reach watching
//! windows coalesced every 50 ms, so a 100,000-delta transcript costs a
//! handful of transactions.
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rusqlite::Connection;

use crate::model::{now_ms, TaskRuntimeEvent, TaskTranscriptDelta, TaskTranscriptEvent};
use crate::scheduler::{lock, ResearchTaskState};
use crate::store::{EventWrite, TaskStore};

const MAX_TEXT_SEGMENT_BYTES: usize = 32 * 1024;
pub const WRITER_COMMIT_EVERY: Duration = Duration::from_millis(250);
pub const WRITER_MAX_BATCH: usize = 64;
pub const EMIT_COALESCE: Duration = Duration::from_millis(50);

/// A transcript row: task, generation and sequence.
type RowKey = (String, u64, u64);

enum WriterOp {
    Write(EventWrite),
    /// Adds a text segment's first row and keeps its text to grow.
    Open {
        write: EventWrite,
        kind: TextSegmentKind,
        text: String,
    },
    /// More text for an open segment.
    Extend {
        key: RowKey,
        text: String,
    },
    /// The generation stopped recording: save its open segment and forget it.
    Seal {
        task_id: String,
        generation: u64,
    },
    Flush(mpsc::Sender<()>),
}

/// The queue's transcript writer thread, started on first use.
pub(crate) struct TranscriptWriter {
    root: Result<PathBuf, String>,
    sender: Mutex<Option<mpsc::Sender<WriterOp>>>,
    #[cfg(test)]
    pub(crate) commits: Arc<std::sync::atomic::AtomicUsize>,
}

impl TranscriptWriter {
    pub(crate) fn new(root: Result<PathBuf, String>) -> Self {
        Self {
            root,
            sender: Mutex::new(None),
            #[cfg(test)]
            commits: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        }
    }

    fn sender(&self) -> Option<mpsc::Sender<WriterOp>> {
        let mut sender = lock(&self.sender);
        if sender.is_none() {
            let root = self.root.clone().ok()?;
            let (tx, rx) = mpsc::channel();
            #[cfg(test)]
            let commits = self.commits.clone();
            std::thread::Builder::new()
                .name("oleafly-task-transcript".into())
                .spawn(move || {
                    writer_loop(
                        root,
                        rx,
                        #[cfg(test)]
                        commits,
                    )
                })
                .ok()?;
            *sender = Some(tx);
        }
        sender.clone()
    }

    fn send(&self, op: WriterOp) {
        if let Some(sender) = self.sender() {
            let _ = sender.send(op);
        }
    }

    pub(crate) fn submit(&self, write: EventWrite) {
        self.send(WriterOp::Write(write));
    }

    /// Returns once everything submitted before is written.
    pub(crate) fn flush(&self) {
        let Some(sender) = lock(&self.sender).clone() else {
            return;
        };
        let (reply, done) = mpsc::channel();
        if sender.send(WriterOp::Flush(reply)).is_ok() {
            let _ = done.recv_timeout(Duration::from_secs(10));
        }
    }
}

/// The writer's copy of a growing text segment.
struct WriterSegment {
    kind: TextSegmentKind,
    created_at: i64,
    text: String,
    /// Grown since it was last saved.
    dirty: bool,
}

impl WriterSegment {
    fn write(&self, (task_id, generation, sequence): &RowKey) -> Option<EventWrite> {
        let event_json = serde_json::to_string(&self.kind.event(self.text.clone())).ok()?;
        Some(EventWrite {
            task_id: task_id.clone(),
            generation: *generation,
            sequence: *sequence,
            event_json,
            created_at: self.created_at,
            replace: true,
        })
    }
}

/// What the writer holds between ops: the rows of the batch it is
/// collecting and the text segments that can still grow.
#[derive(Default)]
struct WriterBatch {
    rows: Vec<EventWrite>,
    replies: Vec<mpsc::Sender<()>>,
    segments: HashMap<RowKey, WriterSegment>,
}

impl WriterBatch {
    /// Takes one op; `true` when a caller waits for the batch to be written.
    fn take(&mut self, op: WriterOp) -> bool {
        match op {
            WriterOp::Write(write) => {
                self.seal(&write.task_id, write.generation);
                self.rows.push(write);
            }
            WriterOp::Open { write, kind, text } => {
                self.seal(&write.task_id, write.generation);
                let key = (write.task_id.clone(), write.generation, write.sequence);
                self.segments.insert(
                    key,
                    WriterSegment {
                        kind,
                        created_at: write.created_at,
                        text,
                        dirty: false,
                    },
                );
                self.rows.push(write);
            }
            WriterOp::Extend { key, text } => {
                if let Some(segment) = self.segments.get_mut(&key) {
                    segment.text.push_str(&text);
                    segment.dirty = true;
                }
            }
            WriterOp::Seal {
                task_id,
                generation,
            } => self.seal(&task_id, generation),
            WriterOp::Flush(reply) => {
                self.replies.push(reply);
                return true;
            }
        }
        false
    }

    /// A generation has one open segment at a time: a new row ends the one
    /// before, whose last text is written in its place in the batch.
    fn seal(&mut self, task_id: &str, generation: u64) {
        let ended: Vec<RowKey> = self
            .segments
            .keys()
            .filter(|(task, current, _)| task == task_id && *current == generation)
            .cloned()
            .collect();
        for key in ended {
            if let Some(segment) = self.segments.remove(&key) {
                if segment.dirty {
                    self.rows.extend(segment.write(&key));
                }
            }
        }
    }

    /// The batch's rows, with the latest text of every grown segment.
    fn drain(&mut self) -> Vec<EventWrite> {
        let mut rows = std::mem::take(&mut self.rows);
        for (key, segment) in &mut self.segments {
            if segment.dirty {
                segment.dirty = false;
                rows.extend(segment.write(key));
            }
        }
        rows
    }
}

fn writer_loop(
    root: PathBuf,
    receiver: mpsc::Receiver<WriterOp>,
    #[cfg(test)] commits: Arc<std::sync::atomic::AtomicUsize>,
) {
    let Ok(store) = TaskStore::new(root) else {
        return;
    };
    let mut connection: Option<Connection> = None;
    let mut batch = WriterBatch::default();
    while let Ok(first) = receiver.recv() {
        let mut flush = batch.take(first);
        let deadline = Instant::now() + WRITER_COMMIT_EVERY;
        while !flush && batch.rows.len() < WRITER_MAX_BATCH {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            match receiver.recv_timeout(remaining) {
                Ok(op) => flush = batch.take(op),
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        let rows = batch.drain();
        if !rows.is_empty() {
            commit(&store, &mut connection, &rows);
            #[cfg(test)]
            commits.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
        for reply in std::mem::take(&mut batch.replies) {
            let _ = reply.send(());
        }
    }
}

/// Writes a batch on the writer's connection, opening it again once when a
/// write fails (the store may have been moved or replaced).
fn commit(store: &TaskStore, connection: &mut Option<Connection>, rows: &[EventWrite]) {
    for _ in 0..2 {
        if connection.is_none() {
            *connection = store.writer_connection().ok();
        }
        let Some(open) = connection.as_mut() else {
            return;
        };
        if TaskStore::write_events_on(open, rows).is_ok() {
            return;
        }
        *connection = None;
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TextSegmentKind {
    Text,
    Reasoning,
}

impl TextSegmentKind {
    fn name(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Reasoning => "reasoning",
        }
    }

    fn event(self, text: String) -> TaskRuntimeEvent {
        match self {
            Self::Text => TaskRuntimeEvent::Text { text },
            Self::Reasoning => TaskRuntimeEvent::Reasoning { text },
        }
    }
}

struct OpenSegment {
    kind: TextSegmentKind,
    sequence: u64,
    created_at: i64,
    /// How much text the segment holds.
    bytes: usize,
    /// The same length in UTF-16 units, for watching windows.
    utf16: usize,
    /// Text not yet sent to watching windows.
    unsent: String,
}

fn text_delta(event: &TaskRuntimeEvent) -> Option<(TextSegmentKind, &str)> {
    match event {
        TaskRuntimeEvent::Text { text } => Some((TextSegmentKind::Text, text)),
        TaskRuntimeEvent::Reasoning { text } => Some((TextSegmentKind::Reasoning, text)),
        _ => None,
    }
}

struct RecorderState {
    next_sequence: u64,
    open: Option<OpenSegment>,
    emit_scheduled: bool,
    closed: bool,
}

pub(crate) struct TranscriptRecorder {
    store: TaskStore,
    state: ResearchTaskState,
    task_id: String,
    generation: u64,
    inner: Mutex<RecorderState>,
}

impl TranscriptRecorder {
    pub(crate) fn new(
        store: TaskStore,
        state: ResearchTaskState,
        task_id: String,
        generation: u64,
    ) -> Arc<Self> {
        let next_sequence = store.next_event_sequence(&task_id, generation).unwrap_or(1);
        Arc::new(Self {
            store,
            state,
            task_id,
            generation,
            inner: Mutex::new(RecorderState {
                next_sequence,
                open: None,
                emit_scheduled: false,
                closed: false,
            }),
        })
    }

    fn event_write(
        &self,
        sequence: u64,
        created_at: i64,
        event: &TaskRuntimeEvent,
    ) -> Option<EventWrite> {
        let event_json = serde_json::to_string(event).ok()?;
        Some(EventWrite {
            task_id: self.task_id.clone(),
            generation: self.generation,
            sequence,
            event_json,
            created_at,
            replace: false,
        })
    }

    fn row(&self, sequence: u64, created_at: i64, event: TaskRuntimeEvent) -> TaskTranscriptEvent {
        TaskTranscriptEvent {
            task_id: self.task_id.clone(),
            execution_generation: self.generation,
            sequence,
            event,
            created_at,
        }
    }

    /// The open segment's text not yet sent to watching windows.
    fn unsent_delta(&self, open: &mut OpenSegment) -> Option<TaskTranscriptDelta> {
        (!open.unsent.is_empty()).then(|| TaskTranscriptDelta {
            task_id: self.task_id.clone(),
            execution_generation: self.generation,
            sequence: open.sequence,
            kind: open.kind.name().into(),
            append: std::mem::take(&mut open.unsent),
            created_at: open.created_at,
            text_length: open.utf16 as u64,
        })
    }

    /// Sends the open segment's unsent text to watching windows.
    fn emit_unsent(&self) {
        let delta = {
            let mut inner = lock(&self.inner);
            inner.emit_scheduled = false;
            match inner.open.as_mut() {
                Some(open) => self.unsent_delta(open),
                None => None,
            }
        };
        if let Some(delta) = delta {
            self.state.emit_delta(&delta);
        }
    }

    // Writer ops are sent while `inner` is held, so the writer sees rows and
    // segment changes in the order they were recorded.
    pub(crate) fn record(self: &Arc<Self>, event: TaskRuntimeEvent) {
        if let Some((kind, delta)) = text_delta(&event) {
            let schedule = {
                let mut inner = lock(&self.inner);
                if inner.closed {
                    return;
                }
                let grown = match inner.open.as_mut() {
                    Some(open)
                        if open.kind == kind
                            && open.bytes + delta.len() <= MAX_TEXT_SEGMENT_BYTES =>
                    {
                        open.bytes += delta.len();
                        open.utf16 += delta.encode_utf16().count();
                        open.unsent.push_str(delta);
                        self.state.writer().send(WriterOp::Extend {
                            key: (self.task_id.clone(), self.generation, open.sequence),
                            text: delta.to_owned(),
                        });
                        true
                    }
                    _ => false,
                };
                grown.then(|| !std::mem::replace(&mut inner.emit_scheduled, true))
            };
            match schedule {
                Some(true) => {
                    let recorder = self.clone();
                    self.state.runtime_handle().spawn(async move {
                        tokio::time::sleep(EMIT_COALESCE).await;
                        recorder.emit_unsent();
                    });
                }
                Some(false) => {}
                None => {
                    let (previous, sequence, created_at) = {
                        let mut inner = lock(&self.inner);
                        if inner.closed {
                            return;
                        }
                        let previous = inner
                            .open
                            .take()
                            .and_then(|mut open| self.unsent_delta(&mut open));
                        let sequence = inner.next_sequence;
                        inner.next_sequence += 1;
                        let created_at = now_ms();
                        inner.open = Some(OpenSegment {
                            kind,
                            sequence,
                            created_at,
                            bytes: delta.len(),
                            utf16: delta.encode_utf16().count(),
                            unsent: String::new(),
                        });
                        if let Some(write) = self.event_write(sequence, created_at, &event) {
                            self.state.writer().send(WriterOp::Open {
                                write,
                                kind,
                                text: delta.to_owned(),
                            });
                        }
                        (previous, sequence, created_at)
                    };
                    if let Some(previous) = previous {
                        self.state.emit_delta(&previous);
                    }
                    self.state
                        .emit_event(&self.row(sequence, created_at, event));
                }
            }
            return;
        }
        if let TaskRuntimeEvent::SessionBound { native_session_id } = &event {
            let _ =
                self.store
                    .set_native_session(&self.task_id, self.generation, native_session_id);
        }
        let (previous, sequence, created_at) = {
            let mut inner = lock(&self.inner);
            if inner.closed {
                return;
            }
            let previous = inner
                .open
                .take()
                .and_then(|mut open| self.unsent_delta(&mut open));
            let sequence = inner.next_sequence;
            inner.next_sequence += 1;
            let created_at = now_ms();
            if let Some(write) = self.event_write(sequence, created_at, &event) {
                self.state.writer().submit(write);
            }
            (previous, sequence, created_at)
        };
        if let Some(previous) = previous {
            self.state.emit_delta(&previous);
        }
        self.state
            .emit_event(&self.row(sequence, created_at, event));
    }

    /// Ends recording: later events are dropped, and everything recorded is
    /// written before this returns (a generation's rows are only written
    /// while it runs). Blocks for up to one batch.
    pub(crate) fn close(&self) {
        let previous = {
            let mut inner = lock(&self.inner);
            inner.closed = true;
            inner
                .open
                .take()
                .and_then(|mut open| self.unsent_delta(&mut open))
        };
        if let Some(previous) = previous {
            self.state.emit_delta(&previous);
        }
        self.state.writer().send(WriterOp::Seal {
            task_id: self.task_id.clone(),
            generation: self.generation,
        });
        self.state.writer().flush();
    }
}
