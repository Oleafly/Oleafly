import type { SynctexRect } from "@oleafly/preview";
import type { CompileSuccessCheckpoint } from "@/lib/compile-checkpoint";
import type { PdfAnnotationQuote, PdfAnnotationSource } from "@/lib/tauri";
import { sourceExcerpt } from "./model";

interface PagePoint {
  page: number;
  x: number;
  y: number;
}

type LineAt = (
  page: number,
  x: number,
  y: number,
  checkpoint: CompileSuccessCheckpoint | null,
) => Promise<{ path: string | null; line: number } | null>;

type TextOf = (path: string) => string | null;

async function defaultLineAt(...args: Parameters<LineAt>): ReturnType<LineAt> {
  const { sourceLineAt } = await import("@/features/synctex");
  return sourceLineAt(...args);
}

async function defaultTextOf(path: string): Promise<string | null> {
  const { sourceText } = await import("@/features/synctex");
  return sourceText(path);
}

export function regionProbePoints(rect: SynctexRect): [PagePoint, PagePoint] {
  const x = rect.x + rect.width / 2;
  const inset = Math.min(2, rect.height / 4);
  return [
    { page: rect.page, x, y: rect.y + inset },
    { page: rect.page, x, y: rect.y + rect.height - inset },
  ];
}

export async function locateSource(
  start: PagePoint,
  end: PagePoint,
  checkpoint: CompileSuccessCheckpoint | null,
  lineAt: LineAt = defaultLineAt,
  textOf: TextOf | ((path: string) => Promise<string | null>) = defaultTextOf,
): Promise<PdfAnnotationSource | null> {
  const [first, last] = await Promise.all([
    lineAt(start.page, start.x, start.y, checkpoint),
    lineAt(end.page, end.x, end.y, checkpoint),
  ]);
  const anchor = first ?? last;
  if (!anchor?.path) return null;
  const sameFile = first && last && first.path === last.path;
  const startLine = sameFile ? Math.min(first.line, last.line) : anchor.line;
  const endLine = sameFile ? Math.max(first.line, last.line) : anchor.line;
  const text = await textOf(anchor.path);
  return {
    path: anchor.path,
    startLine,
    endLine,
    excerpt: text ? sourceExcerpt(text, startLine, endLine) : "",
  };
}

const MARKUP = /\\[A-Za-z@]+\*?|[\\{}$&~^_%]/gu;
const PROBE_WORDS = 3;
const MIN_PROBE = 6;
const MAX_PROBES = 12;
const NEARBY_LINES = 30;

function keyOf(text: string): string {
  return text.normalize("NFKC").replace(MARKUP, "").replace(/\s+/gu, "").toLowerCase();
}

function wordsOf(text: string): string[] {
  return text.split(/\s+/u).filter(Boolean);
}

function probesOf(quote: PdfAnnotationQuote): string[] {
  const words = wordsOf(quote.text);
  const probes = new Set<string>();
  for (let at = 0; at < words.length; at += PROBE_WORDS - 1) {
    const key = keyOf(words.slice(at, at + PROBE_WORDS).join(" "));
    if (key.length >= MIN_PROBE) probes.add(key);
    if (at + PROBE_WORDS >= words.length) break;
  }
  if (probes.size === 0) {
    const around = [...wordsOf(quote.before).slice(-2), ...words, ...wordsOf(quote.after).slice(0, 2)].join(" ");
    const key = keyOf(around);
    if (key.length >= MIN_PROBE) probes.add(key);
  }
  const all = [...probes];
  if (all.length <= MAX_PROBES) return all;
  return Array.from({ length: MAX_PROBES }, (_, index) => all[Math.floor((index * all.length) / MAX_PROBES)]);
}

interface Hit {
  first: number;
  last: number;
}

function hitsOf(probe: string, keys: readonly string[]): Hit[] {
  const hits: Hit[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index].includes(probe)) hits.push({ first: index, last: index });
    else if (
      index + 1 < keys.length &&
      !keys[index + 1].includes(probe) &&
      `${keys[index]}${keys[index + 1]}`.includes(probe)
    ) {
      hits.push({ first: index, last: index + 1 });
    }
  }
  return hits;
}

function bestSpan(found: readonly Hit[][]): { score: number; first: number; last: number } | null {
  let best: { score: number; first: number; last: number } | null = null;
  for (const anchor of found.flat()) {
    let score = 0;
    let first = anchor.first;
    let last = anchor.last;
    for (const hits of found) {
      const near = hits
        .filter((hit) => Math.abs(hit.first - anchor.first) <= NEARBY_LINES)
        .sort((a, b) => Math.abs(a.first - anchor.first) - Math.abs(b.first - anchor.first))[0];
      if (!near) continue;
      score += 1;
      first = Math.min(first, near.first);
      last = Math.max(last, near.last);
    }
    if (!best || score > best.score) best = { score, first, last };
  }
  return best;
}

export function sourceOfQuote(
  quote: PdfAnnotationQuote,
  texts: Readonly<Record<string, string>>,
): PdfAnnotationSource | null {
  const probes = probesOf(quote);
  if (probes.length === 0) return null;
  const needed = Math.ceil(probes.length / 2);
  let best: { path: string; text: string; first: number; last: number; score: number } | null = null;
  for (const [path, text] of Object.entries(texts)) {
    const keys = text.split(/\r?\n/u).map(keyOf);
    const span = bestSpan(probes.map((probe) => hitsOf(probe, keys)));
    if (span && span.score >= needed && (!best || span.score > best.score)) best = { path, text, ...span };
  }
  if (!best) return null;
  const startLine = best.first + 1;
  const endLine = best.last + 1;
  return { path: best.path, startLine, endLine, excerpt: sourceExcerpt(best.text, startLine, endLine) };
}

export function chooseSource(
  quote: PdfAnnotationQuote,
  synced: PdfAnnotationSource | null,
  region: boolean,
  texts: () => Readonly<Record<string, string>>,
): PdfAnnotationSource | null {
  if (!quote.text.trim()) return synced;
  if (synced && (!region || sourceOfQuote(quote, { [synced.path]: synced.excerpt }))) return synced;
  return sourceOfQuote(quote, texts()) ?? synced;
}
