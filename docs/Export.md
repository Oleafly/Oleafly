# Export

Export is engine-aware. The application validates the requested format against
the persisted engine descriptor and writes only to a user-approved destination.

## Output families

- Compiled PDF for all supported document engines. Exporting from the toolbar
  or the command palette saves the PDF on screen, and the result says so when
  that PDF came from a failed compile or is missing the latest edits.
- Full source archive as a ZIP, excluding application metadata and Git internals.
  Symbolic links are left out and the result gives their count. A library
  project's `project.json` goes in without its export history.
- Conversions to DOCX, HTML, Markdown, plain text, Typst and LaTeX when the
  engine descriptor allows them. Markdown and plain-text exports from LaTeX
  keep the title, author and abstract. Markdown exports to Typst or LaTeX keep
  the bibliography the document declares, or the `.bib` files found in the
  project if it declares none. Typst projects on Typst 0.13 or newer
  convert through Typst's own HTML output, as
  [Typst conversions](#typst-conversions) explains.
- PowerPoint export for Beamer presentations and for every Markdown document.
  Level 1 headings become section slides and level 2 headings start new slides.
  In a Beamer deck each frame starts a new slide, `\section` gives a section
  slide and `\subsection` adds none. A frame with more than one image, or with
  an image and other content, can run onto a second slide.
- EPUB export for LaTeX books, reports and theses, and for every Typst and
  Markdown document, with a table of contents and MathML equations.
- Typst projects also export PNG or SVG page images and HTML from Export >
  Images and HTML. The PDF standards box under Preflight > Accessibility
  exports PDF/A or PDF/UA.
- Source and PDF export records retained in project metadata.

## Figures

- Exports look for figures in the main document's folder, the project root and
  any `\graphicspath` folders. A name without an extension still finds its file.
- PDF, SVG and WebP figures become PNG pictures in Word and PowerPoint, and PDF
  figures become PNG pictures in HTML and EPUB. Typst renders them at 220 ppi,
  and a figure with no size in the source keeps its own width.
- EPS figures can't be converted. They go into the file unchanged with a
  warning, as does any figure Typst fails to render.
- Markdown exports to Word, HTML, EPUB and PowerPoint show the figure saved for
  a Mermaid block.
- Exports from LaTeX to `.md` or `.typ`, and from Markdown to `.tex` or `.typ`,
  link to the project's figure files instead of copying them. Keep those files
  next to the export.

## What an export reports

Pandoc skips what a format can't hold and records it only in its log. Exports
from LaTeX and Markdown projects read that log, and so do Typst exports when
Pandoc reads the source. The result says the file was saved with warnings, and
Show warnings lists them. `oleafly export` prints the same warnings.

- A block left out, by name, with its file and line when Pandoc gives them.
  This covers LaTeX environments such as `tikzpicture`, `\includepdf`, the
  `\frame` shorthand outside PowerPoint, and Beamer text commands such as
  `\only` and `\uncover`.
- A figure the export couldn't find or convert. In PowerPoint a missing figure
  stops the export instead: no file is saved and the error names the figure.
- A citation key that isn't in the bibliography.
- Math that stayed as TeX, except in plain text.
- References with no number yet, which a compile fixes.
- Content the format's writer refused, and any other warning Pandoc logs.

Routine notes stay out of the list. Repeats collapse, and the list stops at 50
warnings.

Typst exports through HTML don't read the log and report only what Typst
ignored, as [Typst conversions](#typst-conversions) explains. Notebook exports
don't read it either.

## Typst conversions

Typst writes HTML and Pandoc turns that HTML into the target format. How far
that goes depends on the project's Typst version:

| Typst | Route |
| --- | --- |
| 0.15 or newer | Through HTML. |
| 0.13 and 0.14 | Through HTML when Typst reports no lost content. Otherwise Pandoc reads the source. |
| 0.12 and older | Pandoc reads the source. |

If Typst stops with an error while writing HTML, Pandoc reads the source on any
version.

Typst writes equations to HTML from 0.15 and footnotes from 0.14. On 0.13 and
0.14, a successful source read warns that rotated, scaled, moved or skewed text
may be missing, and asks for Typst 0.15 or newer. If Pandoc logged warnings
during that read, such as a missing citation key, the app lists only those, and
`oleafly export` prints both. If the source read fails, the export uses the HTML
anyway and warns about what's gone.

Text inside layout elements such as `align`, `grid` and `rotate` stays in the
export. A CeTZ figure loses its lines and shapes, its text labels stay as loose
text, and the result names the element Typst ignored.

A `.tex` export copies the document's images into a `<name>-media` folder beside
the file. SVG, GIF and WebP images become PDFs there, because LaTeX can't read
them. With no images, no folder appears.

The Tools page reads Typst with Pandoc on every version. HTML from Export >
Images and HTML is Typst's own file, with no Pandoc step, and needs Typst 0.13
or newer. `oleafly export` takes the same routes as the Export menu.

## Import and reconstruction

- DOCX import uses Pandoc to create an editable project.
- PDF import performs deterministic local reconstruction into editable LaTeX;
  it reports limits instead of inventing missing text.
- Optional vision assistance can refine an imported project after the user
  connects a provider.

## Integrity and safety

- Export destinations must be absolute, existing, and non-directory paths.
- The Rust sandbox rejects paths outside the approved destination policy.
- Existing artifacts are preserved when a conversion fails.
- The engine descriptor is the source of truth for allowed conversion formats.
- PDF and source downloads use explicit filenames and do not expose credentials.

## Engineering anchors

- `src-tauri/src/project.rs`: PDF, document, and ZIP export commands.
- `src-tauri/src/document_engine.rs`: engine conversion matrix.
- `src-tauri/src/sandbox.rs`: export destination validation.
- `src-tauri/src/typst_export.rs`: Typst routes and the `.tex` media folder.
- `crates/oleafly-core/src/typst_html.rs`: what Typst's HTML keeps on each
  version.
- `crates/oleafly-doctools/src/export.rs`: Pandoc export runs and their warnings.
- `crates/oleafly-doctools/resources/pandoc/export-references.lua`: figures,
  references and Beamer frames.
- `packages/pdf-to-latex/`: deterministic PDF reconstruction.
- `packages/preflight/`: output and accessibility checks before export.
