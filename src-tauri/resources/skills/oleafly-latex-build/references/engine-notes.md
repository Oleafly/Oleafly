# Engine notes

The failures in here produce a PDF. They are wrong anyway, and the exit code will never tell you.

## Tectonic, the default LaTeX engine

- XeTeX under the hood, so Unicode source and `fontspec` both work, unlike pdfLaTeX.
- Packages come from a pinned TeX Live bundle fetched over the network on first use and cached afterwards. Anything outside that bundle cannot be installed from inside Oleafly.
- Bibliography: Oleafly ships a pinned `tectonic-biber` sidecar and puts its directory on the compile child's `PATH`. Tectonic normally discovers and runs it mid build. If a `.bcf` is left without a usable `.bbl`, Oleafly runs the same sidecar itself and typesets once more. That is why biblatex plus Biber works here even though plain upstream Tectonic and biblatex drift apart by version.
- Compile logs are turned into editor diagnostics. Incomplete bibliography steps appear as `[Oleafly]` notes that separate "Biber not found" from "Biber and biblatex versions do not match". Quote those notes rather than paraphrasing.

### Warm and cold builds are not byte identical

Tectonic runs its reruns inside one process, and some font layout state from the first pass survives into the last one. A build directory that already holds `.aux` or `.toc` files therefore produces a slightly different PDF from a clean one, even with identical sources, identical final auxiliary files, and identical logs. The difference is sub-point glue in one or two content streams.

What this means in practice:

- Two people, or two machines, can produce PDFs that differ by fractions of a point without anything being wrong.
- Deleting `.aux` before a build changes the output; deleting `.out`, `.lof`, `.lot` or `.bbl` does not.
- Documents on Type 1 fonts (`\usepackage[T1]{fontenc}` with `lmodern`) do not show it at all.
- `microtype` and `hyperref` are not the cause. Do not remove them chasing this.

Only raise this when someone is comparing PDF hashes. It never affects how the document reads.

## Fonts that quietly bind to this machine

Tectonic will happily resolve a font from the host operating system and warn about it in the log rather than failing:

```
warning: accessing absolute path `/System/Library/Fonts/Supplemental/Songti.ttc`;
build may not be reproducible in other environments
warning: Failed to load ToUnicode CMap for font ".../STHEITI.ttf"
```

The document then fails, or renders empty boxes, on any machine without those fonts. The ToUnicode warning also means the PDF cannot be searched or copied correctly for the affected text.

Grep the log for it and treat a hit as a defect:

```
absolute path | System/Library | C:/Windows/Fonts
```

### Latin display fonts

Do not chase global font discovery. Put the font files in the project and name the path:

```latex
\usepackage{fontspec}
\setmainfont{Lato}[
  Path=./fonts/,
  Extension=.ttf,
  UprightFont=*-Regular,
  BoldFont=*-Bold,
  ItalicFont=*-Italic,
  BoldItalicFont=*-BoldItalic,
]
```

with `fonts/Lato-Regular.ttf` and friends beside the source. XeTeX loads them directly, subsets them into the PDF, and behaves the same on every operating system and offline. The Open Font License requires the license text to travel with the files, so keep each family's `OFL.txt` in `fonts/` too.

To confirm a font really embedded rather than falling back silently, look for the family name in the PDF's font list. A font that is not listed did not load.

Icon fonts are a separate hazard: `fontawesome5` and moderncv's default icons can abort Tectonic with exit 134. That is an engine crash, not a missing font. Draw the same look with TikZ and xcolor instead.

### CJK

Pass the font set as a **documentclass** option:

```latex
\documentclass[11pt,fontset=fandol,UTF8]{ctexart}
```

Fandol ships inside Tectonic's bundle, so it resolves with no system install.

`\usepackage[fontset=fandol]{ctex}` after `\documentclass{ctexart}` does nothing at all, silently: the class already loaded `ctex` during `\documentclass`, so LaTeX skips the second load and discards the options. The package form is correct only on a plain `article` class where nothing loaded `ctex` first.

The other bundled font sets (`ubuntu`, `windows`, `mac`) all name host fonts, which is exactly the problem. Fandol covers Simplified Chinese well; check glyph coverage before assuming it transfers to Japanese or Korean.

## latexmk and system TeX

Chosen by the user in Settings, never by the assistant. It drives a real TeX distribution while keeping Oleafly's artifact layout, so the preview, the log pane and SyncTeX keep working.

- The underlying engine comes from the source: a `% !TeX program = xelatex|lualatex|pdflatex` line wins, then fontspec, polyglossia or unicode-math force XeLaTeX, and everything else runs pdfLaTeX.
- Shell escape is blocked by default. A user can allow it for one project on one machine. The grant is bound to the project directory's filesystem identity, so a copied project needs fresh consent, and leaving latexmk revokes it.
- `.latexmkrc` files at project, user and system level are all disabled, because they are executable Perl.
- `project.json` records the distribution and the `tlmgr` package versions when the pin was made. That file is the reason a coauthor compiles the same way, so never move engine or pin data under `.oleafly/`, which is gitignored and skipped by exports.
- Every successful compile writes a small provenance record under `.oleafly/builds/`, pruned to the last 20. When two machines disagree, compare those.

### TinyTeX

Oleafly can install TinyTeX on demand. Two things surprise people:

- On Windows, TeX Live ships most tools as `.exe` but `tlmgr` only as `tlmgr.bat`. A tool lookup that tries `.exe` alone reports no compatible tlmgr even though the install is intact.
- The archives legitimately contain sticky-bit directories under `texmf-var/fonts/pk/ljfour` and symlinks whose recorded mode differs by build platform. A validator that rejects those will refuse a perfectly good download, and the app will then keep offering to resume a download that already finished.

Neither is something to fix from inside a document. Report them so the user knows the install, not their source, is the problem.

## Typst

- Pinned Typst CLI, run as `compile <in> <out.pdf> --root <project dir>`.
- No SyncTeX, no isolated figure compile, no DOCX, HTML or PPTX export. The capability flags say so honestly; do not promise otherwise.
- `@preview` package imports need network on the first compile and are cached per user afterwards. Oleafly does not pre-fetch them and reports Typst as not offline capable, so prefer built-in features for anything that has to work on a plane.
- Source to PDF position mapping does not exist in a plain Typst PDF at all. The compiled file carries no source file name, and its `/Span` entries are tagged-PDF structure, not Typst spans. The only positional data is named destinations from labelled headings, which is heading granularity. So when a Typst error names a line, go to that line in the editor; there is nothing to click through in the preview.

## Markdown

- Pandoc, with the bundled Tectonic as the PDF engine, run with `--sandbox` and `--citeproc`, and with every `.bib` found in the project passed as a bibliography.
- Pandoc must be present. The app records the prerequisite state and can download a pinned version.
- No SyncTeX, no offline mode, no isolated figure support.

## Supervised processes

Every compile child gets TeX directories and the sidecar directory prepended to `PATH`, and runs under a supervisor with a timeout, a bounded output buffer, and process-tree cleanup on cancel. A compile that stops is a cancellation or a timeout, not a source error. Say which one.
