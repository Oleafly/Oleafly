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
offered to it, and a call to one of those is refused if the model tries
anyway. The turn ends with a numbered checklist marked "Awaiting approval".
Approve plan runs that checklist under whatever approval mode the project
already uses, so Ask for approval, Approve for me, and Full access work exactly
as they do outside plan mode. Revise, or anything you type while the plan is
waiting, goes back as feedback and produces a fresh plan. Turn Plan off and the
pending approval is dropped, so the next turn is a normal one.

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
