// The pure helpers now live in the workspace packages (@oleafly/latex,
// @oleafly/ai-core) and are re-exported here so existing `@/lib/ai-figure`
// imports keep working. Only the stateful singletons below are truly
// app-scoped.
export {
  buildStandaloneDoc,
  slugifyFigureName,
  bytesToBase64,
  normalizeFigureCode,
} from "@oleafly/latex";
export { modelSupportsVision, FIGURE_SYSTEM_PROMPT } from "@oleafly/ai-core";

let lastPreview: { pdfBytes: Uint8Array } | null = null;
export function setLastFigurePreview(v: { pdfBytes: Uint8Array } | null) {
  lastPreview = v;
}
export function getLastFigurePreview(): { pdfBytes: Uint8Array } | null {
  return lastPreview;
}

// Captured at session start, not live.
let insertTarget: { from: number; to: number } | null = null;
export function setFigureInsertTarget(v: { from: number; to: number } | null) {
  insertTarget = v;
}
export function getFigureInsertTarget(): { from: number; to: number } | null {
  return insertTarget;
}
