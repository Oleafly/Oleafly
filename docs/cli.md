# The `oleafly` command

`oleafly` builds, checks and inspects Oleafly projects from a terminal. It
uses the same compilers, settings and folders as the app, so a project
builds the same way in both. It also speaks MCP, so AI clients such as
Claude Code, Codex, Cursor and Gemini can work with your project through it.

Every command can print one JSON result (`--json`) with stable error codes
and exit codes, which makes it easy to script and easy for coding agents
to use.

## Install

`oleafly` comes with Oleafly. This page covers the commands in 0.4.8 and later.

- **macOS and Linux:** open Settings › General › Terminal command and choose
  Install. Oleafly links `oleafly` into a folder on your PATH (usually
  `~/.local/bin`). The Linux packages also install `/usr/bin/oleafly`.
- **Windows:** Settings › General › Terminal command copies `oleafly.exe` to
  `%LOCALAPPDATA%\Oleafly\bin` and adds that folder to your PATH. Open a
  new terminal afterwards. Remove undoes both, and so does uninstalling
  Oleafly.
- **Programs Oleafly starts** (the built-in terminal, CLI agents, research
  commands) find `oleafly` on their PATH, and its full path in the
  `OLEAFLY_CLI` variable, once Oleafly has set it up on its first launch.
- **Without the app:** each release also has standalone archives for
  macOS, Linux and Windows. They build with the compilers on your PATH.

Check the setup with:

```bash
oleafly doctor
```

## Quick start

```bash
oleafly new paper --template ieee   # a project from a template
cd paper
oleafly build                        # writes the PDF into the build folder
oleafly watch                        # rebuilds when you save
oleafly log --diagnostics            # errors and warnings with file and line
oleafly context                      # outline, labels, citations, problems
oleafly open .                       # opens the folder in the app
```

`-C <folder>` runs any command against another project folder.

## Builds match the app

`oleafly build` uses the app's compilers (the Tectonic, Typst and Pandoc
that ship with Oleafly, or the ones you installed), the same compile
arguments, the same `project.json` and the same build folder.

- A folder you opened in place in the app (without a `project.json`) builds
  with the engine and main document you chose in the app, into the app's
  build folder for it (`~/.oleafly/linked/<id>/build`). Nothing is written
  into your folder.
- The app and the CLI never build the same project at once. The second one
  waits for the first, up to the timeout.
- A failed build keeps the last good PDF.
- `-o <file or folder>` copies the PDF somewhere else after a good build.

## Commands

### `oleafly build` and `oleafly watch`

```bash
oleafly build [--main FILE] [--compiler COMPILER] [--variant NAME] [-o PATH]
              [--offline] [--fast] [--halt-on-error] [--timeout SECONDS]
oleafly watch [the same options]
```

`build` compiles the main document once. `watch` builds, then rebuilds on
every change until you press Ctrl+C or close the terminal. A failed build
keeps the last good PDF. With `-o` pointing inside the project, writing the
copy doesn't start another build. `--main` builds another document of the
project (on Windows, `\` works as well as `/`). `--compiler` picks the LaTeX
compiler for latexmk projects (`pdflatex`, `xelatex`, `lualatex`, `uplatex`,
`platex`). `--variant` picks a Typst variant from `project.json`.

```bash
oleafly build -o ~/Desktop/paper.pdf
oleafly --json build --log tail
```

### `oleafly init`, `oleafly new`, `oleafly open`, `oleafly clean`, `oleafly project`

```bash
oleafly init [--name NAME] [--main FILE] [--engine ENGINE]
oleafly new [DIR] [--template ID] [--name NAME] [--engine ENGINE] [--no-git]
oleafly open [PATH]
oleafly clean
oleafly project info
```

`init` makes the current folder a project (it writes `project.json` and, when
needed, a starter document). `new` creates a project in a new or empty
folder, from a template when you name one. Pack templates download on first
use. A template that needs a font pack copies it from the app's downloads;
install missing packs in the app under Settings › Downloads. `open` opens a
folder in the app. `clean` removes the build output. `project info` shows the
resolved settings.

### `oleafly templates`

```bash
oleafly templates list [--all] [--refresh]
oleafly templates show ID
```

`list` shows the installed templates: the app's own, downloaded packs and
your saved templates. `--all` adds templates that download on first use.
`--refresh` fetches the latest pack catalog first and lists those templates
too.

### `oleafly context` and `oleafly log`

```bash
oleafly context [--format md|json]
oleafly log [--diagnostics] [--tail LINES]
```

`context` maps the project for a person or an agent: files, outline, labels,
citations, missing files, unresolved references and the last build. `log`
shows the last build's log; `--diagnostics` lists its errors and warnings
with file and line. Neither reads a build file that is a symbolic link.

### `oleafly doctor`

```bash
oleafly doctor
```

Checks this computer (engines, the app, the data folder, TinyTeX, Git, MCP
clients, the terminal command) and, inside a project, the project. Each
problem comes with a fix.

### `oleafly stats` and `oleafly synctex`

```bash
oleafly stats [--main FILE] [--files]
oleafly synctex forward --file FILE --line N
oleafly synctex inverse --page N --x POINTS --y POINTS
```

`stats` counts words, headings, figures and equations across the document
and the files it includes, the way the app's word count does. `synctex` maps
a source line to its place in the PDF and back (LaTeX projects, after a
build). Points are measured from the page's top left corner.

### `oleafly export` and `oleafly convert`

```bash
oleafly export --to FORMAT [-o PATH] [--main FILE] [--variant NAME]
               [--ppi N] [--pages RANGE] [--pdf-standard STANDARD]
oleafly convert INPUT --to FORMAT [--from FORMAT] [-o PATH] [--force]
```

`export` turns the main document into `docx`, `html`, `md`, `txt`, `pptx`,
`epub`, `typst` or `tex` with Pandoc, as the app's Export menu does. Typst
projects also export `pdf`, `png`, `svg` and `html` with Typst itself. A
LaTeX or Markdown project's `pdf` export is its last good build. Without
`-o`, files go to the build folder's `exports` folder. An `-o` path must be
outside the project or inside its build folder.

`convert` turns one file into `latex`, `markdown`, `typst`, `html` or `docx`.
It never replaces an existing file unless you pass `--force`.

```bash
oleafly export --to docx -o ~/Desktop
oleafly convert notes.md --to latex
```

### `oleafly cite`, `oleafly literature` and `oleafly bib`

```bash
oleafly cite ID_OR_TITLE [--add] [--bib FILE] [--pick N]
oleafly literature QUERY [--source SOURCE]... [--limit N] [--since YEAR] [--until YEAR] [--open-access]
oleafly bib clean [FILE] [--apply] [--yes]
oleafly bib check [FILE] [--key KEY]... [--limit N]
```

`cite` looks up a DOI, arXiv id, ISBN or PubMed id and prints its BibTeX.
`--add` adds it to the project's bibliography (the `.bib` file the main
document uses, unless you name one with `--bib`), with a citation key in the
app's style. An entry whose DOI is already there isn't added twice. A `.bib`
file that isn't UTF-8 is left alone, with the error `bib.not_utf8`. Words
from a title list matching papers; `--pick N` takes one.

`literature` searches OpenAlex, Semantic Scholar, Crossref, arXiv and PubMed
at once, with the search keys you saved in the app.

`bib clean` gives every key the app's style and removes duplicate entries.
It shows the changes first; `--apply` makes them, updates the citations in
your sources too and keeps a backup. `bib check` looks up each entry's DOI or
title and lists entries that match no real record (exit code 9).

```bash
oleafly cite 10.1145/3292500.3330701 --add
oleafly cite "attention is all you need" --pick 1 --add
oleafly bib check --json
```

### `oleafly typst`

```bash
oleafly typst versions
oleafly typst install VERSION
oleafly typst default [VERSION] [--unset]
oleafly typst remove VERSION
```

The Typst versions the app offers under Settings › Downloads. `install`
downloads and checks a version. `default` sets the version projects without
a pin use (`--unset` goes back to the one that ships with Oleafly). A
project pins its own version in `project.json` (`oleafly config set
typst.version 0.13.1`).

### `oleafly checkpoint`

```bash
oleafly checkpoint list
oleafly checkpoint show ID
oleafly checkpoint diff ID [OTHER] [--patch]
oleafly checkpoint restore ID --to DIR
oleafly checkpoint restore ID --dry-run
```

The checkpoints the app saved of this project. `diff` compares a checkpoint
with the project (or with another checkpoint); `--patch` shows the changed
lines. `restore --to` copies a checkpoint into a new folder. Restoring over
the project stays in the app, which saves the current state first so you can
undo it.

### `oleafly config`, `oleafly projects` and `oleafly skills`

```bash
oleafly config list [--global]
oleafly config get KEY [--global]
oleafly config set KEY VALUE [--global]
oleafly config unset KEY [--global]
oleafly projects list
oleafly skills list
oleafly skills path [ID]
```

Project settings (in `project.json`): `name`, `main`, `engine`, `compiler`,
`typst.version`, `compile_dir`. App settings (`--global`):
`typst.default_version`, `latex.default_engine`, `checkpoints.enabled`,
`checkpoints.notifications`, `git.auto_init`, `skills.share_with_agents`,
`live_collaboration` and `ui.locale`; the MCP settings are shown but change
only in the app. Keys and tokens are never shown or changed here. If the app
is open, restart it to pick up an app setting.

`projects list` shows your library projects and the folders you opened in
place. `skills list` shows the skills the app's assistant and agents can
load, and `skills path` prints where they are.

### `oleafly mcp`

```bash
oleafly mcp [--bridge auto|always|never]
oleafly mcp config --client CLIENT [--scope project|user] [--command PATH] [--name NAME]
                   [--write] [--yes]
```

`oleafly mcp` is an MCP server on stdio. On its own it offers read tools
(project status, the project map and context, files, search, logs, the
doctor report, citation lookup) and `compile`. When the app has the project
open, it bridges to the app's own MCP server instead, so you get the app's
tools and its approval prompts (`--bridge always` requires the app,
`--bridge never` never uses it).

`mcp config` prints the entry for `claude-code`, `claude-desktop`, `codex`,
`cursor` or `gemini`, and with `--write` adds it to that client's settings
file (keeping a backup). Inside a project the entry goes in the project's
settings, elsewhere in your user settings; Claude Desktop has user settings
only. `--command` sets the program the client starts (by default `oleafly`
for a project, or this command's full path for user settings), and `--name`
the server's name in the client (`oleafly` by default). Claude Code keeps
user servers in its own settings, so with `--client claude-code --scope user`
the command prints the `claude mcp add` line to run instead, and `--write` is
refused.

```bash
oleafly mcp config --client claude-code --write
```

Each release also carries `oleafly.mcpb`, a Claude Desktop extension. Open it
and Claude Desktop installs it. It runs `oleafly mcp --bridge always` with the
`oleafly` command the app installed, so it needs the app. The MCP Registry
lists the same bundle as `io.github.Oleafly/oleafly`.

### `oleafly version`, `oleafly help`, `oleafly completions`, `oleafly man`

```bash
oleafly version
oleafly help [COMMAND or TOPIC]
oleafly completions bash|zsh|fish|powershell|elvish
oleafly man
```

`version` shows the version and the engines `oleafly` would use. `help`
also explains the topics `exit-codes`, `environment` and `json`.

### `oleafly auth`

```bash
oleafly auth login online [--server URL] --with-token | --cookie-stdin | --from-browser BROWSER [--profile NAME] [--dry-run]
oleafly auth login server URL [--setup-code CODE | --setup-code-stdin] [--open]
oleafly auth login git --host URL [--dry-run]
oleafly auth status [online|server|git]
oleafly auth logout online [--server URL] [--session-only | --git-token-only] [--dry-run]
oleafly auth logout server SERVER [--dry-run]
oleafly auth logout git --host URL [--dry-run]
oleafly auth token online [--server URL]
oleafly auth token server SERVER
oleafly auth token git --host URL
```

Sign-ins go into Oleafly's encrypted store, the one the app uses, so the app
and the command line share online sign-ins and Git tokens.

- `login online` saves a Git token (`--with-token`), which `remote link`,
  `diff` and `sync` use, or a session, which `remote list` and `import` use.
  A session comes from `--cookie-stdin`, or `--from-browser` copies it from a
  browser on this computer. Firefox works on every system; Chrome, Edge and
  Brave work on macOS. The session is checked with the service before it's
  saved.
- `login server` signs this command line in to an Oleafly collaboration
  server with a code you approve in your browser. The command line is its
  own device on the server, apart from the app. `--setup-code-stdin` reads a
  setup code from standard input, so it stays out of your shell history.
- `login git` saves a token for a Git host such as `https://gitlab.com`.
- Secrets are read from standard input, or asked for without echo in a
  terminal. They never appear in arguments, output or logs.
- `status` lists what's saved without showing any secret or part of one.
- `token` prints one token as plain text for scripts. It refuses `--json`, so
  tokens don't end up in JSON logs.

### `oleafly remote`

```bash
oleafly remote list [--server URL]
oleafly remote import PROJECT... [--into DIR] [--server URL] [--dry-run]
oleafly remote link [PROJECT] [--server URL] [--prefer local|remote] [--dry-run]
oleafly remote status [--fetch]
oleafly remote diff [--name-only] [--no-fetch] [--exit-code] [--latexdiff [--pdf] [-o FILE]]
oleafly remote sync [--dry-run] [--no-push] [--resolve PATH=local|remote]...
oleafly remote unlink [--dry-run]
oleafly remote open [--print]
```

Projects in your online LaTeX service account. `PROJECT` is a project's ID or
its address. `import` downloads projects into new folders and prints the
`oleafly open` command for each one.

`link` connects this folder to an online project through the service's Git
bridge, and `sync` merges online changes here and sends yours. Both need a
Git token. When a file changed on both sides, `sync` stops with exit code 8
and lists the files; run it again with `--resolve PATH=local` or
`--resolve PATH=remote` for each. `diff --exit-code` exits with 9 when files
differ and 8 when they conflict. `diff --latexdiff` marks up the main
document with what changed since the online version (it needs latexdiff from
your TeX distribution), and `--pdf` compiles the result. Without `-o`, the
marked-up document is in the JSON result's `text` field.

`link --prefer remote` saves the files it replaces in
`.oleafly/online-backups/` first. `link` lists the files the first sync will
send from here (`uploads` in JSON). `sync --dry-run` also says when it would
only send your changes (`wouldPush` in JSON), and lists the files here that
the online project doesn't have yet (`uploads`). A server address must use
`https://`, except on this computer.

A project in the app's library uses the app's sync state, so the app and the
command line always agree. Any other folder keeps its own in
`.oleafly/online/`, and some of its files never go online: anything in a
dot-folder or a dependency or build folder, `.env` files, `.private`, private
keys, TeX build output such as `main.aux` (or `main.pdf` next to `main.tex`)
and what the folder's `.gitignore` lists. From the command line you can link
a library project only if the app imported it from the online service.

### `oleafly server`

```bash
oleafly server sign-in URL [--setup-code CODE | --setup-code-stdin] [--open]
oleafly server status [SERVER] [--check]
oleafly server projects [--server SERVER]
oleafly server share [--link on|off] [--link-role editor|viewer] [--comments on|off] [--dry-run]
oleafly server members [list]
oleafly server members add WHO [--role editor|viewer] [--dry-run]
oleafly server members remove WHO [--dry-run]
oleafly server members role WHO editor|viewer [--dry-run]
oleafly server comments list [--file PATH] [--all] [--offline]
oleafly server comments add --file PATH [--line N|N-M] [--quote TEXT] (--body TEXT | --body-file FILE) [--dry-run]
oleafly server comments reply THREAD (--body TEXT | --body-file FILE) [--dry-run]
oleafly server comments resolve THREAD [--dry-run]
```

Oleafly collaboration servers. `share`, `members` and `comments` work on this
folder's shared project, or on `--shared ID --server SERVER`. Only a
project's owner can change its sharing or members, and sharing a project for
the first time happens in the app. `--body-file -` reads the comment from
standard input.

`comments` connects as this command line's device. If the server doesn't take
a comment in time, it stays on this computer and goes out with the next
`comments` command. `comments list --offline` reads the comments saved on
this computer without connecting.
### `oleafly check`

```bash
oleafly check [--profile PROFILE] [--anonymous] [--checks LIST]
              [--format human|json|sarif] [-o FILE] [--exit-code] [--fail-on LEVEL]
              [--build-log FILE] [--pdf FILE] [--no-build-output]
```

Runs the app's Preflight checks: the build log, submission rules for a
venue (`generic`, `arxiv`, `ieee`, `acm`, `journal`, `thesis`; picked from
the main document when you don't name one), accessibility, references,
privacy and, for a résumé, ATS. It reads the last build's log and PDF when
they are newer than the sources; `--build-log` and `--pdf` name others, and
`--no-build-output` checks the sources only. With `--build-log`, `check`
reads from the log whether that build failed. `--checks` picks what to report
(`compile`, `submission`, `ats`, `a11y`, `refs`, `privacy` or `all`).

Some PDF checks (accessibility tags, reading order, résumé parsing) run only
in the app; the JSON report lists them in `app_only_rules`.

With `--exit-code`, findings at `--fail-on` (`error` by default, or
`warning`, `info`) make the command exit with 9, for CI. Offsets in the JSON
report count UTF-16 code units in the file with LF line endings; lines and
columns start at 1.

`--format sarif` writes SARIF 2.1.0 for code scanning. On GitHub:

```bash
oleafly check --format sarif --output preflight.sarif
```

then upload `preflight.sarif` with `github/codeql-action/upload-sarif`. Use
`--output` rather than `>`: Windows PowerShell 5.1 writes redirected output
as UTF-16.

### `oleafly lint`

```bash
oleafly lint [PATH]... [--fix] [--no-prose] [--dialect DIALECT] [--words FILE]...
             [--format human|json|sarif] [-o FILE] [--exit-code] [--fail-on LEVEL]
```

Finds the problems the editor underlines in LaTeX and BibTeX files, and
spelling and grammar problems in LaTeX, Typst and Markdown (with Harper).
Without paths it lints the whole project, leaving out dependency and vendored
folders. `--fix` repairs repeated words, typos, punctuation and
capitalization when the fix is certain, keeps each file's line endings and
never touches a file that changed while it was checked. `--words` adds
accepted words, one per line. Spelling uses Harper's dictionary, so it can
differ from the app's spelling dictionaries.

## Headless agent

`oleafly agent run` does a task in a project without opening Oleafly.
`oleafly ask` answers a question about a project and changes nothing. Both
use the AI providers, keys and MCP servers you set up in Oleafly.

```bash
oleafly agent run --allow write "Fix the broken references in the introduction"
oleafly agent run --allow write,commands --apply "Make the paper compile"
oleafly ask "Which sections still cite preprints?"
echo "Summarize the methods section" | oleafly ask -
oleafly agent apply .oleafly/agent-runs/1792400000000-0f3a
```

Run them inside a project folder, or point at one with `-C <folder>`.

### `oleafly agent run [PROMPT]`

| Flag | What it does |
|---|---|
| `PROMPT` | What the agent should do. Use `-` to read it from stdin (at most 1 MiB). |
| `--prompt-file FILE` | Read the prompt from a file instead. |
| `--provider ID` | The AI provider. Default: the one picked in Oleafly. |
| `--model ID` | The model. Default: the one picked in Oleafly. |
| `--effort LEVEL` | How hard the model thinks: `auto` (default), `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. |
| `--allow WHAT` | What the agent may do besides reading: `write`, `commands`, `network`. Repeat the flag or join values with commas. Without `write`, the run only reads. |
| `--apply` | Write changes straight into the project instead of a review folder. Needs `--allow write`. |
| `--review-dir DIR` | Save the review here. Needs `--allow write`, and the folder must be empty or not exist yet. Inside the project it has to be under `.oleafly`. Default: `.oleafly/agent-runs/<run id>` in the project, or `~/.oleafly/linked/<id>/agent-runs/<run id>` for a folder the app opened in place. |
| `--max-steps N` | Stop after this many steps (1 to 2000, default 50). |
| `--timeout SECONDS` | Stop after this many seconds (10 to 86400, default 1800). |
| `--skill ID` | Use this skill. Repeat for more. |
| `--mcp NAME` | Use only this MCP server. Repeat for more. |
| `--no-mcp` | Use none of your MCP servers. |
| `--keep-workspace` | Keep the working copy in the review folder. |
| `--unsandboxed-commands` | Where Oleafly's sandbox doesn't work, let commands run as you in a review run too. They can then change files outside the review copy. |

### `oleafly ask [QUESTION]`

`ask` takes the same `--provider`, `--model` and `--effort` flags. It reads
the project and never writes. `--allow network` lets it search the web, look
up papers and use your remote MCP servers, and from those it only offers the
tools marked read-only. It never starts an MCP server that runs a program on
this computer. It stops after 30 steps or 600 seconds by default: raise the
steps with `--max-steps` (up to 200) and the time with `--timeout`.
`--no-mcp` turns off your MCP servers.

### What `--allow` turns on

| `--allow` | Tools the agent gets |
|---|---|
| (always) | `list_files`, `read_file`, `search_project`, `get_build_log`, `project_context`, `list_skills`, `load_skill`, `read_skill_file` |
| `write` | `write_file`, `edit_file`, `delete_file`, `compile` |
| `commands` | `run_command` (in the sandbox when this computer has one), and MCP servers that run a program |
| `network` | `web_search`, `web_fetch`, `literature_search`, `literature_arxiv_lookup`, `fetch_doi_bibtex`, `fetch_arxiv`, `crossref_search`, and remote MCP servers |

`web_search` needs a Brave, Tavily or Serper key in Oleafly's settings. A
provider that searches the web itself uses its own search instead.

Where the sandbox doesn't work, commands run as you. They run only with
`--apply`, or in a review run with `--unsandboxed-commands`, and never in a
run that only reads. A warning before the run starts says which applies.

### Review or apply

Without `--allow write`, `agent run` only reads the project: it reports what
it found or would change, and saves nothing (`mode` is `read`). With
`--allow write`, the agent works on a copy of the project. When it finishes,
Oleafly saves its changes in a review folder and prints how to apply them:

```text
Saved 3 changes for review in .oleafly/agent-runs/1792400000000-0f3a. Apply them with: oleafly agent apply .oleafly/agent-runs/1792400000000-0f3a
```

The run id is the time the run started, in milliseconds, and four random
hexadecimal digits.

`oleafly agent apply DIR` writes the saved changes into the project. It
refuses when a file in the project changed since the run started, and lists
those files. `--dry-run` lists the changes without writing them.

With `--apply` the agent edits the project itself. Use it when you track the
project with Git or have a checkpoint to go back to.

### Keys and models

The agent picks its provider and model in this order:

1. `--provider` and `--model`.
2. `OLEAFLY_PROVIDER` and `OLEAFLY_MODEL`.
3. The provider and model picked in Oleafly.

It takes the key from the provider's own variable (or `OLEAFLY_API_KEY`),
then from Oleafly's encrypted key store. Keys are never printed, logged or
put in a result. A model you haven't turned on in Oleafly still runs, with a
warning, because the CLI doesn't apply the app's model list.

| Provider | Variable |
|---|---|
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Google | `GEMINI_API_KEY`, then `GOOGLE_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| Groq | `GROQ_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |
| Mistral | `MISTRAL_API_KEY` |
| xAI | `XAI_API_KEY` |
| Perplexity | `PERPLEXITY_API_KEY` |
| Z.ai | `ZAI_API_KEY` |
| Ollama | `OLLAMA_HOST` (the server address) |
| Any provider | `OLEAFLY_API_KEY` |

Commands the agent runs and MCP programs it starts never see these
variables.

### Output

You see the model's text as it streams, and one line per tool call. The
model's usage joins Oleafly's usage history the next time you open the app.

With `--json` the CLI prints one result object:

```json
{
  "schema_version": 1,
  "type": "result",
  "command": "agent run",
  "ok": true,
  "run": {
    "runId": "1792400000000-0f3a",
    "mode": "review",
    "reviewDir": "/Users/me/paper/.oleafly/agent-runs/1792400000000-0f3a",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "credentialSource": "env:ANTHROPIC_API_KEY",
    "stopReason": "end_turn",
    "steps": 7,
    "toolCalls": 12,
    "text": "I fixed three references in introduction.tex.",
    "changes": [
      { "path": "introduction.tex", "kind": "modified", "beforeSha256": "…", "afterSha256": "…", "bytes": 18234 }
    ],
    "usage": { "inputTokens": 48211, "outputTokens": 3120, "cachedReadTokens": null, "cachedWriteTokens": null, "costUsd": 0.19 }
  },
  "warnings": []
}
```

`mode` is `read` (`ask`, or `agent run` without `--allow write`), `review`
or `apply`. `credentialSource` is `store`, `env:<VARIABLE>` or `none`, never
the key itself. `stopReason` is `end_turn`, `step_limit`, `timeout` or
`interrupted`. A run that stopped at its step or time limit prints the same
result with `"ok": false` and an `error` whose code is `agent.step_limit` or
`agent.timeout`.

With `--events`, each event is one JSON line before the result:
`{"schema_version": 1, "type": "event", "command": "agent run", "event": "<name>", …}`.

| Event | Fields |
|---|---|
| `started` | `runId`, `provider`, `model`, `mode`, `reviewDir` |
| `text` | `text` |
| `reasoning` | `text` |
| `tool_call` | `id`, `name`, `arguments` (cut at 4 KiB, with `truncated` set) |
| `tool_result` | `id`, `status` (`ok` or `error`), `bytes` |
| `usage` | `inputTokens`, `outputTokens` |
| `step` | `step` |

Ctrl+C stops the run and keeps what it did so far: a review folder with the
changes up to then, and the result with `stopReason: "interrupted"`. A
second Ctrl+C exits at once.

### Exit codes for `agent` and `ask`

| Code | When |
|---|---|
| 0 | The agent finished. |
| 1 | The provider failed after the run started (`agent.provider_error`), or something inside Oleafly went wrong. |
| 2 | The command line is wrong: no prompt, `--apply` or `--review-dir` without `--allow write`, or a review folder that isn't empty or isn't allowed there. |
| 3 | The project can't be used, the prompt can't be read, `agent apply` was given a folder that isn't a review of this project, or a path is unsafe. |
| 4 | No provider is set up (`agent.no_provider`). |
| 6 | There is no key for the provider (`agent.missing_key`), or the provider rejected it. |
| 7 | Oleafly couldn't reach the provider before the first step finished. |
| 8 | `agent apply` found files that changed since the run. |
| 10 | It stopped at the step limit or the time limit (the result is still printed). |
| 130 | You pressed Ctrl+C. |

## Background helper

Research tasks can keep running after you quit Oleafly. Mark a task "Keep
running when Oleafly is closed" when you create it, or later in its details.
When you quit, those tasks stop at their next step and move to the
background helper, a small Oleafly process with no window. It runs them,
notifies you when one needs you, and exits when it has nothing left to do.

When you open Oleafly again, it takes the tasks back. A task the helper is
working on comes back after its current step, and shows "Moving back" until
then. The task's activity tab shows what the helper did, and "Show earlier
activity" loads the part before the move.

Turn this off in Settings, Research, Background tasks. There you can also
start the helper when you sign in (so tasks resume after a restart), see
whether it runs, stop it and open its log. Restarting Oleafly or installing
an update never starts the helper. The tasks wait for Oleafly to open again.

### `oleafly daemon run`

Runs the helper in this terminal. It prints its log there and stops on
Ctrl+C, with exit code 0. `--stay` keeps it running when there is nothing to
do. It exits with 8 when another helper already runs.

### `oleafly daemon status`

Shows whether the helper runs, its process id, and its tasks. With `--json`
the result has a `daemon` object:

```json
{
  "daemon": {
    "running": true,
    "pid": 48211,
    "appVersion": "0.4.8",
    "phase": "ready",
    "mode": "app",
    "startedAt": 1792400000000,
    "heartbeatAt": 1792400035000,
    "logPath": "/Users/me/.oleafly/daemon/helper.log",
    "tasks": [
      { "id": "…", "projectId": "…", "title": "Survey related work", "status": "running", "pendingApprovals": 0, "reclaimRequested": false }
    ]
  }
}
```

`mode` is `app` (started when Oleafly quit), `at-login` or `foreground`.

### `oleafly daemon stop`

Asks the helper to hand its tasks back and exit. The tasks wait for Oleafly.

| Flag | What it does |
|---|---|
| `--wait SECONDS` | How long to wait for the helper to stop (0 to 600, default 30). |
| `--force` | End the helper if it doesn't stop in time. Its tasks resume from where they were when Oleafly opens. |

`stop` exits with 8 when the helper is still running after `--wait`.

### Helper files

The helper keeps its files in `~/.oleafly/daemon/` (or
`$OLEAFLY_DATA_DIR/daemon/`): `helper.log` (rotated at 5 MiB, one old file
kept), `state.json` (process id, phase and heartbeat, no paths or keys),
`daemon.lock`, `stop-request`, `app-open.json` (which process is the open
app, so the helper leaves notifications to it), `search-dirs.json` (the
folders the app finds programs in, which the helper uses too), and
`usage-spool.jsonl` with its `usage-spool.lock` (token counts and costs that
Oleafly adds to your usage history). The log never holds keys, prompts or
replies.

On Windows both installers, the `.exe` and the `.msi`, ask a running helper
to stop before they replace the app, and uninstalling removes the helper's
sign-in entry.

## JSON output

With `--json`, a command writes one JSON result object to stdout and nothing
else. Every result has:

| Field | Meaning |
|---|---|
| `schema_version` | `1` today. It changes only when a field is removed or changes meaning. |
| `type` | `"result"` |
| `ok` | `true` or `false` |
| `command` | the command, such as `"build"` or `"project info"` |
| `warnings` | `[{code, message}]`, possibly empty |
| `error` | on failure: `{kind, code, message, hint?, retryable?, details?}` |

Every result with `"ok": false` has an `error`, and the exit code matches
`error.kind`:

| `error.kind` | Exit code |
|---|---|
| `internal` | 1 |
| `usage` | 2 |
| `invalid_input`, `not_initialized`, `invalid_manifest`, `unsafe_path`, `io` | 3 |
| `missing_tool`, `system` (a file outside the project, such as a client's settings, couldn't be read or written) | 4 |
| `build` | 5 |
| `auth` | 6 |
| `network` | 7 |
| `conflict` | 8 |
| `findings` | 9 |
| `limit` (an agent run stopped at its step or time limit) | 10 |
| `interrupted` | 130 |

When the command's own fields already say what went wrong (a failed build,
the findings of `check`, `lint` or `bib check`, the problems `doctor`
found), `error` carries a general code such as `build.failed` or `findings`,
and the details stay in those fields.

`--events` adds progress lines before the result, each with
`"type": "event"` and an `event` name. `oleafly watch --json` writes only
events. Each has `ok`: the build's result on `build_finished`, `false` on
`build_error` and `watch_error`, and `true` on the rest, except
`lock_wait`, which only says the build is waiting for another build of the
same project. `watching` and `build_finished` also carry the build's
`warnings`. Notes, progress and warnings for people go to stderr.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | It worked. |
| 1 | Something inside Oleafly went wrong (a bug). |
| 2 | The command was used wrongly, or it needs `--yes` to go ahead. |
| 3 | The project is missing or invalid, or a path points outside it. |
| 4 | A tool or the Oleafly app it needs isn't installed, or a file outside the project (a client's settings) couldn't be read or written. |
| 5 | The build failed. |
| 6 | You need to sign in. |
| 7 | The network failed. |
| 8 | Something else holds the project (another build, the app). |
| 9 | A check found problems. |
| 10 | The agent stopped at its step or time limit. |
| 130 | You pressed Ctrl+C. |

`oleafly watch` and `oleafly daemon run` run until you stop them, so Ctrl+C
ends them with 0.

## Environment

| Variable | Use |
|---|---|
| `OLEAFLY_DATA_DIR` | Oleafly's data folder (default: `~/.oleafly`). |
| `OLEAFLY_TECTONIC`, `OLEAFLY_LATEXMK`, `OLEAFLY_TYPST`, `OLEAFLY_PANDOC` | The compiler to use instead of the one Oleafly finds. |
| `OLEAFLY_APP` | The Oleafly app to open folders in. |
| `OLEAFLY_TEX_BUNDLE_URL` | The TeX bundle Tectonic downloads packages from. |
| `OLEAFLY_PACKS_BASE_URL` | Where template packs are downloaded from. |
| `OLEAFLY_WATCH_POLL` | Set it to make `oleafly watch` poll for changes. |
| `OLEAFLY_CLI` | Set for programs Oleafly starts: this command's path. |
| `OLEAFLY_ONLINE_GIT_TOKEN` | A Git token for the online LaTeX service, used instead of a saved one (for CI). It goes only to the service's own server, a server you name with `--server`, or one you've signed in to. |
| `OLEAFLY_SANDBOX_FORWARD_URL_LOGINS` | Set it to `1` to keep user names and passwords in proxy and package-index addresses for sandboxed commands. By default they are removed. |
| `OLEAFLY_PROVIDER`, `OLEAFLY_MODEL` | The AI provider and model for `oleafly agent` and `oleafly ask`. |
| `OLEAFLY_API_KEY` | A key for that provider, used when its own variable isn't set. |
| `CODEX_HOME` | Where Codex keeps its settings (for `mcp config`). |
| `CI` | When set to anything but `0` or `false`, Oleafly never asks questions. |
| `NO_COLOR` | When set, output has no color. |

`--no-input` also turns off questions; a command that needs confirmation
then fails with exit code 2 and asks for `--yes`.

## For AI agents

Oleafly bundles an `oleafly-cli` skill that teaches coding agents the loop:

1. `oleafly --json context` to learn the project,
2. edit the sources,
3. `oleafly --json build`,
4. `oleafly --json log --diagnostics` and fix the first error,
5. repeat until the build is clean.

Always check `ok`, act on `error.code` and `error.hint`, and don't pass
`--yes`, `--apply` or `--force` without the user's go-ahead.

## What stays in the app

In 0.4.8 the app alone creates checkpoints, restores them over a project,
shares a project on a collaboration server for the first time and reruns
Biber for a stale bibliography during a build.

## Developing the CLI

The binary target is `oleaflyc` so it doesn't clash with the app's own
binary. Run it from the repository with `cargo run -p oleafly-cli --bin oleaflyc -- build`.
