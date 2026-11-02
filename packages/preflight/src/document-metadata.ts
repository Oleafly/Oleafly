import { maskComments } from "./mask";

export interface DocumentMetadataMatch {
  body: string;
  start: number;
  end: number;
}

export function findDocumentMetadata(source: string): DocumentMetadataMatch | null {
  const head = /\\DocumentMetadata\s{0,20}\{/.exec(source);
  if (!head) return null;
  const open = head.index + head[0].length;
  let depth = 1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return { body: source.slice(open, i), start: head.index, end: i + 1 };
    }
  }
  return null;
}

export function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of body) {
    if (character === "{") depth++;
    if (character === "}") depth = Math.max(0, depth - 1);
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
}

export interface MetadataKeys {
  order: string[];
  map: Map<string, string>;
}

export function parseMetadataKeys(body: string): MetadataKeys {
  const order: string[] = [];
  const map = new Map<string, string>();
  for (const part of splitTopLevel(body)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key) continue;
    if (!map.has(key)) order.push(key);
    map.set(key, value);
  }
  return { order, map };
}

export function serializeMetadataKeys({ order, map }: MetadataKeys): string {
  return order.map((key) => `${key}=${map.get(key)}`).join(",");
}

export function unwrapBraces(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed.slice(1, -1) : trimmed;
}

// The first LaTeX release whose stable kernel tags with tagging=on. Older
// kernels reject the key (2024-11-01 ignores it but still writes the PDF/UA
// claim) or do not know \DocumentMetadata at all (the bundled engine's
// 2021-11-15), so Oleafly guards the line it inserts with this date.
export const TAGGING_FORMAT_DATE = "2025-11-01";
export const TAGGING_SKIPPED_NOTICE = `Tagging is off: tagged PDF needs LaTeX ${TAGGING_FORMAT_DATE} or newer.`;

export function guardedDocumentMetadata(body: string): string {
  return String.raw`\IfFormatAtLeastTF{${TAGGING_FORMAT_DATE}}{\DocumentMetadata{${body}}}{\typeout{${TAGGING_SKIPPED_NOTICE}}}`;
}

const FORMAT_GUARD = /\\IfFormatAtLeastTF\s{0,20}\{\s{0,20}(\d{4}-\d{2}-\d{2})\s{0,20}\}\s{0,20}\{\s{0,20}$/;

/** The date of the \IfFormatAtLeastTF guard that directly wraps the text at `start`, if any. */
export function formatGuardDate(source: string, start: number): string | null {
  return FORMAT_GUARD.exec(source.slice(Math.max(0, start - 120), start))?.[1] ?? null;
}

export function requestsTaggedPdf(source: string): boolean {
  if (!source.includes(String.raw`\DocumentMetadata`)) return false;
  const metadata = findDocumentMetadata(maskComments(source));
  if (!metadata) return false;
  const keys = parseMetadataKeys(metadata.body).map;
  const tagging = unwrapBraces(keys.get("tagging") ?? "").toLowerCase();
  if (tagging) return tagging !== "off";
  if (keys.has("testphase")) return true;
  return /\bua-\d/i.test(unwrapBraces(keys.get("pdfstandard") ?? ""));
}
