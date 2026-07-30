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

## Change and approval model

- File-changing actions produce a visible diff before application.
- Ordinary writes can be approved for the current session according to the
  selected policy.
- Deletes remain separately visible and can require an explicit confirmation.
- Tool results are scoped to the project and are not an authorization to read
  unrelated local files.

## Provider and data boundary

Provider credentials are stored in encrypted app state and are never written
to project files. Hosted calls are opt-in. Local Ollama operation keeps model
traffic on the machine. The provider interface and model discovery code are
shared by the built-in assistant and figure-generation flows.

## Engineering anchors

- `packages/ai-core/`: provider interfaces and model discovery.
- `packages/ai-tools/`: tool contracts and host boundary.
- `src/lib/ai/` and `src/store/chats.ts`: assistant orchestration and history.
- `src/contributions/ai-toolsets.ts`: registered tool groups.
- `docs/mcp.md`: external-client integration using the same tool boundary.
