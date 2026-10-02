# Project library

The library is the project lifecycle surface. It stores ordinary project
folders and metadata while providing discovery, templates, previews, and
recent-work navigation.

<div align="center">
  <img src="assets/readme/start-work.png" alt="Oleafly start screen offering a research project, project import, or template" width="100%" />
</div>
<p align="center"><em>Start with the kind of work you actually have: a new project, an existing project, or a template.</em></p>

## Implemented surface

- Project cards with engine, document kind, modification, bookmark, and preview
  state.
- Search with GitHub's issue search syntax: qualifiers, exclusions, AND, OR
  and parentheses (see below).
- An Advanced filters panel that reads and writes the same search text.
- Create, duplicate, rename, archive, and delete project operations through the
  filesystem sandbox.
- Main-document and engine metadata persisted with each project.
- Compile and export history associated with the project.
- Template gallery integration and optional template-pack downloads.
- PDF and source import entry points.

<div align="center">
  <img src="assets/readme/project-library.png" alt="Oleafly project library with research projects organized as cards" width="100%" />
</div>
<p align="center"><em>Keep manuscripts discoverable without moving the project folders that contain them.</em></p>

The library also keeps import paths close to project creation. Existing
project archives, Word documents, Markdown, HTML, Typst, arXiv sources, and
GitHub repositories can start a new project without changing the original.

<div align="center">
  <img src="assets/readme/import-project.png" alt="Oleafly import project dialog for archives, documents, arXiv sources, and GitHub repositories" width="100%" />
</div>
<p align="center"><em>Bring the work you already have into a new project while leaving the original alone.</em></p>

## Searching the library

The search box on the home screen uses the same syntax as GitHub's issue and
pull request search. Words match the project name, ID, main file, folder
path, exports, engine, kind and cover colour. Qualifiers narrow the list:

| Qualifier | Example | Matches |
| --- | --- | --- |
| `is:` | `is:bookmarked`, `is:folder`, `is:library`, `is:forked` | Project state |
| `has:` and `no:` | `has:preview`, `no:exports` | Whether something exists |
| `engine:` | `engine:typst`, `engine:latex` | Tectonic, Typst or Markdown |
| `kind:` | `kind:image` | Document, image or diagram |
| `color:` | `color:mint` | Cover colour |
| `created:`, `updated:`, `opened:` | `created:>2026-01-01`, `updated:>@today-1w` | Dates |
| `in:` | `draft in:name` | Limits words to name, ID, file, path or export |
| `sort:` | `sort:name-asc`, `sort:created` | Order (`-desc` when left out) |

The rules match GitHub's:

- A space means AND. `AND` and `OR` (upper case) and parentheses group terms,
  up to five levels deep, and AND binds tighter than OR.
- Commas list alternatives: `engine:typst,markdown` matches either engine.
  Repeating a qualifier means both, so `engine:typst engine:markdown` matches
  nothing.
- A leading `-` excludes: `-engine:markdown`, `-is:bookmarked`. `NOT` works
  too, before a word or a qualifier, and `-word` excludes a word.
- Dates take `>`, `>=`, `<`, `<=`, ranges such as `2026-01-01..2026-03-31`
  with `*` for an open end, and `@today`, `@today-7d`, `@today-2w`,
  `@today-1m` or `@today-1y`.
- Quotes keep spaces together: `"lab notes"`, `in:path "My Papers"`.

An unknown qualifier is searched as plain text, as on GitHub, and gets a
warning. A value a qualifier doesn't accept is tinted amber and ignored. The
dropdown under the box offers qualifiers, values, AND, OR and Exclude as you
type, and the Advanced filters panel is a shortcut that edits the same text.
A query the panel can't show as a single choice appears there as Custom.

### Adding a qualifier

The parser, evaluator and suggestion logic live in `@oleafly/search-query`,
which knows nothing about projects. `src/components/library/project-search.tsx`
describes the project qualifiers as tables. A later feature, such as sharing
or sync, adds to those tables through a `ProjectSearchExtension`: an `is:` or
`has:` flag (`is:shared`, `has:conflicts`), a field (`owner:`), a text scope
or a sort order. Flags get `no:` for free. Each entry carries its label and
icon for the dropdown, so the new qualifier shows up there without UI work.

## Engineering boundaries

- Project source remains a normal directory and can be opened outside Oleafly.
- The library does not use a proprietary document database.
- Metadata is separate from source files and is not required for command-line
  compilation.
- Project IDs and filesystem paths are validated in Rust before mutation.

## Engineering anchors

- `src/components/library/`: library and project creation UI.
- `packages/search-query/`: query parser, evaluator, suggestions and edits.
- `src/components/library/project-search.tsx`: the project qualifiers.
- `src/components/ui/query-search.tsx`: the search box and its dropdown.
- `src/store/library.ts` and `src/store/project.ts`: client state.
- `src-tauri/src/project.rs`: lifecycle, metadata, and import/export commands.
- `src-tauri/src/paths.rs` and `src-tauri/src/sandbox.rs`: path policy.
