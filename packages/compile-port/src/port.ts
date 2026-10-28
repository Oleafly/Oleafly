import type {
  DocumentEngineId,
  LogDiagnostic,
  SynctexForwardHit,
  SynctexHit,
  TexFlavor,
} from "@oleafly/backend-port";

export type { LogDiagnostic, SynctexForwardHit, SynctexHit } from "@oleafly/backend-port";

/** What to compile: the main document and the engine the project asks for. */
export interface CompileTarget {
  /** Project-relative path of the main document. */
  mainDocument: string;
  engine: DocumentEngineId;
  texFlavor: TexFlavor | null;
}

export interface CompileOutput {
  target: CompileTarget;
  ok: boolean;
  pdf: Uint8Array | null;
  /** The gzipped SyncTeX file, when the host holds it in memory. */
  synctex: Uint8Array | null;
  log: string;
  diagnostics: LogDiagnostic[];
  timeMs: number;
}

/** Click-to-source for one compiled output. */
export interface SyncTexIndex {
  forward(file: string, line: number): Promise<SynctexForwardHit | null>;
  inverse(page: number, x: number, y: number): Promise<SynctexHit | null>;
  dispose(): void;
}

/**
 * One way to compile a project and read what came out. The desktop compiles
 * the project folder through its engines; the browser runs engines in the page.
 */
export interface CompilePort {
  /** Whether this port has an engine for the target. */
  supports(target: CompileTarget): boolean;
  /** Compiles the target. A newer call stops the one still running. */
  compile(target: CompileTarget): Promise<CompileOutput>;
  /** Stops the compile that is running, which then rejects with `CompileStopped`. */
  stop(): void;
  /** Click-to-source for an output this port made, or null when it has none. */
  syncTex(output: CompileOutput): Promise<SyncTexIndex | null>;
}

export class CompileStopped extends Error {
  constructor() {
    super("compile stopped");
    this.name = "CompileStopped";
  }
}
