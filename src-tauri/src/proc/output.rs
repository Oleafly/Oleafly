use std::io;
use std::process::{Command, Output, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt};

const OUTPUT_LIMIT: usize = 64 * 1024 * 1024;
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);

/// Synchronous callers must run on blocking workers. A single shared reactor
/// drains both pipes without creating reader threads for every Git refresh.
pub fn output_contained(command: Command) -> io::Result<Output> {
    output_contained_with_timeout(command, Duration::from_secs(120))
}

pub fn output_contained_with_timeout(command: Command, timeout: Duration) -> io::Result<Output> {
    static RUNTIME: OnceLock<Result<tokio::runtime::Runtime, String>> = OnceLock::new();
    let runtime = RUNTIME
        .get_or_init(|| {
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(1)
                .thread_name("oleafly-process-output")
                .enable_all()
                .build()
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(|error| io::Error::other(error.clone()))?;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    runtime.spawn(async move {
        let _ = sender.send(collect_output(command, timeout, OUTPUT_LIMIT).await);
    });
    receiver
        .recv()
        .map_err(|_| io::Error::other("process output worker stopped"))?
}

async fn read_output(mut pipe: impl AsyncRead + Unpin, limit: usize) -> io::Result<Vec<u8>> {
    let mut output = Vec::new();
    let mut bytes = [0; 8192];
    loop {
        let count = pipe.read(&mut bytes).await?;
        if count == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(count) > limit {
            return Err(io::Error::other(format!(
                "command output exceeded the {limit}-byte limit"
            )));
        }
        output.extend_from_slice(&bytes[..count]);
    }
}

fn spawn_output(command: Command) -> io::Result<(tokio::process::Child, super::ProcessTreeGuard)> {
    let mut command = tokio::process::Command::from(command);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    super::isolate_process_tree(&mut command);
    let child = command.spawn()?;
    let containment = super::contain_process_tree(
        child
            .id()
            .ok_or_else(|| io::Error::other("child has no process id"))?,
    )?;
    Ok((child, containment))
}

async fn collect_output(command: Command, timeout: Duration, limit: usize) -> io::Result<Output> {
    let started = Instant::now();
    // CreateProcess and Job Object setup must not park the shared I/O reactor.
    // If admission times out, the blocking task still owns the child/guard;
    // dropping its eventual result closes that tree without publishing it.
    let launched = tokio::time::timeout(
        timeout,
        tokio::task::spawn_blocking(move || spawn_output(command)),
    )
    .await
    .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "command startup timed out"))?;
    let (mut child, containment) = launched.map_err(io::Error::other)??;
    let mut containment = Some(containment);
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("missing stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| io::Error::other("missing stderr"))?;
    // Keep reads in this future: cancellation closes the pipes immediately,
    // rather than detaching tasks that can outlive the command indefinitely.
    let result = tokio::time::timeout(timeout.saturating_sub(started.elapsed()), async {
        let wait = async {
            let status = child.wait().await?;
            // A hook/helper may leave a descendant holding either pipe open.
            // Stop the owned tree as soon as its leader finishes.
            drop(containment.take());
            Ok::<_, io::Error>(status)
        };
        let (status, stdout, stderr) =
            tokio::try_join!(wait, read_output(stdout, limit), read_output(stderr, limit))?;
        Ok(Output {
            status,
            stdout,
            stderr,
        })
    })
    .await
    .unwrap_or_else(|_| {
        Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "command timed out and was stopped",
        ))
    });
    drop(containment);
    if result.is_err() {
        let _ = child.start_kill();
        let _ = tokio::time::timeout(CLEANUP_TIMEOUT, child.wait()).await;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn node(script: &str) -> Command {
        let mut command = Command::new("node");
        command.args(["-e", script]);
        command
    }

    #[test]
    fn captures_both_pipes_and_exit_status() {
        let output = output_contained(node(
            "process.stdout.write('out');process.stderr.write('err');process.exitCode=7",
        ))
        .unwrap();
        assert_eq!(output.stdout, b"out");
        assert_eq!(output.stderr, b"err");
        assert_eq!(output.status.code(), Some(7));
    }

    #[test]
    fn stalled_command_has_a_deadline() {
        let start = Instant::now();
        let error = output_contained_with_timeout(
            node("setInterval(()=>{},1000)"),
            Duration::from_millis(250),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(start.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn leader_exit_closes_inherited_descendant_pipes() {
        let start = Instant::now();
        let output = output_contained_with_timeout(node(
            "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',1,2]});process.stdout.write('leader');process.exit(0)",
        ), Duration::from_secs(5)).unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout, b"leader");
        assert!(start.elapsed() < Duration::from_secs(4));
    }

    #[tokio::test]
    async fn excessive_output_fails_instead_of_silently_truncating() {
        let error = collect_output(
            node("process.stdout.write('x'.repeat(16384));setInterval(()=>{},1000)"),
            Duration::from_secs(5),
            1024,
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("output exceeded"));
    }
}
