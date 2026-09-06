# Skills

A skill is a folder the assistant can load mid conversation to pick up a
procedure it would otherwise have to improvise: a `SKILL.md` file with a name,
a description, and instructions, plus optional `references/`, `scripts/`, and
`assets/` subfolders for material the instructions point to. Oleafly follows
the [Agent Skills standard](https://agentskills.io), the same shape Claude
Code, Codex, and other agents read, so a skill you write here works elsewhere
and a skill you already have elsewhere can be dropped in here.

Skills live in Settings → AI → Skills, grouped by the phase of work they
belong to: Research, Authoring, Figures, Review, Submission, Communication,
Tooling, plus a "Your skills" group and a "Domain shelf" group.

## The three tiers

**Bundled research pack.** Oleafly ships with a pack of skills that cover a
full research-writing workflow. Some are Oleafly-native, written for this app
and its tools. Others are vendored unmodified from
[Scientific Agent Skills](https://github.com/K-Dense-AI/scientific-agent-skills)
by K-Dense Inc., MIT licensed, pinned to a specific commit recorded in
`scripts/skills/kdense-manifest.json`. The tier line under each skill's name
in Settings says which is which and, for vendored skills, names the author.

**Domain shelf.** Extra skills for research domains the bundled pack does not
cover, downloaded from `cdn.oleafly.com` only when you choose to install one.
The "Domain shelf" card in Settings lists what is available and shows what is
already installed.

**Your own.** Skills you add yourself, three ways: **Add folder** picks an
existing skill folder from disk (it must already contain a valid `SKILL.md`)
and copies it in; **Create skill** opens a blank editor for a name,
description, and instructions and writes a new `SKILL.md`; and **Record a
skill**, a slash command in the composer, drafts a `SKILL.md` from the chat
you were just having, pulling its steps from your completed to-dos when there
were any, so you can review and enable it instead of writing the whole thing
from scratch.

## The research loop

`oleafly-research-loop` is the entry point for anything that spans more than
one step. It sets the project layout every other research skill reads and
writes (a `research/` folder for sources, notes, and the claim audit; a
`review/` folder for review and response material; `figures/` for generated
figures), then names the skill for the stage you are actually in:

| Stage | You are doing this | Load |
|---|---|---|
| Research | Finding and annotating papers | `oleafly-literature-sweep` |
| Research | Judging whether the evidence in a paper holds up | `scientific-critical-thinking` |
| Research | A formal systematic review with screening counts | `literature-review` |
| Research | Raw access to eleven literature APIs, DOI and PMID resolution, open-access PDFs | `paper-lookup` |
| Research | Finding datasets, code, or tools rather than papers | `research-lookup` |
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

The full table, with the file-layout contract and citation-key convention it
sets up, lives in `oleafly-research-loop`'s own `references/project-layout.md`
and `references/handoffs.md`.

## How the assistant picks a skill

The assistant does not read every skill's full instructions on every turn.
The system prompt carries a short "research workflow map": every enabled
skill's id, name, phase, and description, grouped by phase, with a rule that
for a research task spanning more than one step it should call `load_skill`
on `oleafly-research-loop` first and follow the handoff it names, and that it
should never say it is using a skill before it has actually loaded one.

`load_skill({"id": "..."})` returns the skill's full instructions, its
absolute directory on disk, the list of files inside it with their sizes, and
one ready to run command per bundled script, with the interpreter resolved to
an absolute path from `/usr/bin`, `/bin`, `/usr/local/bin`, or
`/opt/homebrew/bin`. `read_skill_file({"id": "...", "path":
"references/handoffs.md"})` reads one of those files. A bundled script is run
with `run_command` and the command `load_skill` listed for it, for example
`python3 "<skill dir>/scripts/search_openalex.py" --help`. Python scripts need
Python 3.11 or newer, which the assistant checks once per session before
relying on them and falls back to the native project tools when it is missing.

The MCP server in Settings and the research bridge that CLI agents and
research tasks talk to build that payload from the same function in
`src-tauri/src/skills.rs`, so a skill loads the same way whichever one asked
for it. The assistant's own `load_skill` puts the same fields in its answer as
text rather than JSON.

## Invoking a skill directly

Type `/` in the composer and a "Skills" group appears after the built-in
commands, listing every skill that is not broken, searchable by id, name, or
description, whether or not it is turned on. Picking one, or typing its id
yourself, inserts `/<skill-id> ` at the start of your message. Send it and
that skill is used for that message even if it is off in Settings; the
assistant is told directly to use it and gets its full instructions up front
instead of deciding to load it partway through.

```
/oleafly-literature-sweep what has been published on graph neural network expressivity since 2023
```

```
/oleafly-slides-and-posters a 15 minute talk from this paper for a conference audience
```

```
/oleafly-pre-submission check this manuscript for NeurIPS
```

A skill command that matches an installed skill turns blue in the composer as
you type, so you can tell a real one from a typo before you send. If nothing
matches what you typed after the slash, no menu appears and the message goes
out as plain text.

## Pointing the assistant at files and folders

Type `@` and a list of the project's files and folders opens, filtered as you
keep typing and ordered so the closest match to the file name comes first.
Pick one with the arrow keys and Enter, or keep typing the path yourself. A
mention that resolves to a real path turns violet in the composer. When you
send, the file's content travels with the message (the first 200 KB, with a
note when it was cut) and a folder mention sends a listing of what is inside
it, so the assistant can answer without a round of read_file calls first.
Both kinds of mention show as small chips in your message in the transcript.

```
Tighten the argument in @sections/related-work.tex and keep every citation
```

```
Which of the plots in @figures/ are referenced from the text
```

## Device-wide and per-project

The switch next to a skill's name in Settings turns it on for every project on
this device. Open a project and a second, smaller switch appears under it,
"Use in this project". That one is an override rather than a separate setting.
Until you touch it the line under it reads "Inherits device setting" and the
project follows the device-wide switch. Flip it and the project keeps its own
answer, on or off, whatever the device switch says later; the line then reads
"On for this project" or "Off for this project", and a **Use device setting**
button beside it drops the override again.

So a skill you turn on once is on everywhere, and a project has to say no
before it stops being available there. The chat assistant, research tasks, and
the tools CLI agents get all read the same two settings in the same order:
the project's override if it has one, the device switch otherwise.

A skill you have never seen before (one just installed, or one that shipped
with an app update) starts turned on. Settings remembers only the ones you
switch off.

## Updates for edited built-ins

A bundled skill you have not touched updates itself the next time Settings
loads its list, quietly, with no prompt. One you edited, or that an app
update has since moved past, gets an **Update** button instead: it appears
whenever the pack version recorded when the skill was installed no longer
matches the pack version shipping with this build. Update replaces the
skill's files with the current bundled version and discards any local edits
to them, which is why it asks you to confirm first.

## The domain shelf

The "Domain shelf" card in Settings fetches its list from
`cdn.oleafly.com/catalogs/skills.json`, cached locally and refreshed once a
day, or on demand with the card's **Refresh** button. Install downloads that
skill's archive, checks its size and checksum, and unpacks it into your
skills folder; a progress line tracks the download and the unpack. Uninstall
removes it. With no network reachable, the card keeps showing the last
catalog it fetched and says "Cached catalog from cdn.oleafly.com, last
fetched ..., could not reach the network"; if there is no cache yet it falls
back to the catalog bundled with the app and says "Built-in catalog, could
not reach the network" instead of failing outright. A shelf skill you already
installed keeps working offline exactly like any other skill.

## Sharing with other agents on this computer

If Claude Code, Codex, Cursor, or Gemini's own skills folder already exists
on this machine (`~/.claude`, `~/.codex`, `~/.agents`, `~/.cursor`, or
`~/.gemini`), the "Share skills with other agents on this computer" card in
Settings links every valid Oleafly skill into that agent's `skills/`
subfolder as a symlink pointing back at `~/.oleafly/skills/<id>`, so a skill
you write once in Oleafly shows up for that other agent too, without a copy
to keep in sync. The card lists each detected agent with how many of your
skills are currently linked into it. Turn the switch off and the links are
removed. On Windows, creating a symlink can require Developer Mode or an
administrator session; when it is not permitted the card marks that agent
"Not supported on this system" rather than falling back to copying files.

## How a CLI agent gets to your skills

Switch the assistant to a CLI agent and your skills reach it two ways.

The symlinks above are one. They are on by default and they cover every valid
skill whatever its switches say. Because they land in the folder that agent
already reads, Claude Code or Codex picks a skill up through its own
machinery, with no help from Oleafly.

The research MCP bridge is the other. Every CLI agent session Oleafly starts
gets it, and it carries three tools. `list_skills` returns each installed
skill with its id, name, description, phase, tier, and whether it is available
in this project. `load_skill` returns one skill's instructions, folder, files,
and script commands, and refuses a skill the project has turned off.
`read_skill_file` reads one file out of a skill folder. The bridge is the route
that knows which project you have open, so it is the one that respects the
switches.

There is no slash command in the CLI agent composer. Typing `/some-skill`
there sends those characters to the agent as text. Ask for the skill by name
instead, or leave the agent to find it through `list_skills`.

## Skills in research tasks

A research task carries whichever skills were picked for it, and it checks
them when it starts. Each one has to be available in the project, which means
the project turned it on or the project is inheriting a device switch that is
on. If the project has turned one off the task stops there, before any model
call, and says which skill.

Each selected skill goes into the task prompt with its name, its folder, the
command for every bundled script, the list of supporting files, and the full
instructions. The folders are mounted read-only in the task command sandbox
too, so a script runs where it lives, by absolute path, and the task cannot
write back into it. Supporting files come through the bridge's
`read_skill_file`, the same as anywhere else.

## Where skills live on disk

- `~/.oleafly/skills/<id>/`: one folder per skill, containing its `SKILL.md`
  and any `references/`, `scripts/`, or `assets/` subfolders.
- `~/.oleafly/skills/<id>/.oleafly-skill.json`: written for every bundled or
  shelf-installed skill. It records the skill's source, its pack and pack
  version, a hash of its file tree, its license and tier, and where it came
  from.
- `~/.oleafly/skills-state.json`: which skills are on device-wide, which
  projects have overridden a skill on, which have overridden one off, and
  which ids have already been seen once (so a newly discovered skill can start
  enabled without re-enabling everything on every launch). A project with no
  entry in either override map inherits the device-wide answer.
- `~/.oleafly/catalogs/skills.json`: the cached domain-shelf catalog.

## The show_location preview tool

`show_location({"path": "...", "line": 12})` reveals a project file at that
line in the editor. Add SyncTeX and it also moves the PDF preview to the
matching spot; pass only `page` and it jumps the PDF preview to that page
without touching the editor. This is what lets a skill point you straight at
the thing it just did, or the thing it wants you to look at, instead of
telling you to go find it.

## Verify it yourself

- Open **Settings → AI → Skills** and confirm the phase groups (Research,
  Authoring, Figures, Review, Submission, Communication, Your skills, Domain
  shelf) each list skills.
- Type `/` in the chat composer and confirm a **Skills** group appears below
  the built-in commands.
- Send `/oleafly-research-loop <anything>` and watch the tool call list for a
  `load_skill` card before the assistant starts working on your request.
- Ask a multi-step research question without a slash command (for example,
  "find recent papers on X and draft a related work section") and confirm
  `load_skill` is called before any file is read or written.
- Install a skill from the Domain shelf card and confirm it appears in its
  phase group above once installed.
- With a project open, confirm every skill's per-project line reads "Inherits
  device setting", turn one off for that project, and confirm the assistant
  stops offering it there while a second project still has it.
- Press **Use device setting** on that skill and confirm the line goes back to
  "Inherits device setting" and the switch follows the device-wide one again.
- Create a research task from one of the starters and confirm it reaches
  Running instead of failing with a message about the skill.
- With Claude Code, Codex, Cursor, or Gemini's folder present on this
  machine, turn on skill sharing and check `~/.claude/skills` (or the
  matching folder) for a symlink per skill.
- Edit a bundled skill's `SKILL.md` on disk, reopen Settings, and confirm it
  now shows an **Update** button instead of updating silently.
- Start a run, use **Steer now** on a queued follow-up, and confirm the chip
  reads "Steered into the running turn" and a "Steered" label appears on that
  message once it lands; steer one after the run has already finished and
  confirm it is sent automatically as the next turn instead of showing an
  error.

## Licensing

The 20 vendored skills are MIT licensed, copyright K-Dense Inc.; the full
notice, the pinned commit, and the list of which skills it covers is at
`src-tauri/resources/licenses/scientific-agent-skills-LICENSE.md`. A handful
of upstream scripts are excluded from the vendored copies rather than shipped
and disabled: the OpenRouter-backed schematic and slide-image generators walk
parent directories reading `.env` files for an API key, which does not fit
how Oleafly handles credentials, and Oleafly already routes figure
generation through its own pipeline. The excluded files and the reason for
each are recorded in `scripts/skills/kdense-manifest.json`.

## Troubleshooting

| Symptom | What is happening |
|---|---|
| A vendored skill's scripts fail or the assistant skips them | Python 3.11 or newer is not on the login shell's `PATH`. The assistant falls back to native tools and says so; installing a current Python fixes it. |
| The Domain shelf says "could not reach the network" | `cdn.oleafly.com` was not reachable. The line says whether you are looking at the cached catalog or the built-in one. Already-installed shelf skills still work; try **Refresh** again once you are online. |
| A share target reads "Not supported on this system" | Symlink creation failed, most often Windows without Developer Mode or an administrator session. Skills still work inside Oleafly; only the cross-agent link is unavailable. |
| A skill in Settings is marked **Invalid** | Its `SKILL.md` is missing, unreadable, over the size limit, or missing a name, description, or instructions. The message under it names the exact problem; a bundled skill can be restored with **Update**, a skill you wrote needs a fix in the editor. |
