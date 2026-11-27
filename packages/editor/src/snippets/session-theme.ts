import { EditorView } from "@codemirror/view";
import { SNIPPET_CHIP_CLASS } from "../ghost-completion";

export const FIELD_CLASS = "cm-oleaflySnippetField";
export const ACTIVE_FIELD_CLASS = "cm-oleaflySnippetField-active";
export const MIRROR_CLASS = "cm-oleaflySnippetMirror";
export const EMPTY_FIELD_CLASS = "cm-oleaflySnippetPosition";
export const CARD_CLASS = "cm-oleaflySnippetCard";
export const CARD_STEPS_CLASS = "cm-oleaflySnippetCard-steps";
export const CARD_STEP_CLASS = "cm-oleaflySnippetCard-step";
export const CARD_STEP_DONE_CLASS = "cm-oleaflySnippetCard-step-done";
export const CARD_STEP_NOW_CLASS = "cm-oleaflySnippetCard-step-now";
export const CARD_COUNT_CLASS = "cm-oleaflySnippetCard-count";
export const CARD_SEPARATOR_CLASS = "cm-oleaflySnippetCard-separator";
export const CARD_KEYS_CLASS = "cm-oleaflySnippetCard-keys";
export const CARD_KEY_CLASS = "cm-oleaflySnippetCard-key";
export const CARD_KEY_PRIMARY_CLASS = "cm-oleaflySnippetCard-key-primary";
export const CARD_KEY_OFF_CLASS = "cm-oleaflySnippetCard-key-off";
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
  [`.cm-tooltip.${CARD_CLASS}`]: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    height: "2.3em",
    padding: "0 6px 0 10px",
    fontFamily: "var(--font-sans, sans-serif)",
    fontSize: "0.8125rem",
    lineHeight: "1",
    whiteSpace: "nowrap",
    userSelect: "none",
    pointerEvents: "none",
  },
  [`.cm-tooltip.${CARD_CLASS} .cm-tooltip-arrow:before`]: {
    borderTopColor: "var(--border, #e5e5e5)",
    borderBottomColor: "var(--border, #e5e5e5)",
  },
  [`.cm-tooltip.${CARD_CLASS} .cm-tooltip-arrow:after`]: {
    borderTopColor: "var(--popover, #ffffff)",
    borderBottomColor: "var(--popover, #ffffff)",
  },
  [`.${CARD_STEPS_CLASS}`]: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
  },
  [`.${CARD_STEP_CLASS}`]: {
    width: "6px",
    height: "6px",
    borderRadius: "999px",
    backgroundColor: "color-mix(in oklch, var(--muted-foreground, #737373) 35%, transparent)",
  },
  [`.${CARD_STEP_DONE_CLASS}`]: {
    backgroundColor: "color-mix(in oklch, var(--muted-foreground, #737373) 75%, transparent)",
  },
  [`.${CARD_STEP_NOW_CLASS}`]: {
    width: "16px",
    backgroundColor: PRIMARY,
  },
  [`.${CARD_COUNT_CLASS}`]: {
    color: "var(--foreground, #171717)",
    fontWeight: "600",
    fontVariantNumeric: "tabular-nums",
  },
  [`.${CARD_SEPARATOR_CLASS}`]: {
    width: "1px",
    height: "16px",
    backgroundColor: "var(--border, #e5e5e5)",
  },
  [`.${CARD_KEYS_CLASS}`]: {
    display: "inline-flex",
    alignItems: "center",
    gap: "10px",
    color: "var(--muted-foreground, #737373)",
  },
  [`.${CARD_KEY_CLASS}`]: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
  },
  [`.${CARD_KEY_CLASS} kbd`]: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: "1.65em",
    minWidth: "1.65em",
    padding: "0 0.5em",
    borderRadius: "5px",
    border: "1px solid var(--border, #e5e5e5)",
    backgroundColor: "var(--muted, #f5f5f5)",
    color: "var(--foreground, #171717)",
    fontFamily: "inherit",
    fontSize: "0.75rem",
    fontWeight: "500",
  },
  [`.${CARD_KEY_PRIMARY_CLASS}`]: {
    color: "var(--foreground, #171717)",
  },
  [`.${CARD_KEY_PRIMARY_CLASS} kbd`]: {
    backgroundColor: `color-mix(in oklch, ${PRIMARY} 22%, transparent)`,
    borderColor: `color-mix(in oklch, ${PRIMARY} 55%, transparent)`,
  },
  [`.${CARD_KEY_OFF_CLASS}`]: {
    opacity: "0.45",
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
