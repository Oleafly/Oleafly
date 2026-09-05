---
name: oleafly-related-work
description: Draft or revise a related-work, background, or prior-art section in which every citation key already exists in the project bibliography. Use when the user asks to write related work, expand the background, group prior work by theme, position their contribution against existing work, or repair a section full of unresolved citations. Checks project_map unresolvedCites, adds verified entries before writing, and compiles until nothing is left unresolved.
license: MIT
compatibility: Needs a project with a bibliography and an engine that can compile. project_map is offered only when the engine advertises a document index, and this skill falls back to search_project.
allowed-tools: project_map search_project project_library_search read_file write_file replace_in_file create_file compile get_log get_pdf_text verify_citation update_todos load_skill
metadata:
  version: "1.0.0"
  skill-author: "Oleafly"
  oleafly:
    tier: native
    phase: authoring
    tools:
      - project_map
      - search_project
      - project_library_search
      - read_file
      - write_file
      - replace_in_file
      - create_file
      - compile
      - get_log
      - get_pdf_text
      - verify_citation
      - update_todos
      - load_skill
---

# Oleafly Related Work

A related-work section has one job: show where this work sits among what already exists, and why the gap it fills is a real gap. It is an argument, not an annotated bibliography. Paragraphs that open "Smith et al. proposed..." and close "...achieved good results" are a list with margins.

**The hard rule of this skill: never write a citation key that is not already in the project bibliography.** Not as a placeholder, not with a comment saying to fix it later, not because the paper obviously exists. An invented key either fails to compile or renders as a question mark that survives to submission. If you want to cite something that has no entry, stop and add the entry first (step 4).

## Step 1. Establish the target

Answer these before writing a sentence. Ask when you cannot infer it.

- Which file. `search_project` with `{"query": "Related Work"}` or `{"query": "\\section{Related"}` finds an existing section. `project_map` with `{}` returns `sections` with file and line for each, and `files` for the project structure.
- Whether this is a new section, a rewrite, or a repair of an existing one. A rewrite of the user's prose needs their agreement first.
- The length budget. Related work is where page limits get lost. Ask for a paragraph count or a page fraction if the venue is tight.
- The markup. LaTeX, Typst and Markdown cite differently and the wrong syntax fails silently in two of the three. See `references/citation-syntax.md`.

Set the plan with `update_todos`.

## Step 2. Inventory what you can cite

Three sources, in this order.

1. `project_map` with `{}`. Read `bibKeys`, which is the exact set of keys you are allowed to use, and `unresolvedCites`, which is the set of keys the document already cites with no entry behind them. A non empty `unresolvedCites` is a bug in the document and part of your job.
2. `read_file` with `{"path": "research/reading-list.md"}`. If a sweep ran, this is the thematic grouping already done, with a "why it matters" sentence per paper that is the seed of your prose. If the file does not exist, the sweep has not run: consider handing off to `oleafly-literature-sweep` before drafting, and say so.
3. `project_library_search` with `{"query": "<topic>"}` surfaces anything the user already wrote about this prior work elsewhere in the project, which you should not contradict.

When `project_map` is not offered, `read_file` the bibliography directly and take the keys from the `@type{key,` lines. `search_project` with `{"query": "@"}` locates them if you do not know the path.

## Step 3. Group by theme, then order the themes

Group the papers by the question they answer, not by year and not by author. Three to five themes is the usual shape for a conference paper. Each theme becomes one paragraph, occasionally two.

Order the themes so that the last one is closest to this work. The section should narrow as it goes, ending where the contribution begins, so the transition into the next section needs no announcement.

Write the grouping down before you write prose. A three column sketch is enough: theme, the papers in it, the one sentence that paragraph must land.

Common groupings that work: by approach family (what they do), by the assumption they make (what they require), by the limitation they share (why the gap exists). The last one is the strongest when the paper's contribution is removing that limitation.

## Step 4. Close the citation gaps before writing

Now, not later. For each paper you intend to cite that is not in `bibKeys`:

1. `verify_citation` with `{"doi": "<doi>"}`, or `{"title": "<exact title>"}` when there is no DOI.
2. A `verified: false` result means the paper is not confirmed. Do not cite it. Either drop the point or find a source that does verify.
3. Append the returned BibTeX to the bibliography. Read the file first with `read_file`, then `replace_in_file` anchored on the last entry. Never `write_file` over an existing bibliography.
4. `compile` with `{}` to confirm the file still parses.

If more than three or four entries are missing, this is a sweep, not a gap. Hand off with `load_skill` and `{"id": "oleafly-literature-sweep"}` so the papers get source notes and provenance rather than bare entries.

For keys already sitting in `unresolvedCites`, work out which is true: the entry is missing (add it as above), or the key is misspelled in the prose (fix the prose, do not add an entry to match a typo). `search_project` with `{"query": "<the key>"}` shows every use.

## Step 5. Write

Use the skeleton in `assets/` for your markup. Write with `write_file` for a new section file, or `replace_in_file` anchored on the existing section heading for a rewrite. For a rewrite, `read_file` the current text first: the user's own framing and terminology should survive your edit.

What a paragraph does, in order: name the approach family, say what those works achieve, say precisely what they do not handle, and connect that to this work. The fourth part is what makes it an argument.

Rules that keep it honest:

- Every claim about what a paper does or does not do must come from the source note or the paper itself, not from the title. Titles overstate.
- Cite at the point of the claim, not in a heap at the end of the paragraph. A trailing block of six keys tells the reader nothing about which paper supports which half of the sentence.
- Name a limitation, do not insinuate one. "Does not scale" is a criticism. "Evaluated only up to 10k nodes" is a fact.
- No superlatives about the user's own work in this section. It positions; it does not sell.
- Do not summarise a paper you have not read past its abstract. If the reading list marks it `to read`, either read it with `read_file` on its source note, or leave the claim general enough to be supported by the abstract.
- Keep the user's terminology. If they call it a "manifold prior" throughout, do not switch to "geometric prior" here.

Write the section, then reread it once asking a single question: if these paragraphs were deleted, what would the reader not understand about the contribution? If the answer is nothing, the section is a list and needs the fourth part of each paragraph.

## Step 6. Compile and verify

1. `compile` with `{}`. On failure, `get_log` with `{}`, fix, compile again.
2. `project_map` with `{}`. `unresolvedCites` must be empty. If it is not, every key in it is either a missing entry or a typo, and both are yours to fix.
3. `get_pdf_text` with `{}`. Read the rendered section. This is the step that catches what compiles but is wrong: a citation rendering as `[?]`, an entry rendering with the wrong year, a paragraph that ran to three pages, a bibliography that lost an author list.

A citation that resolves at compile time can still render as a question mark if the bibliography style dropped the entry. The PDF text is the only place that shows up.

## Step 7. Hand off

- The prose needs a quality pass for structure, hedging and reporting standards: `load_skill` with `{"id": "scientific-writing"}`.
- The claims in the section need auditing against their sources one by one: `load_skill` with `{"id": "oleafly-verify-claims"}`.
- More papers are needed than the gaps you closed: `load_skill` with `{"id": "oleafly-literature-sweep"}`.
- The evidence in a specific paper needs appraising before you can characterise it fairly: `load_skill` with `{"id": "scientific-critical-thinking"}`.

## Failure handling

| What happened | What to do |
|---|---|
| `project_map` is not offered | The engine has no document index. Read the bibliography with `read_file` and take keys from the `@type{key,` lines. Verify with `compile` and `get_pdf_text` instead |
| A key you want is not in `bibKeys` | Step 4. Never write it and fix later |
| `verify_citation` cannot confirm a paper | Do not cite it. Rewrite the point around a source that verifies, or drop it |
| `compile` fails after a bibliography append | The entry is malformed. `get_log`, fix the entry, compile again. Do not comment out the citation to make the build pass |
| `unresolvedCites` still lists a key after your edit | Either the entry did not land or the prose spells the key differently. `search_project` on the key shows both sides |
| A citation renders as `[?]` in `get_pdf_text` | The entry exists but the style rejected it, usually a missing required field. Check the entry against the minimum fields for its type |
| The user asks you to cite a paper you cannot find | Say you could not verify it. Ask for a DOI or a link. Do not write the key |

## Done when

- [ ] Every citation key in the section appears in `bibKeys`.
- [ ] `unresolvedCites` is empty.
- [ ] Every entry added this session came from `verify_citation`.
- [ ] Each paragraph names an approach family, what it achieves, what it does not handle, and how that connects to this work.
- [ ] The themes narrow toward the contribution, and the last one is the closest.
- [ ] `compile` is green and the rendered section in `get_pdf_text` shows no `[?]` and no missing bibliography entries.
- [ ] The section fits the length the user asked for.

## Reference files

- `references/structure.md` covers grouping patterns, paragraph shapes, and the failure modes of each.
- `references/citation-syntax.md` covers cite commands per engine and how to detect which one the project uses.
- `assets/related-work-skeleton.tex`, `.typ` and `.md` are starting skeletons.
