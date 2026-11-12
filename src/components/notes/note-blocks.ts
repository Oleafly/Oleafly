import type { LucideIcon } from "lucide-react";
import { BLOCK_CARD, BLOCK_MESSAGE } from "@/components/ui/block-frame";

export type NoteFile = (path: string) => Promise<string | null>;

export interface PaintContext {
  readFile?: NoteFile;
  still: boolean;
  fence?: string;
  noteId?: string;
  rewrite?: (change: (source: string) => string) => void;
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

export function inSharedNote(context: PaintContext): boolean {
  return !context.still && context.noteId === undefined;
}

export function currentTheme(): "dark" | "light" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function svgNode(tag: string, attributes: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

export function svgText(text: string, attributes: Record<string, string | number>): SVGElement {
  const node = svgNode("text", attributes);
  node.textContent = text;
  return node;
}

type IconNode = readonly (readonly [string, Readonly<Record<string, string>>])[];

export function iconSvg(icon: LucideIcon, className: string): SVGElement {
  const render = (icon as unknown as { render: (props: object, ref: null) => { props: { iconNode: IconNode } } }).render;
  const svg = svgNode("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    class: className,
  });
  for (const [tag, { key: _key, ...attributes }] of render({}, null).props.iconNode) svg.append(svgNode(tag, attributes));
  return svg;
}

export function blockMessage(preview: HTMLElement, text: string): void {
  preview.replaceChildren(element("p", BLOCK_MESSAGE, text));
}

export function paintAsync<T>(
  preview: HTMLElement,
  steps: {
    loading?: string;
    load: () => Promise<T>;
    show: (value: T, alive: () => boolean) => Dispose | undefined | Promise<void>;
    error: (problem: unknown) => string;
  },
): Dispose {
  let live = true;
  let dispose: Dispose | undefined;
  const alive = () => live;
  if (steps.loading) blockMessage(preview, steps.loading);
  steps
    .load()
    .then(async (value) => {
      if (!live) return;
      const shown = steps.show(value, alive);
      if (typeof shown === "function") dispose = shown;
      else await shown;
    })
    .catch((error: unknown) => {
      if (live) blockMessage(preview, steps.error(error));
    });
  return () => {
    live = false;
    dispose?.();
  };
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
  const card = element("div", BLOCK_CARD);
  card.append(element("p", "text-xs font-semibold", label));
  const summary = blockSummary(source);
  if (summary) card.append(element("p", "mt-1 truncate font-mono text-[0.6875rem] text-muted-foreground", summary));
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
    const encoded = body.replaceAll(/\s+/gu, "");
    if (Math.floor((encoded.length * 3) / 4) > maxBytes + 2) throw new BlockFileTooLargeError();
    let binary: string;
    try {
      binary = atob(encoded);
    } catch {
      return null;
    }
    return Uint8Array.from(binary, (byte) => byte.codePointAt(0) ?? 0);
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

const OPTION_NAME = /^[a-z][a-z0-9_-]*$/iu;
export const LINE_BREAK = /[\n\r\u2028\u2029]/u;

export interface OptionLine {
  name: string;
  value: string;
}

export function parseOptionLine(line: string): OptionLine | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const name = line.slice(0, colon).trimEnd();
  const value = line.slice(colon + 1).trimStart();
  return OPTION_NAME.test(name) && !LINE_BREAK.test(value) ? { name, value } : null;
}

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
    const option = parseOptionLine(line);
    if (!option || !keys.has(option.name.toLowerCase())) break;
    options.set(option.name.toLowerCase(), option.value);
    index += 1;
  }
  return { options, body: lines.slice(index).join("\n") };
}
