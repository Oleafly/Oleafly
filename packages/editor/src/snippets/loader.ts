import type { CompletionSource } from "@codemirror/autocomplete";
import { type EditorState, type Extension, Facet } from "@codemirror/state";
import type { GhostHint } from "../ghost-completion";
import { lazyExtension } from "../lazy-extension";
import type { SnippetRuntime } from "./runtime";

let runtime: SnippetRuntime | null = null;
let loading: Promise<SnippetRuntime> | null = null;

export const autoExpandYieldsTo = Facet.define<(state: EditorState) => boolean>();

export function provideSnippetRuntime(loaded: SnippetRuntime): void {
  runtime = loaded;
}

export function loadedSnippetRuntime(): SnippetRuntime | null {
  return runtime;
}

export function loadSnippetRuntime(): Promise<SnippetRuntime> {
  loading ??= import("./runtime").then(
    (module) => module.snippetRuntime,
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

const lazySession = lazyExtension(() => loadSnippetRuntime().then((loaded) => loaded.snippetSessionExtension()));
const lazyAuto = lazyExtension(() => loadSnippetRuntime().then((loaded) => loaded.snippetAutoExpand()));

export function snippetSessionExtension(): Extension {
  return runtime ? runtime.snippetSessionExtension() : lazySession();
}

export function snippetAutoExpand(): Extension {
  return runtime ? runtime.snippetAutoExpand() : lazyAuto();
}

const hint: GhostHint = (state) => runtime?.snippetGhostHint()(state) ?? null;

export function snippetGhostHint(): GhostHint {
  return hint;
}

export function snippetHintBlocksAi(state: EditorState): boolean {
  return runtime?.snippetHintBlocksAi(state) ?? false;
}

const source: CompletionSource = (context) => runtime?.snippetCompletionSource()(context) ?? null;

export function withSnippetCompletions(sources: readonly CompletionSource[]): CompletionSource[] {
  return [
    source,
    ...sources.map((other): CompletionSource => (context) => (runtime?.fieldOwnsList(context) ? null : other(context))),
  ];
}
