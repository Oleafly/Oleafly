---
name: oleafly-cli
description: Build, diagnose and inspect an Oleafly LaTeX, Typst or Markdown project from a terminal or a coding agent with the oleafly command. Use for compile errors and build logs, the project's outline, labels and citations, word counts, exports to Word or HTML, citation lookup and bibliography cleanup, Typst versions, checkpoints, and setting up Oleafly's MCP server for an AI client.
license: MIT
compatibility: Needs the oleafly command from Oleafly 0.4.8 or later.
allowed-tools: Bash(oleafly:*) Read Edit
metadata:
  version: "1.0.0"
  skill-author: Oleafly
  oleafly:
    tier: native
    phase: tooling
    tools:
      - run_command
      - read_file
      - replace_in_file
---

# The oleafly command

`oleafly` builds and inspects Oleafly projects outside the app, with the
app's own compilers and settings. A project built here builds the same way
in the app.

## When to use it

- The user asks you to fix a document that doesn't compile.
- You need the project's structure: files, outline, labels, citations,
  missing files, unresolved references.
- You need a word count, an export (Word, HTML, EPUB, slides), a citation's
  BibTeX, or a bibliography check.
- The user wants Oleafly's MCP server in their AI client.

## Ground rules

1. Always pass `--json` (before or after the command). Read one JSON object
   from stdout.
2. Check `ok`. When it is `false`, act on `error.code` and follow
   `error.hint`. Don't guess from `error.message`.
3. The exit code tells you what kind of fix is needed (table below). A build
   failure (5) means fix the document; a missing tool (4) means tell the user
   what to install; a busy project (8) means wait and retry.
4. Never pass `--yes`, `--apply` or `--force` unless the user said to go
   ahead. Without them, commands that change files only show what they
   would do.
5. Don't edit anything inside `.oleafly/`. It belongs to the app.
6. Run commands from the project folder, or pass `-C <folder>`.
7. Don't start `oleafly agent run` or `oleafly ask` unless the user asks for
   it. They run another AI agent on the user's keys and cost them money.

## The fix loop

```bash
oleafly --json context            # learn the project once
# edit the sources
oleafly --json build              # compile
oleafly --json log --diagnostics  # errors and warnings with file and line
# fix the first error, then build again
```

Fix the first error only, then build again. Later errors are often caused by
the first one. Stop when `build.ok` is `true` and `build.errors` is empty.

## Commands

| Command | What it does |
|---|---|
| `oleafly build [--main FILE] [-o PATH]` | Compile the project. `build.errors` lists the problems. |
| `oleafly watch` | Rebuild on every change (Ctrl+C stops). |
| `oleafly log [--diagnostics] [--tail N]` | The last build's log, or its diagnostics. |
| `oleafly context` | Files, outline, labels, citations, missing files, last build. |
| `oleafly doctor` | What is installed and what is missing, with fixes. |
| `oleafly stats [--files]` | Words, headings, figures and equations. |
| `oleafly synctex forward --file F --line N` | Where a source line is in the PDF (LaTeX). |
| `oleafly synctex inverse --page N --x X --y Y` | The source line at a PDF point (LaTeX). |
| `oleafly export --to docx` | Export the main document (docx, html, md, txt, pptx, epub, typst, tex; Typst also pdf, png, svg). |
| `oleafly convert FILE --to latex` | Convert one file (latex, markdown, typst, html, docx). |
| `oleafly cite <doi or arXiv id> [--add]` | BibTeX for a DOI, arXiv id, ISBN or PubMed id; `--add` adds it to the project's .bib. |
| `oleafly literature "<query>"` | Search OpenAlex, Semantic Scholar, Crossref, arXiv and PubMed. |
| `oleafly bib check` | Entries whose DOI or title matches no real record (exit 9). |
| `oleafly bib clean` | Preview key fixes and duplicate removal (`--apply` with the user's go-ahead). |
| `oleafly typst versions` | Typst versions, which are installed, which is the default. |
| `oleafly checkpoint list` | The app's checkpoints of this project; `diff ID` compares one with now. |
| `oleafly config get main` | A project setting (`name`, `main`, `engine`, `compiler`, `typst.version`, `compile_dir`). |
| `oleafly new DIR --template ID` | A new project from a template (`oleafly templates list --all`). |
| `oleafly mcp config --client claude-code` | The MCP entry for an AI client (`--write` adds it). |
| `oleafly auth status` | Saved sign-ins for online LaTeX services, collaboration servers and Git hosts (never the secrets). |
| `oleafly remote status` | Whether this folder is linked to an online project, and which token sync would use. |
| `oleafly remote diff --name-only` | Files that differ from the online project; `sync` merges both ways (only with the user's go-ahead). |
| `oleafly server comments list` | Open comment threads on this shared project. |
| `oleafly check [--exit-code]` | The app's Preflight checks before submission (exit 9 with `--exit-code` when errors remain). |
| `oleafly lint [PATH]` | LaTeX, BibTeX, spelling and grammar problems; `--fix` only with the user's go-ahead. |
| `oleafly daemon status` | Whether Oleafly's background helper is running research tasks after the app closed. |

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | It worked. | Continue. |
| 1 | A bug in Oleafly. | Report it to the user with the message. |
| 2 | The command was used wrongly, or needs `--yes`. | Fix the arguments; ask before adding `--yes`. |
| 3 | The project is missing or invalid, or a path is outside it. | Check the folder and `project.json`. |
| 4 | A tool or the app isn't installed. | Tell the user what to install (see `hint`). |
| 5 | The build failed. | Read `build.errors` and fix the first one. |
| 6 | Sign-in needed. | Ask the user to sign in. |
| 7 | The network failed. | Retry later; it may be offline. |
| 8 | The project is busy (another build, the app). | Wait a moment and retry. |
| 9 | A check found problems. | Report or fix the findings. |
| 130 | Interrupted. | Stop. |

## MCP

`oleafly mcp` is an MCP server on stdio. It bridges to the running app when
the app has the project open (the app's tools and approvals), else it serves
read tools and `compile` on its own. `oleafly mcp config --client <client>`
prints the settings entry for `claude-code`, `claude-desktop`, `codex`,
`cursor` or `gemini`.

## Windows

- The command is `oleafly.exe`, installed in `%LOCALAPPDATA%\Oleafly\bin`.
  After installing, only new terminals find it.
- In PowerShell, quote arguments with spaces in double quotes, and pass
  `--json` output to `ConvertFrom-Json`.

## More

`references/json-contract.md` describes the JSON result, the error object,
progress events and the fields of the `build`, `context` and `log` results.
