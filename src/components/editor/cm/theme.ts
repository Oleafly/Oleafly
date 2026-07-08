import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * CodeMirror chrome + syntax theme.
 *
 * Uses CSS variables (the Geist tokens + `--cm-*` syntax vars) so a single
 * theme adapts to both light and dark automatically - no compartment swapping
 * needed.
 */
const chromeTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    height: "100%",
    fontSize: "var(--cm-font-size, 13px)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.6",
  },
  ".cm-content": {
    caretColor: "var(--primary)",
    padding: "10px 0",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--muted-foreground)",
    border: "none",
    paddingLeft: "6px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--foreground)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklch, var(--muted) 45%, transparent)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklch, var(--primary) 18%, transparent) !important",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--primary)",
    borderLeftWidth: "2px",
  },
  ".cm-panels": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
  },
  "& .cm-panels.cm-panels-top": {
    borderBottom: "1px solid var(--border)",
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
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
  ".cm-tooltip-autocomplete ul li .cm-completionDetail": {
    color: "var(--muted-foreground)",
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
