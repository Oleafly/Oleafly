import type { SyncTexIndex, SyncTexOpener } from "@oleafly/compile-port";
import { loadSyncTex, SYNCTEX_WASM_URL, type SyncTexModule, SyncTexError } from "../synctex";

/**
 * An opener over the shared SyncTeX code, loaded the first time it is needed,
 * and again after a failed load or a crash, which leaves the module unusable.
 */
export function syncTexOpener(load: () => Promise<SyncTexModule>): SyncTexOpener {
  let engine: Promise<SyncTexModule> | null = null;
  const loaded = () => {
    if (engine) return engine;
    const loading = load().catch((error: unknown) => {
      engine = null;
      throw error;
    });
    engine = loading;
    return loading;
  };
  const open = async (synctex: Uint8Array, projectPaths: readonly string[]) => {
    try {
      return (await loaded()).open(synctex, projectPaths);
    } catch (error) {
      if (!(error instanceof SyncTexError && error.code === "crashed")) throw error;
      engine = null;
      return (await loaded()).open(synctex, projectPaths);
    }
  };
  return async (synctex, projectPaths): Promise<SyncTexIndex> => {
    const index = await open(synctex, projectPaths);
    return {
      forward: async (file, line) => index.forward(file, line),
      inverse: async (page, x, y) => index.inverse(page, x, y),
      dispose: () => index.dispose(),
    };
  };
}

export const openSyncTex = syncTexOpener(() => loadSyncTex(fetch(SYNCTEX_WASM_URL)));
