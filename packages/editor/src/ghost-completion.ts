import {
  acceptCompletion,
  CompletionContext,
  selectedCompletion,
  completionStatus,
  type Completion,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  boundedCompletionContext,
  isCompletionTextLexicallyTriggered,
  type CompletionSyntax,
} from "./completion-trigger";

const GHOST_CLASS = "cm-ghostCompletion";

const MIN_COMMAND_LETTERS = 2;
const MIN_WORD_LETTERS = 3;
const MAX_OPTIONS_SCANNED = 2000;

interface GhostSuggestion {
  pos: number;
  text: string;
}

const setGhost = StateEffect.define<GhostSuggestion | null>();
const setDismissed = StateEffect.define<number | null>();

const dismissedField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDismissed)) return effect.value;
    }
    if (tr.docChanged || tr.selection) return null;
    return value;
  },
});

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: GhostWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = GHOST_CLASS;
    span.textContent = this.text;
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const ghostField = StateField.define<GhostSuggestion | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGhost)) return effect.value;
    }
    if (tr.docChanged || tr.selection) return null;
    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (ghost): DecorationSet =>
      ghost
        ? Decoration.set([
            Decoration.widget({
              widget: new GhostWidget(ghost.text),
              side: 1,
            }).range(ghost.pos),
          ])
        : Decoration.none,
    ),
});

function typedPrefix(before: string, length: number): string | null {
  if (length <= 0 || length > before.length) return null;
  const text = before.slice(before.length - length);
  if (text.startsWith("\\")) {
    return /^\\[A-Za-z@]+$/u.test(text) &&
      text.length >= MIN_COMMAND_LETTERS + 1
      ? text
      : null;
  }
  if (before[before.length - length - 1] === "\\") {
    return /^[A-Za-z@]+$/u.test(text) && text.length >= MIN_COMMAND_LETTERS
      ? text
      : null;
  }
  if (!/^\p{L}/u.test(text) || /\s/u.test(text)) return null;
  return text.length >= MIN_WORD_LETTERS ? text : null;
}

function overlapLength(before: string, label: string): number {
  for (let length = Math.min(before.length, label.length - 1); length > 0; length--) {
    if (before.endsWith(label.slice(0, length))) return length;
  }
  return 0;
}

const WORD_END_PUNCTUATION = new Set(["}", "]", ")", ",", ".", ":", "$", "&"]);

function atWordEnd(view: EditorView, pos: number): boolean {
  const after = view.state.sliceDoc(
    pos,
    Math.min(view.state.doc.length, pos + 1),
  );
  return after === "" || after.trim() === "" || WORD_END_PUNCTUATION.has(after);
}

function previewLabel(option: Completion, prefix: string): string | null {
  const label = optionText(option);
  if (label.length <= prefix.length || !label.startsWith(prefix)) return null;
  return label;
}

function optionText(option: Completion): string {
  return typeof option.apply === "string" ? option.apply : option.label;
}

function bestOption(options: readonly Completion[], prefix: string): string | null {
  let best: string | null = null;
  let bestBoost = Number.NEGATIVE_INFINITY;
  const scanned = Math.min(options.length, MAX_OPTIONS_SCANNED);
  for (let index = 0; index < scanned; index++) {
    const label = previewLabel(options[index], prefix);
    if (!label) continue;
    const boost = options[index].boost ?? 0;
    if (
      boost > bestBoost ||
      (boost === bestBoost && best !== null && label.length < best.length)
    ) {
      best = label;
      bestBoost = boost;
    }
  }
  return best;
}

function syncResult(
  source: CompletionSource,
  context: CompletionContext,
): CompletionResult | null {
  let result: ReturnType<CompletionSource>;
  try {
    result = source(context);
  } catch {
    return null;
  }
  return result && !(result instanceof Promise) ? result : null;
}

function ghostAnchor(view: EditorView): number | null {
  const selection = view.state.selection.main;
  if (!selection.empty || view.state.readOnly) return null;
  const pos = selection.head;
  if (view.state.field(dismissedField, false) === pos) return null;
  return atWordEnd(view, pos) ? pos : null;
}

function popupGhost(
  view: EditorView,
  before: string,
  pos: number,
): GhostSuggestion | null {
  const selected = selectedCompletion(view.state);
  if (!selected) return null;
  const prefix = typedPrefix(before, overlapLength(before, optionText(selected)));
  if (!prefix) return null;
  const label = previewLabel(selected, prefix);
  return label ? { pos, text: label.slice(prefix.length) } : null;
}

function sourceGhost(
  view: EditorView,
  sources: CompletionSource[],
  before: string,
  pos: number,
): GhostSuggestion | null {
  const context = new CompletionContext(view.state, pos, false);
  for (const source of sources) {
    const result = syncResult(source, context);
    if (!result) continue;
    const prefix = typedPrefix(before, pos - result.from);
    if (!prefix) continue;
    const label = bestOption(result.options, prefix);
    if (label) return { pos, text: label.slice(prefix.length) };
  }
  return null;
}

function computeGhost(
  view: EditorView,
  sources: CompletionSource[],
  syntax: CompletionSyntax,
): GhostSuggestion | null {
  const pos = ghostAnchor(view);
  if (pos === null) return null;
  const before = boundedCompletionContext(view.state, pos);
  if (!before || /\s$/u.test(before)) return null;

  if (completionStatus(view.state) === "active") return popupGhost(view, before, pos);

  if (!isCompletionTextLexicallyTriggered(before, syntax)) return null;

  return sourceGhost(view, sources, before, pos);
}

export function acceptGhostCompletion(view: EditorView): boolean {
  // CodeMirror's built-in completion keymap accepts with Enter, not Tab. Route
  // Tab through its command explicitly when the popup is active; inserting the
  // ghost text ourselves would bypass guarded applies and snippet expansion.
  if (completionStatus(view.state) === "active" && acceptCompletion(view)) return true;
  const ghost = view.state.field(ghostField, false);
  if (!ghost || ghost.pos !== view.state.selection.main.head) return false;
  view.dispatch({
    changes: { from: ghost.pos, insert: ghost.text },
    selection: { anchor: ghost.pos + ghost.text.length },
    effects: setGhost.of(null),
    userEvent: "input.complete",
    scrollIntoView: true,
  });
  return true;
}

export function clearGhostCompletion(view: EditorView): boolean {
  const ghost = view.state.field(ghostField, false);
  if (!ghost) return false;
  const popupOpen = completionStatus(view.state) === "active";
  view.dispatch({
    effects: [setGhost.of(null), setDismissed.of(ghost.pos)],
  });
  return !popupOpen;
}

const ghostTheme = EditorView.baseTheme({
  [`.${GHOST_CLASS}`]: {
    opacity: "0.45",
    pointerEvents: "none",
    userSelect: "none",
  },
});

export function ghostCompletion(
  sources: CompletionSource[],
  syntax: CompletionSyntax = "generic",
): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      private scheduled = false;
      private destroyed = false;

      constructor(readonly view: EditorView) {
        this.schedule();
      }

      update(update: ViewUpdate) {
        const previousStatus = completionStatus(update.startState);
        const nextStatus = completionStatus(update.state);
        const popupChanged =
          previousStatus !== nextStatus ||
          (nextStatus === "active" &&
            selectedCompletion(update.startState) !== selectedCompletion(update.state));
        if (update.docChanged || update.selectionSet || popupChanged) {
          this.schedule();
        }
      }

      schedule() {
        if (this.scheduled) return;
        this.scheduled = true;
        queueMicrotask(() => {
          this.scheduled = false;
          if (this.destroyed) return;
          this.refresh();
        });
      }

      refresh() {
        const view = this.view;
        if (!view.dom.isConnected) return;
        // Deliberately not gated on view.hasFocus: it depends on
        // document.hasFocus(), which an embedded webview reports as false even
        // while the user types. The suggestion is anchored to the cursor and
        // only survives until the next edit, so an unfocused editor cannot
        // accumulate stale previews anyway.
        const next = computeGhost(view, sources, syntax);
        const current = view.state.field(ghostField, false) ?? null;
        if (next?.text === current?.text && next?.pos === current?.pos) return;
        view.dispatch({ effects: setGhost.of(next) });
      }

      destroy() {
        this.destroyed = true;
      }
    },
  );

  return [
    ghostField,
    dismissedField,
    plugin,
    ghostTheme,
    Prec.highest(
      keymap.of([
        { key: "Tab", run: acceptGhostCompletion },
        { key: "Escape", run: clearGhostCompletion },
      ]),
    ),
  ];
}

export function pendingGhostCompletion(view: EditorView): string | null {
  return view.state.field(ghostField, false)?.text ?? null;
}
