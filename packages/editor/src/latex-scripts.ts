import type { EditorState, Extension } from "@codemirror/state";
import {
  inLatexIgnoredRegion,
  latexMaskedSlice,
  mathContextAt,
} from "./latex-lexical";
import {
  escapedIn,
  isScriptDigit,
  isScriptLetter,
  isScriptSign,
  scriptGroups,
  type ScriptMark,
} from "./script-groups";

const TEXT_ARGUMENTS: ReadonlySet<string> = new Set([
  "emph",
  "mbox",
  "hbox",
  "fbox",
  "makebox",
  "framebox",
  "intertext",
  "shortintertext",
  "label",
  "tag",
  "url",
  "href",
  "begin",
  "end",
  "color",
  "colorbox",
  "fcolorbox",
]);

const COMMAND_BEFORE_GROUP = /\\([A-Za-z@]+)\*?\s*$/u;

const COMMAND_WINDOW = 64;

const ARGUMENT_SCAN_LIMIT = 1024;

const TRANSPOSE_LETTERS: ReadonlySet<string> = new Set(["T", "H"]);

function textArgumentCommand(command: string): boolean {
  const name = command.toLowerCase();
  return (
    TEXT_ARGUMENTS.has(name) ||
    name.startsWith("text") ||
    name.endsWith("ref") ||
    name.includes("cite")
  );
}

function latexTextArgumentOpen(text: string): boolean {
  let depth = 0;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const character = text[index];
    if (character !== "{" && character !== "}") continue;
    if (escapedIn(text, index)) continue;
    if (character === "}") {
      depth += 1;
      continue;
    }
    if (depth > 0) {
      depth -= 1;
      continue;
    }
    const command = COMMAND_BEFORE_GROUP.exec(
      text.slice(Math.max(0, index - COMMAND_WINDOW), index),
    )?.[1];
    return command !== undefined && textArgumentCommand(command);
  }
  return false;
}

function latexStartsGroup(
  mark: ScriptMark,
  first: string,
  next: string,
): boolean {
  if (isScriptSign(first)) return isScriptDigit(next) || isScriptLetter(next);
  if (isScriptDigit(first)) return isScriptDigit(next);
  if (!isScriptLetter(first)) return false;
  if (mark === "^" && TRANSPOSE_LETTERS.has(first)) return false;
  return isScriptDigit(next) || isScriptLetter(next);
}

function latexScriptAt(state: EditorState, at: number): boolean {
  if (inLatexIgnoredRegion(state, at)) return false;
  const math = mathContextAt(state, at);
  if (math.from === null) return false;
  const from = Math.max(math.from + math.width, at - ARGUMENT_SCAN_LIMIT);
  return !latexTextArgumentOpen(latexMaskedSlice(state, from, at));
}

export function latexScriptGroups(): Extension {
  return scriptGroups({
    open: "{",
    close: "}",
    startsGroup: latexStartsGroup,
    scriptAt: latexScriptAt,
  });
}
