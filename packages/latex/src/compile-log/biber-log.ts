// Ported from LaTeX Workshop (https://github.com/James-Yu/LaTeX-Workshop) commit becabe2, MIT License, (c) James Yu.
//
// Pure-TypeScript port of src/parse/parser/biberlog.ts. LaTeX Workshop
// resolves .bib filenames against its project cache and looks up citation keys
// in its completion index; this port has neither, so filenames are reported as
// printed in the log and entry warnings are attributed to the most recently
// announced .bib data source.

import { type LogDiagnostic, MAX_COMPILE_LOG_BYTES } from "./types";

const bibFileInfo = /^INFO - Found BibTeX data source '(.*)'$/;
const lineError = /^ERROR - BibTeX subsystem.*, line (\d+), (.*)$/;
const missingEntryWarning = /^WARN - (I didn't find a database entry for '.*'.*)$/;
const lineWarning = /^WARN - (.* entry '(.*)' .*)$/;

/**
 * Parse a Biber .blg log into structured diagnostics.
 * Only the first {@link MAX_COMPILE_LOG_BYTES} characters are examined. Never throws.
 */
export function parseBiberLog(log: string): LogDiagnostic[] {
  const out: LogDiagnostic[] = [];
  const bibFileStack: string[] = [];
  const currentBib = () => bibFileStack[bibFileStack.length - 1] ?? null;

  try {
    for (const line of log.slice(0, MAX_COMPILE_LOG_BYTES).split("\n")) {
      let result = line.match(bibFileInfo);
      if (result) {
        bibFileStack.push(result[1]);
      }

      result = line.match(lineError);
      if (result) {
        out.push({
          severity: "error",
          category: "biber",
          file: currentBib(),
          line: parseInt(result[1], 10),
          message: result[2],
        });
        continue;
      }

      result = line.match(missingEntryWarning);
      if (result) {
        out.push({
          severity: "warning",
          category: "undefined-citation",
          file: currentBib(),
          line: null,
          message: result[1],
        });
      }

      result = line.match(lineWarning);
      if (result) {
        out.push({
          severity: "warning",
          category: "biber",
          file: currentBib(),
          line: null,
          message: result[1],
        });
      }
    }
  } catch {
    // Never let a pathological log break the caller.
  }
  return out;
}
