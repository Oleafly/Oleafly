import type { LogDiagnostic } from "@oleafly/backend-port";
import { parseLatexLog } from "@oleafly/latex";
import { type CompileOutput, type CompilePort, CompileStopped, type CompileTarget, type SyncTexIndex } from "./port";

export interface CompileFile {
  path: string;
  kind: "text" | "blob";
}

export interface CompileSources {
  readonly files: readonly CompileFile[];
  text(path: string): string | null;
  bytes(path: string): Promise<Uint8Array | null>;
}

export interface EngineJob {
  target: CompileTarget;
  sources: CompileSources;
  signal: AbortSignal;
}

export interface EngineResult {
  ok: boolean;
  pdf: Uint8Array | null;
  synctex: Uint8Array | null;
  log: string;
  diagnostics?: LogDiagnostic[];
}

export interface BrowserEngine {
  accepts(target: CompileTarget): boolean;
  run(job: EngineJob): Promise<EngineResult>;
}

export type SyncTexOpener = (synctex: Uint8Array, projectPaths: readonly string[]) => Promise<SyncTexIndex>;

export interface BrowserCompilePortOptions {
  engines: readonly BrowserEngine[];
  sources(signal: AbortSignal): Promise<CompileSources>;
  openSyncTex: SyncTexOpener;
  now?: () => number;
}

export function createBrowserCompilePort(options: BrowserCompilePortOptions): CompilePort {
  const now = options.now ?? (() => performance.now());
  const projectPaths = new WeakMap<CompileOutput, readonly string[]>();
  let running: AbortController | null = null;

  const engineFor = (target: CompileTarget) => options.engines.find((engine) => engine.accepts(target)) ?? null;
  const stopped = (signal: AbortSignal) => {
    if (signal.aborted) throw new CompileStopped();
  };

  return {
    supports: (target) => engineFor(target) !== null,
    async compile(target) {
      const engine = engineFor(target);
      if (!engine) throw new Error(`No engine in this browser compiles ${target.engine} projects.`);
      running?.abort();
      const controller = new AbortController();
      running = controller;
      const started = now();
      try {
        const sources = await options.sources(controller.signal);
        stopped(controller.signal);
        const result = await engine.run({ target, sources, signal: controller.signal });
        stopped(controller.signal);
        const output: CompileOutput = {
          target,
          ok: result.ok,
          pdf: result.pdf,
          synctex: result.synctex,
          log: result.log,
          diagnostics: result.diagnostics ?? parseLatexLog(result.log, target.mainDocument),
          timeMs: Math.max(0, Math.round(now() - started)),
        };
        projectPaths.set(
          output,
          sources.files.map((file) => file.path),
        );
        return output;
      } finally {
        if (running === controller) running = null;
      }
    },
    stop() {
      running?.abort();
    },
    async syncTex(output) {
      if (!output.synctex) return null;
      return options.openSyncTex(output.synctex, projectPaths.get(output) ?? []);
    },
  };
}
