import { autocompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { ghostCompletion } from "../ghost-completion";
import { tabOrderKeymap } from "../tab-order";
import { snippetAutoExpand } from "./auto";
import { fieldOwnsList, snippetCompletionSource } from "./completion";
import { snippetGhostHint, snippetHintBlocksAi } from "./hint";
import { insertSnippet, insertTemplate, templateApply } from "./insert";
import { provideSnippetRuntime } from "./loader";
import { snippetPlaceAt } from "./place";
import { type SnippetPort, snippetPortFacet } from "./port";
import { activeSnippetField, previousSnippetField, snippetSessionExtension } from "./session";
import { expandTabTrigger, fieldOrPopup } from "./tab";

export { insertSnippet, type SnippetTriggerKind } from "./insert";

export function snippetEditorExtensions(port: SnippetPort): Extension {
  return [
    snippetPortFacet.of(port),
    snippetSessionExtension(),
    snippetAutoExpand(),
    autocompletion({ override: [snippetCompletionSource()] }),
    ghostCompletion([], "generic", snippetGhostHint()),
    tabOrderKeymap(),
  ];
}

export const snippetRuntime = {
  activeSnippetField,
  expandTabTrigger,
  fieldOrPopup,
  fieldOwnsList,
  insertSnippet,
  insertTemplate,
  previousSnippetField,
  snippetAutoExpand,
  snippetCompletionSource,
  snippetGhostHint,
  snippetHintBlocksAi,
  snippetPlaceAt,
  snippetSessionExtension,
  templateApply,
};

export type SnippetRuntime = typeof snippetRuntime;

provideSnippetRuntime(snippetRuntime);
