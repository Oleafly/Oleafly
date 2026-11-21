import { matchingBrace } from "@oleafly/latex";
import { maskComments } from "../mask";

export interface MacroText {
  readonly name: string;
  readonly text: string;
  readonly spacing: "xspace" | "plain";
}

const COMMAND_DEFINITION = /\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand)\*?\s*(?:\{\s*\\([A-Za-z]+)\s*\}|\\([A-Za-z]+))/g;
const DEF_DEFINITION = /\\def\s*\\([A-Za-z]+)(?=\s*\{)/g;
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9 .+'-]*[A-Za-z0-9.+']$|^[A-Za-z0-9]$/;

function plainText(body: string): { text: string; spacing: MacroText["spacing"] } | null {
  const spacing = /\\(?:xspace|onedot|@onedot)\b/.test(body) ? "xspace" : "plain";
  const text = body
    .replace(/\\(?:emph|textit|textrm|textup|textnormal|mbox|textsc|textbf)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\(?:@onedot|onedot)\b/g, ".")
    .replace(/\\xspace\b|\\@|\{\}|\\ /g, "")
    .replaceAll("~", " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 2 || text.length > 60 || !PLAIN.test(text) || !/[A-Za-z]/.test(text)) return null;
  const distinctive = /[A-Z0-9.+-]/.test(text) || text.includes(" ");
  return distinctive ? { text, spacing } : null;
}

interface Definition {
  readonly index: number;
  readonly end: number;
  readonly name: string;
}

function findDefinition(pattern: RegExp, text: string, from: number): Definition | null {
  pattern.lastIndex = from;
  const match = pattern.exec(text);
  return match ? { index: match.index, end: match.index + match[0].length, name: match[1] ?? match[2] } : null;
}

interface DefinitionScan {
  command: Definition | null | undefined;
  plain: Definition | null | undefined;
}

function definitionFrom(known: Definition | null | undefined, pattern: RegExp, text: string, from: number): Definition | null {
  if (known === null) return null;
  if (known && known.index >= from) return known;
  return findDefinition(pattern, text, from);
}

function nextDefinition(text: string, from: number, scan: DefinitionScan): Definition | null {
  scan.command = definitionFrom(scan.command, COMMAND_DEFINITION, text, from);
  scan.plain = definitionFrom(scan.plain, DEF_DEFINITION, text, from);
  const { command, plain } = scan;
  if (command && plain) return plain.index < command.index ? plain : command;
  return command ?? plain;
}

function skipBlanks(text: string, from: number): number {
  let at = from;
  while (text[at] === " " || text[at] === "\t") at += 1;
  return at;
}

function collectFromText(text: string, found: Map<string, MacroText>): void {
  const scan: DefinitionScan = { command: undefined, plain: undefined };
  let definition = nextDefinition(text, 0, scan);
  while (definition) {
    let resume = definition.end;
    const at = skipBlanks(text, definition.end);
    const close = text[at] === "{" ? matchingBrace(text, at) : -1;
    if (close >= 0) {
      const body = plainText(text.slice(at + 1, close));
      resume = close + 1;
      if (body && !found.has(definition.name)) found.set(definition.name, { name: definition.name, ...body });
    }
    definition = nextDefinition(text, resume, scan);
  }
}

export function collectMacroTexts(texts: readonly string[]): MacroText[] {
  const found = new Map<string, MacroText>();
  for (const raw of texts) collectFromText(maskComments(raw), found);
  return [...found.values()];
}
