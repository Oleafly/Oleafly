import type { JSONContent } from "@tiptap/core";

export const MATH_DISPLAY_ENVIRONMENTS = [
  "equation",
  "equation*",
  "align",
  "align*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "eqnarray",
  "eqnarray*",
  "displaymath",
] as const;

export type MathDisplayEnvironment = (typeof MATH_DISPLAY_ENVIRONMENTS)[number];

export interface MathSourceParts {
  open: string;
  body: string;
  close: string;
  display: boolean;
  environment: MathDisplayEnvironment | null;
}

const DISPLAY_ENVIRONMENT_SET = new Set<string>(MATH_DISPLAY_ENVIRONMENTS);
const KATEX_ENVIRONMENTS = new Set<string>([
  "equation",
  "equation*",
  "align",
  "align*",
  "gather",
  "gather*",
]);

function delimitedParts(source: string, open: string, close: string, display: boolean): MathSourceParts | null {
  if (!source.startsWith(open) || !source.endsWith(close)) return null;
  if (source.length < open.length + close.length) return null;
  return {
    open,
    close,
    display,
    environment: null,
    body: source.slice(open.length, source.length - close.length),
  };
}

function environmentParts(source: string): MathSourceParts | null {
  const match = /^\\begin\{([a-z]+\*?)\}/u.exec(source);
  if (!match || !DISPLAY_ENVIRONMENT_SET.has(match[1])) return null;
  const close = String.raw`\end{${match[1]}}`;
  if (!source.endsWith(close)) return null;
  return {
    open: match[0],
    close,
    display: true,
    environment: match[1] as MathDisplayEnvironment,
    body: source.slice(match[0].length, source.length - close.length),
  };
}

function dollarParts(source: string): MathSourceParts | null {
  if (source.startsWith("$$")) {
    const parts = delimitedParts(source, "$$", "$$", true);
    return parts && parts.body.length > 0 && !parts.body.includes("$$") ? parts : null;
  }
  const parts = delimitedParts(source, "$", "$", false);
  if (!parts || parts.body.length === 0) return null;
  let escaped = false;
  for (const character of parts.body) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") escaped = true;
    else if (character === "$") return null;
  }
  return escaped ? null : parts;
}

export function splitMathSource(source: string): MathSourceParts | null {
  const trimmed = source.trim();
  if (trimmed !== source || trimmed.length === 0) return null;
  if (trimmed.startsWith("$")) return dollarParts(trimmed);
  if (trimmed.startsWith(String.raw`\(`)) return delimitedParts(trimmed, String.raw`\(`, String.raw`\)`, false);
  if (trimmed.startsWith(String.raw`\[`)) return delimitedParts(trimmed, String.raw`\[`, String.raw`\]`, true);
  return environmentParts(trimmed);
}

export function isDisplayMathSource(source: string): boolean {
  return splitMathSource(source)?.display === true;
}

export function mathRenderInput(source: string): { body: string; display: boolean } | null {
  const parts = splitMathSource(source);
  if (!parts) return null;
  const body = parts.body.replace(/\\label\{[^{}]*\}/gu, "");
  if (parts.environment === null) return { body, display: parts.display };
  if (KATEX_ENVIRONMENTS.has(parts.environment)) {
    return { body: `${parts.open}${body}${parts.close}`, display: true };
  }
  if (parts.environment.startsWith("multline")) {
    return { body: String.raw`\begin{gathered}${body}\end{gathered}`, display: true };
  }
  if (parts.environment.startsWith("eqnarray")) {
    return { body: String.raw`\begin{array}{rcl}${body}\end{array}`, display: true };
  }
  return { body, display: true };
}

export function mathNodeJSON(source: string): JSONContent | null {
  const parts = splitMathSource(source);
  if (!parts) return null;
  return { type: parts.display ? "mathDisplay" : "mathInline", attrs: { source } };
}
