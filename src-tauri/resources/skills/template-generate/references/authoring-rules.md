# Template authoring rules

These follow the `template-packs` authoring contract. A template that breaks any of them either fails to compile on someone else's machine or disappears from the gallery without an error.

## Folder layout

```
<template-id>/
  template.json      required
  main.tex           required, or main.typ / main.md
  refs.bib           optional
  fonts/             optional, only with the license text alongside
  README.md          recommended
  preview.png        optional, generated, never hand made
```

The folder name must equal the manifest `id` exactly. A mismatch makes the app skip the folder silently.

`template.json`, `preview.png` and `LICENSE` are template metadata and are not copied into a project created from the template. Everything else is.

## Manifest schema

```json
{
  "id": "kebab-case-id, equal to the folder name",
  "name": "Human Name",
  "category": "Journals & Conferences",
  "description": "One sentence, plain language, no em dashes.",
  "main_doc": "main.tex",
  "engine": "xetex",
  "ats_profile": null,
  "layout": "two-column",
  "pages": "multi",
  "default_color": "#5f3dc4",
  "license": { "spdx": "CC0-1.0", "author": "Your Name", "url": "" },
  "requires": { "packages": [], "fonts": [], "engine": "tectonic" },
  "order": 10
}
```

Only `id` and `name` are strictly required by the parser. Everything else has a default, but a template with no `category` or `description` looks broken in the gallery.

Categories the gallery understands: Journals & Conferences, Theses & Reports, CVs & Resumes, Assignments, Presentations, Posters, Letters, Books, Newsletters, Calendars, Bibliographies, Business, Creative. A category outside that list still lists, it just sorts oddly.

`layout` (`single-column`, `two-column`, `slides`, `poster`) and `pages` (`single`, `multi`) are informational. Nothing filters on them today.

`ats_profile` is only for resumes: `friendly`, `design-forward`, or `null`.

## Engine strings

| Value | Meaning |
|---|---|
| `xetex` | LaTeX through the bundled Tectonic sidecar. Also accepted: `latex`, `tex`, `tectonic`, `luatex` |
| `typst` | Typst through the pinned CLI. Also accepted: `typ` |
| `markdown` | Pandoc. Also accepted: `md`, `pandoc` |
| `latexmk` | System TeX. Valid, but see the caveat below |

`pdflatex` is **not** an engine name anywhere in Oleafly. A template that declares it fails validation and is dropped from the listing with no message. This is the single most common reason a template does not show up.

Caveat on `latexmk`: project creation derives the engine from the main document's extension, not from the manifest, so a `.tex` template always produces a project on Tectonic. If the source genuinely needs system TeX (minted, pythontex, glossaries, shell escape), say so in the README and tell the user to switch the engine in Settings after creating the project.

Main document extensions: `.tex`, `.ltx`, `.latex` for LaTeX; `.typ` for Typst; `.md`, `.markdown` for Markdown.

## Hard rules

1. **It must compile.** On Tectonic's default bundle for LaTeX, on the pinned CLI for Typst. No exceptions, no known-failing templates.
2. **Bundle-only packages.** Use what TeX Live ships. No `\write18`, no shell escape, no external images, no downloads at compile time. Draw a figure with TikZ if the preview needs one.
3. **No system fonts.** `fontspec` pointing at a font by family name resolves from the host machine and breaks everywhere else. Use a bundled font package (`lmodern`, `libertine`, `sourcesanspro`, `charter`, `biolinum`), or ship the font files in the template's `fonts/` folder with their license text and point `fontspec` at `Path=./fonts/`. For CJK, pass `fontset=fandol` as a documentclass option.
4. **Typst uses built-in features only.** No remote `@preview` imports. They need network on first compile and the app reports Typst as not offline capable.
5. **No em dashes** in any template text.
6. **Realistic filler.** A believable abstract, a plausible invoice, real-looking section names. Never lorem ipsum. Never a real person's data; invent names.
7. **Venue look-alikes are named with `-style`.** Recreate the look with standard packages. Do not copy proprietary class or style files. The exception is a file whose license clearly permits redistribution, in which case record that license in the manifest and keep a LICENSE note beside it.
8. **Page 1 carries the template.** The gallery preview shows page 1, so it has to look finished and representative. Keep templates to one page or a small number of pages.

## Where templates are found

In precedence order, first id wins:

1. Bundled, inside the app.
2. Downloaded packs, under `~/.oleafly/templates/packs/<pack-id>/<template-id>/`.
3. Custom, under `~/.oleafly/templates/custom/<template-id>/`.

A custom template whose id matches a bundled one is never seen. Pick a distinctive id.

## Fonts

If a template needs fonts, `requires.fonts` lists font-pack ids and the app copies the installed pack into the new project's `fonts/` folder when the project is created. A missing pack makes creation fail, and the gallery marks the template as not ready offline. For a one-off custom template it is simpler to bundle the font files in the template folder directly, with the license text beside them.

## Checklist before installing

- [ ] Folder name equals `id`, and the id is not taken by a bundled or pack template
- [ ] `engine` is `xetex`, `typst`, or `markdown`, and `main_doc` has the matching extension
- [ ] `category` and `description` are filled in, and the description has no em dash
- [ ] Compiles clean from its own main document, with no undefined references
- [ ] No system fonts, no external images, no shell escape, no remote imports
- [ ] Filler is realistic and contains no `TODO` markers and no real personal data
- [ ] A venue look-alike is named with `-style` and copies no proprietary files
- [ ] Page 1 looks like a finished document
