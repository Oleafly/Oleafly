export const QUICK_CAPTURE_WINDOW = "quick-capture";
export const CAPTURE_EVENT = "notes:quick-capture";
export const CAPTURED_EVENT = "notes:quick-captured";
export const CAPTURE_SHOWN_EVENT = "quick-capture:shown";
export const CAPTURE_OPEN_NOTES_EVENT = "notes:quick-capture-open-notes";
export const CAPTURE_REPLY_MS = 15_000;

export type CaptureTarget = "new" | "today";

export interface CaptureRequest {
  id: string;
  text: string;
  target: CaptureTarget;
}

export interface CaptureReply {
  id: string;
  noteId?: string;
  error?: string;
}

const TITLE_CHARS = 80;
const HEADING = /^#{1,6}\s+/u;
const BLOCK_MARKER = /^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s+)/u;
const ESCAPED = /\\([!-/:-@[-`{-~])/gu;
const ENTITY = /&(?:lt|gt|amp|quot|#39);/gu;
const ENTITIES: Readonly<Record<string, string>> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'" };
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function shortened(line: string): string {
  if (line.length <= TITLE_CHARS) return line;
  const cut = line.slice(0, TITLE_CHARS);
  const space = cut.lastIndexOf(" ");
  return (space > TITLE_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd();
}

function unescaped(line: string): string {
  return line.replaceAll(ESCAPED, "$1").replaceAll(ENTITY, (entity) => ENTITIES[entity] ?? entity);
}

export function captureDraft(text: string): { title: string; body: string } {
  const lines = text.replaceAll(/\r\n?/gu, "\n").trim().split("\n");
  const first = (lines[0] ?? "").trim();
  const plain = first.replace(HEADING, "");
  const words = plain.replace(BLOCK_MARKER, "").trim();
  const title = shortened(words);
  const keepsFirstLine = title !== words || words !== plain;
  return { title: unescaped(title), body: (keepsFirstLine ? lines : lines.slice(1)).join("\n").trim() };
}

export function countCharacters(text: string): number {
  return Array.from(GRAPHEMES.segment(text)).length;
}

export function isCaptureTarget(value: unknown): value is CaptureTarget {
  return value === "new" || value === "today";
}

export function isCaptureRequest(value: unknown): value is CaptureRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return typeof request.id === "string" && typeof request.text === "string" && isCaptureTarget(request.target);
}
