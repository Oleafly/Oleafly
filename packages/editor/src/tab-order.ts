import { acceptCompletion } from "@codemirror/autocomplete";
import { type Extension, Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import { acceptGhostSuggestion } from "./ghost-completion";
import { vimOwnsInput } from "./latex-structure-commands";
import { loadedSnippetRuntime } from "./snippets/loader";

type TabStep = (view: EditorView) => boolean;

const TAB_STEPS: readonly TabStep[] = [
  (view) => loadedSnippetRuntime()?.fieldOrPopup(view) ?? false,
  acceptCompletion,
  (view) => acceptGhostSuggestion(view, "snippet"),
  (view) => loadedSnippetRuntime()?.expandTabTrigger(view) ?? false,
  (view) => acceptGhostSuggestion(view, "ai-or-word"),
];

export function runTabOrder(view: EditorView): boolean {
  return !vimOwnsInput(view) && TAB_STEPS.some((step) => step(view));
}

function runShiftTab(view: EditorView): boolean {
  return !vimOwnsInput(view) && (loadedSnippetRuntime()?.previousSnippetField(view) ?? false);
}

const tabOrder: Extension = Prec.highest(keymap.of([{ key: "Tab", run: runTabOrder, shift: runShiftTab }]));

export function tabOrderKeymap(): Extension {
  return tabOrder;
}
