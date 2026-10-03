import { TYPST_LABEL_PATTERN } from "@oleafly/editor/typst-syntax";
import { insertTemplate, replaceRange } from "@/components/editor/cm/controller";
import { latexGraphicsPath } from "@/components/editor/figure-import";
import { dirname } from "@/lib/path-utils";
import {
  matchTypstContent,
  typstArguments,
  typstStringLiteral,
  typstStringValue,
  type TypstArgument,
  type TypstSpan,
} from "./typst-scan";
import { TYPST_FIGURE_ALT_SINCE, typstVersionSupports } from "./typst-version";

export type TypstFigurePlacement = "none" | "auto" | "top" | "bottom";

export const TYPST_FIGURE_PLACEMENTS: readonly TypstFigurePlacement[] = ["none", "auto", "top", "bottom"];

export const TYPST_PASTED_FIGURE_WIDTH = "80%";

export interface TypstExtraArgument {
  readonly name: string | null;
  readonly text: string;
}

export interface TypstFigureFields {
  readonly path: string;
  readonly width: string | null;
  readonly caption: string | null;
  readonly label: string | null;
  readonly alt: string | null;
  readonly placement: TypstFigurePlacement;
  readonly figureAlt?: boolean;
  readonly imageArgs?: readonly TypstExtraArgument[];
  readonly figureArgs?: readonly TypstExtraArgument[];
}

export interface TypstFigureSnippet {
  readonly template: string;
  readonly selStart: number;
  readonly selEnd: number;
}

export type TypstFigureBody = "image" | "table" | "other";

export interface TypstFigureMatch extends TypstSpan {
  readonly callEnd: number;
  readonly body: TypstFigureBody;
  readonly label: string | null;
  readonly fields: TypstFigureFields | null;
}

const LABEL = new RegExp(`^<(${TYPST_LABEL_PATTERN})>`, "u");
const LABEL_WHOLE = new RegExp(`^${TYPST_LABEL_PATTERN}$`, "u");
const SEARCH_WINDOW = 64 * 1024;
const MAX_CANDIDATES = 200;
const PLACEMENTS: ReadonlySet<string> = new Set(TYPST_FIGURE_PLACEMENTS);

export function sanitizeTypstLabel(label: string): string {
  const trimmed = label.trim();
  if (LABEL_WHOLE.test(trimmed)) return trimmed;
  const replaced = trimmed.replace(/[^\p{L}\p{M}\p{N}\p{Pc}.:-]+/gu, "-").replace(/^[^\p{L}\p{M}\p{N}\p{Pc}]+/u, "");
  return LABEL_WHOLE.test(replaced) ? replaced : "label";
}

function bracketsBalanced(text: string): boolean {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "\\") index += 1;
    else if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

export function typstCaptionContent(caption: string): string {
  const flat = caption.replaceAll(/\r?\n/gu, " ");
  return bracketsBalanced(flat) ? flat : flat.replaceAll(/(?<!\\)([[\]])/gu, "\\$1");
}

function extraArgs(args: readonly TypstExtraArgument[] | undefined, skip: ReadonlySet<string>): string[] {
  return (args ?? []).filter((arg) => arg.name === null || !skip.has(arg.name)).map((arg) => arg.text);
}

export function typstFigureSource(
  fields: TypstFigureFields,
  version: string | null | undefined,
): TypstFigureSnippet {
  const altOnFigure = Boolean(fields.figureAlt) && typstVersionSupports(version, TYPST_FIGURE_ALT_SINCE);
  const imageParts = [typstStringLiteral(fields.path)];
  if (fields.width) imageParts.push(`width: ${fields.width}`);
  const imageSkip = new Set<string>(["width", ...(fields.alt && !altOnFigure ? ["alt"] : [])]);
  imageParts.push(...extraArgs(fields.imageArgs, imageSkip));
  if (fields.alt && !altOnFigure) imageParts.push(`alt: ${typstStringLiteral(fields.alt)}`);
  const lines = ["#figure(", `  image(${imageParts.join(", ")}),`];
  if (fields.alt && altOnFigure) lines.push(`  alt: ${typstStringLiteral(fields.alt)},`);
  if (fields.placement !== "none") lines.push(`  placement: ${fields.placement},`);
  const figureSkip = new Set<string>();
  if (fields.caption !== null) figureSkip.add("caption");
  if (fields.placement !== "none") figureSkip.add("placement");
  if (fields.alt && altOnFigure) figureSkip.add("alt");
  for (const extra of extraArgs(fields.figureArgs, figureSkip)) lines.push(`  ${extra},`);
  let selStart = -1;
  let selEnd = -1;
  if (fields.caption !== null) {
    const content = typstCaptionContent(fields.caption);
    selStart = `${lines.join("\n")}\n  caption: [`.length;
    selEnd = selStart + content.length;
    lines.push(`  caption: [${content}],`);
  }
  lines.push(fields.label ? `) <${sanitizeTypstLabel(fields.label)}>` : ")");
  const template = lines.join("\n");
  if (selStart < 0) return { template, selStart: template.length, selEnd: template.length };
  return { template, selStart, selEnd };
}

function argumentText(source: string, arg: TypstArgument): TypstExtraArgument {
  return { name: arg.name, text: source.slice(arg.from, arg.to) };
}

interface ParsedImage {
  path: string;
  width: string | null;
  alt: string | null;
  imageArgs: TypstExtraArgument[];
}

function parseImage(source: string, arg: TypstArgument): ParsedImage | null {
  const head = /^#?image(?=\()/u.exec(source.slice(arg.from, arg.to));
  if (!head || arg.name !== null) return null;
  const parsed = typstArguments(source, arg.from + head[0].length);
  if (!parsed || parsed.end !== arg.to) return null;
  let path: string | null = null;
  let width: string | null = null;
  let alt: string | null = null;
  const imageArgs: TypstExtraArgument[] = [];
  for (const item of parsed.args) {
    const value = source.slice(item.value.from, item.value.to);
    if (item.name === null && path === null) {
      path = typstStringValue(value);
      if (path === null) return null;
    } else if (item.name === "width") {
      width = value;
    } else if (item.name === "alt" && typstStringValue(value) !== null) {
      alt = typstStringValue(value);
    } else {
      imageArgs.push(argumentText(source, item));
    }
  }
  return path === null ? null : { path, width, alt, imageArgs };
}

function figureBody(source: string, arg: TypstArgument | undefined): TypstFigureBody {
  if (!arg || arg.name !== null) return "other";
  const text = source.slice(arg.from, arg.to);
  if (/^#?image\(/u.test(text)) return "image";
  if (/^#?table\(/u.test(text)) return "table";
  return "other";
}

function parseFields(source: string, args: readonly TypstArgument[]): TypstFigureFields | null {
  const [first, ...rest] = args;
  const image = first ? parseImage(source, first) : null;
  if (!image) return null;
  let caption: string | null = null;
  let placement: TypstFigurePlacement = "none";
  let alt = image.alt;
  let figureAlt = false;
  const figureArgs: TypstExtraArgument[] = [];
  for (const arg of rest) {
    const value = source.slice(arg.value.from, arg.value.to);
    const content =
      value.startsWith("[") && matchTypstContent(source, arg.value.from + 1) === arg.value.to;
    if (arg.name === "caption" && caption === null && content) {
      caption = value.slice(1, -1);
    } else if (arg.name === "placement" && placement === "none" && PLACEMENTS.has(value)) {
      placement = value as TypstFigurePlacement;
    } else if (arg.name === "alt" && alt === null && typstStringValue(value) !== null) {
      alt = typstStringValue(value);
      figureAlt = true;
    } else {
      figureArgs.push(argumentText(source, arg));
    }
  }
  return {
    path: image.path,
    width: image.width,
    caption,
    label: null,
    alt,
    placement,
    ...(figureAlt ? { figureAlt } : {}),
    ...(image.imageArgs.length > 0 ? { imageArgs: image.imageArgs } : {}),
    ...(figureArgs.length > 0 ? { figureArgs } : {}),
  };
}

function figureCallStart(source: string, index: number): number | null {
  if (!source.startsWith("figure(", index)) return null;
  const before = source[index - 1];
  if (before === "#") return index - 1;
  if (before === undefined || !/[\p{ID_Continue}.-]/u.test(before)) return index;
  return null;
}

function trailingLabel(source: string, from: number): { label: string; end: number } | null {
  let index = from;
  while (source[index] === " " || source[index] === "\t") index += 1;
  const match = LABEL.exec(source.slice(index, index + 512));
  return match ? { label: match[1], end: index + match[0].length } : null;
}

export function typstFigureAt(source: string, pos: number): TypstFigureMatch | null {
  let index = source.lastIndexOf("figure(", Math.min(pos, source.length));
  for (let seen = 0; index >= 0 && seen < MAX_CANDIDATES && pos - index <= SEARCH_WINDOW; seen++) {
    const from = figureCallStart(source, index);
    const parsed = from === null ? null : typstArguments(source, index + "figure".length);
    if (from !== null && parsed) {
      const label = trailingLabel(source, parsed.end);
      const to = label?.end ?? parsed.end;
      if (pos >= from && pos <= to) {
        const fields = parseFields(source, parsed.args);
        return {
          from,
          to,
          callEnd: parsed.end,
          body: figureBody(source, parsed.args[0]),
          label: label?.label ?? null,
          fields: fields ? { ...fields, label: label?.label ?? null } : null,
        };
      }
    }
    index = index === 0 ? -1 : source.lastIndexOf("figure(", index - 1);
  }
  return null;
}

export function typstImageReference(projectPath: string, filePath: string | null): string {
  return latexGraphicsPath(projectPath, filePath ?? "");
}

export function projectPathForTypstReference(reference: string, filePath: string | null): string {
  const parts = reference.startsWith("/") ? [] : dirname(filePath ?? "").split("/").filter(Boolean);
  for (const part of reference.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

export interface TypstFigureDialogOptions {
  readonly path: string;
  readonly width: string | null;
  readonly caption: string | null;
  readonly label: string | null;
  readonly alt: string | null;
  readonly placement: TypstFigurePlacement;
}

export function insertTypstFigureFromDialog(
  options: TypstFigureDialogOptions,
  filePath: string | null,
  version: string | null | undefined,
): void {
  const snippet = typstFigureSource(
    { ...options, path: typstImageReference(options.path, filePath) },
    version,
  );
  insertTemplate(`${snippet.template}\n`, snippet.selStart, snippet.selEnd);
}

const PLACEHOLDER_FILE = "image-filename";

export function typstFigurePlaceholder(): TypstFigureSnippet {
  const { template } = typstFigureSource(
    {
      path: PLACEHOLDER_FILE,
      width: TYPST_PASTED_FIGURE_WIDTH,
      caption: "Caption text",
      label: "fig:label",
      alt: null,
      placement: "none",
    },
    null,
  );
  const start = template.indexOf(PLACEHOLDER_FILE);
  return { template: `${template}\n`, selStart: start, selEnd: start + PLACEHOLDER_FILE.length };
}

export function insertTypstFigurePlaceholder(): void {
  const snippet = typstFigurePlaceholder();
  insertTemplate(snippet.template, snippet.selStart, snippet.selEnd);
}

export function applyTypstFigureEdit(
  target: TypstSpan,
  fields: TypstFigureFields,
  version: string | null | undefined,
): void {
  replaceRange(target.from, target.to, typstFigureSource(fields, version).template);
}
