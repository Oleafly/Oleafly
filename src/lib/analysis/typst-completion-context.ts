export type TypstSyntaxMode = "markup" | "code" | "math";

export interface TypstCursorContext {
  mode: TypstSyntaxMode;
  inString: boolean;
  inComment: boolean;
  inRaw: boolean;
  inArguments: boolean;
}

export interface TypstCompletionTrigger {
  triggerKind: 1 | 2;
  triggerCharacter?: string;
}

type Frame =
  | { kind: "markup"; close: "]" | null }
  | { kind: "code"; close: "}" | ")" | null }
  | { kind: "expr" }
  | { kind: "math" };

const SCAN_WINDOW = 20_000;
const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}_-]/u;
const LINE_KEYWORDS = new Set([
  "let",
  "set",
  "show",
  "import",
  "include",
  "if",
  "for",
  "while",
  "context",
  "return",
  "break",
  "continue",
]);
const INVOKED: TypstCompletionTrigger = Object.freeze({ triggerKind: 1 });
const PATH_CALL_STRING =
  /\b(?:image|read|json|yaml|toml|csv|xml|cbor|bibliography|plugin)\s*\(\s*"[^"\n]*$/u;
const PATH_KEYWORD_STRING = /\b(?:include|import)\s+"[^"\n]*$/u;
const IMPORT_ITEMS = /\bimport\s+"[^"\n]*"\s*:$/u;

interface ScanState {
  text: string;
  index: number;
  stack: Frame[];
  inString: boolean;
  inComment: boolean;
  inRaw: boolean;
}

const ROOT_FRAME: Frame = Object.freeze({ kind: "markup", close: null });

const CODE_OPENERS: Readonly<Record<string, Frame>> = {
  "{": { kind: "code", close: "}" },
  "(": { kind: "code", close: ")" },
  "[": { kind: "markup", close: "]" },
};

function top(state: ScanState): Frame {
  return state.stack.at(-1) ?? ROOT_FRAME;
}

function isIdentStart(char: string | undefined): boolean {
  return char !== undefined && IDENT_START.test(char);
}

function isIdentPart(char: string | undefined): boolean {
  return char !== undefined && IDENT_PART.test(char);
}

function readIdent(state: ScanState): string {
  const start = state.index;
  while (isIdentPart(state.text[state.index])) state.index += 1;
  return state.text.slice(start, state.index);
}

function skipLineComment(state: ScanState): void {
  const end = state.text.indexOf("\n", state.index);
  if (end < 0) {
    state.index = state.text.length;
    state.inComment = true;
    return;
  }
  state.index = end;
}

function skipBlockComment(state: ScanState): void {
  let depth = 1;
  state.index += 2;
  while (state.index < state.text.length) {
    if (state.text.startsWith("/*", state.index)) {
      depth += 1;
      state.index += 2;
      continue;
    }
    if (state.text.startsWith("*/", state.index)) {
      depth -= 1;
      state.index += 2;
      if (depth === 0) return;
      continue;
    }
    state.index += 1;
  }
  state.inComment = true;
}

function skipComment(state: ScanState, markup: boolean): boolean {
  const { text, index } = state;
  if (text[index] !== "/") return false;
  if (text[index + 1] === "/") {
    if (markup && /https?:$/u.test(text.slice(Math.max(0, index - 6), index))) {
      return false;
    }
    skipLineComment(state);
    return true;
  }
  if (text[index + 1] === "*") {
    skipBlockComment(state);
    return true;
  }
  return false;
}

function skipString(state: ScanState): void {
  state.index += 1;
  while (state.index < state.text.length) {
    const char = state.text[state.index];
    if (char === "\\") {
      state.index += 2;
      continue;
    }
    if (char === "\"") {
      state.index += 1;
      return;
    }
    if (char === "\n") return;
    state.index += 1;
  }
  state.inString = true;
}

function skipRaw(state: ScanState): void {
  let ticks = 0;
  while (state.text[state.index] === "`") {
    ticks += 1;
    state.index += 1;
  }
  if (ticks === 2) return;
  const fence = "`".repeat(ticks);
  const end = state.text.indexOf(fence, state.index);
  if (end < 0) {
    state.index = state.text.length;
    state.inRaw = true;
    return;
  }
  state.index = end + ticks;
}

function startEmbeddedCode(state: ScanState): void {
  const next = state.text[state.index + 1];
  if (isIdentStart(next)) {
    state.index += 1;
    const ident = readIdent(state);
    state.stack.push(
      LINE_KEYWORDS.has(ident)
        ? { kind: "code", close: null }
        : { kind: "expr" },
    );
    return;
  }
  const opener = CODE_OPENERS[next];
  if (opener) {
    state.index += 2;
    state.stack.push({ kind: "expr" }, { ...opener });
    return;
  }
  state.index += 1;
}

function stepMarkup(
  state: ScanState,
  frame: Extract<Frame, { kind: "markup" }>,
): void {
  const char = state.text[state.index];
  if (char === "\\") {
    state.index += 2;
    return;
  }
  if (char === "`") {
    skipRaw(state);
    return;
  }
  if (skipComment(state, true)) return;
  if (char === "$") {
    state.index += 1;
    state.stack.push({ kind: "math" });
    return;
  }
  if (char === "#") {
    startEmbeddedCode(state);
    return;
  }
  if (char === "]" && frame.close === "]") {
    state.stack.pop();
  }
  state.index += 1;
}

function stepExpression(state: ScanState): void {
  const char = state.text[state.index];
  const next = state.text[state.index + 1];
  if (char === "." && (isIdentStart(next) || next === undefined)) {
    state.index += 1;
    readIdent(state);
    return;
  }
  if (char === "(") {
    state.index += 1;
    state.stack.push({ kind: "code", close: ")" });
    return;
  }
  if (char === "[") {
    state.index += 1;
    state.stack.push({ kind: "markup", close: "]" });
    return;
  }
  state.stack.pop();
}

function stepMath(state: ScanState): void {
  const char = state.text[state.index];
  if (char === "\\") {
    state.index += 2;
    return;
  }
  if (char === "\"") {
    skipString(state);
    return;
  }
  if (skipComment(state, false)) return;
  if (char === "#") {
    startEmbeddedCode(state);
    return;
  }
  if (char === "$") state.stack.pop();
  state.index += 1;
}

function stepCode(
  state: ScanState,
  frame: Extract<Frame, { kind: "code" }>,
): void {
  const char = state.text[state.index];
  if (char === "\"") {
    skipString(state);
    return;
  }
  if (skipComment(state, false)) return;
  const opener = CODE_OPENERS[char];
  if (opener) {
    state.index += 1;
    state.stack.push({ ...opener });
    return;
  }
  if (char === "$") {
    state.index += 1;
    state.stack.push({ kind: "math" });
    return;
  }
  const closes = (char === "}" || char === ")") && frame.close === char;
  const endsStatement = frame.close === null && (char === "\n" || char === ";");
  if (closes || endsStatement) state.stack.pop();
  state.index += 1;
}

function step(state: ScanState): void {
  const frame = top(state);
  if (frame.kind === "markup") stepMarkup(state, frame);
  else if (frame.kind === "expr") stepExpression(state);
  else if (frame.kind === "math") stepMath(state);
  else stepCode(state, frame);
}

function frameMode(frame: Frame): TypstSyntaxMode {
  if (frame.kind === "markup" || frame.kind === "math") return frame.kind;
  return "code";
}

export function typstCursorContext(before: string): TypstCursorContext {
  let start = Math.max(0, before.length - SCAN_WINDOW);
  if (start > 0) {
    const lineStart = before.indexOf("\n", start);
    start = lineStart < 0 ? before.length : lineStart + 1;
  }
  const state: ScanState = {
    text: before.slice(start),
    index: 0,
    stack: [{ kind: "markup", close: null }],
    inString: false,
    inComment: false,
    inRaw: false,
  };
  while (state.index < state.text.length) {
    state.inString = false;
    state.inComment = false;
    state.inRaw = false;
    if (state.stack.length === 0) {
      state.stack.push({ kind: "markup", close: null });
    }
    step(state);
  }
  if (state.stack.length === 0) {
    state.stack.push({ kind: "markup", close: null });
  }
  const frame = top(state);
  return {
    mode: frameMode(frame),
    inString: state.inString,
    inComment: state.inComment,
    inRaw: state.inRaw,
    inArguments: frame.kind === "code" && frame.close === ")",
  };
}

function triggerFor(
  char: string,
  serverTriggers: readonly string[],
): TypstCompletionTrigger {
  return serverTriggers.includes(char)
    ? { triggerKind: 2, triggerCharacter: char }
    : INVOKED;
}

function markupTrigger(
  before: string,
  serverTriggers: readonly string[],
): TypstCompletionTrigger | null {
  const last = before.at(-1);
  if (last === "#" && before.at(-2) !== "\\") {
    return triggerFor("#", serverTriggers);
  }
  const reference = /(?:^|[^\p{L}\p{N}_\\])([@<])[\p{L}\p{N}_:.-]*$/u.exec(
    before,
  );
  if (!reference) return null;
  return last === reference[1]
    ? triggerFor(reference[1], serverTriggers)
    : INVOKED;
}

function charBefore(text: string, end: number): string {
  if (end >= 2 && (text.codePointAt(end - 2) ?? 0) > 0xffff) {
    return text.slice(end - 2, end);
  }
  return text.slice(end - 1, end);
}

function identifierEndsAt(text: string, end: number): boolean {
  let index = end;
  while (index > 0) {
    const char = charBefore(text, index);
    if (!isIdentPart(char)) return false;
    if (isIdentStart(char)) return true;
    index -= char.length;
  }
  return false;
}

function fieldAccessDot(before: string): boolean {
  const owner = before.at(-2);
  return owner === ")" || owner === "]" || identifierEndsAt(before, before.length - 1);
}

function codeTrigger(
  before: string,
  context: TypstCursorContext,
  serverTriggers: readonly string[],
): TypstCompletionTrigger | null {
  const last = before.at(-1) ?? "";
  if (/(?:^|[^\p{L}\p{N}_-])[\p{L}_][\p{L}\p{N}_-]*$/u.test(before)) {
    return INVOKED;
  }
  if (last === ".") {
    return fieldAccessDot(before) ? triggerFor(".", serverTriggers) : null;
  }
  if (last === "(") return triggerFor("(", serverTriggers);
  if (last === "," && context.inArguments) {
    return triggerFor(",", serverTriggers);
  }
  if (last === ":") {
    if (
      (context.inArguments && identifierEndsAt(before, before.length - 1)) ||
      IMPORT_ITEMS.test(before)
    ) {
      return triggerFor(":", serverTriggers);
    }
  }
  return null;
}

function mathTrigger(
  before: string,
  serverTriggers: readonly string[],
): TypstCompletionTrigger | null {
  const last = before.at(-1) ?? "";
  if (last === "#") return triggerFor("#", serverTriggers);
  if (!/(?:^|[^\p{L}\p{N}])\p{L}[\p{L}\p{N}]*(?:\.[\p{L}\p{N}]*)*$/u.test(before)) {
    return null;
  }
  return last === "." ? triggerFor(".", serverTriggers) : INVOKED;
}

function stringTrigger(
  before: string,
  explicit: boolean,
  serverTriggers: readonly string[],
): TypstCompletionTrigger | null {
  if (!PATH_CALL_STRING.test(before) && !PATH_KEYWORD_STRING.test(before)) {
    return explicit ? INVOKED : null;
  }
  if (explicit) return INVOKED;
  const last = before.at(-1) ?? "";
  return last === "\"" || last === "/"
    ? triggerFor(last, serverTriggers)
    : INVOKED;
}

export function typstCompletionTrigger(
  before: string,
  explicit: boolean,
  serverTriggers: readonly string[],
): TypstCompletionTrigger | null {
  const context = typstCursorContext(before);
  if (context.inComment || context.inRaw) return explicit ? INVOKED : null;
  if (context.inString) return stringTrigger(before, explicit, serverTriggers);
  if (explicit) return INVOKED;
  if (context.mode === "markup") return markupTrigger(before, serverTriggers);
  if (context.mode === "math") return mathTrigger(before, serverTriggers);
  return codeTrigger(before, context, serverTriggers);
}
