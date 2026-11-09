import type { LucideIcon } from "lucide-react";

export type NoteFile = (path: string) => Promise<string | null>;

export interface PaintContext {
  readFile?: NoteFile;
  still: boolean;
  fence?: string;
  noteId?: string;
}

export type Dispose = () => void;

export type BlockPaint = (preview: HTMLElement, source: string, context: PaintContext) => Dispose | undefined;

export interface BlockTemplate {
  info: string;
  source: string;
}

export interface NoteBlockKind {
  name: string;
  aliases?: readonly string[];
  label: () => string;
  icon: LucideIcon;
  paint: BlockPaint;
  still?: BlockPaint | "card";
  interactive?: boolean;
  scripted?: boolean;
  template?: () => BlockTemplate;
}

const kinds = new Map<string, NoteBlockKind>();
const names = new Map<string, string>();

export function registerNoteBlock(kind: NoteBlockKind): void {
  kinds.set(kind.name, kind);
  names.set(kind.name, kind.name);
  for (const alias of kind.aliases ?? []) names.set(alias, kind.name);
}

export function noteBlockName(info: string): string | undefined {
  const name = info.trim().replace(/^\{=(.+)\}$/u, "$1").trim().toLowerCase();
  return names.get(name);
}

export function noteBlock(name: string): NoteBlockKind | undefined {
  return kinds.get(names.get(name) ?? "");
}

export function noteBlockKinds(): NoteBlockKind[] {
  return [...kinds.values()];
}

export function currentTheme(): "dark" | "light" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function blockMessage(preview: HTMLElement, text: string): void {
  const paragraph = document.createElement("p");
  paragraph.className = "note-drawn-empty";
  paragraph.textContent = text;
  preview.replaceChildren(paragraph);
}

const CARD_SUMMARY = 120;

export function blockSummary(source: string): string {
  const line = source
    .split(/\r?\n/u)
    .map((text) => text.trim())
    .find(Boolean);
  if (!line) return "";
  return line.length > CARD_SUMMARY ? `${line.slice(0, CARD_SUMMARY).trimEnd()}…` : line;
}

export function paintBlockCard(preview: HTMLElement, label: string, source: string): void {
  const card = document.createElement("div");
  card.className = "note-block-card";
  const title = document.createElement("p");
  title.className = "note-block-card-title";
  title.textContent = label;
  card.append(title);
  const summary = blockSummary(source);
  if (summary) {
    const text = document.createElement("p");
    text.className = "note-block-card-text";
    text.textContent = summary;
    card.append(text);
  }
  preview.replaceChildren(card);
}

const DATA_URL = /^data:([^,]*),/iu;

export class BlockFileTooLargeError extends Error {
  constructor() {
    super("The file is too large to show here.");
    this.name = "BlockFileTooLargeError";
  }
}

export function dataUrlBytes(url: string, maxBytes: number): Uint8Array | null {
  const match = DATA_URL.exec(url);
  if (!match) return null;
  const body = url.slice(match[0].length);
  if (/;base64$/iu.test(match[1])) {
    const encoded = body.replace(/\s+/gu, "");
    if (Math.floor((encoded.length * 3) / 4) > maxBytes + 2) throw new BlockFileTooLargeError();
    let binary: string;
    try {
      binary = atob(encoded);
    } catch {
      return null;
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  let text: string;
  try {
    text = decodeURIComponent(body);
  } catch {
    return null;
  }
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > maxBytes) throw new BlockFileTooLargeError();
  return bytes;
}

export function dataUrlText(url: string, maxBytes: number): string | null {
  const bytes = dataUrlBytes(url, maxBytes);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

const OPTION_LINE = /^([a-z][a-z0-9_-]*)\s*:\s*(.*)$/iu;

export interface BlockOptions {
  options: Map<string, string>;
  body: string;
}

export function splitBlockOptions(source: string, keys: ReadonlySet<string>): BlockOptions {
  const lines = source.split(/\r?\n/u);
  const options = new Map<string, string>();
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    const match = OPTION_LINE.exec(line);
    if (!match || !keys.has(match[1].toLowerCase())) break;
    options.set(match[1].toLowerCase(), match[2].trim());
    index += 1;
  }
  return { options, body: lines.slice(index).join("\n") };
}
