/**
 * Curated LaTeX package catalog for the on-demand engine's package manager
 * (tlmgr) UI. Three axes per package:
 *  - scope:     "all" packages matter in every export; "pdf" only affect PDF.
 *  - defaultOn: part of the sensible default set for a new document.
 *  - tagging:   compatibility with tagged / accessible (PDF/UA) export:
 *               "ok" | "caution" (renders but may not tag cleanly) | "breaks".
 *
 * The tagging axis is what makes one catalog serve both research-PDF users and
 * the accessibility path. See the accessibility/ATS preflight design spec.
 */

export type PkgScope = "all" | "pdf";
export type TaggingStatus = "ok" | "caution" | "breaks";

export interface LatexPackage {
  name: string;
  description: string;
  scope: PkgScope;
  defaultOn: boolean;
  tagging: TaggingStatus;
}

export const LATEX_PACKAGES: LatexPackage[] = [
  { name: "amsmath", description: "Advanced math typesetting", scope: "all", defaultOn: true, tagging: "ok" },
  { name: "amssymb", description: "Extended math symbols", scope: "all", defaultOn: true, tagging: "ok" },
  { name: "mathtools", description: "amsmath superset with fixes and tools", scope: "all", defaultOn: false, tagging: "ok" },
  { name: "amsthm", description: "Theorem and proof environments", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "unicode-math", description: "Unicode math for Xe/LuaLaTeX (required for tagged math)", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "graphicx", description: "Include graphics and images", scope: "all", defaultOn: true, tagging: "ok" },
  { name: "hyperref", description: "Hyperlinks, bookmarks, and PDF metadata", scope: "pdf", defaultOn: true, tagging: "ok" },
  { name: "bookmark", description: "Improved PDF bookmarks", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "geometry", description: "Page layout customization", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "booktabs", description: "Professional table rules", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "xcolor", description: "Color support", scope: "all", defaultOn: true, tagging: "ok" },
  { name: "listings", description: "Code listings (not compatible with tagging)", scope: "pdf", defaultOn: false, tagging: "breaks" },
  { name: "tikz", description: "Programmable vector graphics (needs manual alt text)", scope: "pdf", defaultOn: false, tagging: "caution" },
  { name: "algorithm2e", description: "Algorithm typesetting", scope: "pdf", defaultOn: false, tagging: "caution" },
  { name: "biblatex", description: "Advanced bibliography support", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "natbib", description: "Author-year and numeric citations", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "csquotes", description: "Context-sensitive quotes (needed by biblatex)", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "fontspec", description: "OpenType font selection (Xe/LuaLaTeX)", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "microtype", description: "Micro-typography refinements", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "siunitx", description: "SI units and number formatting", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "cleveref", description: "Smart cross-references (load after hyperref)", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "enumitem", description: "List customization", scope: "all", defaultOn: true, tagging: "ok" },
  { name: "fancyhdr", description: "Custom headers and footers", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "caption", description: "Caption customization (some versions break tagging)", scope: "pdf", defaultOn: false, tagging: "caution" },
  { name: "subcaption", description: "Subfigures and subtables", scope: "pdf", defaultOn: false, tagging: "caution" },
  { name: "float", description: "Improved float placement", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "array", description: "Extended array and tabular", scope: "all", defaultOn: true, tagging: "ok" },
  { name: "tabularx", description: "Auto-width tables", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "multirow", description: "Multi-row table cells", scope: "pdf", defaultOn: false, tagging: "caution" },
  { name: "url", description: "URL typesetting", scope: "all", defaultOn: true, tagging: "ok" },
  { name: "inputenc", description: "Input encoding (unnecessary on Xe/LuaLaTeX)", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "babel", description: "Multilingual support and document language", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "setspace", description: "Line spacing control", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "parskip", description: "Paragraph spacing", scope: "pdf", defaultOn: false, tagging: "ok" },
  { name: "lipsum", description: "Placeholder (lorem ipsum) text", scope: "all", defaultOn: false, tagging: "ok" },
];

const BY_NAME = new Map(LATEX_PACKAGES.map((p) => [p.name, p]));

/** Tagging compatibility for a package name, defaulting to "ok" when unknown. */
export function taggingStatus(name: string): TaggingStatus {
  return BY_NAME.get(name)?.tagging ?? "ok";
}

/** Package names known to break tagging (feeds the preflight denylist). */
export function packagesThatBreakTagging(): string[] {
  return LATEX_PACKAGES.filter((p) => p.tagging === "breaks").map((p) => p.name);
}
