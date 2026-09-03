# Developer research seed corpus

Rewritten: 2026-08-29. Supersedes the pinned-upstream catalog of 2026-08-23.

## What this is

The seed corpus is the set of projects the Developer settings action copies
into the `.oleafly-dev` sandbox. It exists so the app can be exercised against
documents that look like the work Oleafly is for: real papers, theses, talks,
posters, and figures, with bibliographies, cross-references, mathematics, and
drawn figures.

Every fixture is first-party content authored in `fixtures/research-seeds/`.
Nothing is downloaded.

## Why the previous corpus was replaced

The 2026-08-23 catalog pinned 34 upstream GitHub revisions. Compiling all 34
with the sidecars the app actually bundles gave this result:

| Outcome | Count | Cause |
|---|---:|---|
| Produced a PDF | 10 | Typst templates and standalone TikZ figures |
| Failed to compile | 7 | Incomplete file lists and upstream API drift |
| Not compilable at all | 17 | Needed system `latexmk` or Pandoc, which Oleafly does not bundle |

The seven failures were not flaky, they were structural:

- **Incomplete snapshots.** The Ethereum Yellow Paper needs a `Version.tex`
  that its Makefile generates, and the file list never included it. The
  GIPPLab preprint referenced `comgipp.sty`, which was not in its list either.
- **Upstream drift.** Typst removed `image.decode`, which broke the ZJU lab
  report. The Modern CV template asked for package version 0.11.0, which was
  withdrawn in favour of 0.10.0. The ACM Typst article used a `tabular`
  binding that no longer exists.
- **Engine mismatch.** The Art of Linear Algebra selects the `dvipdfmx` driver,
  which Tectonic rejects.

The seventeen uncompilable entries were catalogued deliberately as "stress
snapshots" that were never expected to build. That was a defensible idea, but
in practice it meant a developer seeding the corpus got a library where most
projects showed a compile error, which is not a useful starting state.

Pinned upstream sources also rot on their own schedule. A fixture that
compiles today can break because a package registry withdrew a version, with
no change on our side.

## The current design

1. **Local fixtures.** Every project lives in `fixtures/research-seeds/<slug>/`
   and is authored in this repository. No network access, no pinned revisions,
   nothing that can be withdrawn upstream.
2. **Only bundled engines.** LaTeX through Tectonic (catalog engine `xetex`)
   and Typst. `latexmk` and Pandoc fixtures are gone, because the app does not
   ship those toolchains and a fixture that needs a system install cannot be
   guaranteed to compile.
3. **Compilation is enforced.** `pnpm seed:research:validate` compiles every
   fixture with the same sidecar binary and the same arguments the desktop app
   uses, including the pinned TeX bundle mirror. A fixture that passes there
   cannot fail in the app for a toolchain reason.
4. **No binary assets.** Figures are drawn in TikZ, pgfplots, or Typst's own
   primitives. The corpus stays small, every figure is diffable, and there is
   no image path to break.
5. **Research-grade content.** Genuine abstracts, arguments, mathematics,
   tables with units, and cited bibliographies. People and institutions are
   invented; findings are not attributed to real researchers.

Authoring rules are in
[`fixtures/research-seeds/AUTHORING.md`](../../fixtures/research-seeds/AUTHORING.md).

## Cover colors

Each project carries a `color` from the library palette in
`src/components/library/Book.tsx`, written into the archive's `project.json`
and preserved by the importer. Colors are spread across the whole palette so a
seeded library reads as a varied shelf instead of a wall of default blue. A
test asserts that every palette entry is used and that no color is used more
than one time above any other.

## Corpus

The corpus is 28 projects: 17 LaTeX and 11 Typst. Every one is verified to compile with the bundled sidecars.

### LaTeX (Tectonic) (17)

| Project | Kind | Main document | Exercises |
|---|---|---|---|
| Sparse Attention Systems Paper | document | `main.tex` | algorithm, bibliography, diagram, equations, plot, table |
| Bilingual CJK Research Note | document | `main.tex` | bibliography, cjk, diagram, equations, plot, table |
| Curriculum Selection ML Preprint | document | `main.tex` | algorithm, bibliography, diagram, equations, plot, table |
| Millimeter-Wave Estimation Article | document | `main.tex` | bibliography, diagram, equations, plot, table |
| Interruption Cost User Study | document | `main.tex` | bibliography, diagram, plot, table |
| Package Registry Measurement Paper | document | `main.tex` | algorithm, bibliography, diagram, listing, plot, table |
| Computational Physics PhD Thesis | document | `main.tex` | algorithm, bibliography, diagram, equations, listing, plot, table |
| Causal Inference Monograph | document | `main.tex` | algorithm, bibliography, diagram, equations, plot, table |
| Flux Tower Technical Report | document | `main.tex` | bibliography, diagram, equations, listing, plot, table |
| RNA-seq Laboratory Report | document | `main.tex` | bibliography, diagram, equations, listing, plot, table |
| Satellite Congestion Control Talk | document | `main.tex` | bibliography, diagram, equations, plot, presentation, table |
| Estuary Transport Research Poster | document | `main.tex` | bibliography, diagram, equations, plot, table |
| Academic CV and Publications | document | `main.tex` | bibliography, table |
| Federated Analytics Grant Proposal | document | `main.tex` | bibliography, diagram, equations, table |
| Transformer Block Figure | image | `figure.tex` | diagram, equations |
| Distributed Training Topology Figure | image | `figure.tex` | diagram |
| Scaling Law Diagram | diagram | `figure.tex` | diagram, plot |

### Typst (11)

| Project | Kind | Main document | Exercises |
|---|---|---|---|
| Grid Islanding Paper (Typst) | document | `main.typ` | bibliography, diagram, equations, plot, table |
| Data Selection Paper (Typst) | document | `main.typ` | bibliography, equations, plot, table |
| Alloy Creep Article (Typst) | document | `main.typ` | bibliography, diagram, equations, plot, table |
| Zoned Storage Measurement Paper (Typst) | document | `main.typ` | bibliography, diagram, equations, listing, plot, table |
| Tactile Grasping Thesis (Typst) | document | `main.typ` | bibliography, diagram, equations, listing, plot, table |
| Data Science Handbook (Typst) | document | `main.typ` | bibliography, diagram, equations, listing, plot, table |
| Experimental Lab Notebook (Typst) | document | `main.typ` | bibliography, diagram, equations, listing, plot, table |
| Quarterly Research Report (Typst) | document | `main.typ` | bibliography, diagram, equations, listing, plot, table |
| Vector Search Slides (Typst) | document | `main.typ` | bibliography, diagram, equations, plot, presentation, table |
| Academic CV (Typst) | document | `main.typ` | plot, table |
| Sodium-Ion Thermal Poster (Typst) | document | `main.typ` | bibliography, diagram, equations, plot, table |

## Workflow

```bash
pnpm seed:research:validate           # compile every fixture, or a named slug
pnpm seed:research:sync               # pack fixtures into ../oleafly-seed, or OLEAFLY_SEED_ROOT
```

`sync` writes one archive per fixture, adds `project.json` and `FIXTURE.md`,
and removes archives whose fixture no longer exists. The Developer settings
action then copies those archives into the sandbox library. It performs no
network requests, and the seeder is excluded from production builds.

While authoring a fixture that has no catalog entry yet:

```bash
node scripts/validate-research-seeds.mjs \
  --dir fixtures/research-seeds/<slug> --main main.tex --engine xetex
```

## What this corpus deliberately does not cover

- **System toolchains.** There is no `latexmk` or Pandoc fixture. Engine
  selection, missing-tool reporting, and shell-escape trust prompts still need
  testing, but a corpus whose job is to compile is the wrong place for it.
  Those paths belong in targeted tests that assert on the error, not in seed
  data a developer has to look at every day.
- **Binary asset handling.** PNG, JPEG, and embedded-PDF figure paths are not
  exercised here, because shipping binaries conflicts with keeping the corpus
  small and diffable.
