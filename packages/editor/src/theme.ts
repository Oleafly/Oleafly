import { EditorView } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { editorColor, editorColorDeclarations } from "./color-roles";
import { editorHighlightStyle } from "./syntax-colors";

export const EDITOR_LINE_HEIGHT = "1.7";

export const EDITOR_LINE_HEIGHT_CSS = `var(--cm-line-height, ${EDITOR_LINE_HEIGHT})`;

const chromeTheme = EditorView.theme({
  // Paint properties belong on the bare theme class: CodeMirror copies the
  // theme classes onto the tooltip host it mounts under `tooltips({ parent })`
  // so tooltips inherit the editor's colors and type scale.
  "&": {
    ...editorColorDeclarations(),
    backgroundColor: editorColor("background"),
    color: editorColor("text"),
    fontSize: "var(--cm-font-size, 13px)",
  },
  "&.cm-editor": {
    height: "100%",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--cm-font-family, var(--font-mono))",
    lineHeight: EDITOR_LINE_HEIGHT_CSS,
    minHeight: "0",
    overflow: "auto",
  },
  ".cm-content": {
    caretColor: "var(--cm-cursor-custom, var(--cm-cursor, var(--primary)))",
    letterSpacing: "var(--cm-letter-spacing, normal)",
    padding: "10px 0",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: editorColor("lineNumbers"),
    border: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
    cursor: "default",
    paddingLeft: "var(--cm-gutter-inset, 6px)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: editorColor("text"),
  },
  ".cm-activeLine": {
    backgroundColor: "var(--cm-active-line, color-mix(in oklch, var(--muted) 45%, transparent))",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: `${editorColor("selection")} !important`,
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--cm-cursor-custom, var(--cm-cursor, var(--primary)))",
    borderLeftWidth: "var(--cm-cursor-width, 1px)",
    marginLeft: "calc(var(--cm-cursor-width, 1px) / -2)",
  },
  ".cm-cursor": {
    boxSizing: "content-box",
    paddingBlock: "var(--cm-cursor-extend, 0px)",
    marginTop: "calc(-1 * var(--cm-cursor-extend, 0px))",
  },
  "&.cm-editor .cm-fat-cursor": {
    background: "var(--cm-cursor-custom, #ff9696)",
  },
  ".cm-panels": {
    color: "var(--popover-foreground)",
  },
  ".cm-panels-bottom": {
    borderTop: "1px solid var(--border)",
  },
  ".cm-vim-panel": {
    minHeight: "28px",
    alignItems: "center",
    padding: "3px 10px",
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.6875rem",
    fontWeight: "600",
    letterSpacing: "0.04em",
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
    paddingRight: "2px",
    paddingLeft: "var(--cm-gutter-number-inset, 4px)",
    minWidth: "var(--cm-gutter-min-width, 2.5em)",
  },
  ".cm-lintRange": {
    textDecorationLine: "underline",
    textDecorationStyle: "wavy",
    textDecorationThickness: "0.7px",
    textDecorationSkipInk: "none",
    textUnderlinePosition: "under",
  },
  ".cm-lintRange-error": { backgroundImage: "none", textDecorationColor: "#f11" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecorationColor: "orange" },
  ".cm-lintRange-info": { backgroundImage: "none", textDecorationColor: "#999" },
  ".cm-lintRange-hint": { backgroundImage: "none", textDecorationColor: "#66d" },
  ".cm-inline-del": {
    backgroundColor: "color-mix(in oklch, var(--destructive) 18%, transparent)",
    textDecoration: "line-through",
    textDecorationColor: "color-mix(in oklch, var(--destructive) 70%, transparent)",
  },
  ".cm-inline-add": {
    backgroundColor: "color-mix(in oklch, oklch(0.72 0.19 149) 20%, transparent)",
    borderRadius: "2px",
  },
  ".cm-inline-prompt": {
    width: "100%",
    boxSizing: "border-box",
    padding: "0 8px 0 2px",
  },
});

export { editorHighlightStyle };

export const editorTheme = () => [
  chromeTheme,
  syntaxHighlighting(editorHighlightStyle),
];
