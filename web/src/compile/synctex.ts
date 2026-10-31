import type { SyncTexIndex, SyncTexOpener } from "@oleafly/compile-port";
import { loadSyncTex, SYNCTEX_WASM_URL, type SyncTexMappedLine, type SyncTexModule, SyncTexError } from "../synctex";

export type LineMapper = (
  compiled: string,
  current: string,
  line: number,
  currentToCompiled: boolean,
) => Promise<SyncTexMappedLine | null>;

export function syncTexEngine(load: () => Promise<SyncTexModule>): { open: SyncTexOpener; mapLine: LineMapper } {
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
  const using = async <T>(run: (module: SyncTexModule) => T): Promise<T> => {
    try {
      return run(await loaded());
    } catch (error) {
      if (!(error instanceof SyncTexError && error.code === "crashed")) throw error;
      engine = null;
      return run(await loaded());
    }
  };
  const open: SyncTexOpener = async (synctex, projectPaths): Promise<SyncTexIndex> => {
    const index = await using((module) => module.open(synctex, projectPaths));
    return {
      forward: async (file, line) => index.forward(file, line),
      inverse: async (page, x, y) => index.inverse(page, x, y),
      dispose: () => index.dispose(),
    };
  };
  const mapLine: LineMapper = (compiled, current, line, currentToCompiled) =>
    using((module) => module.mapLine(compiled, current, line, currentToCompiled));
  return { open, mapLine };
}

export function syncTexOpener(load: () => Promise<SyncTexModule>): SyncTexOpener {
  return syncTexEngine(load).open;
}

const shared = syncTexEngine(() => loadSyncTex(fetch(SYNCTEX_WASM_URL)));

export const openSyncTex: SyncTexOpener = shared.open;

export const mapSyncTexLine: LineMapper = shared.mapLine;
