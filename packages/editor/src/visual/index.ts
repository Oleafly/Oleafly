import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { atomicDecorations } from "./atomic-decorations";
import { visualModeActive, visualPortsFacet } from "./facets";
import { visualKeymap } from "./keymap";
import { listItemMarker } from "./list-marker";
import { markDecorations } from "./mark-decorations";
import { contentShownWhenParsed } from "./parsed-content";
import { pasteHtml } from "./paste-html";
import { pointerSelectionTracking, scrollAdjustment } from "./selection";
import { tableTheme } from "./table/theme";
import { visualHighlightStyle, visualTheme } from "./theme";
import type { VisualPorts } from "./types";

export type { VisualImage, VisualPorts, VisualRange } from "./types";
export { visualModeActive, visualPortsFacet } from "./facets";
export { latexTreeLanguage, latexTreeParser, latexTreeSupport } from "../latex-tree";
export {
  type AtomicDecorationResult,
  atomicDecorations,
  buildAtomicDecorations,
  type TheoremInfo,
  type VisualAtomicState,
  visualAtomicField,
} from "./atomic-decorations";
export { buildMarkDecorations, markDecorations } from "./mark-decorations";
export { contentParsedEffect, contentParsedField, contentShownWhenParsed } from "./parsed-content";
export { insertListItemOrLeaveHeading, visualKeymap } from "./keymap";
export { listItemMarker } from "./list-marker";
export { selectDecoratedArgument } from "./select-argument";
export { skipAtomicRanges, skipPreambleCursor } from "./skip-preamble";
export {
  type Extents,
  extendBackwardsOverEmptyLines,
  extendForwardsOverEmptyLines,
  hasMouseDownEffect,
  mouseDownEffect,
  placeSelectionInsideBlock,
  pointerSelectionTracking,
  scrollAdjustment,
  selectNodeContent,
  selectionAtMouseDown,
  selectionIntersects,
} from "./selection";
export { tableTheme } from "./table/theme";
export { visualHighlightStyle, visualTheme } from "./theme";
export { typesetNodeInto } from "./typeset";
export { collapsePreambleEffect, type Preamble, type PreambleEntry, PreambleWidget } from "./widgets/preamble";
export { MathWidget, paintMath, renderVisualMath } from "./widgets/math";
export { pasteHtml } from "./paste-html";
export {
  hideMathPreview,
  isMathPreviewEnabled,
  mathPreviewEnabled,
  mathPreviewTargetAt,
  mathPreviewTooltip,
  setMathPreview,
  setMathPreviewEnabled,
} from "./math-preview";

export function visualMode(ports: VisualPorts): Extension {
  return [
    visualModeActive.of(true),
    visualPortsFacet.of(ports),
    EditorView.lineWrapping,
    visualTheme,
    visualHighlightStyle,
    tableTheme,
    pointerSelectionTracking,
    scrollAdjustment,
    listItemMarker,
    atomicDecorations,
    markDecorations,
    visualKeymap,
    pasteHtml,
    contentShownWhenParsed,
  ];
}

export function isVisualMode(state: EditorState): boolean {
  return state.facet(visualModeActive);
}
