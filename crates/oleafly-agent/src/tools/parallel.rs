//! The parallel tool pipeline: concurrent execution, ordered feedback, one
//! shared read-write gate, and abort semantics that preserve finished
//! results.

use std::sync::Arc;
use std::time::Duration;

use futures_util::stream::{FuturesOrdered, StreamExt};
use tokio::sync::RwLock;

use crate::error::Result;
use crate::event::AgentEvent;
use crate::run::{tool_output_payload_bytes, ToolOutput, ToolRunner};
use crate::stream::ToolCall;
use crate::tasks::CancellationToken;
use crate::tools::registry::{ParallelPolicy, ToolRegistry};

use super::registry::{add_tool_batch_bytes, MAX_TOOL_RESULT_BATCH_BYTES};

/// The single gate every tool call in a run shares. Parallel tools take a
/// read guard (unbounded among themselves); exclusive tools take a write
/// guard (excluding everything).
#[derive(Clone, Default)]
pub struct ToolGate(Arc<RwLock<()>>);

impl ToolGate {
    pub fn new() -> Self {
        Self::default()
    }
}

pub fn aborted_tool_output() -> ToolOutput {
    ToolOutput::text(serde_json::json!({ "error": "aborted" }).to_string())
}

struct BatchBudget {
    bytes: usize,
}

impl BatchBudget {
    fn add(&mut self, output: &ToolOutput) -> Result<()> {
        add_tool_batch_bytes(
            &mut self.bytes,
            tool_output_payload_bytes(output)?,
            MAX_TOOL_RESULT_BATCH_BYTES,
        )
    }
}

/// Execute one batch of tool calls: they start concurrently (subject to the
/// gate and the registry's parallel policy), results are bounded, and they
/// are returned strictly in call order. `on_event` receives each
/// `ToolOutcome` in call order. Calls that have not started when the token
/// fires, or that are still running, resolve to an aborted marker output;
/// calls that already finished keep their real output.
#[allow(clippy::too_many_arguments)]
pub async fn run_tool_calls<F>(
    calls: Vec<ToolCall>,
    registry: &ToolRegistry,
    gate: &ToolGate,
    runner: &ToolRunner,
    timeout: Duration,
    token: CancellationToken,
    mut on_event: F,
) -> Result<Vec<(ToolCall, ToolOutput)>>
where
    F: FnMut(AgentEvent) + Send,
{
    super::registry::validate_tool_calls_per_turn(calls.len())?;
    let mut in_flight = FuturesOrdered::new();
    let mut batch = BatchBudget { bytes: 0 };
    let mut results = Vec::with_capacity(calls.len());

    for call in calls {
        let policy = registry.parallel_policy(&call.name);
        let gate = gate.clone();
        let runner = runner.clone();
        let token = token.child();
        in_flight.push_back(async move {
            let output = execute_one(call.clone(), policy, gate, runner, timeout, token).await;
            (call, output)
        });
    }

    while let Some((call, output)) = in_flight.next().await {
        let output = crate::run::bound_tool_output(output);
        batch.add(&output)?;
        on_event(AgentEvent::ToolOutcome {
            id: call.id.clone(),
            output: output.output.clone(),
        });
        results.push((call, output));
    }
    Ok(results)
}

async fn execute_one(
    call: ToolCall,
    policy: ParallelPolicy,
    gate: ToolGate,
    runner: ToolRunner,
    timeout: Duration,
    token: CancellationToken,
) -> ToolOutput {
    if token.is_cancelled() {
        return aborted_tool_output();
    }
    let execution = async {
        match policy {
            ParallelPolicy::Parallel => {
                let _shared = gate.0.read().await;
                run_with_deadline(call.clone(), &runner, timeout).await
            }
            ParallelPolicy::Exclusive => {
                let _exclusive = gate.0.write().await;
                run_with_deadline(call.clone(), &runner, timeout).await
            }
            ParallelPolicy::Unguarded => run_with_deadline(call.clone(), &runner, timeout).await,
        }
    };
    tokio::select! {
        output = execution => output,
        _ = token.cancelled() => aborted_tool_output(),
    }
}

async fn run_with_deadline(call: ToolCall, runner: &ToolRunner, timeout: Duration) -> ToolOutput {
    match tokio::time::timeout(timeout, runner(call)).await {
        Ok(output) => output,
        Err(_) => ToolOutput::text(
            serde_json::json!({ "error": "the tool execution timed out" }).to_string(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn registry_with(parallel: &[&str]) -> ToolRegistry {
        let mut registry = ToolRegistry::default();
        for name in parallel {
            registry.register_trusted(name, crate::tools::registry::RegisteredTool::parallel());
        }
        registry
    }

    #[tokio::test]
    async fn an_unguarded_orchestration_tool_never_holds_the_gate() {
        // Models the parent-waits / child-writes deadlock: a long-running
        // orchestration tool must not block a mutating tool that shares the
        // gate. Without the Unguarded policy the exclusive "write" would wait
        // the full 300ms for the orchestration tool's guard to drop.
        let mut registry = ToolRegistry::default();
        registry.register_trusted(
            "wait_agent",
            crate::tools::registry::RegisteredTool::unguarded(),
        );
        registry.register_trusted(
            "write_file",
            crate::tools::registry::RegisteredTool::exclusive(),
        );
        let write_started_at = Arc::new(std::sync::Mutex::new(None));
        let recorder = Arc::clone(&write_started_at);
        let started = Instant::now();
        let runner: ToolRunner = Arc::new(move |call| {
            let recorder = Arc::clone(&recorder);
            let start = started;
            Box::pin(async move {
                if call.name == "wait_agent" {
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    ToolOutput::text("waited")
                } else {
                    *recorder.lock().unwrap() = Some(start.elapsed());
                    ToolOutput::text("wrote")
                }
            })
        });
        let results = drive(
            &registry,
            vec![call("wait_agent", "1"), call("write_file", "2")],
            runner,
            CancellationToken::new(),
        )
        .await;
        let write_delay = write_started_at.lock().unwrap().expect("write ran");
        assert!(
            write_delay < Duration::from_millis(150),
            "the writer waited {write_delay:?} for the orchestration tool's gate"
        );
        assert_eq!(results[0].1.output, "waited");
        assert_eq!(results[1].1.output, "wrote");
    }

    fn call(name: &str, id: &str) -> ToolCall {
        ToolCall {
            id: id.into(),
            name: name.into(),
            arguments: "{}".into(),
            ..Default::default()
        }
    }

    async fn drive(
        registry: &ToolRegistry,
        calls: Vec<ToolCall>,
        runner: ToolRunner,
        token: CancellationToken,
    ) -> Vec<(ToolCall, ToolOutput)> {
        run_tool_calls(
            calls,
            registry,
            &ToolGate::new(),
            &runner,
            Duration::from_secs(5),
            token,
            |_| {},
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn parallel_tools_run_concurrently() {
        let registry = registry_with(&["fast_a", "fast_b"]);
        let runner: ToolRunner = Arc::new(|call| {
            Box::pin(async move {
                tokio::time::sleep(Duration::from_millis(120)).await;
                ToolOutput::text(format!("done:{}", call.id))
            })
        });
        let started = Instant::now();
        let results = drive(
            &registry,
            vec![call("fast_a", "1"), call("fast_b", "2")],
            runner,
            CancellationToken::new(),
        )
        .await;
        assert!(started.elapsed() < Duration::from_millis(240));
        assert_eq!(results[0].1.output, "done:1");
        assert_eq!(results[1].1.output, "done:2");
    }

    #[tokio::test]
    async fn exclusive_tools_serialize_against_each_other() {
        let registry = registry_with(&[]); // everything exclusive
        let runner: ToolRunner = Arc::new(|_| {
            Box::pin(async move {
                tokio::time::sleep(Duration::from_millis(80)).await;
                ToolOutput::text("x")
            })
        });
        let started = Instant::now();
        drive(
            &registry,
            vec![call("write_a", "1"), call("write_b", "2")],
            runner,
            CancellationToken::new(),
        )
        .await;
        assert!(started.elapsed() >= Duration::from_millis(160));
    }

    #[tokio::test]
    async fn an_exclusive_tool_waits_for_in_flight_parallel_readers() {
        let registry = registry_with(&["read_x"]);
        let runner: ToolRunner = Arc::new(|_| {
            Box::pin(async move {
                tokio::time::sleep(Duration::from_millis(100)).await;
                ToolOutput::text("x")
            })
        });
        let started = Instant::now();
        let results = drive(
            &registry,
            vec![call("read_x", "1"), call("write_y", "2")],
            runner,
            CancellationToken::new(),
        )
        .await;
        // The writer cannot start until the reader's guard drops.
        assert!(started.elapsed() >= Duration::from_millis(200));
        assert_eq!(results.len(), 2);
    }

    #[tokio::test]
    async fn results_keep_call_order_regardless_of_completion_order() {
        let registry = registry_with(&["slow", "fast"]);
        let runner: ToolRunner = Arc::new(|call| {
            Box::pin(async move {
                let delay = if call.name == "slow" { 120 } else { 5 };
                tokio::time::sleep(Duration::from_millis(delay)).await;
                ToolOutput::text(call.id)
            })
        });
        let results = drive(
            &registry,
            vec![call("slow", "first"), call("fast", "second")],
            runner,
            CancellationToken::new(),
        )
        .await;
        assert_eq!(results[0].1.output, "first");
        assert_eq!(results[1].1.output, "second");
    }

    #[tokio::test]
    async fn cancellation_before_start_aborts_every_call() {
        let registry = registry_with(&["read_x"]);
        let token = CancellationToken::new();
        token.cancel();
        let runner: ToolRunner = Arc::new(|_| {
            Box::pin(async move {
                panic!("a cancelled batch must not execute tools");
            })
        });
        let results = drive(
            &registry,
            vec![call("read_x", "1"), call("read_x", "2")],
            runner,
            token,
        )
        .await;
        for (_, output) in results {
            assert_eq!(output.output, r#"{"error":"aborted"}"#);
        }
    }

    #[tokio::test]
    async fn tool_execution_has_a_backend_deadline() {
        let registry = registry_with(&["read_x"]);
        let runner: ToolRunner = Arc::new(|_| Box::pin(std::future::pending()));
        let results = run_tool_calls(
            vec![call("read_x", "1")],
            &registry,
            &ToolGate::new(),
            &runner,
            Duration::ZERO,
            CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
        let value: serde_json::Value = serde_json::from_str(&results[0].1.output).unwrap();
        assert_eq!(value["error"], "the tool execution timed out");
    }

    #[tokio::test]
    async fn cancellation_mid_flight_preserves_finished_results() {
        let registry = registry_with(&["fast", "slow"]);
        let token = CancellationToken::new();
        let runner_token = token.clone();
        let runner: ToolRunner = Arc::new(move |call| {
            let token = runner_token.clone();
            Box::pin(async move {
                if call.name == "fast" {
                    ToolOutput::text("finished")
                } else {
                    // Cancel while the slow tool is still running.
                    token.cancel();
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    ToolOutput::text("late")
                }
            })
        });
        let results = drive(
            &registry,
            vec![call("fast", "1"), call("slow", "2")],
            runner,
            token,
        )
        .await;
        assert_eq!(results[0].1.output, "finished");
        assert_eq!(results[1].1.output, r#"{"error":"aborted"}"#);
    }
}
