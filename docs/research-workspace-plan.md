# Research workspace implementation plan

Oleafly should let a researcher plan a study, work with several assistants, inspect their work and usage, and apply reviewed changes to a manuscript. The editor, references, compiler, history, and research skills remain the foundations of that workflow.

This branch builds on main at `072d8c4144c63e449d087b9203ed06ce75323bee`, which merged the skills work in PR #125.

The implementation is available for review in draft PR #128. Its description records validation for each checkpoint. The sections below describe the architecture and acceptance criteria; they do not establish compatibility with every account or platform.

## Existing capabilities to extend

- `crates/oleafly-agent` runs the built-in assistant against model APIs. It already supports typed events, cancellation, tools, persistent sessions and subagents.
- `packages/ai-core` owns reusable agent types and rendering projections. The app currently renders its saved chat messages through `chat-parts.tsx`.
- `library_db.rs` has a SQLite usage ledger and project budgets. Its usage rows currently lack turn identity, cache counters and source metadata.
- PR #125 supplies the research skill pack, project and global preferences, a domain catalog, slash invocation and native MCP access to skills.
- Project files, Git changes, the terminal, References, Preflight and compilation already have owners. Workspace features must use those owners.

## Runtime and session model

Keep model providers and agent runtimes separate. An API provider supplies model inference to the built-in engine. An ACP agent owns its own agent loop, tools and authentication. Choosing one must not silently configure the other.

Add an ACP runtime alongside the built-in engine with these records:

- An agent definition has a stable ID, display name, executable distribution, pinned version, launch arguments and declared capabilities. Built-in definitions cover Claude, Codex and Gemini. Custom definitions use the same validation and launch path.
- A runtime session records its project, agent ID, native session ID, parent task/session, model, status, timestamps and negotiated capabilities.
- A turn has a stable ID and ordered text, reasoning, tool activity, permission, plan, usage and completion events. Persist the events before deriving the display or usage report.
- Permission requests are scoped to the requesting session and expire on cancellation or disconnect. Reject stale replies and fail closed when the interface disappears.

Use ACP initialization and capability negotiation. Resume, model changes, images and usage depend on what the agent reports. Unknown capabilities remain unsupported. Linked-folder reads use scoped research tools; the interface does not add directories to an ACP session. Authentication stays in the official CLI or adapter. Subscription availability and limits depend on that account and agent.

Launch commands as argument arrays. Bound protocol frames, pending requests and diagnostic output. Registry registration must not execute a package. Managed installations use pinned versions and verified binary downloads. Existing executables can also be discovered; their version may be unknown. Task sessions get a separate home directory with the supported CLI credentials needed to authenticate. Project files cannot supply credentials or launch configuration.

In the built-in assistant, selecting an `@` mention asks the assistant to delegate through `spawn_agent`. These children work in the active project. Queued research tasks are a separate workflow with isolation and review before applying changes.

## Usage report

Record usage natively with a stable source event or turn key so replay cannot count a turn twice. Record project, task/session, runtime, provider, model and time when known. Preserve ordinary input, output, cache read and cache creation independently. Keep reported usage, estimates and unavailable measurements distinct. ACP currently leaves provider, billing mode and cost unknown. Context occupancy is not added to consumed-token totals.

Extend the existing SQLite store with additive migrations and indexed report queries. Preserve historical records and their limitations. Reports support a date range, project/runtime/provider/model/session filters, daily trends, activity heatmap, cache rate and grouped totals. Calculate cache rate only from compatible records with known cache accounting. Missing usage is not zero. Subscription token counts are not a subscription invoice or account quota.

The built-in engine and ACP sessions feed the same report. The report must include cancelled and failed turns that consumed tokens. Keep aggregate query and rendering costs bounded. The assistant's usage counter opens the report.

## Conversation rendering

Build one ordered activity presentation that can display built-in and ACP messages while retaining the existing chat reader. Text, reported reasoning, tools and completion must keep their actual event order. Never manufacture reasoning text or label tool execution as model thinking.

Provide collapsed reasoning with an accessible expand control, compact tool summaries, readable command output, permission state, delegated-session progress and links to research artifacts. Literature results should show title, source and citation identifier when those fields exist. Unknown tools retain a readable fallback. Large output is bounded with an explicit expansion path.

Long conversations need bounded mounting, stable message identities, preserved expansion state and scroll position. New tokens follow the bottom only when the user is already there. Preserve keyboard navigation, copying, links, math, code blocks and minimap navigation.

## Research tasks and isolation

Add a durable project task queue separate from the assistant's in-turn checklist. A task records its prompt, target agent/model, dependencies, state, execution generation, session, source revision and review result. The visible lifecycle is queued, running, awaiting review, completed, failed or cancelled.

Claim work atomically and cap concurrency. Reject results from a superseded generation. On restart, recover interrupted runs as interrupted work rather than reporting success. Cancellation must stop children and settle pending permissions before isolation is released.

Use Git worktrees for Git-backed projects. Preserve uncommitted user changes and record the exact source revision. For projects without Git, use a staged snapshot and compare-before-apply. The user's manuscript receives no agent changes before review. Applying reviewed work must use the existing project mutation lock and reject a changed base. Preserve the result on conflict so the user can review or retry. Never automatically push, publish, delete a branch with unique work, or modify linked data while accepting a manuscript task.

Before applying a result, acquire an editor mutation lease, flush pending source and visual edits, and drain queued writes. Keep editing locked through the native apply and editor reload. A preparation timeout must prevent a later apply from starting; once the native apply starts, keep the lease until it settles. File previews belong to a specific task and execution generation, so a late preview cannot authorize changes from another run.

Discarding a result retains its history and isolated files. Retrying creates a new execution generation when the queue claims it. Task preparation must stop waiting for a manuscript lock when cancelled, including during shutdown.

The task UI supports creation, editing queued work, choosing an agent, starting, cancelling, reading the session and reviewing the result. Dependencies and failures must be visible. Research starters include literature review, evidence audit, analysis, manuscript revision and response to reviewers.

Availability depends on the agent and platform. Isolated commands require macOS sandbox-exec or Linux bubblewrap. Isolated CLI tasks are unavailable on Windows. The current Codex configuration is disabled for isolated tasks on macOS because the local compatibility probe failed under that profile; interactive sessions remain available. Research-tool sessions also require negotiated HTTP MCP support. Protocol fixtures do not establish live subscription compatibility.

## Linked folders and project setup

A research workspace can reference several roots with an ID, canonical path, label, role and access policy. Roles include manuscript, references, data and analysis. The manuscript remains the primary project and compiler root. Linked roots default to read access. Authorization is per root, including path traversal and symlink checks.

Linked-file results retain the root ID and relative path through the tool response and chat card. Opening a result reads that exact source into a read-only preview; matching filenames in the manuscript cannot redirect it to another file.

Project setup extends the existing templates and research workflows. The preview shows the files and folders that will be created, the document engine and the initial research task. Creation uses exclusive destination creation and does not overwrite an existing directory. Reuse the skills pack for instructions and existing template/compile services for documents.

## MCP and appearance

Extend the existing MCP manager with registry search and an install review that shows the command or URL, environment names and requested scope. Reuse current config storage and connection testing. Preserve secret redaction. Keep project instructions and registry descriptions as data. External agent configuration is not modified by an MCP import.

Appearance adds per-theme token overrides, application corner radius and validated theme JSON import/export. Preserve existing themes and light/dark behavior. Scope custom CSS to the app and reject remote imports and resource URLs. Provide reset and preview controls. Keep imported configuration separate from executable code.

## Scope

This is a local research workspace. Remote access, backups, cloud sync and changes to the separate live-collaboration work are outside this implementation.

## Implementation ownership

| Track | Main responsibility | Integration contract |
| --- | --- | --- |
| ACP | Agent catalog, launch/preflight, protocol, sessions, permission and CLI account flow | Native module and typed client, settings panel and session surface |
| Usage | Normalized counters, durable records, migrations, queries and report | Shared record DTO and report component |
| Conversation | Activity cards, reasoning, tool output and bounded message rendering | Existing `MessageItem`/`MessageList` callers remain compatible |
| Tasks | Durable queue, isolated execution, review and apply | Project task API and panel, runtime adapter boundary |
| Workspace | Linked roots and research project setup | Workspace API and panel using existing project/template services |
| Settings | Theme overrides and MCP registry discovery | Existing Appearance and MCP settings surfaces |

The coordinating task owns shared registration, app navigation, final integration, documentation, validation and the draft PR. Workers do not commit or push independently.

## Validation and delivery

Implement the feature tracks first, then run integrated E2E coverage. During development, use focused tests for protocol parsing, usage semantics, migrations, task state transitions and filesystem/process boundaries.

Before pushing, run the repository's frontend and Rust gates and reproduce the relevant CI jobs with the actual image, architecture and toolchain versions. The workflow's frontend and Rust jobs currently use Ubuntu 22.04, so do not assume the workspace guide's Ubuntu 24.04 example describes those jobs. Keep native macOS and Windows behavior separate from Linux container results.

Final E2E coverage must exercise the user-visible paths: authenticated ACP setup with fixtures, streaming and stop, permission expiry, restart history, usage report filters, replay deduplication, queued work, review/apply conflicts, linked-root boundaries, template creation and theme import/reset. Live paid account smoke tests remain distinct from protocol fixtures. Report any unavailable account or platform validation explicitly.

Keep the PR in draft until the implemented scope, integration checks and remaining limitations are clear. Do not describe planned features as shipped.
