# Document engines

OpenLeaf loads one backend-owned engine descriptor when a project opens. The frontend treats that descriptor as the source of truth for formatting, preflight, compile options, diagrams, SyncTeX, and conversion exports. Until it loads successfully those controls stay unavailable rather than guessing from a filename.

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

Typst and Markdown source checks are intentionally not simulated with LaTeX regular expressions. Output-level PDF, structure, accessibility, and ATS checks remain shared whenever a compiled PDF is available.

Preflight reports coverage separately from findings. ATS and accessibility are
`not_run` until a compiled PDF exists, and unsupported source checks are marked
`unsupported`. These states have no numeric score and never appear as 100% or
“No problems found.”

The New Project gallery includes engine-tagged templates and an engine filter. All project types use transactional creation: if template copy, engine validation, asset staging, or metadata writing fails, the partial project directory is removed.
