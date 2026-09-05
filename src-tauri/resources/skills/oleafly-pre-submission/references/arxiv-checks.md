# arXiv source checks

arXiv rebuilds your LaTeX source on its own machines with its own TeX installation. Most upload failures are the difference between your machine and theirs.

Anything below with a number in it (a size cap, a character limit, an announcement time) should be confirmed on the submission page at the time you upload. Numbers change.

## Engine

arXiv's AutoTeX system decides how to build your source. The default path is pdfLaTeX.

Oleafly compiles with Tectonic, which is XeTeX. That difference matters:

- A document using `fontspec`, `unicode-math`, or a system font by name will build here and fail there.
- A document using `\usepackage[T1]{fontenc}` with standard LaTeX fonts builds on both.

If the paper genuinely needs XeTeX or LuaTeX, you have two options. Make the source pdfLaTeX-compatible, or submit the PDF alone. arXiv accepts a PDF-only submission, at the cost of no HTML rendering and no source for readers.

Put `\pdfoutput=1` in the first few lines of the main file, before `\documentclass`, when the document is meant to be built to PDF. It tells AutoTeX to take the PDF path rather than the DVI path, which is what you want whenever your figures are PDF, PNG, or JPEG.

## Bibliography

arXiv does not run BibTeX or Biber. It compiles LaTeX and it expects the bibliography to already be built.

- Include the `.bbl` file in the upload.
- Including the `.bib` as well is harmless but does nothing on its own.
- With `biblatex` and `biber`, the `.bbl` format is tied to the `biblatex` version that produced it. If arXiv's `biblatex` is a different version, the build fails. The reliable options are to use `natbib` with a `.bst` and ship the `.bbl`, or to paste the formatted bibliography into the source as a `thebibliography` environment.
- Regenerate the `.bbl` after the last citation change. A stale `.bbl` produces a bibliography that silently disagrees with the text.

## Paths and file names

- No absolute paths anywhere: `\input`, `\include`, `\includegraphics`, `\bibliography`, `\graphicspath`. arXiv unpacks your files into a directory that is not yours.
- Forward slashes only. A Windows backslash path will not resolve.
- No spaces in file names.
- Plain ASCII in file names. Accented characters and other non-ASCII break the build.
- No two files whose names differ only by case. The upload can be processed on a case-insensitive filesystem and one will overwrite the other.
- No leading dots. Hidden files are removed, and you will see a "Removed hidden file" warning.
- On macOS, BSD tar embeds AppleDouble resource forks as `._filename`. arXiv strips them and warns, which is harmless, but build a clean archive anyway:

```
COPYFILE_DISABLE=1 tar czf upload.tar.gz main.tex main.bbl figures/
```

## Figures

- Use PDF, PNG, or JPEG on the pdfLaTeX path.
- EPS and PS belong to the DVI path only. Mixing them with PDF figures in one document does not work.
- Do not include both `figure.eps` and `figure.pdf`. `\includegraphics{figure}` with no extension will pick one of them, and it may not be the one you expect.
- No `.bmp` and no `.tif`. Convert them first.
- Delete figure files the document does not use. They inflate the package and occasionally confuse the build.
- Embed all fonts. Type 3 bitmap fonts, which come out of old `dvips` pipelines, render badly on screen and get flagged. Regenerate those figures with a modern toolchain.

## Package availability

arXiv runs a specific TeX Live release. A package newer than that release is not there. If the paper depends on a recent package, include the `.sty` file in the upload alongside the source. Check the licence allows redistribution before you do.

Do not include a `.sty` that arXiv already has at a different version, because the local copy wins and it may not match the class.

## Ancillary files

Supplementary material that should be available but not compiled goes in a top-level `anc/` directory. arXiv preserves that directory and offers its contents as ancillary files on the abstract page. Nothing in `anc/` is compiled or included in the paper.

Data, videos, and code that a reader might want alongside the paper belong there or in a repository with a DOI. Very large files belong in the repository, not in the submission.

## 00README

If a `00README.json` appears in the file list after upload, that is arXiv's own build-directive file. Keep it. You can also supply one yourself to fix the compile order or to mark a file as ignored.

## Abstract metadata field

The abstract you type into the submission form is separate from the abstract in the paper, and it has a hard character limit that a real abstract can exceed. Pre-condense a plain-text version: keep every number that matters, drop the "First, ... Second, ..." scaffolding and the parentheticals. Check the length before you open the form.

Inline math renders, so `$\kappa$` is fine. A bare `$` starts math mode, so write "USD 200" rather than "$200".

## Licence

The licence choice is irrevocable once the paper is announced.

For a paper that will later go to a publisher who takes a rights grant, choose the arXiv perpetual non-exclusive licence. A CC0 dedication puts the work in the public domain and conflicts with a later exclusive grant. If the final check page shows a licence you did not intend, go back to the start of the submission flow and reselect. Files and metadata are retained when you do.

## Class-specific behaviour

`acmart` re-applies its own hyperref colours at `\begin{document}`, so a `\hypersetup{urlcolor=black}` in the preamble has no effect and an ORCID-linked author name prints in ACM blue. Put the `\hypersetup` after `\begin{document}` if you want it to stick. Blue author names are ordinary `acmart` output and usually fine to leave.

## Verifying arXiv's build

The compiled preview needs the submitter's session, so you cannot fetch it from outside. Compare instead: arXiv's processing log reports the page count and the output size. Match those against your local build. The same source on the same TeX Live release differs by only a few dozen bytes, from embedded timestamps and the document ID.

If the user downloads the preview PDF on macOS, note that the system blocks terminal reads of `~/Downloads` and `~/Desktop`. Ask them to copy it into the project directory first.

## Flow notes

- HTML conversion showing "Loading" or "converting" does not block the Submit button.
- The ACM class and MSC class metadata fields use the obsolete 1998 scheme. Leave them blank for modern computer-science papers.
- "External DOI" means the journal-published version of this paper, not a Zenodo archive of the code.
- Business-day submissions before the afternoon cutoff typically announce the following evening, US Eastern time. The identifier has the form `arXiv:YYMM.NNNNN`.
