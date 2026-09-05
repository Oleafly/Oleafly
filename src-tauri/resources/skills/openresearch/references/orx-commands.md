# orx command surface

Verified against the OpenResearch CLI documentation on 2026-09-04:
https://raw.githubusercontent.com/alphaXiv/OpenResearch/main/SKILL.md and
https://raw.githubusercontent.com/alphaXiv/OpenResearch/main/README.md
(installer https://openresearch.sh/install.sh, openresearch-cli 0.1.120).
Run `orx --help` or `orx <command> --help` when something here does not match the
installed version.

## Id kinds

| Id | Where it comes from | Used by |
|---|---|---|
| project id | `orx projects` | `orx project view`, `orx runs`, `orx project edit`, `orx create-experiment` |
| experiment id | `orx project view <projectId>` | `orx exp status/run/cancel/desc` |
| run id | `orx runs <projectId>` | `orx logs` |

They look similar and are not interchangeable. Read the id back from the command that
owns it rather than carrying one forward from memory.

## Auth

| Command | Notes |
|---|---|
| `orx login [--api-url <url>]` | Opens a browser, does loopback OAuth, stores a token under `~/.config/openresearch/`. Ask the user to run it. Do not run it from a tool call. |
| `orx logout` | Removes the token. |

Local project, run, and literature commands need no token. Managed compute, instances, and
organization commands do.

The API base resolves from `--api-url`, then `OPENRESEARCH_API_URL`, then a built-in
default.

## Discovery

```sh
orx projects [--json]
orx orgs [--json]
orx project view <projectId>
orx runs <projectId> [--experiment <expId>]
```

`--json` exists on `orx projects` and `orx orgs`. Prefer it. `orx project view` and
`orx runs` are human tables: the id is the first column.

## Evidence

```sh
orx logs <runId>                       # tail, the default
orx logs <runId> --head                # the beginning
orx logs <runId> --bytes 20000         # a bounded slice
orx logs <runId> --range 40000:60000   # a specific window
```

`run_command` caps combined output at 200 KiB and kills the call at 120 seconds. A large
log needs several bounded reads, not one big one.

## Experiments

```sh
orx up                                                  # local dashboard, http://127.0.0.1:4791
orx up --remote user@host                               # workspace next to remote GPUs
orx project edit <localProjectId> --name "<n>" --run-command "<cmd>"
orx create-experiment <localProjectId> --title "<t>"    # prints the git branch
orx exp status <localExpId>
orx exp run <localExpId>
orx exp cancel <localExpId>
orx exp wait <localExpId>                               # blocking, do not use inside run_command
orx exp wake <localExpId>
orx exp desc <expId> [--set "<text>" | --stdin]
orx agent spawn "<task>" [--title "<t>"]                # delegates to a helper session
```

`orx up --remote` binds the remote service to loopback with no application level
authentication, so anyone else on that host can reach it. Say that out loud before
suggesting it.

Node code lives on a git branch in the local session worktree. Read and edit it with plain
git through `run_command`, or open the files directly when the worktree is inside the open
project.

## Literature

```sh
orx discover keyword "<query>"     # alphaXiv full text, with match snippets
orx discover embedding "<query>"   # alphaXiv semantic
orx discover openalex "<query>"    # OpenAlex
orx discover biorxiv "<query>"     # bioRxiv through OpenAlex
orx paper <arxiv-id | doi | url> [--source ...] [--full]
```

The source is auto-detected from the id. `--full` forces raw full text instead of the
report view. None of these need a login.

A hit from `orx discover` is a candidate, not a citation. Before it goes into a `.bib`
file, verify it with `verify_citation` on the DOI, exactly as `oleafly-literature-sweep`
does for its own hits.

## Compute

```sh
orx compute [--gpu <id>] [--count <n>] [--provider <name>]
orx compute --cpu
orx instance create <orgId> (--gpu <id> ... | --cpu <flavor> ...)
```

These spend money or allocate machines. Describe what will be created and get an explicit
yes from the user in the chat before running any of them.

## Documentation modules

`orx skill` prints the CLI's own overview and the list of modules. `orx skill <name>`
prints one module. Reach for these instead of guessing flags:

| Module | Covers |
|---|---|
| `orx-experiment-tree` | The tree model and the automatic research loop. |
| `orx-create` | Initialising a project and adding nodes. |
| `orx-compute` | Launching and monitoring runs on a backend. |
| `orx-instances` | Persistent standalone machines. |
| `orx-git` | Reading, editing, and diffing a node's code. |
| `orx-agent-delegation` | Handing independent work to a helper session. |
| `orx-evidence` | Capturing and reading run results. |
| `orx-reports` | Durable outputs in the project's artifacts directory. |
| `orx-figures` | Publication figures in matplotlib or TikZ. |
| `orx-paper` | Drafting a paper as LaTeX. |
| `orx-lit-review` | Cross-corpus retrieval and follow-up policy. |

For figures and for the paper itself, prefer the Oleafly skills: the project already has a
LaTeX engine, a bibliography, and a compile loop, and `oleafly-figure-prep` and
`oleafly-manuscript-scaffold` write into it. Use the orx modules when the work happens
inside an orx node's worktree instead.

## Skill installation into other agents

`orx install-skills` writes the OpenResearch skill into supported coding agents. It edits
directories outside the project. Mention it, let the user decide, do not run it.

## Telemetry

```sh
orx telemetry status
orx telemetry off
orx <command> --no-telemetry
```

Official builds send opt-out coarse usage events tied to a random installation id. If the
user asks about privacy, show them these three lines rather than describing the policy.
