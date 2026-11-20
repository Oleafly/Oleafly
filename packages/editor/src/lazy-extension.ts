import { Compartment, type Extension, StateEffect } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";

export const lazyExtensionFilled = StateEffect.define<null>();

export function lazyExtension(load: () => Promise<Extension>): () => Extension {
  let loaded: Extension | null = null;
  let loading: Promise<Extension> | null = null;
  const slot = new Compartment();
  const start = (): Promise<Extension> => {
    loading ??= load().then(
      (extension) => {
        loaded = extension;
        return extension;
      },
      (error: unknown) => {
        loading = null;
        throw error;
      },
    );
    return loading;
  };
  const filler = ViewPlugin.define((view) => {
    let live = true;
    start().then(
      (extension) => {
        if (live) view.dispatch({ effects: [slot.reconfigure(extension), lazyExtensionFilled.of(null)] });
      },
      () => undefined,
    );
    return {
      destroy() {
        live = false;
      },
    };
  });
  return () => loaded ?? [slot.of([]), filler];
}
