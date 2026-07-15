import type { FileSymbols, Sym, SymKind } from "./types";

function maskTypstComments(text: string): string {
  let out = "";
  let i = 0;
  let blockDepth = 0;
  while (i < text.length) {
    if (blockDepth > 0) {
      if (text.startsWith("/*", i)) {
        blockDepth++;
        out += "  ";
        i += 2;
      } else if (text.startsWith("*/", i)) {
        blockDepth--;
        out += "  ";
        i += 2;
      } else {
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
    } else if (text.startsWith("//", i)) {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else if (text.startsWith("/*", i)) {
      blockDepth = 1;
      out += "  ";
      i += 2;
    } else {
      out += text[i++];
    }
  }
  return out;
}

function maskStrings(text: string): string {
  const chars = text.split("");
  type Frame = { mode: "markup"; close: boolean; brackets: number } | {
    mode: "code";
    line: boolean;
    started: boolean;
    parens: number;
    braces: number;
    quoted: boolean;
  };
  const frames: Frame[] = [{ mode: "markup", close: false, brackets: 0 }];
  let i = 0;
  while (i < text.length) {
    const frame = frames[frames.length - 1];
    const char = text[i];
    if (frame.mode === "markup") {
      if (frame.close && char === "]" && frame.brackets === 0) {
        frames.pop();
        i++;
      } else if (frame.close && char === "[") {
        frame.brackets++;
        i++;
      } else if (frame.close && char === "]") {
        frame.brackets--;
        i++;
      } else if (char === "#") {
        let start = i + 1;
        while (text[start] === " " || text[start] === "\t") start++;
        const line = ["let", "set", "show", "import", "include"].some((word) => {
          if (!text.startsWith(word, start)) return false;
          const next = text[start + word.length];
          return next === undefined || !/[A-Za-z0-9_]/.test(next);
        });
        frames.push({
          mode: "code",
          line,
          started: false,
          parens: 0,
          braces: 0,
          quoted: false,
        });
        i++;
      } else {
        i++;
      }
      continue;
    }
    if (frame.quoted) {
      if (char !== "\n") chars[i] = " ";
      if (char === "\\" && i + 1 < text.length) {
        i++;
        if (text[i] !== "\n") chars[i] = " ";
      } else if (char === '"') {
        frame.quoted = false;
      }
      i++;
      continue;
    }
    if (char === '"') {
      frame.quoted = true;
      chars[i] = " ";
      frame.started = true;
      i++;
    } else if (char === "[") {
      frame.started = true;
      frames.push({ mode: "markup", close: true, brackets: 0 });
      i++;
    } else if (char === "(") {
      frame.parens++;
      frame.started = true;
      i++;
    } else if (char === "{") {
      frame.braces++;
      frame.started = true;
      i++;
    } else if (char === ")" && frame.parens > 0) {
      frame.parens--;
      i++;
    } else if (char === "}" && frame.braces > 0) {
      frame.braces--;
      i++;
    } else if (char === "\n" && frame.line) {
      frames.pop();
    } else if (
      frame.started && !frame.line && frame.parens === 0 && frame.braces === 0 && /\s/.test(char)
    ) {
      frames.pop();
    } else {
      if (!/\s/.test(char)) frame.started = true;
      i++;
    }
  }
  return chars.join("");
}

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
  return /\.[^/]+$/.test(target) ? target : `${target}.typ`;
}

export function parseTypstFile(path: string, rawText: string): FileSymbols {
  const text = maskTypstComments(rawText);
  const code = maskStrings(text);
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
    list: Sym[], kind: SymKind, name: string, from: number, to: number,
    nameFrom: number, nameTo: number, extra?: Partial<Sym>,
  ) => list.push({ kind, name, file: path, line: lineAt(from), from, to, nameFrom, nameTo, ...extra });

  let match: RegExpExecArray | null;
  const heading = /^(={1,6})[ \t]+([^\n]+)$/gm;
  while ((match = heading.exec(text))) {
    const rawTitle = match[2].replace(/[ \t]+<[^>]+>[ \t]*$/, "").trim();
    if (!rawTitle) continue;
    const nameFrom = match.index + match[0].indexOf(match[2]) + match[2].indexOf(rawTitle);
    push(defs, "section", rawTitle, match.index, match.index + match[0].length, nameFrom,
      nameFrom + rawTitle.length, { level: match[1].length - 1 });
  }

  const label = /<([A-Za-z_][\w:-]*)>/g;
  while ((match = label.exec(code))) {
    const nameFrom = match.index + 1;
    push(defs, "label", match[1], match.index, match.index + match[0].length, nameFrom,
      nameFrom + match[1].length);
  }

  const atUse = /(?:^|[^\w])@([A-Za-z_][\w:-]*)/g;
  while ((match = atUse.exec(code))) {
    const at = match.index + match[0].lastIndexOf("@");
    const nameFrom = at + 1;
    push(uses, "atuse", match[1], at, at + match[1].length + 1, nameFrom,
      nameFrom + match[1].length);
  }

  const input = /#(?:include|import)\s+"([^"]+)"/g;
  while ((match = input.exec(text))) {
    const target = resolveImport(path, match[1]);
    if (!target) continue;
    const nameFrom = match.index + match[0].indexOf(match[1]);
    push(uses, "inputedge", match[1], match.index, match.index + match[0].length, nameFrom,
      nameFrom + match[1].length, { target });
  }
  return { file: path, defs, uses };
}
