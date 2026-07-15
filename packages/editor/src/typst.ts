import { LanguageSupport, StreamLanguage, type StreamParser } from "@codemirror/language";

interface TypstState {
  blockComment: boolean;
  rawFence: number;
}

const typstMode: StreamParser<TypstState> = {
  startState: () => ({ blockComment: false, rawFence: 0 }),
  token(stream, state) {
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
    if (state.blockComment) {
      if (stream.skipTo("*/")) {
        stream.match("*/");
        state.blockComment = false;
      } else {
        stream.skipToEnd();
      }
      return "comment";
    }
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.blockComment = true;
      return "comment";
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
    if (stream.sol() && stream.match(/^=+(?=[ \t])/)) return "heading";
    if (stream.match(/^[-+](?=\s)/) || stream.match(/^\d+[.)](?=\s)/)) return "list";
    if (stream.match(/^#(?:let|set|show|import|include|if|else|for|while|return|context)\b/)) {
      return "keyword";
    }
    if (stream.match(/^#[A-Za-z_][\w-]*/)) return "variableName.function";
    if (stream.match(/^<[^>\n]+>/)) return "labelName";
    if (stream.match(/^@[\w:-]+/)) return "link";
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.match(/^\$[^$\n]*\$?/)) return "special(string)";
    if (stream.match(/^(?:true|false|none|auto)\b/)) return "bool";
    if (stream.match(/^\d+(?:\.\d+)?(?:pt|mm|cm|in|em|fr|%|deg)?\b/)) return "number";
    stream.next();
    return null;
  },
};

export function typstLanguage(): LanguageSupport {
  return new LanguageSupport(StreamLanguage.define(typstMode));
}
