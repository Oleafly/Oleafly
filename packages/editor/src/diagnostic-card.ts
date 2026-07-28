import { forEachDiagnostic, type Action, type Diagnostic } from "@codemirror/lint";
import {
  ViewPlugin,
  hoverTooltip,
  type EditorView,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/**
 * The hover card shown for every editor diagnostic.
 *
 * The stock lint tooltip renders each action as an inline button, turning
 * "four spellings plus two ignore options" into a wall of chips, and it waits
 * out CodeMirror's default 300ms hover delay. This card lists actions as rows,
 * separates spelling's ignore options into a footer, and opens quickly enough
 * to feel attached to the pointer.
 *
 * Spelling and grammar attach a richer card via `attachProofreadingCard`;
 * everything else — compile errors, preflight, LaTeX syntax, the language
 * server — falls back to a card built from the diagnostic's own message and
 * actions.
 */

/** How long the pointer must rest before the card appears. */
const HOVER_TIME = 90;

export interface ProofreadingCard {
  /** The flagged word or phrase, shown in the header. */
  word: string;
  /** Replacements, best first. */
  suggestions: readonly { label: string; action: Action }[];
  /** Footer entries such as "Ignore" and "Ignore everywhere". */
  ignores: readonly { label: string; action: Action }[];
  /** Shown instead of "Did you mean…" when there is no spelling suggestion. */
  message?: string;
  severity?: Diagnostic["severity"];
}

/**
 * A card for a diagnostic that did not bring its own: the message becomes the
 * header and any quick fixes become the rows.
 */
function cardFromDiagnostic(diagnostic: Diagnostic): ProofreadingCard {
  return {
    word: "",
    message: diagnostic.message,
    severity: diagnostic.severity,
    suggestions: (diagnostic.actions ?? []).map((action) => ({
      label: action.name,
      action,
    })),
    ignores: [],
  };
}

function cardFor(diagnostic: Diagnostic): ProofreadingCard {
  return cards.get(diagnostic) ?? cardFromDiagnostic(diagnostic);
}

// Keyed by diagnostic identity: the presentation data never has to survive a
// round trip through the diagnostic's own fields, and it is dropped with the
// diagnostic it belongs to.
const cards = new WeakMap<Diagnostic, ProofreadingCard>();

export function attachProofreadingCard(
  diagnostic: Diagnostic,
  card: ProofreadingCard,
): Diagnostic {
  cards.set(diagnostic, card);
  return diagnostic;
}

export function hasProofreadingCard(diagnostic: Diagnostic): boolean {
  return cards.has(diagnostic);
}

function button(label: string, className: string, onClick: () => void) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  // Pointer-down rather than click: the editor takes focus back on mouseup,
  // which can dismiss the card before a click ever lands.
  element.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return element;
}

function renderCard(
  view: EditorView,
  card: ProofreadingCard,
  from: number,
  to: number,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "cm-proofread-card";

  const header = document.createElement("div");
  header.className = "cm-proofread-header";
  const dot = document.createElement("span");
  dot.className = `cm-proofread-dot is-${card.severity ?? "warning"}`;
  dot.setAttribute("aria-hidden", "true");
  // The prose lives in its own element: the header is a flex row for the dot,
  // and loose text nodes would each become a gapped flex item.
  const headerText = document.createElement("span");
  headerText.className = "cm-proofread-header-text";
  if (card.word && card.suggestions.length > 0) {
    headerText.append("Did you mean ");
    const strong = document.createElement("strong");
    strong.textContent = card.suggestions[0].label;
    headerText.append(strong, "?");
  } else if (card.message) {
    headerText.classList.add("is-message");
    headerText.textContent = card.message;
  } else {
    headerText.append("Not in dictionary: ");
    const strong = document.createElement("strong");
    strong.textContent = card.word;
    headerText.append(strong);
  }
  header.append(dot, headerText);
  root.append(header);

  if (card.suggestions.length > 0) {
    const list = document.createElement("div");
    list.className = "cm-proofread-suggestions";
    card.suggestions.forEach((suggestion, index) => {
      const row = button(
        suggestion.label,
        index === 0 && card.word
          ? "cm-proofread-suggestion cm-proofread-suggestion-top"
          : "cm-proofread-suggestion",
        () => suggestion.action.apply(view, from, to),
      );
      list.append(row);
    });
    root.append(list);
  }

  if (card.ignores.length > 0) {
    const footer = document.createElement("div");
    footer.className = "cm-proofread-footer";
    card.ignores.forEach((ignore, index) => {
      if (index > 0) {
        const divider = document.createElement("span");
        divider.className = "cm-proofread-footer-divider";
        divider.textContent = "|";
        footer.append(divider);
      }
      footer.append(
        button(ignore.label, "cm-proofread-ignore", () =>
          ignore.action.apply(view, from, to),
        ),
      );
    });
    root.append(footer);
  }

  return root;
}

/**
 * Shows the card for the innermost proofreading diagnostic under the pointer.
 * Diagnostics without a card (compile errors, LaTeX syntax) are left to the
 * stock lint tooltip.
 *
 * Exported so the lookup and the rendered card can be tested without
 * synthesizing hover events.
 */
export function diagnosticCardSource(
  view: EditorView,
  pos: number,
): Tooltip | null {
  let found: { diagnostic: Diagnostic; from: number; to: number } | null = null;
  forEachDiagnostic(view.state, (diagnostic, from, to) => {
    if (pos < from || pos > to) return;
    // Prefer the tightest range so a word inside a flagged phrase wins.
    if (!found || to - from < found.to - found.from) {
      found = { diagnostic, from, to };
    }
  });
  if (!found) return null;
  const hit = found as { diagnostic: Diagnostic; from: number; to: number };
  const card = cardFor(hit.diagnostic);
  return {
    pos: hit.from,
    end: hit.to,
    above: false,
    create: () => ({ dom: renderCard(view, card, hit.from, hit.to) }),
  };
}

export function diagnosticCardTooltip(): Extension {
  return hoverTooltip(diagnosticCardSource, { hoverTime: HOVER_TIME });
}

/** Grace period so the pointer can travel from the marker into the card. */
const GUTTER_CLOSE_DELAY = 120;

function cardForLine(
  view: EditorView,
  clientY: number,
): { card: ProofreadingCard; from: number; to: number } | null {
  const block = view.lineBlockAtHeight(
    clientY - view.documentTop,
  );
  let hit: { card: ProofreadingCard; from: number; to: number } | null = null;
  forEachDiagnostic(view.state, (diagnostic, from, to) => {
    if (hit || to < block.from || from > block.to) return;
    hit = { card: cardFor(diagnostic), from, to };
  });
  return hit;
}

/**
 * Shows the same card when the pointer rests on the lint gutter marker.
 *
 * `hoverTooltip` only covers the content area, so the gutter needs its own
 * controller. The card is appended to `document.body` and positioned fixed:
 * inside the editor it would be clipped by the pane and painted under the
 * neighbouring preview.
 */
export function diagnosticCardGutter(): Extension {
  return ViewPlugin.define((view) => {
    let open: HTMLElement | null = null;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;

    const close = () => {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = null;
      open?.remove();
      open = null;
    };
    const scheduleClose = () => {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(close, GUTTER_CLOSE_DELAY);
    };
    const keepOpen = () => {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = null;
    };

    const onOver = (event: MouseEvent) => {
      const marker = (event.target as HTMLElement | null)?.closest(
        ".cm-lint-marker",
      );
      if (!(marker instanceof HTMLElement)) return;
      keepOpen();
      const rect = marker.getBoundingClientRect();
      const found = cardForLine(view, (rect.top + rect.bottom) / 2);
      if (!found) return;
      close();
      const dom = renderCard(view, found.card, found.from, found.to);
      dom.classList.add("cm-proofread-card-floating");
      dom.style.position = "fixed";
      dom.style.left = `${Math.round(rect.right + 6)}px`;
      dom.style.top = `${Math.round(rect.top)}px`;
      dom.addEventListener("mouseenter", keepOpen);
      dom.addEventListener("mouseleave", scheduleClose);
      document.body.append(dom);
      // Keep the card inside the window once its size is known.
      const box = dom.getBoundingClientRect();
      if (box.right > window.innerWidth - 8) {
        dom.style.left = `${Math.max(8, window.innerWidth - box.width - 8)}px`;
      }
      if (box.bottom > window.innerHeight - 8) {
        dom.style.top = `${Math.max(8, window.innerHeight - box.height - 8)}px`;
      }
      open = dom;
    };

    const onOut = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest(".cm-lint-marker")) {
        return;
      }
      scheduleClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    view.dom.addEventListener("mouseover", onOver);
    view.dom.addEventListener("mouseout", onOut);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);

    return {
      update(update: ViewUpdate) {
        // The suggestions describe a document that no longer exists.
        if (update.docChanged) close();
      },
      destroy() {
        close();
        view.dom.removeEventListener("mouseover", onOver);
        view.dom.removeEventListener("mouseout", onOut);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("scroll", close, true);
      },
    };
  });
}
