---
title: "Preflight: ATS & accessibility"
description: "Score your document for resume parsers and screen readers before you submit: source checks, output audits, a live ATS extraction preview, and one-click prep for tagged PDF export."
---

Two audiences read your PDF without ever telling you what went wrong: applicant tracking systems and screen readers. Both fail on the same underlying defects, and both usually fail silently. Preflight makes those failures visible before you submit, and we don't know another LaTeX editor that does this.

Open it from the shield icon in the left rail. The panel opens instantly, pre-selects the checks relevant to your document type, and every check explains itself with an info icon.

![Preflight scoring a resume for ATS readiness](/Oleafly/media/preflight-ats.png)

## Two scores

At the top: **ATS readiness** and **Accessibility**, each out of 100, computed from the checks below. They move as you fix things, which turns cleanup into a satisfying loop.

## Source checks

Static analysis of your LaTeX, before any compile:

- Two-column and multi-column layouts (parsers read them in the wrong order)
- Missing image alt text
- Font icons hiding real content, like an email or phone number rendered as a glyph
- Tables or TikZ used for page layout
- Contact info placed in a page header (many parsers strip headers)
- Non-descriptive link text ("click here")
- Missing document language or PDF title
- Skipped heading levels
- and more

Source-level findings also appear as inline squiggles right in the editor, so you can fix them where they live.

## Output checks

After a compile, Preflight audits the actual PDF:

- Columns that read across instead of down
- Garbled or unmapped text (the classic icon-font casualty)
- Pages with no selectable text at all
- Missing PDF language or title metadata

## See what the machine sees

Two views take the guesswork out:

- **What the reader sees**: a plain-text rendering of your compiled PDF in reading order, exactly what a parser or screen reader receives. If your name is missing or your sections are shuffled here, they're shuffled for the ATS too.
- **What a parser extracted**: for resumes, a simulation of a real ATS pass: the name, email, phone, and links it found, and which standard sections (Experience, Education, Skills) it detected. A missing phone number or an invisible Work Experience section shows up here first.

## References & assets

A pre-submission integrity sweep that catches what breaks bibliographies at the worst moment: undefined citations and cross-references, duplicate labels, duplicate bibliography entries (two keys sharing one DOI), and missing figure or included files.

## Running checks

Every check is an accordion with its own enable checkbox and **Run** button, plus one button to run everything enabled. Run one check while iterating on a specific problem, or the full suite before submission.

## Accessible (tagged) PDF export

The **Accessible export** card turns a regular document into one ready for tagging:

1. **Prepare for accessible export** rewrites your source with what a tagging engine needs (the `\DocumentMetadata` first line, unicode-math, alt-text placeholders), showing every change before you apply it.
2. **Compile tagged and verify** builds with LuaLaTeX and immediately audits the result, including a full tag-tree inspection, ending in a clear verdict: is this PDF Section 508 / PDF-UA ready?

The LuaLaTeX engine comes from your system TeX Live or a one-click TinyTeX install; see [LaTeX engines](/Oleafly/latex-engines/). Your everyday Tectonic compiles are untouched by any of this.

## Honest scope

A clean Preflight means your document is ready for parsers and screen readers. It's a readiness aid built on real extraction and real tag audits, not a formal accessibility certification.
