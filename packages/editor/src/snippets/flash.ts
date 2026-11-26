import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { FLASH_CLASS } from "./session-theme";

export const SNIPPET_FLASH_MS = 200;

interface FlashRange {
  id: number;
  from: number;
  to: number;
}

const flashMark = Decoration.mark({ class: FLASH_CLASS });

const showSnippetFlash = StateEffect.define<FlashRange>({
  map: (value, mapping) => ({ ...value, from: mapping.mapPos(value.from, 1), to: mapping.mapPos(value.to, -1) }),
});

const hideSnippetFlash = StateEffect.define<number>();

export const snippetFlashField = StateField.define<FlashRange | null>({
  create: () => null,
  update(flash, tr) {
    let next = flash && tr.docChanged ? { ...flash, from: tr.changes.mapPos(flash.from, 1), to: tr.changes.mapPos(flash.to, -1) } : flash;
    for (const effect of tr.effects) {
      if (effect.is(showSnippetFlash)) next = effect.value;
      else if (effect.is(hideSnippetFlash) && next?.id === effect.value) next = null;
    }
    return next && next.to > next.from ? next : null;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (flash): DecorationSet =>
      flash ? Decoration.set([flashMark.range(flash.from, flash.to)]) : Decoration.none,
    ),
});

let nextFlashId = 0;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function snippetFlashEffect(from: number, to: number): StateEffect<FlashRange> | null {
  if (to - from <= 1 || reducedMotion()) return null;
  nextFlashId += 1;
  return showSnippetFlash.of({ id: nextFlashId, from, to });
}

export function scheduleFlashEnd(view: EditorView, effect: StateEffect<FlashRange> | null): void {
  if (!effect) return;
  const id = effect.value.id;
  setTimeout(() => {
    if (view.state.field(snippetFlashField, false)?.id === id) view.dispatch({ effects: hideSnippetFlash.of(id) });
  }, SNIPPET_FLASH_MS);
}
