import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Uses CSS variables (the Geist tokens + `--cm-*` syntax vars) so a single
// theme adapts to both light and dark automatically, no compartment swapping
// needed.
const chromeTheme = EditorView.theme({
  // Paint properties belong on the bare theme class: CodeMirror copies the
  // theme classes onto the tooltip host it mounts under `tooltips({ parent })`
  // so tooltips inherit the editor's colors and type scale.
  "&": {
    backgroundColor: "var(--cm-editor-bg, var(--background))",
    color: "var(--cm-editor-fg, var(--foreground))",
    fontSize: "var(--cm-font-size, 13px)",
  },
  // Layout must NOT: `&` compiles to the bare generated class, so `height:100%`
  // there also sized that body-level tooltip host to a full viewport, doubling
  // the document height and leaving the whole app programmatically scrollable
  // behind `body { overflow: hidden }`. Scope it to the editor element itself.
  "&.cm-editor": {
    height: "100%",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--cm-font-family, var(--font-mono))",
    lineHeight: "1.6",
    minHeight: "0",
    overflow: "auto",
  },
  ".cm-content": {
    caretColor: "var(--cm-cursor, var(--primary))",
    padding: "10px 0",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--cm-gutter-fg, var(--muted-foreground))",
    border: "none",
    paddingLeft: "6px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--cm-editor-fg, var(--foreground))",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--cm-active-line, color-mix(in oklch, var(--muted) 45%, transparent))",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor:
      "var(--cm-selection, color-mix(in oklch, var(--primary) 18%, transparent)) !important",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--cm-cursor, var(--primary))",
    borderLeftWidth: "1px",
  },
  // The search panel is a floating widget that draws its own surface, so the
  // panel container stays transparent. Painting it here put an opaque strip
  // across the editor and ruled a line under the widget.
  ".cm-panels": {
    color: "var(--popover-foreground)",
  },
  ".cm-textfield": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in oklch, var(--primary) 25%, transparent)",
    borderRadius: "2px",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "color-mix(in oklch, var(--primary) 50%, transparent)",
  },
  ".cm-button": {
    backgroundColor: "var(--secondary)",
    color: "var(--secondary-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    backgroundImage: "none",
  },
  ".cm-button:hover": {
    backgroundColor: "var(--accent)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    boxShadow: "0 4px 12px rgba(0,0,0,.12)",
  },
  // Completion list: one padded row per option — a type badge, the label with
  // the typed prefix highlighted, and the source pushed to the right — rather
  // than three runs of text butted against each other.
  ".cm-tooltip-autocomplete": {
    padding: "4px",
    borderRadius: "0.625rem",
  },
  ".cm-tooltip-autocomplete > ul": {
    fontFamily: "inherit",
    maxHeight: "18rem",
  },
  ".cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    height: "auto",
    padding: "5px 8px",
    borderRadius: "0.375rem",
    lineHeight: "1.3",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "color-mix(in oklch, var(--primary) 22%, transparent)",
    color: "var(--foreground)",
  },
  ".cm-tooltip-autocomplete > ul > li .cm-completionLabel": {
    color: "var(--foreground)",
  },
  // The characters already typed, so the eye can see why a row matched.
  ".cm-tooltip-autocomplete > ul > li .cm-completionMatchedText": {
    color: "var(--primary)",
    fontWeight: "600",
    textDecoration: "none",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionMatchedText": {
    color: "var(--foreground)",
  },
  ".cm-tooltip-autocomplete ul li .cm-completionDetail": {
    marginLeft: "auto",
    paddingLeft: "12px",
    color: "var(--muted-foreground)",
    fontStyle: "italic",
    fontSize: "0.9em",
    whiteSpace: "nowrap",
  },
  // No type badge: the command name and its source already say what a row is,
  // and the column only added noise.
  ".cm-tooltip-autocomplete > ul > li .cm-completionIcon": {
    display: "none",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    padding: "0 4px",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 8px 0 4px",
    minWidth: "2.5em",
  },
  // Inline AI edit diff preview.
  ".cm-inline-del": {
    backgroundColor: "color-mix(in oklch, var(--destructive) 18%, transparent)",
    textDecoration: "line-through",
    textDecorationColor: "color-mix(in oklch, var(--destructive) 70%, transparent)",
  },
  ".cm-inline-add": {
    backgroundColor: "color-mix(in oklch, oklch(0.72 0.19 149) 20%, transparent)",
    borderRadius: "2px",
  },
  // Block widget hosting the inline AI edit panel: full content width.
  ".cm-inline-prompt": {
    width: "100%",
    boxSizing: "border-box",
    padding: "0 8px 0 2px",
  },
});

const highlightStyle = HighlightStyle.define([
  { tag: t.comment, color: "var(--cm-comment)", fontStyle: "italic" },
  { tag: t.keyword, color: "var(--cm-keyword)" },
  { tag: [t.atom, t.bool, t.number, t.literal], color: "var(--cm-number)" },
  { tag: t.string, color: "var(--cm-string)" },
  { tag: [t.bracket, t.brace, t.paren], color: "var(--cm-bracket)" },
  { tag: t.variableName, color: "var(--cm-variable)" },
  { tag: [t.heading, t.meta], color: "var(--cm-meta)" },
  { tag: t.tagName, color: "var(--cm-tag)" },
  { tag: t.operator, color: "var(--cm-operator)" },
  { tag: t.link, color: "var(--cm-string)", textDecoration: "underline" },
]);

export const editorTheme = () => [chromeTheme, syntaxHighlighting(highlightStyle)];
