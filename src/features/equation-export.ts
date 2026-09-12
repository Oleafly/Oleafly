/**
 * Equation to SVG/PNG export (G16). MathJax 3 runs lazily in the webview
 * through its lite DOM adaptor, so no network endpoints are involved and the
 * chunk only loads on first use. Rasterization happens on a canvas.
 */
import { enclosingMathEnvironment } from "@/components/editor/cm/hover-math";
import { activeSelectionText } from "@/components/editor/selection-text";
import { getEditorView } from "@oleafly/editor";
import { writeBytesFile } from "@/lib/tauri";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { pickSavePath } from "@/lib/native-file-dialog";
import { notifyError, toast } from "@/lib/toast";

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
      element.onerror = () => reject(new Error("the equation SVG could not be rasterized"));
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
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

async function saveBytes(defaultName: string, filters: { name: string; extensions: string[] }[], bytes: Uint8Array, kind: string): Promise<void> {
  const dest = await pickSavePath({ defaultPath: defaultName, filters });
  if (!dest) return;
  await writeBytesFile(dest, bytesToBase64(bytes));
  toast.success(`${kind} saved`, { label: "Show in folder", onClick: () => void import("@/lib/tauri").then((m) => m.revealInDir(dest)) }, true);
}

/** Save the equation under the cursor (or selection) as an SVG file. */
export async function saveEquationAsSvg(): Promise<void> {
  const equation = equationAtCursor();
  if (!equation) {
    toast.info("Put the caret inside an equation, or select one, first.");
    return;
  }
  try {
    const svg = await equationToSvgDocument(equation.tex, equation.display);
    await saveBytes(
      "equation.svg",
      [{ name: "SVG image", extensions: ["svg"] }],
      new TextEncoder().encode(svg),
      "Equation SVG",
    );
  } catch (e) {
    notifyError("export equation svg", e);
  }
}

/** Save the equation under the cursor (or selection) as a PNG file. */
export async function saveEquationAsPng(scale = 3, background: string | null = "#ffffff"): Promise<void> {
  const equation = equationAtCursor();
  if (!equation) {
    toast.info("Put the caret inside an equation, or select one, first.");
    return;
  }
  try {
    const svg = await equationToSvgDocument(equation.tex, equation.display);
    const bytes = await svgDocumentToPngBytes(svg, scale, background);
    await saveBytes(
      "equation.png",
      [{ name: "PNG image", extensions: ["png"] }],
      bytes,
      "Equation PNG",
    );
  } catch (e) {
    notifyError("export equation png", e);
  }
}

if (E2E_HOOKS && typeof window !== "undefined") {
  const w = window as unknown as Record<string, unknown>;
  // Renders an equation through the real MathJax path for the
  // conversion-matrix e2e spec.
  w.__e2eEquationSvg = equationToSvgDocument;
}
