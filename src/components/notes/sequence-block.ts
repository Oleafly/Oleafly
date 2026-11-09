import { Dna } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { currentLocale, i18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { formatCount } from "./chart-block";
import { blockMessage, type NoteBlockKind, type PaintContext } from "./note-blocks";

export type SequenceKind = "dna" | "rna" | "protein";

export interface SequenceRecord {
  header: string;
  residues: string;
  kind: SequenceKind;
}

export type SequenceParse =
  | { ok: true; records: SequenceRecord[] }
  | { ok: false; problem: "empty" }
  | { ok: false; problem: "character"; character: string; line: number; column: number };

type ProteinClass = "hydrophobic" | "polar" | "positive" | "negative" | "special";

export const LINE_LENGTH = 60;
export const BLOCK_LENGTH = 10;
export const RECORD_LIMIT = 10_000;
export const TOTAL_LIMIT = 30_000;
export const RECORD_COUNT_LIMIT = 100;
const STILL_RECORD_LIMIT = 240;
const STILL_TOTAL_LIMIT = 480;
const STILL_RECORD_COUNT = 3;

export const SEQUENCE_TEMPLATE = ">example coding sequence\nATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG";

const BAD_CHARACTER = /[^A-Za-z*.\-\s\d]/u;
const IGNORED = /[\s\d]+/gu;
const CORE_BASES = new Set("ACGTUN");
const AMBIGUOUS_BASES = new Set("RYSWKMBDHV");
const GENETIC_CODE = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";
const BASE_INDEX: ReadonlyMap<string, number> = new Map([
  ["T", 0],
  ["C", 1],
  ["A", 2],
  ["G", 3],
]);
const EXPANSION: ReadonlyMap<string, string> = new Map([
  ["A", "A"],
  ["C", "C"],
  ["G", "G"],
  ["T", "T"],
  ["U", "T"],
  ["R", "AG"],
  ["Y", "CT"],
  ["S", "CG"],
  ["W", "AT"],
  ["K", "GT"],
  ["M", "AC"],
  ["B", "CGT"],
  ["D", "AGT"],
  ["H", "ACT"],
  ["V", "ACG"],
  ["N", "ACGT"],
]);
const PAIRS = ["AT", "CG", "RY", "SS", "WW", "KM", "BV", "DH", "NN"];

function complementTable(adenine: string): ReadonlyMap<string, string> {
  const table = new Map<string, string>();
  for (const [first, second] of PAIRS) {
    table.set(first, second);
    table.set(second, first);
  }
  table.set("A", adenine);
  table.set(adenine, "A");
  table.set("U", "A");
  for (const [key, value] of [...table]) table.set(key.toLowerCase(), value.toLowerCase());
  return table;
}

const DNA_COMPLEMENT = complementTable("T");
const RNA_COMPLEMENT = complementTable("U");

const NUCLEOTIDE_TONES: ReadonlyMap<string, string> = new Map([
  ["A", "text-emerald-700 dark:text-emerald-400"],
  ["C", "text-blue-700 dark:text-blue-400"],
  ["G", "text-amber-700 dark:text-amber-400"],
  ["T", "text-red-700 dark:text-red-400"],
  ["U", "text-red-700 dark:text-red-400"],
]);

const PROTEIN_GROUPS: readonly { name: ProteinClass; residues: string; tone: string }[] = [
  { name: "hydrophobic", residues: "AVLIMFW", tone: "text-sky-700 dark:text-sky-400" },
  { name: "polar", residues: "STNQYC", tone: "text-emerald-700 dark:text-emerald-400" },
  { name: "positive", residues: "KRH", tone: "text-violet-700 dark:text-violet-400" },
  { name: "negative", residues: "DE", tone: "text-red-700 dark:text-red-400" },
  { name: "special", residues: "GP", tone: "text-amber-700 dark:text-amber-400" },
];

const PROTEIN_TONES: ReadonlyMap<string, string> = new Map(
  PROTEIN_GROUPS.flatMap((group) => [...group.residues].map((residue) => [residue, group.tone] as const)),
);

const OTHER_TONE = "text-muted-foreground";
const codons = new Map<string, string>();
const viewStates = new WeakMap<HTMLElement, ViewState>();

function isGap(residue: string): boolean {
  return residue === "-" || residue === ".";
}

export function detectKind(residues: string): SequenceKind {
  let letters = 0;
  let core = 0;
  let thymine = false;
  let uracil = false;
  for (const residue of residues.toUpperCase()) {
    if (isGap(residue)) continue;
    if (residue === "*") return "protein";
    letters += 1;
    if (residue === "T") thymine = true;
    if (residue === "U") uracil = true;
    if (CORE_BASES.has(residue)) core += 1;
    else if (!AMBIGUOUS_BASES.has(residue)) return "protein";
  }
  if (thymine && uracil) return "protein";
  if (letters > 0 && core / letters < 0.9) return "protein";
  return uracil ? "rna" : "dna";
}

export function parseSequences(source: string): SequenceParse {
  const lines = source.split(/\r?\n/u);
  const records: { header: string; chunks: string[] }[] = [];
  let current: { header: string; chunks: string[] } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const start = line.trimStart();
    if (start.startsWith(">")) {
      current = { header: start.slice(1).trim(), chunks: [] };
      records.push(current);
      continue;
    }
    if (start.startsWith(";")) continue;
    const bad = BAD_CHARACTER.exec(line);
    if (bad) {
      return {
        ok: false,
        problem: "character",
        character: String.fromCodePoint(line.codePointAt(bad.index) as number),
        line: index + 1,
        column: bad.index + 1,
      };
    }
    const residues = line.replace(IGNORED, "");
    if (!residues) continue;
    if (!current) {
      current = { header: "", chunks: [] };
      records.push(current);
    }
    current.chunks.push(residues);
  }
  if (records.length === 0) return { ok: false, problem: "empty" };
  return {
    ok: true,
    records: records.map((record) => {
      const residues = record.chunks.join("");
      return { header: record.header, residues, kind: detectKind(residues) };
    }),
  };
}

export function reverseComplement(residues: string): string {
  const table = /u/iu.test(residues) && !/t/iu.test(residues) ? RNA_COMPLEMENT : DNA_COMPLEMENT;
  const out: string[] = new Array(residues.length);
  for (let index = 0; index < residues.length; index += 1) {
    const residue = residues[residues.length - 1 - index];
    out[index] = table.get(residue) ?? residue;
  }
  return out.join("");
}

function codonAmino(codon: string): string {
  const known = codons.get(codon);
  if (known) return known;
  const options = [...codon].map((base) => EXPANSION.get(base));
  const acids = new Set<string>();
  if (options.every((option) => option !== undefined)) {
    const [first, second, third] = options as string[];
    for (const a of first) {
      for (const b of second) {
        for (const c of third) {
          acids.add(
            GENETIC_CODE[
              16 * (BASE_INDEX.get(a) as number) + 4 * (BASE_INDEX.get(b) as number) + (BASE_INDEX.get(c) as number)
            ],
          );
        }
      }
    }
  }
  const acid = acids.size === 1 ? [...acids][0] : "X";
  codons.set(codon, acid);
  return acid;
}

export function translate(residues: string): string {
  const bases = residues.replace(/[-.]/gu, "").toUpperCase();
  const protein: string[] = [];
  for (let index = 0; index + 3 <= bases.length; index += 3) protein.push(codonAmino(bases.slice(index, index + 3)));
  return protein.join("");
}

export function translationTrack(residues: string): string {
  const track = new Array<string>(residues.length).fill(" ");
  const positions: number[] = [];
  for (let index = 0; index < residues.length; index += 1) {
    if (isGap(residues[index])) continue;
    positions.push(index);
    if (positions.length === 3) {
      track[positions[1]] = codonAmino(positions.map((position) => residues[position]).join("").toUpperCase());
      positions.length = 0;
    }
  }
  return track.join("");
}

export function gcContent(residues: string): number | null {
  let strong = 0;
  let weak = 0;
  for (const residue of residues.toUpperCase()) {
    if (residue === "G" || residue === "C" || residue === "S") strong += 1;
    else if (residue === "A" || residue === "T" || residue === "U" || residue === "W") weak += 1;
  }
  return strong + weak === 0 ? null : strong / (strong + weak);
}

export function residueTone(kind: SequenceKind, residue: string): string {
  const upper = residue.toUpperCase();
  const tones = kind === "protein" ? PROTEIN_TONES : NUCLEOTIDE_TONES;
  return tones.get(upper) ?? OTHER_TONE;
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function appendRuns(target: HTMLElement, text: string, kind: SequenceKind): void {
  let start = 0;
  let tone = residueTone(kind, text[0]);
  for (let index = 1; index <= text.length; index += 1) {
    const next = index < text.length ? residueTone(kind, text[index]) : "";
    if (next === tone) continue;
    target.append(element("span", tone, text.slice(start, index)));
    start = index;
    tone = next;
  }
}

function residueLines(residues: string, kind: SequenceKind, track: string | null): HTMLElement {
  const box = element("div", "note-seq-residues mt-1 font-mono text-xs leading-5");
  for (let start = 0; start < residues.length; start += LINE_LENGTH) {
    const row = element("div", "note-seq-line flex gap-3");
    row.append(
      element(
        "span",
        "note-seq-position w-[7ch] shrink-0 select-none text-right text-muted-foreground",
        formatCount(start + 1),
      ),
    );
    const blocks = element("div", "flex min-w-0 flex-wrap gap-x-[1ch]");
    const end = Math.min(start + LINE_LENGTH, residues.length);
    for (let block = start; block < end; block += BLOCK_LENGTH) {
      const stop = Math.min(block + BLOCK_LENGTH, end);
      const cell = element("span", "note-seq-block inline-flex flex-col whitespace-pre");
      const text = element("span", "note-seq-bases");
      appendRuns(text, residues.slice(block, stop), kind);
      cell.append(text);
      if (track) cell.append(element("span", "note-seq-translation text-muted-foreground", track.slice(block, stop)));
      blocks.append(cell);
    }
    row.append(blocks);
    box.append(row);
  }
  return box;
}

function percent(share: number): string {
  return new Intl.NumberFormat(currentLocale(), { style: "percent", maximumFractionDigits: 1 }).format(share);
}

function kindLabel(kind: SequenceKind): string {
  return i18n.t(($) => $.notes.blocks.sequence.kinds[kind]);
}

function metaText(record: SequenceRecord): string {
  if (!record.residues) return i18n.t(($) => $.notes.blocks.sequence.noResidues);
  const parts = [
    kindLabel(record.kind),
    i18n.t(($) => $.notes.blocks.sequence.length[record.kind], { length: formatCount(record.residues.length) }),
  ];
  const gc = record.kind === "protein" ? null : gcContent(record.residues);
  if (gc !== null) parts.push(i18n.t(($) => $.notes.blocks.sequence.gc, { value: percent(gc) }));
  return parts.join(" · ");
}

interface ViewState {
  reverse: boolean;
  translate: boolean;
}

interface Budget {
  record: number;
  total: number;
}

function recordView(record: SequenceRecord, state: ViewState, budget: Budget): HTMLElement {
  const section = element("section", "note-seq-record min-w-0");
  const name = record.header || i18n.t(($) => $.notes.blocks.sequence.untitled);
  section.setAttribute("aria-label", name);
  section.append(
    element("p", "note-seq-header truncate text-sm font-semibold", name),
    element("p", "note-seq-meta text-xs text-muted-foreground", metaText(record)),
  );
  const nucleotide = record.kind !== "protein";
  const length = record.residues.length;
  const count = Math.min(length, budget.record, budget.total);
  budget.total -= count;
  if (count > 0) {
    const drawn =
      nucleotide && state.reverse
        ? reverseComplement(record.residues.slice(length - count))
        : record.residues.slice(0, count);
    const box = residueLines(drawn, record.kind, nucleotide && state.translate ? translationTrack(drawn) : null);
    box.setAttribute("aria-label", i18n.t(($) => $.notes.blocks.sequence.residues, { name }));
    box.setAttribute("role", "group");
    section.append(box);
  }
  const hidden = length - count;
  if (hidden > 0) {
    section.append(
      element(
        "p",
        "note-seq-hidden mt-1 text-xs text-muted-foreground",
        i18n.t(($) => $.notes.blocks.sequence.hidden, { count: hidden, formatted: formatCount(hidden) }),
      ),
    );
  }
  return section;
}

function recordViews(records: readonly SequenceRecord[], state: ViewState, still: boolean): HTMLElement[] {
  const budget: Budget = still
    ? { record: STILL_RECORD_LIMIT, total: STILL_TOTAL_LIMIT }
    : { record: RECORD_LIMIT, total: TOTAL_LIMIT };
  const shown = records.slice(0, still ? STILL_RECORD_COUNT : RECORD_COUNT_LIMIT);
  const views = shown.map((record) => recordView(record, state, budget));
  const rest = records.length - shown.length;
  if (rest > 0) {
    views.push(
      element(
        "p",
        "note-seq-more text-xs text-muted-foreground",
        i18n.t(($) => $.notes.blocks.sequence.hiddenRecords, { count: rest, formatted: formatCount(rest) }),
      ),
    );
  }
  return views;
}

function toggle(label: string, pressed: boolean, onChange: (pressed: boolean) => void): HTMLButtonElement {
  const button = element(
    "button",
    cn(
      buttonVariants({ variant: "ghost", size: "xs" }),
      "note-seq-toggle text-muted-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground",
    ),
    label,
  ) as HTMLButtonElement;
  button.type = "button";
  button.setAttribute("aria-pressed", String(pressed));
  button.addEventListener("click", () => {
    const next = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(next));
    onChange(next);
  });
  return button;
}

function proteinLegend(): HTMLElement {
  const list = element("ul", "note-seq-legend flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground");
  for (const group of PROTEIN_GROUPS) {
    const item = element("li", "flex items-center gap-1");
    item.append(
      element("span", `font-mono font-semibold ${group.tone}`, group.residues),
      element("span", "", i18n.t(($) => $.notes.blocks.sequence.classes[group.name])),
    );
    list.append(item);
  }
  return list;
}

export function paintSequence(preview: HTMLElement, source: string, context?: Partial<PaintContext>): undefined {
  const parsed = parseSequences(source);
  if (!parsed.ok) {
    blockMessage(
      preview,
      parsed.problem === "empty"
        ? i18n.t(($) => $.notes.blocks.sequence.empty)
        : i18n.t(($) => $.notes.blocks.sequence.character, {
            character: parsed.character,
            line: parsed.line,
            column: parsed.column,
          }),
    );
    return undefined;
  }
  const still = context?.still === true;
  const { records } = parsed;
  const fresh: ViewState = { reverse: false, translate: false };
  const state = still ? fresh : (viewStates.get(preview) ?? fresh);
  if (!still) viewStates.set(preview, state);
  const root = element("div", "note-seq w-full min-w-0 space-y-3 text-left");
  const body = element("div", "note-seq-records space-y-4");
  const render = () => body.replaceChildren(...recordViews(records, state, still));
  const nucleotide = records.some((record) => record.kind !== "protein" && record.residues.length > 0);
  if (nucleotide && !still) {
    const bar = element("div", "note-seq-tools flex flex-wrap gap-1");
    bar.append(
      toggle(i18n.t(($) => $.notes.blocks.sequence.reverse), state.reverse, (pressed) => {
        state.reverse = pressed;
        render();
      }),
      toggle(i18n.t(($) => $.notes.blocks.sequence.translation), state.translate, (pressed) => {
        state.translate = pressed;
        render();
      }),
    );
    root.append(bar);
  }
  render();
  root.append(body);
  if (records.some((record) => record.kind === "protein" && record.residues.length > 0)) root.append(proteinLegend());
  preview.replaceChildren(root);
  return undefined;
}

export const sequenceBlock: NoteBlockKind = {
  name: "sequence",
  aliases: ["fasta"],
  label: () => i18n.t(($) => $.notes.blocks.sequence.label),
  icon: Dna,
  interactive: true,
  paint: paintSequence,
  template: () => ({ info: "sequence", source: SEQUENCE_TEMPLATE }),
};
