import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { visualModeActive, visualPortsFacet } from "../facets";
import { pointerSelectionTracking, scrollAdjustment } from "../selection";
import { tableTheme } from "../table/theme";
import { visualHighlightStyle, visualTheme } from "../theme";
import type { VisualPorts } from "../types";
import { typstAtomicDecorations } from "./field";
import { typstVisualKeymap } from "./keymap";
import { typstMarkDecorations } from "./marks";
import { typstMathThemeWatcher } from "./math";
import { typstPasteHtml } from "./paste-html";
import { typstContentShownWhenParsed } from "./reveal";
import { typstVisualTheme } from "./theme";

export { buildTypstDecorations, TYPST_SETTINGS_LABELS, typstVisualField } from "./field";
export { buildTypstMarks, typstMarkDecorations } from "./marks";
export { htmlToTypst } from "./html-to-typst";
export { typstFromClipboard, typstPasteHtml } from "./paste-html";
export { leaveTypstHeading, typstVisualKeymap } from "./keymap";
export { repaintTypstMath, TypstMathWidget } from "./math";

export function typstVisualMode(ports: VisualPorts): Extension {
  return [
    visualModeActive.of(true),
    visualPortsFacet.of(ports),
    EditorView.lineWrapping,
    visualTheme,
    visualHighlightStyle,
    tableTheme,
    typstVisualTheme,
    pointerSelectionTracking,
    scrollAdjustment,
    typstAtomicDecorations,
    typstMarkDecorations,
    typstVisualKeymap,
    typstPasteHtml,
    typstContentShownWhenParsed,
    typstMathThemeWatcher,
  ];
}
