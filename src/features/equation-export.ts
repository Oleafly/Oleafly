/**
 * Equation to SVG/PNG export (G16). MathJax 3 runs lazily in the webview
 * through its lite DOM adaptor, so no network endpoints are involved and the
 * chunk only loads on first use. Rasterization happens on a canvas.
 */
import { enclosingMathEnvironment } from "@/components/editor/cm/hover-math";
import { activeSelectionText } from "@/components/editor/selection-text";
import { getEditorView } from "@oleafly/editor";
import { typstAutolinkEnd } from "@oleafly/editor/typst-syntax";
import {
  renderTypstSnippet,
  writeBytesFile,
  type TypstSnippetDiagnostic,
  type TypstSnippetRequest,
} from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { pickSavePath } from "@/lib/native-file-dialog";
import { notifyError, toast } from "@/lib/toast";
import { decodeAppError, describeError } from "@/lib/app-error";
import { i18n } from "@/i18n";
import { base64ToBytes, bytesToBase64 } from "@/lib/base64";

type Convert = (tex: string, display: boolean) => string;

let mathjaxConvert: Promise<Convert> | null = null;

async function loadMathJax(): Promise<Convert> {
  if (!mathjaxConvert) {
    mathjaxConvert = (async () => {
      const { mathjax } = await import("mathjax-full/js/mathjax.js");
      const { TeX } = await import("mathjax-full/js/input/tex.js");
      const { SVG } = await import("mathjax-full/js/output/svg.js");
      const { liteAdaptor } = await import("mathjax-full/js/adaptors/liteAdaptor.js");
      const { RegisterHTMLHandler } = await import("mathjax-full/js/handlers/html.js");
      const { AllPackages } = await import("mathjax-full/js/input/tex/AllPackages.js");
      const adaptor = liteAdaptor({ fontSize: 16 });
      RegisterHTMLHandler(adaptor);
      const tex = new TeX({
        packages: AllPackages,
        inlineMath: [
          ["$", "$"],
          ["\\(", "\\)"],
        ],
      });
      const svg = new SVG({ fontCache: "local" });
      const doc = mathjax.document("", { InputJax: tex, OutputJax: svg });
      return (input: string, display: boolean) => {
        const node = doc.convert(input, { display });
        const markup = adaptor.outerHTML(node);
        // MathJax renders compile errors as an merror node instead of
        // throwing; surface them so the caller can report the real problem.
        const errorMatch = markup.match(/data-mjx-error="([^"]*)"/);
        if (errorMatch) {
          throw new Error(
            `MathJax could not render this equation: ${errorMatch[1]}`,
          );
        }
        return markup;
      };
    })().catch((error) => {
      mathjaxConvert = null;
      throw error;
    });
  }
  return mathjaxConvert;
}

/** Render TeX to a standalone `<svg>` document string. */
export async function equationToSvgDocument(tex: string, display = true): Promise<string> {
  const convert = await loadMathJax();
  const markup = convert(tex, display);
  const start = markup.indexOf("<svg");
  const end = markup.lastIndexOf("</svg>");
  if (start < 0 || end < 0) {
    throw new Error("MathJax produced no SVG for this equation.");
  }
  const svg = markup.slice(start, end + "</svg>".length);
  if (!svg.includes("xmlns=")) {
    return svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return svg;
}

/** Rasterize an SVG document to PNG bytes at `scale` (default 3x). */
export async function svgDocumentToPngBytes(
  svg: string,
  scale = 3,
  background: string | null = null,
): Promise<Uint8Array> {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("the SVG could not be rasterized"));
      element.src = url;
    });
    const width = Math.max(1, Math.ceil((image.width || 300) * scale));
    const height = Math.max(1, Math.ceil((image.height || 60) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas is unavailable in this window");
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!pngBlob) throw new Error("the PNG could not be encoded");
    return new Uint8Array(await pngBlob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The equation to export: the selection when one exists, otherwise the
 * math environment enclosing the caret. Null when neither applies. */
export function equationAtCursor(): { tex: string; display: boolean } | null {
  const view = getEditorView();
  if (!view) return null;
  const selection = activeSelectionText();
  if (selection?.trim()) {
    const inner = selection.trim();
    const display = /^\$\$|^\\\[/.test(inner);
    const tex = inner
      .replace(/^\$\$/, "")
      .replace(/\$\$$/, "")
      .replace(/^\\\[/, "")
      .replace(/\\\]$/, "");
    return { tex: tex.trim(), display };
  }
  const text = view.state.doc.toString();
  const math = enclosingMathEnvironment(text, view.state.selection.main.head);
  if (math) {
    return { tex: math.body.trim(), display: math.environment !== "inline" };
  }
  return null;
}

export interface TypstEquation {
  math: string;
  display: boolean;
}

interface TypstMathSpan {
  from: number;
  to: number;
}

const TYPST_CODE_STRING_OPENERS = new Set(["(", ",", "=", ":", "+", "{"]);

function previousNonBlank(text: string, index: number): string {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (text[cursor] !== " " && text[cursor] !== "\t") return text[cursor];
  }
  return "";
}

function typstStringEnd(text: string, from: number): number {
  for (let cursor = from + 1; cursor < text.length; cursor += 1) {
    if (text[cursor] === "\\") cursor += 1;
    else if (text[cursor] === '"') return cursor + 1;
  }
  return text.length;
}

function typstBlockCommentEnd(text: string, from: number): number {
  let depth = 0;
  let cursor = from;
  while (cursor < text.length) {
    if (text.startsWith("/*", cursor)) {
      depth += 1;
      cursor += 2;
    } else if (text.startsWith("*/", cursor)) {
      depth -= 1;
      cursor += 2;
      if (depth === 0) return cursor;
    } else {
      cursor += 1;
    }
  }
  return text.length;
}

function typstRawEnd(text: string, from: number): number {
  let width = 1;
  while (text[from + width] === "`") width += 1;
  const close = text.indexOf("`".repeat(width), from + width);
  return close < 0 ? text.length : close + width;
}

function typstLineEnd(text: string, from: number): number {
  const newline = text.indexOf("\n", from);
  return newline < 0 ? text.length : newline;
}

function typstOpaqueEnd(text: string, cursor: number, inMath: boolean): number | null {
  const character = text[cursor];
  if (character === "\\") return cursor + 2;
  if (!inMath) {
    const link = typstAutolinkEnd(text, cursor);
    if (link !== null) return link;
    if (character === "`") return typstRawEnd(text, cursor);
  }
  if (text.startsWith("//", cursor)) return typstLineEnd(text, cursor);
  if (text.startsWith("/*", cursor)) return typstBlockCommentEnd(text, cursor);
  if (character === '"' && (inMath || TYPST_CODE_STRING_OPENERS.has(previousNonBlank(text, cursor)))) {
    return typstStringEnd(text, cursor);
  }
  return null;
}

function typstMathSpans(text: string): TypstMathSpan[] {
  const spans: TypstMathSpan[] = [];
  let open = -1;
  let cursor = 0;
  while (cursor < text.length) {
    const opaque = typstOpaqueEnd(text, cursor, open >= 0);
    if (opaque !== null) {
      cursor = opaque;
      continue;
    }
    if (text[cursor] === "$") {
      if (open < 0) open = cursor;
      else {
        spans.push({ from: open, to: cursor + 1 });
        open = -1;
      }
    }
    cursor += 1;
  }
  return spans;
}

function isTypstDisplayMath(math: string): boolean {
  return math.length >= 3 && /^\$\s/u.test(math) && /\s\$$/u.test(math);
}

function typstEquation(math: string): TypstEquation {
  return { math, display: isTypstDisplayMath(math) };
}

export function typstEquationAt(text: string, offset: number): TypstEquation | null {
  const span = typstMathSpans(text).find(({ from, to }) => from <= offset && offset <= to);
  return span ? typstEquation(text.slice(span.from, span.to)) : null;
}

function typstEquationFromSelection(selection: string): TypstEquation {
  const trimmed = selection.trim();
  const [span] = typstMathSpans(trimmed);
  return typstEquation(span ? trimmed.slice(span.from, span.to) : `$${trimmed}$`);
}

export function typstEquationAtCursor(): TypstEquation | null {
  const view = getEditorView();
  if (!view) return null;
  const selection = activeSelectionText();
  if (selection?.trim()) return typstEquationFromSelection(selection);
  return typstEquationAt(view.state.doc.toString(), view.state.selection.main.head);
}

export class TypstEquationError extends Error {
  readonly diagnostics: TypstSnippetDiagnostic[];
  readonly detail: string;

  constructor(diagnostics: TypstSnippetDiagnostic[]) {
    const detail = diagnostics.find((diagnostic) => diagnostic.severity === "error")?.message ?? "";
    super(`Typst could not render this equation: ${detail}`);
    this.name = "TypstEquationError";
    this.diagnostics = diagnostics;
    this.detail = detail;
  }
}

async function renderTypstEquation(request: TypstSnippetRequest) {
  const result = await renderTypstSnippet(request);
  if (result.status === "failed") throw new TypstEquationError(result.diagnostics);
  return result.image;
}

export async function typstEquationToSvgDocument(math: string): Promise<string> {
  const image = await renderTypstEquation({ source: math, format: "svg" });
  if (image.format !== "svg") throw new Error("Typst returned a PNG for an SVG request.");
  return image.svg;
}

const TYPST_FILL_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/iu;
const CSS_PIXELS_PER_INCH = 96;

export async function typstEquationToPngBytes(
  math: string,
  scale = 3,
  background: string | null = null,
): Promise<Uint8Array> {
  const fill = background && TYPST_FILL_COLOR.test(background) ? `#set page(fill: rgb("${background}"))\n` : "";
  const image = await renderTypstEquation({
    source: `${fill}${math}`,
    format: "png",
    ppi: Math.max(1, Math.round(CSS_PIXELS_PER_INCH * scale)),
  });
  if (image.format !== "png") throw new Error("Typst returned an SVG for a PNG request.");
  return base64ToBytes(image.pngBase64);
}

type ExportEquation =
  | ({ language: "typst" } & TypstEquation)
  | { language: "latex"; tex: string; display: boolean };

function exportEquationAtCursor(): ExportEquation | null {
  if (/\.typ$/iu.test(useFilesStore.getState().activePath ?? "")) {
    const equation = typstEquationAtCursor();
    return equation && { language: "typst", ...equation };
  }
  const equation = equationAtCursor();
  return equation && { language: "latex", ...equation };
}

function exportSvg(equation: ExportEquation): Promise<string> {
  return equation.language === "typst"
    ? typstEquationToSvgDocument(equation.math)
    : equationToSvgDocument(equation.tex, equation.display);
}

async function exportPng(equation: ExportEquation, scale: number, background: string | null): Promise<Uint8Array> {
  if (equation.language === "typst") return typstEquationToPngBytes(equation.math, scale, background);
  return svgDocumentToPngBytes(await equationToSvgDocument(equation.tex, equation.display), scale, background);
}

const EQUATION_EXPORT_TOAST_KEY = "equation-export";

export function equationFailureMessage(error: unknown, fallback: string): string {
  if (error instanceof TypstEquationError && error.detail) {
    return i18n.t(($) => $.editor.equationExport.typstFailed, { detail: error.detail });
  }
  return decodeAppError(error) ? describeError(error) : fallback;
}

async function saveBytes(defaultName: string, filters: { name: string; extensions: string[] }[], bytes: Uint8Array, kind: string): Promise<void> {
  const dest = await pickSavePath({ defaultPath: defaultName, filters });
  if (!dest) return;
  await writeBytesFile(dest, bytesToBase64(bytes));
  toast.successUnique(EQUATION_EXPORT_TOAST_KEY, i18n.t(($) => $.editor.equationExport.saved, { kind }), {
    label: i18n.t(($) => $.editor.equationExport.showInFolder),
    onClick: () => void import("@/lib/tauri").then((m) => m.revealInDir(dest)),
  });
}

/** Save the equation under the cursor (or selection) as an SVG file. */
export async function saveEquationAsSvg(): Promise<void> {
  const equation = exportEquationAtCursor();
  if (!equation) {
    toast.info(i18n.t(($) => $.editor.equationExport.noEquation));
    return;
  }
  try {
    const svg = await exportSvg(equation);
    await saveBytes(
      "equation.svg",
      [{ name: i18n.t(($) => $.editor.equationExport.svgImage), extensions: ["svg"] }],
      new TextEncoder().encode(svg),
      i18n.t(($) => $.editor.equationExport.svgKind),
    );
  } catch (e) {
    notifyError(
      "export equation svg",
      e,
      equationFailureMessage(e, i18n.t(($) => $.researchTools.equation.exportSvgFailed)),
    );
  }
}

/** Save the equation under the cursor (or selection) as a PNG file. */
export async function saveEquationAsPng(scale = 3, background: string | null = "#ffffff"): Promise<void> {
  const equation = exportEquationAtCursor();
  if (!equation) {
    toast.info(i18n.t(($) => $.editor.equationExport.noEquation));
    return;
  }
  try {
    const bytes = await exportPng(equation, scale, background);
    await saveBytes(
      "equation.png",
      [{ name: i18n.t(($) => $.editor.equationExport.pngImage), extensions: ["png"] }],
      bytes,
      i18n.t(($) => $.editor.equationExport.pngKind),
    );
  } catch (e) {
    notifyError(
      "export equation png",
      e,
      equationFailureMessage(e, i18n.t(($) => $.researchTools.equation.exportImageFailed)),
    );
  }
}

if (E2E_HOOKS && typeof window !== "undefined") {
  const w = window as unknown as Record<string, unknown>;
  // Renders an equation through the real MathJax path for the
  // conversion-matrix e2e spec.
  w.__e2eEquationSvg = equationToSvgDocument;
}
