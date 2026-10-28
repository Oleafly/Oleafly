# Document engines

Oleafly loads one backend-owned engine descriptor when a project opens. The frontend treats that descriptor as the source of truth for formatting, preflight, compile options, diagrams, source and PDF sync, and conversion exports. Until it loads successfully those controls stay unavailable rather than guessing from a filename.

There are five engines: LaTeX through Tectonic or latexmk, Typst, Markdown through Pandoc, and Quarto and Calepin for documents that run code. The table below covers the first three. [Quarto and Calepin](#quarto-and-calepin) has a table of its own.

| Capability | LaTeX / Tectonic | Typst | Markdown / Pandoc |
|---|---|---|---|
| Main source | `.tex`, `.ltx`, `.latex` | `.typ` | `.md`, `.markdown` |
| PDF compile and shared PDF preflight | Yes | Yes | Yes |
| Source preflight | LaTeX rules | Typst rules | Not yet, labelled unavailable |
| Formatting profile | LaTeX | Typst | Pandoc Markdown |
| Project index and citations | Yes | Yes | Yes |
| Source and PDF sync | Yes, through SyncTeX | Yes, on Typst 0.13 and later (Tinymist 0.13.30 or later) | No |
| Offline compiler mode | Yes | Yes, with cached or vendored packages only | No separate mode |
| AI figure tools | TikZ, compiled in isolation | CeTZ or fletcher, rendered as a Typst snippet | No |
| Conversion exports | DOCX, HTML, Markdown, text, Typst, plus PPTX/EPUB where relevant | LaTeX, DOCX, HTML, Markdown, text, EPUB | DOCX, HTML, text, Typst, LaTeX, PPTX, EPUB |
| Bundled blank template | Yes | Yes | Yes |

Typst projects get their own source rules, checked against the project's Typst version: unresolved references and citations, missing alt text, document metadata, missing images, privacy, and blind review. Markdown source checks are not simulated with LaTeX regular expressions. Compile-log and PDF checks remain shared when the engine provides those inputs. LaTeX projects also receive source-level submission, reference, accessibility, privacy, and ATS checks.

Preflight reports coverage separately for compile, submission, ATS,
accessibility, references, and privacy. A check is `not_run` when its required
input is missing, `partial` when source checks ran without a current PDF, and
`unsupported` when the active engine does not provide the needed source facts.
These states never appear as a verified 100% result.

The New Project gallery includes engine-tagged templates and an engine filter. All project types use transactional creation: if template copy, engine validation, asset staging, or metadata writing fails, the partial project directory is removed.

## Quarto and Calepin

Quarto and Calepin compile documents that contain code. You install the tool
yourself or let Oleafly download it. The code runs in your own R, Python or
Julia, which Oleafly never installs.

| Capability | Quarto | Calepin |
|---|---|---|
| Main source | `.qmd`, `.Rmd` | `.typ` that imports `/.calepin/calepin.typ` |
| Output | The first format the document declares that Oleafly can show: PDF for `pdf`, `typst` and `beamer`, HTML for `html`, `revealjs` and `dashboard`, extension formats such as `acm-pdf` included. Other formats, such as `docx`, are skipped. With none of these, HTML | PDF |
| Code runs | Only after "Allow code in this project" | Same |
| With code off | Renders with `--no-execute`: chunks show their code, no output. A project with filters, shortcodes, `_extensions`, render scripts or inline R code doesn't compile until code is allowed | Shows the results Calepin stored on its last run, through plain Typst. With none stored, compile asks for code to be allowed |
| Formatting profile | Pandoc Markdown | Typst |
| Project index and citations | Yes | Yes |
| Source and PDF sync | No | No |
| Conversion exports | DOCX and HTML, rendered by Quarto | HTML, rendered by Calepin |
| Bundled templates | Quarto article (PDF through Typst), Quarto slides (reveal.js) | Calepin report |

A `.typ` document switches between the Typst and Calepin engines from the
compile menu. An opened folder whose main `.typ` file imports the Calepin
runtime opens on Calepin. Both engines need a trusted folder.

HTML output stays in the build folder, and the preview pane has an
**Open in browser** button for it. PDF output goes where the other engines
write theirs, so the viewer, export and the shared project PDF need nothing
new.
