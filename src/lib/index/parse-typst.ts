import {
  isTypstEscaped,
  maskTypstSource,
  TYPST_LABEL_PATTERN,
  TYPST_NAME_CHARACTER_PATTERN,
  trimTypstReference,
} from "@oleafly/editor/typst-syntax";
import type { FileSymbols, Sym, SymKind } from "./types";

export { maskTypstSource, typstRawEnd } from "@oleafly/editor/typst-syntax";

type SymSpan = {
  readonly from: number;
  readonly to: number;
  readonly nameFrom: number;
  readonly nameTo: number;
};

function resolveImport(from: string, raw: string): string | null {
  if (raw.startsWith("@") || raw.includes("://") || raw.startsWith("/")) return null;
  const parts = [...from.split("/").slice(0, -1), ...raw.replace(/^\.\//, "").split("/")];
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  const target = normalized.join("/");
  const dot = target.indexOf(".", target.lastIndexOf("/") + 1);
  const hasExtension = dot >= 0 && dot < target.length - 1;
  return hasExtension ? target : `${target}.typ`;
}

export function parseTypstFile(path: string, rawText: string): FileSymbols {
  const { text, code } = maskTypstSource(rawText);
  const defs: Sym[] = [];
  const uses: Sym[] = [];
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const push = (
    list: Sym[], kind: SymKind, name: string, span: SymSpan, extra?: Partial<Sym>,
  ) => list.push({ kind, name, file: path, line: lineAt(span.from), ...span, ...extra });

  const heading = /^(={1,6})[ \t]+([^\n]+)$/gm;
  for (const match of text.matchAll(heading)) {
    const rawTitle = match[2].replace(/(?<![ \t])[ \t]+<[^>]+>[ \t]*$/, "").trim();
    if (!rawTitle) continue;
    const nameFrom = match.index + match[0].indexOf(match[2]) + match[2].indexOf(rawTitle);
    push(defs, "section", rawTitle, {
      from: match.index,
      to: match.index + match[0].length,
      nameFrom,
      nameTo: nameFrom + rawTitle.length,
    }, { level: match[1].length - 1 });
  }

  const label = new RegExp(`<(${TYPST_LABEL_PATTERN})>`, "gu");
  for (const match of code.matchAll(label)) {
    if (isTypstEscaped(code, match.index)) continue;
    const nameFrom = match.index + 1;
    push(defs, "label", match[1], {
      from: match.index,
      to: match.index + match[0].length,
      nameFrom,
      nameTo: nameFrom + match[1].length,
    });
  }

  const atUse = new RegExp(
    `(?<!${TYPST_NAME_CHARACTER_PATTERN})@(${TYPST_LABEL_PATTERN})`,
    "gu",
  );
  for (const match of code.matchAll(atUse)) {
    if (isTypstEscaped(code, match.index)) continue;
    const name = trimTypstReference(match[1]);
    const at = match.index;
    const nameFrom = at + 1;
    push(uses, "atuse", name, {
      from: at,
      to: nameFrom + name.length,
      nameFrom,
      nameTo: nameFrom + name.length,
    });
  }

  const input = /#(?:include|import)\s+"([^"]+)"/g;
  for (const match of text.matchAll(input)) {
    const target = resolveImport(path, match[1]);
    if (!target) continue;
    const nameFrom = match.index + match[0].indexOf(match[1]);
    push(uses, "inputedge", match[1], {
      from: match.index,
      to: match.index + match[0].length,
      nameFrom,
      nameTo: nameFrom + match[1].length,
    }, { target });
  }
  return { file: path, defs, uses };
}
