import { scanMathExpressions } from "@oleafly/editor/math-source";
import { Extension, InputRule } from "@tiptap/core";
import { codeSpanEnd } from "@/lib/code-fences";
import type { TextReplacements } from "@/lib/notes-appearance";
import { useSettingsStore } from "@/store/settings";

function typedForms(from: string, rules: TextReplacements): string[] {
  const forms = [from];
  for (const [prefix, swapped] of Object.entries(rules)) {
    if (prefix !== from && from.startsWith(prefix)) forms.push(swapped + from.slice(prefix.length));
  }
  return forms;
}

export function replacementBefore(text: string, rules: TextReplacements): [typed: string, to: string] | null {
  let found: { from: string; typed: string; to: string } | null = null;
  for (const [from, to] of Object.entries(rules)) {
    if (found && from.length <= found.from.length) continue;
    const typed = typedForms(from, rules).find((form) => text.endsWith(form));
    if (typed) found = { from, typed, to };
  }
  return found ? [found.typed, found.to] : null;
}

function insideTypedCodeOrMath(text: string): boolean {
  for (let index = text.indexOf("`"); index >= 0; ) {
    const end = codeSpanEnd(text, index);
    if (end === null) return true;
    index = text.indexOf("`", end);
  }
  return scanMathExpressions(text, { format: "markdown" }).at(-1)?.status === "incomplete";
}

export const NoteTextReplacements = Extension.create({
  name: "noteTextReplacements",

  addInputRules() {
    return [
      new InputRule({
        find: (text) => {
          const { notesTextReplace, notesTextReplacements } = useSettingsStore.getState();
          const pair = notesTextReplace ? replacementBefore(text, notesTextReplacements) : null;
          if (!pair) return null;
          const index = text.length - pair[0].length;
          return insideTypedCodeOrMath(text.slice(0, index)) ? null : { index, text: pair[0], data: { to: pair[1] } };
        },
        handler: ({ state, range, match }) => {
          state.tr.insertText(String(match.data?.to ?? ""), range.from, range.to);
        },
      }),
    ];
  },
});
