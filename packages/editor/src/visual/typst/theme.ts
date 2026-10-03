import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const MONO = "var(--ofl-visual-mono)";
const SANS = "var(--ofl-visual-sans)";

export const typstVisualTheme: Extension = EditorView.theme({
  ".ofl-visual-typst-heading": {
    fontWeight: "550",
    lineHeight: "1.35",
  },
  ".ofl-visual-typst-heading-1": { fontSize: "1.6em", paddingTop: "0.4em" },
  ".ofl-visual-typst-heading-2": { fontSize: "1.44em", paddingTop: "0.3em" },
  ".ofl-visual-typst-heading-3": { fontSize: "1.2em", paddingTop: "0.2em" },
  ".ofl-visual-typst-heading-4, .ofl-visual-typst-heading-5, .ofl-visual-typst-heading-6": {
    fontSize: "1em",
  },
  ".ofl-visual-typst-strong": { fontWeight: "700" },
  ".ofl-visual-typst-emph": { fontStyle: "italic" },
  ".ofl-visual-typst-emph .ofl-visual-typst-emph": { fontStyle: "normal" },
  ".ofl-visual-typst-underline": { textDecoration: "underline" },
  ".ofl-visual-typst-strike": { textDecoration: "line-through" },
  ".ofl-visual-typst-overline": { textDecoration: "overline" },
  ".ofl-visual-typst-highlight": {
    backgroundColor: "color-mix(in srgb, #facc15 40%, transparent)",
    borderRadius: "2px",
  },
  ".ofl-visual-typst-smallcaps": { fontVariant: "small-caps" },
  ".ofl-visual-typst-upper": { textTransform: "uppercase" },
  ".ofl-visual-typst-lower": { textTransform: "lowercase" },
  ".ofl-visual-typst-sub": { verticalAlign: "sub", fontSize: "smaller", lineHeight: "0.85" },
  ".ofl-visual-typst-super": { verticalAlign: "super", fontSize: "smaller", lineHeight: "0.85" },
  ".ofl-visual-typst-raw": {
    fontFamily: MONO,
    fontSize: "0.9em",
  },
  ".ofl-visual-typst-raw-line": {
    backgroundColor: "var(--ofl-visual-panel)",
    fontFamily: MONO,
    padding: "0 12px",
  },
  ".ofl-visual-typst-raw-first-line": {
    borderTopLeftRadius: "8px",
    borderTopRightRadius: "8px",
    paddingTop: "0.25em",
  },
  ".ofl-visual-typst-raw-last-line": {
    borderBottomLeftRadius: "8px",
    borderBottomRightRadius: "8px",
    paddingBottom: "0.25em",
  },
  ".ofl-visual-typst-raw-language": {
    fontFamily: SANS,
    fontSize: "0.75em",
    color: "var(--ofl-visual-muted)",
    backgroundColor: "var(--ofl-visual-chip)",
    borderRadius: "4px",
    padding: "0 0.45em",
  },
  ".ofl-visual-typst-code": {
    fontFamily: MONO,
    fontSize: "0.85em",
    color: "var(--ofl-visual-muted)",
    fontWeight: "normal",
    fontStyle: "normal",
  },
  ".ofl-visual-typst-comment": {
    fontFamily: MONO,
    fontSize: "0.85em",
    color: "var(--ofl-visual-muted)",
    opacity: "0.8",
  },
  ".ofl-visual-typst-term": { fontWeight: "700" },
  ".ofl-visual-typst-label": {
    fontSize: "0.7em",
    color: "var(--ofl-visual-muted)",
    verticalAlign: "0.15em",
  },
  ".ofl-visual-chip-cite, .ofl-visual-chip-ref": {
    color: "var(--ofl-visual-muted)",
  },
  ".ofl-visual-typst-ref-supplement": {
    fontFamily: SANS,
    color: "var(--cm-editor-fg, var(--foreground))",
  },
  ".ofl-visual-typst-ref-supplement-separator": {
    display: "inline-block",
    width: "1px",
    height: "0.9em",
    margin: "0 0.4em",
    verticalAlign: "-0.1em",
    backgroundColor: "currentColor",
    opacity: "0.4",
  },
  ".ofl-visual-typst-math-source": {
    fontFamily: MONO,
    fontSize: "0.9em",
  },
  ".ofl-visual-typst-math-pending": {
    color: "var(--ofl-visual-muted)",
  },
  ".ofl-visual-typst-math img.ofl-typst-math": {
    display: "inline-block",
    verticalAlign: "middle",
    maxWidth: "100%",
  },
  ".ofl-visual-typst-math img.ofl-typst-math.is-stale": {
    opacity: "0.55",
  },
  ".ofl-visual-math-display.ofl-visual-typst-math img.ofl-typst-math": {
    display: "block",
    margin: "0.35em auto",
  },
  ".ofl-visual-typst-figure-line": {
    backgroundColor: "var(--ofl-visual-panel)",
    padding: "0 12px",
    textAlign: "center",
  },
  ".ofl-visual-typst-figure-first-line": {
    borderTopLeftRadius: "8px",
    borderTopRightRadius: "8px",
    paddingTop: "0.5em",
  },
  ".ofl-visual-typst-figure-last-line": {
    borderBottomLeftRadius: "8px",
    borderBottomRightRadius: "8px",
    paddingBottom: "0.75em",
    boxShadow: "0 2px 5px -3px var(--ofl-visual-shadow)",
  },
  ".ofl-visual-typst-caption": {
    fontSize: "0.92em",
    fontStyle: "italic",
  },
  ".ofl-visual-typst-table": {
    textAlign: "left",
  },
});
