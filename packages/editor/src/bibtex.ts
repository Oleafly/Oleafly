import { LanguageSupport, StreamLanguage, type StreamParser } from "@codemirror/language";

type Mode = "top" | "afterType" | "key" | "fieldName" | "eq" | "value" | "quoteString" | "braceString" | "afterValue";

interface BibtexState {
  mode: Mode;
  braceDepth: number;
}

const bibtexParser: StreamParser<BibtexState> = {
  startState: () => ({ mode: "top", braceDepth: 0 }),
  token(stream, state) {
    if (state.mode !== "quoteString" && state.mode !== "braceString") {
      if (stream.eatSpace()) return null;
      if (stream.match("%")) {
        stream.skipToEnd();
        return "comment";
      }
    }

    switch (state.mode) {
      case "top": {
        if (stream.match(/^@[a-zA-Z]+/)) {
          state.mode = "afterType";
          return "keyword";
        }
        stream.next();
        return null;
      }
      case "afterType": {
        const ch = stream.next();
        if (ch === "{" || ch === "(") {
          state.mode = "key";
          return "bracket";
        }
        return null;
      }
      case "key": {
        if (stream.match(/^[^,{}()]+/)) {
          state.mode = "fieldName";
          return "variableName";
        }
        if (stream.peek() === ",") {
          stream.next();
          state.mode = "fieldName";
          return null;
        }
        const ch = stream.next();
        if (ch === "}" || ch === ")") state.mode = "top";
        return ch === "}" || ch === ")" ? "bracket" : null;
      }
      case "fieldName": {
        if (stream.match(/^[a-zA-Z][a-zA-Z0-9_-]*/)) {
          state.mode = "eq";
          return "tagName";
        }
        const ch = stream.next();
        if (ch === "}" || ch === ")") {
          state.mode = "top";
          return "bracket";
        }
        return null;
      }
      case "eq": {
        const ch = stream.next();
        if (ch === "=") {
          state.mode = "value";
          return "operator";
        }
        if (ch === "}" || ch === ")") {
          state.mode = "top";
          return "bracket";
        }
        if (ch === ",") state.mode = "fieldName";
        return null;
      }
      case "value": {
        if (stream.eat('"')) {
          state.mode = "quoteString";
          return "string";
        }
        if (stream.eat("{")) {
          state.mode = "braceString";
          state.braceDepth = 1;
          return "string";
        }
        if (stream.match(/^[^,{}()]+/)) {
          state.mode = "afterValue";
          return "number";
        }
        const ch = stream.next();
        if (ch === "}" || ch === ")") state.mode = "top";
        return ch === "}" || ch === ")" ? "bracket" : null;
      }
      case "quoteString": {
        while (!stream.eol()) {
          if (stream.next() === '"') {
            state.mode = "afterValue";
            break;
          }
        }
        return "string";
      }
      case "braceString": {
        while (!stream.eol()) {
          const ch = stream.next();
          if (ch === "{") state.braceDepth++;
          else if (ch === "}") {
            state.braceDepth--;
            if (state.braceDepth === 0) {
              state.mode = "afterValue";
              break;
            }
          }
        }
        return "string";
      }
      case "afterValue": {
        const ch = stream.next();
        if (ch === ",") {
          state.mode = "fieldName";
          return null;
        }
        if (ch === "}" || ch === ")") {
          state.mode = "top";
          return "bracket";
        }
        return null;
      }
      default:
        stream.next();
        return null;
    }
  },
};

export const bibtexLanguage = () => new LanguageSupport(StreamLanguage.define(bibtexParser));
