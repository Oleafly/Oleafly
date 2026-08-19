# Document engines

Oleafly loads one backend-owned engine descriptor when a project opens. The frontend treats that descriptor as the source of truth for formatting, preflight, compile options, diagrams, SyncTeX, and conversion exports. Until it loads successfully those controls stay unavailable rather than guessing from a filename.

| Capability | LaTeX / Tectonic | Typst | Markdown / Pandoc |
|---|---|---|---|
| Main source | `.tex`, `.ltx`, `.latex` | `.typ` | `.md`, `.markdown` |
| PDF compile and shared PDF preflight | Yes | Yes | Yes |
| Source preflight | LaTeX rules | Not yet, labelled unavailable | Not yet, labelled unavailable |
| Formatting profile | LaTeX | Typst | Pandoc Markdown |
| Project index and citations | Yes | Yes | Yes |
| SyncTeX | Yes | No | No |
| Offline compiler mode | Yes | No separate mode | No separate mode |
| Isolated figure studio | Yes | No | No |
| Conversion exports | DOCX, HTML, Markdown, text, plus PPTX/EPUB where relevant | None | DOCX, HTML, text, plus PPTX/EPUB where relevant |
| Bundled blank template | Yes | Yes | Yes |

Typst and Markdown source checks are intentionally not simulated with LaTeX regular expressions. Compile-log and PDF checks remain shared when the engine provides those inputs. LaTeX projects also receive source-level submission, reference, accessibility, privacy, and ATS checks.

Preflight reports coverage separately for compile, submission, ATS,
accessibility, references, and privacy. A check is `not_run` when its required
input is missing, `partial` when source checks ran without a current PDF, and
`unsupported` when the active engine does not provide the needed source facts.
These states never appear as a verified 100% result.

The New Project gallery includes engine-tagged templates and an engine filter. All project types use transactional creation: if template copy, engine validation, asset staging, or metadata writing fails, the partial project directory is removed.
