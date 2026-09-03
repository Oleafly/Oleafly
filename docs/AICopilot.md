# AI Copilot

The AI Copilot is a project-aware assistant. It is an optional layer over the
same file, compile, index, and preview operations available to the application;
it is not a second document model.

## Implemented capabilities

- Read project files and search across the active project.
- Create, edit, rename, and delete files through an approval-gated diff.
- Compile the project, inspect logs, and extract PDF text.
- Query project structure, labels, citations, macros, and file relationships.
- Explain or repair compiler errors.
- Add citations and generate or refine editable TikZ figures.
- Generate a template or figure when a configured provider supports it.
- Use a hosted provider, an OpenAI-compatible endpoint, or Ollama locally.
- Chat prompt shortcuts for **Friendly** and **Fire** paper review (mentor-style
  feedback and strict Reviewer #2 critique of the current document).

## Change and approval model

- File-changing actions produce a visible diff before application.
- Ordinary writes can be approved for the current session according to the
  selected policy.
- Deletes remain separately visible and can require an explicit confirmation.
- Tool results are scoped to the project and are not an authorization to read
  unrelated local files.

Plan mode (the Plan button, or the Enable Plan Mode slash command) makes the
assistant plan first. While it is on, the assistant can read and search the
project, but no tool that writes a file, compiles, or runs a command is
offered to it. If the model calls one anyway, the call is refused with a note
telling it to put that step in the plan instead, so a request that needs an
edit or a compile still ends up in the checklist rather than in an apology
about missing tools. The small info icon next to the Plan button says as much,
and reminds you that turning Plan off gives the assistant every tool directly.

While a plan is waiting, or a run is working through one, a pill sits centred
above the composer. It reads PLAN, then STEP x/N once there is a checklist,
then REVIEW with the added and removed line counts once files have changed.
Hover over the pill, or click it (Tab reaches it too), and a panel opens above
it with the checklist, an Awaiting approval or Approved badge, and the changed
files. Approve plan and Revise live in that panel while approval is pending,
and the panel opens on its own the moment a plan or a revision lands so those
buttons are in view without hovering. Escape, a click on the pill, or a click
anywhere else closes it, and it stays closed until the next plan arrives.
Approve plan runs the checklist under whatever approval mode
the project already uses, so Ask for approval, Approve for me, and Full access
behave exactly as they do outside plan mode. Revise, or anything you type while
the plan is waiting, goes back as feedback and produces a fresh plan. Turn Plan
off and the pending approval is dropped, so the next turn is a normal one.

Once every item is done and the run has finished, the pill goes away. A short
summary appears under the last assistant message instead, along the lines of
"Plan · 2/2 done · 3 files changed +40 -12", with the file rows under it. A run
that changed files without a plan gets the same summary minus the Plan label.

## Provider and data boundary

Provider credentials are stored in encrypted app state and are never written
to project files. Hosted calls are opt-in. Local Ollama operation keeps model
traffic on the machine. The provider interface and model discovery code are
shared by the built-in assistant and figure-generation flows.

## Engineering anchors

- `packages/ai-core/`: provider interfaces and model discovery.
- `packages/ai-tools/`: tool contracts and host boundary.
- `src/lib/ai/` and `src/store/chats.ts`: assistant orchestration and history.
- `src/components/ai/prompt-shortcuts.ts`: chat prompt categories (including Review).
- `src/lib/document-citation/`: paper-review prompts and document citation scan.
- `src/contributions/ai-toolsets.ts`: registered tool groups.
- `docs/mcp.md`: external-client integration using the same tool boundary.
