# AI assistant

OpenLeaf has a built-in AI assistant that can read and edit your files, compile your project, and check the result against the actual PDF. Point it at errors and let it iterate until the build is green.

## Connect a provider

Open Settings → AI Assistant. There's a card for each supported provider. Paste your key and hit Save, and that provider becomes active.

| Provider | Type | Notes |
|---|---|---|
| **OpenAI** | API key | GPT-4o, GPT-4.1, o3-mini |
| **Anthropic** | API key | Claude Sonnet 4, 3.5 Sonnet/Haiku |
| **Groq** | API key | Very fast Llama inference |
| **OpenRouter** | API key | One key → many labs' models |
| **DeepSeek** | API key | V3 / R1 reasoner |
| **Mistral** | API key | Mistral Large / Codestral |
| **xAI (Grok)** | API key | Grok 2 |
| **Z.AI (GLM)** | API key | GLM coding models |
| **Ollama** | Local host | Runs on your machine, no key needed |

Each card links out to where you can grab a key. Keys stay local and are stored
in the OS keychain when available. If the keychain is unavailable, OpenLeaf
uses an owner-only `~/.openleaf/config.json` fallback (`0600` on Unix).

## Run it locally with Ollama

If you don't want any data leaving your machine, use Ollama.

1. [Install Ollama](https://ollama.com) and pull a model: `ollama pull llama3.2` (or `qwen2.5`, `mistral`, and so on).
2. In Settings → AI Assistant, pick the **Ollama (local)** card.
3. The host is `http://localhost:11434` by default. Save it.
4. Choose the model you pulled. The assistant now runs fully offline.

Each provider is a collapsible card, so the section stays tidy when you have several connected.

## Switching providers and models

- The active provider is marked with a badge on the right of its card. Saving any provider's key makes it active.
- Change the model from the dropdown on the active card.
- If you have multiple keys, use **Activate** on any saved card to switch.
- Click the trash icon on a card to delete that key. Deleting the active key disables AI access until you connect another.

## Custom instructions

Settings → AI Assistant has a **Custom instructions** field for your own system prompt: a house style, a preferred tone, conventions to follow. It is layered into the assistant's behaviour as your personal preferences. It is sandboxed, so it cannot override the assistant's safety rules or the available tools, and it cannot reveal the built-in prompt.

## What it can do

The assistant is a multi-step agent. Each turn it receives live workspace context (active file, open tabs, compile status, compact project map), can plan with todos, edit with approval, compile, and verify the PDF.

| Tool | What it does |
|---|---|
| `read_file` | Read a file (supports offset/limit; large files truncate) |
| `write_file` | Write or overwrite a file |
| `replace_in_file` | Find & replace within a file |
| `create_file` | Create a file or folder |
| `rename_file` | Rename or move a path |
| `delete_file` | Delete a file or folder |
| `list_files` | List the project tree |
| `search_project` | Search text in the current project |
| `project_map` | Structural outline, labels, citations/refs, and included/imported file graph for LaTeX or Typst |
| `compile` | Compile with the project’s selected document engine |
| `get_log` | Read the last compile log |
| `get_pdf_text` | Extract text from the rendered PDF |
| `verify_pdf_pages` | Rasterize selected pages for vision layout checks |
| `update_todos` / `get_todos` | Maintain a multi-step plan checklist in the chat |
| `remember_note` / `list_notes` / `forget_note` | Sticky project memory across chats |
| `set_main_doc` | Set the main document (requires approval) |
| `toggle_theme` | Toggle light/dark mode |

The chat shows **token usage** for the last run and a **cumulative total for the conversation** (when the provider reports usage), plus a **rough $ estimate** from public list prices (not a bill. Local and plan models show $0). Chat history lists tokens and $ per chat.

Each turn also injects **keyword RAG excerpts** from `.tex`, `.typ`, and `.bib`
files (no external embeddings). Typst `@key` occurrences are exposed honestly as
ambiguous reference-or-citation uses unless a project definition resolves them.
Figure mode is available only when the backend engine advertises isolated
compilation. It is therefore unavailable for Typst today. A live **Plan**
checklist appears during multi-step work. Inline AI edits can **Open in agent**
to continue with full project tools.

## Approving edits

Read-only tools (read, list, search, compile, get log, get PDF text, project map, todos, verify) run on their own. Anything that changes a file (or the main document) pauses for your approval first. The approval prompt shows a real red/green diff of exactly what will change. Approve, reject, or **Always allow** for the rest of the session (deletes still always ask).

Before each run, OpenLeaf takes a git **AI checkpoint**. After the run you can **Undo AI changes** in the chat to restore that checkpoint.

## PDF page capture

Settings → AI Assistant → **Allow PDF page capture for AI** (on by default) lets vision models receive rendered page images via `verify_pdf_pages`. Turn it off if you do not want page screenshots sent to your provider; the agent can still use `get_pdf_text`.

## Tips

- Ask in plain language: _"fix the LaTeX errors"_, _"add a Publications section"_, _"recompile and check the PDF shows my name"_.
- For targeted fixes it prefers `replace_in_file` over rewriting whole files.
- Multi-step tasks show a live **Plan** checklist in the chat.
- It loops: compile, read errors, fix, recompile, optionally verify pages, then explains what it did.

## Privacy

Your document content and keys stay on your machine. API calls go directly from the app to the provider you chose (or to `localhost` for Ollama). There's no OpenLeaf server in the middle.
