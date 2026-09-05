---
name: oleafly-research-loop
description: Entry point for research writing in Oleafly. Load this first when the user says they are writing a paper, starting a literature review, drafting related work, checking citations, preparing figures, responding to reviewers, or getting a submission ready. It sets the project layout every other research skill honours, plans the work with update_todos, and names the exact skill to load at each stage of the loop.
license: MIT
compatibility: Works in any Oleafly project. Stages that compile need a document engine (LaTeX, Typst or Markdown). Handoffs to vendored skills need Python 3.11 or newer on the login shell PATH.
allowed-tools: update_todos get_todos list_notes remember_note project_map list_files search_project read_file compile load_skill read_skill_file run_command spawn_agent wait_agent close_agent
metadata:
  version: "1.0.0"
  skill-author: "Oleafly"
  oleafly:
    tier: native
    phase: research
    tools:
      - update_todos
      - get_todos
      - list_notes
      - remember_note
      - project_map
      - list_files
      - search_project
      - read_file
      - compile
      - load_skill
      - read_skill_file
      - run_command
      - spawn_agent
      - wait_agent
      - close_agent
---

# Oleafly Research Loop

This is the router for a whole research project. It does two jobs. It fixes the file layout that every other Oleafly research skill reads and writes, so a sweep done in one session is still findable three weeks later. And it tells you which skill to load for the stage you are actually in, so you do not improvise a procedure that already exists.

Load this skill when the work spans more than one step. For a single question ("what is the DOI for this paper") answer it directly and skip the loop.

## Step 1. Read the ground before planning

Do this once per session, in this order. It is cheap and it stops you from rebuilding state that already exists.

1. `list_notes` with `{}`. Earlier turns may have recorded the bibliography path, the venue, the citation style, or a naming convention. Notes beat guessing.
2. `list_files` with `{}`. Look for `research/`, `figures/`, `review/`, and any `.bib` file. This tells you whether the layout below already exists or has to be created.
3. `project_map` with `{}` when the tool is offered. It returns `files`, `sections`, `labels`, `bibKeys`, `macros`, `inputGraph`, `unresolvedRefs` and `unresolvedCites`. `bibKeys` and `unresolvedCites` are the two fields the research skills depend on. The tool is only available when the document engine advertises a document index, so if it is not in your tool list, fall back to step 4.
4. `search_project` with `{"query": "\\addbibresource"}` and then `{"query": "\\bibliography{"}` for LaTeX, or `{"query": "bibliography"}` for Typst and Markdown. The hit tells you which `.bib` file the project actually compiles against. Use that file. Do not create `references.bib` when another one is already wired in.

If `list_files` shows no `research/` directory, create the layout in step 3 before doing any literature work.

## Step 2. Plan the loop with update_todos

`update_todos` takes `{"todos": [{"id": "...", "content": "...", "status": "pending"}]}` and replaces the whole list every call, so always send the full list. Statuses are `pending`, `in_progress`, `completed`, `cancelled`. Keep exactly one item `in_progress`. The list is capped at 30 items and each `content` at 240 characters.

Write the plan in loop stages, not in tool calls. A good first plan for "help me write this paper" looks like this.

```json
{"todos": [
  {"id": "sweep", "content": "Build the reading list for the research question", "status": "in_progress"},
  {"id": "related", "content": "Draft related work from the reading list", "status": "pending"},
  {"id": "claims", "content": "Audit the claims in the draft against their sources", "status": "pending"},
  {"id": "figures", "content": "Prepare the figures the argument needs", "status": "pending"},
  {"id": "review", "content": "Self review the full manuscript", "status": "pending"},
  {"id": "submit", "content": "Run the pre-submission checks for the target venue", "status": "pending"}
]}
```

Update the list when the shape of the work changes, not after every tool call.

## Step 3. The project layout every research skill honours

Create what is missing with `create_file` and `{"path": "research/notes", "is_dir": true}`. The layout is the contract between skills, so do not rename parts of it to suit one session.

| Path | Holds | Written by |
|---|---|---|
| `research/reading-list.md` | One table of every paper considered, with status | oleafly-literature-sweep |
| `research/sources/<key>.md` | Abstract plus provenance for one paper | oleafly-literature-sweep |
| `research/sources/<key>.pdf` | The downloaded PDF for one paper, when there is one | oleafly-literature-sweep |
| `research/notes/*.md` | Your own reading notes, synthesis, open questions | any skill, and the user |
| `research/claims.md` | The claim audit table | oleafly-verify-claims |
| `review/*.md` | Review reports, response letters, checklists | the review and submission skills |
| `figures/` | Generated and inserted figures | oleafly-figure-prep, insert_figure |
| the project `.bib` | Every citation the document compiles against | oleafly-literature-sweep, oleafly-related-work |

`<key>` is the citation key, formed as `<firstauthor><year>-<slug>`, all lowercase ASCII. First author surname, four digit year, then two or three words from the title joined by hyphens. `vaswani2017-attention-transformer`. Use the same key for the `.bib` entry, the source note, and the PDF, so the three always line up. If the project's existing `.bib` uses a different key scheme, follow the project. Consistency inside one bibliography matters more than this convention.

Record the deviation with `remember_note` when you follow a project scheme instead of this one.

## Step 4. Load the skill for the stage you are in

Load one skill at a time with `load_skill` and `{"id": "<skill id>"}`. It returns the skill's absolute directory, its file tree, its frontmatter, and its instructions. Read a supporting file with `read_skill_file` and `{"id": "<skill id>", "path": "references/handoffs.md"}`.

| Stage | You are doing this | Load |
|---|---|---|
| Research | Finding and annotating papers | `oleafly-literature-sweep` |
| Research | Judging whether the evidence in a paper holds up | `scientific-critical-thinking` |
| Research | A formal systematic review with screening counts | `literature-review` |
| Research | Raw access to eleven literature APIs, DOI and PMID resolution, open-access PDFs | `paper-lookup` |
| Research | Finding datasets, code, tools rather than papers | `research-lookup` |
| Research | Generating and sharpening research ideas | `scientific-brainstorming`, `hypothesis-generation` |
| Research | Designing a study or sizing it | `experimental-design`, `statistical-power` |
| Research | Analysing data inside the project | `oleafly-data-analysis`, then `exploratory-data-analysis` or `statistical-analysis` |
| Authoring | Starting a manuscript from nothing | `oleafly-manuscript-scaffold` |
| Authoring | Writing related work or background | `oleafly-related-work` |
| Authoring | Checking that the prose is supported by its citations | `oleafly-verify-claims` |
| Authoring | Cleaning, deduplicating, reformatting a bibliography | `citation-management` |
| Authoring | Prose quality, IMRaD structure, reporting guidelines | `scientific-writing` |
| Authoring | Fixing a compile that will not go green | `oleafly-latex-build` |
| Authoring | Starting from a venue template | `template-generate`, `venue-templates` |
| Authoring | Turning an imported PDF or messy source into project source | `pdf-to-latex`, `import-refine` |
| Figures | Building or repairing figures in the project | `oleafly-figure-prep` |
| Figures | Plotting data | `scientific-visualization` |
| Figures | Conceptual diagrams and schematics | `scientific-schematics` |
| Review | Reviewing your own manuscript before anyone else sees it | `oleafly-review-manuscript` |
| Review | Writing a formal referee report | `peer-review` |
| Review | Judging a venue, a journal, or an author record | `scholar-evaluation` |
| Submission | Format, page limits, anonymity, checklist for a venue | `oleafly-pre-submission` |
| Submission | Answering reviewers point by point | `oleafly-response-letter` |
| Submission | Grant and funding applications | `research-grants` |
| Communication | Slides and posters from the paper | `oleafly-slides-and-posters` |
| Communication | Beamer decks and poster layouts in detail | `scientific-slides`, `pptx-posters` |
| Tooling | Driving an OpenResearch experiment from the project | `openresearch` |

Full trigger phrases are in `references/handoffs.md`. Read it when the user's request does not map cleanly onto a row above.

## Step 5. Record durable conventions with remember_note

`remember_note` takes `{"content": "..."}` and the note survives into later sessions. Save a fact only when a future turn would get the work wrong without it.

Worth saving: the path of the bibliography the project compiles against, the citation key scheme when it differs from this skill's, the target venue and deadline, the citation style, a user preference about tone or terminology, and whether Python is available (step 6).

Not worth saving: anything already visible from `project_map` or `list_files`, the content of a paper, or a step you are about to do anyway. Notes are read on every turn, so noise there is expensive. Remove a stale one with `forget_note` and its id from `list_notes`.

## Step 6. Check Python once before any vendored script

Several vendored skills ship Python scripts. Check the interpreter once per session, before the first script, not before each one.

Call `run_command` with `{"command": "python3 --version"}`.

- Exit code 0 and a version of 3.11 or newer means the scripts will run. Save it with `remember_note` and `{"content": "python3 <version> is available for vendored skill scripts"}`.
- A version older than 3.11 means `paper-lookup` and `scientific-writing` scripts will fail. Use the native Oleafly tools instead and tell the user which step was skipped.
- Command not found means no Python. Do the work with `literature_search`, `verify_citation` and `project_library_search` alone. Tell the user plainly that the deeper database coverage needs Python 3.11 or newer on their PATH, and do not try to install it.

`run_command` runs one shell line from the project root through the login shell, with a 120 second timeout and a 200 KiB output cap. Every call asks the user for approval under the default policy, so batch related work into one command rather than issuing five. When a script produces more than a screenful, redirect it to a file under `research/` and read it back with `read_file`, which is cheaper and does not get truncated at 200 KiB.

Scripts live inside the skill directory, not the project, so always call them by absolute path with the directory `load_skill` returned.

```
python3 "<skill dir>/scripts/search_openalex.py" "graph neural network expressivity" --limit 25 -o research/sources/openalex-raw.json
```

Quote the path. Skill directories can contain spaces.

## Step 7. Read papers in parallel with spawn_agent

Reading ten papers in one context is slow and the details blur. Spawn one agent per paper when you have more than three to read.

`spawn_agent` takes `{"task_name": "read_vaswani2017", "prompt": "..."}` and returns immediately. The prompt must be self contained. The subagent shares your project tools and approval gates, and it cannot spawn agents of its own.

A prompt that works:

```
Read research/sources/vaswani2017-attention-transformer.pdf with read_file.
Write research/notes/vaswani2017-attention-transformer.md containing:
the problem the paper attacks, the method in three sentences, the evidence
offered, the stated limitations, and one line on how it relates to
<the project's research question>.
Do not edit any other file. Reply with the three sentence method summary.
```

Give each agent a distinct output path so two agents never write the same file. Collect with `wait_agent` and `{"timeout_ms": 300000}`, which returns whichever finishes first. Then `close_agent` with `{"agent": "<id or task path>"}`, because finished agents keep counting toward the concurrency limit until closed.

Do not spawn agents for work that mutates the manuscript. Parallel writes to the same section conflict and the loser is silently discarded.

## Failure handling

| What happened | What to do |
|---|---|
| `project_map` is not in your tool list | The engine has no document index. Use `search_project` and `read_file` instead, and say so once rather than retrying |
| A tool returns `{"error": "No project open"}` | Stop. Ask the user to open a project. Nothing in this loop works without one |
| A tool result has `"declined": true` | The user refused that action. Do not retry it or route around it. Ask what they would prefer |
| `run_command` reports `timed_out` | The 120 second cap was hit. Split the command, narrow the query, or use the native tools |
| `compile` returns `success: false` | Read `errors`, then `get_log` with `{}` for context, fix the source, compile again. Do not proceed to the next stage on a red build |
| A vendored script is missing from the tree `load_skill` returned | The skill was installed without it. Fall back to the native tool path and note the gap in your answer |
| The user asks for a paper you cannot verify | Say you could not verify it. Never write a citation key or a `.bib` entry for a paper you have not resolved through `verify_citation` |

## Done when

- [ ] The plan in `update_todos` reflects the stages actually remaining, with one item `in_progress`.
- [ ] `research/`, `figures/` and any `review/` directories the work needs exist.
- [ ] The bibliography path in use is the one the document compiles against, confirmed with `project_map` or `search_project`.
- [ ] Any convention a later session would need is saved with `remember_note`.
- [ ] The right stage skill has been loaded and its procedure followed, not paraphrased.
- [ ] `compile` is green, or the user has been told exactly what is broken and why.

## Reference files

- `references/handoffs.md` maps user phrasing to a skill id.
- `references/project-layout.md` gives the file formats, key rules, and provenance fields in full.
- `references/tooling.md` covers approval behaviour, subagent limits, and the vendored script surface.
- `assets/reading-list.md`, `assets/source-note.md` and `assets/claims.md` are the starting templates for the three shared files.
