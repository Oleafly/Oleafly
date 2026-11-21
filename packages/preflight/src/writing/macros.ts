import { matchingBrace } from "@oleafly/latex";
import { maskComments } from "../mask";

export interface MacroText {
  readonly name: string;
  readonly text: string;
  readonly spacing: "xspace" | "plain";
}

const DEFINITION = /\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand)\*?\s*(?:\{\s*\\([A-Za-z]+)\s*\}|\\([A-Za-z]+))|\\def\s*\\([A-Za-z]+)(?=\s*\{)/g;
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9 .+'-]*[A-Za-z0-9.+']$|^[A-Za-z0-9]$/;

function plainText(body: string): { text: string; spacing: MacroText["spacing"] } | null {
  const spacing = /\\(?:xspace|onedot|@onedot)\b/.test(body) ? "xspace" : "plain";
  const text = body
    .replace(/\\(?:emph|textit|textrm|textup|textnormal|mbox|textsc|textbf)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\(?:@onedot|onedot)\b/g, ".")
    .replace(/\\xspace\b|\\@|\{\}|\\ /g, "")
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 2 || text.length > 60 || !PLAIN.test(text) || !/[A-Za-z]/.test(text)) return null;
  const distinctive = /[A-Z0-9.+-]/.test(text) || text.includes(" ");
  return distinctive ? { text, spacing } : null;
}

export function collectMacroTexts(texts: readonly string[]): MacroText[] {
  const found = new Map<string, MacroText>();
  for (const raw of texts) {
    const text = maskComments(raw);
    DEFINITION.lastIndex = 0;
    for (let match = DEFINITION.exec(text); match; match = DEFINITION.exec(text)) {
      const name = match[1] ?? match[2] ?? match[3];
      let at = match.index + match[0].length;
      while (text[at] === " " || text[at] === "\t") at += 1;
      if (text[at] === "[") continue;
      if (text[at] !== "{") continue;
      const close = matchingBrace(text, at);
      if (close < 0) continue;
      const body = plainText(text.slice(at + 1, close));
      DEFINITION.lastIndex = close + 1;
      if (body && !found.has(name)) found.set(name, { name, ...body });
    }
  }
  return [...found.values()];
}
