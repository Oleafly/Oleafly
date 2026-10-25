const LATEX_HREF = /\\href\s*(?:\[[^\]]*\]\s*)?\{([^{}]*)\}(?:\s*\{[^{}]*\})?/gu;
const TYPST_LINK = /#?link\(\s*"((?:[^"\\]|\\.)*)"\s*\)(?:\[[^\]]*\])?/gu;

function targetAt(pattern: RegExp, text: string, offset: number, clean: (raw: string) => string): string | null {
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (offset >= start && offset <= start + match[0].length) {
      const target = clean(match[1] ?? "").trim();
      return target || null;
    }
  }
  return null;
}

function isSpace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\r";
}

function destinationAt(line: string, from: number): { target: string; end: number } | null {
  let at = from;
  while (isSpace(line[at])) at += 1;
  let target: string;
  if (line[at] === "<") {
    const close = line.indexOf(">", at + 1);
    const reopen = line.indexOf("<", at + 1);
    if (close < 0 || (reopen >= 0 && reopen < close)) return null;
    target = line.slice(at + 1, close);
    at = close + 1;
  } else {
    const begin = at;
    while (at < line.length && !isSpace(line[at]) && line[at] !== "(" && line[at] !== ")") at += 1;
    if (at === begin) return null;
    target = line.slice(begin, at);
  }
  if (line[at] === ")") return { target, end: at + 1 };
  if (!isSpace(line[at])) return null;
  const close = line.indexOf(")", at);
  return close < 0 ? null : { target, end: close + 1 };
}

function imageStart(line: string, open: number): number {
  return open > 0 && line[open - 1] === "!" ? open - 1 : open;
}

function* markdownLinks(line: string): Generator<{ start: number; end: number; target: string }> {
  let open = -1;
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    index += 1;
    if (char === "[") {
      if (open < 0) open = index - 1;
      continue;
    }
    if (char !== "]") continue;
    const start = imageStart(line, open);
    open = -1;
    const destination = start >= 0 && line[index] === "(" ? destinationAt(line, index + 1) : null;
    if (!destination) continue;
    yield { start, ...destination };
    index = destination.end;
  }
}

function markdownTargetAt(text: string, offset: number): string | null {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineEnd = text.indexOf("\n", offset);
  const at = offset - lineStart;
  for (const link of markdownLinks(text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd))) {
    if (at < link.start) return null;
    if (at <= link.end) return link.target.trim() || null;
  }
  return null;
}

export function linkTargetAt(text: string, offset: number): string | null {
  return (
    targetAt(LATEX_HREF, text, offset, (raw) => raw.replaceAll(/\\([%#&_~$])/gu, "$1")) ??
    targetAt(TYPST_LINK, text, offset, (raw) => raw.replaceAll(/\\(.)/gu, "$1")) ??
    markdownTargetAt(text, offset)
  );
}
