import type {
  DocumentEngineId,
  LogDiagnostic,
  SynctexForwardHit,
  SynctexHit,
  TexFlavor,
} from "@oleafly/backend-port";

export type { LogDiagnostic, SynctexForwardHit, SynctexHit } from "@oleafly/backend-port";

export interface CompileTarget {
  mainDocument: string;
  engine: DocumentEngineId;
  texFlavor: TexFlavor | null;
}

export interface CompileOutput {
  target: CompileTarget;
  ok: boolean;
  pdf: Uint8Array | null;
  synctex: Uint8Array | null;
  log: string;
  diagnostics: LogDiagnostic[];
  timeMs: number;
}

export interface SyncTexIndex {
  forward(file: string, line: number): Promise<SynctexForwardHit | null>;
  inverse(page: number, x: number, y: number): Promise<SynctexHit | null>;
  dispose(): void;
}

export interface CompilePort {
  supports(target: CompileTarget): boolean;
  compile(target: CompileTarget): Promise<CompileOutput>;
  stop(): void;
  syncTex(output: CompileOutput): Promise<SyncTexIndex | null>;
}

export class CompileStopped extends Error {
  constructor() {
    super("compile stopped");
    this.name = "CompileStopped";
  }
}
