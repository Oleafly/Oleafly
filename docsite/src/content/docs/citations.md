---
title: "Citations & bibliography"
description: "Paste a DOI, arXiv id, or paper title and get a clean BibTeX entry plus the \\cite at your cursor, deduplicated against your .bib automatically."
---

Adding a citation in most LaTeX workflows means: find the paper, export BibTeX, clean it up, paste it into the `.bib`, invent a key, and finally type the `\cite`. OpenLeaf collapses all of that into one dialog.

## Add citation

Open it from the quote button in the [editor toolbar](/OpenLeaf/editor/#the-toolbar) or run **Add citation** from the ⌘K command palette. Then paste or type any of:

- **A DOI** like `10.1145/3592979`: fetched directly from doi.org.
- **An arXiv id** like `1706.03762`: fetched from arXiv.
- **A URL** containing either of the above.
- **A paper title**: searches Crossref and shows a list of matches with title, authors, year, and venue; pick the right one.

Click **Look up**, review the fetched BibTeX in the preview, and hit **Add to .bib and cite**. OpenLeaf then does three things at once:

1. **Appends the entry to your project's `.bib`**, with a clean, auto-generated citation key.
2. **Deduplicates by DOI**: if the paper is already in your bibliography under any key, no duplicate is created and the existing key is reused.
3. **Inserts `\cite{key}` at your cursor** and confirms with a toast.

## Which .bib file it uses

OpenLeaf targets the bibliography your document actually loads: the file named in `\bibliography{}` or `\addbibresource{}`. If neither exists, it uses the project's first `.bib`, and if the project has none at all, it creates `references.bib`. You never have to think about it, but the behavior is predictable when you do.

## Autocomplete from your .bib

Once entries exist, typing inside `\cite{` (and variants like `\citep`, `\citet`, `\parencite`, `\textcite`) completes citation keys from every `.bib` in the project, parsed automatically when the project opens. Details in [Autocomplete](/OpenLeaf/autocomplete/#citation-completion).

## Navigating your citations

Citations plug into [code intelligence](/OpenLeaf/code-intelligence/) like everything else:

- **F12** or ⌘-click on a `\cite` key jumps to the entry in the `.bib`.
- **⇧F12** lists every place a paper is cited.
- **F2** renames a citation key across the whole project, `.bib` included.
- **Hover** a key to see what it points to; an unresolved key is flagged before the compiler ever complains.

And before you submit, [Preflight](/OpenLeaf/preflight/) catches undefined citations, duplicate labels, and duplicate bibliography entries (two keys sharing one DOI).

## Privacy and offline behavior

A lookup sends exactly one thing over the network: the identifier or title you typed, to doi.org, arXiv, or Crossref. Nothing else about your document leaves your machine. With [Offline mode](/OpenLeaf/settings/#general) on, lookups are blocked entirely; autocomplete from your existing `.bib` keeps working, since it never needed the network in the first place.
