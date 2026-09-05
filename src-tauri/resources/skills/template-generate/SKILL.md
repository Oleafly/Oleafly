---
name: Reusable template
description: Turn the current document into a reusable Oleafly template that follows the template pack authoring rules. Use when the user says make this a template, save this layout, reuse this format for future papers, build a starter for my group, or asks how to add a template to the New Project gallery or how to package a class or style for reuse.
license: MIT
compatibility: Needs an open Oleafly project. Installing the finished template into the gallery uses an approval-gated shell command to copy a folder into the user's data directory.
allowed-tools: read_file write_file create_file replace_in_file rename_file list_files search_project project_map set_main_doc compile get_log get_pdf_text verify_pdf_pages run_command load_skill read_skill_file
metadata:
  version: "1.0.0"
  skill-author: Oleafly
  oleafly:
    tier: native
    phase: tooling
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
      - verify_pdf_pages
      - run_command
      - read_skill_file
---

# Reusable template

A template is an editable starter project, not a snapshot. It has to compile on a clean machine, with no system fonts, no downloads, and no content that belongs to one particular paper.

## What the assistant can and cannot do

It can write the template files, generalize the content, and compile-check the result. It cannot install the template into the gallery: there is no tool that saves a custom template or creates a project from one. The last step is a folder copy the user approves, and then they create the project themselves from the Templates view. Say that up front so nobody waits for a gallery entry that never appears.

## 1. Read the rules before generalizing

`read_skill_file` this skill's `references/authoring-rules.md`. It is the authoring contract in full: the manifest schema, the eight hard rules, the engine strings, and the naming rule for venue look-alikes. The short version:

- LaTeX templates must compile on Tectonic's default TeX Live bundle. Only packages that exist there.
- No `\write18`, no shell escape, no system fonts through `fontspec`, no external or remote images.
- Typst templates must not import remote `@preview` packages. Built-in features only.
- Engine string is `xetex` for LaTeX, `typst`, or `markdown`. Never `pdflatex`. A template that declares `pdflatex` is dropped from the gallery without an error message.
- No em dashes anywhere in the template's text.
- Filler content must be realistic and tasteful. No lorem ipsum, no real people's data.
- A template that resembles a known venue or design is named with `-style`, and its proprietary class or style files are never copied. Recreate the look with standard packages.

## 2. Decide what generalizes

`read_file` the current main document and `project_map` for its structure. Then split it into three buckets:

| Bucket | Example | What happens to it |
|---|---|---|
| Structure | `\documentclass`, geometry, packages, custom macros, section skeleton, table and figure styles | Keep exactly |
| Placeholder | title, authors, affiliation, abstract, section prose, table numbers, bib entries | Replace with realistic filler |
| This paper only | real results, real citations, private data, acknowledgements, funding lines, anything under `research/` | Remove |

If you are unsure which bucket something belongs in, ask. Shipping one author's real affiliation inside a shared template is the failure to avoid.

## 3. Placeholder conventions

Two styles, and consistency matters more than the choice:

**Direct filler.** Write plausible text straight into the document: a believable title, invented author names, a coherent two-sentence abstract. Best for templates a person edits by hand, which is most of them.

**Named macros.** Define them once at the top of the preamble and use them in the body:

```latex
\newcommand{\PaperTitle}{Working title}
\newcommand{\PaperAuthor}{Author One}
\newcommand{\PaperAffiliation}{Institution}
```

Best when the same value appears several times. Keep every definition in one block so a user finds them all at once.

Whichever you choose:

- Never leave `TODO`, `FIXME`, or `XXX` in a shipped template.
- Keep every label, cross-reference and citation resolvable, so the starter compiles with zero warnings about undefined references.
- If a bibliography is included, ship a `refs.bib` with real, verifiable entries, or ship no bibliography at all. `IEEEtran.bst` and Typst's `bibliography()` both fail on an empty bibliography.

## 4. Build the template folder

Inside the project, so the user can see it before it goes anywhere:

```
templates/<template-id>/
  template.json
  main.tex           (or main.typ, main.md)
  refs.bib           (optional)
  README.md
```

`<template-id>` is kebab-case and must equal the folder name exactly, or the app skips the folder without saying why. It also must not collide with a bundled or pack template id.

1. `create_file` the folder.
2. `write_file` the generalized main document.
3. `write_file` `template.json` starting from `assets/template.json` in this skill.
4. `write_file` `README.md` starting from `assets/README.md` in this skill.

`preview.png` is optional. The gallery falls back to a card with no image when it is absent. There is no tool that renders one, so either leave it out or let the user generate it.

Three files stay behind when a project is created from the template: `template.json`, `preview.png`, and `LICENSE`. Everything else is copied, `README.md` included, so write that README for the person starting a paper rather than for the person maintaining the template.

## 5. Compile-check it

The template has to build on its own, not just inside the project it came from.

1. `set_main_doc` to `templates/<template-id>/main.tex`. This also switches the project engine to match the extension, which is why the extension has to be right.
2. `compile`. It must return `success: true` with an empty `errors` list and no undefined references.
3. `get_pdf_text` and, when PDF page capture is enabled, `verify_pdf_pages` on page 1. Page 1 is what the gallery preview shows, so it has to look finished and representative.
4. `set_main_doc` back to the project's original main document. Do not skip this. Read `project.json` first if you are unsure what it was.

Compile failures go to **oleafly-latex-build**. Do not delete parts of the template to make it pass.

## 6. Install it

Custom templates live at `~/.oleafly/templates/custom/<template-id>/`. That path is searched last, after bundled templates and downloaded packs, and a bundled or pack id always wins, so a colliding id makes the custom template invisible.

Offer the copy and let the user approve it:

```
mkdir -p ~/.oleafly/templates/custom && cp -R templates/<template-id> ~/.oleafly/templates/custom/
```

On Windows the equivalent is a `Copy-Item -Recurse` into `%USERPROFILE%\.oleafly\templates\custom\`.

`run_command` needs approval, runs in the project directory, and has no sandbox, so show the exact command and say what it does before asking.

Then tell the user: open New Project, and the template appears under the category named in the manifest. The gallery re-reads the folder each time it opens, so no restart is needed. If it does not appear, the usual causes are an id that does not match the folder name, a missing main document, an engine string the app does not accept, or an id already taken by a bundled template.

## 7. Contributing it back

If the user wants the template in the shared catalog rather than only on their machine, it goes to the `template-packs` repository under `packs/<pack-id>/<template-id>/`, where the preview is generated by the repository's own tooling and every template must compile before it is merged. Point them at that repository's authoring guide; do not try to write into it from here.

## Failure handling

| Problem | What to do |
|---|---|
| The document depends on a package outside Tectonic's bundle | Say which one and either substitute or stop. A template that cannot compile on a clean machine is not a template |
| The document uses system fonts | Replace with a bundled font package (`lmodern`, `libertine`, `sourcesanspro`, `charter`, `biolinum`), or bundle the font files in the template folder with their license and point `fontspec` at `Path=./fonts/` |
| The document uses a publisher's class file | Do not copy it unless its license clearly allows redistribution. Recreate the look with standard packages and name the template with `-style` |
| The engine is `latexmk` | The template still declares `xetex` or `typst`. New projects are created on Tectonic regardless of what the manifest says, because the engine is derived from the main document's extension. Say so plainly if the source needs system TeX |
| The id collides | Pick another. A bundled or pack id silently shadows a custom one |
| The user wants the assistant to install it | It cannot. Offer the copy command, or tell them where to drop the folder |

## Artifacts

`templates/<template-id>/` with `template.json`, the main document, an optional `refs.bib`, and `README.md`, plus a compiled PDF proving it builds.

## Done when

- [ ] The folder name equals the manifest `id`, and that id is not taken
- [ ] The engine string is `xetex`, `typst`, or `markdown`, and the main document's extension matches
- [ ] Nothing from the original paper survives: no real results, no real affiliations, no private data
- [ ] Filler content is realistic and free of `TODO` markers and em dashes
- [ ] No system fonts, no external images, no shell escape, no remote `@preview` imports
- [ ] `compile` returns success with an empty error list, from the template's own main document
- [ ] Page 1 was looked at and is representative
- [ ] The project's original main document was restored with `set_main_doc`
- [ ] The user knows the exact copy command and where the template appears afterwards
