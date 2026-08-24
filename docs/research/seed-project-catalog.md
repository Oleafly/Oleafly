# Real-world project catalog for developer seed data

Research date: 2026-08-23

## Outcome

Use the 33 pinned upstream projects below as developer-only seed fixtures. The
catalog covers every current Oleafly document engine and project kind:

| Coverage | Catalog result |
|---|---:|
| Typst documents | 10 |
| Markdown / Pandoc documents | 5 |
| LaTeX documents | 15 |
| Standalone LaTeX image projects | 3 |
| Total seed projects | **33** |

The LaTeX set includes bundled Tectonic candidates and system `latexmk`
projects for pdfLaTeX, XeLaTeX, LuaLaTeX, `minted`, and PythonTeX. The source
mix includes papers, theses, books, laboratory reports, presentations, CVs,
JOSS submissions, technical specifications, and standalone figures. Figure
coverage includes raster photos and screenshots, SVG and PDF vector art,
TikZ architecture diagrams, scientific plots, tables, equations, code
listings, neural-network diagrams, and bibliographies.

This matches Oleafly's backend-owned engine model and extension policy in
[Document engines](../document-engines.md) and the system-engine behavior in
[Compilation engines](../CompilationEngines.md). In particular, Oleafly stores
the bundled Tectonic engine as `xetex`, while `latexmk` selects its underlying
pdfLaTeX, XeLaTeX, or LuaLaTeX flavor from the source.

## Source and fixture policy

All research used first-party upstream repositories. Every row pins the exact
commit inspected. A seed acquisition script should copy only the paths listed
in the row, write the upstream commit and URL to a small `source.json`, retain
the applicable license file, and add an Oleafly `project.json`. Do not fetch
these repositories at application runtime.

The actions below have precise meanings:

- **Embed**: check the listed small source subset into the developer seed
  bundle.
- **Selective snapshot**: download the pinned archive during fixture
  maintenance, then retain only the listed source and representative assets.
- **Stress snapshot**: keep the real incompatibility or prerequisite intact.
  These projects are meant to test engine selection, trust prompts, missing
  tools, fonts, diagnostics, and recovery—not necessarily compile immediately
  with bundled Tectonic.

Generated PDFs, repository thumbnails, test-reference renderings, CI files,
and unrelated software source should normally be excluded. Upstream licenses
are recorded even though these fixtures are local-development-only. Projects
with non-permissive content are kept because they exercise uniquely useful
real-world cases; their license file and attribution should travel with the
snapshot.

## Recommended catalog

### Typst

| # | Project and pinned source | License | Kind / main file | Representative files and real-world characteristics | Action |
|---:|---|---|---|---|---|
| 1 | [Typst `charged-ieee` 0.1.4](https://github.com/typst/packages/tree/01c8cd53646ff6d8e20c03008f992a8665bce839/packages/preview/charged-ieee/0.1.4) | [MIT-0](https://github.com/typst/packages/blob/01c8cd53646ff6d8e20c03008f992a8665bce839/packages/preview/charged-ieee/0.1.4/LICENSE) | IEEE research paper; `template/main.typ` | `lib.typ`, `template/refs.bib`; two columns, authors, abstract, citations, math, native figure and table | **Embed**; omit thumbnail |
| 2 | [Fudan Typst Thesis](https://github.com/fudan-kit/fudan-typst-thesis/tree/3a92147c6ac53b096b50f989897a1241b51a0115) | [GPL-3.0](https://github.com/fudan-kit/fudan-typst-thesis/blob/3a92147c6ac53b096b50f989897a1241b51a0115/LICENSE) | Bilingual university thesis; `main.typ` | `chapters/`, `template/thesis.typ`, `ref/references.bib`, `figures/neural-network.png`, `images/fudan-name.png`; CJK, blind review, equations, numbered figures/tables | **Selective snapshot**; omit `main.pdf` |
| 3 | [Poznań University of Technology Thesis](https://github.com/RoyalDonkey/typst-put-thesis/tree/3c1098d80c39ac40548843df4c4dbba2196b2fab) | [`MIT AND MIT-0`](https://github.com/RoyalDonkey/typst-put-thesis/blob/3c1098d80c39ac40548843df4c4dbba2196b2fab/typst.toml) | Official bachelor/master thesis; `template/thesis.typ` | `template/chapters/`, `template/references.bib`, `template/img/plot.svg`, selected `assets/*.svg`; multi-file, bilingual, vector plot | **Embed** source and content SVG; branding is optional |
| 4 | [PKU Thesis](https://github.com/pku-typst/pkuthss-typst/tree/41d60faa8c3134008a1e28b67a432dba5c3fae0c) | [MIT](https://github.com/pku-typst/pkuthss-typst/blob/41d60faa8c3134008a1e28b67a432dba5c3fae0c/LICENSE) | Chinese dissertation; `template/main.typ` | `template.typ`, `thesis.typ`, `template/ref.bib`, `pkulogo.svg`; deep modular structure, CJK, university layout | **Selective snapshot** |
| 5 | [Modern CV](https://github.com/ptsouchlos/modern-cv/tree/f4e21240f030d7ecbeb656094e97abf8146b9299) | [MIT](https://github.com/ptsouchlos/modern-cv/blob/f4e21240f030d7ecbeb656094e97abf8146b9299/LICENSE) | CV / resume; `template/resume.typ` | `lib.typ`, `template/assets/profile.png`, `logo.jpg`, `signature.png`; grid layout, icons, raster profile | **Embed** template subset; tests package imports and assets |
| 6 | [Touying](https://github.com/touying-typ/touying/tree/3d5332b0d992bee8581df4c88e6e32bf7d23c143) | [MIT](https://github.com/touying-typ/touying/blob/3d5332b0d992bee8581df4c88e6e32bf7d23c143/LICENSE) | Technical presentation; `examples/example.typ` | `src/`, `logo.png`; slides, overlays, incremental content, code and bibliography | **Selective snapshot**; exclude test reference PNGs |
| 7 | [Faithful ACM article](https://github.com/fzaiser/faithful-acmart/tree/7f36f942b0901b77908460a6fec0a21035a3c867) | [MIT; template MIT-0](https://github.com/fzaiser/faithful-acmart/blob/7f36f942b0901b77908460a6fec0a21035a3c867/LICENSE) | ACM paper; `template/main.typ` | `lib.typ`, `src/`, `template/refs.bib`; two-column publication metadata, accessible-tag behavior, citations | **Selective snapshot**; omit LaTeX oracle PDFs and thumbnails |
| 8 | [ZJU Project Report](https://github.com/memset0/ZJU-Project-Report-Template/tree/ed3bcafb9c81d42f07e40cbc23eae5a368b5e704) | [MIT](https://github.com/memset0/ZJU-Project-Report-Template/blob/ed3bcafb9c81d42f07e40cbc23eae5a368b5e704/LICENSE) | Real digital-design laboratory report; `examples/dd/report.typ` | `template.typ`, `examples/dd/images/logisim.jpg`; source listings, screenshots, tables, hardware diagrams | **Embed** this one example; strong real coursework fixture |
| 9 | [TU Dresden Thesis](https://github.com/typst-tud/tud-thesis/tree/338c7cc22fa5a70d0bc34d244d2bf5aea435d819) | [Apache-2.0](https://github.com/typst-tud/tud-thesis/blob/338c7cc22fa5a70d0bc34d244d2bf5aea435d819/LICENSE) | Thesis / paper; `example/example.typ` | `tud-thesis.typ`, `utils.typ`, `example/bibliography.bib`, `logos/*.svg`; bibliography and SVG assets | **Embed**; also tests font fallback and branding paths |
| 10 | [Modern UiT Thesis](https://github.com/mrtz-j/typst-thesis-template/tree/57de448c8f1ba8dd16db6ab3800af31c6d660fa5) | [MIT](https://github.com/mrtz-j/typst-thesis-template/blob/57de448c8f1ba8dd16db6ab3800af31c6d660fa5/LICENSE) | Rich multi-file thesis; `template/thesis.typ` | `template/chapters/`, `template/refs.bib`, `dining_philosophers.png`, `philosophers.png`, `plot_serial.svg`, `uit_aurora.jpg`, `lib.typ`, `modules/` | **Selective snapshot**; best Typst mixed-figure stress project |

### Markdown / Pandoc

These are real research-software papers, not generic README files. Their YAML
metadata, citations, figures, and compact source shape are close to what a
Pandoc user is likely to import.

| # | Project and pinned source | License | Kind / main file | Representative files and real-world characteristics | Action |
|---:|---|---|---|---|---|
| 11 | [AutoRA JOSS paper](https://github.com/AutoResearch/autora-paper/tree/0e29289dbf8625ed69b4fbdf2dac6960194b2594) | [MIT](https://github.com/AutoResearch/autora-paper/blob/0e29289dbf8625ed69b4fbdf2dac6960194b2594/LICENSE) | Research-software paper; `paper.md` | `paper.bib`, `figure.png`, `figure.pdf`; YAML author metadata, citation keys, same figure in raster/vector forms | **Embed**; omit generated `paper.pdf` |
| 12 | [pvlib JOSS update](https://github.com/pvlib/pvlib-python/tree/f02515571ab9d7cba2cab9af0c7e1c8155b10323/paper) | [BSD-3-Clause](https://github.com/pvlib/pvlib-python/blob/f02515571ab9d7cba2cab9af0c7e1c8155b10323/LICENSE) | Photovoltaics research-software paper; `paper/paper.md` | `paper/paper.bib`, `community.pdf`, `functions_06_010.pdf`, `timeline2.pdf`; multi-author metadata and vector scientific figures | **Selective snapshot** from `paper/` only |
| 13 | [LobsterPy JOSS paper](https://github.com/JaGeo/LobsterPy/tree/cb39f3a129ac1016beb6947c5b316de87a88d644/paper) | [BSD-3-Clause](https://github.com/JaGeo/LobsterPy/blob/cb39f3a129ac1016beb6947c5b316de87a88d644/LICENSE) | Computational-materials paper; `paper/paper.md` | `paper/paper.bib`, selected `docs/tutorial/tutorial_assets/{COHP.png,ICOHP.png,DOS_example.png}`; chemistry citations and scientific plots | **Selective snapshot**; do not copy the software package |
| 14 | [Rubi JOSS paper](https://github.com/RuleBasedIntegration/JOSS-Publication/tree/339f219fd8f4091531623f848aa34cb8bc9fd22c) | [MIT](https://github.com/RuleBasedIntegration/JOSS-Publication/blob/339f219fd8f4091531623f848aa34cb8bc9fd22c/LICENSE) | Symbolic-integration paper; `paper.md` | `paper.bib`, `figure1.pdf`; compact mathematics-heavy Markdown and custom CSL input | **Embed** |
| 15 | [ExaFMM JOSS paper](https://github.com/exafmm/exafmm-t/tree/ed6d0ecc3f72b43d4945bfa2c1f3cdd1b5a5dbaa) | [BSD-3-Clause](https://github.com/exafmm/exafmm-t/blob/ed6d0ecc3f72b43d4945bfa2c1f3cdd1b5a5dbaa/LICENSE) | Numerical-methods paper; `paper.md` | `paper.bib`; very small, citation-heavy manuscript with no required image asset | **Embed** only paper, bibliography, and license |

### LaTeX documents

Rows marked `xetex` below mean Oleafly's bundled Tectonic project engine, not a
request to run the XeTeX executable. Projects whose upstream workflow requires
a system distribution are intentionally marked `latexmk`.

| # | Project and pinned source | License | Oleafly engine / kind / main file | Representative files and real-world characteristics | Action |
|---:|---|---|---|---|---|
| 16 | [Ethereum Yellow Paper](https://github.com/ethereum/yellowpaper/tree/efc5f9a1f356cba376c978eedb63cb0363c2aa85) | [CC-BY-SA-4.0](https://github.com/ethereum/yellowpaper/blob/efc5f9a1f356cba376c978eedb63cb0363c2aa85/LICENCE.md) | `xetex`; technical specification; `Paper.tex` | `JS.tex`, `Wire.tex`, `Biblio.bib`; uppercase main filename, dense equations, custom macros, TikZ, multi-file references | **Embed**; excellent case-sensitivity/index fixture |
| 17 | [OSMnx reference paper](https://github.com/gboeing/osmnx-paper/tree/f89987278cb8fe9af9d6af82b17058039aaf9d86) | [MIT](https://github.com/gboeing/osmnx-paper/blob/f89987278cb8fe9af9d6af82b17058039aaf9d86/LICENSE) | `xetex`; real journal paper; `osmnx-paper.tex` | `references.bib`, `fig_graph_simplification.png`, `fig_street_orientations.png`, `fig_figure_ground.jpg`; plots, map/network diagrams, photo-like raster | **Embed** complete small repo |
| 18 | [VTA/TVM FPGA ReQuEST paper](https://github.com/ctuning/ck-request-asplos18-resnet-tvm-fpga/tree/a163b6baf3272b95d7771368f962747cda4f71af/dissemination.publication/9375838469ad4029) | [BSD-3-Clause repo](https://github.com/ctuning/ck-request-asplos18-resnet-tvm-fpga/blob/a163b6baf3272b95d7771368f962747cda4f71af/LICENSE.txt); paper source states CC-BY-4.0 | `xetex`; ACM research paper; `dissemination.publication/9375838469ad4029/paper.tex` | `paper_abstract.tex`, `paper.bib`, `figures/exp_fpga_e2e.pdf`, `vta_overview.pdf`, `vta_roofline.pdf`; multi-file ACM source and vector plots | **Embed** publication directory and license |
| 19 | [Scientific Visualization book](https://github.com/rougier/scientific-visualization-book/tree/62fa569f30333c817c13e4dc757877c1192fd15a) | [Book CC-BY-NC-SA-4.0; code BSD-2-Clause](https://github.com/rougier/scientific-visualization-book/blob/62fa569f30333c817c13e4dc757877c1192fd15a/LICENSE.txt) | `xetex`; technical book; `tex/book.tex` | `tex/book.bib` plus five curated figures from `figures/` covering PNG, JPG, vector PDF, color gradients, plots, and 3D | **Selective snapshot**; full repository is intentionally too large |
| 20 | [Category Theory for Programmers PDF](https://github.com/hmemcpy/milewski-ctfp-pdf/tree/01d9453871c59e08130136f936aaa0ca10de71cb) | [TeX/content CC-BY-SA-4.0](https://github.com/hmemcpy/milewski-ctfp-pdf/blob/01d9453871c59e08130136f936aaa0ca10de71cb/LICENSE) | `xetex`; technical book; `src/ctfp.tex` | `src/preamble.tex`, `src/category.tex`, one representative `src/content/*` chapter and its diagram images; deep includes, index, many cross-references | **Selective snapshot** of one coherent chapter slice |
| 21 | [The Art of Linear Algebra](https://github.com/kenjihiranabe/The-Art-of-Linear-Algebra/tree/0b1d5a5b55ebe29da26f6222764600ffedddae9f) | [CC0-1.0](https://github.com/kenjihiranabe/The-Art-of-Linear-Algebra/blob/0b1d5a5b55ebe29da26f6222764600ffedddae9f/LICENSE) | `xetex`; mathematical visual notes; `The-Art-of-Linear-Algebra.tex` | `MatrixWorld.png`, `MapofEigenvalues.png`, selected `figs/`; dense diagram layout, annotations, CJK variants | **Selective snapshot**; strongest image-heavy LaTeX document |
| 22 | [Metropolis Beamer](https://github.com/matze/mtheme/tree/2fa6084b9d34fec9d2d5470eb9a17d0bf712b6c8) | [CC-BY-SA-4.0](https://github.com/matze/mtheme/blob/2fa6084b9d34fec9d2d5470eb9a17d0bf712b6c8/README.md#license) | `xetex` after materializing theme `.sty`; presentation; `demo/demo.tex` | `demo/demo.bib`, `demo/logo.pdf`, generated theme styles from `source/`; Beamer, progress bars, code and bibliography | **Selective/generated snapshot**; generate `.sty` at fixture-maintenance time |
| 23 | [GIPPLab scientific paper](https://github.com/gipplab/latexPaperTemplate/tree/65aaf64bc379eadf33352a84fb8bf33e102f68cc) | [Apache-2.0](https://github.com/gipplab/latexPaperTemplate/blob/65aaf64bc379eadf33352a84fb8bf33e102f68cc/LICENSE) | `xetex`; modular paper; `article_preprint.tex` | `01_title.tex`, `02_abstract.tex`, `03_mainmatter.tex`, `short.bib`; numbered partials, alternate ACM/LLNCS entry points | **Embed**; tests main-document switching |
| 24 | [Dissertate](https://github.com/suchow/Dissertate/tree/2e92853c603cc9c8f56598dea26c5a0bce0f440b) | [AGPL-3.0](https://github.com/suchow/Dissertate/blob/2e92853c603cc9c8f56598dea26c5a0bce0f440b/LICENSE) | `latexmk` / XeLaTeX; dissertation; `assets/latex-base/dissertation.tex` | `frontmatter/`, `chapters/`, `references.bib`, `figures/fig1.pdf`, `fig2.pdf`; custom fonts/classes, many includes, institutional variants | **Stress snapshot**; preserve font prerequisite |
| 25 | [Tsinghua Thesis](https://github.com/tuna/thuthesis/tree/fd3be474b1e66be85bcf286ea4be524b26c7e512) | [LPPL-1.3c](https://github.com/tuna/thuthesis/blob/fd3be474b1e66be85bcf286ea4be524b26c7e512/LICENSE) | `latexmk` / XeLaTeX; thesis; `thuthesis-example.tex` | `thusetup.tex`, `data/`, `ref/refs.bib`, `figures/example-image-a.pdf`; CJK, BibTeX/biblatex variants, notation, appendices | **Stress snapshot**; system packages and fonts are the test |
| 26 | [USTC Thesis](https://github.com/ustctug/ustcthesis/tree/3b0d59ccd01cc9e0fbc09a97e3748fa3f4f2dddd) | [LPPL-1.3c](https://github.com/ustctug/ustcthesis/blob/3b0d59ccd01cc9e0fbc09a97e3748fa3f4f2dddd/LICENSE) | `latexmk` / XeLaTeX; thesis; `main.tex` | `chapters/`, `references.bib`, `figures/ustc-logo.pdf`; equations, tables, citations, scanned declarations, CJK | **Stress snapshot**; omit generated/scanned declarations unless testing PDF inclusion |
| 27 | [Awesome-CV](https://github.com/posquit0/Awesome-CV/tree/8b850b477803a929a6dd74a74e3d5ab6b735d869) | [LPPL-1.3c](https://github.com/posquit0/Awesome-CV/blob/8b850b477803a929a6dd74a74e3d5ab6b735d869/LICENSE) | `latexmk` / XeLaTeX or LuaLaTeX; CV; `examples/cv.tex` | `awesome-cv.cls`, `examples/cv/*.tex`, `examples/profile.png`; font discovery, icons, many source partials, image clipping | **Stress snapshot**; valuable missing-font UX case |
| 28 | [University of Aveiro Thesis](https://github.com/ruiantunes/ua-thesis-template/tree/58da041f0a317495b80abfc5f337bcd68e77b16e) | [AGPL-3.0](https://github.com/ruiantunes/ua-thesis-template/blob/58da041f0a317495b80abfc5f337bcd68e77b16e/COPYING.txt) | `latexmk` / **LuaLaTeX**; thesis; `main.tex` | `uathesis.sty`, `refs.bib`, `tex/config/`, `tex/contents/`, selected `img/logos/*.pdf`; multilingual, long table, appendices | **Stress snapshot**; explicit LuaLaTeX engine coverage |
| 29 | [XDP paper](https://github.com/tohojo/xdp-paper/tree/672dc5ad9022229ead875c605e1ff030dee02bee) | [`\setcopyright{ccbysa}` in paper source](https://github.com/tohojo/xdp-paper/blob/672dc5ad9022229ead875c605e1ff030dee02bee/xdp-paper.tex) | `latexmk` / pdfLaTeX + shell escape; systems paper; `xdp-paper.tex` | `xdp.bib`, `figures/kernel-diagram.svg`, `drop-cpu.pdf`, `xdp-execution-diagram.svg`; `minted`, ACM class, algorithms, many vector plots | **Stress snapshot**; tests engine picker and per-project shell trust |
| 30 | [PythonTeX gallery](https://github.com/gpoore/pythontex/tree/78c98144145150b6884e3e68159fa8b95bc53c1d) | [LaTeX LPPL-1.3; Python BSD-3-Clause](https://github.com/gpoore/pythontex/blob/78c98144145150b6884e3e68159fa8b95bc53c1d/pythontex/pythontex.dtx) | `latexmk` / pdfLaTeX + PythonTeX; executable technical gallery; `pythontex_gallery/pythontex_gallery.tex` | `pythontex_gallery/myplot.png` and the PythonTeX runtime subset; executed code, generated plots, scientific dependencies | **Stress snapshot**; trusted-project and supervised-process coverage |

### Standalone image projects

Oleafly currently advertises the `image` project kind only for its LaTeX
descriptor. These three upstream files use the `standalone` class and need no
external images, which makes them unusually clean real fixtures for preview,
PNG/SVG export, cropping, and large-canvas behavior. OpenTikZ applies
[CC0-1.0 to content](https://github.com/opentikz/opentikz/blob/359befbf8e8af7ce08e7e387b2c2a198e0ca735d/LICENSE-CONTENT).

| # | Project and pinned source | Oleafly engine / kind / main file | Figure characteristics | Action |
|---:|---|---|---|---|
| 31 | [FlashAttention diagram](https://github.com/opentikz/opentikz/blob/359befbf8e8af7ce08e7e387b2c2a198e0ca735d/examples/flash-attention/figure.tex) | `xetex`; `image`; `figure.tex` | Wide two-panel memory hierarchy and matrix/dataflow diagram; loops, braces, arrows, repeated cells, equations | **Embed** the single source file and content license |
| 32 | [GAN diagram](https://github.com/opentikz/opentikz/blob/359befbf8e8af7ce08e7e387b2c2a198e0ca735d/examples/gan/figure.tex) | `xetex`; `image`; `figure.tex` | Neural-network generator/discriminator architecture; trapezoids, stacked planes, decision lights, parameterized layout | **Embed** as a separate project |
| 33 | [LoRA diagram](https://github.com/opentikz/opentikz/blob/359befbf8e8af7ce08e7e387b2c2a198e0ca735d/examples/lora/figure.tex) | `xetex`; `image`; `figure.tex` | Very wide training/merge architecture with matrices, math labels, braces, bars, and multiple visual zones | **Embed** as a separate project; best large-canvas regression fixture |

## Expected pain points exposed by the catalog

| Pain point | Projects that exercise it |
|---|---|
| Main-document detection, casing, and alternate entry points | Ethereum `Paper.tex`, GIPPLab ACM/LLNCS/preprint files, PKU and Fudan nested modules |
| Engine selection and actionable incompatibility reporting | XDP `minted`, PythonTeX, Tsinghua/USTC XeLaTeX, Aveiro LuaLaTeX |
| Explicit trust and process supervision | XDP shell escape and PythonTeX code execution |
| Missing or nonportable fonts | Fudan/PKU CJK, Dissertate, Awesome-CV, institutional Typst projects |
| Bibliography indexing and unresolved references | All five JOSS papers, charged-ieee, Yellow Paper, theses, books |
| Large and mixed assets | Scientific Visualization, Modern UiT, OSMnx, Art of Linear Algebra |
| Raster/vector parity and export | AutoRA's PNG/PDF pair, PUT SVG plot, OpenTikZ standalone figures |
| Multi-file navigation, rename, and search | Category Theory book, GIPPLab paper, Fudan/PUT/PKU/Tsinghua/USTC theses |
| CJK editing and PDF output | Fudan, PKU, Tsinghua, USTC |
| Project-kind-specific UI and exports | OpenTikZ image projects versus every document project |
| Typst package acquisition and offline messaging | charged-ieee, Touying, Faithful ACM, PUT thesis |
| Markdown YAML metadata and Pandoc citations | AutoRA, pvlib, LobsterPy, Rubi, ExaFMM |

## Implementation recommendation

Seed in two tiers so routine development remains fast without losing the hard
cases:

1. **Core 15:** charged-ieee, Fudan, PUT, ZJU, Modern UiT, all five Markdown
   papers, Ethereum, OSMnx, XDP, and two OpenTikZ figures.
2. **Extended 18:** the remaining projects, created by the same reset-and-seed
   action but allowed to report explicit prerequisites instead of silently
   changing engines or stripping features.

Use the source commit in the display name or `source.json`, but keep the
human-facing project name natural. Seeding should be idempotent by a stable
fixture ID rather than by project name, because renaming a project is itself a
normal user action. Every snapshot should be built and checksummed ahead of
time; the desktop seed action should only copy local fixture data into the
isolated `.oleafly-dev` library.

Run `pnpm seed:research:sync` once, or whenever a pinned source changes, to
populate `~/Codespace/Oleafly/oleafly-seed`. The Developer settings action
only imports the revisioned ZIP files from that local cache. It performs no
network requests, and the seeder is excluded from production builds.
