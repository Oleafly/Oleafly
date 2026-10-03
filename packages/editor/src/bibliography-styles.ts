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

export type TypstStyleUsage = "bibliography" | "cite";

export interface TypstBibliographyStyle {
  readonly name: string;
  readonly project: boolean;
  readonly citationOnly: boolean;
}

interface TypstStyleEntry {
  readonly name: string;
  readonly since?: readonly [number, number];
  readonly citationOnly?: boolean;
}

const TYPST_BASE_STYLES: readonly string[] = [
  "american-anthropological-association",
  "american-chemical-society",
  "american-geophysical-union",
  "american-institute-of-aeronautics-and-astronautics",
  "american-institute-of-physics",
  "american-medical-association",
  "american-meteorological-society",
  "american-physics-society",
  "american-physiological-society",
  "american-political-science-association",
  "american-psychological-association",
  "apa",
  "american-society-for-microbiology",
  "american-society-of-civil-engineers",
  "american-society-of-mechanical-engineers",
  "american-sociological-association",
  "angewandte-chemie",
  "annual-reviews",
  "annual-reviews-author-date",
  "associacao-brasileira-de-normas-tecnicas",
  "association-for-computing-machinery",
  "biomed-central",
  "bristol-university-press",
  "british-medical-journal",
  "bmj",
  "cell",
  "chicago-author-date",
  "chicago-notes",
  "chicago-fullnotes",
  "copernicus",
  "council-of-science-editors",
  "council-of-science-editors-author-date",
  "current-opinion",
  "deutsche-gesellschaft-für-psychologie",
  "deutsche-sprache",
  "elsevier-harvard",
  "elsevier-vancouver",
  "elsevier-with-titles",
  "frontiers",
  "future-medicine",
  "future-science",
  "gb-7714-2005-numeric",
  "gb-7714-2015-author-date",
  "gb-7714-2015-note",
  "gb-7714-2015-numeric",
  "gost-r-705-2008-numeric",
  "harvard-cite-them-right",
  "institute-of-electrical-and-electronics-engineers",
  "ieee",
  "institute-of-physics-numeric",
  "iso-690-author-date",
  "iso-690-numeric",
  "karger",
  "mary-ann-liebert-vancouver",
  "modern-humanities-research-association",
  "modern-language-association",
  "mla",
  "modern-language-association-8",
  "mla-8",
  "multidisciplinary-digital-publishing-institute",
  "nature",
  "vancouver",
  "vancouver-superscript",
  "pensoft",
  "public-library-of-science",
  "plos",
  "royal-society-of-chemistry",
  "sage-vancouver",
  "sist02",
  "spie",
  "springer-basic",
  "springer-basic-author-date",
  "springer-fachzeitschriften-medizin-psychologie",
  "springer-humanities-author-date",
  "springer-lecture-notes-in-computer-science",
  "springer-mathphys",
  "springer-socpsych-author-date",
  "springer-vancouver",
  "taylor-and-francis-chicago-author-date",
  "taylor-and-francis-national-library-of-medicine",
  "the-institution-of-engineering-and-technology",
  "the-lancet",
  "thieme",
  "trends",
  "turabian-author-date",
  "turabian-fullnote-8",
];

const TYPST_STYLE_ENTRIES: readonly TypstStyleEntry[] = [
  ...TYPST_BASE_STYLES.map((name) => ({ name })),
  { name: "chicago-shortened-notes", since: [0, 14] },
  { name: "modern-humanities-research-association-notes", since: [0, 14] },
  { name: "cse-citation-sequence-brackets-8th-edition", since: [0, 15] },
  { name: "cse-name-year", since: [0, 15] },
  { name: "nlm-citation-sequence", since: [0, 15] },
  { name: "nlm-citation-sequence-superscript", since: [0, 15] },
  { name: "alphanumeric", citationOnly: true },
];

export function typstBibliographyStyleDetailKey(style: TypstBibliographyStyle): EditorMessageKey {
  if (style.project) return "typst.bibliographyStyle.project";
  return style.citationOnly ? "typst.bibliographyStyle.citation" : "typst.bibliographyStyle.builtin";
}

let typstCslStyleProvider: () => string[] = () => [];
let typstStyleVersionProvider: () => string | null = () => null;

export function typstStyleVersion(): string | null {
  return typstStyleVersionProvider();
}

export function setTypstCslStyleProvider(fn: () => string[]): void {
  typstCslStyleProvider = fn;
}

export function setTypstStyleVersionProvider(fn: () => string | null): void {
  typstStyleVersionProvider = fn;
}

function typstMinor(version: string | null): readonly [number, number] | null {
  const match = version ? /^(\d+)\.(\d+)/.exec(version.trim()) : null;
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function supports(version: readonly [number, number] | null, since?: readonly [number, number]): boolean {
  if (!since || !version) return true;
  return version[0] > since[0] || (version[0] === since[0] && version[1] >= since[1]);
}

export function typstBibliographyStyles(
  version: string | null,
  usage: TypstStyleUsage,
): readonly TypstBibliographyStyle[] {
  const minor = typstMinor(version);
  const seen = new Set<string>();
  const styles: TypstBibliographyStyle[] = [];
  for (const raw of typstCslStyleProvider()) {
    const name = raw.trim();
    if (!/\.csl$/iu.test(name) || seen.has(name)) continue;
    seen.add(name);
    styles.push({ name, project: true, citationOnly: false });
  }
  for (const entry of TYPST_STYLE_ENTRIES) {
    if (!supports(minor, entry.since)) continue;
    if (entry.citationOnly && usage !== "cite") continue;
    styles.push({ name: entry.name, project: false, citationOnly: entry.citationOnly === true });
  }
  return styles;
}

export interface StyleFrame {
  readonly close: string;
  readonly code: boolean;
  readonly callee: string;
}

const STYLE_STRING = /\bstyle\s*:\s*"([^"\\\n]*)$/u;
const IDENTIFIER_START = /[A-Za-z_]/u;
const IDENTIFIER_PART = /[\w-]/u;
const STYLE_CALLEES = new Set(["bibliography", "cite"]);

function skipQuoted(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1;
  return index + 1;
}

function skipRaw(text: string, start: number): number {
  let ticks = 0;
  while (text[start + ticks] === "`") ticks += 1;
  const close = text.indexOf("`".repeat(ticks), start + ticks);
  return close < 0 ? text.length : close + ticks;
}

function skipComment(text: string, index: number): number | null {
  if (text[index] !== "/") return null;
  if (text[index + 1] === "/" && text[index - 1] !== ":") {
    const newline = text.indexOf("\n", index);
    return newline < 0 ? text.length : newline;
  }
  if (text[index + 1] === "*") {
    const close = text.indexOf("*/", index + 2);
    return close < 0 ? text.length : close + 2;
  }
  return null;
}

function identifierBefore(text: string): string {
  const trimmed = text.trimEnd();
  let start = trimmed.length;
  while (start > 0 && IDENTIFIER_PART.test(trimmed[start - 1])) start -= 1;
  while (start < trimmed.length && !IDENTIFIER_START.test(trimmed[start])) start += 1;
  return trimmed.slice(start);
}

function markupCall(text: string, hash: number): { callee: string; open: number } | null {
  const head = /^#(?:(?:set|show)\s+)?([A-Za-z_][\w.-]*)\s*\(/u.exec(text.slice(hash, hash + 200));
  return head ? { callee: head[1], open: hash + head[0].length - 1 } : null;
}

function markupStep(text: string, index: number, stack: StyleFrame[]): number {
  const character = text[index];
  if (character === "`") return skipRaw(text, index);
  if (character === "#") {
    const call = markupCall(text, index);
    if (!call) return index + 1;
    stack.push({ close: ")", code: true, callee: call.callee });
    return call.open + 1;
  }
  if (character === stack.at(-1)?.close) stack.pop();
  return index + 1;
}

function codeStep(text: string, index: number, stack: StyleFrame[]): number {
  const character = text[index];
  if (character === '"') return skipQuoted(text, index);
  if (character === "(") {
    stack.push({ close: ")", code: true, callee: identifierBefore(text.slice(Math.max(0, index - 60), index)) });
  } else if (character === "{") {
    stack.push({ close: "}", code: true, callee: "" });
  } else if (character === "[") {
    stack.push({ close: "]", code: false, callee: "" });
  } else if (character === stack.at(-1)?.close) {
    stack.pop();
  }
  return index + 1;
}

export function enclosingFrames(text: string): StyleFrame[] {
  const stack: StyleFrame[] = [];
  let index = 0;
  while (index < text.length) {
    const comment = skipComment(text, index);
    if (comment !== null) index = comment;
    else if (text[index] === "\\") index += 2;
    else if (stack.at(-1)?.code) index = codeStep(text, index, stack);
    else index = markupStep(text, index, stack);
  }
  return stack;
}

export function typstStyleArgumentAt(before: string): { callee: string; query: string } | null {
  const match = STYLE_STRING.exec(before);
  if (!match) return null;
  const frame = enclosingFrames(before.slice(0, match.index)).at(-1);
  if (!frame?.code || frame.close !== ")" || !STYLE_CALLEES.has(frame.callee)) return null;
  return { callee: frame.callee, query: match[1] };
}
