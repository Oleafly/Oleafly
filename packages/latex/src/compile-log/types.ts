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
  /** File as printed in the log; innermost attributed input file. */
  readonly file: string | null;
  /** 1-based line number, when the log names one. */
  readonly line: number | null;
  readonly category: LogCategory;
  /** For errors: the raw log excerpt from the `!` line through the `l.<n>` line. */
  readonly errorContext?: string;
}

/**
 * Parsers only look at the first `MAX_COMPILE_LOG_BYTES` of a log (the head is
 * kept because diagnostics appear in compile order). Most parsers read the
 * whole log; we cap it so a runaway log cannot stall the UI thread.
 */
export const MAX_COMPILE_LOG_BYTES = 4 * 1024 * 1024;
