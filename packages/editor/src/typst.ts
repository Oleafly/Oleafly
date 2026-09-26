import {
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
  type StringStream,
} from "@codemirror/language";
import {
  TYPST_IDENTIFIER_END_PATTERN,
  TYPST_IDENTIFIER_PATTERN,
  TYPST_NUMBER_END_PATTERN,
  typstAutolinkEnd,
  typstReferenceEnd,
} from "./typst-syntax";

interface TypstState {
  blockCommentDepth: number;
  rawFence: number;
  headingLine: boolean;
}

function consumeBlockComment(
  stream: StringStream,
  state: TypstState,
): string {
  while (!stream.eol()) {
    if (stream.match("/*")) {
      state.blockCommentDepth += 1;
      continue;
    }
    if (stream.match("*/")) {
      state.blockCommentDepth -= 1;
      if (state.blockCommentDepth === 0) break;
      continue;
    }
    stream.next();
  }
  return "comment";
}

function consumeRawFence(stream: StringStream, state: TypstState): string {
  const fence = "`".repeat(state.rawFence);
  if (stream.match(fence)) {
    state.rawFence = 0;
    return "string";
  }
  if (stream.skipTo(fence)) {
    stream.match(fence);
    state.rawFence = 0;
  } else {
    stream.skipToEnd();
  }
  return "string";
}

function consumeHeadingLine(stream: StringStream, state: TypstState): string {
  if (stream.match(/^<[^>\n]+>/)) {
    state.headingLine = false;
    return "labelName";
  }
  if (stream.match(/^.+?(?=<[^>\n]+>(?:\s|$))/)) {
    return "heading";
  }
  stream.skipToEnd();
  state.headingLine = false;
  return "heading";
}

function consumeRawFenceOpener(
  stream: StringStream,
  state: TypstState,
): string {
  let ticks = 0;
  while (stream.peek() === "`") {
    stream.next();
    ticks += 1;
  }
  state.rawFence = ticks;
  return "string";
}

const TYPST_TOKEN_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [
    new RegExp(
      `^#(?:let|set|show|import|include|if|else|for|while|return|context)${TYPST_IDENTIFIER_END_PATTERN}`,
      "u",
    ),
    "keyword",
  ],
  [new RegExp(`^#${TYPST_IDENTIFIER_PATTERN}`, "u"), "variableName.function"],
  [/^<[^>\n]+>/, "labelName"],
  [/^"(?:[^"\\]|\\.)*"?/, "string"],
  [/^\$[^$\n]*\$?/, "string-2"],
  [
    new RegExp(`^(?:true|false|none|auto)${TYPST_IDENTIFIER_END_PATTERN}`, "u"),
    "bool",
  ],
  [
    new RegExp(
      `^\\d+(?:\\.\\d+)?(?:pt|mm|cm|in|em|fr|%|deg)?${TYPST_NUMBER_END_PATTERN}`,
      "u",
    ),
    "number",
  ],
];

function atLineContentStart(stream: StringStream): boolean {
  return stream.string.slice(0, stream.pos).trim() === "";
}

function typstReferenceToken(stream: StringStream): boolean {
  if (stream.peek() !== "@") return false;
  const end = typstReferenceEnd(stream.string, stream.pos + 1);
  if (end === stream.pos + 1) return false;
  stream.pos = end;
  return true;
}

function typstPatternToken(stream: StringStream): string | null {
  if (typstReferenceToken(stream)) return "link";
  for (const [pattern, tag] of TYPST_TOKEN_PATTERNS) {
    if (stream.match(pattern)) return tag;
  }
  return null;
}

const typstMode: StreamParser<TypstState> = {
  startState: () => ({
    blockCommentDepth: 0,
    rawFence: 0,
    headingLine: false,
  }),
  token(stream, state) {
    if (stream.sol()) state.headingLine = false;
    if (state.rawFence > 0) return consumeRawFence(stream, state);
    if (state.blockCommentDepth > 0) {
      return consumeBlockComment(stream, state);
    }
    if (state.headingLine) return consumeHeadingLine(stream, state);
    if (stream.match(/^\\(?:u\{[\dA-Fa-f]*\}?|.)?/u)) return "escape";
    const link = typstAutolinkEnd(stream.string, stream.pos);
    if (link !== null) {
      stream.pos = link;
      return "url";
    }
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.blockCommentDepth = 1;
      return consumeBlockComment(stream, state);
    }
    if (stream.peek() === "`") return consumeRawFenceOpener(stream, state);
    if (stream.sol() && stream.match(/^=+(?=[ \t])/)) {
      state.headingLine = true;
      return "heading";
    }
    if (
      atLineContentStart(stream) &&
      (stream.match(/^[-+](?=\s)/) || stream.match(/^\d+\.(?=\s)/))
    ) {
      return "list";
    }
    const tag = typstPatternToken(stream);
    if (tag) return tag;
    stream.next();
    return null;
  },
};

export function typstLanguage(): LanguageSupport {
  return new LanguageSupport(StreamLanguage.define(typstMode));
}
