# Windows lifecycle and contention audit

This extends the [v0.4.0 flow validation](windows-v0.4-validation.md) with a
source audit of process ownership, cancellation, storage contention, and UI
teardown. The focus is work that can survive its owner or keep another action
waiting indefinitely. Tests use synthetic libraries on Windows x64.

## Source coverage

- Process creation and waits: desktop `proc`, Git, compiler adapters, TeX
  utilities, CLI compilation, agent execution, task execution, ACP, MCP, and
  language-server runtimes. Reviewed Job Object ownership and pipe cleanup.
- Storage coordination: project worktree admission, settings and secret
  transactions, checkpoint initialization/namespace/operation locks, atomic
  replacement, restore recovery, and durable cleanup.
- UI lifetime: terminal startup/input/resize/output/disposal, project analysis
  and worker clients, compile cancellation, PDF worker/render cancellation,
  and update/quit gates.

Repository-wide searches identified blocking process calls, file locks,
spawned readers, timers, and worker teardown paths. The targeted review and
regressions below establish specific guarantees; they do not prove that all
possible driver, filesystem, external tool, and network failures are absent.

## Changes

| Failure path | Resulting behavior |
| --- | --- |
| Git waits forever for a stalled process or inherited output pipe | A shared asynchronous reactor collects output with a 120-second command deadline, or 300 seconds for authenticated remote operations; the owned process tree closes when its leader exits |
| An external command floods memory | Collection rejects more than 64 MiB per pipe, stops the process tree, and reports an error instead of returning silently truncated file content |
| Pandoc version probes never exit | Discovery and downloaded-binary validation stop the owned process tree after five seconds |
| Storage locks wait indefinitely behind another process | Worktree, config, secrets, and checkpoint locks have a 30-second admission budget per lock; contention returns an error without stealing the lock or modifying its owner's data |
| Config/secret callers queue indefinitely behind an in-process transaction | Their mutex admission also has a 30-second budget, preserving existing poison recovery behavior |
| MCP cancellation detaches its diagnostics reader | Transport disposal aborts the reader and closes the owned process tree; uncooperative shutdown has bounded cleanup |
| MCP discovery starts `icacls` and depends on account-name environment variables | Native current-user SID ACL installation runs before credential bytes are written and propagates failure |
| Temporary Windows readers prevent settings/discovery replacement | Both publications use the existing eight-second bounded atomic-replacement retry |
| ConPTY resize blocks the UI and the global session registry | Resize runs on a blocking worker and holds only that terminal's master lock |
| Resize events accumulate while ConPTY is slow | The renderer keeps one active request and only the latest queued size, suppresses unchanged sizes, and drops queued work on disposal |
| A shell finishes starting after its renderer reloads | An admission generation rejects and closes the stale session before registering it |
| Agent/task cleanup waits indefinitely after cancellation or timeout | Cleanup closes the owned tree before a bounded child wait |
| CLI cancellation detaches compiler log readers | Both readers belong to the command future; its deadline covers output collection and child execution, with bounded cleanup |
| Disposed project analysis publishes a late result | Disposal clears pending diagnostic references and prevents late result/error publication and new indexing |
| Returning focus from a toolbar overwrites a source navigation with the old browser selection | Source navigation uses CodeMirror's focus API to synchronize the DOM selection while preventing ancestor scrolling |

Explicitly detached user-requested services and successful background agent
commands retain their established behavior. Cleanup targets processes owned
by the operation, never unrelated installed services or user terminals.

## Regression evidence

The added tests cover stalled children, output flooding, descendants holding
both log pipes, closed-output compiler deadlines, storage contention and
recovery, MCP disposal and uncooperative shutdown, terminal reload admission,
and a blocked terminal master while the global registry remains available.
A renderer regression sends 220 intervening resize sizes while the first
request is stalled and observes only the first and final sizes reaching IPC.
Editor analysis tests reject a late response after disposal without changing
the store snapshot.

A Windows CI failure in toolbar definition navigation reproduced locally. The
analysis and caret were correct before the action, but direct content-DOM focus
restored the old browser selection after navigation. A regression reproduces the
DOM/state mismatch before the fix; all 11 core and application editor-controller
tests pass after using CodeMirror's synchronized, scroll-preserving focus API.

The native application inventory contains 1,330 passing tests across the broad
run and clean reruns, with five existing ignored cases. The broad run passed
1,322 tests; three startup-timeout cases and five cases affected by an overlapping
rebuild were covered by a clean, sequential 310-test rerun. No failed case remains
in the consolidated inventory. Workspace Clippy passed with warnings denied.

Core, history, and CLI validation passed 154 unit and integration tests. The
frontend lifecycle set passed 64 tests across terminal panes/queues, project
analysis, worker recovery, and stale PDF work. Typecheck and lint passed; lint
retains the pre-existing dependency warning in `App.tsx`.

All three editor performance gates passed without a simultaneous local build
or native test sweep. P95 was 85.44 ms for 6,200-line source analysis, 56.84 ms
for 200-file project analysis, and 5.11 ms for end-of-book completion. The existing
budgets are 750 ms, 750 ms, and 100 ms respectively. These measurements cover
synchronous editor work on this host, not total startup or compiler latency.

The pull request records the final production build and targeted native UI
follow-up results alongside the original 350-case flow inventory.
