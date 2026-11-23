import {
  acceptCompletion,
  CompletionContext,
  selectedCompletion,
  completionStatus,
  type Completion,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Transaction,
} from "@codemirror/state";
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

function typedAt(tr: Transaction, pos: number): string | null {
  if (!tr.isUserEvent("input.type")) return null;
  let inserted: string | null = null;
  let single = true;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
    if (inserted !== null || fromA !== pos || toA !== pos) single = false;
    else inserted = text.toString();
  });
  if (!single || !inserted) return null;
  const head = tr.newSelection.main;
  return head.empty && head.head === pos + (inserted as string).length ? inserted : null;
}

const ghostField = StateField.define<GhostSuggestion | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGhost)) return effect.value;
    }
    if (value && tr.docChanged) {
      const typed = typedAt(tr, value.pos);
      if (typed && value.text.startsWith(typed) && value.text.length > typed.length) {
        return { pos: value.pos + typed.length, text: value.text.slice(typed.length) };
      }
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

const ghostCore: Extension = [
  ghostField,
  dismissedField,
  ghostTheme,
  Prec.highest(
    keymap.of([
      { key: "Tab", run: acceptGhostCompletion },
      { key: "Escape", run: clearGhostCompletion },
    ]),
  ),
];

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

  return [ghostCore, plugin];
}

export interface GhostRequest {
  before: string;
  after: string;
  signal: AbortSignal;
  onText: (text: string) => void;
}

export type GhostRequester = (request: GhostRequest) => Promise<void>;

export interface RequestedGhostOptions {
  enabled?: () => boolean;
  warm?: () => void;
  delayMs?: number;
}

const REQUEST_DELAY_MS = 75;
const WARM_AFTER_MS = 30_000;
const REQUEST_BEFORE_CHARS = 4000;
const REQUEST_BEFORE_BLOCK = 1024;
const REQUEST_AFTER_CHARS = 1000;
const CACHE_SIZE = 64;
const CACHE_TAIL_CHARS = 200;
const CLOSING_TAIL = /^[\s)\]}$]*$/u;

interface CachedGhost {
  tail: string;
  after: string;
  text: string;
}

interface PendingGhost {
  controller: AbortController;
  origin: number;
  before: string;
  after: string;
  typed: string;
  raw: string;
  ahead: boolean;
}

function requestAnchor(state: EditorState): number | null {
  const selection = state.selection;
  if (selection.ranges.length > 1 || !selection.main.empty || state.readOnly) return null;
  if (completionStatus(state) === "active" || state.field(ghostField, false)) return null;
  const pos = selection.main.head;
  if (state.field(dismissedField, false) === pos) return null;
  const line = state.doc.lineAt(pos);
  if (!/\S/u.test(state.sliceDoc(line.from, pos))) return null;
  return CLOSING_TAIL.test(state.sliceDoc(pos, line.to)) ? pos : null;
}

function typedEdit(transaction: Transaction): boolean {
  return (
    transaction.docChanged &&
    (transaction.isUserEvent("input") || transaction.isUserEvent("delete"))
  );
}

function firstLine(text: string): string {
  return text.split(/\r?\n/u, 1)[0] ?? "";
}

function requestWindow(state: EditorState, pos: number): { before: string; after: string } {
  const from = Math.max(0, pos - REQUEST_BEFORE_CHARS);
  const start = from - (from % REQUEST_BEFORE_BLOCK);
  const doc = state.doc;
  return {
    before: doc.sliceString(start, pos),
    after: doc.sliceString(pos, Math.min(doc.length, pos + REQUEST_AFTER_CHARS)),
  };
}

function fittedGhostText(raw: string, before: string, after: string, done: boolean): string {
  let fitted = firstLine(raw);
  const lineBefore = before.slice(before.lastIndexOf("\n") + 1);
  if (lineBefore.trim()) {
    if (fitted.startsWith(lineBefore)) fitted = fitted.slice(lineBefore.length);
    else if (!done && lineBefore.startsWith(fitted)) return "";
  }
  if (/\s$/u.test(before)) fitted = fitted.trimStart();
  if (!done) {
    const cut = fitted.search(/\s\S*$/u);
    return cut > 0 ? fitted.slice(0, cut) : "";
  }
  fitted = fitted.trimEnd();
  const tail = firstLine(after).trim();
  if (tail && fitted.endsWith(tail)) fitted = fitted.slice(0, -tail.length).trimEnd();
  return fitted;
}

export function requestedGhostCompletion(
  request: GhostRequester,
  options: RequestedGhostOptions = {},
): Extension {
  const delay = options.delayMs ?? REQUEST_DELAY_MS;
  const enabled = () => !options.enabled || options.enabled();
  const plugin = ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      private ticket = 0;
      private pending: PendingGhost | null = null;
      private ahead: PendingGhost | null = null;
      private contact = Number.NEGATIVE_INFINITY;
      private awaitingPopup = false;
      private readonly cache: CachedGhost[] = [];

      constructor(readonly view: EditorView) {}

      update(update: ViewUpdate) {
        const popup = completionStatus(update.state);
        if (this.awaitingPopup && popup !== "pending") {
          this.awaitingPopup = false;
          if (popup === null) this.schedule(0);
        }
        if (!update.docChanged && !update.selectionSet) return;
        const accepted = update.transactions.some((tr) => tr.isUserEvent("input.complete"));
        if (!accepted && !update.state.field(ghostField, false)) this.dropAhead();
        if (this.followTyping(update)) return;
        this.cancel();
        if (!update.transactions.some(typedEdit) || !enabled()) return;
        this.warm();
        this.schedule(accepted || this.cachedAt(update.state) ? 0 : delay);
      }

      private cachedAt(state: EditorState): boolean {
        const pos = requestAnchor(state);
        if (pos === null) return false;
        const { before, after } = requestWindow(state, pos);
        return this.fromCache(before, after) !== null;
      }

      private warm() {
        const now = Date.now();
        if (now - this.contact < WARM_AFTER_MS) return;
        this.contact = now;
        options.warm?.();
      }

      private followTyping(update: ViewUpdate): boolean {
        const pending = this.pending;
        if (!pending) return false;
        for (const tr of update.transactions) {
          if (!tr.docChanged && !tr.selection) continue;
          const typed = typedAt(tr, pending.origin + pending.typed.length);
          if (!typed) return false;
          pending.typed += typed;
        }
        const known = fittedGhostText(pending.raw, pending.before, pending.after, false);
        return known.length >= pending.typed.length
          ? known.startsWith(pending.typed)
          : pending.typed.startsWith(known);
      }

      private schedule(wait: number) {
        const ticket = ++this.ticket;
        const run = () => {
          if (this.ticket === ticket) this.fire();
        };
        if (wait <= 0) queueMicrotask(run);
        else this.timer = setTimeout(run, wait);
      }

      private fire() {
        this.timer = null;
        const state = this.view.state;
        if (!enabled()) return;
        const pos = requestAnchor(state);
        if (pos === null) return;
        const { before, after } = requestWindow(state, pos);
        const cached = this.fromCache(before, after);
        if (cached) {
          if (this.popupHides(state)) return;
          this.view.dispatch({ effects: setGhost.of({ pos, text: cached }) });
          return;
        }
        const current = this.pending;
        if (current && sameContext(current, before, after)) {
          this.show(current, fittedGhostText(current.raw, current.before, current.after, false));
          return;
        }
        const ahead = this.ahead;
        if (ahead && sameContext(ahead, before, after)) {
          this.ahead = null;
          ahead.ahead = false;
          ahead.origin = pos;
          this.pending = ahead;
          this.show(ahead, fittedGhostText(ahead.raw, ahead.before, ahead.after, false));
          return;
        }
        this.pending = this.start(pos, before, after, false);
      }

      private start(origin: number, before: string, after: string, ahead: boolean): PendingGhost {
        this.contact = Date.now();
        const pending: PendingGhost = {
          controller: new AbortController(),
          origin,
          before,
          after,
          typed: "",
          raw: "",
          ahead,
        };
        const live = () => this.pending === pending || this.ahead === pending;
        request({
          before,
          after,
          signal: pending.controller.signal,
          onText: (text) => {
            if (!live()) return;
            pending.raw = text;
            if (/\r?\n/u.test(text)) this.finish(pending);
            else if (!pending.ahead) this.show(pending, fittedGhostText(text, before, after, false));
          },
        }).then(
          () => {
            if (live()) this.finish(pending);
          },
          () => {
            if (this.pending === pending) this.pending = null;
            if (this.ahead === pending) this.ahead = null;
          },
        );
        return pending;
      }

      private finish(pending: PendingGhost) {
        if (this.pending === pending) this.pending = null;
        if (this.ahead === pending) this.ahead = null;
        pending.controller.abort();
        const text = fittedGhostText(pending.raw, pending.before, pending.after, true);
        if (!text) return;
        this.remember(pending.before, pending.after, text);
        if (pending.ahead) return;
        if (!this.show(pending, text)) {
          this.schedule(0);
          return;
        }
        this.lookAhead(pending, text);
      }

      private lookAhead(pending: PendingGhost, text: string) {
        if (this.ahead || !enabled() || completionStatus(this.view.state) === "active") return;
        const before = pending.before + text;
        if (this.fromCache(before, pending.after) !== null) return;
        this.ahead = this.start(pending.origin + text.length, before, pending.after, true);
      }

      private show(pending: PendingGhost, text: string): boolean {
        if (!text.startsWith(pending.typed)) return false;
        const rest = text.slice(pending.typed.length);
        const pos = pending.origin + pending.typed.length;
        const state = this.view.state;
        if (!rest || state.selection.main.head !== pos || !state.selection.main.empty) return true;
        if (this.popupHides(state)) return true;
        const shown = state.field(ghostField, false);
        if (shown?.pos === pos && shown.text === rest) return true;
        this.view.dispatch({ effects: setGhost.of({ pos, text: rest }) });
        return true;
      }

      private popupHides(state: EditorState): boolean {
        const popup = completionStatus(state);
        if (popup === "active") return true;
        if (popup !== "pending" || state.field(ghostField, false)) return false;
        this.awaitingPopup = true;
        return true;
      }

      private remember(before: string, after: string, text: string) {
        const tail = before.slice(-CACHE_TAIL_CHARS);
        const head = firstLine(after);
        const index = this.cache.findIndex((entry) => entry.tail === tail && entry.after === head);
        if (index >= 0) this.cache.splice(index, 1);
        this.cache.push({ tail, after: head, text });
        if (this.cache.length > CACHE_SIZE) this.cache.shift();
      }

      private fromCache(before: string, after: string): string | null {
        const head = firstLine(after);
        for (let index = this.cache.length - 1; index >= 0; index--) {
          const entry = this.cache[index];
          if (entry.after !== head) continue;
          for (let typed = 0; typed < entry.text.length; typed++) {
            if (before.endsWith(entry.tail + entry.text.slice(0, typed))) {
              return entry.text.slice(typed);
            }
          }
        }
        return null;
      }

      private dropAhead() {
        this.ahead?.controller.abort();
        this.ahead = null;
      }

      private cancel() {
        this.awaitingPopup = false;
        this.ticket++;
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.pending?.controller.abort();
        this.pending = null;
      }

      destroy() {
        this.cancel();
        this.dropAhead();
      }
    },
  );
  return [ghostCore, plugin];
}

function sameContext(pending: PendingGhost, before: string, after: string): boolean {
  return (
    pending.before.slice(-CACHE_TAIL_CHARS) === before.slice(-CACHE_TAIL_CHARS) &&
    firstLine(pending.after) === firstLine(after)
  );
}

export function pendingGhostCompletion(view: EditorView): string | null {
  return view.state.field(ghostField, false)?.text ?? null;
}
