import type { CompletionContext } from "@codemirror/autocomplete";
import type { EditorState, Text } from "@codemirror/state";

export interface CompletionRequestGuard {
  readonly doc: Text;
  readonly position: number;
  readonly generation: number;
}

interface OpenCompletionRequest {
  readonly position: number;
  readonly explicit: boolean;
  readonly generation: number;
  open: boolean;
}

let nextCompletionGeneration = 0;
const completionRequests = new WeakMap<Text, OpenCompletionRequest>();

/**
 * CodeMirror invokes every override source for one completion query in the
 * same JavaScript turn. Reuse one generation across those sources, then close
 * the request window in a microtask so a later query at the same document
 * position receives a new generation.
 */
export function createCompletionRequestGuard(
  context: CompletionContext,
): CompletionRequestGuard {
  const doc = context.state.doc;
  let request = completionRequests.get(doc);
  if (
    !request ||
    !request.open ||
    request.position !== context.pos ||
    request.explicit !== context.explicit
  ) {
    request = {
      position: context.pos,
      explicit: context.explicit,
      generation: ++nextCompletionGeneration,
      open: true,
    };
    completionRequests.set(doc, request);
    const opened = request;
    queueMicrotask(() => {
      if (completionRequests.get(doc) === opened) opened.open = false;
    });
  }
  return {
    doc,
    position: request.position,
    generation: request.generation,
  };
}

export function completionRequestIsCurrent(
  guard: CompletionRequestGuard,
  state: EditorState,
): boolean {
  return (
    state.doc === guard.doc &&
    completionRequests.get(guard.doc)?.generation === guard.generation
  );
}
