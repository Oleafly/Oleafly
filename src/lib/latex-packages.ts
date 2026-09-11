// Three axes per package:
//  - scope:     "all" packages matter in every export; "pdf" only affect PDF.
//  - defaultOn: part of the sensible default set for a new document.
//  - tagging:   compatibility with tagged / accessible (PDF/UA) export:
//               "ok" | "caution" (renders but may not tag cleanly) | "breaks".
//
// The tagging axis is what makes one catalog serve both research-PDF users
// and the accessibility path. See the accessibility/ATS preflight design spec.

import { packageTaggingVerdict, type TaggingCompatibility } from "@oleafly/preflight";

export type PkgScope = "all" | "pdf";
export type TaggingStatus = "ok" | "caution" | "breaks";

export interface LatexPackage {
  name: string;
  description: string;
  texLivePackage?: string;
  scope: PkgScope;
  defaultOn: boolean;
  tagging: TaggingStatus;
}

type LatexPackageSeed = Omit<LatexPackage, "tagging">;

const AXIS: Record<TaggingCompatibility, TaggingStatus> = {
  compatible: "ok",
  "partially-compatible": "caution",
  "currently-incompatible": "breaks",
  "no-support": "breaks",
  unchecked: "caution",
  unknown: "caution",
};

export function taggingAxis(name: string): TaggingStatus {
  return AXIS[packageTaggingVerdict(name).status];
}

const SEEDS: LatexPackageSeed[] = [
  { name: "amsmath", description: "Advanced math typesetting", scope: "all", defaultOn: true },
  { name: "amssymb", texLivePackage: "amsfonts", description: "Extended math symbols", scope: "all", defaultOn: true },
  { name: "mathtools", description: "amsmath superset with fixes and tools", scope: "all", defaultOn: false },
  { name: "amsthm", texLivePackage: "amscls", description: "Theorem and proof environments", scope: "pdf", defaultOn: false },
  { name: "unicode-math", description: "Unicode math for Xe/LuaLaTeX (needed for tagged math)", scope: "pdf", defaultOn: false },
  { name: "graphicx", texLivePackage: "graphics", description: "Include graphics and images", scope: "all", defaultOn: true },
  { name: "hyperref", description: "Hyperlinks, bookmarks, and PDF metadata", scope: "pdf", defaultOn: true },
  { name: "bookmark", description: "Improved PDF bookmarks", scope: "pdf", defaultOn: false },
  { name: "geometry", description: "Page layout customization", scope: "pdf", defaultOn: false },
  { name: "booktabs", description: "Professional table rules", scope: "pdf", defaultOn: false },
  { name: "xcolor", description: "Color support", scope: "all", defaultOn: true },
  { name: "listings", description: "Code listings (their content is not tagged)", scope: "pdf", defaultOn: false },
  { name: "minted", description: "Pygments-highlighted code listings", scope: "pdf", defaultOn: false },
  { name: "tikz", texLivePackage: "pgf", description: "Programmable vector graphics (needs manual alt text)", scope: "pdf", defaultOn: false },
  { name: "algorithm2e", description: "Algorithm typesetting", scope: "pdf", defaultOn: false },
  { name: "biblatex", description: "Advanced bibliography support", scope: "pdf", defaultOn: false },
  { name: "natbib", description: "Author-year and numeric citations", scope: "pdf", defaultOn: false },
  { name: "csquotes", description: "Context-sensitive quotes (needed by biblatex)", scope: "pdf", defaultOn: false },
  { name: "fontspec", description: "OpenType font selection (Xe/LuaLaTeX)", scope: "pdf", defaultOn: false },
  { name: "microtype", description: "Micro-typography refinements", scope: "pdf", defaultOn: false },
  { name: "siunitx", description: "SI units and number formatting", scope: "pdf", defaultOn: false },
  { name: "cleveref", description: "Smart cross-references (load after hyperref)", scope: "pdf", defaultOn: false },
  { name: "enumitem", description: "List customization", scope: "all", defaultOn: true },
  { name: "fancyhdr", description: "Custom headers and footers", scope: "pdf", defaultOn: false },
  { name: "caption", description: "Caption customization", scope: "pdf", defaultOn: false },
  { name: "subcaption", texLivePackage: "caption", description: "Subfigures and subtables", scope: "pdf", defaultOn: false },
  { name: "subfig", description: "Older subfigure layout package", scope: "pdf", defaultOn: false },
  { name: "float", description: "Improved float placement", scope: "pdf", defaultOn: false },
  { name: "wrapfig", description: "Figures with text wrapped around them", scope: "pdf", defaultOn: false },
  { name: "array", texLivePackage: "tools", description: "Extended array and tabular", scope: "all", defaultOn: true },
  { name: "tabularx", texLivePackage: "tools", description: "Auto-width tables", scope: "pdf", defaultOn: false },
  { name: "multirow", description: "Multi-row table cells", scope: "pdf", defaultOn: false },
  { name: "threeparttable", description: "Tables with notes underneath", scope: "pdf", defaultOn: false },
  { name: "titlesec", description: "Section heading formatting", scope: "pdf", defaultOn: false },
  { name: "lineno", description: "Line numbers for review copies", scope: "pdf", defaultOn: false },
  { name: "authblk", texLivePackage: "preprint", description: "Author and affiliation blocks", scope: "pdf", defaultOn: false },
  { name: "todonotes", description: "Margin to-do notes for drafts", scope: "pdf", defaultOn: false },
  { name: "pdfpages", description: "Include whole pages from another PDF", scope: "pdf", defaultOn: false },
  { name: "url", description: "URL typesetting", scope: "all", defaultOn: true },
  { name: "inputenc", texLivePackage: "latex", description: "Input encoding (unnecessary on Xe/LuaLaTeX)", scope: "pdf", defaultOn: false },
  { name: "babel", description: "Multilingual support and document language", scope: "pdf", defaultOn: false },
  { name: "setspace", description: "Line spacing control", scope: "pdf", defaultOn: false },
  { name: "parskip", description: "Paragraph spacing", scope: "pdf", defaultOn: false },
  { name: "lipsum", description: "Placeholder (lorem ipsum) text", scope: "all", defaultOn: false },
];

export const LATEX_PACKAGES: LatexPackage[] = SEEDS.map((seed) => ({
  ...seed,
  tagging: taggingAxis(seed.name),
}));

const BY_NAME = new Map(LATEX_PACKAGES.map((p) => [p.name, p]));

export function taggingStatus(name: string): TaggingStatus {
  return BY_NAME.get(name)?.tagging ?? taggingAxis(name);
}

export function packagesThatBreakTagging(): string[] {
  return LATEX_PACKAGES.filter((p) => p.tagging === "breaks").map((p) => p.name);
}
