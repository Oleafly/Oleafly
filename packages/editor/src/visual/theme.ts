import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const visualHighlightStyle: Extension = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.link, class: "ofl-visual-link-text" },
    { tag: t.url, class: "ofl-visual-url" },
    { tag: [t.typeName, t.attributeValue, t.keyword, t.string, t.literal], class: "ofl-visual-monospace" },
    { tag: t.punctuation, class: "ofl-visual-punctuation" },
    { tag: t.strong, class: "ofl-visual-strong" },
    { tag: t.monospace, class: "ofl-visual-monospace" },
  ]),
);

const MONO = "var(--ofl-visual-mono)";
const SERIF = "var(--ofl-visual-font)";
const SANS = "var(--ofl-visual-sans)";

export const visualTheme: Extension = EditorView.theme({
  "&.cm-editor": {
    "--ofl-visual-font": '"Noto Serif", "Palatino Linotype", "Book Antiqua", Palatino, serif',
    "--ofl-visual-font-size": "calc(var(--cm-font-size, 13px) * 1.15)",
    "--ofl-visual-mono": "var(--cm-font-family, var(--font-mono, ui-monospace, monospace))",
    "--ofl-visual-sans": "var(--font-sans, system-ui, sans-serif)",
    "--ofl-visual-panel": "color-mix(in srgb, var(--foreground) 5%, transparent)",
    "--ofl-visual-chip": "color-mix(in srgb, var(--foreground) 9%, transparent)",
    "--ofl-visual-chip-hover": "color-mix(in srgb, var(--foreground) 16%, transparent)",
    "--ofl-visual-rule": "var(--border)",
    "--ofl-visual-shadow": "color-mix(in srgb, var(--foreground) 25%, transparent)",
    "--ofl-visual-muted": "var(--muted-foreground)",
  },
  "& .cm-content": {
    opacity: "0",
  },
  "&.ofl-visual-parsed .cm-content": {
    opacity: "1",
    transition: "opacity 0.1s ease-out",
  },
  ".cm-content.cm-content": {
    overflowX: "hidden",
    padding: "0.75em max(calc((100% - 95ch) / 2), 6%)",
    fontFamily: SERIF,
    fontSize: "var(--ofl-visual-font-size)",
  },
  ".cm-line": {
    overflowX: "visible",
  },
  ".cm-gutters": {
    opacity: "0.5",
  },
  ".ofl-visual-link-text": {
    textDecoration: "underline",
    fontFamily: "inherit",
    textUnderlineOffset: "2px",
  },
  ".ofl-visual-monospace": {
    fontFamily: MONO,
    lineHeight: "1",
    fontWeight: "normal",
    fontStyle: "normal",
    fontVariant: "normal",
    textDecoration: "none",
  },
  ".ofl-visual-strong": {
    fontWeight: "700",
  },
  ".ofl-visual-punctuation": {
    fontFamily: MONO,
    lineHeight: "1",
  },
  ".ofl-visual-brace": {
    opacity: "0.5",
  },
  ".ofl-visual-icon-brace": {
    opacity: "1",
    display: "inline-flex",
    alignItems: "center",
    gap: "0.2em",
    color: "var(--ofl-visual-muted)",
    verticalAlign: "-0.1em",
    marginRight: "0.15em",
  },
  ".ofl-visual-icon": {
    width: "0.95em",
    height: "0.95em",
    flex: "none",
  },
  ".ofl-visual-chip": {
    backgroundColor: "var(--ofl-visual-chip)",
    borderRadius: "4px",
    padding: "0 0.35em",
    fontFamily: MONO,
    fontSize: "0.85em",
  },
  ".ofl-visual-indicator": {
    color: "var(--ofl-visual-muted)",
    opacity: "0.7",
  },
  ".ofl-visual-heading": {
    fontWeight: "550",
    lineHeight: "1.35",
    color: "inherit",
    background: "inherit",
  },
  ".ofl-visual-command-book, .ofl-visual-command-part": {
    fontSize: "2em",
  },
  ".ofl-visual-command-chapter": {
    fontSize: "1.6em",
  },
  ".ofl-visual-command-section": {
    fontSize: "1.44em",
  },
  ".ofl-visual-command-subsection": {
    fontSize: "1.2em",
  },
  ".ofl-visual-command-subsubsection, .ofl-visual-command-paragraph, .ofl-visual-command-subparagraph": {
    fontSize: "1em",
  },
  ".ofl-visual-command-textbf": {
    fontWeight: "700",
  },
  ".ofl-visual-command-textit": {
    fontStyle: "italic",
  },
  ".ofl-visual-command-textsc": {
    fontVariant: "small-caps",
  },
  ".ofl-visual-command-texttt": {
    fontFamily: MONO,
  },
  ".ofl-visual-command-textmd, .ofl-visual-command-textmd > .ofl-visual-command-textbf": {
    fontWeight: "normal",
  },
  ".ofl-visual-command-textsf": {
    fontFamily: SANS,
  },
  ".ofl-visual-command-textsuperscript": {
    verticalAlign: "super",
    fontSize: "smaller",
    lineHeight: "0.85",
  },
  ".ofl-visual-command-textsubscript": {
    verticalAlign: "sub",
    fontSize: "smaller",
    lineHeight: "0.85",
  },
  ".ofl-visual-command-underline": {
    textDecoration: "underline",
  },
  ".ofl-visual-command-sout": {
    textDecoration: "line-through",
  },
  ".ofl-visual-command-emph": {
    fontStyle: "italic",
    "& .ofl-visual-command-textit": {
      fontStyle: "normal",
    },
    ".ofl-visual-command-textit &": {
      fontStyle: "normal",
    },
  },
  ".ofl-visual-command-url": {
    textDecoration: "underline",
    fontFamily: MONO,
    lineHeight: "1",
    overflowWrap: "break-word",
  },
  ".ofl-visual-command-verb": {
    fontFamily: MONO,
  },
  ".ofl-visual-command-verb .ofl-visual-monospace": {
    color: "inherit",
  },
  ".ofl-visual-space": {
    display: "inline-block",
  },
  ".ofl-visual-math-display": {
    display: "block",
    textAlign: "center",
    overflow: "hidden",
    padding: "0.25em 0",
    cursor: "pointer",
  },
  ".ofl-visual-math-display .katex-display": {
    margin: "0.5em 0",
  },
  ".ofl-visual-math-error": {
    fontFamily: MONO,
    fontSize: "0.9em",
    color: "var(--destructive)",
    whiteSpace: "pre-wrap",
  },
  ".ofl-visual-begin": {
    fontFamily: MONO,
    minHeight: "1em",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    cursor: "pointer",
  },
  ".ofl-visual-end": {
    minHeight: "1em",
    paddingBottom: "1.5em",
    background:
      "linear-gradient(180deg, transparent calc(50% - 1px), var(--ofl-visual-rule) calc(50%), transparent calc(50% + 1px))",
  },
  ".ofl-visual-environment-padding": {
    flex: "1",
    height: "1px",
    backgroundColor: "var(--ofl-visual-rule)",
  },
  ".ofl-visual-environment-name": {
    padding: "0 1em",
  },
  ".ofl-visual-begin-abstract > .ofl-visual-environment-name": {
    fontFamily: SERIF,
    fontSize: "1.2em",
    fontWeight: "550",
  },
  ".ofl-visual-begin-theorem > .ofl-visual-environment-name": {
    fontFamily: SERIF,
    fontWeight: "550",
    padding: "0 0.5em 0 0",
  },
  ".ofl-visual-begin-theorem > .ofl-visual-environment-lead": {
    flex: "0",
  },
  ".ofl-visual-begin-proof > .ofl-visual-environment-name": {
    fontStyle: "italic",
    fontWeight: "normal",
  },
  ".ofl-visual-theorem-title": {
    fontWeight: "normal",
  },
  ".ofl-visual-environment-theorem-plain": {
    fontStyle: "italic",
  },
  ".ofl-visual-environment-top": {
    paddingTop: "1em",
  },
  ".ofl-visual-environment-bottom": {
    paddingBottom: "1em",
  },
  ".ofl-visual-environment-first-line": {
    paddingTop: "0.5em",
    borderTopLeftRadius: "8px",
    borderTopRightRadius: "8px",
  },
  ".ofl-visual-environment-last-line": {
    paddingBottom: "1em",
    borderBottomLeftRadius: "8px",
    borderBottomRightRadius: "8px",
  },
  ".ofl-visual-environment-figure.ofl-visual-environment-line, .ofl-visual-environment-table.ofl-visual-environment-line":
    {
      backgroundColor: "var(--ofl-visual-panel)",
      padding: "0 12px",
    },
  ".ofl-visual-environment-figure.ofl-visual-environment-last-line, .ofl-visual-environment-table.ofl-visual-environment-last-line, .ofl-visual-preamble-line.ofl-visual-environment-last-line":
    {
      boxShadow: "0 2px 5px -3px var(--ofl-visual-shadow)",
    },
  ".ofl-visual-environment-quote-block.ofl-visual-environment-line": {
    borderLeft: "4px solid var(--ofl-visual-rule)",
    paddingLeft: "1em",
    borderRadius: "0",
  },
  ".ofl-visual-environment-verbatim, .ofl-visual-environment-lstlisting": {
    fontFamily: MONO,
  },
  ".ofl-visual-environment-centered.ofl-visual-caption-line, .ofl-visual-environment-centered.ofl-visual-label-line": {
    textAlign: "center",
  },
  ".ofl-visual-environment-centered.ofl-visual-caption-line": {
    padding: "0 10%",
  },
  ".ofl-visual-caption-line .ofl-visual-chip-label": {
    marginRight: "1ch",
  },
  ".ofl-visual-environment-figure": {
    position: "relative",
  },
  ".ofl-visual-item, .ofl-visual-description-item": {
    paddingInlineStart: "calc(var(--ofl-list-depth) * 2ch)",
  },
  ".ofl-visual-item::before": {
    counterReset: "list-item var(--ofl-list-ordinal)",
    content: "counter(list-item, var(--ofl-list-style)) var(--ofl-list-suffix)",
  },
  ".ofl-visual-divider": {
    borderBottom: "1px solid var(--ofl-visual-rule)",
    padding: "0.5em 6px",
  },
  ".ofl-visual-frame.ofl-visual-divider": {
    borderBottom: "none",
    borderTop: "1px solid var(--ofl-visual-rule)",
  },
  ".ofl-visual-frame-title": {
    fontSize: "1.44em",
    cursor: "pointer",
  },
  ".ofl-visual-frame-subtitle": {
    fontSize: "1em",
    cursor: "pointer",
  },
  ".ofl-visual-maketitle": {
    textAlign: "center",
    paddingBottom: "2em",
  },
  ".ofl-visual-title": {
    fontSize: "1.7em",
    cursor: "pointer",
    padding: "0.5em",
    lineHeight: "1.3",
    textWrap: "balance",
  },
  ".ofl-visual-authors": {
    display: "flex",
    justifyContent: "space-evenly",
    gap: "0.5em",
    flexWrap: "wrap",
  },
  ".ofl-visual-author": {
    cursor: "pointer",
    display: "inline-block",
    minWidth: "150px",
  },
  ".ofl-visual-tex": {
    textTransform: "uppercase",
    "& sup": {
      position: "inherit",
      fontSize: "0.85em",
      verticalAlign: "0.15em",
      marginLeft: "-0.36em",
      marginRight: "-0.15em",
    },
    "& sub": {
      position: "inherit",
      fontSize: "1em",
      verticalAlign: "-0.5ex",
      marginLeft: "-0.1667em",
      marginRight: "-0.125em",
    },
  },
  ".ofl-visual-preamble-wrapper": {
    padding: "0.5em 0",
  },
  ".ofl-visual-preamble-wrapper.ofl-visual-preamble-expanded": {
    paddingBottom: "0",
  },
  ".ofl-visual-preamble-widget, .ofl-visual-end-document": {
    padding: "0.35em 1em",
    borderRadius: "8px",
    fontFamily: SANS,
    fontSize: "0.85em",
    color: "var(--ofl-visual-muted)",
    backgroundColor: "var(--ofl-visual-panel)",
  },
  ".ofl-visual-preamble-widget": {
    cursor: "pointer",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1em",
  },
  ".ofl-visual-preamble-widget:hover": {
    backgroundColor: "var(--ofl-visual-chip)",
  },
  ".ofl-visual-preamble-expanded .ofl-visual-preamble-widget": {
    borderBottomLeftRadius: "0",
    borderBottomRightRadius: "0",
    borderBottom: "1px solid var(--ofl-visual-rule)",
  },
  ".ofl-visual-preamble-chevron": {
    width: "1.2em",
    height: "1.2em",
    opacity: "0.6",
    transition: "transform 0.2s ease-out",
  },
  ".ofl-visual-preamble-expanded .ofl-visual-preamble-chevron": {
    transform: "rotate(180deg)",
  },
  ".ofl-visual-preamble-line": {
    backgroundColor: "var(--ofl-visual-panel)",
    padding: "0 12px",
  },
  ".ofl-visual-preamble-line.ofl-visual-environment-first-line": {
    borderRadius: "0",
  },
  ".ofl-visual-end-document": {
    textAlign: "center",
    cursor: "pointer",
  },
  ".ofl-visual-footnote": {
    display: "inline-flex",
    alignItems: "center",
    height: "1.1em",
    padding: "0 0.35em",
    borderRadius: "3px",
    backgroundColor: "var(--ofl-visual-chip)",
    color: "var(--ofl-visual-muted)",
    fontSize: "0.85em",
    lineHeight: "1",
    verticalAlign: "text-top",
    cursor: "pointer",
  },
  ".ofl-visual-footnote:not(.ofl-visual-footnote-view):hover": {
    backgroundColor: "var(--ofl-visual-chip-hover)",
  },
  ".ofl-visual-footnote.ofl-visual-footnote-view": {
    display: "inline",
    height: "auto",
    verticalAlign: "unset",
    padding: "0 0.5em",
  },
  ".ofl-visual-colorbox": {
    borderRadius: "2px",
    padding: "0 0.15em",
  },
});
