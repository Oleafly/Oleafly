# Submission checklist

Project: <name>
Target: <venue or arXiv>, <year>, <track>
Stage: <initial submission | revision | camera-ready>
Review model: <double-blind | single-blind | open>
Checked on: <date>
Rules taken from: <URL of the call for papers, and the date it was read>

Verdicts are `pass`, `fail`, or `needs decision`. Nothing passes on an assumption.

## Build

| Item | Verdict | Evidence |
| --- | --- | --- |
| Compiles with zero errors | | |
| No undefined references | | |
| No undefined citations | | |
| No multiply defined labels | | |
| No missing character warnings | | |
| No overfull box above 10pt | | |
| Bibliography builds and is complete | | |
| Rendered PDF read end to end | | |

## Format

| Item | Verdict | Evidence |
| --- | --- | --- |
| Correct venue class and version | | |
| Page count within the limit | | |
| Margins and font size unmodified | | |
| Reference style matches the venue | | |
| Required sections present | | |
| Supplementary material in the required form | | |

## Anonymity (double-blind only)

| Item | Verdict | Evidence |
| --- | --- | --- |
| No author names or affiliations | | |
| Class anonymity option enabled | | |
| Acknowledgements removed | | |
| Funding statement removed or anonymized | | |
| No identifying repository links | | |
| Self-citations in the third person | | |
| PDF metadata carries no author name | | |

## Front matter

| Item | Verdict | Evidence |
| --- | --- | --- |
| Title consistent across manuscript and metadata | | |
| Abstract within the word limit | | |
| Abstract free of citations, refs, and undefined macros | | |
| Author list and order agreed | | |
| Keywords or subject categories chosen | | |
| Data availability statement | | |
| Code availability statement | | |
| Ethics and consent statements | | |
| Conflict of interest statement | | |
| Funding statement | | |

## Figures and tables

| Item | Verdict | Evidence |
| --- | --- | --- |
| Every figure and table referenced in the text | | |
| Raster figures at the required resolution | | |
| Plots and diagrams in vector format | | |
| Text in figures readable at print size | | |
| Colour is not the only encoding | | |
| Captions self-contained | | |
| No content outside the trim area | | |

## arXiv source (LaTeX only)

| Item | Verdict | Evidence |
| --- | --- | --- |
| Source builds on arXiv's default engine | | |
| `\pdfoutput=1` present in the first lines | | |
| `.bbl` included and current | | |
| No absolute paths | | |
| File names plain ASCII, no spaces, no leading dots | | |
| No two file names differing only by case | | |
| Figures are PDF, PNG, or JPEG only | | |
| No duplicate figure in two formats | | |
| All fonts embedded, no Type 3 | | |
| Non-standard packages included as `.sty` | | |
| Ancillary files in `anc/` | | |
| Metadata abstract within the character limit | | |
| Licence chosen deliberately | | |

## Bundle

| Item | Verdict | Evidence |
| --- | --- | --- |
| Build outputs excluded | | |
| Git internals excluded | | |
| Editor and OS junk files excluded | | |
| Unused figures removed | | |
| Package size within the venue limit | | |

## Failures

1. <The most serious failure, with its location.>
2.
3.

## Open decisions

| Decision | Why it is the author's | What is needed |
| --- | --- | --- |
| | | |
