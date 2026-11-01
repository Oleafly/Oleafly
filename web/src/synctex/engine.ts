import type { SynctexForwardHit, SynctexHit } from "@oleafly/backend-port";

export type SyncTexErrorCode =
  | "bad-input"
  | "file-too-large"
  | "text-too-large"
  | "unreadable"
  | "closed"
  | "internal"
  | "out-of-memory"
  | "crashed"
  | "load-failed";

export class SyncTexError extends Error {
  readonly code: SyncTexErrorCode;

  constructor(code: SyncTexErrorCode, message: string) {
    super(message);
    this.name = "SyncTexError";
    this.code = code;
  }
}

export interface SyncTexFile {
  forward(file: string, line: number): SynctexForwardHit | null;
  inverse(page: number, x: number, y: number): SynctexHit | null;
  dispose(): void;
}

export interface SyncTexMappedLine {
  line: number;
  exact: boolean;
}

export interface SyncTexModule {
  mapLine(compiled: string, current: string, line: number, currentToCompiled: boolean): SyncTexMappedLine | null;
  open(gz: Uint8Array, projectPaths: readonly string[]): SyncTexFile;
}

export interface SyncTexExports {
  memory: WebAssembly.Memory;
  synctex_alloc(len: number): number;
  synctex_free(ptr: number, len: number): void;
  synctex_open(gz: number, gzLen: number, paths: number, pathsLen: number): number;
  synctex_forward(index: number, file: number, fileLen: number, line: number): number;
  synctex_inverse(index: number, page: number, x: number, y: number): number;
  synctex_close(index: number): number;
  synctex_map_line(
    compiled: number,
    compiledLen: number,
    current: number,
    currentLen: number,
    line: number,
    currentToCompiled: number,
  ): number;
  synctex_output_ptr(): number;
  synctex_output_len(): number;
}

const STATUS_CODES: ReadonlyMap<number, SyncTexErrorCode> = new Map([
  [-1, "bad-input"],
  [-2, "file-too-large"],
  [-3, "text-too-large"],
  [-4, "unreadable"],
  [-5, "closed"],
  [-6, "internal"],
]);

export function createSyncTexModule(exports: SyncTexExports): SyncTexModule {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let crashed = false;

  function call<T>(run: () => T): T {
    if (crashed) throw new SyncTexError("crashed", "SyncTeX stopped after an earlier error. Reload it to search again.");
    try {
      return run();
    } catch (error) {
      if (error instanceof WebAssembly.RuntimeError) {
        crashed = true;
        throw new SyncTexError("crashed", `SyncTeX stopped: ${error.message}`);
      }
      throw error;
    }
  }

  function output(): string {
    // Pointers and lengths are unsigned; JavaScript sees them as signed.
    const ptr = exports.synctex_output_ptr() >>> 0;
    const len = exports.synctex_output_len() >>> 0;
    return decoder.decode(new Uint8Array(exports.memory.buffer, ptr, len));
  }

  function failure(status: number): SyncTexError {
    return new SyncTexError(STATUS_CODES.get(status) ?? "internal", output() || `SyncTeX failed with status ${status}.`);
  }

  function answer<T>(status: number): T | null {
    if (status < 0) throw failure(status);
    return status === 0 ? null : (JSON.parse(output()) as T);
  }

  function withBuffers(buffers: readonly Uint8Array[], run: (pointers: number[]) => number): number {
    const pointers: number[] = [];
    try {
      for (const buffer of buffers) {
        const ptr = exports.synctex_alloc(buffer.length) >>> 0;
        if (ptr === 0) throw new SyncTexError("out-of-memory", "SyncTeX ran out of memory.");
        pointers.push(ptr);
        new Uint8Array(exports.memory.buffer, ptr, buffer.length).set(buffer);
      }
      return run(pointers);
    } finally {
      pointers.forEach((ptr, index) => exports.synctex_free(ptr, buffers[index].length));
    }
  }

  function file(handle: number): SyncTexFile {
    let open = true;
    const live = () => {
      if (!open) throw new SyncTexError("closed", "This SyncTeX index was disposed.");
    };
    const opened: SyncTexFile = {
      forward(file, line) {
        live();
        const name = encoder.encode(file);
        return call(() =>
          answer<SynctexForwardHit>(withBuffers([name], ([ptr]) => exports.synctex_forward(handle, ptr, name.length, line))),
        );
      },
      inverse(page, x, y) {
        live();
        return call(() => answer<SynctexHit>(exports.synctex_inverse(handle, page, x, y)));
      },
      dispose() {
        if (!open) return;
        open = false;
        if (!crashed) call(() => exports.synctex_close(handle));
      },
    };
    return opened;
  }

  return {
    mapLine(compiled, current, line, currentToCompiled) {
      const before = encoder.encode(compiled);
      const after = encoder.encode(current);
      return call(() =>
        answer<SyncTexMappedLine>(
          withBuffers([before, after], ([beforePtr, afterPtr]) =>
            exports.synctex_map_line(beforePtr, before.length, afterPtr, after.length, line, currentToCompiled ? 1 : 0),
          ),
        ),
      );
    },
    open(gz, projectPaths) {
      const paths = encoder.encode(JSON.stringify(projectPaths));
      const status = call(() =>
        withBuffers([gz, paths], ([gzPtr, pathsPtr]) =>
          exports.synctex_open(gzPtr, gz.length, pathsPtr, paths.length),
        ),
      );
      if (status <= 0) throw failure(status);
      return file(status);
    },
  };
}
