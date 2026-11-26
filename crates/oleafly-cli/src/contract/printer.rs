use std::future::Future;
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use tokio::sync::Notify;

const ROOM_STEP: Duration = Duration::from_millis(5);

enum Message {
    Line { text: String, skipped_before: u64 },
    End,
}

#[derive(Default)]
struct Shared {
    skipped: AtomicU64,
    closing: AtomicBool,
    closed: AtomicBool,
    sealed: Mutex<bool>,
    wake: Notify,
}

impl Shared {
    fn close(&self) {
        self.closed.store(true, Ordering::Release);
        self.wake.notify_waiters();
    }

    fn seal(&self, receiver: &Receiver<Message>) -> u64 {
        let mut sealed = self.sealed.lock().unwrap_or_else(PoisonError::into_inner);
        *sealed = true;
        let mut left = self.skipped.swap(0, Ordering::Relaxed);
        while let Ok(message) = receiver.try_recv() {
            if let Message::Line { skipped_before, .. } = message {
                left += skipped_before + 1;
            }
        }
        left
    }
}

pub struct Printer {
    sender: SyncSender<Message>,
    shared: Arc<Shared>,
    done: Receiver<()>,
    thread: Option<std::thread::JoinHandle<()>>,
}

#[derive(Clone)]
pub struct PrintSender {
    sender: SyncSender<Message>,
    shared: Arc<Shared>,
}

impl Printer {
    pub fn start(
        out: impl Write + Send + 'static,
        capacity: usize,
        skipped_line: impl Fn(u64) -> String + Send + 'static,
        failed: impl Fn(&std::io::Error) + Send + 'static,
    ) -> std::io::Result<Printer> {
        let (sender, receiver) = mpsc::sync_channel(capacity);
        let shared = Arc::new(Shared::default());
        let (finished, done) = mpsc::channel();
        let thread = {
            let shared = Arc::clone(&shared);
            std::thread::Builder::new()
                .name("oleafly-printer".into())
                .spawn(move || {
                    write_lines(out, &receiver, &shared, skipped_line, failed);
                    drop(finished);
                })?
        };
        Ok(Printer {
            sender,
            shared,
            done,
            thread: Some(thread),
        })
    }

    pub fn sender(&self) -> PrintSender {
        PrintSender {
            sender: self.sender.clone(),
            shared: Arc::clone(&self.shared),
        }
    }

    pub fn closed(&self) -> impl Future<Output = ()> + Send + 'static {
        let shared = Arc::clone(&self.shared);
        async move {
            loop {
                let woken = shared.wake.notified();
                if shared.closed.load(Ordering::Acquire) {
                    return;
                }
                woken.await;
            }
        }
    }

    pub fn finish(mut self, within: Duration) -> bool {
        self.stop();
        if matches!(
            self.done.recv_timeout(within),
            Err(RecvTimeoutError::Timeout)
        ) {
            return false;
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        true
    }

    fn stop(&self) {
        self.shared.closing.store(true, Ordering::Release);
        let _ = self.sender.try_send(Message::End);
    }
}

impl Drop for Printer {
    fn drop(&mut self) {
        self.stop();
    }
}

enum Offer {
    Sent,
    Full(String),
    Gone,
}

impl PrintSender {
    pub fn send(&self, line: String) -> bool {
        matches!(self.offer(line, true), Offer::Sent)
    }

    pub fn send_within(&self, line: String, within: Duration) -> bool {
        let deadline = Instant::now() + within;
        let mut line = line;
        loop {
            let last = Instant::now() >= deadline;
            match self.offer(line, last) {
                Offer::Sent => return true,
                Offer::Full(back) if !last => line = back,
                Offer::Full(_) | Offer::Gone => return false,
            }
            std::thread::sleep(ROOM_STEP);
        }
    }

    fn offer(&self, text: String, last: bool) -> Offer {
        let sealed = self
            .shared
            .sealed
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let skipped_before = self.shared.skipped.swap(0, Ordering::Relaxed);
        let offer = if *sealed {
            Offer::Gone
        } else {
            match self.sender.try_send(Message::Line {
                text,
                skipped_before,
            }) {
                Ok(()) => Offer::Sent,
                Err(TrySendError::Full(Message::Line { text, .. })) => Offer::Full(text),
                Err(_) => Offer::Gone,
            }
        };
        let gone = matches!(offer, Offer::Gone);
        if !matches!(offer, Offer::Sent) {
            self.shared
                .skipped
                .fetch_add(skipped_before + u64::from(last || gone), Ordering::Relaxed);
        }
        offer
    }
}

fn write_lines(
    mut out: impl Write,
    receiver: &Receiver<Message>,
    shared: &Shared,
    skipped_line: impl Fn(u64) -> String,
    failed: impl Fn(&std::io::Error),
) {
    let open = copy_lines(&mut out, receiver, shared, &skipped_line, &failed);
    let left = shared.seal(receiver);
    if open && left > 0 {
        written(&mut out, &skipped_line(left), left, shared, &failed);
    }
}

fn copy_lines(
    out: &mut impl Write,
    receiver: &Receiver<Message>,
    shared: &Shared,
    skipped_line: &impl Fn(u64) -> String,
    failed: &impl Fn(&std::io::Error),
) -> bool {
    loop {
        let next = if shared.closing.load(Ordering::Acquire) {
            receiver.try_recv().ok()
        } else {
            receiver.recv().ok()
        };
        let Some(Message::Line {
            text,
            skipped_before,
        }) = next
        else {
            return true;
        };
        if skipped_before > 0
            && !written(
                out,
                &skipped_line(skipped_before),
                skipped_before,
                shared,
                failed,
            )
        {
            return false;
        }
        if !written(out, &text, 1, shared, failed) {
            return false;
        }
    }
}

fn written(
    out: &mut impl Write,
    text: &str,
    lines: u64,
    shared: &Shared,
    failed: &impl Fn(&std::io::Error),
) -> bool {
    let mut line = String::with_capacity(text.len() + 1);
    line.push_str(text);
    line.push('\n');
    match out.write_all(line.as_bytes()).and_then(|()| out.flush()) {
        Ok(()) => true,
        Err(error) if crate::human::reader_gone(&error) => {
            shared.close();
            false
        }
        Err(error) => {
            failed(&error);
            shared.skipped.fetch_add(lines, Ordering::Relaxed);
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io;
    use std::sync::{Condvar, Mutex};

    use super::*;

    #[derive(Clone, Default)]
    struct Gate {
        state: Arc<(Mutex<bool>, Condvar)>,
    }

    impl Gate {
        fn open(&self) {
            let (open, wake) = &*self.state;
            *open.lock().unwrap() = true;
            wake.notify_all();
        }

        fn wait(&self) {
            let (open, wake) = &*self.state;
            let mut open = open.lock().unwrap();
            while !*open {
                open = wake.wait(open).unwrap();
            }
        }
    }

    struct Gated {
        gate: Gate,
        entered: mpsc::Sender<()>,
        refused: Vec<&'static str>,
        out: Arc<Mutex<Vec<u8>>>,
    }

    impl Write for Gated {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            let _ = self.entered.send(());
            self.gate.wait();
            let line = String::from_utf8_lossy(bytes);
            if let Some(index) = self
                .refused
                .iter()
                .position(|refused| line.trim_end() == *refused)
            {
                self.refused.remove(index);
                return Err(io::Error::other("refused"));
            }
            self.out.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    struct Rig {
        printer: Printer,
        gate: Gate,
        entered: Receiver<()>,
        failures: Arc<AtomicU64>,
        out: Arc<Mutex<Vec<u8>>>,
    }

    fn rig(capacity: usize, refused: &[&'static str]) -> Rig {
        let gate = Gate::default();
        let (entered_sender, entered) = mpsc::channel();
        let failures = Arc::new(AtomicU64::new(0));
        let out = Arc::new(Mutex::new(Vec::new()));
        let printer = Printer::start(
            Gated {
                gate: gate.clone(),
                entered: entered_sender,
                refused: refused.to_vec(),
                out: Arc::clone(&out),
            },
            capacity,
            |count| format!("skipped {count}"),
            {
                let failures = Arc::clone(&failures);
                move |_| {
                    failures.fetch_add(1, Ordering::Relaxed);
                }
            },
        )
        .unwrap();
        Rig {
            printer,
            gate,
            failures,
            entered,
            out,
        }
    }

    fn printed(out: &Mutex<Vec<u8>>) -> String {
        String::from_utf8(out.lock().unwrap().clone()).unwrap()
    }

    fn wait_until(what: &str, done: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !done() {
            assert!(Instant::now() < deadline, "{what}");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn printer_never_blocks_when_stdout_is_full() {
        let rig = rig(4, &[]);
        let sender = rig.printer.sender();
        let started = Instant::now();
        let accepted = (0..10_000)
            .filter(|index| sender.send(format!("line {index}")))
            .count();
        assert!(started.elapsed() < Duration::from_secs(2), "sending waited");
        assert!((4..=5).contains(&accepted), "{accepted} lines were queued");
        let finishing = Instant::now();
        assert!(!rig.printer.finish(Duration::from_millis(100)));
        assert!(
            finishing.elapsed() < Duration::from_secs(2),
            "finish waited"
        );
        rig.gate.open();
    }

    #[test]
    fn printer_reports_skipped_lines_once() {
        let rig = rig(2, &[]);
        let sender = rig.printer.sender();
        assert!(sender.send("a".into()));
        rig.entered
            .recv_timeout(Duration::from_secs(10))
            .expect("the printer started writing");
        assert!(sender.send("b".into()));
        assert!(sender.send("c".into()));
        for dropped in ["d", "e", "f"] {
            assert!(!sender.send(dropped.into()));
        }
        rig.gate.open();
        wait_until("the queue never drained", || {
            printed(&rig.out).ends_with("c\n")
        });
        assert!(sender.send("g".into()));
        assert!(rig.printer.finish(Duration::from_secs(10)));
        assert_eq!(printed(&rig.out), "a\nb\nc\nskipped 3\ng\n");
    }

    #[test]
    fn printer_reports_lines_skipped_at_the_end() {
        let rig = rig(1, &[]);
        let sender = rig.printer.sender();
        assert!(sender.send("a".into()));
        rig.entered
            .recv_timeout(Duration::from_secs(10))
            .expect("the printer started writing");
        assert!(sender.send("b".into()));
        assert!(!sender.send("c".into()));
        assert!(!sender.send("d".into()));
        rig.gate.open();
        assert!(rig.printer.finish(Duration::from_secs(10)));
        assert_eq!(printed(&rig.out), "a\nb\nskipped 2\n");
    }

    #[test]
    fn printer_counts_lines_it_could_not_write() {
        let rig = rig(4, &["x1", "x2", "skipped 2"]);
        let sender = rig.printer.sender();
        assert!(sender.send("a".into()));
        rig.entered
            .recv_timeout(Duration::from_secs(10))
            .expect("the printer started writing");
        assert!(sender.send("x1".into()));
        assert!(sender.send("x2".into()));
        rig.gate.open();
        wait_until("the refused lines were never tried", || {
            rig.failures.load(Ordering::Relaxed) == 2
        });
        assert!(sender.send("b".into()));
        wait_until("the queue never drained", || {
            printed(&rig.out).ends_with("b\n")
        });
        assert!(rig.printer.finish(Duration::from_secs(10)));
        assert_eq!(printed(&rig.out), "a\nb\nskipped 2\n");
        assert_eq!(rig.failures.load(Ordering::Relaxed), 3);
    }

    #[test]
    fn printer_counts_lines_sent_while_it_stops() {
        let rig = rig(4, &[]);
        let sender = rig.printer.sender();
        assert!(sender.send("a".into()));
        rig.entered
            .recv_timeout(Duration::from_secs(10))
            .expect("the printer started writing");
        assert!(sender.send("b".into()));
        rig.printer.stop();
        assert!(sender.send("c".into()));
        rig.gate.open();
        assert!(rig.printer.finish(Duration::from_secs(10)));
        assert!(!sender.send("d".into()));
        assert_eq!(printed(&rig.out), "a\nb\nskipped 1\n");
    }

    #[test]
    fn the_last_line_waits_a_bounded_time_for_room() {
        let rig = rig(1, &[]);
        let sender = rig.printer.sender();
        assert!(sender.send("a".into()));
        rig.entered
            .recv_timeout(Duration::from_secs(10))
            .expect("the printer started writing");
        assert!(sender.send("b".into()));
        let waited = Instant::now();
        assert!(!sender.send_within("late".into(), Duration::from_millis(50)));
        assert!(waited.elapsed() >= Duration::from_millis(50));
        let gate = rig.gate.clone();
        let opener = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            gate.open();
        });
        assert!(sender.send_within("result".into(), Duration::from_secs(10)));
        opener.join().unwrap();
        assert!(rig.printer.finish(Duration::from_secs(10)));
        assert_eq!(printed(&rig.out), "a\nb\nskipped 1\nresult\n");
    }

    struct Closed;

    impl Write for Closed {
        fn write(&mut self, _: &[u8]) -> io::Result<usize> {
            Err(io::Error::from(io::ErrorKind::BrokenPipe))
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn printer_stops_when_stdout_closes() {
        let printer =
            Printer::start(Closed, 8, |count| format!("skipped {count}"), |_| {}).unwrap();
        let sender = printer.sender();
        let closed = printer.closed();
        assert!(sender.send("a".into()));
        tokio::time::timeout(Duration::from_secs(10), closed)
            .await
            .expect("a closed stdout stops the printer");
        tokio::time::timeout(Duration::from_secs(1), printer.closed())
            .await
            .expect("a later wait sees the close at once");
        assert!(printer.finish(Duration::from_secs(10)));
        assert!(!sender.send("b".into()));
    }
}
