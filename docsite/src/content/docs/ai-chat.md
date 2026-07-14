---
title: "Chat & tools"
description: "An AI agent wired into your project: it reads files, edits with your approval, compiles, checks the log, and verifies the PDF. Every change shows a diff first."
---

The chat panel (the sparkles tab in the left rail) is an agent inside your editor, not a chatbot bolted on next to it. Ask it to fix your LaTeX errors and it will compile, read the log, edit the file, recompile, and report back, pausing for your approval before touching anything.

![The assistant finds and fixes a LaTeX error](/OpenLeaf/media/ai-fix.gif)

## Asking

Type in the composer (Enter sends, Shift+Enter for a newline) or start from a suggestion chip: "Fix any LaTeX errors in my document", "Create a new section called 'Publications'", "Recompile and check for errors". The header shows which model you're talking to; click it to switch between every provider and model you've [configured](/OpenLeaf/ai-setup/), mid-conversation.

## What the assistant can do

Its toolbox, verbatim:

| Tool | What it does |
|---|---|
| `read_file` | Read any project file |
| `list_files` | List the project tree |
| `search_project` | Search text across the project |
| `project_map` | The structural map: outline, labels, citations, macros, file graph, unresolved refs |
| `write_file` | Write a whole file (approval required) |
| `replace_in_file` | Targeted find-and-replace edits (approval required) |
| `create_file` | Create a file or folder (approval required) |
| `rename_file` | Rename or move (approval required) |
| `delete_file` | Delete (approval required) |
| `compile` | Build the project and report errors |
| `get_log` | Read the full compile log |
| `get_pdf_text` | Extract the compiled PDF's text to verify output |
| `verify_pdf_pages` | Rasterize chosen PDF pages and actually look at them, a vision check of the rendered layout (needs a vision model and the **Allow PDF page capture** toggle in Settings → AI) |
| `set_main_doc` | Change the compile entry point |
| `toggle_theme` | Flip light/dark mode |

Tool calls appear in the chat as chips (spinner while running, then a check, or an X if rejected); click one to expand its output.

## You approve every change

Any file-changing tool pauses the whole run and shows an approval card: which tool, what it wants to do, and a red/green diff of exactly what would change. **Approve** or **Reject**; the decision is stamped on the tool chip permanently, so the conversation records what you allowed.

![The approval card: a diff you approve or reject](/OpenLeaf/media/ai-approval-diff.png)

Two more layers of safety back this up:

- Before its first edit of a run, the assistant commits an "OpenLeaf AI checkpoint" to your project's Git, so even approved changes can be rolled back wholesale from [history](/OpenLeaf/git-history/).
- Runs cap at 50 steps, so a confused agent can't loop forever.

## Plans, progress, and cost

On a multi-step job the assistant works like an agent, and shows its work:

- **A plan checklist.** When it breaks a task into steps, a todo list renders in the panel and ticks off items as it goes, so you can see what it intends to do and where it is.
- **A running cost meter.** Every reply shows the input and output token counts and a rough USD estimate for the model you're on, updated live as it streams. Since you bring your own key, that's real money you can watch.
- **Sticky memory.** The agent can jot short notes to itself ("the résumé uses `moderncv`", "the intro still needs a citation"). They persist per project across new chats and app restarts, so it doesn't re-learn your document every time.

## Float it over the editor

The assistant doesn't have to stay in the rail. **Float the assistant** pops it out into a draggable, resizable card over the editor: drag it by the header, resize from the corner, and it stays put across view switches and restarts. **Dock it back** returns it to the rail. There's only ever one live conversation, floated or docked, so nothing desyncs when you move it.

## Handing off from an inline edit

Start a quick change with an [inline AI edit](/OpenLeaf/ai-inline-edit/) and then decide it needs the full agent? Hand it off, and your instruction lands in the chat composer with the context carried over, ready to send.

## Attachments

The paperclip attaches up to 6 files (10 MB each): images go to vision-capable models, and PDFs, `.tex`, `.bib`, text, and Markdown ride along as documents. Handy for "make my resume look like this screenshot" or "summarize this reference PDF". Only names and types are kept in history, never the bytes.

## Reasoning models think out loud

With GLM or DeepSeek R1, a collapsible **Thinking** block streams the model's reasoning live, then folds away to "Thought for Ns". You see the chain of thought exactly as it happens, interleaved with tool calls.

## Long-running answers

Streaming shows tokens as they arrive, with a status shimmer ("Running compile…"). The send button becomes **Stop** during a run. If a provider stalls, a watchdog tells you at 20 seconds and aborts at 90 rather than hanging. Errors come back as plain guidance: an invalid key points you to Settings, an empty balance says so, a rate limit suggests waiting or switching models.

## Chats are kept, locally

The **+** button starts a new chat; the clock opens history: up to 50 chats per project, stored locally, searchable by title, deletable individually. A chat started before you rolled the project back gets an "older version" badge. Hover any message for a **Copy** button.

## What the assistant knows

It starts with your project's name and main document, and pulls everything else through tools: it reads files when it needs them and uses `project_map` to reason about structure (the same [index](/OpenLeaf/code-intelligence/) that powers go-to-definition). Your [custom instructions](/OpenLeaf/ai-setup/#custom-instructions) ride along on every request.

## Figures are their own mode

The sparkles toggle in the chat header switches to the figure studio, where the assistant drafts TikZ, compiles it in isolation, and inspects the render. That flow has its own page: [Draw figures with AI](/OpenLeaf/ai-figures/). For quick selection rewrites without a conversation, see [Inline edits](/OpenLeaf/ai-inline-edit/).
