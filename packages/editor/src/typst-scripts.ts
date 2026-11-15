import type { Extension } from "@codemirror/state";
import {
  isScriptDigit,
  isScriptLetter,
  isScriptSign,
  scriptGroups,
} from "./script-groups";
import { typstContextAt } from "./typst-editing";

export function typstScriptGroups(): Extension {
  return scriptGroups({
    open: "(",
    close: ")",
    startsGroup: (_mark, first, next) =>
      isScriptSign(first) && (isScriptDigit(next) || isScriptLetter(next)),
    scriptAt: (state, at) => typstContextAt(state, at) === "math",
  });
}
