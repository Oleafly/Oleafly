// Pure helpers for the C1 hover equation preview: given a document and an
// offset, find the math construct enclosing the offset without touching
// CodeMirror. All scanning is bounded by `radius` so hovering inside a huge
// document never walks the whole text.

import { scanMathExpressions } from "@oleafly/editor";

export interface EnclosingMath {
  body: string;
  environment: string;
}

export const MATH_ENVIRONMENTS: ReadonlySet<string> = new Set([
  "equation",
  "align",
  "gather",
  "multline",
  "eqnarray",
  "alignat",
  "flalign",
  "math",
  "displaymath",
]);

const DEFAULT_RADIUS = 4096;

const BEGIN_END_RE = /\\(begin|end)\{([A-Za-z]+\*?)\}/g;

function stripStar(env: string): string {
  return env.endsWith("*") ? env.slice(0, -1) : env;
}

// A `\begin` preceded by an odd number of backslashes is `\\` + "begin"
// (a line break followed by plain text), not an environment opener.
function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

interface OpenBegin {
  env: string; // raw name, star included
  bodyFrom: number; // absolute index just past the closing `}` of \begin{env}
}

// Innermost math `\begin{env}` before `offset` that is not closed again before
// `offset`. Nesting is tracked per environment name so `\begin{align}` inside
// `\begin{equation}` resolves to the align.
function findUnclosedBegin(
  text: string,
  offset: number,
  windowStart: number,
): OpenBegin | null {
  const stacks = new Map<string, OpenBegin[]>();
  const slice = text.slice(windowStart, offset);
  for (const match of slice.matchAll(BEGIN_END_RE)) {
    const at = windowStart + (match.index ?? 0);
    if (isEscaped(text, at)) continue;
    const env = match[2];
    if (!MATH_ENVIRONMENTS.has(stripStar(env))) continue;
    if (match[1] === "begin") {
      let stack = stacks.get(env);
      if (!stack) {
        stack = [];
        stacks.set(env, stack);
      }
      stack.push({ env, bodyFrom: at + match[0].length });
    } else {
      stacks.get(env)?.pop();
    }
  }
  let innermost: OpenBegin | null = null;
  for (const stack of stacks.values()) {
    const top = stack[stack.length - 1];
    if (top && (!innermost || top.bodyFrom > innermost.bodyFrom)) innermost = top;
  }
  return innermost;
}

// Matching `\end{env}` for a begin whose body starts at `searchFrom`,
// nesting-aware for same-name environments. Returns the absolute index of the
// `\end` backslash, or null when no match starts before `limit`.
function findMatchingEnd(
  text: string,
  env: string,
  searchFrom: number,
  limit: number,
): number | null {
  const beginToken = `\\begin{${env}}`;
  const endToken = `\\end{${env}}`;
  let depth = 1;
  let cursor = searchFrom;
  while (cursor < limit) {
    const nextBegin = text.indexOf(beginToken, cursor);
    const nextEnd = text.indexOf(endToken, cursor);
    if (nextEnd < 0 || nextEnd >= limit) return null;
    if (nextBegin >= 0 && nextBegin < nextEnd) {
      if (!isEscaped(text, nextBegin)) depth++;
      cursor = nextBegin + beginToken.length;
    } else {
      if (!isEscaped(text, nextEnd) && --depth === 0) return nextEnd;
      cursor = nextEnd + endToken.length;
    }
  }
  return null;
}

function displayMathAt(
  text: string,
  offset: number,
  windowStart: number,
  windowEnd: number,
): EnclosingMath | null {
  const expressions = scanMathExpressions(text, {
    format: "latex",
    from: windowStart,
    to: windowEnd,
  });
  for (const expression of expressions) {
    if (
      expression.display &&
      expression.status === "complete" &&
      expression.from <= offset &&
      offset <= expression.to
    ) {
      return { body: expression.body, environment: "display" };
    }
  }
  return null;
}

export function enclosingMathEnvironment(
  text: string,
  offset: number,
  radius = DEFAULT_RADIUS,
): EnclosingMath | null {
  try {
    if (typeof text !== "string" || !Number.isFinite(offset)) return null;
    const at = Math.max(0, Math.min(offset, text.length));
    const windowStart = Math.max(0, at - radius);
    const windowEnd = Math.min(text.length, at + radius);

    const begin = findUnclosedBegin(text, at, windowStart);
    if (begin) {
      const endAt = findMatchingEnd(text, begin.env, begin.bodyFrom, windowEnd);
      if (endAt === null) return null;
      return { body: text.slice(begin.bodyFrom, endAt), environment: begin.env };
    }

    return displayMathAt(text, at, windowStart, windowEnd);
  } catch {
    return null;
  }
}
