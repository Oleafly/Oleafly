# Shared media

Used by the README and the docs site at [oleafly.com](https://oleafly.com)
(maintained in its own repository). Overwrite a file here and the README picks
it up on the next push.

Captures are taken from the running desktop app at retina resolution, window
only, on the dark theme, then downscaled to 2000px wide. The assistant
captures are a real run against GLM-5.2; the reasoning, tool calls, and
summary in them are the model's own. The demo library is seeded with
synthetic research projects; every number and figure in those documents is
made up, and the documents say so.

## README cover recording

`hero-editor.png` currently stands in for the product walkthrough at the top of
the README. Replace it with `workspace-tour.webp` when the recording is ready,
then update the image source in `README.md`.

Capture one 45–60 second path: open a real project, edit source, use one toolbar
action, compile, jump between source and PDF, open Git history, and show an AI
diff approval. Keep the final animated WebP below 10 MB so the README remains
quick to load.

## In the README

| File | What it shows |
|---|---|
| `hero-editor.png` | Editor and compiled PDF side by side, with a figure on the visible page |
| `library-shelf.png` | The library grid: colours, engine and kind labels, bookmarks, last-modified dates |
| `project-structure.png` | Source tree plus the project map, with sections and labels addressed by `file:line` |
| `citation-picker.png` | Citation keys parsed from the project `.bib`, with authors, year, and source line |
| `word-count.png` | LaTeX-aware word count for the open document |
| `pdf-figures.png` | A compiled page of plots, a colour-mapped error surface, and a results table |
| `pdf-preview-spread.png` | A whole multi-page document laid out at once |
| `git-diff.png` | Side-by-side source diff from Git history |
| `source-control.png` | Source Control panel: changed file, commit box, push/pull, Publish to GitHub |
| `project-templates.png` | Template gallery with live thumbnails, categories, and engine filters |
| `oleafly-tools.png` | The tools hub |
| `literature-search.png` | Deduplicated citation search across several scholarly indexes |
| `diagram-composer.png` | Diagram canvas beside its compiled TikZ preview |
| `preflight-ats.png` | Preflight score with source and compiled-output findings |
| `references-panel.png` | Bibliography, citations, and symbols for the open project |
| `ai-assistant-start.png` | Assistant starting points |
| `ai-approval-diff.png` | An assistant file change as a diff with Approve, Reject, Always allow |
| `ai-chat-applied.png` | A full assistant run: read, reason, two approved edits, compile, summary |
| `settings-ai.png` | Provider settings with several providers connected |
| `settings-mcp.png` | MCP server settings and the three approval policies |
| `search-omnibar.png` | Omnibar over projects and commands |

## Available but not currently placed

`citation-search.png`, `keyboard-shortcuts.png`, `settings-latex-engine.png`,
`ai-fix.gif`, `synctex.gif`, `github-push.gif`, `resume-tailor.gif`,
`hero-editor.gif`, `hero-editor-light.png`, `inline-ai-edit.png`,
`citation-lookup.png`, `editor-slash-menu.png`.

## Capturing more

Run the app (`pnpm tauri dev`), then capture the window only so there is no
desktop background or drop shadow:

```sh
screencapture -o -x -l "$(<window id>)" media/<name>.png
```

Before shipping a capture, check it for toast notifications that landed
mid-shot, for a stale or failed compile badge, and for any real credential.
