# Research seed fixture authoring rules

These fixtures are the developer seed corpus. The Developer settings action
copies them into the `.oleafly-dev` sandbox so the app can be exercised against
believable research projects. They are first-party content authored in this
repository, not snapshots of upstream repositories.

## Why they are local

The previous corpus pinned 34 upstream GitHub revisions. Only 10 of them still
produced a PDF: upstream files moved, Typst package versions were withdrawn,
and 17 projects needed a system LaTeX or Pandoc install that Oleafly does not
bundle. Local fixtures remove every one of those failure modes.

## Hard rules

1. **Every fixture must compile with the bundled sidecars.** Prove it:
   ```bash
   node scripts/validate-research-seeds.mjs <slug>
   # while authoring, before the catalog entry exists:
   node scripts/validate-research-seeds.mjs --dir fixtures/research-seeds/<slug> \
     --main main.tex --engine xetex
   ```
   The script runs the same binary and arguments as the desktop app, so a pass
   here cannot fail for a toolchain reason in the app.
2. **LaTeX targets Tectonic** (catalog engine `xetex`). Use only packages in
   Tectonic's TeX Live bundle. No `\write18` or shell escape, no system fonts
   through `fontspec`, no downloads at compile time.
3. **Typst uses built-in features only.** No `@preview` package imports. A
   remote package is a network dependency and a version that can be withdrawn,
   which is exactly what broke the old corpus.
4. **No external binary assets.** Draw figures with TikZ, pgfplots, or Typst's
   own drawing primitives. This keeps the repository small and keeps every
   figure diffable.
5. **Research-grade content.** Real structure and plausible science: a genuine
   abstract, sections that argue something, equations that typecheck as
   mathematics, tables with units, and a bibliography whose keys are cited.
   Never lorem ipsum, never placeholder headings.
6. **Invented people and institutions.** Realistic names, never a real person's
   details. Do not attribute invented findings to a real lab or author.
7. **No em dashes** anywhere in the text. Use commas or periods.
8. **No comments in the source files.** The documents should read as finished
   work.
9. **Multi-file where the document kind implies it.** Papers split into
   `sections/`, theses into `chapters/` with front matter. A one-file thesis
   does not exercise the file tree, outline, or cross-file navigation.

## Layout

```
fixtures/research-seeds/<slug>/
  main.tex | main.typ        # or the path named by the catalog `mainDoc`
  sections/ | chapters/      # for multi-file documents
  refs.bib                   # LaTeX bibliographies
```

The seed archive builder adds `project.json` and `UPSTREAM.md`; do not write
them by hand.

## Catalog entry

Every fixture needs a row in `src/developer/research-seed-catalog.ts` giving
its `slug`, display `name`, `kind`, `engine`, `mainDoc`, `color`, the
`figureTypes` it genuinely contains, and a one-sentence `summary` of what it
exercises. `fixtures/research-seeds/<slug>` must equal the `slug`.

Colors come from the library palette in `src/components/library/Book.tsx` and
are assigned so the seeded library shows the whole palette rather than a wall
of default blue.
