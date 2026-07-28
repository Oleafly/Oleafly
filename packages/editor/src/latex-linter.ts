import { linter, type Diagnostic } from "@codemirror/lint";

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

    if (command === "verb") {
      if (text[commandEnd] === "*") commandEnd += 1;
      const delimiter = text[commandEnd];
      if (!delimiter || whitespace(delimiter)) {
        diagnostics.push(
          diagnostic(
            cursor,
            commandEnd,
            "error",
            "\\verb requires a non-whitespace delimiter",
          ),
        );
        cursor = commandEnd;
        continue;
      }
      const close = text.indexOf(delimiter, commandEnd + 1);
      const newline = text.indexOf("\n", commandEnd + 1);
      if (close < 0 || (newline >= 0 && newline < close)) {
        diagnostics.push(
          diagnostic(
            cursor,
            commandEnd + 1,
            "error",
            "Unclosed \\verb command",
          ),
        );
        cursor = newline < 0 ? text.length : newline + 1;
      } else {
        cursor = close + 1;
      }
      continue;
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
