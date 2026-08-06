import {
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

// Inline "ghost" completion: the rest of the most likely candidate, drawn dim
// after the cursor and accepted with Tab.
//
// Everything shown here comes from the completion sources the editor already
// runs, so there is no model call, no network, and no latency. Only
// synchronous source results are considered: a suggestion that arrives after
// the next keystroke would flicker, and the popup already covers async
// sources.
//
// While the completion popup is open the ghost mirrors the highlighted option
// instead of guessing separately, so the two surfaces can never disagree, and
// Tab is left to the popup's own handler.

const GHOST_CLASS = "cm-ghostCompletion";

// Enough typed characters that a single suggestion is a fair guess. Commands
// carry their backslash, so "\al" is three characters but two letters.
const MIN_COMMAND_LETTERS = 2;
const MIN_WORD_LETTERS = 3;
// Scanning every candidate of a 400k-command corpus on each keystroke would be
// wasted work: the best match is decided by prefix and boost alone.
const MAX_OPTIONS_SCANNED = 2000;

interface GhostSuggestion {
  /** Cursor position the ghost is anchored to. */
  pos: number;
  /** The text that would be inserted, already stripped of what was typed. */
  text: string;
}

const setGhost = StateEffect.define<GhostSuggestion | null>();
const setDismissed = StateEffect.define<number | null>();

/**
 * Where the user pressed Escape. Without this the suggestion would return
 * immediately: dismissing does not move the cursor or change the document, so
 * the very next recompute would offer the same candidate again. Reset by any
 * edit or cursor move, so dismissing is a one-shot rather than a mode.
 */
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
    // Decorative: screen readers announce the real document, and the popup
    // remains the accessible way to choose a completion.
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  // The widget must not swallow clicks aimed at the text behind it.
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
    // Any edit or cursor move invalidates the suggestion. The view plugin
    // recomputes one immediately after, so the ghost never lags the document.
    if (tr.docChanged || tr.selection) return null;
    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (ghost): DecorationSet =>
      ghost
        ? Decoration.set([
            Decoration.widget({
              widget: new GhostWidget(ghost.text),
              // Draw after the cursor rather than pushing it right.
              side: 1,
            }).range(ghost.pos),
          ])
        : Decoration.none,
    ),
});

/** The identifier being typed at `pos`: a LaTeX command or a plain word. */
function typedPrefix(
  view: EditorView,
  pos: number,
): { from: number; text: string } | null {
  const line = view.state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  const match = before.match(/(\\[a-zA-Z@]*|[A-Za-z][A-Za-z0-9]*)$/);
  if (!match) return null;
  const text = match[1];
  const letters = text.startsWith("\\") ? text.length - 1 : text.length;
  const minimum = text.startsWith("\\") ? MIN_COMMAND_LETTERS : MIN_WORD_LETTERS;
  if (letters < minimum) return null;
  return { from: pos - text.length, text };
}

/** Only suggest at the end of a word, never in the middle of one. */
function atWordEnd(view: EditorView, pos: number): boolean {
  const line = view.state.doc.lineAt(pos);
  const after = line.text.slice(pos - line.from);
  return after === "" || /^[\s}\]),.;:$&]/.test(after);
}

/**
 * What the ghost shows, and exactly what Tab inserts.
 *
 * The label is used rather than the option's `apply`, because every source
 * here wraps `apply` in a guard function whose expansion cannot be inspected.
 * Inserting the label keeps the preview honest: what is shown is what lands.
 * Choosing the same option from the popup may expand further (a command with
 * arguments becomes a snippet), which is the popup's job, not this one's.
 */
function previewLabel(option: Completion, prefix: string): string | null {
  const label = typeof option.apply === "string" ? option.apply : option.label;
  if (label.length <= prefix.length || !label.startsWith(prefix)) return null;
  return label;
}

function bestOption(options: readonly Completion[], prefix: string): string | null {
  let best: string | null = null;
  let bestBoost = Number.NEGATIVE_INFINITY;
  const scanned = Math.min(options.length, MAX_OPTIONS_SCANNED);
  for (let index = 0; index < scanned; index++) {
    const label = previewLabel(options[index], prefix);
    if (!label) continue;
    const boost = options[index].boost ?? 0;
    // Higher boost wins; ties go to the shortest completion, which is the one
    // the typist is most likely reaching for.
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
  // Promises are skipped by design: see the module comment.
  return result && !(result instanceof Promise) ? result : null;
}

function computeGhost(
  view: EditorView,
  sources: CompletionSource[],
): GhostSuggestion | null {
  const selection = view.state.selection.main;
  if (!selection.empty || view.state.readOnly) return null;
  const pos = selection.head;
  if (view.state.field(dismissedField, false) === pos) return null;
  if (!atWordEnd(view, pos)) return null;
  const prefix = typedPrefix(view, pos);
  if (!prefix) return null;

  // Popup open: mirror the highlighted option so the two never disagree.
  if (completionStatus(view.state) === "active") {
    const selected = selectedCompletion(view.state);
    const label = selected ? previewLabel(selected, prefix.text) : null;
    return label ? { pos, text: label.slice(prefix.text.length) } : null;
  }

  const context = new CompletionContext(view.state, pos, false);
  for (const source of sources) {
    const result = syncResult(source, context);
    if (!result) continue;
    const label = bestOption(result.options, prefix.text);
    if (label) return { pos, text: label.slice(prefix.text.length) };
  }
  return null;
}

/** Insert the pending ghost suggestion. Bound to Tab. */
export function acceptGhostCompletion(view: EditorView): boolean {
  // With the popup open the ghost is only a preview of the highlighted option,
  // so Tab belongs to the popup: its own handler runs the option's apply and
  // expands snippets, which inserting the label here would not.
  if (completionStatus(view.state) === "active") return false;
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

/** Dismiss the pending suggestion. Bound to Escape. */
export function clearGhostCompletion(view: EditorView): boolean {
  const ghost = view.state.field(ghostField, false);
  if (!ghost) return false;
  const popupOpen = completionStatus(view.state) === "active";
  view.dispatch({
    effects: [setGhost.of(null), setDismissed.of(ghost.pos)],
  });
  // With the popup open, report the key as unhandled so Escape also closes it.
  // One press should clear both surfaces, not just this one.
  return !popupOpen;
}

const ghostTheme = EditorView.baseTheme({
  [`.${GHOST_CLASS}`]: {
    opacity: "0.45",
    // The suggestion is a preview, so it must never be mistaken for text that
    // is already in the document, nor become a selection target.
    pointerEvents: "none",
    userSelect: "none",
  },
});

/**
 * Inline ghost completion driven by `sources`, which should be the same
 * completion sources the popup uses so both surfaces agree.
 */
export function ghostCompletion(sources: CompletionSource[]): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      // Recomputing inside update() would dispatch during an update, so the
      // work is deferred to a microtask and guarded against a stale view.
      private scheduled = false;

      constructor(readonly view: EditorView) {
        this.schedule();
      }

      update(update: ViewUpdate) {
        // The popup opening or closing changes where the suggestion comes
        // from, and closing it moves neither cursor nor document, so without
        // this the last preview would linger on screen.
        const popupChanged =
          completionStatus(update.startState) !== completionStatus(update.state);
        if (update.docChanged || update.selectionSet || popupChanged) {
          this.schedule();
        }
      }

      schedule() {
        if (this.scheduled) return;
        this.scheduled = true;
        queueMicrotask(() => {
          this.scheduled = false;
          this.refresh();
        });
      }

      refresh() {
        const view = this.view;
        // The plugin is destroyed with the view; bail if that already happened.
        if (!view.dom.isConnected) return;
        // Deliberately not gated on view.hasFocus: it depends on
        // document.hasFocus(), which an embedded webview reports as false even
        // while the user types. The suggestion is anchored to the cursor and
        // only survives until the next edit, so an unfocused editor cannot
        // accumulate stale previews anyway.
        const next = computeGhost(view, sources);
        const current = view.state.field(ghostField, false) ?? null;
        if (next?.text === current?.text && next?.pos === current?.pos) return;
        view.dispatch({ effects: setGhost.of(next) });
      }

      destroy() {
        this.scheduled = true;
      }
    },
  );

  return [
    ghostField,
    dismissedField,
    plugin,
    ghostTheme,
    // Ahead of indentWithTab and the completion keymap: both handlers decline
    // when there is no ghost, so normal Tab behavior is untouched.
    Prec.highest(
      keymap.of([
        { key: "Tab", run: acceptGhostCompletion },
        { key: "Escape", run: clearGhostCompletion },
      ]),
    ),
  ];
}

/** The pending suggestion text, for tests and diagnostics. */
export function pendingGhostCompletion(view: EditorView): string | null {
  return view.state.field(ghostField, false)?.text ?? null;
}
