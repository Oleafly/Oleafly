const SIMPLE_TEXT_COMMANDS =
  /\\(?:emph|footnotesize|Huge|huge|LARGE|Large|large|mathbf|mathit|mathrm|mathsf|scriptsize|small|textbf|textit|textnormal|textrm|textsf|texttt|tiny)\s*\{([^{}]*)\}/gu;

function maskComments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      for (let index = 0; index < line.length; index += 1) {
        if (line[index] !== "%") continue;
        let slashes = 0;
        for (
          let cursor = index - 1;
          cursor >= 0 && line[cursor] === "\\";
          cursor -= 1
        ) {
          slashes += 1;
        }
        if (slashes % 2 === 0) {
          return `${line.slice(0, index)}${" ".repeat(line.length - index)}`;
        }
      }
      return line;
    })
    .join("\n");
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }
    if (text[index] === "{") depth += 1;
    if (text[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function collectNewCommands(text: string, macros: Map<string, string>): void {
  const command =
    /\\(?:newcommand|renewcommand|providecommand)\*?\s*(?:\{\s*)?\\([A-Za-z@]+)(?:\s*\})?\s*(?:\[(\d+)\])?\s*\{/gu;
  for (let match = command.exec(text); match; match = command.exec(text)) {
    if (match[2] && match[2] !== "0") continue;
    const open = command.lastIndex - 1;
    const close = matchingBrace(text, open);
    if (close < 0) continue;
    macros.set(match[1], text.slice(open + 1, close));
    command.lastIndex = close + 1;
  }
}

function collectDefinitions(text: string, macros: Map<string, string>): void {
  const definition = /\\def\s*\\([A-Za-z@]+)\s*\{/gu;
  for (
    let match = definition.exec(text);
    match;
    match = definition.exec(text)
  ) {
    const open = definition.lastIndex - 1;
    const close = matchingBrace(text, open);
    if (close < 0) continue;
    macros.set(match[1], text.slice(open + 1, close));
    definition.lastIndex = close + 1;
  }
}

export function collectLatexOutlineMacros(
  files: Readonly<Record<string, string>>,
): ReadonlyMap<string, string> {
  const macros = new Map<string, string>();
  for (const [path, source] of Object.entries(files)) {
    if (!/\.(?:cls|latex|ltx|sty|tex)$/iu.test(path)) continue;
    const text = maskComments(source);
    collectNewCommands(text, macros);
    collectDefinitions(text, macros);
  }
  return macros;
}

function expandProjectMacros(
  source: string,
  macros: ReadonlyMap<string, string>,
): string {
  let result = source;
  for (let depth = 0; depth < 8; depth += 1) {
    let changed = false;
    result = result.replace(
      /\\([A-Za-z@]+)(?:\s*\{\s*\})?/gu,
      (whole, name: string) => {
        const replacement = macros.get(name);
        if (replacement === undefined) return whole;
        changed = true;
        return replacement;
      },
    );
    if (!changed) break;
  }
  return result;
}

export function renderLatexOutlineTitle(
  source: string,
  macros: ReadonlyMap<string, string> = new Map(),
): string {
  let result = expandProjectMacros(source, macros);
  let previous = "";
  while (result !== previous) {
    previous = result;
    result = result.replace(SIMPLE_TEXT_COMMANDS, "$1");
  }
  return result
    .replace(/\\LaTeX(?:\s*\{\s*\})?/gu, "LaTeX")
    .replace(/\\TeX(?:\s*\{\s*\})?/gu, "TeX")
    .replace(/\\textasciitilde\s*\{\s*\}/gu, "~")
    .replace(/\\textasciicircum\s*\{\s*\}/gu, "^")
    .replace(/\\textbackslash\s*\{\s*\}/gu, "\\")
    .replace(/\\(?:centering|protect|relax|xspace)\b/gu, "")
    .replace(/\{\\(?:bf|it|rm|sf|tt)\s+([^{}]*)\}/gu, "$1")
    .replace(/\\(?:,|;|:|!|\s)/gu, " ")
    .replace(/\\pm\b/gu, "±")
    .replace(/\\times\b/gu, "×")
    .replace(/\\to\b/gu, "→")
    .replace(/\\([%$&#_{}])/gu, "$1")
    .replace(/\{\s*\}/gu, "")
    .replace(/~/gu, " ")
    .replace(/``|''/gu, '"')
    .replace(/\s+/gu, " ")
    .trim();
}
