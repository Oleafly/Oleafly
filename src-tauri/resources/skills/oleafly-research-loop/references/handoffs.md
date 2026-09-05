# Handoffs

What the user says, and the skill that owns it. Match on intent, not on exact words. When two rows fit, load the Oleafly skill first: it names the vendored skill to hand off to at the right point in its own procedure.

## Research

| The user says | Load |
|---|---|
| "find papers on X", "what has been done on X", "give me some references for this" | `oleafly-literature-sweep` |
| "build me a reading list", "collect sources for the intro" | `oleafly-literature-sweep` |
| "do a systematic review", "PRISMA", "screening counts", "meta analysis" | `literature-review` |
| "look up this DOI", "who cites this paper", "get me the PDF", "search PubMed", "search arXiv" | `paper-lookup` |
| "find a dataset for X", "is there a tool that does X", "find the code for this paper" | `research-lookup` |
| "is this study any good", "critique this methodology", "what are the confounders here", "GRADE" | `scientific-critical-thinking` |
| "help me come up with research ideas", "what should I work on next" | `scientific-brainstorming` |
| "turn this into a testable hypothesis", "what is my null hypothesis" | `hypothesis-generation` |
| "design the experiment", "what controls do I need", "randomisation" | `experimental-design` |
| "how many subjects do I need", "power analysis", "sample size" | `statistical-power` |
| "analyse this data", "run the stats on my results", "make a table from this CSV" | `oleafly-data-analysis` |
| "explore this dataset first", "what is in this data" | `exploratory-data-analysis` (after `oleafly-data-analysis`) |
| "which test should I use", "fit a model", "report the effect size" | `statistical-analysis` (after `oleafly-data-analysis`) |

## Authoring

| The user says | Load |
|---|---|
| "start a paper", "set up the manuscript", "scaffold the sections" | `oleafly-manuscript-scaffold` |
| "write the related work", "write the background section", "cover the prior art" | `oleafly-related-work` |
| "check my citations", "are these claims supported", "did I make that up" | `oleafly-verify-claims` |
| "clean up my bib file", "there are duplicate references", "reformat the bibliography" | `citation-management` |
| "improve the writing", "does this follow IMRaD", "which reporting guideline applies" | `scientific-writing` |
| "it will not compile", "fix these LaTeX errors", "the build is broken" | `oleafly-latex-build` |
| "start from the NeurIPS template", "make this look like a Springer paper" | `template-generate` |
| "what are the formatting rules for this venue" | `venue-templates` |
| "I have a PDF I want to edit", "convert this PDF to LaTeX" | `pdf-to-latex` |
| "tidy up this imported source", "this came out of Word and it is a mess" | `import-refine` |

## Figures

| The user says | Load |
|---|---|
| "make a figure for this", "the figure is the wrong size", "my figure will not place" | `oleafly-figure-prep` |
| "plot this data", "make a bar chart of the results" | `scientific-visualization` |
| "draw a diagram of the pipeline", "I need a schematic of the architecture" | `scientific-schematics` |

## Review

| The user says | Load |
|---|---|
| "review my paper", "read this like a reviewer would", "what would a referee say" | `oleafly-review-manuscript` |
| "write a referee report for this submission" | `peer-review` |
| "is this a good venue", "how strong is this author's record" | `scholar-evaluation` |
| "is this claim actually supported by that citation" | `oleafly-verify-claims` |

## Submission

| The user says | Load |
|---|---|
| "am I ready to submit", "check the page limit", "is this anonymous enough" | `oleafly-pre-submission` |
| "write the response to reviewers", "rebuttal", "answer reviewer 2" | `oleafly-response-letter` |
| "write the grant proposal", "the funder wants a data management plan" | `research-grants` |

## Communication

| The user says | Load |
|---|---|
| "make slides from the paper", "I need a poster for the conference" | `oleafly-slides-and-posters` |
| "build the Beamer deck" | `scientific-slides` |
| "build the poster in PowerPoint" | `pptx-posters` |

## Tooling

| The user says | Load |
|---|---|
| "run this with orx", "start an OpenResearch experiment", "check my run logs" | `openresearch` |

## When nothing matches

Do the work with the native tools and say which stage you are in. Loading a skill that does not fit costs the user context and buys nothing. If the request is a single lookup, answer it with `literature_search`, `verify_citation` or `project_library_search` directly.
