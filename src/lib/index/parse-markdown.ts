import type { FileSymbols, Sym } from "./types";

type MarkdownFence = { char: "`" | "~"; length: number } | null;

type MarkdownScanState = {
  offset: number;
  fence: MarkdownFence;
  yaml: boolean;
};

type MarkdownLineContext = {
  readonly path: string;
  readonly lines: readonly string[];
  readonly index: number;
  readonly offset: number;
  readonly defs: Sym[];
  readonly uses: Sym[];
};

function nextFence(fence: MarkdownFence, marker: string): MarkdownFence {
  const char = marker[0] as "`" | "~";
  if (!fence) return { char, length: marker.length };
  if (char === fence.char && marker.length >= fence.length) return null;
  return fence;
}

function skipLine(
  state: MarkdownScanState,
  line: string,
  index: number,
): boolean {
  if (state.yaml) {
    if (index > 0 && /^(?:---|\.\.\.)\s*$/.test(line)) state.yaml = false;
    return true;
  }
  const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
  if (marker) {
    state.fence = nextFence(state.fence, marker);
    return true;
  }
  return state.fence !== null;
}

function atxHeading(
  path: string,
  line: string,
  visible: string,
  index: number,
  offset: number,
): Sym | null {
  const heading = /^(#{1,6})\s+/.exec(visible);
  if (!heading) return null;
  const titleStart = heading[0].length;
  const name = line
    .slice(titleStart)
    .replace(/(?<!\s)\s+#+\s*$/, "")
    .replace(/(?<!\s)\s+\{[^{}]*\}\s*$/, "")
    .trimEnd();
  const nameFrom = offset + titleStart;
  return {
    kind: "section",
    name,
    file: path,
    line: index + 1,
    from: offset,
    to: offset + line.length,
    nameFrom,
    nameTo: nameFrom + name.length,
    level: heading[1].length - 1,
  };
}

function setextHeading(
  path: string,
  line: string,
  underline: string | undefined,
  visible: string,
  index: number,
  offset: number,
): Sym | null {
  if (!underline) return null;
  if (!/^\s*(?:={2,}|-{2,})\s*$/.test(underline)) return null;
  if (!visible.trim()) return null;
  const leading = line.length - line.trimStart().length;
  const name = line
    .trim()
    .replace(/(?<!\s)\s+\{[^{}]*\}\s*$/, "")
    .trimEnd();
  const nameFrom = offset + leading;
  return {
    kind: "section",
    name,
    file: path,
    line: index + 1,
    from: offset,
    to: offset + line.length,
    nameFrom,
    nameTo: nameFrom + name.length,
    level: underline.trimStart().startsWith("=") ? 0 : 1,
  };
}

function collectCitations(
  path: string,
  visible: string,
  index: number,
  offset: number,
  uses: Sym[],
): void {
  const citations = /(?:^|[^\w])@([A-Za-z0-9_:.#$%&+?<>~/-]+)/g;
  for (const match of visible.matchAll(citations)) {
    const name = match[1].replace(/(?<![.,;!?])[.,;!?]+$/, "");
    if (!name) continue;
    const at = offset + match.index + match[0].lastIndexOf("@");
    uses.push({
      kind: "cite",
      name,
      file: path,
      line: index + 1,
      from: at,
      to: at + name.length + 1,
      nameFrom: at + 1,
      nameTo: at + name.length + 1,
    });
  }
}

function collectLineSymbols(context: MarkdownLineContext): void {
  const { path, lines, index, offset, defs, uses } = context;
  const line = lines[index];
  const visible = line.replace(/(`+)(.*?)\1/g, (whole) =>
    " ".repeat(whole.length),
  );
  const atx = atxHeading(path, line, visible, index, offset);
  if (atx) defs.push(atx);
  const setext = setextHeading(
    path,
    line,
    lines[index + 1],
    visible,
    index,
    offset,
  );
  if (setext) defs.push(setext);
  collectCitations(path, visible, index, offset, uses);
}

export function parseMarkdownFile(path: string, text: string): FileSymbols {
  const defs: Sym[] = [];
  const uses: Sym[] = [];
  const lines = text.split("\n");
  const state: MarkdownScanState = {
    offset: 0,
    fence: null,
    yaml: text.startsWith("---\n"),
  };
  for (const [index, line] of lines.entries()) {
    if (!skipLine(state, line, index)) {
      collectLineSymbols({
        path,
        lines,
        index,
        offset: state.offset,
        defs,
        uses,
      });
    }
    state.offset += line.length + 1;
  }
  return { file: path, defs, uses };
}
