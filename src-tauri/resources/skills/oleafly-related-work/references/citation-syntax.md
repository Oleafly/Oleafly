# Citation syntax by engine

Write the syntax the project already uses. Two of the three engines accept a wrong citation form without erroring, so a mismatch shows up only in the rendered PDF.

## Detecting what the project uses

`search_project` in this order and stop at the first hit.

| Query | Means |
|---|---|
| `\usepackage{biblatex}` or `\addbibresource` | LaTeX with biblatex, cite with `\parencite` and `\textcite` |
| `\usepackage{natbib}` or `\citep{` | LaTeX with natbib, cite with `\citep` and `\citet` |
| `\bibliography{` with no natbib or biblatex | LaTeX with plain BibTeX, cite with `\cite` |
| `#bibliography(` | Typst |
| `bibliography:` in a YAML block, or `[@` in the body | Markdown through Pandoc |

Also run `search_project` with `{"query": "\\cite"}` and read what the document already does. Matching the existing document beats matching the package.

## LaTeX

Plain BibTeX:

```latex
\cite{xu2019-gnn-expressivity}
\cite[Section 4]{xu2019-gnn-expressivity}
```

natbib, where the distinction matters for readability. `\citep` renders as `(Xu et al., 2019)` and `\citet` as `Xu et al. (2019)`:

```latex
\citep{xu2019-gnn-expressivity}
\citet{xu2019-gnn-expressivity}
\citep[see][Section 4]{xu2019-gnn-expressivity}
```

biblatex:

```latex
\parencite{xu2019-gnn-expressivity}
\textcite{xu2019-gnn-expressivity}
\cite[41]{xu2019-gnn-expressivity}
```

Use the parenthetical form when the citation supports the sentence and the textual form when the authors are the subject of it. "Xu et al. showed" needs `\citet` or `\textcite`; "the bound is tight (Xu et al.)" needs `\citep` or `\parencite`.

An undefined key produces a warning and renders as `[?]`. It does not fail the build, which is why `get_pdf_text` is part of the procedure.

## Typst

```typst
@xu2019-gnn-expressivity
#cite(<xu2019-gnn-expressivity>, supplement: [Section 4])
```

The bibliography is declared once, usually at the end:

```typst
#bibliography("references.bib")
```

Typst `@key` is ambiguous: it means a citation when the key is in the bibliography and a label reference otherwise. `project_map` reports these under `ambiguousTypstAtUses`. Read that field when a citation is not rendering: the key may be resolving as a label.

## Markdown through Pandoc

```markdown
[@xu2019-gnn-expressivity]
[@xu2019-gnn-expressivity, sec. 4]
@xu2019-gnn-expressivity showed that ...
[-@xu2019-gnn-expressivity]
```

The bibliography is declared in the front matter:

```yaml
---
bibliography: references.bib
---
```

An unknown key renders as the literal text `[@key]` with no warning at all. In Markdown projects, `get_pdf_text` is the only check that catches it.

## Keys with awkward characters

Keys containing a colon or a hyphen are fine in all three. Keys containing a comma, a brace or whitespace are not. If the project's existing scheme produces such a key, escape or rename it rather than working around it in the prose.

## After any citation edit

1. `compile` with `{}`.
2. `project_map` with `{}`, and confirm `unresolvedCites` is empty.
3. `get_pdf_text` with `{}`, and search the rendered text for `[?]`, for `[@`, and for the author names you expected.
