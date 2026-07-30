import { linter, type Diagnostic } from "@codemirror/lint";
import {
  latexBalancedGroupEnd,
  latexInlineVerbatimSpan,
} from "./latex-lexical";
import { validateXparseArgumentSpecification } from "./latex-xparse";

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
    let braceDepth = 0;
    cursor += 1;
    let closed = false;
    while (cursor < text.length) {
      const char = text[cursor];
      if (char === "\\") {
        cursor += Math.min(2, text.length - cursor);
        continue;
      }
      if (char === "{") braceDepth += 1;
      else if (char === "}" && braceDepth > 0) braceDepth -= 1;
      else if (char === "]" && braceDepth === 0) {
        cursor = skipWhitespace(text, cursor + 1);
        closed = true;
        break;
      }
      cursor += 1;
    }
    if (!closed) {
      return {
        start: cursor,
        unclosedOptionalFrom: opening,
      };
    }
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
    source: "LaTeX syntax",
  };
}

function matchingMathClose(
  delimiter: OpenMath["delimiter"],
): string {
  if (delimiter === "\\(") return "\\)";
  if (delimiter === "\\[") return "\\]";
  return delimiter;
}

function validateRequiredDefinitionGroup(
  text: string,
  start: number,
  command: string,
  description: string,
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
        `\\${command} requires a braced ${description}`,
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
        `Unclosed ${description} for \\${command}`,
      ),
    );
  }
  return group;
}

function validateOptionalDefinitionGroup(
  text: string,
  start: number,
  command: string,
  description: string,
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
        `Unclosed ${description} for \\${command}`,
      ),
    );
    return null;
  }
  return group;
}

function validateDefinition(
  text: string,
  commandEnd: number,
  command: string,
  diagnostics: Diagnostic[],
): void {
  const classicCommand = CLASSIC_COMMAND_DEFINITIONS.has(command);
  const xparseCommand = XPARSE_COMMAND_DEFINITIONS.has(command);
  const classicEnvironment =
    CLASSIC_ENVIRONMENT_DEFINITIONS.has(command);
  const xparseEnvironment =
    XPARSE_ENVIRONMENT_DEFINITIONS.has(command);
  if (
    !classicCommand &&
    !xparseCommand &&
    !classicEnvironment &&
    !xparseEnvironment
  ) {
    return;
  }

  let cursor = skipWhitespace(text, commandEnd);
  if (text[cursor] === "*") {
    cursor = skipWhitespace(text, cursor + 1);
  }

  if (classicCommand && text[cursor] === "\\") {
    let nameEnd = cursor + 1;
    if (!text[nameEnd]) {
      diagnostics.push(
        diagnostic(
          cursor,
          cursor + 1,
          "error",
          `Incomplete command name argument to \\${command}`,
        ),
      );
      return;
    }
    if (commandCharacter(text[nameEnd])) {
      while (commandCharacter(text[nameEnd])) nameEnd += 1;
    } else {
      nameEnd += 1;
    }
    cursor = nameEnd;
  } else {
    const name = validateRequiredDefinitionGroup(
      text,
      cursor,
      command,
      classicEnvironment || xparseEnvironment
        ? "environment name"
        : "command name",
      diagnostics,
    );
    if (!name) return;
    if (
      (classicCommand || xparseCommand) &&
      !validDefinedCommand(name.content)
    ) {
      diagnostics.push(
        diagnostic(
          name.from + 1,
          name.to - 1,
          "error",
          `\\${command} requires a single control-sequence name`,
        ),
      );
    }
    if (
      (classicEnvironment || xparseEnvironment) &&
      !name.content.trim()
    ) {
      diagnostics.push(
        diagnostic(
          name.from,
          name.to,
          "error",
          `\\${command} environment name cannot be empty`,
        ),
      );
    }
    cursor = name.to;
  }

  if (xparseCommand || xparseEnvironment) {
    const specification = validateRequiredDefinitionGroup(
      text,
      cursor,
      command,
      "argument specification",
      diagnostics,
    );
    if (!specification) return;
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
    cursor = specification.to;
  } else {
    const count = validateOptionalDefinitionGroup(
      text,
      cursor,
      command,
      "argument count",
      diagnostics,
    );
    if (count === null) return;
    if (count) {
      if (!/^[0-9]$/u.test(count.content.trim())) {
        diagnostics.push(
          diagnostic(
            count.from + 1,
            count.to - 1,
            "error",
            `\\${command} argument count must be a digit from 0 to 9`,
          ),
        );
      }
      cursor = count.to;
      const defaultValue = validateOptionalDefinitionGroup(
        text,
        cursor,
        command,
        "default argument",
        diagnostics,
      );
      if (defaultValue === null) return;
      if (defaultValue) cursor = defaultValue.to;
    }
  }

  const firstBody = validateRequiredDefinitionGroup(
    text,
    cursor,
    command,
    classicEnvironment || xparseEnvironment
      ? "begin body"
      : "replacement body",
    diagnostics,
  );
  if (!firstBody) return;
  if (!classicEnvironment && !xparseEnvironment) return;
  validateRequiredDefinitionGroup(
    text,
    firstBody.to,
    command,
    "end body",
    diagnostics,
  );
}

/**
 * A recovery-oriented, linear LaTeX syntax pass. It intentionally keeps
 * scanning after damage, skips comments/verbatim content, and reports every
 * useful current-document delimiter/environment error instead of allowing one
 * malformed construct to blank the rest of the file.
 */
export function lintLatexText(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const braces: OpenToken[] = [];
  const environments: OpenEnvironment[] = [];
  const math: OpenMath[] = [];
  const labels = new Map<string, number>();

  let cursor = 0;
  while (cursor < text.length) {
    const char = text[cursor];

    if (char === "%") {
      const newline = text.indexOf("\n", cursor + 1);
      cursor = newline < 0 ? text.length : newline + 1;
      continue;
    }

    if (char === "{") {
      braces.push({ from: cursor, to: cursor + 1 });
      cursor += 1;
      continue;
    }
    if (char === "}") {
      const open = braces.pop();
      if (!open) {
        diagnostics.push(
          diagnostic(
            cursor,
            cursor + 1,
            "error",
            "Closing brace has no matching opening brace",
          ),
        );
      }
      cursor += 1;
      continue;
    }

    if (char === "$") {
      const delimiter = text[cursor + 1] === "$" ? "$$" : "$";
      const width = delimiter.length;
      const top = math.at(-1);
      if (top?.delimiter === delimiter) {
        math.pop();
      } else if (!top) {
        math.push({
          delimiter,
          from: cursor,
          to: cursor + width,
        });
      } else {
        diagnostics.push(
          diagnostic(
            cursor,
            cursor + width,
            "error",
            `Mismatched math delimiter: expected ${matchingMathClose(top.delimiter)}, got ${delimiter}`,
          ),
        );
      }
      cursor += width;
      continue;
    }

    if (char !== "\\") {
      cursor += 1;
      continue;
    }

    const next = text[cursor + 1];
    if (next === "(" || next === "[") {
      math.push({
        delimiter: next === "(" ? "\\(" : "\\[",
        from: cursor,
        to: cursor + 2,
      });
      cursor += 2;
      continue;
    }
    if (next === ")" || next === "]") {
      const close = next === ")" ? "\\)" : "\\]";
      const expectedOpen = next === ")" ? "\\(" : "\\[";
      const top = math.at(-1);
      if (top?.delimiter === expectedOpen) {
        math.pop();
      } else {
        diagnostics.push(
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
      cursor += 2;
      continue;
    }

    if (!next) {
      diagnostics.push(
        diagnostic(
          cursor,
          cursor + 1,
          "error",
          "Incomplete command at end of file",
        ),
      );
      break;
    }

    // Control symbols such as \%, \_, \{, \}, \\ and \$ are complete
    // two-character commands. Their second character must not be interpreted
    // as a source delimiter.
    if (!commandCharacter(next)) {
      cursor += 2;
      continue;
    }

    let commandEnd = cursor + 2;
    while (commandCharacter(text[commandEnd])) commandEnd += 1;
    const command = text.slice(cursor + 1, commandEnd);

    if (
      command === "verb" ||
      command === "lstinline" ||
      command === "mintinline"
    ) {
      const inline = latexInlineVerbatimSpan(text, cursor);
      if (!inline) {
        diagnostics.push(
          diagnostic(
            cursor,
            commandEnd,
            "error",
            `\\${command} has an invalid inline-verbatim argument`,
          ),
        );
        cursor = commandEnd;
        continue;
      }
      if (!inline.complete) {
        diagnostics.push(
          diagnostic(
            cursor,
            Math.min(text.length, commandEnd + 1),
            "error",
            `Unclosed \\${command} command`,
          ),
        );
      }
      cursor = Math.max(commandEnd, inline.to);
      continue;
    }

    if (
      CLASSIC_COMMAND_DEFINITIONS.has(command) ||
      XPARSE_COMMAND_DEFINITIONS.has(command) ||
      CLASSIC_ENVIRONMENT_DEFINITIONS.has(command) ||
      XPARSE_ENVIRONMENT_DEFINITIONS.has(command)
    ) {
      validateDefinition(
        text,
        commandEnd,
        command,
        diagnostics,
      );
    } else if (REQUIRED_BRACED_COMMANDS.has(command)) {
      const argument = afterOptionalArguments(text, commandEnd);
      if (argument.unclosedOptionalFrom !== null) {
        diagnostics.push(
          diagnostic(
            argument.unclosedOptionalFrom,
            argument.unclosedOptionalFrom + 1,
            "error",
            `Unclosed optional argument to \\${command}`,
          ),
        );
      } else if (text[argument.start] !== "{") {
        diagnostics.push(
          diagnostic(
            cursor,
            commandEnd,
            "error",
            `\\${command} requires a braced argument`,
          ),
        );
      } else {
        const argumentEnd = balancedBraceEnd(text, argument.start);
        if (
          argumentEnd !== null &&
          !text.slice(argument.start + 1, argumentEnd).trim()
        ) {
          diagnostics.push(
            diagnostic(
              argument.start,
              argumentEnd + 1,
              "error",
              `\\${command} argument cannot be empty`,
            ),
          );
        }
      }
    }

    if (
      command !== "begin" &&
      command !== "end" &&
      command !== "label"
    ) {
      cursor = commandEnd;
      continue;
    }

    let argumentStart = commandEnd;
    while (whitespace(text[argumentStart])) argumentStart += 1;
    if (text[argumentStart] !== "{") {
      diagnostics.push(
        diagnostic(
          cursor,
          commandEnd,
          "error",
          `\\${command} requires a braced argument`,
        ),
      );
      cursor = commandEnd;
      continue;
    }
    const argumentEnd = text.indexOf("}", argumentStart + 1);
    if (argumentEnd < 0) {
      diagnostics.push(
        diagnostic(
          cursor,
          Math.min(text.length, argumentStart + 1),
          "error",
          `Unclosed argument to \\${command}`,
        ),
      );
      cursor = argumentStart + 1;
      continue;
    }
    const argument = text
      .slice(argumentStart + 1, argumentEnd)
      .trim();
    if (!argument) {
      diagnostics.push(
        diagnostic(
          argumentStart,
          argumentEnd + 1,
          "error",
          `\\${command} argument cannot be empty`,
        ),
      );
      cursor = argumentEnd + 1;
      continue;
    }

    if (command === "label") {
      const previous = labels.get(argument);
      if (previous !== undefined) {
        diagnostics.push(
          diagnostic(
            argumentStart + 1,
            argumentEnd,
            "warning",
            `Duplicate label “${argument}” (first defined earlier in this file)`,
          ),
        );
      } else {
        labels.set(argument, argumentStart + 1);
      }
      cursor = argumentEnd + 1;
      continue;
    }

    if (command === "begin") {
      if (VERBATIM_ENVIRONMENTS.has(argument)) {
        const closing = `\\end{${argument}}`;
        const close = text.indexOf(closing, argumentEnd + 1);
        if (close < 0) {
          diagnostics.push(
            diagnostic(
              cursor,
              argumentEnd + 1,
              "error",
              `Unclosed environment \\begin{${argument}}`,
            ),
          );
          cursor = text.length;
        } else {
          cursor = close + closing.length;
        }
        continue;
      }
      environments.push({
        name: argument,
        from: cursor,
        to: argumentEnd + 1,
      });
      cursor = argumentEnd + 1;
      continue;
    }

    const top = environments.at(-1);
    if (top?.name === argument) {
      environments.pop();
      cursor = argumentEnd + 1;
      continue;
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
      diagnostics.push(
        diagnostic(
          cursor,
          argumentEnd + 1,
          "error",
          `\\end{${argument}} has no matching \\begin{${argument}}`,
        ),
      );
    } else {
      diagnostics.push(
        diagnostic(
          cursor,
          argumentEnd + 1,
          "error",
          `Mismatched environment: expected \\end{${top?.name ?? argument}}, got \\end{${argument}}`,
        ),
      );
      for (
        let index = environments.length - 1;
        index > matchingIndex;
        index -= 1
      ) {
        const skipped = environments[index];
        diagnostics.push(
          diagnostic(
            skipped.from,
            skipped.to,
            "error",
            `Unclosed environment \\begin{${skipped.name}}`,
          ),
        );
      }
      environments.splice(matchingIndex);
    }
    cursor = argumentEnd + 1;
  }

  for (const open of braces) {
    diagnostics.push(
      diagnostic(
        open.from,
        open.to,
        "error",
        "Opening brace is not closed",
      ),
    );
  }
  for (const open of math) {
    diagnostics.push(
      diagnostic(
        open.from,
        open.to,
        "error",
        `Unclosed math delimiter ${open.delimiter}; expected ${matchingMathClose(open.delimiter)}`,
      ),
    );
  }
  for (const open of environments) {
    diagnostics.push(
      diagnostic(
        open.from,
        open.to,
        "error",
        `Unclosed environment \\begin{${open.name}}`,
      ),
    );
  }

  return diagnostics.sort(
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
