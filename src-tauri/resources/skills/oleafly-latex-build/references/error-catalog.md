# Error catalog

Match the first error in the log to a row. The line number LaTeX reports is where it noticed, not always where the mistake is, so read that line and upward.

## LaTeX source errors

| Log pattern | Cause | Fix | Tool call |
|---|---|---|---|
| `Undefined control sequence` | Misspelled command, or the package that defines it is not loaded | Check spelling, then add the `\usepackage` | `replace_in_file` on the preamble |
| `Missing $ inserted` | A math command or `_` / `^` used in text mode, or an unclosed `$` | Wrap in `$...$`, or escape a literal underscore as `\_` | `replace_in_file` |
| `Missing } inserted` or `Too many }'s` | Unbalanced braces, often a `\left(` with no `\right)` | Count braces on the reported line and above | `read_file` around the line, then `replace_in_file` |
| `\begin{X} ended by \end{Y}` | Crossed environment nesting | Fix the nesting order | `replace_in_file` |
| `Runaway argument?` | A brace opened inside a command argument and never closed | Find the unclosed `{` | `search_project` for the command name |
| `File 'X.sty' not found` | The package is not in the active bundle or distribution | Name it. Tectonic pulls from a pinned TeX Live bundle and cannot install extras; system TeX can, through the user's own tlmgr | report, do not silently drop the package |
| `Option clash for package X` | The package is loaded twice with different options | Load it once with merged options, or use `\PassOptionsToPackage` before `\documentclass` | `replace_in_file` |
| `Command \X already defined` | `\newcommand` on a name LaTeX or the class already owns, `\day` and `\date` are classic | `\renewcommand`, or rename the macro | `replace_in_file` |
| `There's no line here to end` | A `\\` where a paragraph break belongs | Delete the `\\` and use a blank line | `replace_in_file` |
| `Paragraph ended before \X was complete` | A blank line inside a command argument | Remove the blank line | `replace_in_file` |
| `Extra alignment tab has been changed to \cr` | More `&` than the column spec allows, or a literal `&` in prose | Fix the column count, or escape as `\&` | `replace_in_file` |
| `Float(s) lost` | A figure or table inside a box or minipage | Move the float out, or use `[H]` from the `float` package | `replace_in_file` |
| `Dimension too large` | An oversized image or a TikZ coordinate overflow | Scale down | `replace_in_file` |
| `Package hyperref Warning: Token not allowed` | Math or a fragile command inside a section heading | `\texorpdfstring{$\alpha$}{alpha}` | `replace_in_file` |
| `Unicode character ... not set up for use with LaTeX` | Pasted Unicode under a pdfLaTeX build (`latexmk` engine) | Replace with the LaTeX equivalent, or move the project to Tectonic which is Unicode native | `replace_in_file` |
| `LaTeX Warning: Reference 'x' undefined` | Missing `\label`, a typo, or a first pass that has not settled | Compile again. If it persists, `project_map` lists `unresolvedRefs` | `compile`, then `project_map` |

## Bibliography

| Log pattern | Cause | Fix | Tool call |
|---|---|---|---|
| `Citation 'x' undefined` | The key is not in any `.bib`, or the bibliography step did not run | Check the key against `project_map` `bibKeys`, then compile again | `project_map`, `compile` |
| `errors were issued by BibTeX, but were ignored` | Usually an empty `.bib`, or nothing cited yet | Harmless while the bibliography is still empty. It stops once a real entry is cited | none |
| `main.bbl:NN: LaTeX Error: Something's wrong--perhaps a missing \item.` | BibTeX wrote an empty or broken `.bbl`. `IEEEtran.bst` does this when no entry is cited | Remove `\bibliography{...}` until `references.bib` has a cited entry, or add the entry | `replace_in_file` |
| `Found biblatex control file version A, expected version B` | biblatex and Biber are out of step | Inside Oleafly this should not happen, the app ships a pinned `tectonic-biber` and re-runs it when Tectonic misses it. Quote the `[Oleafly]` note from the log. Outside Oleafly, move to natbib plus BibTeX | report |
| `I found no \citation commands` | Nothing in the document cites anything | Expected in a fresh scaffold | none |
| `Empty bibliography` warning | `.bib` exists but has no matching entries | Add real entries. Never invent bibliographic data; verify with `verify_citation` | `write_file` on the `.bib` |

## Fonts

| Log pattern | Cause | Fix | Tool call |
|---|---|---|---|
| `accessing absolute path '/System/Library/Fonts/...'; build may not be reproducible` | The build resolved a font from this machine | For CJK, pass `fontset=fandol` as a documentclass option. For Latin display fonts, put the files in the project and point `fontspec` at them with `Path=./fonts/` | `replace_in_file` |
| `Failed to load ToUnicode CMap for font` | A host font with no usable CMap. The PDF will not copy or search correctly | Same fix as above | `replace_in_file` |
| `Font ... not found` under Tectonic, or the text silently keeps the default face | `\setmainfont{Name}` relies on system font discovery, which Tectonic does not do reliably | Use the explicit form: `\setmainfont{Lato}[Path=./fonts/, Extension=.ttf, UprightFont=*-Regular, BoldFont=*-Bold, ItalicFont=*-Italic, BoldItalicFont=*-BoldItalic]` | `replace_in_file` |
| Tectonic aborts with exit 134 on an icon font | Known crash on the FontAwesome OTF in some Tectonic versions. This is an engine crash, not a missing font | Drop the icon font. Build the same look with TikZ and xcolor, or plain text labels | `replace_in_file` |
| `fontspec` errors under the `latexmk` engine | fontspec needs XeLaTeX or LuaLaTeX, and latexmk defaults to pdfLaTeX | Add `% !TeX program = xelatex` at the top of the main file | `replace_in_file` |

## Typst

Typst reports `file:line:col: error: message` with `--diagnostic-format short`, which is what Oleafly passes.

| Message | Cause | Fix |
|---|---|---|
| `unknown variable: x` | A function or variable that does not exist, often a v0.x API that moved | Check the current Typst syntax rather than translating LaTeX habits |
| `cannot reference equation without numbering` | A labelled equation in a document with no equation numbering | `#set math.equation(numbering: "(1)")` |
| `expected X, found Y` | A content block where a value was expected, or the reverse | Read the offending argument. Typst distinguishes `[content]` from `(value)` strictly |
| `failed to load file` on `bibliography(...)` | The `.bib` is missing or empty | Add the file with at least one entry before adding the call |
| `package not found` or a hang on first compile | An `@preview` import needs network on first use | Prefer built-in Typst features. Oleafly reports Typst as not offline capable for exactly this reason |
| `file not found (searched at ...)` | A path outside the project root | Typst is run with `--root` at the project directory. Keep every path inside it |

Typst has no SyncTeX, so an error location cannot be clicked through to the PDF. Read the reported line directly.

## Markdown and Pandoc

| Symptom | Cause | Fix |
|---|---|---|
| Compile reports Pandoc missing | Pandoc is not installed | Tell the user; the app downloads it on demand |
| A raw LaTeX block does not render | Pandoc passes some raw blocks through and drops others | Simplify to Markdown constructs, or move the project to LaTeX |
| Citations do not resolve | The `.bib` was not discovered | Every `.bib` in the project is passed to Pandoc automatically. Check the file is inside the project |

## latexmk and system TeX

| Symptom | Cause | Fix |
|---|---|---|
| A shell escape package (`minted`, `pythontex`) errors | Shell commands are blocked by default | Only the user can grant this, per project and per machine, in Settings |
| A `.latexmkrc` is ignored | Project, user and system `.latexmkrc` files are disabled on purpose because they are executable Perl | Move the configuration into the document or ask the user |
| `latexmk: command not found` | No system TeX distribution is on this machine | The app can install TinyTeX from Settings. On Windows, `tlmgr` ships only as `tlmgr.bat`, so a lookup that tries `.exe` alone will miss it |
| A coauthor gets a different bibliography | Different TeX distribution or package versions | `project.json` records the pinned distribution and `tlmgr` package versions. Compare the two machines' latest records under `.oleafly/builds/` |

## When nothing matches

1. Read the first error, not the last.
2. `read_file` the reported line with a few lines of context above it.
3. Look for the usual silent culprits: an unescaped `%` eating the rest of a line (text mysteriously missing is almost always this), an unescaped `&`, an `_` in text mode inside a file name or URL, straight quotes instead of `` `` `` and `''`.
4. Bisect: `write_file` a copy of the main document with `\end{document}` moved halfway up, compile, and narrow down. Restore the original when you are done.
5. If references or the table of contents behave impossibly, the auxiliary files are stale. Compile once more before drawing conclusions.

## Silent bugs that compile

- `\label` before `\caption` gives wrong reference numbers. `\label` goes after.
- `$$...$$` breaks vertical spacing. Use `\[...\]`.
- `\ref` without a preceding `~` lets a line break fall between the word and the number.
- `|` for norms and conditionals spaces badly. Use `\lvert`, `\mid`, `\lVert`.
- `hyperref` loaded early breaks other packages. It goes second to last, `cleveref` last.
- `\it` and `\bf` do not nest and lose italic correction. Use `\textit` and `\textbf`.
- `subfigure` and `subfig` conflict with modern classes. Use `subcaption`.
