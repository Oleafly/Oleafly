import type { ProjectIndex, Sym } from "./types";

export interface OutlineItem {
  level: number;
  title: string;
  line: number;
  file: string;
  kind: "section" | "file";
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

export function outlineFromIndex(index: ProjectIndex, activeFile: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  const visited = new Set<string>();

  const walk = (file: string, depth: number) => {
    if (depth > 8 || visited.has(file)) return;
    visited.add(file);

    const syms: Sym[] = [
      ...index.defs.filter((d) => d.kind === "section" && d.file === file),
      ...index.uses.filter((u) => u.kind === "inputedge" && u.file === file),
    ].sort((a, b) => a.from - b.from);

    for (const s of syms) {
      if (s.kind === "section") {
        out.push({ level: s.level ?? 2, title: s.name, line: s.line, file, kind: "section" });
      } else {
        const target = s.target ?? s.name;
        const before = out.length;
        walk(target, depth + 1);
        if (out.length === before) {
          out.push({ level: 2, title: basename(target), line: s.line, file: target, kind: "file" });
        }
      }
    }
  };

  walk(activeFile, 0);
  return out;
}
