//! Real processes: this test binary starts itself as a fake agent.
use std::io::{BufRead, Write};
use std::sync::Arc;
use std::time::Duration;

use oleafly_acp::{AcpClient, NullHost};
use oleafly_sandbox::process::identity::{probe, ProcessProbe};

const ROLE: &str = "OLEAFLY_ACP_FAKE_AGENT";
const PIDS: &str = "OLEAFLY_ACP_FAKE_PIDS";

fn main() {
    match std::env::var(ROLE).as_deref() {
        Ok("tree") => fake_tree_agent(),
        Ok("stderr") => fake_noisy_agent(),
        _ => run_cases(),
    }
}

/// Starts a sleeping child, records its pid, then answers `initialize`.
/// The child is left running on purpose: the test checks that closing the
/// agent ends it.
#[allow(clippy::zombie_processes)]
fn fake_tree_agent() {
    let mut sleeper = if cfg!(windows) {
        let mut command = std::process::Command::new("ping");
        command.args(["-n", "60", "127.0.0.1"]);
        command
    } else {
        let mut command = std::process::Command::new("sleep");
        command.arg("60");
        command
    };
    let child = sleeper
        .stdout(std::process::Stdio::null())
        .spawn()
        .expect("start the grandchild");
    if let Ok(path) = std::env::var(PIDS) {
        std::fs::write(path, child.id().to_string()).unwrap();
    }
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let Ok(message) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if message["method"] == "initialize" {
            let answer = serde_json::json!({"jsonrpc": "2.0", "id": message["id"],
                "result": {"protocolVersion": 1, "agentCapabilities": {}}});
            writeln!(stdout, "{answer}").unwrap();
            stdout.flush().unwrap();
        }
    }
}

fn fake_noisy_agent() {
    let mut stderr = std::io::stderr();
    for _ in 0..(20 * 1024 / 7) {
        let _ = stderr.write_all(b"\x07noise\n");
    }
    let _ = stderr.flush();
}

fn self_command(role: &str) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(std::env::current_exe().unwrap());
    command.env(ROLE, role);
    command
}

fn run_cases() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    let mut failed = 0;
    for (name, case) in [
        (
            "shutting_down_the_client_kills_the_agent_s_children",
            shutting_down_the_client_kills_the_agent_s_children as fn() -> Result<(), String>,
        ),
        (
            "stderr_tail_keeps_the_last_lines_without_control_characters",
            stderr_tail_keeps_the_last_lines_without_control_characters,
        ),
    ] {
        let result = runtime.block_on(async { tokio::task::spawn_blocking(case).await });
        match result {
            Ok(Ok(())) => println!("test {name} ... ok"),
            Ok(Err(error)) => {
                failed += 1;
                println!("test {name} ... FAILED: {error}");
            }
            Err(error) => {
                failed += 1;
                println!("test {name} ... FAILED (panicked): {error}");
            }
        }
    }
    if failed > 0 {
        std::process::exit(1);
    }
}

fn shutting_down_the_client_kills_the_agent_s_children() -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| error.to_string())?;
    runtime.block_on(async {
        let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
        let pids = directory.path().join("pids");
        let mut command = self_command("tree");
        command.env(PIDS, &pids);
        let client = AcpClient::spawn(command, Arc::new(NullHost)).await?;
        client
            .request(
                "initialize",
                serde_json::json!({"protocolVersion": 1}),
                Duration::from_secs(10),
            )
            .await
            .map_err(|error| error.to_string())?;
        let grandchild: u32 = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if let Some(pid) = std::fs::read_to_string(&pids)
                    .ok()
                    .and_then(|text| text.trim().parse().ok())
                {
                    return pid;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .map_err(|_| "the fake agent never recorded its child".to_string())?;
        client.shutdown().await;
        tokio::time::timeout(Duration::from_secs(5), async {
            while probe(grandchild) != ProcessProbe::Gone {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .map_err(|_| "the agent's child outlived the client".to_string())
    })
}

fn stderr_tail_keeps_the_last_lines_without_control_characters() -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| error.to_string())?;
    runtime.block_on(async {
        let client = AcpClient::spawn(self_command("stderr"), Arc::new(NullHost)).await?;
        tokio::time::timeout(Duration::from_secs(10), async {
            while !client.is_closed() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .map_err(|_| "the noisy agent never exited".to_string())?;
        let tail = client.stderr_tail();
        if tail.len() > 1000 || tail.contains('\u{7}') || !tail.contains("noise") {
            return Err(format!("unexpected tail: {tail:?}"));
        }
        Ok(())
    })
}
