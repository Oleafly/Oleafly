export const RESEARCH_SEED_SENTINEL = "oleafly-real-research-seed-v2";

export type ResearchSeedKind = "document" | "image" | "diagram";
export type ResearchSeedEngine = "xetex" | "typst";
export type ResearchSeedFigure =
  | "algorithm"
  | "bibliography"
  | "cjk"
  | "diagram"
  | "equations"
  | "listing"
  | "plot"
  | "presentation"
  | "table";

export interface ResearchSeedProject {
  /** Fixture directory under `fixtures/research-seeds/` and the archive name. */
  slug: string;
  name: string;
  kind: ResearchSeedKind;
  engine: ResearchSeedEngine;
  mainDoc: string;
  /** Book-cover hex, drawn from the library palette in `Book.tsx`. */
  color: string;
  figureTypes: ResearchSeedFigure[];
  /** What this fixture is meant to exercise in the app. */
  summary: string;
}

export const RESEARCH_SEED_PROJECTS: ResearchSeedProject[] = [
  {
    slug: "sparse-attention-systems-paper",
    name: "Sparse Attention Systems Paper",
    kind: "document",
    engine: "xetex",
    mainDoc: "main.tex",
    color: "#1982c4",
    figureTypes: ["algorithm", "bibliography", "diagram", "equations", "plot", "table"],
    summary:
      "Two-column systems paper across six section files, with a TikZ architecture figure, a pgfplots quality curve, a ruled algorithm, and a BibTeX bibliography.",
  },
  {
    slug: "bilingual-cjk-research-note",
    name: "Bilingual CJK Research Note",
    kind: "document",
    engine: "xetex",
    mainDoc: "main.tex",
    color: "#fbf8cc",
    figureTypes: ["bibliography", "cjk", "diagram", "equations", "plot", "table"],
    summary:
      "Chinese and English computational linguistics note typeset through ctex with the bundled Fandol fonts, so CJK rendering, search, and cursor movement work without a system font install.",
  },
  {
    slug: "neurips-style-ml-preprint",
    name: "Curriculum Selection ML Preprint",
    kind: "document",
    engine: "xetex",
    mainDoc: "main.tex",
    color: "#fde4cf",
    figureTypes: ["algorithm", "bibliography", "diagram", "equations", "plot", "table"],
    summary:
      "Single-column machine learning preprint with amsthm assumption and proposition numbering, an algorithm block, learning-curve and ablation charts, and a multirow results table.",
  },
  {
    slug: "ieee-two-column-journal-article",
    name: "Millimeter-Wave Estimation Article",
    kind: "document",
    engine: "xetex",
    mainDoc: "main.tex",
    color: "#ffcfd2",
    figureTypes: ["bibliography", "diagram", "equations", "plot", "table"],
    summary:
      "Two-column journal article exercising full-width figure and table floats, fourteen numbered equations with multi-line derivations, a TikZ receiver chain, and a semilog BER plot.",
  },
  {
    slug: "acm-style-hci-user-study",
    name: "Interruption Cost User Study",
    kind: "document",
    engine: "xetex",
    mainDoc: "main.tex",
    color: "#f1c0e8",
    figureTypes: ["bibliography", "diagram", "plot", "table"],
    summary:
      "Two-column empirical HCI paper with a participant demographics table, a statistics table reporting confidence intervals and effect sizes, and a bar chart with error bars.",
  },
  {
    slug: "usenix-style-security-paper",
    name: "Package Registry Measurement Paper",
    kind: "document",
    engine: "xetex",
    mainDoc: "main.tex",
    color: "#cfbaf0",
    figureTypes: ["algorithm", "bibliography", "diagram", "listing", "plot", "table"],
    summary:
      "Two-column security measurement paper with a syntax-highlighted listing, a classification algorithm, a TikZ threat model with trust boundaries, and a grouped bar chart.",
  },
  {
    slug: "computational-physics-phd-thesis",
    name: "Computational Physics PhD Thesis",
    kind: "document",
    engine: "xetex",
    mainDoc: "main.tex",
    color: "#a3c4f3",
    figureTypes: ["algorithm", "bibliography", "diagram", "equations", "listing", "plot", "table"],
    summary:
      "Thirty-two page thesis with separate front matter, six chapters, and two appendices, so the outline, file tree, cross-file references, and long-document compile performance all get exercised.",
  },
  {
    slug: "applied-statistics-monograph",
    name: "Causal Inference Monograph",
    kind: "document",
    engine: "xetex",
    mainDoc: "main.tex",
    color: "#90dbf4",
    figureTypes: ["algorithm", "bibliography", "diagram", "equations", "plot", "table"],
    summary:
      "Forty-two page book with three parts, thirty numbered theorem environments with proofs, causal DAGs, and a generated index, covering the parts and chapters hierarchy.",
  },
  {
    slug: "climate-data-technical-report",
    name: "Flux Tower Technical Report",
    kind: "document",
    engine: "xetex",
    mainDoc: "main.tex",
    color: "#8eecf5",
    figureTypes: ["bibliography", "diagram", "equations", "listing", "plot", "table"],
    summary:
      "Data-heavy report whose ninety-six row longtable breaks across pages with repeating headers, alongside three charts and an eleven-stage TikZ processing schematic.",
  },
  {
    slug: "bioinformatics-lab-report",
    name: "RNA-seq Laboratory Report",
    kind: "document",
    engine: "xetex",
    mainDoc: "main.tex",
    color: "#98f5e1",
    figureTypes: ["bibliography", "diagram", "equations", "listing", "plot", "table"],
    summary:
      "Multi-file laboratory report with a numbered wet-lab protocol, a two-lane workflow schematic, a shell pipeline listing, and quality, insert-size, and volcano charts.",
  },
  {
    slug: "research-beamer-talk",
    name: "Satellite Congestion Control Talk",
    kind: "document",
    engine: "xetex",
    mainDoc: "main.tex",
    color: "#b9fbc0",
    figureTypes: ["bibliography", "diagram", "equations", "plot", "presentation", "table"],
    summary:
      "Twenty-frame Beamer deck that expands to forty-seven pages through overlays, with appendix backup slides and a cross-reference that resolves into the appendix.",
  },
  {
    slug: "conference-research-poster",
    name: "Estuary Transport Research Poster",
    kind: "document",
    engine: "xetex",
    mainDoc: "main.tex",
    color: "#1982c4",
    figureTypes: ["bibliography", "diagram", "equations", "plot", "table"],
    summary:
      "Portrait A0 tikzposter at 2384 by 3370 points, so very large page geometry, zoom to fit, and thumbnail scaling get a real workout.",
  },
  {
    slug: "academic-cv-publications",
    name: "Academic CV and Publications",
    kind: "document",
    engine: "xetex",
    mainDoc: "main.tex",
    color: "#fbf8cc",
    figureTypes: ["bibliography", "table"],
    summary:
      "Four-page academic CV with rule-separated headings and hard-aligned date columns, rendering a twenty-four entry publication list from BibTeX through nocite.",
  },
  {
    slug: "erc-style-grant-proposal",
    name: "Federated Analytics Grant Proposal",
    kind: "document",
    engine: "xetex",
    mainDoc: "main.tex",
    color: "#fde4cf",
    figureTypes: ["bibliography", "diagram", "equations", "table"],
    summary:
      "Eight-file proposal whose objectives and work packages use custom counters, with a hand-built sixty-month TikZ Gantt chart and a risk register that breaks across pages.",
  },
  {
    slug: "transformer-block-figure",
    name: "Transformer Block Figure",
    kind: "image",
    engine: "xetex",
    mainDoc: "figure.tex",
    color: "#ffcfd2",
    figureTypes: ["diagram", "equations"],
    summary:
      "Tall cropped standalone TikZ page showing a pre-norm transformer block with stacked heads and tensor-shape annotations, for portrait large-canvas preview and image export.",
  },
  {
    slug: "distributed-training-topology-figure",
    name: "Distributed Training Topology Figure",
    kind: "image",
    engine: "xetex",
    mainDoc: "figure.tex",
    color: "#f1c0e8",
    figureTypes: ["diagram"],
    summary:
      "The widest page in the corpus at 1218 by 385 points, with four nodes, a leaf-spine fabric, and a ring all-reduce, for extreme aspect-ratio panning and zoom.",
  },
  {
    slug: "scaling-law-diagram",
    name: "Scaling Law Diagram",
    kind: "diagram",
    engine: "xetex",
    mainDoc: "figure.tex",
    color: "#cfbaf0",
    figureTypes: ["diagram", "plot"],
    summary:
      "Two log-log pgfplots panels with a fitted power-law envelope beside a hand-drawn derivation panel, the heaviest render path and pgfplots inside standalone.",
  },
  {
    slug: "ieee-style-paper-typst",
    name: "Grid Islanding Paper (Typst)",
    kind: "document",
    engine: "typst",
    mainDoc: "main.typ",
    color: "#a3c4f3",
    figureTypes: ["bibliography", "diagram", "equations", "plot", "table"],
    summary:
      "Two-column IEEE-style paper recreated from built-in Typst features only, with an included sections directory, a drawn signal path, and a drawn frequency response.",
  },
  {
    slug: "ml-conference-paper-typst",
    name: "Data Selection Paper (Typst)",
    kind: "document",
    engine: "typst",
    mainDoc: "main.typ",
    color: "#90dbf4",
    figureTypes: ["bibliography", "equations", "plot", "table"],
    summary:
      "Single-column machine learning preprint in Typst with a training objective in math, drawn win-rate and ablation charts, and a results table with a highlighted best row.",
  },
  {
    slug: "journal-article-typst",
    name: "Alloy Creep Article (Typst)",
    kind: "document",
    engine: "typst",
    mainDoc: "main.typ",
    color: "#8eecf5",
    figureTypes: ["bibliography", "diagram", "equations", "plot", "table"],
    summary:
      "Materials science journal article with numbered equations and cross-references, a drawn creep-frame apparatus, drawn creep curves, and composition tables with units.",
  },
  {
    slug: "systems-measurement-paper-typst",
    name: "Zoned Storage Measurement Paper (Typst)",
    kind: "document",
    engine: "typst",
    mainDoc: "main.typ",
    color: "#98f5e1",
    figureTypes: ["bibliography", "diagram", "equations", "listing", "plot", "table"],
    summary:
      "Two-column storage measurement paper with a code listing in a figure, a drawn write-path architecture, and drawn write-amplification and tail-latency charts.",
  },
  {
    slug: "robotics-masters-thesis-typst",
    name: "Tactile Grasping Thesis (Typst)",
    kind: "document",
    engine: "typst",
    mainDoc: "main.typ",
    color: "#b9fbc0",
    figureTypes: ["bibliography", "diagram", "equations", "listing", "plot", "table"],
    summary:
      "Long Typst thesis with a title page, generated outline, five chapters and an appendix, sixteen drawn figures and ten tables, for multi-file navigation at scale.",
  },
  {
    slug: "data-science-handbook-typst",
    name: "Data Science Handbook (Typst)",
    kind: "document",
    engine: "typst",
    mainDoc: "main.typ",
    color: "#1982c4",
    figureTypes: ["bibliography", "diagram", "equations", "listing", "plot", "table"],
    summary:
      "Book-style handbook with parts and chapters, definition callout blocks, code listings, a drawn regression tree and inference chain, and boosting curves.",
  },
  {
    slug: "experimental-lab-notebook-typst",
    name: "Experimental Lab Notebook (Typst)",
    kind: "document",
    engine: "typst",
    mainDoc: "main.typ",
    color: "#fbf8cc",
    figureTypes: ["bibliography", "diagram", "equations", "listing", "plot", "table"],
    summary:
      "Dated notebook of experimental sessions in separate entry files, with twenty-five drawn figures and sixteen instrument tables carrying units.",
  },
  {
    slug: "quarterly-research-report-typst",
    name: "Quarterly Research Report (Typst)",
    kind: "document",
    engine: "typst",
    mainDoc: "main.typ",
    color: "#fde4cf",
    figureTypes: ["bibliography", "diagram", "equations", "listing", "plot", "table"],
    summary:
      "Institutional quarterly report with an executive summary, a drawn workstream schedule, milestone and risk registers, and a hindcast skill chart.",
  },
  {
    slug: "research-slides-typst",
    name: "Vector Search Slides (Typst)",
    kind: "document",
    engine: "typst",
    mainDoc: "main.typ",
    color: "#ffcfd2",
    figureTypes: ["bibliography", "diagram", "equations", "plot", "presentation", "table"],
    summary:
      "Twenty-slide 16:9 deck built from a hand-written slide helper, including dark divider slides that override the page fill, for per-page geometry changes.",
  },
  {
    slug: "academic-cv-typst",
    name: "Academic CV (Typst)",
    kind: "document",
    engine: "typst",
    mainDoc: "main.typ",
    color: "#f1c0e8",
    figureTypes: ["plot", "table"],
    summary:
      "Four-page Typst CV whose date columns are aligned with grids, including a drawn outputs-per-year bar chart and a cumulative citation curve.",
  },
  {
    slug: "conference-poster-typst",
    name: "Sodium-Ion Thermal Poster (Typst)",
    kind: "document",
    engine: "typst",
    mainDoc: "main.typ",
    color: "#cfbaf0",
    figureTypes: ["bibliography", "diagram", "equations", "plot", "table"],
    summary:
      "Genuine A0 Typst poster at 841 by 1189 millimetres with a drawn cell cross-section and coupling loop, for very large page geometry and heavy vector content.",
  },
];
