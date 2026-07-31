// Ported from LaTeX Workshop (https://github.com/James-Yu/LaTeX-Workshop) commit becabe2, MIT License, (c) James Yu.
//
// Pure-TypeScript port of src/parse/parser/bibtexlog.ts. LaTeX Workshop
// resolves .bib/.aux filenames against its project cache and looks up citation
// keys in its completion index; this port has neither, so filenames are
// reported as printed in the log (with `.aux` mapped to `.tex`) and key-only
// warnings carry the key in the message instead of a resolved location.

import { type LogDiagnostic, MAX_COMPILE_LOG_BYTES } from "./types";

const multiLineWarning = /^Warning--(.+)\n--line (\d+) of file (.+)$/gm;
const singleLineWarning = /^Warning--(.+) in ([^\s]+)\s*$/gm;
const multiLineError =
  /^(.*)---line (\d+) of file (.*)\n([^]+?)\nI'm skipping whatever remains of this entry$/gm;
const badCrossReference =
  /^(A bad cross reference---entry ".+?"\nrefers to entry.+?, which doesn't exist)$/gm;
const multiLineMacroError =
  /^(.*)\n?---line (\d+) of file (.*)\n([^]+?)\nI'm skipping whatever remains of this command$/gm;
const errorAuxFile = /^(.*)---while reading file (.*)$/gm;

function category(message: string): LogDiagnostic["category"] {
  return /didn't find a database entry/.test(message) ? "undefined-citation" : "bibtex";
}

/**
 * Parse a BibTeX .blg log into structured diagnostics.
 * Only the first {@link MAX_COMPILE_LOG_BYTES} characters are examined. Never throws.
 */
export function parseBibtexLog(log: string): LogDiagnostic[] {
  const out: LogDiagnostic[] = [];
  const text = log.slice(0, MAX_COMPILE_LOG_BYTES);

  const push = (
    severity: "error" | "warning",
    file: string | null,
    message: string,
    line: number | null
  ) => {
    out.push({ severity, category: category(message), file, line, message });
  };

  try {
    let result: RegExpExecArray | null;
    singleLineWarning.lastIndex = 0;
    while ((result = singleLineWarning.exec(text))) {
      push("warning", null, `${result[1]} in ${result[2]}`, null);
    }
    multiLineWarning.lastIndex = 0;
    while ((result = multiLineWarning.exec(text))) {
      push("warning", result[3], result[1], parseInt(result[2], 10));
    }
    multiLineError.lastIndex = 0;
    while ((result = multiLineError.exec(text))) {
      push("error", result[3], result[1], parseInt(result[2], 10));
    }
    multiLineMacroError.lastIndex = 0;
    while ((result = multiLineMacroError.exec(text))) {
      push("error", result[3], result[1], parseInt(result[2], 10));
    }
    badCrossReference.lastIndex = 0;
    while ((result = badCrossReference.exec(text))) {
      push("error", null, result[1], null);
    }
    errorAuxFile.lastIndex = 0;
    while ((result = errorAuxFile.exec(text))) {
      push("error", result[2].replace(/\.aux$/, ".tex"), result[1], null);
    }
  } catch {
    // Never let a pathological log break the caller.
  }
  return out;
}
