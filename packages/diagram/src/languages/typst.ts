import type { Parser } from "@lezer/common";
import { loadTypstParser } from "@oleafly/editor/typst";
import type { DiagramModel } from "@oleafly/latex";
import { type FletcherExtras, modelToFletcher } from "../fletcher";
import { readFletcher, TYPST_COMMENT } from "../fletcher-reader";
import { modelMarkLine } from "./model-mark";
import type { DiagramLanguage, DiagramStandalone, DiagramWriteOptions } from "./types";

let parser: Parser | null = null;

export async function loadFletcherReader(): Promise<Parser> {
  parser ??= await loadTypstParser();
  return parser;
}

const PAGE_LINE = /^#set page\(width: auto, height: auto, margin: 4pt(?:, fill: rgb\("#([0-9a-f]{6})"\))?\)[ \t]*$/;

export function typstPageLine(background?: string | null): string {
  const hex = (background ?? "").replace("#", "").toLowerCase();
  const fill = /^[0-9a-f]{6}$/.test(hex) ? `, fill: rgb("#${hex}")` : "";
  return `#set page(width: auto, height: auto, margin: 4pt${fill})`;
}

export function typstPreviewDocument(code: string, background: string): string {
  const hex = background.replace("#", "").toLowerCase();
  const fill = /^[0-9a-f]{6}$/.test(hex) ? `rgb("#${hex}")` : "none";
  return `#set page(width: auto, height: auto, margin: 4pt, fill: ${fill})\n${code}`;
}

export const TYPST_PREVIEW_PREFIX_LINES = 1;

function write(model: DiagramModel, options: DiagramWriteOptions = {}): string {
  return modelToFletcher(model, {
    typstVersion: options.typstVersion ?? null,
    extras: (options.extras as FletcherExtras | null | undefined) ?? null,
  });
}

function fromStandalone(source: string): DiagramStandalone {
  const lines = source.split(/\r\n|\r|\n/);
  const match = PAGE_LINE.exec(lines[0] ?? "");
  if (!match) return { code: source };
  const code = lines.slice(1).join("\n");
  return match[1] ? { code, background: `#${match[1]}` } : { code };
}

export const typstLanguage: DiagramLanguage = {
  id: "typst",
  name: "Typst",
  extension: "typ",
  documentExtensions: [".typ"],
  importExtensions: [".typ"],
  vector: true,
  load: async () => {
    await loadFletcherReader();
  },
  ready: () => parser !== null,
  write,
  read: (source, options) => {
    if (!parser) throw new Error("The Typst reader is not loaded yet.");
    return readFletcher(parser, source, options);
  },
  fileSource: (model, options) => `${write(model, options)}\n${modelMarkLine(TYPST_COMMENT, model)}\n`,
  standaloneSource: (model, options) => {
    const { background, ...rest } = model;
    return `${typstPageLine(background)}\n${write(rest, options)}\n${modelMarkLine(TYPST_COMMENT, model)}\n`;
  },
  fromStandalone,
  fromFile: (_name, content) => content,
  insertText: (code) => `${code.trim()}\n`,
  fixPrompt: (code, log) => ({
    system:
      'You fix Typst figure code that draws a diagram with the fletcher package so it compiles. Keep the #import "@preview/fletcher:..." line and the #diagram(...) call with its node(...) and edge(...) items. Keep node names, positions and styling unless they cause the error. Return ONLY the corrected Typst code: the import line and the diagram. No #set page rule, no explanation, no markdown code fences. Never use em dashes.',
    user: `This fletcher diagram failed to compile. Fix it.\n\nCODE:\n${code}\n\nTYPST ERRORS:\n${log}`,
  }),
  seeds: { math: "$E = m c^2$", code: "`print(x)`" },
  snippets: {
    rectangleNode: "node((0cm, 0cm), [Label], name: <n>, width: 2cm, height: 1cm, shape: rect, stroke: 1pt),\n",
    circleNode: "node((3cm, 0cm), [], name: <m>, radius: 0.5cm, shape: circle, stroke: 1pt),\n",
    arrowEdge: 'edge(<n>, <m>, "-|>"),\n',
    lineEdge: 'edge(<n>, <m>, "-"),\n',
    scope: "node(enclose: (<n>, <m>), stroke: 1pt, corner-radius: 6pt),\n",
  },
};
