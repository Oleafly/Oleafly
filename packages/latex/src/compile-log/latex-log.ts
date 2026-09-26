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
  /^((?:(?:Class|Package|Module) \S*)|LaTeX(?: \S*)?|LaTeX3) (Info):\s+(.*?)(?: on(?: input)? line (\d+))?([.?]?)$/;
const latexWarn =
  /^((?:(?:Class|Package|Module) \S*)|LaTeX(?: \S*)?|LaTeX3) (Warning):\s+(.*?)(?: on(?: input)? line (\d+))?([.?]?)$/;
const latexPackageWarningExtraLines = /^\((.*)\)\s+(.*?)(?: +on input line (\d+))?(\.)?$/;
const latexMissChar = /^\s*(Missing character:.*?!)/;
const latexNoPageOutput = /^No pages of output\.$/;
const biberWarn = /^Biber warning:.*WARN - I didn't find a database entry for '([^']+)'/;
const bibEmptyPrefix = "Empty `thebibliography' environment";
const biblatexRerunBiber = "Package biblatex Warning: Please (re)run Biber on the file:";
const oleaflyBiberModeA = "[Oleafly] Biber was not found (mode A)";
const oleaflyBiberModeB = "[Oleafly] Biber/biblatex version mismatch (mode B)";
const oleaflyBiberGap = "[Oleafly] Bibliography needs Biber";
const engineOutputMarker = "[Oleafly] Engine output:";
const tectonicSummaryLine = /^(?:error|warning): .+:\d+: /;
const errorHelpLine = /^(?:See the .+ for explanation\.|Type {2}H <return> {2}for immediate help\.?)$/;
const bareRelativePath = /^"?([\p{N}-]*[\p{L}_][^\s"()[\]/:]*\/[^\s"()[\]]*)/u;

function bareRelativePathAt(rest: string): string | null {
  const match = bareRelativePath.exec(rest);
  if (!match) return null;
  let path = match[1];
  while (path.endsWith(".") || path.endsWith("/")) path = path.slice(0, -1);
  const slash = path.indexOf("/");
  return slash >= 0 && path.length > slash + 1 ? path : null;
}
const wrappedReference =
  /^LaTeX: (Reference|Citation) `(.*?)' on page \d+ undefined on input line (\d+)\.$/s;
const trailingInputLine = /on input line (\d+)\.?$/;
const wrappedLineNumber = /^([^\n]*)\n(\d+)(\.?)$/;

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
  awaitingErrorLine: boolean;
  awaitedLines: number;
  inEngineOutput: boolean;
  current: MutableEntry | null;
  nested: number;
  rootFile: string | null;
  fileStack: string[];
  out: LogDiagnostic[];
}

function unwrapWarning(entry: MutableEntry) {
  const text = entry.text.trimEnd();
  const unwrappable = entry.category === "package-warning" || entry.category === "info";
  if (!unwrappable || !text.includes("\n") || text.includes("\n(")) {
    return;
  }
  const splitNumber = wrappedLineNumber.exec(text);
  if (splitNumber && entry.line !== null) {
    entry.line = Number.parseInt(`${entry.line}${splitNumber[2]}`, 10);
    entry.text = `${splitNumber[1]}${splitNumber[3]}`;
    return;
  }
  const joined = text.replaceAll("\n", "");
  const reference = entry.category === "package-warning" ? wrappedReference.exec(joined) : null;
  if (reference) {
    entry.category = reference[1] === "Citation" ? "undefined-citation" : "undefined-reference";
    entry.line = Number.parseInt(reference[3], 10);
    entry.text = `Cannot find ${reference[1].toLowerCase()} \`${reference[2]}\`.`;
    return;
  }
  const inputLine = trailingInputLine.exec(joined);
  if (inputLine) {
    entry.line = Number.parseInt(inputLine[1], 10);
  }
}

function finalize(entry: MutableEntry): LogDiagnostic {
  unwrapWarning(entry);
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
  return state.fileStack.at(-1) ?? state.rootFile ?? null;
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
    awaitingErrorLine: false,
    awaitedLines: 0,
    inEngineOutput: false,
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
    if (state.current !== null && !state.current.text.startsWith(bibEmptyPrefix)) {
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
  if (skipEngineOutput(line, state)) {
    return;
  }
  if (parseOleaflyAnnotation(line, state)) {
    return;
  }
  // Append the read line, since we have a corresponding result in the matching
  if (state.searchEmptyLine) {
    continueCurrentEntry(line, state);
    return;
  }
  if (tectonicSummaryLine.test(line)) {
    return;
  }
  if (parseUndefinedReference(line, filename, state)) {
    return;
  }
  if (parseBadBox(line, filename, state)) {
    return;
  }
  if (parseNoPageOutput(line, filename, state)) {
    return;
  }
  if (parseMissingCharacter(line, filename, state)) {
    return;
  }
  if (parseLatexInfo(line, filename, state)) {
    return;
  }
  if (parseLatexWarning(line, filename, state)) {
    return;
  }
  if (parseBiberWarning(line, state)) {
    return;
  }
  if (parseLatexError(line, filename, state)) {
    return;
  }
  state.nested = parseLaTeXFileStack(line, state.fileStack, state.nested);
  if (state.fileStack.length === 0 && state.rootFile !== null) {
    state.fileStack.push(state.rootFile);
  }
}

function endEntry(state: ParserState) {
  state.searchEmptyLine = false;
  state.insideError = false;
  state.awaitingErrorLine = false;
  state.awaitedLines = 0;
}

function skipEngineOutput(line: string, state: ParserState): boolean {
  if (line.trimEnd() === engineOutputMarker) {
    pushCurrent(state);
    state.current = null;
    endEntry(state);
    state.inEngineOutput = true;
    return true;
  }
  if (!state.inEngineOutput) {
    return false;
  }
  if (line.startsWith("[Oleafly]")) {
    state.inEngineOutput = false;
    return false;
  }
  return true;
}

function startsNewEntry(line: string, insideError: boolean): boolean {
  if (line.startsWith("!")) {
    return true;
  }
  if (insideError) {
    return false;
  }
  return (
    /^\s*[()]/.test(line) ||
    UNDEFINED_REFERENCE.test(line) ||
    latexInfo.test(line) ||
    latexWarn.test(line) ||
    latexNoPageOutput.test(line) ||
    latexMissChar.test(line) ||
    [...overfullBoxRegexes, ...underfullBoxRegexes].some((regex) => regex.test(line))
  );
}

// Oleafly annotations must not be absorbed into a multi-line package warning.
function parseOleaflyAnnotation(line: string, state: ParserState): boolean {
  if (
    !line.startsWith(oleaflyBiberModeA) &&
    !line.startsWith(oleaflyBiberModeB) &&
    !line.startsWith(oleaflyBiberGap)
  ) {
    return false;
  }
  pushCurrent(state);
  endEntry(state);
  state.current = {
    severity: "error",
    category: "biber",
    file: null,
    line: null,
    text: line.replace(/^\[Oleafly\]\s*/, "").trim(),
  };
  return true;
}

function applyPackageExtraLine(current: MutableEntry, match: RegExpExecArray) {
  const period = match[4] ? "." : "";
  current.text += `\n(${match[1]})\t${match[2]}${period}`;
  current.line = match[3] ? Number.parseInt(match[3], 10) : null;
}

function continueCurrentEntry(line: string, state: ParserState) {
  if (state.awaitingErrorLine) {
    awaitErrorLine(line, state);
    return;
  }
  if (tectonicSummaryLine.test(line)) {
    return;
  }
  if (line.trim() === "" || (state.insideError && /^\s/.test(line))) {
    if (state.current !== null) {
      state.current.text = `${state.current.text}\n`;
    }
    if (state.insideError && state.current !== null && state.current.line === null) {
      state.awaitingErrorLine = true;
      return;
    }
    endEntry(state);
    return;
  }
  const packageExtraLineResult = latexPackageWarningExtraLines.exec(line);
  if (packageExtraLineResult && state.current !== null) {
    applyPackageExtraLine(state.current, packageExtraLineResult);
    return;
  }
  if (startsNewEntry(line, state.insideError)) {
    endEntry(state);
    parseLine(line, state);
    return;
  }
  if (state.insideError) {
    continueErrorContext(line, state);
    return;
  }
  if (state.current !== null) {
    state.current.text = `${state.current.text}\n${line}`;
  }
}

function awaitErrorLine(line: string, state: ParserState) {
  const match = messageLine.exec(line);
  if (match) {
    const context = state.current?.contextLines;
    if (context && context.length < MAX_ERROR_CONTEXT_LINES) {
      context.push(line);
    }
    if (state.current !== null && state.current.line === null) {
      state.current.line = Number.parseInt(match[1], 10);
    }
    endEntry(state);
    return;
  }
  const helpShaped =
    line.trim() === "" || (/^\s/.test(line) && !/^\s*[()]/.test(line)) || errorHelpLine.test(line);
  if (helpShaped && state.awaitedLines < MAX_ERROR_CONTEXT_LINES) {
    state.awaitedLines += 1;
    return;
  }
  endEntry(state);
  parseLine(line, state);
}

function continueErrorContext(line: string, state: ParserState) {
  const context = state.current?.contextLines;
  if (context && context.length < MAX_ERROR_CONTEXT_LINES) {
    context.push(line);
  }
  const match = messageLine.exec(line);
  if (match && match.length >= 2) {
    // The `l.<n>` excerpt ends the error message; skip the rest.
    if (state.current !== null && state.current.line === null) {
      state.current.line = Number.parseInt(match[1], 10);
    }
    endEntry(state);
    return;
  }
  if (state.current !== null) {
    state.current.text = `${state.current.text}\n${line}`;
  }
}

function parseNoPageOutput(line: string, filename: string | null, state: ParserState): boolean {
  const result = latexNoPageOutput.exec(line);
  if (result === null) {
    return false;
  }
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
  return true;
}

function parseMissingCharacter(line: string, filename: string | null, state: ParserState): boolean {
  const result = latexMissChar.exec(line);
  if (result === null) {
    return false;
  }
  pushCurrent(state);
  state.current = {
    severity: "warning",
    category: "missing-character",
    file: filename,
    line: null,
    text: result[1],
  };
  state.searchEmptyLine = false;
  return true;
}

function parseLatexInfo(line: string, filename: string | null, state: ParserState): boolean {
  const result = latexInfo.exec(line);
  if (result === null) {
    return false;
  }
  pushCurrent(state);
  state.current = {
    severity: "info",
    category: "info",
    file: filename,
    line: result[4] ? Number.parseInt(result[4], 10) : null,
    text: `${result[1]}: ${result[3]}${result[5]}`,
  };
  state.searchEmptyLine = true;
  return true;
}

function parseLatexWarning(line: string, filename: string | null, state: ParserState): boolean {
  const result = latexWarn.exec(line);
  if (result === null) {
    return false;
  }
  pushCurrent(state);
  // Prefer the dedicated Biber diagnostic over a generic package warning.
  if (line.startsWith(biblatexRerunBiber)) {
    state.current = {
      severity: "warning",
      category: "biber",
      file: null,
      line: null,
      text: "Bibliography needs Biber (biblatex). Oleafly should run pinned tectonic-biber automatically. If citations stay undefined, see [Oleafly] notes in this log.",
    };
    state.searchEmptyLine = false;
    return true;
  }
  state.current = {
    severity: "warning",
    category: "package-warning",
    file: filename,
    line: result[4] ? Number.parseInt(result[4], 10) : null,
    text: `${result[1]}: ${result[3]}${result[5]}`,
  };
  state.searchEmptyLine = true;
  return true;
}

function parseBiberWarning(line: string, state: ParserState): boolean {
  const result = biberWarn.exec(line);
  if (result === null) {
    return false;
  }
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
  return true;
}

function parseLatexError(line: string, filename: string | null, state: ParserState): boolean {
  const result = latexError.exec(line);
  if (result === null) {
    return false;
  }
  pushCurrent(state);
  state.current = {
    severity: "error",
    category: "error",
    text: result[3] && result[3] !== "LaTeX" ? `${result[3]}: ${result[4]}` : result[4],
    file: result[1] ? result[1] : filename,
    line: result[2] ? Number.parseInt(result[2], 10) : null,
    contextLines: [line],
  };
  state.searchEmptyLine = true;
  state.insideError = true;
  return true;
}

function parseUndefinedReference(line: string, filename: string | null, state: ParserState): boolean {
  if (line === "LaTeX Warning: There were undefined references.") {
    return true;
  }
  const match = UNDEFINED_REFERENCE.exec(line);
  if (match === null) {
    return false;
  }

  pushCurrent(state);
  state.current = {
    severity: "warning",
    category: match[1] === "Citation" ? "undefined-citation" : "undefined-reference",
    file: filename,
    line: match[3] ? Number.parseInt(match[3], 10) : null,
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
      const result = regex.exec(line);
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
          line: Number.parseInt(result[2], 10),
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
    const result = /[()]/.exec(rest);
    if (result?.index === undefined) {
      return nested;
    }
    const paren = result[0];
    rest = rest.substring(result.index + 1);
    if (paren === "(") {
      const pathResult = /^"?((?:(?:[a-zA-Z]:|\.|\/)?(?:\/|\\\\?))[^"()[\]]*)/.exec(rest);
      const mikTeXPathResult = /^"?([^"()[\]]*\.[a-z]{3,})/.exec(rest);
      const bareResult = bareRelativePathAt(rest);
      if (pathResult) {
        fileStack.push(pathResult[1].trim());
      } else if (mikTeXPathResult) {
        fileStack.push(`./${mikTeXPathResult[1].trim()}`);
      } else if (bareResult) {
        fileStack.push(`./${bareResult}`);
      } else {
        nested += 1;
      }
    } else if (nested > 0) {
      nested -= 1;
    } else {
      fileStack.pop();
    }
  }
}
