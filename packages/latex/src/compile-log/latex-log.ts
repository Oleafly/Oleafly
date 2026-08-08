// Ported from LaTeX Workshop (https://github.com/James-Yu/LaTeX-Workshop) commit becabe2, MIT License, (c) James Yu.
//
// Pure-TypeScript port of src/parse/parser/latexlog.ts with the vscode /
// LaTeX-Workshop plumbing removed (no diagnostics collections, no workspace
// configuration, no path resolution against the workspace). File attribution
// is reported exactly as printed in the log.

import {
  type LogCategory,
  type LogDiagnostic,
  type LogSeverity,
  MAX_COMPILE_LOG_BYTES,
} from "./types";

const latexError = /^(?!.*ignored error)(?:(.*):(\d+):|!)(?:\s?(.+) [Ee]rror:)? (.+?)$/;
const latexOverfullBox = /^(Overfull \\[vh]box \([^)]*\)) in paragraph at lines (\d+)--(\d+)$/;
const latexOverfullBoxAlt = /^(Overfull \\[vh]box \([^)]*\)) detected at line (\d+)$/;
const latexOverfullBoxOutput =
  /^(Overfull \\[vh]box \([^)]*\)) has occurred while \\output is active(?: \[(\d+)\])?/;
const latexUnderfullBox = /^(Underfull \\[vh]box \([^)]*\)) in paragraph at lines (\d+)--(\d+)$/;
const latexUnderfullBoxAlt = /^(Underfull \\[vh]box \([^)]*\)) detected at line (\d+)$/;
const latexUnderfullBoxOutput =
  /^(Underfull \\[vh]box \([^)]*\)) has occurred while \\output is active(?: \[(\d+)\])?/;
const latexInfo =
  /^((?:(?:Class|Package|Module) \S*)|LaTeX(?: \S*)?|LaTeX3) (Info):\s+(.*?)(?: on(?: input)? line (\d+))?(\.|\?|)$/;
const latexWarn =
  /^((?:(?:Class|Package|Module) \S*)|LaTeX(?: \S*)?|LaTeX3) (Warning):\s+(.*?)(?: on(?: input)? line (\d+))?(\.|\?|)$/;
const latexPackageWarningExtraLines = /^\((.*)\)\s+(.*?)(?: +on input line (\d+))?(\.)?$/;
const latexMissChar = /^\s*(Missing character:.*?!)/;
const latexNoPageOutput = /^No pages of output\.$/;
const bibEmpty = /^Empty `thebibliography' environment/;
const biberWarn = /^Biber warning:.*WARN - I didn't find a database entry for '([^']+)'/;
const biblatexRerunBiber =
  /^Package biblatex Warning: Please \(re\)run Biber on the file:/;
const oleaflyBiberModeA = /^\[Oleafly\] Biber was not found \(mode A\)/;
const oleaflyBiberModeB = /^\[Oleafly\] Biber\/biblatex version mismatch \(mode B\)/;
const oleaflyBiberGap = /^\[Oleafly\] Bibliography needs Biber/;

// LaTeX Warning: Reference `non-exist' on page 1 undefined on input line 10.
// LaTeX Warning: Citation `also-nothing' on page 1 undefined on input line 12.
const UNDEFINED_REFERENCE =
  /^LaTeX Warning: (Reference|Citation) `(.*?)' on page (?:\d+) undefined on input line (\d+).$/;

// A line with an error message will start with an 'l' character followed by a
// line number and then a space. After that it shows the line with the error but
// only up to the position of the error. If the error comes very late in the
// line, the error output will start with 3 dots.
// Upstream leaves bang-form errors on their default line; capturing the
// `l.<n>` number here is an intentional port addition so error cards can
// navigate to the failing line.
const messageLine = /^l\.(\d+)\s(\.\.\.)?(.*)$/;

const MAX_ERROR_CONTEXT_LINES = 12;

interface MutableEntry {
  severity: LogSeverity;
  category: LogCategory;
  file: string | null;
  line: number | null;
  text: string;
  /** Raw log lines from the `!` line through the `l.<n>` line (errors only). */
  contextLines?: string[];
}

interface ParserState {
  searchEmptyLine: boolean;
  insideBoxWarn: boolean;
  insideError: boolean;
  current: MutableEntry | null;
  nested: number;
  rootFile: string | null;
  fileStack: string[];
  out: LogDiagnostic[];
}

function finalize(entry: MutableEntry): LogDiagnostic {
  const context = entry.contextLines?.join("\n").trimEnd();
  return {
    severity: entry.severity,
    category: entry.category,
    file: entry.file,
    line: entry.line,
    message: entry.text.trimEnd(),
    ...(context ? { errorContext: context } : {}),
  };
}

function pushCurrent(state: ParserState) {
  if (state.current !== null) {
    state.out.push(finalize(state.current));
  }
}

function currentFile(state: ParserState): string | null {
  return state.fileStack[state.fileStack.length - 1] ?? state.rootFile ?? null;
}

/**
 * Parse a (pdf|xe|lua)latex compile log into structured diagnostics.
 *
 * Only the first {@link MAX_COMPILE_LOG_BYTES} characters are examined; the
 * head of the log is kept since diagnostics appear in compile order.
 * Never throws.
 */
export function parseLatexLog(log: string, rootFile?: string): LogDiagnostic[] {
  const state: ParserState = {
    searchEmptyLine: false,
    insideBoxWarn: false,
    insideError: false,
    current: null,
    nested: 0,
    rootFile: rootFile ?? null,
    fileStack: rootFile ? [rootFile] : [],
    out: [],
  };

  const lines = log.slice(0, MAX_COMPILE_LOG_BYTES).split("\n");
  try {
    for (const line of lines) {
      parseLine(line, state);
    }
    // Push the final result
    if (state.current !== null && !state.current.text.match(bibEmpty)) {
      state.out.push(finalize(state.current));
    }
  } catch {
    // A pathological log line must never break the caller; return what we have.
  }
  return state.out;
}

function parseLine(line: string, state: ParserState) {
  const filename = currentFile(state);
  // Skip the first line after a box warning, this is just garbage
  if (state.insideBoxWarn) {
    state.insideBoxWarn = false;
    return;
  }
  // Oleafly annotations must not be absorbed into a multi-line package warning.
  if (
    oleaflyBiberModeA.test(line) ||
    oleaflyBiberModeB.test(line) ||
    oleaflyBiberGap.test(line)
  ) {
    pushCurrent(state);
    state.searchEmptyLine = false;
    state.insideError = false;
    state.current = {
      severity: "error",
      category: "biber",
      file: null,
      line: null,
      text: line.replace(/^\[Oleafly\]\s*/, "").trim(),
    };
    return;
  }
  // Append the read line, since we have a corresponding result in the matching
  if (state.searchEmptyLine) {
    const context = state.insideError ? state.current?.contextLines : undefined;
    if (line.trim() === "" || (state.insideError && line.match(/^\s/))) {
      if (state.current !== null) {
        state.current.text = `${state.current.text}\n`;
      }
      state.searchEmptyLine = false;
      state.insideError = false;
    } else {
      const packageExtraLineResult = line.match(latexPackageWarningExtraLines);
      if (packageExtraLineResult && state.current !== null) {
        state.current.text += `\n(${packageExtraLineResult[1]})\t${packageExtraLineResult[2]}${packageExtraLineResult[4] ? "." : ""}`;
        state.current.line = packageExtraLineResult[3]
          ? parseInt(packageExtraLineResult[3], 10)
          : null;
      } else if (state.insideError) {
        if (context && context.length < MAX_ERROR_CONTEXT_LINES) {
          context.push(line);
        }
        const match = messageLine.exec(line);
        if (match && match.length >= 2) {
          // The `l.<n>` excerpt ends the error message; skip the rest.
          if (state.current !== null && state.current.line === null) {
            state.current.line = parseInt(match[1], 10);
          }
          state.searchEmptyLine = false;
          state.insideError = false;
        } else if (state.current !== null) {
          state.current.text = `${state.current.text}\n${line}`;
        }
      } else if (state.current !== null) {
        state.current.text = `${state.current.text}\n${line}`;
      }
    }
    return;
  }
  if (parseUndefinedReference(line, filename, state)) {
    return;
  }
  if (parseBadBox(line, filename, state)) {
    return;
  }
  let result = line.match(latexNoPageOutput);
  if (result) {
    pushCurrent(state);
    state.current = {
      severity: "error",
      category: "error",
      file: filename,
      line: null,
      text: result[1],
    };
    state.searchEmptyLine = true;
    state.insideError = true;
    return;
  }
  result = line.match(latexMissChar);
  if (result) {
    pushCurrent(state);
    state.current = {
      severity: "warning",
      category: "missing-character",
      file: filename,
      line: null,
      text: result[1],
    };
    state.searchEmptyLine = false;
    return;
  }
  result = line.match(latexInfo);
  if (result) {
    pushCurrent(state);
    state.current = {
      severity: "info",
      category: "info",
      file: filename,
      line: result[4] ? parseInt(result[4], 10) : null,
      text: `${result[1]}: ${result[3]}${result[5]}`,
    };
    state.searchEmptyLine = true;
    return;
  }
  result = line.match(latexWarn);
  if (result) {
    // Prefer the dedicated Biber diagnostic over a generic package warning.
    if (biblatexRerunBiber.test(line)) {
      pushCurrent(state);
      state.current = {
        severity: "warning",
        category: "biber",
        file: null,
        line: null,
        text: "Bibliography needs Biber (biblatex). Oleafly should run pinned tectonic-biber automatically. If citations stay undefined, see [Oleafly] notes in this log.",
      };
      state.searchEmptyLine = false;
      return;
    }
    pushCurrent(state);
    state.current = {
      severity: "warning",
      category: "package-warning",
      file: filename,
      line: result[4] ? parseInt(result[4], 10) : null,
      text: `${result[1]}: ${result[3]}${result[5]}`,
    };
    state.searchEmptyLine = true;
    return;
  }
  result = line.match(biberWarn);
  if (result) {
    pushCurrent(state);
    state.current = {
      severity: "warning",
      category: "biber",
      file: null,
      line: null,
      text: `No bib entry found for '${result[1]}'`,
    };
    state.searchEmptyLine = false;
    parseLine(line.substring(result[0].length), state);
    return;
  }

  result = line.match(latexError);
  if (result) {
    pushCurrent(state);
    state.current = {
      severity: "error",
      category: "error",
      text: result[3] && result[3] !== "LaTeX" ? `${result[3]}: ${result[4]}` : result[4],
      file: result[1] ? result[1] : filename,
      line: result[2] ? parseInt(result[2], 10) : null,
      contextLines: [line],
    };
    state.searchEmptyLine = true;
    state.insideError = true;
    return;
  }
  state.nested = parseLaTeXFileStack(line, state.fileStack, state.nested);
  if (state.fileStack.length === 0 && state.rootFile !== null) {
    state.fileStack.push(state.rootFile);
  }
}

function parseUndefinedReference(line: string, filename: string | null, state: ParserState): boolean {
  if (line === "LaTeX Warning: There were undefined references.") {
    return true;
  }
  const match = line.match(UNDEFINED_REFERENCE);
  if (match === null) {
    return false;
  }

  pushCurrent(state);
  state.current = {
    severity: "warning",
    category: match[1] === "Citation" ? "undefined-citation" : "undefined-reference",
    file: filename,
    line: match[3] ? parseInt(match[3], 10) : null,
    text: `Cannot find ${match[1].toLowerCase()} \`${match[2]}\`.`,
  };
  state.searchEmptyLine = false;

  return true;
}

const overfullBoxRegexes = [latexOverfullBox, latexOverfullBoxAlt, latexOverfullBoxOutput];
const underfullBoxRegexes = [latexUnderfullBox, latexUnderfullBoxAlt, latexUnderfullBoxOutput];

function parseBadBox(line: string, filename: string | null, state: ParserState): boolean {
  for (const [regexes, category] of [
    [overfullBoxRegexes, "overfull-box"],
    [underfullBoxRegexes, "underfull-box"],
  ] as const) {
    for (const regex of regexes) {
      const result = line.match(regex);
      if (result === null) {
        continue;
      }
      pushCurrent(state);
      if (regex === latexOverfullBoxOutput || regex === latexUnderfullBoxOutput) {
        state.current = {
          severity: "typesetting",
          category,
          file: filename,
          line: null,
          text: result[2] ? `${result[1]} in page ${result[2]}` : result[1],
        };
        parseLine(line.substring(result[0].length), state);
      } else {
        state.current = {
          severity: "typesetting",
          category,
          file: filename,
          line: parseInt(result[2], 10),
          text: result[1],
        };
        state.insideBoxWarn = true;
        state.searchEmptyLine = false;
      }
      return true;
    }
  }
  return false;
}

// Iterative version of LaTeX Workshop's recursive parenthesis walker: tracks
// `(` file pushes / `)` pops so diagnostics are attributed to nested \input
// files. Depth of anonymous groups is carried in `nested`.
function parseLaTeXFileStack(line: string, fileStack: string[], nested: number): number {
  let rest = line;
  for (;;) {
    const result = rest.match(/[()]/);
    if (result === null || result.index === undefined) {
      return nested;
    }
    const paren = result[0];
    rest = rest.substring(result.index + 1);
    if (paren === "(") {
      const pathResult = rest.match(/^"?((?:(?:[a-zA-Z]:|\.|\/)?(?:\/|\\\\?))[^"()[\]]*)/);
      const mikTeXPathResult = rest.match(/^"?([^"()[\]]*\.[a-z]{3,})/);
      if (pathResult) {
        fileStack.push(pathResult[1].trim());
      } else if (mikTeXPathResult) {
        fileStack.push(`./${mikTeXPathResult[1].trim()}`);
      } else {
        nested += 1;
      }
    } else {
      if (nested > 0) {
        nested -= 1;
      } else {
        fileStack.pop();
      }
    }
  }
}
