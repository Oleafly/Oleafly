# Venue map

One row per venue family. Read the vendored reference before writing anything, then start from the file in the last column.

Read vendored files with `read_skill_file`, passing the vendored skill id and a relative path, for example id `venue-templates` and path `references/ml_conference_style.md`.

## Machine learning and vision conferences

NeurIPS, ICML, ICLR, CVPR, ECCV, ICCV, AAAI, IJCAI.

- Guidance: `venue-templates/references/ml_conference_style.md`, plus `references/conferences_formatting.md` for the year's rules.
- Vendored scaffold: `venue-templates/assets/journals/neurips_article.tex`. It is a wrapper and expects the official style file, so it only compiles once the user has dropped that file into the project.
- Fallback that compiles today: `assets/article.tex` from this skill, with `\usepackage[margin=1in]{geometry}`.
- Engine: `xetex`.
- Bibliography: whatever the official style package ships, usually natbib with a supplied `.bst`. Do not swap a venue's `.bst` for biblatex.
- Watch for: anonymity in the initial submission, a page limit that excludes references, a checklist or broader-impact section, and a supplementary PDF with its own rules.

## Other CS conferences

ACL, EMNLP, NAACL, CHI, CSCW, KDD, WWW, SIGIR, USENIX, SIGCOMM.

- Guidance: `venue-templates/references/cs_conference_style.md` and `references/conferences_formatting.md`.
- Scaffold: `assets/ieee-style-two-column.tex` for a two-column look, or the official kit when the user has it.
- Engine: `xetex`.
- Bibliography: natbib plus the venue's `.bst`, or `\bibliographystyle{plainnat}` while drafting.
- Watch for: ACM venues want `acmart` with the right class option (`sigconf`, `sigplan`, `acmsmall`); Oleafly bundles an `acm` starter template in New Project.

## IEEE conferences and journals

- Guidance: `venue-templates/references/journals_formatting.md`.
- Scaffold: `assets/ieee-style-two-column.tex`. It uses `IEEEtran`, which is present in Tectonic's TeX Live bundle, so it compiles with no extra downloads.
- Fallback if `IEEEtran` is ever unavailable: `\documentclass[10pt,twocolumn]{article}` with `\usepackage[margin=0.75in]{geometry}` and `\usepackage{balance}` left out. Say clearly that the result only resembles the IEEE layout and is not submission ready.
- Engine: `xetex`.
- Bibliography: `\bibliographystyle{IEEEtran}` with BibTeX, added only after `references.bib` has a cited entry. Verified failure mode with an empty bibliography: `main.bbl:24: LaTeX Error: Something's wrong--perhaps a missing \item.`

## Elsevier journals

- Guidance: `venue-templates/references/journals_formatting.md`.
- Vendored scaffold: `venue-templates/assets/journals/elsarticle-template-num.tex`, `elsarticle-template-num-names.tex`, `elsarticle-template-harv.tex`, with the matching `elsarticle-*.bst` next to them in `venue-templates/assets/journals/`.
- Copy the `.tex` and the one `.bst` you need into the project with `write_file`.
- Engine: `xetex`. Oleafly also bundles an `elsevier` starter template.
- Bibliography: the `.bst` that matches the chosen `elsarticle` option.

## Springer

- Guidance: `venue-templates/references/journals_formatting.md`.
- Scaffold: none vendored. Use `assets/article.tex` and tell the user that Springer Nature journals and LNCS proceedings each ship their own class, which has to come from the publisher.
- Engine: `xetex`.

## Nature, Science, PNAS

- Guidance: `venue-templates/references/nature_science_style.md`.
- Vendored scaffold: `venue-templates/assets/journals/nature_article.tex`. It is a writing scaffold, not an official template.
- Engine: `xetex`.
- Watch for: a short main text with a hard word count, a separate methods section, extended data figures, and a structured summary paragraph rather than a conventional abstract.

## Cell Press

- Guidance: `venue-templates/references/cell_press_style.md`.
- Scaffold: `assets/article.tex`, plus the summary and highlights structure described in that reference.
- Engine: `xetex`.

## PLOS

- Guidance: `venue-templates/references/journals_formatting.md`.
- Vendored scaffold: `venue-templates/assets/journals/plos_one.tex`.
- Engine: `xetex`.

## Medical journals

NEJM, Lancet, JAMA, BMJ, Annals.

- Guidance: `venue-templates/references/medical_journal_styles.md`.
- Scaffold: `assets/article.tex` with a structured abstract (Background, Methods, Results, Conclusions).
- Engine: `xetex`.
- Watch for: a reporting guideline is usually mandatory (CONSORT, STROBE, PRISMA). `scientific-writing` has the selector and the coverage templates.

## arXiv preprints

- Scaffold: `assets/article.tex`.
- Engine: `xetex`.
- Watch for: arXiv builds the PDF from the source you upload, so the project must compile from a clean directory with no local-only files.

## Typst manuscripts

- Scaffold: `assets/article.typ`.
- Engine: `typst`, set by pointing `set_main_doc` at a `.typ` file.
- Limits worth stating up front: no SyncTeX, no isolated figure compile, no DOCX or PPTX export, and `@preview` packages require network on the first compile. Stay on built-in Typst features for offline work.

## Grants

- Guidance: `venue-templates/references/grants_requirements.md`.
- Vendored scaffolds: `venue-templates/assets/grants/nsf_proposal_template.tex`, `venue-templates/assets/grants/nih_specific_aims.tex`.
- Engine: `xetex`.
- Watch for: agency portals take components as separate uploads, so a single combined `.tex` is a drafting aid and not a submission. Hand deeper work to **research-grants**.

## Posters and slides

Out of scope here. Hand off to **oleafly-slides-and-posters**, which covers Beamer, tikzposter, and the vendored `pptx-posters` and `scientific-slides` skills.
