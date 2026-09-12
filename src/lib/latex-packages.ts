import { i18n } from "@/i18n";
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

type LatexPackageSeed = Omit<LatexPackage, "tagging" | "description">;

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
  { name: "amsmath", scope: "all", defaultOn: true },
  { name: "amssymb", texLivePackage: "amsfonts", scope: "all", defaultOn: true },
  { name: "mathtools", scope: "all", defaultOn: false },
  { name: "amsthm", texLivePackage: "amscls", scope: "pdf", defaultOn: false },
  { name: "unicode-math", scope: "pdf", defaultOn: false },
  { name: "graphicx", texLivePackage: "graphics", scope: "all", defaultOn: true },
  { name: "hyperref", scope: "pdf", defaultOn: true },
  { name: "bookmark", scope: "pdf", defaultOn: false },
  { name: "geometry", scope: "pdf", defaultOn: false },
  { name: "booktabs", scope: "pdf", defaultOn: false },
  { name: "xcolor", scope: "all", defaultOn: true },
  { name: "listings", scope: "pdf", defaultOn: false },
  { name: "minted", scope: "pdf", defaultOn: false },
  { name: "tikz", texLivePackage: "pgf", scope: "pdf", defaultOn: false },
  { name: "algorithm2e", scope: "pdf", defaultOn: false },
  { name: "biblatex", scope: "pdf", defaultOn: false },
  { name: "natbib", scope: "pdf", defaultOn: false },
  { name: "csquotes", scope: "pdf", defaultOn: false },
  { name: "fontspec", scope: "pdf", defaultOn: false },
  { name: "microtype", scope: "pdf", defaultOn: false },
  { name: "siunitx", scope: "pdf", defaultOn: false },
  { name: "cleveref", scope: "pdf", defaultOn: false },
  { name: "enumitem", scope: "all", defaultOn: true },
  { name: "fancyhdr", scope: "pdf", defaultOn: false },
  { name: "caption", scope: "pdf", defaultOn: false },
  { name: "subcaption", texLivePackage: "caption", scope: "pdf", defaultOn: false },
  { name: "subfig", scope: "pdf", defaultOn: false },
  { name: "float", scope: "pdf", defaultOn: false },
  { name: "wrapfig", scope: "pdf", defaultOn: false },
  { name: "array", texLivePackage: "tools", scope: "all", defaultOn: true },
  { name: "tabularx", texLivePackage: "tools", scope: "pdf", defaultOn: false },
  { name: "multirow", scope: "pdf", defaultOn: false },
  { name: "threeparttable", scope: "pdf", defaultOn: false },
  { name: "titlesec", scope: "pdf", defaultOn: false },
  { name: "lineno", scope: "pdf", defaultOn: false },
  { name: "authblk", texLivePackage: "preprint", scope: "pdf", defaultOn: false },
  { name: "todonotes", scope: "pdf", defaultOn: false },
  { name: "pdfpages", scope: "pdf", defaultOn: false },
  { name: "url", scope: "all", defaultOn: true },
  { name: "inputenc", texLivePackage: "latex", scope: "pdf", defaultOn: false },
  { name: "babel", scope: "pdf", defaultOn: false },
  { name: "setspace", scope: "pdf", defaultOn: false },
  { name: "parskip", scope: "pdf", defaultOn: false },
  { name: "lipsum", scope: "all", defaultOn: false },
];

const DESCRIPTIONS: Record<string, () => string> = {
  amsmath: () => i18n.t(($) => $.core.latexPackages.amsmath),
  amssymb: () => i18n.t(($) => $.core.latexPackages.amssymb),
  mathtools: () => i18n.t(($) => $.core.latexPackages.mathtools),
  amsthm: () => i18n.t(($) => $.core.latexPackages.amsthm),
  "unicode-math": () => i18n.t(($) => $.core.latexPackages["unicode-math"]),
  graphicx: () => i18n.t(($) => $.core.latexPackages.graphicx),
  hyperref: () => i18n.t(($) => $.core.latexPackages.hyperref),
  bookmark: () => i18n.t(($) => $.core.latexPackages.bookmark),
  geometry: () => i18n.t(($) => $.core.latexPackages.geometry),
  booktabs: () => i18n.t(($) => $.core.latexPackages.booktabs),
  xcolor: () => i18n.t(($) => $.core.latexPackages.xcolor),
  listings: () => i18n.t(($) => $.core.latexPackages.listings),
  minted: () => i18n.t(($) => $.core.latexPackages.minted),
  tikz: () => i18n.t(($) => $.core.latexPackages.tikz),
  algorithm2e: () => i18n.t(($) => $.core.latexPackages.algorithm2e),
  biblatex: () => i18n.t(($) => $.core.latexPackages.biblatex),
  natbib: () => i18n.t(($) => $.core.latexPackages.natbib),
  csquotes: () => i18n.t(($) => $.core.latexPackages.csquotes),
  fontspec: () => i18n.t(($) => $.core.latexPackages.fontspec),
  microtype: () => i18n.t(($) => $.core.latexPackages.microtype),
  siunitx: () => i18n.t(($) => $.core.latexPackages.siunitx),
  cleveref: () => i18n.t(($) => $.core.latexPackages.cleveref),
  enumitem: () => i18n.t(($) => $.core.latexPackages.enumitem),
  fancyhdr: () => i18n.t(($) => $.core.latexPackages.fancyhdr),
  caption: () => i18n.t(($) => $.core.latexPackages.caption),
  subcaption: () => i18n.t(($) => $.core.latexPackages.subcaption),
  subfig: () => i18n.t(($) => $.core.latexPackages.subfig),
  float: () => i18n.t(($) => $.core.latexPackages.float),
  wrapfig: () => i18n.t(($) => $.core.latexPackages.wrapfig),
  array: () => i18n.t(($) => $.core.latexPackages.array),
  tabularx: () => i18n.t(($) => $.core.latexPackages.tabularx),
  multirow: () => i18n.t(($) => $.core.latexPackages.multirow),
  threeparttable: () => i18n.t(($) => $.core.latexPackages.threeparttable),
  titlesec: () => i18n.t(($) => $.core.latexPackages.titlesec),
  lineno: () => i18n.t(($) => $.core.latexPackages.lineno),
  authblk: () => i18n.t(($) => $.core.latexPackages.authblk),
  todonotes: () => i18n.t(($) => $.core.latexPackages.todonotes),
  pdfpages: () => i18n.t(($) => $.core.latexPackages.pdfpages),
  url: () => i18n.t(($) => $.core.latexPackages.url),
  inputenc: () => i18n.t(($) => $.core.latexPackages.inputenc),
  babel: () => i18n.t(($) => $.core.latexPackages.babel),
  setspace: () => i18n.t(($) => $.core.latexPackages.setspace),
  parskip: () => i18n.t(($) => $.core.latexPackages.parskip),
  lipsum: () => i18n.t(($) => $.core.latexPackages.lipsum),
};

function packageDescription(name: string): string {
  return DESCRIPTIONS[name]?.() ?? "";
}

export const LATEX_PACKAGES: LatexPackage[] = SEEDS.map((seed) => ({
  ...seed,
  get description() {
    return packageDescription(seed.name);
  },
  tagging: taggingAxis(seed.name),
}));

const BY_NAME = new Map(LATEX_PACKAGES.map((p) => [p.name, p]));

export function taggingStatus(name: string): TaggingStatus {
  return BY_NAME.get(name)?.tagging ?? taggingAxis(name);
}

export function packagesThatBreakTagging(): string[] {
  return LATEX_PACKAGES.filter((p) => p.tagging === "breaks").map((p) => p.name);
}
