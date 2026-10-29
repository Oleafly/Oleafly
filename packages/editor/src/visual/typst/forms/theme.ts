import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorColor } from "../../../color-roles";

const UI_FONT = "var(--font-sans, ui-sans-serif, system-ui, sans-serif)";
const MONO = "var(--ofl-visual-mono, var(--font-mono, ui-monospace, Menlo, monospace))";
// The editor's own surface, which a colour theme can set apart from the app's light or dark mode.
const TEXT = editorColor("text");
const SURFACE = editorColor("background");
// Opaque mixes, so text and edges keep their contrast on the card's own tint.
const SECONDARY = `color-mix(in oklch, ${TEXT} 66%, ${SURFACE})`;
const EDGE = `color-mix(in oklch, ${TEXT} 30%, ${SURFACE})`;
const EDGE_HOVER = `color-mix(in oklch, ${TEXT} 48%, ${SURFACE})`;
const BUTTON_FILL = `color-mix(in oklch, ${TEXT} 5%, ${SURFACE})`;
const PANEL = `color-mix(in oklch, ${TEXT} 4%, ${SURFACE})`;
const CHIP = `color-mix(in oklch, ${TEXT} 9%, ${SURFACE})`;
const HOVER_TINT = `color-mix(in oklch, ${TEXT} 8%, transparent)`;
const CONTROL_HEIGHT = "28px";

// Focus and selection show as a border colour change or a background tint, never an
// outline or a ring. Only the floating popover casts a drop shadow, to lift it off the page.
export const typstFormsThemeSpec = {
  ".ofl-visual-form-card": {
    margin: "6px 0",
    padding: "10px 12px 12px",
    border: `1px solid ${EDGE}`,
    borderRadius: "8px",
    backgroundColor: PANEL,
    fontFamily: UI_FONT,
    fontSize: "13px",
    lineHeight: "1.45",
    color: TEXT,
    cursor: "default",
    // The narrow layout below follows the card's own width, not the window's.
    containerType: "inline-size",
  },
  ".ofl-visual-form-header": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: "8px",
    rowGap: "4px",
    minHeight: "24px",
    marginBottom: "10px",
    minWidth: "0",
  },
  ".ofl-visual-form-title": {
    fontWeight: "600",
    whiteSpace: "nowrap",
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  ".ofl-visual-form-summary": {
    // Shortens before the header wraps, so only the button moves to a second line.
    flex: "1 1 6em",
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
    // A long label wraps instead of squeezing its input to nothing.
    gridTemplateColumns: "fit-content(45%) minmax(0, 1fr) auto",
  },
  ".ofl-visual-form-fields": {
    display: "grid",
    // Fixed label and action columns keep the inputs the same width from card to card.
    gridTemplateColumns: "9.5em minmax(0, 1fr) minmax(4.5em, max-content)",
    columnGap: "10px",
    rowGap: "8px",
    alignItems: "start",
  },
  // In a narrow card or popover each label sits above its control, so the control keeps its width.
  "@container (max-width: 30em)": {
    ".ofl-visual-form-fields, .ofl-visual-form-popover .ofl-visual-form-fields": {
      gridTemplateColumns: "minmax(0, 1fr) auto",
      rowGap: "4px",
    },
    ".ofl-visual-form-label": {
      gridColumn: "1 / -1",
      minHeight: "0",
      marginTop: "4px",
    },
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
    backgroundColor: SURFACE,
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
  ".ofl-visual-form-number": {
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
    backgroundColor: EDGE,
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
    backgroundColor: "var(--primary-foreground, #ffffff)",
    transform: "translateX(12px)",
  },
  ".ofl-visual-form-switch:focus-visible": {
    backgroundColor: `color-mix(in oklch, ${TEXT} 45%, ${SURFACE})`,
    outline: "none",
  },
  ".ofl-visual-form-switch:checked:focus-visible": {
    backgroundColor: `color-mix(in oklch, var(--primary) 80%, ${TEXT})`,
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
    color: "inherit",
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
    // The popover sits outside the editor, where the Visual chip tint isn't defined.
    backgroundColor: `var(--ofl-visual-chip, ${CHIP})`,
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
    backgroundColor: PANEL,
    color: SECONDARY,
    fontFamily: UI_FONT,
    fontSize: "12px",
  },
  ".ofl-visual-form-chip-button": {
    padding: "0 5px",
    border: `1px solid ${EDGE}`,
    borderRadius: "4px",
    backgroundColor: `var(--ofl-visual-chip, ${CHIP})`,
    color: "inherit",
    fontFamily: UI_FONT,
    fontSize: "0.85em",
    lineHeight: "1.25",
    cursor: "pointer",
    outline: "none",
    verticalAlign: "baseline",
  },
  ".ofl-visual-form-chip-button:hover": {
    backgroundColor: `var(--ofl-visual-chip-hover, ${EDGE})`,
  },
  ".ofl-visual-form-chip-button:focus-visible, .ofl-visual-form-chip-button[aria-expanded='true']": {
    borderColor: "var(--primary)",
    outline: "none",
  },
  ".ofl-visual-form-popover": {
    position: "fixed",
    // The chip sets top and left; these undo the browser's centring of an open <dialog>.
    right: "auto",
    bottom: "auto",
    margin: "0",
    zIndex: "60",
    width: "min(420px, calc(100vw - 16px))",
    maxHeight: "min(70vh, 520px)",
    overflowY: "auto",
    boxSizing: "border-box",
    padding: "8px 12px 10px",
    border: `1px solid ${EDGE_HOVER}`,
    borderRadius: "8px",
    boxShadow: "0 10px 28px -8px rgba(0, 0, 0, 0.35)",
    // A touch of the text colour keeps it at least as light as a card in a dark theme.
    backgroundColor: `color-mix(in oklch, ${TEXT} 6%, ${SURFACE})`,
    color: TEXT,
    fontFamily: UI_FONT,
    fontSize: "13px",
    lineHeight: "1.45",
    containerType: "inline-size",
  },
} as const;

export const typstFormsTheme: Extension = EditorView.theme(typstFormsThemeSpec);
