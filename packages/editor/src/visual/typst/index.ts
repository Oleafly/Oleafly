import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { visualModeActive, visualPortsFacet } from "../facets";
import { pointerSelectionTracking, scrollAdjustment } from "../selection";
import { tableTheme } from "../table/theme";
import { visualHighlightStyle, visualTheme } from "../theme";
import type { VisualPorts } from "../types";
import { typstAtomicDecorations } from "./field";
import { typstDocumentPath } from "./forms/scope";
import { formAnchors } from "./forms/anchors";
import { typstFormsField, typstFormsSync } from "./forms/state";
import { typstFormsTheme } from "./forms/theme";
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

export function typstVisualMode(ports: VisualPorts, path: string | null = null): Extension {
  return [
    visualModeActive.of(true),
    visualPortsFacet.of(ports),
    typstDocumentPath.of(path),
    typstFormsField,
    typstFormsSync,
    formAnchors,
    EditorView.lineWrapping,
    visualTheme,
    visualHighlightStyle,
    tableTheme,
    typstVisualTheme,
    typstFormsTheme,
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
