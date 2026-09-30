//! Waits for files that a test's child process writes.
//!
//! A shell `>` redirection, `fopen` or `File::create` makes the file before
//! any bytes land in it, so a test that waits for the file to exist and then
//! reads it can see it empty on a loaded machine. These helpers wait until
//! the content itself is ready. Passing tests return as soon as it is, so the
//! deadline only decides how long a failing test takes to report.

use std::path::Path;
use std::time::{Duration, Instant};

/// How long a test waits on a child process before it gives up.
pub(crate) const CHILD_PATIENCE: Duration = Duration::from_secs(30);

const POLL: Duration = Duration::from_millis(10);

/// Reads `path` until `accept` returns a value or `timeout` passes. For
/// synchronous tests.
pub(crate) fn read_until_blocking<T>(
    path: &Path,
    timeout: Duration,
    accept: impl Fn(&str) -> Option<T>,
) -> Option<T> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(value) = std::fs::read_to_string(path)
            .ok()
            .and_then(|text| accept(&text))
        {
            return Some(value);
        }
        if Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(POLL);
    }
}

/// Reads `path` until `accept` returns a value or `timeout` passes. For
/// `#[tokio::test]`, whose default runtime has one thread: a blocking sleep
/// there would also stall the task the test is waiting on.
pub(crate) async fn read_until<T>(
    path: &Path,
    timeout: Duration,
    accept: impl Fn(&str) -> Option<T>,
) -> Option<T> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(value) = std::fs::read_to_string(path)
            .ok()
            .and_then(|text| accept(&text))
        {
            return Some(value);
        }
        if Instant::now() >= deadline {
            return None;
        }
        tokio::time::sleep(POLL).await;
    }
}

/// Accepts a file holding one process id, such as `printf '%s' "$!" > child.pid`.
pub(crate) fn pid(text: &str) -> Option<i32> {
    text.trim().parse().ok().filter(|pid| *pid > 0)
}

/// Accepts a file whose whole content is `expected`.
pub(crate) fn exactly(expected: &str) -> impl Fn(&str) -> Option<()> + '_ {
    move |text| (text == expected).then_some(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_or_partial_file_is_not_a_pid() {
        assert_eq!(pid(""), None);
        assert_eq!(pid("  \n"), None);
        assert_eq!(pid("0"), None);
        assert_eq!(pid("-4"), None);
        assert_eq!(pid("4321\n"), Some(4321));
    }

    #[test]
    fn a_file_created_before_it_is_written_is_read_once_written() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("child.pid");
        std::fs::write(&path, "").unwrap();
        let writer = {
            let path = path.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(200));
                std::fs::write(path, "4321").unwrap();
            })
        };
        assert_eq!(read_until_blocking(&path, CHILD_PATIENCE, pid), Some(4321));
        writer.join().unwrap();
    }

    #[test]
    fn a_file_that_never_arrives_gives_up_at_the_deadline() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing");
        let started = Instant::now();
        assert_eq!(
            read_until_blocking(&path, Duration::from_millis(50), exactly("done")),
            None
        );
        assert!(started.elapsed() >= Duration::from_millis(50));
    }

    #[tokio::test]
    async fn the_async_wait_lets_the_writer_run_on_the_same_thread() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("reply");
        std::fs::write(&path, "").unwrap();
        let writer = tokio::spawn({
            let path = path.clone();
            async move {
                tokio::time::sleep(Duration::from_millis(100)).await;
                std::fs::write(path, "hello").unwrap();
            }
        });
        assert_eq!(
            read_until(&path, CHILD_PATIENCE, exactly("hello")).await,
            Some(())
        );
        writer.await.unwrap();
    }
}
