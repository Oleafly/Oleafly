import { latexBalancedGroupEnd } from "./latex-lexical";
import { editorMessage, type EditorMessageKey } from "./messages";

export interface XparseSpecificationDiagnostic {
  readonly from: number;
  readonly to: number;
  readonly message: string;
}

function skipWhitespace(source: string, start: number): number {
  let cursor = start;
  while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

type XparseGroupKind =
  | "processor"
  | "defaultValue"
  | "embellishmentList"
  | "defaultList";

const BRACED_GROUP_KEYS: Record<XparseGroupKind, EditorMessageKey> = {
  processor: "latex.xparse.bracedProcessor",
  defaultValue: "latex.xparse.bracedDefaultValue",
  embellishmentList: "latex.xparse.bracedEmbellishmentList",
  defaultList: "latex.xparse.bracedDefaultList",
};

const UNCLOSED_GROUP_KEYS: Record<XparseGroupKind, EditorMessageKey> = {
  processor: "latex.xparse.unclosedProcessor",
  defaultValue: "latex.xparse.unclosedDefaultValue",
  embellishmentList: "latex.xparse.unclosedEmbellishmentList",
  defaultList: "latex.xparse.unclosedDefaultList",
};

function requiredGroupEnd(
  source: string,
  start: number,
  type: string,
  kind: XparseGroupKind,
  diagnostics: XparseSpecificationDiagnostic[],
): number | null {
  const from = skipWhitespace(source, start);
  if (source[from] !== "{") {
    diagnostics.push({
      from: Math.min(from, Math.max(0, source.length - 1)),
      to: Math.min(source.length, Math.max(from + 1, 1)),
      message: editorMessage(BRACED_GROUP_KEYS[kind], { type }),
    });
    return null;
  }
  const end = latexBalancedGroupEnd(source, from);
  if (end === null) {
    diagnostics.push({
      from,
      to: Math.min(source.length, from + 1),
      message: editorMessage(UNCLOSED_GROUP_KEYS[kind], { type }),
    });
  }
  return end;
}

function delimiterTokenEnd(
  source: string,
  start: number,
): number | null {
  const from = skipWhitespace(source, start);
  const character = source[from];
  if (!character) return null;
  if (character === "{") {
    return latexBalancedGroupEnd(source, from);
  }
  if (character !== "\\") return from + 1;
  let cursor = from + 1;
  if (/[A-Za-z@]/u.test(source[cursor] ?? "")) {
    while (/[A-Za-z@]/u.test(source[cursor] ?? "")) cursor += 1;
    return cursor;
  }
  return Math.min(source.length, cursor + 1);
}

/**
 * Validates the documented xparse argument-type grammar that Oleafly can
 * faithfully turn into completion snippets. Offsets are relative to the
 * argument-specification group content.
 */
export function validateXparseArgumentSpecification(
  source: string,
): readonly XparseSpecificationDiagnostic[] {
  const diagnostics: XparseSpecificationDiagnostic[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    cursor = skipWhitespace(source, cursor);
    if (cursor >= source.length) break;

    while (source[cursor] === "+" || source[cursor] === "!") {
      cursor = skipWhitespace(source, cursor + 1);
    }
    while (source[cursor] === ">") {
      const processorEnd = requiredGroupEnd(
        source,
        cursor + 1,
        ">",
        "processor",
        diagnostics,
      );
      if (processorEnd === null) return diagnostics;
      cursor = skipWhitespace(source, processorEnd);
    }
    if (cursor >= source.length) {
      diagnostics.push({
        from: Math.max(0, source.length - 1),
        to: source.length,
        message: editorMessage("latex.xparse.modifiersNeedType"),
      });
      break;
    }

    const typeFrom = cursor;
    const type = source[cursor];
    cursor += 1;

    if ("mbvos".includes(type)) continue;

    if (type === "O") {
      const end = requiredGroupEnd(
        source,
        cursor,
        type,
        "defaultValue",
        diagnostics,
      );
      if (end === null) break;
      cursor = end;
      continue;
    }

    if (type === "t") {
      const end = delimiterTokenEnd(source, cursor);
      if (end === null) {
        diagnostics.push({
          from: typeFrom,
          to: typeFrom + 1,
          message: editorMessage("latex.xparse.triggerToken"),
        });
        break;
      }
      cursor = end;
      continue;
    }

    if (
      type === "r" ||
      type === "R" ||
      type === "d" ||
      type === "D"
    ) {
      const leftEnd = delimiterTokenEnd(source, cursor);
      const rightEnd =
        leftEnd === null ? null : delimiterTokenEnd(source, leftEnd);
      if (leftEnd === null || rightEnd === null) {
        diagnostics.push({
          from: typeFrom,
          to: Math.min(
            source.length,
            Math.max(typeFrom + 1, leftEnd ?? typeFrom + 1),
          ),
          message: editorMessage("latex.xparse.delimiterTokens", { type }),
        });
        break;
      }
      cursor = rightEnd;
      if (type === "R" || type === "D") {
        const defaultEnd = requiredGroupEnd(
          source,
          cursor,
          type,
          "defaultValue",
          diagnostics,
        );
        if (defaultEnd === null) break;
        cursor = defaultEnd;
      }
      continue;
    }

    if (type === "e" || type === "E") {
      const embellishments = requiredGroupEnd(
        source,
        cursor,
        type,
        "embellishmentList",
        diagnostics,
      );
      if (embellishments === null) break;
      cursor = embellishments;
      if (type === "E") {
        const defaults = requiredGroupEnd(
          source,
          cursor,
          type,
          "defaultList",
          diagnostics,
        );
        if (defaults === null) break;
        cursor = defaults;
      }
      continue;
    }

    diagnostics.push({
      from: typeFrom,
      to: typeFrom + 1,
      message: editorMessage("latex.xparse.unknownType", { type }),
    });
  }

  return diagnostics;
}
