import { base64ToBytes } from "@/lib/base64";
import { parseOptionLine } from "./note-blocks";
import { notePath } from "./note-path";

export const NOTEBOOK_INFO = "notebook";
export const NOTEBOOK_MAX_BYTES = 64 * 1024 * 1024;

export interface CellRange {
  from: number;
  to: number;
}

export interface NotebookBlock {
  path: string;
  cells: CellRange | null;
  hideCode: boolean;
}

export type NotebookBlockResult = { ok: true; block: NotebookBlock } | { ok: false; problem: "path" | "cells" };

const RANGE = /^(\d+)(?:\s*-\s*(\d+))?$/u;

function cellRange(value: string): CellRange | null {
  const match = RANGE.exec(value.trim());
  if (!match) return null;
  const from = Number(match[1]);
  const to = match[2] === undefined ? from : Number(match[2]);
  return from >= 1 && to >= from ? { from, to } : null;
}

export function parseNotebookBlock(source: string): NotebookBlockResult {
  const lines = source.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const [first = "", ...options] = lines;
  const path = notePath(first);
  if (!path) return { ok: false, problem: "path" };
  let cells: CellRange | null = null;
  let hideCode = false;
  for (const line of options) {
    const option = parseOptionLine(line);
    if (!option) continue;
    const key = option.name.toLowerCase();
    if (key === "cells") {
      cells = cellRange(option.value);
      if (!cells) return { ok: false, problem: "cells" };
    } else if (key === "code") {
      hideCode = option.value.trim().toLowerCase() === "hide";
    }
  }
  return { ok: true, block: { path, cells, hideCode } };
}

export function notebookFence(path: string): string {
  return `\`\`\`${NOTEBOOK_INFO}\n${path}\n\`\`\``;
}

export function isNotebookPath(path: string): boolean {
  return /\.ipynb$/iu.test(path);
}

export class NotebookTooLargeError extends Error {
  constructor() {
    super("The notebook is larger than 64 MiB.");
    this.name = "NotebookTooLargeError";
  }
}

const DATA_URL = /^data:([^,]*),/iu;

export function notebookText(url: string): string | null {
  const match = DATA_URL.exec(url);
  if (!match) return null;
  const body = url.slice(match[0].length);
  if (/;base64$/iu.test(match[1])) {
    const encoded = body.replaceAll(/\s+/gu, "");
    if (Math.floor((encoded.length * 3) / 4) > NOTEBOOK_MAX_BYTES + 2) throw new NotebookTooLargeError();
    return new TextDecoder().decode(base64ToBytes(encoded));
  }
  const text = decodeURIComponent(body);
  if (new TextEncoder().encode(text).length > NOTEBOOK_MAX_BYTES) throw new NotebookTooLargeError();
  return text;
}
