# Venue rules

Every number below is a shape, not a fact. Get the actual value from the venue's current call for papers and record where you got it. A page limit that was right last year is the most common source of a desk reject.

## What to establish first

| Question | Why it matters |
| --- | --- |
| Venue, year, and track | Rules differ between the main track, a short-paper track, and a workshop |
| Stage | Initial submission, rebuttal, camera-ready, and final all have different rules |
| Review model | Double-blind changes what may appear in the file at all |
| Format | LaTeX class and version, or a Word template |
| Page limit and what counts toward it | References and appendices are sometimes excluded, sometimes not |
| Supplementary policy | Separate file, appendix, or not allowed |
| Preprint policy | Whether an arXiv posting before or during review is permitted |

## Anonymity for double-blind

The submission file must not identify the authors. Check each of these with `search_project` rather than by reading:

| What to find | Search for |
| --- | --- |
| Author macros left in | `\author`, `\affiliation`, `\email`, `\orcid`, `\thanks` |
| Anonymity option missing from the class | `\documentclass` line, look for the venue's `anonymous` or `review` option |
| Acknowledgements | `\section*{Acknowledg`, `acknowledgement`, `acknowledgment` |
| Funding that names a grant holder | `grant`, `funded by`, `award number` |
| Identifying repository links | `github.com`, `gitlab`, `zenodo`, `doi.org/10.5281` |
| First-person self-citation | `our previous work`, `our earlier`, `we showed in [`, `in our prior` |
| Institutional data or site names | The institution name, the lab name, the cohort or dataset name if it is local |

Also check what is not in the source:

- PDF metadata carries the author name from the class or from the tool that made a figure. The venue's own class usually blanks it; a figure exported from another program may not.
- A figure file name like `smith-lab-setup.pdf` shows up in the PDF's embedded file list on some viewers.
- A comment in the source is invisible in the PDF but visible to anyone who downloads the source, which matters for venues that collect source.

Self-citation is allowed in double-blind review. Citing your own work in the third person is the normal form: "Prior work has shown [12]" rather than "In our previous work [12]".

## Page and length limits

Count the way the venue counts.

- Read whether references, the appendix, the impact statement, and the checklist are inside or outside the limit.
- Take the page count from the compiled PDF, not from an estimate.
- Camera-ready limits are often one page longer than the submission limit, to absorb the changes reviewers asked for.
- Being under the limit is not a virtue. Being over it is often an automatic reject with no review.

If the paper is over, list what could go: an appendix move, a figure merge, a table that duplicates the text, a related-work paragraph that repeats the introduction. Do not start cutting unless the user asks.

## Reference style

- Numeric or author-year, decided by the venue's `.bst` or `biblatex` style, not by preference.
- Use the class the venue ships. Do not recreate its look with a different class.
- Check whether the venue caps the number of references or excludes them from the page count.
- Check whether arXiv identifiers are acceptable as the only reference for an unpublished paper. Some venues want the published version cited when one exists.
- Consistency matters more than any single rule: all entries with DOIs or none, journal names all abbreviated or all spelled out, capitalization preserved in titles where the style keeps it.

## Supplementary material

- Some venues want a single supplementary file; some want an appendix inside the main PDF; some allow both and treat them differently.
- Reviewers are usually not required to read supplementary material. Anything a central claim depends on belongs in the main paper.
- Code and data supplements for a double-blind venue must be anonymized too, including commit history, author names in file headers, and the repository URL.
- Check the file-size cap and the allowed formats.

## Camera-ready differences

- Copyright block, DOI, and conference metadata get inserted, often with a class option or a supplied block of LaTeX.
- The anonymity option comes off and the real author list goes in.
- Acknowledgements and funding go back in.
- Page limit changes.
- Fonts must be embedded, and some publishers reject Type 3 fonts outright.
- Some publishers require a specific PDF version or a PDF/A profile.

## What only the author can decide

Mark these `needs decision` rather than guessing:

- Author order and who is corresponding
- Which venue, and whether to post a preprint
- The licence
- Whether a claim should be narrowed to fit the evidence
- What to cut when the paper is over the limit
- Whether a borderline result belongs in the main paper or the supplement
