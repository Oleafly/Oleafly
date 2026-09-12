import { linter, type Diagnostic } from "@codemirror/lint";
import {
  latexBalancedGroupEnd,
  latexInlineVerbatimSpan,
} from "./latex-lexical";
import { validateXparseArgumentSpecification } from "./latex-xparse";
import { editorMessage, type EditorMessageKey } from "./messages";

interface OpenToken {
  from: number;
  to: number;
}

interface OpenEnvironment extends OpenToken {
  name: string;
}

interface OpenMath extends OpenToken {
  delimiter: "$" | "$$" | "\\(" | "\\[";
}

const INLINE_MATH_DELIMITER = String.raw`\(` as OpenMath["delimiter"];
const DISPLAY_MATH_DELIMITER = String.raw`\[` as OpenMath["delimiter"];

const VERBATIM_ENVIRONMENTS = new Set([
  "verbatim",
  "verbatim*",
  "Verbatim",
  "Verbatim*",
  "lstlisting",
  "minted",
  "comment",
]);

const commandCharacter = (char: string | undefined): boolean =>
  Boolean(char && /[A-Za-z@]/.test(char));

const whitespace = (char: string | undefined): boolean =>
  char === " " ||
  char === "\t" ||
  char === "\n" ||
  char === "\r";

const REQUIRED_BRACED_COMMANDS = new Set([
  "documentclass",
  "usepackage",
  "RequirePackage",
  "addbibresource",
  "newtheorem",
]);

const CLASSIC_COMMAND_DEFINITIONS = new Set([
  "newcommand",
  "renewcommand",
  "providecommand",
  "DeclareRobustCommand",
]);

const XPARSE_COMMAND_DEFINITIONS = new Set([
  "NewDocumentCommand",
  "RenewDocumentCommand",
  "ProvideDocumentCommand",
  "DeclareDocumentCommand",
]);

const CLASSIC_ENVIRONMENT_DEFINITIONS = new Set([
  "newenvironment",
  "renewenvironment",
]);

const XPARSE_ENVIRONMENT_DEFINITIONS = new Set([
  "NewDocumentEnvironment",
  "RenewDocumentEnvironment",
  "ProvideDocumentEnvironment",
  "DeclareDocumentEnvironment",
]);

interface ArgumentPosition {
  start: number;
  unclosedOptionalFrom: number | null;
}

function skipWhitespace(text: string, start: number): number {
  let cursor = start;
  while (whitespace(text[cursor])) cursor += 1;
  return cursor;
}

function optionalArgumentEnd(text: string, opening: number): number | null {
  let braceDepth = 0;
  let cursor = opening + 1;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === "\\") {
      cursor += Math.min(2, text.length - cursor);
      continue;
    }
    if (char === "{") braceDepth += 1;
    else if (char === "}" && braceDepth > 0) braceDepth -= 1;
    else if (char === "]" && braceDepth === 0) {
      return skipWhitespace(text, cursor + 1);
    }
    cursor += 1;
  }
  return null;
}

function afterOptionalArguments(
  text: string,
  start: number,
): ArgumentPosition {
  let cursor = skipWhitespace(text, start);
  if (text[cursor] === "*") {
    cursor = skipWhitespace(text, cursor + 1);
  }

  while (text[cursor] === "[") {
    const opening = cursor;
    const closed = optionalArgumentEnd(text, opening);
    if (closed === null) {
      return {
        start: text.length,
        unclosedOptionalFrom: opening,
      };
    }
    cursor = closed;
  }

  return {
    start: cursor,
    unclosedOptionalFrom: null,
  };
}

function balancedBraceEnd(text: string, start: number): number | null {
  if (text[start] !== "{") return null;
  let depth = 1;
  for (let cursor = start + 1; cursor < text.length; cursor += 1) {
    if (text[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (text[cursor] === "{") depth += 1;
    else if (text[cursor] === "}") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return null;
}

function validDefinedCommand(value: string): boolean {
  return /^\\(?:[A-Za-z@]+|.)$/u.test(value.trim());
}

interface DefinitionGroup {
  content: string;
  from: number;
  to: number;
}

function definitionGroup(
  text: string,
  start: number,
  opening = "{",
  closing = "}",
): DefinitionGroup | null {
  const from = skipWhitespace(text, start);
  const to = latexBalancedGroupEnd(text, from, opening, closing);
  if (to === null) return null;
  return {
    content: text.slice(from + 1, to - 1),
    from,
    to,
  };
}

type DefinitionGroupKind =
  | "environmentName"
  | "commandName"
  | "argumentSpecification"
  | "argumentCount"
  | "defaultArgument"
  | "beginBody"
  | "replacementBody"
  | "endBody";

const BRACED_GROUP_KEYS: Record<DefinitionGroupKind, EditorMessageKey> = {
  environmentName: "latex.lint.bracedEnvironmentName",
  commandName: "latex.lint.bracedCommandName",
  argumentSpecification: "latex.lint.bracedArgumentSpecification",
  argumentCount: "latex.lint.bracedArgumentCount",
  defaultArgument: "latex.lint.bracedDefaultArgument",
  beginBody: "latex.lint.bracedBeginBody",
  replacementBody: "latex.lint.bracedReplacementBody",
  endBody: "latex.lint.bracedEndBody",
};

const UNCLOSED_GROUP_KEYS: Record<DefinitionGroupKind, EditorMessageKey> = {
  environmentName: "latex.lint.unclosedEnvironmentName",
  commandName: "latex.lint.unclosedCommandName",
  argumentSpecification: "latex.lint.unclosedArgumentSpecification",
  argumentCount: "latex.lint.unclosedArgumentCount",
  defaultArgument: "latex.lint.unclosedDefaultArgument",
  beginBody: "latex.lint.unclosedBeginBody",
  replacementBody: "latex.lint.unclosedReplacementBody",
  endBody: "latex.lint.unclosedEndBody",
};

function diagnostic(
  from: number,
  to: number,
  severity: Diagnostic["severity"],
  message: string,
): Diagnostic {
  return {
    from,
    to: Math.max(from + 1, to),
    severity,
    message,
    source: editorMessage("latex.lint.source"),
  };
}

function matchingMathClose(
  delimiter: OpenMath["delimiter"],
): string {
  if (delimiter === String.raw`\(`) return String.raw`\)`;
  if (delimiter === String.raw`\[`) return String.raw`\]`;
  return delimiter;
}

function validateRequiredDefinitionGroup(
  text: string,
  start: number,
  command: string,
  kind: DefinitionGroupKind,
  diagnostics: Diagnostic[],
): DefinitionGroup | null {
  const from = skipWhitespace(text, start);
  if (text[from] !== "{") {
    const markerFrom = Math.min(from, Math.max(0, text.length - 1));
    diagnostics.push(
      diagnostic(
        markerFrom,
        Math.min(text.length, markerFrom + 1),
        "error",
        editorMessage(BRACED_GROUP_KEYS[kind], { command }),
      ),
    );
    return null;
  }
  const group = definitionGroup(text, from);
  if (!group) {
    const markerFrom = Math.min(from, Math.max(0, text.length - 1));
    diagnostics.push(
      diagnostic(
        markerFrom,
        Math.min(text.length, markerFrom + 1),
        "error",
        editorMessage(UNCLOSED_GROUP_KEYS[kind], { command }),
      ),
    );
  }
  return group;
}

function validateOptionalDefinitionGroup(
  text: string,
  start: number,
  command: string,
  kind: DefinitionGroupKind,
  diagnostics: Diagnostic[],
): DefinitionGroup | null | undefined {
  const from = skipWhitespace(text, start);
  if (text[from] !== "[") return undefined;
  const group = definitionGroup(text, from, "[", "]");
  if (!group) {
    const markerFrom = Math.min(from, Math.max(0, text.length - 1));
    diagnostics.push(
      diagnostic(
        markerFrom,
        Math.min(text.length, markerFrom + 1),
        "error",
        editorMessage(UNCLOSED_GROUP_KEYS[kind], { command }),
      ),
    );
    return null;
  }
  return group;
}

interface DefinitionKinds {
  readonly classicCommand: boolean;
  readonly xparseCommand: boolean;
  readonly classicEnvironment: boolean;
  readonly xparseEnvironment: boolean;
}

function controlSequenceNameEnd(
  text: string,
  cursor: number,
  command: string,
  diagnostics: Diagnostic[],
): number | null {
  let nameEnd = cursor + 1;
  if (!text[nameEnd]) {
    diagnostics.push(
      diagnostic(
        cursor,
        cursor + 1,
        "error",
        editorMessage("latex.lint.incompleteCommandName", { command }),
      ),
    );
    return null;
  }
  if (commandCharacter(text[nameEnd])) {
    while (commandCharacter(text[nameEnd])) nameEnd += 1;
  } else {
    nameEnd += 1;
  }
  return nameEnd;
}

function definitionNameEnd(
  text: string,
  cursor: number,
  command: string,
  kinds: DefinitionKinds,
  diagnostics: Diagnostic[],
): number | null {
  if (kinds.classicCommand && text[cursor] === "\\") {
    return controlSequenceNameEnd(text, cursor, command, diagnostics);
  }
  const name = validateRequiredDefinitionGroup(
    text,
    cursor,
    command,
    kinds.classicEnvironment || kinds.xparseEnvironment
      ? "environmentName"
      : "commandName",
    diagnostics,
  );
  if (!name) return null;
  if (
    (kinds.classicCommand || kinds.xparseCommand) &&
    !validDefinedCommand(name.content)
  ) {
    diagnostics.push(
      diagnostic(
        name.from + 1,
        name.to - 1,
        "error",
        editorMessage("latex.lint.requiresControlSequence", { command }),
      ),
    );
  }
  if (
    (kinds.classicEnvironment || kinds.xparseEnvironment) &&
    !name.content.trim()
  ) {
    diagnostics.push(
      diagnostic(
        name.from,
        name.to,
        "error",
        editorMessage("latex.lint.emptyEnvironmentName", { command }),
      ),
    );
  }
  return name.to;
}

function xparseSpecificationEnd(
  text: string,
  cursor: number,
  command: string,
  diagnostics: Diagnostic[],
): number | null {
  const specification = validateRequiredDefinitionGroup(
    text,
    cursor,
    command,
    "argumentSpecification",
    diagnostics,
  );
  if (!specification) return null;
  for (const issue of validateXparseArgumentSpecification(
    specification.content,
  )) {
    diagnostics.push(
      diagnostic(
        specification.from + 1 + issue.from,
        specification.from + 1 + issue.to,
        "error",
        issue.message,
      ),
    );
  }
  return specification.to;
}

function classicArgumentCountEnd(
  text: string,
  cursor: number,
  command: string,
  diagnostics: Diagnostic[],
): number | null {
  const count = validateOptionalDefinitionGroup(
    text,
    cursor,
    command,
    "argumentCount",
    diagnostics,
  );
  if (count === null) return null;
  if (!count) return cursor;
  if (!/^\d$/u.test(count.content.trim())) {
    diagnostics.push(
      diagnostic(
        count.from + 1,
        count.to - 1,
        "error",
        editorMessage("latex.lint.argumentCountDigit", { command }),
      ),
    );
  }
  const defaultValue = validateOptionalDefinitionGroup(
    text,
    count.to,
    command,
    "defaultArgument",
    diagnostics,
  );
  if (defaultValue === null) return null;
  return defaultValue ? defaultValue.to : count.to;
}

function definitionArgumentsEnd(
  text: string,
  cursor: number,
  command: string,
  kinds: DefinitionKinds,
  diagnostics: Diagnostic[],
): number | null {
  if (kinds.xparseCommand || kinds.xparseEnvironment) {
    return xparseSpecificationEnd(text, cursor, command, diagnostics);
  }
  return classicArgumentCountEnd(text, cursor, command, diagnostics);
}

function validateDefinition(
  text: string,
  commandEnd: number,
  command: string,
  diagnostics: Diagnostic[],
): void {
  const kinds: DefinitionKinds = {
    classicCommand: CLASSIC_COMMAND_DEFINITIONS.has(command),
    xparseCommand: XPARSE_COMMAND_DEFINITIONS.has(command),
    classicEnvironment: CLASSIC_ENVIRONMENT_DEFINITIONS.has(command),
    xparseEnvironment: XPARSE_ENVIRONMENT_DEFINITIONS.has(command),
  };
  if (
    !kinds.classicCommand &&
    !kinds.xparseCommand &&
    !kinds.classicEnvironment &&
    !kinds.xparseEnvironment
  ) {
    return;
  }

  let cursor = skipWhitespace(text, commandEnd);
  if (text[cursor] === "*") {
    cursor = skipWhitespace(text, cursor + 1);
  }

  const afterName = definitionNameEnd(
    text,
    cursor,
    command,
    kinds,
    diagnostics,
  );
  if (afterName === null) return;

  const afterArguments = definitionArgumentsEnd(
    text,
    afterName,
    command,
    kinds,
    diagnostics,
  );
  if (afterArguments === null) return;

  const firstBody = validateRequiredDefinitionGroup(
    text,
    afterArguments,
    command,
    kinds.classicEnvironment || kinds.xparseEnvironment
      ? "beginBody"
      : "replacementBody",
    diagnostics,
  );
  if (!firstBody) return;
  if (!kinds.classicEnvironment && !kinds.xparseEnvironment) return;
  validateRequiredDefinitionGroup(
    text,
    firstBody.to,
    command,
    "endBody",
    diagnostics,
  );
}

interface LatexLintScan {
  readonly text: string;
  readonly diagnostics: Diagnostic[];
  readonly braces: OpenToken[];
  readonly environments: OpenEnvironment[];
  readonly math: OpenMath[];
  readonly labels: Map<string, number>;
}

function closeBraceStep(scan: LatexLintScan, cursor: number): number {
  const open = scan.braces.pop();
  if (!open) {
    scan.diagnostics.push(
      diagnostic(
        cursor,
        cursor + 1,
        "error",
        editorMessage("latex.lint.unmatchedClosingBrace"),
      ),
    );
  }
  return cursor + 1;
}

function dollarMathStep(scan: LatexLintScan, cursor: number): number {
  const delimiter = scan.text[cursor + 1] === "$" ? "$$" : "$";
  const width = delimiter.length;
  const top = scan.math.at(-1);
  if (top?.delimiter === delimiter) {
    scan.math.pop();
  } else if (!top) {
    scan.math.push({
      delimiter,
      from: cursor,
      to: cursor + width,
    });
  } else {
    scan.diagnostics.push(
      diagnostic(
        cursor,
        cursor + width,
        "error",
        editorMessage("latex.lint.mismatchedMathDelimiter", {
          expected: matchingMathClose(top.delimiter),
          found: delimiter,
        }),
      ),
    );
  }
  return cursor + width;
}

function openInlineMathStep(
  scan: LatexLintScan,
  cursor: number,
  next: string,
): number {
  scan.math.push({
    delimiter: next === "(" ? INLINE_MATH_DELIMITER : DISPLAY_MATH_DELIMITER,
    from: cursor,
    to: cursor + 2,
  });
  return cursor + 2;
}

function closeInlineMathStep(
  scan: LatexLintScan,
  cursor: number,
  next: string,
): number {
  const close = next === ")" ? String.raw`\)` : String.raw`\]`;
  const expectedOpen = next === ")" ? String.raw`\(` : String.raw`\[`;
  const top = scan.math.at(-1);
  if (top?.delimiter === expectedOpen) {
    scan.math.pop();
  } else {
    scan.diagnostics.push(
      diagnostic(
        cursor,
        cursor + 2,
        "error",
        top
          ? `Mismatched math delimiter: expected ${matchingMathClose(top.delimiter)}, got ${close}`
          : `${close} has no matching ${expectedOpen}`,
      ),
    );
  }
  return cursor + 2;
}

function inlineVerbatimStep(
  scan: LatexLintScan,
  cursor: number,
  commandEnd: number,
  command: string,
): number {
  const inline = latexInlineVerbatimSpan(scan.text, cursor);
  if (!inline) {
    scan.diagnostics.push(
      diagnostic(
        cursor,
        commandEnd,
        "error",
        editorMessage("latex.lint.invalidVerbatimArgument", { command }),
      ),
    );
    return commandEnd;
  }
  if (!inline.complete) {
    scan.diagnostics.push(
      diagnostic(
        cursor,
        Math.min(scan.text.length, commandEnd + 1),
        "error",
        editorMessage("latex.lint.unclosedCommand", { command }),
      ),
    );
  }
  return Math.max(commandEnd, inline.to);
}

function validateRequiredBracedArgument(
  scan: LatexLintScan,
  cursor: number,
  commandEnd: number,
  command: string,
): void {
  const text = scan.text;
  const argument = afterOptionalArguments(text, commandEnd);
  if (argument.unclosedOptionalFrom !== null) {
    scan.diagnostics.push(
      diagnostic(
        argument.unclosedOptionalFrom,
        argument.unclosedOptionalFrom + 1,
        "error",
        editorMessage("latex.lint.unclosedOptionalArgument", { command }),
      ),
    );
    return;
  }
  if (text[argument.start] !== "{") {
    scan.diagnostics.push(
      diagnostic(
        cursor,
        commandEnd,
        "error",
        editorMessage("latex.lint.requiresBracedArgument", { command }),
      ),
    );
    return;
  }
  const argumentEnd = balancedBraceEnd(text, argument.start);
  if (
    argumentEnd !== null &&
    !text.slice(argument.start + 1, argumentEnd).trim()
  ) {
    scan.diagnostics.push(
      diagnostic(
        argument.start,
        argumentEnd + 1,
        "error",
        editorMessage("latex.lint.emptyArgument", { command }),
      ),
    );
  }
}

function validateCommandArguments(
  scan: LatexLintScan,
  cursor: number,
  commandEnd: number,
  command: string,
): void {
  if (
    CLASSIC_COMMAND_DEFINITIONS.has(command) ||
    XPARSE_COMMAND_DEFINITIONS.has(command) ||
    CLASSIC_ENVIRONMENT_DEFINITIONS.has(command) ||
    XPARSE_ENVIRONMENT_DEFINITIONS.has(command)
  ) {
    validateDefinition(scan.text, commandEnd, command, scan.diagnostics);
    return;
  }
  if (!REQUIRED_BRACED_COMMANDS.has(command)) return;
  validateRequiredBracedArgument(scan, cursor, commandEnd, command);
}

function labelStep(
  scan: LatexLintScan,
  argumentStart: number,
  argumentEnd: number,
  argument: string,
): number {
  const previous = scan.labels.get(argument);
  if (previous !== undefined) {
    scan.diagnostics.push(
      diagnostic(
        argumentStart + 1,
        argumentEnd,
        "warning",
        editorMessage("latex.lint.duplicateLabel", { label: argument }),
      ),
    );
  } else {
    scan.labels.set(argument, argumentStart + 1);
  }
  return argumentEnd + 1;
}

function beginEnvironmentStep(
  scan: LatexLintScan,
  cursor: number,
  argumentEnd: number,
  argument: string,
): number {
  const text = scan.text;
  if (VERBATIM_ENVIRONMENTS.has(argument)) {
    const closing = `\\end{${argument}}`;
    const close = text.indexOf(closing, argumentEnd + 1);
    if (close < 0) {
      scan.diagnostics.push(
        diagnostic(
          cursor,
          argumentEnd + 1,
          "error",
          editorMessage("latex.lint.unclosedEnvironment", {
            environment: `\\begin{${argument}}`,
          }),
        ),
      );
      return text.length;
    }
    return close + closing.length;
  }
  scan.environments.push({
    name: argument,
    from: cursor,
    to: argumentEnd + 1,
  });
  return argumentEnd + 1;
}

function endEnvironmentStep(
  scan: LatexLintScan,
  cursor: number,
  argumentEnd: number,
  argument: string,
): number {
  const environments = scan.environments;
  const top = environments.at(-1);
  if (top?.name === argument) {
    environments.pop();
    return argumentEnd + 1;
  }
  let matchingIndex = -1;
  for (
    let index = environments.length - 1;
    index >= 0;
    index -= 1
  ) {
    if (environments[index].name === argument) {
      matchingIndex = index;
      break;
    }
  }
  if (matchingIndex < 0) {
    scan.diagnostics.push(
      diagnostic(
        cursor,
        argumentEnd + 1,
        "error",
        editorMessage("latex.lint.endWithoutBegin", {
          end: `\\end{${argument}}`,
          begin: `\\begin{${argument}}`,
        }),
      ),
    );
    return argumentEnd + 1;
  }
  scan.diagnostics.push(
    diagnostic(
      cursor,
      argumentEnd + 1,
      "error",
      editorMessage("latex.lint.mismatchedEnvironment", {
        expected: `\\end{${top?.name ?? argument}}`,
        found: `\\end{${argument}}`,
      }),
    ),
  );
  for (
    let index = environments.length - 1;
    index > matchingIndex;
    index -= 1
  ) {
    const skipped = environments[index];
    scan.diagnostics.push(
      diagnostic(
        skipped.from,
        skipped.to,
        "error",
        editorMessage("latex.lint.unclosedEnvironment", {
          environment: `\\begin{${skipped.name}}`,
        }),
      ),
    );
  }
  environments.splice(matchingIndex);
  return argumentEnd + 1;
}

function structuralCommandStep(
  scan: LatexLintScan,
  cursor: number,
  commandEnd: number,
  command: string,
): number {
  const text = scan.text;
  let argumentStart = commandEnd;
  while (whitespace(text[argumentStart])) argumentStart += 1;
  if (text[argumentStart] !== "{") {
    scan.diagnostics.push(
      diagnostic(
        cursor,
        commandEnd,
        "error",
        editorMessage("latex.lint.requiresBracedArgument", { command }),
      ),
    );
    return commandEnd;
  }
  const argumentEnd = text.indexOf("}", argumentStart + 1);
  if (argumentEnd < 0) {
    scan.diagnostics.push(
      diagnostic(
        cursor,
        Math.min(text.length, argumentStart + 1),
        "error",
        editorMessage("latex.lint.unclosedArgument", { command }),
      ),
    );
    return argumentStart + 1;
  }
  const argument = text
    .slice(argumentStart + 1, argumentEnd)
    .trim();
  if (!argument) {
    scan.diagnostics.push(
      diagnostic(
        argumentStart,
        argumentEnd + 1,
        "error",
        editorMessage("latex.lint.emptyArgument", { command }),
      ),
    );
    return argumentEnd + 1;
  }
  if (command === "label") {
    return labelStep(scan, argumentStart, argumentEnd, argument);
  }
  if (command === "begin") {
    return beginEnvironmentStep(scan, cursor, argumentEnd, argument);
  }
  return endEnvironmentStep(scan, cursor, argumentEnd, argument);
}

function backslashStep(scan: LatexLintScan, cursor: number): number | null {
  const text = scan.text;
  const next = text[cursor + 1];
  if (next === "(" || next === "[") {
    return openInlineMathStep(scan, cursor, next);
  }
  if (next === ")" || next === "]") {
    return closeInlineMathStep(scan, cursor, next);
  }
  if (!next) {
    scan.diagnostics.push(
      diagnostic(
        cursor,
        cursor + 1,
        "error",
        editorMessage("latex.lint.incompleteCommandAtEof"),
      ),
    );
    return null;
  }

  // Control symbols such as \%, \_, \{, \}, \\ and \$ are complete
  // two-character commands. Their second character must not be interpreted
  // as a source delimiter.
  if (!commandCharacter(next)) return cursor + 2;

  let commandEnd = cursor + 2;
  while (commandCharacter(text[commandEnd])) commandEnd += 1;
  const command = text.slice(cursor + 1, commandEnd);

  if (
    command === "verb" ||
    command === "lstinline" ||
    command === "mintinline"
  ) {
    return inlineVerbatimStep(scan, cursor, commandEnd, command);
  }

  validateCommandArguments(scan, cursor, commandEnd, command);

  if (
    command !== "begin" &&
    command !== "end" &&
    command !== "label"
  ) {
    return commandEnd;
  }
  return structuralCommandStep(scan, cursor, commandEnd, command);
}

function lintLatexStep(scan: LatexLintScan, cursor: number): number | null {
  const text = scan.text;
  const char = text[cursor];

  if (char === "%") {
    const newline = text.indexOf("\n", cursor + 1);
    return newline < 0 ? text.length : newline + 1;
  }
  if (char === "{") {
    scan.braces.push({ from: cursor, to: cursor + 1 });
    return cursor + 1;
  }
  if (char === "}") return closeBraceStep(scan, cursor);
  if (char === "$") return dollarMathStep(scan, cursor);
  if (char !== "\\") return cursor + 1;
  return backslashStep(scan, cursor);
}

function reportUnclosedTokens(scan: LatexLintScan): void {
  for (const open of scan.braces) {
    scan.diagnostics.push(
      diagnostic(
        open.from,
        open.to,
        "error",
        editorMessage("latex.lint.unclosedOpeningBrace"),
      ),
    );
  }
  for (const open of scan.math) {
    scan.diagnostics.push(
      diagnostic(
        open.from,
        open.to,
        "error",
        editorMessage("latex.lint.unclosedMathDelimiter", {
          delimiter: open.delimiter,
          expected: matchingMathClose(open.delimiter),
        }),
      ),
    );
  }
  for (const open of scan.environments) {
    scan.diagnostics.push(
      diagnostic(
        open.from,
        open.to,
        "error",
        editorMessage("latex.lint.unclosedEnvironment", {
          environment: `\\begin{${open.name}}`,
        }),
      ),
    );
  }
}

/**
 * A recovery-oriented, linear LaTeX syntax pass. It intentionally keeps
 * scanning after damage, skips comments/verbatim content, and reports every
 * useful current-document delimiter/environment error instead of allowing one
 * malformed construct to blank the rest of the file.
 */
export function lintLatexText(text: string): Diagnostic[] {
  const scan: LatexLintScan = {
    text,
    diagnostics: [],
    braces: [],
    environments: [],
    math: [],
    labels: new Map<string, number>(),
  };

  let cursor = 0;
  while (cursor < text.length) {
    const next = lintLatexStep(scan, cursor);
    if (next === null) break;
    cursor = next;
  }

  reportUnclosedTokens(scan);

  return scan.diagnostics.sort(
    (left, right) =>
      left.from - right.from ||
      left.to - right.to ||
      left.message.localeCompare(right.message),
  );
}

export function createLatexLinter() {
  return linter(
    (view): Diagnostic[] =>
      lintLatexText(view.state.doc.toString()),
    {
      delay: 500,
    // Diagnostics render through the shared hover card, so the stock lint
    // tooltip must not also appear.
    tooltipFilter: () => [],
    },
  );
}
