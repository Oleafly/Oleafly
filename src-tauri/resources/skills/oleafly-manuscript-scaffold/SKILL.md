---
name: Manuscript scaffold
description: Build a venue-shaped manuscript skeleton inside the open Oleafly project. Use when the user wants to start a paper, set up a NeurIPS, ICML, ICLR, ACL, CVPR or AAAI submission, an IEEE or ACM conference paper, an Elsevier or Springer journal article, a PLOS, Nature or medical manuscript, an arXiv preprint or a thesis chapter, or asks for main.tex plus sections and a bibliography, or wants an existing draft reshaped to a venue layout.
license: MIT
compatibility: Needs an open Oleafly project with a LaTeX or Typst engine. Nothing else is required. Verification with verify_pdf_pages needs PDF page capture enabled in Settings.
allowed-tools: read_file write_file create_file replace_in_file rename_file list_files search_project project_map set_main_doc compile get_log get_pdf_text verify_pdf_pages update_todos remember_note load_skill read_skill_file
metadata:
  version: "1.0.0"
  skill-author: Oleafly
  oleafly:
    tier: native
    phase: authoring
    tools:
      - read_file
      - write_file
      - create_file
      - replace_in_file
      - list_files
      - project_map
      - set_main_doc
      - compile
      - get_log
      - get_pdf_text
      - verify_pdf_pages
      - update_todos
      - load_skill
      - read_skill_file
---

# Manuscript scaffold

Turn an empty or half-formed project into a manuscript skeleton that compiles, matches the target venue's shape, and is ready for real writing.

## Scope

This works **inside the project that is already open**. Oleafly gives the assistant no tool that creates a project or instantiates a template, so if the user wants a separate project, say so plainly and point them at New Project in the app; then continue here once it is open.

Everything below writes ordinary files with `create_file` and `write_file`, switches the compile entry point with `set_main_doc`, and proves the result with `compile`.

## 1. See where you are writing

1. `list_files` to get the current tree.
2. `read_file` on `project.json`. The fields that matter are `engine` (`xetex` for bundled Tectonic, `latexmk` for a system TeX distribution, `typst`, `markdown`) and `main_doc`.
3. If the project already has content, `project_map` shows sections, labels, bib keys and unresolved citations. Never overwrite existing work: either extend it, or write the skeleton alongside it and ask which one becomes the main document.

Record a short plan with `update_todos` if the scaffold has more than three steps.

## 2. Resolve the target

Ask for anything you cannot infer from the project or the conversation:

- venue or journal, and the exact track or article type;
- year or submission cycle;
- stage: initial submission, revision, camera ready;
- anonymity: blind, double blind, or open;
- engine preference, if the user has one.

Do not blend rules from two venues that share a name. If the user does not know the venue yet, build the generic article scaffold and say it is provisional.

## 3. Read the venue guidance before writing

`load_skill` with id `venue-templates`, then pull the reference that matches the family with `read_skill_file`. The map:

| Venue family | Reference to read |
|---|---|
| NeurIPS, ICML, ICLR, CVPR, ECCV, ICCV | `references/ml_conference_style.md` |
| ACL, EMNLP, NAACL, CHI, KDD, WWW, SIGIR | `references/cs_conference_style.md` |
| Any annual conference, for rules and official links | `references/conferences_formatting.md` |
| Elsevier, Springer, IEEE journals, general journals | `references/journals_formatting.md` |
| Nature, Science, PNAS, Nature Communications | `references/nature_science_style.md` |
| Cell, Neuron, Cell Reports | `references/cell_press_style.md` |
| NEJM, Lancet, JAMA, BMJ | `references/medical_journal_styles.md` |
| Grant narratives | `references/grants_requirements.md` |
| Posters | `references/posters_guidelines.md` |

Its bundled scaffolds are readable the same way: `assets/journals/neurips_article.tex`, `assets/journals/nature_article.tex`, `assets/journals/plos_one.tex`, `assets/journals/elsarticle-template-num.tex` (also `-num-names` and `-harv`), `assets/posters/beamerposter_academic.tex`, `assets/grants/nsf_proposal_template.tex`, `assets/grants/nih_specific_aims.tex`.

Two rules from that skill carry over unchanged: a bundled scaffold is not an official template, and page limits or style file names must come from the venue's current author instructions rather than from memory. When the user needs the official kit, tell them to download it and drop it into the project.

`references/venue-map.md` in this skill maps each family to a starting file, an engine, and a bibliography style, including which Oleafly asset to use when no vendored scaffold fits.

## 4. Choose the engine deliberately

| Situation | Engine | How |
|---|---|---|
| Default for LaTeX | `xetex`, bundled Tectonic | main document ends in `.tex` |
| Needs minted, pythontex, glossaries, shell escape, or a publisher class Tectonic cannot orchestrate | `latexmk` | the user switches in Settings, the assistant cannot |
| Typst manuscript | `typst` | main document ends in `.typ` |
| Prose-first draft, Pandoc pipeline | `markdown` | main document ends in `.md` |

`set_main_doc` switches the engine automatically from the extension, so pointing at `main.typ` moves the project to Typst. Never write `pdflatex` anywhere; Oleafly does not accept it as an engine name and a project or template that declares it is dropped silently.

Typst limits to say out loud before you commit to it: no SyncTeX, no isolated figure compile, no conversion exports, and `@preview` packages need network on first compile. Prefer built-in Typst features for anything that must work offline.

## 5. Write the skeleton

Standard layout, adjusted to the venue:

```
main.tex
sections/introduction.tex
sections/related-work.tex
sections/method.tex
sections/experiments.tex
sections/conclusion.tex
references.bib
figures/
```

Steps:

1. `read_skill_file` the scaffold you picked (from `venue-templates/assets/...` or from this skill's `assets/`).
2. `create_file` the `sections/` and `figures/` folders.
3. `write_file` `main.tex` with the preamble, title block, abstract, and one `\input{sections/...}` per section.
4. `write_file` each section file with a `\section{...}`, a `\label{sec:...}`, and one or two sentences of placeholder prose that names what belongs there. Do not write filler that could be mistaken for real claims.
5. `write_file` `references.bib` with the entries the user already has, or an empty file with a single comment-free placeholder entry removed before compile. Never invent bibliographic data.

This skill's own scaffolds, in `assets/`:

| File | Use |
|---|---|
| `assets/article.tex` | Single-column article, Tectonic-safe, the default when no venue is fixed |
| `assets/ieee-style-two-column.tex` | Two-column IEEEtran conference layout |
| `assets/article.typ` | Typst article with abstract, numbered sections, equation, and table |

Each of the three compiles on its own with Tectonic's bundle (or the pinned Typst CLI), so copy one in first, compile, and only then split the section bodies out into `sections/*.tex` and replace them with `\input`.

Bibliography ordering trap: `IEEEtran.bst` builds a broken `.bbl` when nothing is cited yet, so the IEEE scaffold ships without the two bibliography lines. Add `\bibliographystyle{IEEEtran}` and `\bibliography{references}` once `references.bib` holds at least one entry that the text actually cites. `plainnat` tolerates an empty bibliography, which is why `assets/article.tex` keeps its bibliography lines from the start. Typst's `bibliography("references.bib")` fails on an empty file for the same reason, so add that line with the first entry too.

House style while writing LaTeX: one sentence per source line, `~` before every `\ref` and `\cite`, `\cref` from cleveref for cross-references, booktabs for tables, caption above tables and below figures, `\label` after `\caption`, `\[...\]` rather than `$$...$$`, `align` rather than `eqnarray`.

## 6. Point the compiler at it

Call `set_main_doc` with the new main document. Skip this only when the project already compiles from that exact path.

## 7. Compile and verify

1. `compile`. Success looks like `success: true` with an empty `errors` list.
2. On failure, `get_log` for the tail and hand the loop to **oleafly-latex-build** rather than guessing here.
3. On success, confirm the shape: `get_pdf_text` to check that the title, abstract and section headings landed, and `verify_pdf_pages` when you need to see the layout (two columns, page count, a title block that has not collided). `verify_pdf_pages` is off unless the user enabled PDF page capture in Settings; if it returns unavailable, use `get_pdf_text` and say what you could not check.

## 8. Seed the research layout

Create `research/sources/` and `research/notes/` so literature work has somewhere to land, matching **oleafly-research-loop**. Add a one-line `research/notes/README.md` naming what goes where. Skip this if those folders already exist.

## 9. Hand off

- Prose, evidence discipline, IMRaD structure, reporting guidelines: **scientific-writing**.
- Literature and citation keys: **oleafly-literature-sweep** and **citation-management**.
- Figures: **oleafly-figure-prep**.
- Compile failures: **oleafly-latex-build**.
- Turning the finished shell into something reusable: **template-generate**.

## Failure handling

| Problem | What to do |
|---|---|
| No project is open | Say so and stop. There is no tool that opens or creates one. |
| The project already has a manuscript | Do not overwrite. Offer to extend it or to write the scaffold under a new name. |
| The venue is unknown | Build `assets/article.tex`, label it provisional, and list what you would change once the venue is fixed. |
| A class or package is missing from Tectonic's bundle | Say which one, offer the closest bundled substitute, and note that a system TeX distribution can install it. |
| Compile fails after the scaffold lands | Do not delete files to make it pass. Diagnose with oleafly-latex-build. |
| The user wants the official venue kit | Ask them to download it into the project; do not recreate proprietary style files. |

## Artifacts

`main.tex` or `main.typ`, `sections/*`, `references.bib`, `figures/`, `research/sources/`, `research/notes/`, and a compiled PDF.

## Done when

- [ ] Venue, track, stage and anonymity are recorded or explicitly marked unknown
- [ ] The engine is set and the extension matches it, and `pdflatex` appears nowhere
- [ ] `main.tex` (or `main.typ`) inputs every section file
- [ ] `references.bib` exists and contains no invented entries
- [ ] `set_main_doc` points at the new main document
- [ ] `compile` returns success with an empty error list
- [ ] The PDF was checked with `get_pdf_text`, and with `verify_pdf_pages` when it was available
- [ ] `research/sources/` and `research/notes/` exist
- [ ] The next skill is named for the user
