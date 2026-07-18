---
title: "Spelling & grammar"
description: "Offline spelling, grammar, and style checking that understands LaTeX: Hunspell and Harper run as local WASM, skip your commands and math, and offer one-click fixes."
---

Oleafly proofreads your prose without sending a word anywhere. Two engines run entirely on your machine as WebAssembly: **Hunspell** for classic spellchecking and **Harper** for spelling, grammar, and style together. Both are LaTeX-aware: commands, math, environments, and citation keys are masked out before checking, so `\usepackage` never gets flagged as a typo and `$\sigma$` never becomes a grammar error.

## Which engine runs when

Both live in Settings, General:

- **Spelling, grammar & style (Harper)**: the full checker. On by default. Flags misspellings, grammar slips, and style issues in your `.tex` prose, each with up to four one-click fixes (replace, remove, or add text).
- **Spellcheck** (Hunspell): the lightweight fallback. It runs only when Harper is off, so words are never double-underlined by two engines.

Turn both off for a completely quiet editor; both toggles are also in the ⌘K command palette.

## Harper's extra dials

Two sub-toggles appear under Harper when it's on:

- **Regionalism suggestions**: flags British versus American usage, useful when a US venue expects "color" and your fingers type "colour".
- **Word-choice suggestions**: catches the classics, like "too" versus "to".

## Fixing and ignoring

Click any underlined word to open its tooltip:

- **One-click fixes**: Harper's suggestions apply instantly.
- **Ignore "word" in this project**: stops flagging it in this project. Right for paper-specific jargon and author names.
- **Ignore "word" everywhere**: stops flagging it in all projects. Right for your name, your institution, and the vocabulary of your field.

Ignored words take effect immediately, and you can unignore any of them later: Settings, **Dictionary** lists every ignored word in two groups (this project, all projects) as removable chips.

## What gets checked, and what doesn't

- Only prose in `.tex` files is checked. LaTeX commands, math, comments, and code-like content are masked out first.
- The gutter shows a marker for each flagged line whenever a checker is on.
- Very large files (past roughly 150,000 characters) skip the grammar pass to keep typing smooth; spellcheck-level feedback still works when Hunspell is active.
- Checking is currently English-only.

## Privacy

There is no cloud grammar service here. The dictionaries and models ship with the app and execute locally, so drafts under embargo, unpublished results, and personal documents are never uploaded for proofreading. This is the same [local-first principle](/OpenLeaf/philosophy/) as the rest of Oleafly.
