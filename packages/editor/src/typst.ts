import {
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
  type StringStream,
} from "@codemirror/language";

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

const typstMode: StreamParser<TypstState> = {
  startState: () => ({
    blockCommentDepth: 0,
    rawFence: 0,
    headingLine: false,
  }),
  token(stream, state) {
    if (stream.sol()) state.headingLine = false;
    if (state.rawFence > 0) {
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
    if (state.blockCommentDepth > 0) {
      return consumeBlockComment(stream, state);
    }
    if (state.headingLine) {
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
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.blockCommentDepth = 1;
      return consumeBlockComment(stream, state);
    }
    if (stream.peek() === "`") {
      let ticks = 0;
      while (stream.peek() === "`") {
        stream.next();
        ticks += 1;
      }
      state.rawFence = ticks;
      return "string";
    }
    if (stream.sol() && stream.match(/^=+(?=[ \t])/)) {
      state.headingLine = true;
      return "heading";
    }
    if (stream.match(/^[-+](?=\s)/) || stream.match(/^\d+[.)](?=\s)/)) return "list";
    if (stream.match(/^#(?:let|set|show|import|include|if|else|for|while|return|context)\b/)) {
      return "keyword";
    }
    if (stream.match(/^#[A-Za-z_][\w-]*/)) return "variableName.function";
    if (stream.match(/^<[^>\n]+>/)) return "labelName";
    if (stream.match(/^@[\w:-]+/)) return "link";
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.match(/^\$[^$\n]*\$?/)) return "string-2";
    if (stream.match(/^(?:true|false|none|auto)\b/)) return "bool";
    if (stream.match(/^\d+(?:\.\d+)?(?:pt|mm|cm|in|em|fr|%|deg)?\b/)) return "number";
    stream.next();
    return null;
  },
};

export function typstLanguage(): LanguageSupport {
  return new LanguageSupport(StreamLanguage.define(typstMode));
}
