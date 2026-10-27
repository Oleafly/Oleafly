import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const UI_FONT = "var(--font-sans, ui-sans-serif, system-ui, sans-serif)";
const MONO = "var(--ofl-visual-mono, var(--font-mono, ui-monospace, Menlo, monospace))";
// Opaque mixes, so text and edges keep their contrast on the card's own tint.
const SECONDARY = "color-mix(in oklch, var(--foreground) 66%, var(--background))";
const EDGE = "color-mix(in oklch, var(--foreground) 30%, var(--background))";
const EDGE_HOVER = "color-mix(in oklch, var(--foreground) 48%, var(--background))";
const BUTTON_FILL = "color-mix(in oklch, var(--foreground) 5%, var(--background))";
const HOVER_TINT = "color-mix(in oklch, var(--foreground) 8%, transparent)";
const CONTROL_HEIGHT = "28px";

// Focus and selection show as a border colour change or a background tint, never an
// outline or a ring. Only the floating popover casts a drop shadow, to lift it off the page.
export const typstFormsThemeSpec = {
  ".ofl-visual-form-card": {
    margin: "6px 0",
    padding: "10px 12px 12px",
    border: `1px solid ${EDGE}`,
    borderRadius: "8px",
    backgroundColor: "var(--ofl-visual-panel)",
    fontFamily: UI_FONT,
    fontSize: "13px",
    lineHeight: "1.45",
    color: "var(--foreground)",
    cursor: "default",
  },
  ".ofl-visual-form-header": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "24px",
    marginBottom: "10px",
    minWidth: "0",
  },
  ".ofl-visual-form-title": {
    fontWeight: "600",
    whiteSpace: "nowrap",
  },
  ".ofl-visual-form-summary": {
    color: SECONDARY,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: "0",
  },
  ".ofl-visual-form-reveal": {
    marginLeft: "auto",
  },
  ".ofl-visual-form-popover .ofl-visual-form-fields": {
    gridTemplateColumns: "max-content minmax(0, 1fr) auto",
  },
  ".ofl-visual-form-fields": {
    display: "grid",
    // Fixed label and action columns keep the inputs the same width from card to card.
    gridTemplateColumns: "9.5em minmax(0, 1fr) minmax(4.5em, max-content)",
    columnGap: "10px",
    rowGap: "8px",
    alignItems: "start",
  },
  ".ofl-visual-form-field": {
    display: "contents",
  },
  ".ofl-visual-form-label": {
    minHeight: CONTROL_HEIGHT,
    display: "flex",
    alignItems: "center",
    color: SECONDARY,
    overflowWrap: "anywhere",
  },
  ".ofl-visual-form-value": {
    minWidth: "0",
  },
  ".ofl-visual-form-control": {
    display: "flex",
    alignItems: "center",
    minHeight: CONTROL_HEIGHT,
    minWidth: "0",
  },
  ".ofl-visual-form-actions": {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    minHeight: CONTROL_HEIGHT,
  },
  ".ofl-visual-form-empty::before": {
    content: '"—"',
    color: SECONDARY,
  },
  ".ofl-visual-form-input": {
    flex: "1 1 auto",
    minWidth: "0",
    minHeight: CONTROL_HEIGHT,
    boxSizing: "border-box",
    margin: "0",
    padding: "3px 8px",
    border: `1px solid ${EDGE}`,
    borderRadius: "6px",
    backgroundColor: "var(--background)",
    color: "inherit",
    font: "inherit",
    outline: "none",
    resize: "vertical",
  },
  "select.ofl-visual-form-input": {
    paddingLeft: "4px",
  },
  "select.ofl-visual-form-input[data-unset]": {
    color: SECONDARY,
  },
  "input[type='number'].ofl-visual-form-input": {
    flex: "0 1 10em",
  },
  ".ofl-visual-form-input:hover": {
    borderColor: EDGE_HOVER,
  },
  ".ofl-visual-form-input:focus, .ofl-visual-form-input:focus-visible": {
    borderColor: "var(--primary)",
    outline: "none",
  },
  ".ofl-visual-form-input:disabled": {
    opacity: "0.6",
    cursor: "not-allowed",
  },
  ".ofl-visual-form-switch": {
    appearance: "none",
    position: "relative",
    width: "30px",
    height: "18px",
    margin: "0",
    flexShrink: "0",
    border: "none",
    borderRadius: "999px",
    backgroundColor: "color-mix(in oklch, var(--foreground) 30%, var(--background))",
    cursor: "pointer",
    outline: "none",
    transition: "background-color 120ms ease",
  },
  ".ofl-visual-form-switch::after": {
    content: '""',
    position: "absolute",
    top: "3px",
    left: "3px",
    width: "12px",
    height: "12px",
    borderRadius: "999px",
    backgroundColor: "#ffffff",
    transition: "transform 120ms ease",
  },
  ".ofl-visual-form-switch:checked": {
    backgroundColor: "var(--primary)",
  },
  ".ofl-visual-form-switch:checked::after": {
    backgroundColor: "var(--primary-foreground, var(--background))",
    transform: "translateX(12px)",
  },
  ".ofl-visual-form-switch:focus-visible": {
    backgroundColor: "color-mix(in oklch, var(--foreground) 45%, var(--background))",
    outline: "none",
  },
  ".ofl-visual-form-switch:checked:focus-visible": {
    backgroundColor: "color-mix(in oklch, var(--primary) 80%, var(--foreground))",
  },
  ".ofl-visual-form-switch:disabled": {
    opacity: "0.6",
    cursor: "not-allowed",
  },
  ".ofl-visual-form-action": {
    flexShrink: "0",
    height: "24px",
    padding: "0 8px",
    border: `1px solid ${EDGE}`,
    borderRadius: "5px",
    backgroundColor: BUTTON_FILL,
    color: "var(--foreground)",
    font: "inherit",
    fontSize: "12px",
    whiteSpace: "nowrap",
    cursor: "pointer",
    outline: "none",
  },
  ".ofl-visual-form-action:hover": {
    borderColor: EDGE_HOVER,
  },
  ".ofl-visual-form-hint .ofl-visual-form-action": {
    height: "20px",
    marginLeft: "6px",
    padding: "0 6px",
    fontSize: "11px",
  },
  ".ofl-visual-form-action:focus-visible": {
    borderColor: "var(--primary)",
    backgroundColor: HOVER_TINT,
    outline: "none",
  },
  ".ofl-visual-form-hint": {
    marginTop: "2px",
    fontSize: "12px",
    color: SECONDARY,
  },
  ".ofl-visual-form-missing": {
    color: "var(--destructive, #c4513f)",
  },
  ".ofl-visual-form-problem": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
    marginTop: "4px",
    fontSize: "12px",
    color: "var(--destructive, #c4513f)",
  },
  ".ofl-visual-form-source": {
    margin: "0",
    padding: "2px 6px",
    borderRadius: "4px",
    border: `1px solid ${EDGE}`,
    backgroundColor: "var(--ofl-visual-chip)",
    fontFamily: MONO,
    fontSize: "12px",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  ".ofl-visual-form-error": {
    margin: "6px 0",
    padding: "8px 12px",
    border: `1px solid ${EDGE}`,
    borderRadius: "8px",
    backgroundColor: "var(--muted)",
    color: SECONDARY,
    fontFamily: UI_FONT,
    fontSize: "12px",
  },
  ".ofl-visual-form-chip-button": {
    padding: "0 5px",
    border: `1px solid ${EDGE}`,
    borderRadius: "4px",
    backgroundColor: "var(--ofl-visual-chip)",
    color: "inherit",
    fontFamily: UI_FONT,
    fontSize: "0.85em",
    lineHeight: "1.25",
    cursor: "pointer",
    outline: "none",
    verticalAlign: "baseline",
  },
  ".ofl-visual-form-chip-button:hover": {
    backgroundColor: "var(--ofl-visual-chip-hover)",
  },
  ".ofl-visual-form-chip-button:focus-visible, .ofl-visual-form-chip-button[aria-expanded='true']": {
    borderColor: "var(--primary)",
    outline: "none",
  },
  ".ofl-visual-form-popover": {
    position: "fixed",
    zIndex: "60",
    width: "min(420px, calc(100vw - 16px))",
    maxHeight: "min(70vh, 520px)",
    overflowY: "auto",
    boxSizing: "border-box",
    padding: "8px 12px 10px",
    border: `1px solid ${EDGE_HOVER}`,
    borderRadius: "8px",
    boxShadow: "0 10px 28px -8px rgba(0, 0, 0, 0.35)",
    // A touch of foreground keeps it at least as light as a card in a dark theme.
    backgroundColor: "color-mix(in oklch, var(--foreground) 6%, var(--background))",
    color: "var(--popover-foreground, var(--foreground))",
    fontFamily: UI_FONT,
    fontSize: "13px",
    lineHeight: "1.45",
  },
} as const;

export const typstFormsTheme: Extension = EditorView.theme(typstFormsThemeSpec);
