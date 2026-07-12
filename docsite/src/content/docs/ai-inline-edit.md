---
title: "Inline AI edits"
description: "Press ⌘L on a selection, describe the change, and review a streaming inline diff: Accept with Enter, Reject with Esc, Retry with one click."
---

For a paragraph that needs tightening or a broken equation that needs one fix, a chat conversation is overkill. Inline edit is the fast path: select, **⌘L** (Ctrl+L), describe, review, done.

## The flow

1. **Select** the text to change (or just leave the cursor on a line; the line becomes the target).
2. Press **⌘L**, or right-click and choose **Ask AI…**
3. A prompt box opens under the target. Type what you want, or tap a preset: **Improve**, **Fix grammar**, **Make concise**, **Expand**, **Fix LaTeX**, **Translate**.
4. The proposal streams in as an **inline diff** laid over your text: deletions struck through in red, additions in green. Your document is not modified yet.
5. **Enter** accepts, **Esc** rejects, or hit **Retry** for another take.

Nothing mutates until you accept, and the diff renders in place, in context, where you can actually judge it, rather than in a side panel you have to mentally map back.

## What powers it

Inline edit uses the same active provider and model as the [chat](/OpenLeaf/ai-chat/) (the panel shows which), plus your [custom instructions](/OpenLeaf/ai-setup/#custom-instructions). It's a single-shot edit rather than an agent: no tools, no multi-step runs, which is what makes it instant.

The response is constrained to be a pure replacement for the selected text: no code fences, no commentary, no "Here's your improved version!".

## Details worth knowing

- **⌘L again** closes an open session; so does Esc.
- Empty or whitespace-only targets are ignored; select something real.
- Errors show inline with **Retry** and **Dismiss**; if no provider is connected you get an **Open Settings → AI** shortcut instead.
- Accepted edits are ordinary editor changes: **⌘Z** undoes them like anything else.

## When to use which AI surface

- **A sentence, a paragraph, an equation**: inline edit, right here.
- **Anything multi-file, structural, or needing a compile to verify**: [chat](/OpenLeaf/ai-chat/), where the agent has tools.
- **A figure**: [Draw with AI](/OpenLeaf/ai-figures/) or the [diagram composer](/OpenLeaf/figures-diagrams/).
