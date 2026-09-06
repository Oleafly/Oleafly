# AI Copilot

The AI Copilot is a project-aware assistant. It is an optional layer over the
same file, compile, index, and preview operations available to the application;
it is not a second document model.

## Implemented capabilities

- Read project files and search across the active project.
- Create, edit, rename, and delete files through an approval-gated diff.
- Compile the project, inspect logs, and extract PDF text.
- Query project structure, labels, citations, macros, and file relationships.
- Explain or repair compiler errors.
- Add citations and generate or refine editable TikZ figures.
- Generate a template or figure when a configured provider supports it.
- Use a hosted provider, an OpenAI-compatible endpoint, or Ollama locally.
- Chat prompt shortcuts for **Friendly** and **Fire** paper review (mentor-style
  feedback and strict Reviewer #2 critique of the current document).

## Change and approval model

- File-changing actions produce a visible diff before application.
- Ordinary writes can be approved for the current session according to the
  selected policy.
- Deletes remain separately visible and can require an explicit confirmation.
- Tool results are scoped to the project and are not an authorization to read
  unrelated local files.

Plan mode (the Plan button, or the Enable Plan Mode slash command) makes the
assistant plan first. While it is on, the assistant can read and search the
project, but no tool that writes a file, compiles, or runs a command is
offered to it. If the model calls one anyway, the call is refused with a note
telling it to put that step in the plan instead, so a request that needs an
edit or a compile still ends up in the checklist rather than in an apology
about missing tools. The small info icon next to the Plan button says as much,
and reminds you that turning Plan off gives the assistant every tool directly.

While a plan is waiting, or a run is working through one, a pill sits centred
above the composer. It reads PLAN, then STEP x/N once there is a checklist,
then REVIEW with the added and removed line counts once files have changed.
Hover over the pill, or click it (Tab reaches it too), and a panel opens above
it with the checklist, an Awaiting approval or Approved badge, and the changed
files. Approve plan and Revise live in that panel while approval is pending,
and the panel opens on its own the moment a plan or a revision lands so those
buttons are in view without hovering. Escape, a click on the pill, or a click
anywhere else closes it, and it stays closed until the next plan arrives.
Approve plan runs the checklist under whatever approval mode
the project already uses, so Ask for approval, Approve for me, and Full access
behave exactly as they do outside plan mode. Revise, or anything you type while
the plan is waiting, goes back as feedback and produces a fresh plan. Turn Plan
off and the pending approval is dropped, so the next turn is a normal one.

Once every item is done and the run has finished, the pill goes away. A short
summary appears under the last assistant message instead, along the lines of
"Plan · 2/2 done · 3 files changed +40 -12", with the file rows under it. A run
that changed files without a plan gets the same summary minus the Plan label.

## Figures

Ask for a figure in the ordinary chat. The assistant writes it as TikZ or
PGFPlots, compiles the picture on its own with `preview_figure`, and looks at
what came out. It keeps fixing and previewing again until the labels stop
overlapping and the spacing looks right. `insert_figure` puts the finished
picture at your cursor with a caption and a label, and `load_image` opens a
sketch you already have in the project so it can redraw it.

Those three tools only show up in a LaTeX project whose engine can compile a
figure by itself. They sit in the Tools popover under Figure, so you can turn
them off.

## Skills

Skills teach the assistant a repeatable workflow instead of leaving it to
improvise one. Oleafly ships with a research pack, and you can install more
from a domain shelf or write your own. Type `/skill-id` at the start of a
message to use one directly. [Skills](Skills.md) covers the format, the tiers,
the phase table that routes a research task to the right skill, and how the
assistant picks one without being told.

## Steering a running turn

A message sent while the assistant is mid turn does not have to wait for the
run to end. **Steer now** on a queued follow-up hands it to the running turn
at the next safe point. Once it lands it appears in the conversation as a
"Steered" message, and the assistant starts a fresh reply to it. If the run
finishes first, nothing is dropped: the message goes out as the next turn and
the chip says "Sent as the next turn".

## Models: trust, capability data, and refresh

Every model row in Settings, and every entry in the chat picker, has a trust
badge. Verified means we have run the assistant on that model and a tool call
came back. Untested means the provider lists it but nobody has tried it with
the assistant yet. Blocked means someone did, it failed in a way we can put
into a sentence, and that sentence is the badge's tooltip. Blocked models stay
in the picker so you can read why, but you cannot pick them for the assistant.
The labels come from a catalog the app also fetches from the CDN, which is how
a model that breaks can be blocked for everyone the same day, with no release
in between. No badge at all means the provider has not listed that model since
this version of the app was installed. Refresh on the provider card fetches
the list.

Beside the badge are a few chips from the model data snapshot: the context
window in short form (128k, 1M), Vision if the model takes images, Tools if it
can call them, Reasoning for reasoning models, and Deprecated once the provider
has retired it. The snapshot is a trimmed copy of models.dev, bundled with the
app and mirrored on the CDN. The bottom of the providers tab says when it was
generated and has its own Refresh. Chips attach to a model when its list is
fetched, so after refreshing the snapshot, refresh the provider too.

A model whose data says it cannot call tools is still fine for plain chat. The
composer says "Chat only, this model cannot use tools" while it is selected,
and the request goes out with no tools declared.

Refresh on a provider card is limited to one request every thirty seconds per
provider, and closing the card does not reset that clock. Afterwards the card
says how many models were added and removed, or "No changes", and an "Updated"
stamp shows when the list was last fetched. The list also refreshes by itself
once a day when you open the card, and every time you save a key. A failed
daily attempt still counts, so a provider that is down is left alone until
tomorrow or the next launch. The Refresh button is not held back by any of that
beyond the thirty seconds. If a provider answers with something the app cannot
read, the old list stays and the card says so rather than going blank. An empty
answer leaves the list alone as well. Models you typed in by hand survive every
refresh.

The first time you send a message to an untested model with tools on, the
composer shows "Checking this model" and runs one short tool call round trip
before the real request. If a tool call comes back, the model is marked
verified on this machine and the run goes ahead. If not, the composer shows the
reason and your message stays in the box. The verdict is saved in the app
config, so the check runs once per model per machine. A model blocked this way
gets a Check again link next to the notice, which is the way out if the failure
was a bad moment for the provider rather than the model. Chat-only models and
runs with every tool switched off skip the check.

Custom providers have an Edit action next to Remove. It opens the same dialog
used to add one, with the name and base URL filled in and the ID fixed.
Changing the base URL no longer requires re-entering the saved key: the dialog
shows a note that the key will be sent to the new address, and saving
refreshes the model list from there when it can.

## Provider and data boundary

Provider credentials are stored in encrypted app state and are never written
to project files. Hosted calls are opt-in. Local Ollama operation keeps model
traffic on the machine. The provider interface and model discovery code are
shared by the built-in assistant and figure-generation flows.

## Engineering anchors

- `packages/ai-core/`: provider interfaces and model discovery.
- `packages/ai-tools/`: tool contracts and host boundary.
- `src/lib/ai/` and `src/store/chats.ts`: assistant orchestration and history.
- `src/components/ai/prompt-shortcuts.ts`: chat prompt categories (including Review).
- `src/lib/document-citation/`: paper-review prompts and document citation scan.
- `src/contributions/ai-toolsets.ts`: registered tool groups.
- `docs/mcp.md`: external-client integration using the same tool boundary.
- `src-tauri/src/skills.rs` and `src/lib/skills.ts`: skill storage, validation, and prompt wiring.
- `docs/Skills.md`: the skills format, tiers, and research-loop phase table.
