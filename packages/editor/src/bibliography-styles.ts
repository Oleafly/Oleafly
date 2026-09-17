import type { EditorMessageKey } from "./messages";

export type BibliographyStyleFamily =
  | "bibtex"
  | "natbib"
  | "journal"
  | "revtex"
  | "project";

export interface BibliographyStyle {
  readonly name: string;
  readonly family: BibliographyStyleFamily;
}

const STYLE_NAMES: Readonly<
  Record<Exclude<BibliographyStyleFamily, "project">, readonly string[]>
> = {
  bibtex: [
    "abbrv",
    "acm",
    "alpha",
    "amsalpha",
    "amsplain",
    "apalike",
    "ieeetr",
    "plain",
    "plainurl",
    "siam",
    "unsrt",
  ],
  natbib: [
    "abbrvnat",
    "dinat",
    "ksfh_nat",
    "plainnat",
    "rusnat",
    "unsrtnat",
  ],
  journal: [
    "ACM-Reference-Format",
    "IEEEtran",
    "IEEEtranN",
    "IEEEtranS",
    "achemso",
    "agsm",
    "apa",
    "apacite",
    "chicago",
    "elsarticle-harv",
    "elsarticle-num",
    "elsarticle-num-names",
    "harvard",
    "jfm",
    "model1-num-names",
    "nature",
    "naturemag",
    "science",
    "siamplain",
    "splncs03",
    "splncs04",
    "spmpsci",
  ],
  revtex: ["aipauth4-2", "aipnum4-2", "apsrev4-2", "apsrmp4-2"],
};

const DETAIL_KEYS: Readonly<
  Record<BibliographyStyleFamily, EditorMessageKey>
> = {
  bibtex: "latex.bibliographyStyle.bibtex",
  natbib: "latex.bibliographyStyle.natbib",
  journal: "latex.bibliographyStyle.journal",
  revtex: "latex.bibliographyStyle.revtex",
  project: "latex.bibliographyStyle.project",
};

export const BIBLIOGRAPHY_STYLES: readonly BibliographyStyle[] = Object.entries(
  STYLE_NAMES,
).flatMap(([family, names]) =>
  names.map((name) => ({
    name,
    family: family as BibliographyStyleFamily,
  })),
);

let bibStyleProvider: () => string[] = () => [];

export function setBibStyleProvider(fn: () => string[]): void {
  bibStyleProvider = fn;
}

function projectStyleName(raw: string): string {
  const base = raw.slice(raw.lastIndexOf("/") + 1);
  return base.replace(/\.bst$/iu, "").trim();
}

export function bibliographyStyles(): readonly BibliographyStyle[] {
  const seen = new Set<string>();
  const styles: BibliographyStyle[] = [];
  for (const raw of bibStyleProvider()) {
    const name = projectStyleName(raw);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    styles.push({ name, family: "project" });
  }
  for (const style of BIBLIOGRAPHY_STYLES) {
    if (seen.has(style.name)) continue;
    seen.add(style.name);
    styles.push(style);
  }
  return styles;
}

export function bibliographyStyleDetailKey(
  family: BibliographyStyleFamily,
): EditorMessageKey {
  return DETAIL_KEYS[family];
}
