import { EditorView } from "@codemirror/view";
import { SNIPPET_CHIP_CLASS } from "../ghost-completion";

export const FIELD_CLASS = "cm-oleaflySnippetField";
export const ACTIVE_FIELD_CLASS = "cm-oleaflySnippetField-active";
export const MIRROR_CLASS = "cm-oleaflySnippetMirror";
export const EMPTY_FIELD_CLASS = "cm-oleaflySnippetPosition";
export const PILL_CLASS = "cm-oleaflySnippetPill";
export const FLASH_CLASS = "cm-oleaflySnippetFlash";
export const INFO_CLASS = "cm-oleaflySnippetInfo";
export const INFO_NAME_CLASS = "cm-oleaflySnippetInfo-name";
export const INFO_META_CLASS = "cm-oleaflySnippetInfo-meta";
export const INFO_BODY_CLASS = "cm-oleaflySnippetInfo-body";
export const INFO_FOOTER_CLASS = "cm-oleaflySnippetInfo-footer";

const PRIMARY = "var(--primary, #2563eb)";

export const snippetSessionTheme = EditorView.baseTheme({
  [`.${SNIPPET_CHIP_CLASS}`]: {
    display: "inline-flex",
    alignItems: "center",
    marginLeft: "8px",
    padding: "0 6px",
    borderRadius: "5px",
    border: "1px solid var(--border, #e5e5e5)",
    backgroundColor: "var(--muted, #f5f5f5)",
    color: "var(--muted-foreground, #525252)",
    fontFamily: "var(--font-sans, sans-serif)",
    fontSize: "0.8em",
    lineHeight: "1.5",
    verticalAlign: "middle",
    pointerEvents: "none",
    userSelect: "none",
  },
  [`.${FIELD_CLASS}`]: {
    backgroundColor: "color-mix(in oklch, var(--muted-foreground, #737373) 14%, transparent)",
    borderRadius: "2px",
  },
  [`.${ACTIVE_FIELD_CLASS}`]: {
    backgroundColor: `color-mix(in oklch, ${PRIMARY} 16%, transparent)`,
    borderBottom: `1.5px solid ${PRIMARY}`,
    borderRadius: "2px 2px 0 0",
  },
  [`.${MIRROR_CLASS}`]: {
    borderBottom: `1.5px dotted color-mix(in oklch, ${PRIMARY} 70%, transparent)`,
  },
  [`.${EMPTY_FIELD_CLASS}`]: {
    display: "inline-block",
    width: "3px",
    height: "1.1em",
    margin: "0 -1.5px",
    verticalAlign: "text-bottom",
  },
  [`.${PILL_CLASS}`]: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    marginLeft: "12px",
    padding: "0 6px",
    borderRadius: "999px",
    border: "1px solid var(--border, #d4d4d4)",
    backgroundColor: "var(--popover, #ffffff)",
    color: "var(--muted-foreground, #737373)",
    fontFamily: "var(--font-sans, sans-serif)",
    fontSize: "0.8em",
    lineHeight: "1.5",
    verticalAlign: "middle",
    userSelect: "none",
    pointerEvents: "none",
  },
  [`.${PILL_CLASS} kbd`]: {
    fontFamily: "inherit",
    fontWeight: "600",
    color: "var(--foreground, #171717)",
  },
  [`.${FLASH_CLASS}`]: {
    backgroundColor: `color-mix(in oklch, ${PRIMARY} 12%, transparent)`,
  },
  [`.${INFO_CLASS}`]: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    maxWidth: "28rem",
    fontFamily: "var(--font-sans, sans-serif)",
    whiteSpace: "normal",
  },
  [`.${INFO_NAME_CLASS}`]: {
    fontWeight: "600",
  },
  [`.${INFO_META_CLASS}`]: {
    color: "var(--muted-foreground, #737373)",
    fontSize: "0.9em",
  },
  [`.${INFO_BODY_CLASS}`]: {
    margin: "0",
    padding: "6px 8px",
    borderRadius: "6px",
    backgroundColor: "color-mix(in oklch, var(--muted-foreground, #737373) 8%, transparent)",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: "0.9em",
    whiteSpace: "pre-wrap",
  },
  [`.${INFO_FOOTER_CLASS}`]: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    color: "var(--muted-foreground, #737373)",
    fontSize: "0.85em",
  },
  [`.${INFO_FOOTER_CLASS} kbd`]: {
    fontFamily: "inherit",
    fontWeight: "600",
    color: "var(--foreground, #171717)",
  },
  [`.${INFO_FOOTER_CLASS} button`]: {
    padding: "0",
    border: "none",
    background: "none",
    color: PRIMARY,
    font: "inherit",
    cursor: "pointer",
  },
  [`.${INFO_FOOTER_CLASS} button:hover`]: {
    textDecoration: "underline",
  },
});
