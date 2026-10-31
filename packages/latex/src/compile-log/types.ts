export type LogSeverity = "error" | "warning" | "info" | "typesetting";

export type LogCategory =
  | "error"
  | "undefined-reference"
  | "undefined-citation"
  | "package-warning"
  | "overfull-box"
  | "underfull-box"
  | "missing-character"
  | "info"
  | "bibtex"
  | "biber";

export interface LogDiagnostic {
  readonly severity: LogSeverity;
  readonly message: string;
  readonly file: string | null;
  readonly line: number | null;
  readonly category: LogCategory;
  readonly errorContext?: string;
}

export const MAX_COMPILE_LOG_BYTES = 4 * 1024 * 1024;
