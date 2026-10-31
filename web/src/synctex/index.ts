import wasmUrl from "./oleafly_synctex.wasm?url";
import { createSyncTexModule, type SyncTexModule, SyncTexError, type SyncTexExports } from "./engine";

export {
  SyncTexError,
  type SyncTexMappedLine,
  type SyncTexModule,
  type SyncTexErrorCode,
  type SyncTexFile,
} from "./engine";

export const SYNCTEX_WASM_URL: string = wasmUrl;

type WasmSource = BufferSource | WebAssembly.Module | Response;

async function instantiate(source: WasmSource): Promise<WebAssembly.Instance> {
  if (source instanceof WebAssembly.Module) return WebAssembly.instantiate(source, {});
  if (!(source instanceof Response)) return (await WebAssembly.instantiate(source, {})).instance;
  if (!source.ok) throw new Error(`the server answered ${source.status}`);
  return (await WebAssembly.instantiate(await source.arrayBuffer(), {})).instance;
}

export async function loadSyncTex(
  wasm: BufferSource | WebAssembly.Module | Promise<Response> | Response,
): Promise<SyncTexModule> {
  let instance: WebAssembly.Instance;
  try {
    instance = await instantiate(await wasm);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SyncTexError("load-failed", `SyncTeX couldn't load: ${reason}`);
  }
  return createSyncTexModule(instance.exports as unknown as SyncTexExports);
}
