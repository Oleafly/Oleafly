import { LanguageSupport, StreamLanguage, type StreamParser } from "@codemirror/language";

type Mode =
  | "top"
  | "afterType"
  | "key"
  | "fieldName"
  | "eq"
  | "value"
  | "quoteString"
  | "braceString"
  | "afterValue"
  | "commentBody";

type Directive = "entry" | "string" | "preamble" | "comment";

interface BibtexState {
  mode: Mode;
  braceDepth: number;
  directive: Directive;
  entryOpen: "{" | "(";
}

const bibtexParser: StreamParser<BibtexState> = {
  startState: () => ({
    mode: "top",
    braceDepth: 0,
    directive: "entry",
    entryOpen: "{",
  }),
  token(stream, state) {
    // A malformed/unclosed entry must not color every later entry as a string.
    // BibTeX entries begin at a line boundary in the supported corpus, so a
    // complete entry opener is a safe recovery point without hiding the damage
    // that the recoverable BibTeX linter reports.
    if (
      state.mode !== "top" &&
      stream.sol() &&
      stream.match(/^\s*@[a-zA-Z]+\s*[{(]/, false)
    ) {
      state.mode = "top";
      state.braceDepth = 0;
      state.directive = "entry";
    }

    if (state.mode !== "quoteString" && state.mode !== "braceString") {
      if (stream.eatSpace()) return null;
      if (stream.match("%")) {
        stream.skipToEnd();
        return "comment";
      }
    }

    switch (state.mode) {
      case "top": {
        const match = stream.match(/^@([a-zA-Z]+)/);
        if (match) {
          const name =
            typeof match === "boolean"
              ? ""
              : (match[1] ?? "").toLowerCase();
          state.directive =
            name === "string" ||
            name === "preamble" ||
            name === "comment"
              ? name
              : "entry";
          state.mode = "afterType";
          return state.directive === "comment"
            ? "comment"
            : "keyword";
        }
        stream.next();
        return null;
      }
      case "afterType": {
        const ch = stream.next();
        if (ch === "{" || ch === "(") {
          state.entryOpen = ch;
          if (state.directive === "comment") {
            state.mode = "commentBody";
            state.braceDepth = 1;
          } else if (state.directive === "string") {
            state.mode = "fieldName";
          } else if (state.directive === "preamble") {
            state.mode = "value";
          } else {
            state.mode = "key";
          }
          return state.directive === "comment"
            ? "comment"
            : "bracket";
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
          return "property";
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
        if (stream.match(/^\d+/)) {
          state.mode = "afterValue";
          return "number";
        }
        if (stream.match(/^[a-zA-Z][a-zA-Z0-9_:-]*/)) {
          state.mode = "afterValue";
          return "variableName";
        }
        if (stream.eat("#")) {
          return "operator";
        }
        const ch = stream.next();
        if (ch === "}" || ch === ")") state.mode = "top";
        return ch === "}" || ch === ")" ? "bracket" : null;
      }
      case "quoteString": {
        while (!stream.eol()) {
          const ch = stream.next();
          if (ch === "\\") {
            if (!stream.eol()) stream.next();
            continue;
          }
          if (ch === '"') {
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
        if (ch === "#") {
          state.mode = "value";
          return "operator";
        }
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
      case "commentBody": {
        const opening = state.entryOpen;
        const closing = opening === "{" ? "}" : ")";
        while (!stream.eol()) {
          const ch = stream.next();
          if (ch === "\\") {
            if (!stream.eol()) stream.next();
            continue;
          }
          if (ch === opening) {
            state.braceDepth += 1;
          } else if (ch === closing) {
            state.braceDepth -= 1;
            if (state.braceDepth === 0) {
              state.mode = "top";
              state.directive = "entry";
              break;
            }
          }
        }
        return "comment";
      }
      default:
        stream.next();
        return null;
    }
  },
};

export const bibtexLanguage = () => new LanguageSupport(StreamLanguage.define(bibtexParser));
