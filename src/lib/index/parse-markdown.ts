import type { FileSymbols, Sym } from "./types";

export function parseMarkdownFile(path: string, text: string): FileSymbols {
  const defs: Sym[] = [];
  const uses: Sym[] = [];
  let offset = 0;
  let fence: { char: "`" | "~"; length: number } | null = null;
  let yaml = text.startsWith("---\n");
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (yaml) {
      if (index > 0 && /^(?:---|\.\.\.)\s*$/.test(line)) yaml = false;
      offset += line.length + 1;
      continue;
    }
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      const char = marker[0] as "`" | "~";
      if (!fence) fence = { char, length: marker.length };
      else if (char === fence.char && marker.length >= fence.length) fence = null;
      offset += line.length + 1;
      continue;
    }
    if (!fence) {
      const visible = line.replace(/(`+)(.*?)\1/g, (whole) => " ".repeat(whole.length));
      const heading = /^(#{1,6})\s+/.exec(visible);
      if (heading) {
        const titleStart = heading[0].length;
        const name = line.slice(titleStart).replace(/\s+#+\s*$/, "").replace(/\s+\{[^{}]*\}\s*$/, "").trimEnd();
        const nameFrom = offset + titleStart;
        defs.push({ kind: "section", name, file: path, line: index + 1, from: offset, to: offset + line.length, nameFrom, nameTo: nameFrom + name.length, level: heading[1].length - 1 });
      }
      if (index + 1 < lines.length && /^\s*(?:={2,}|-{2,})\s*$/.test(lines[index + 1]) && visible.trim()) {
        const leading = line.length - line.trimStart().length;
        const name = line.trim().replace(/\s+\{[^{}]*\}\s*$/, "").trimEnd();
        const nameFrom = offset + leading;
        defs.push({ kind: "section", name, file: path, line: index + 1, from: offset, to: offset + line.length, nameFrom, nameTo: nameFrom + name.length, level: lines[index + 1].trimStart().startsWith("=") ? 0 : 1 });
      }
      const citations = /(?:^|[^\w])@([A-Za-z0-9_:.#$%&+?<>~/\-]+)/g;
      let match: RegExpExecArray | null;
      while ((match = citations.exec(visible))) {
        const name = match[1].replace(/[.,;!?]+$/, "");
        if (!name) continue;
        const at = offset + match.index + match[0].lastIndexOf("@");
        uses.push({ kind: "cite", name, file: path, line: index + 1, from: at, to: at + name.length + 1, nameFrom: at + 1, nameTo: at + name.length + 1 });
      }
    }
    offset += line.length + 1;
  }
  return { file: path, defs, uses };
}
