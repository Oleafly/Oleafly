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

## Markdown document types

A Markdown document picks what it builds with a `type` field in its front matter, the way a LaTeX document picks its class. Without one, or with a value Oleafly doesn't know, it builds an article as before.

| `type` | Builds | Filled in when the front matter leaves it out |
|---|---|---|
| `article` | Pandoc's LaTeX article | Nothing |
| `report`, `thesis` | The report class; `#` headings start chapters | `documentclass: report` |
| `book` | The book class; `#` headings start chapters | `documentclass: book` |
| `slides` | Beamer slides: `#` opens a section, `##` a slide | `aspectratio: 169` and slide level 2 (`slide-level` changes it) |
| `poster` | One beamerposter page: `##` headings become blocks and `:::: columns` sets the layout | A0 portrait, changed with `papersize: a1` to `a4` and `orientation: landscape`. The title becomes the poster's header |
| `letter` | A KOMA letter | `documentclass: scrlttr2`. It reads `to`, `from`, `subject`, `opening` and `closing` |
| `cv` | A compact article | `geometry: margin=2cm` and `pagestyle: empty` |

Front matter always wins: `documentclass`, `aspectratio`, `classoption` and the rest keep their usual Pandoc meaning. A LaTeX export writes the same Beamer, report or letter source, and a PPTX export uses the deck's slide level. Document settings has a Document type field that writes the `type` line.

Preflight reports coverage separately for compile, submission, ATS,
accessibility, references, and privacy. A check is `not_run` when its required
input is missing, `partial` when source checks ran without a current PDF, and
`unsupported` when the active engine does not provide the needed source facts.
These states never appear as a verified 100% result.

The New Project gallery includes engine-tagged templates and an engine filter. All project types use transactional creation: if template copy, engine validation, asset staging, or metadata writing fails, the partial project directory is removed.

## Quarto and Calepin

Quarto and Calepin compile documents that contain code. You install the tool
yourself or let Oleafly download it. Outside a `_quarto.yml` project, Quarto
needs to be 1.5 or newer. The code runs in your own R, Python or Julia.

When R or Python is missing on macOS or Windows, Settings and the compile
error offer the official installer from CRAN or python.org. Oleafly downloads
it, checks it against a pinned SHA-256 and opens it, so the system installer
does the rest. On Linux, Oleafly names the package to install instead. Either
way, Check again looks for the program without a restart.

Oleafly also installs the packages a document is missing. R packages go into
the first writable library, or the user library (`R_LIBS_USER`) when the
system one is read-only, and knitr and rmarkdown always go together. Python
packages go into the project's own virtual environment or conda environment
when code is allowed, and otherwise into one environment Oleafly keeps in its
tools folder. That environment is created with `--system-site-packages`, so
packages already on the system stay visible, and Jupyter is added whenever
it is missing.

| Capability | Quarto | Calepin |
|---|---|---|
| Main source | `.qmd`, `.Rmd` | `.typ` that imports `/.calepin/calepin.typ` |
| Output | The first format the document declares that Oleafly can show: PDF for `pdf`, `typst` and `beamer`, HTML for `html`, `revealjs` and `dashboard`, extension formats such as `acm-pdf` included. Other formats, such as `docx`, are skipped. With none of these, HTML | PDF |
| Code runs | Only after "Allow code in this project" | Same |
| With code off | Renders with `--no-execute`: chunks show their code, no output. A project with filters, shortcodes, `_extensions`, render scripts or inline R code doesn't compile until code is allowed. With no R installed, a `.qmd` with front matter falls back to a plain preview, and a `.Rmd` still needs R | Shows the results Calepin stored on its last run, through plain Typst. With none stored, compile asks for code to be allowed |
| Time limit | One hour | One hour, or 5 minutes for stored results shown through plain Typst |
| Formatting profile | Pandoc Markdown | Typst |
| Project index and citations | Yes | Yes |
| Source and PDF sync | No | No |
| Conversion exports | DOCX, HTML and PDF, rendered by Quarto. PDF goes through Typst unless the document declares its own PDF format. A book exports as one file | HTML, rendered by Calepin |
| Bundled templates | Quarto article (PDF through Typst), Quarto slides (reveal.js) | Calepin report |

A `.typ` document switches between the Typst and Calepin engines from the
compile menu. An opened folder whose main `.typ` file imports the Calepin
runtime opens on Calepin. Both engines need a trusted folder.

HTML output, reveal.js decks included, shows in the preview pane. Oleafly
serves the build folder on a loopback-only address under a random path and
shows it in a sandboxed frame on its own origin, so the page cannot call the
app. **Open in browser** stays in the preview toolbar. PDF output goes where
the other engines write theirs, so the viewer, export and the shared project
PDF need nothing new.

A web page preview has its own toolbar. Zoom, page controls, reader view and
rotation are gone, since a page scrolls and reflows on its own. Fullscreen,
the pop-out window, invert colors, copy output path and download stay.
Download and Export as PDF render the page again through Quarto's Typst
format, so the PDF is a print layout rather than a screenshot of the page.
Export as PNG rasterizes that PDF's first page.

A page that isn't part of a `_quarto.yml` project is built with its styles
and scripts inside the HTML file, so **Save HTML to project** and **Sync HTML
on compiles** write one file that opens anywhere. Pages of a website or book
share `site_libs`, so those two actions are hidden for them. The compile menu
has **Render the whole Quarto project** for those projects, which builds every
page so the links between them work in the preview.

Dark mode for web pages is its own setting under Settings, Appearance, PDF
Preview. It follows the app theme by default and keeps pictures in their own
colors. On macOS, R figures in Typst output are drawn as PNG unless the
document picks a figure format, because R's SVG device there needs XQuartz.
