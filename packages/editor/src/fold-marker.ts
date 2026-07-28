import { EditorView } from "@codemirror/view";

/**
 * Fold gutter markers drawn as chevrons, with the app's tooltip instead of the
 * browser's.
 *
 * `foldGutter`'s built-in marker sets a `title` attribute, which renders as a
 * native OS tooltip: a different font, a different delay, and no relation to
 * the tooltips everywhere else in the app. Supplying `markerDOM` replaces that
 * marker entirely, `title` included.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Lucide chevron-down / chevron-right, matching the app's icon set. */
const CHEVRON = {
  open: "m6 9 6 6 6-6",
  closed: "m9 18 6-6-6-6",
};

let hoverLabel: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function hideLabel() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  hoverLabel?.remove();
  hoverLabel = null;
}

function showLabel(anchor: HTMLElement, text: string) {
  hideLabel();
  const label = document.createElement("div");
  label.className = "cm-fold-label";
  label.textContent = text;
  label.setAttribute("role", "tooltip");
  document.body.append(label);
  const anchorBox = anchor.getBoundingClientRect();
  const labelBox = label.getBoundingClientRect();
  label.style.left = `${Math.max(4, Math.round(anchorBox.right + 6))}px`;
  label.style.top = `${Math.round(
    anchorBox.top + anchorBox.height / 2 - labelBox.height / 2,
  )}px`;
  hoverLabel = label;
}

export function foldMarkerDOM(open: boolean): HTMLElement {
  const button = document.createElement("span");
  button.className = "cm-fold-marker";
  button.setAttribute("aria-hidden", "true");

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", open ? CHEVRON.open : CHEVRON.closed);
  svg.append(path);
  button.append(svg);

  const text = open ? "Fold line" : "Unfold line";
  button.addEventListener("mouseenter", () => showLabel(button, text));
  button.addEventListener("mouseleave", hideLabel);
  // The marker is removed from the DOM as soon as the fold toggles, which fires
  // no mouseleave.
  button.addEventListener("mousedown", hideLabel);
  return button;
}

export const foldMarkerTheme = EditorView.baseTheme({
  ".cm-fold-marker": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "14px",
    // Intrinsic height: the gutter element is a bare block that collapses to
    // zero if its only child sizes itself from the parent.
    height: "1.2em",
    cursor: "pointer",
    color: "var(--muted-foreground)",
    opacity: "0.65",
  },
  ".cm-fold-marker:hover": { opacity: "1" },
  ".cm-fold-marker svg": { width: "12px", height: "12px" },
});
