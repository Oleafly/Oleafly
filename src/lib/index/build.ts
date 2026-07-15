import type { DefKind, Edit, FileSymbols, ProjectIndex, RenamePlan, Sym, UseKind } from "./types";
import { parseFile, maskComments } from "./parse-file";

const DEF_KINDS = new Set<string>(["label", "macro", "bibentry", "theorem", "glossary", "environment", "section", "file"]);
const isDefKind = (k: string): k is DefKind => DEF_KINDS.has(k);

const USE_TO_DEF: Record<Exclude<UseKind, "inputedge" | "envuse" | "atuse">, DefKind> = {
  ref: "label",
  cite: "bibentry",
  macrouse: "macro",
  glossaryuse: "glossary",
};

const DEF_TO_USES: Record<DefKind, UseKind[]> = {
  label: ["ref", "atuse"],
  bibentry: ["cite", "atuse"],
  macro: ["macrouse"],
  glossary: ["glossaryuse"],
  theorem: ["envuse"],
  environment: ["envuse"],
  section: [],
  file: [],
};

function lineCounter(text: string) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (offset: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

export function buildIndex(files: Record<string, string>): ProjectIndex {
  const parsed: Record<string, FileSymbols> = {};
  for (const [path, text] of Object.entries(files)) parsed[path] = parseFile(path, text);
  return assembleIndex(parsed, files);
}

// Split out from buildIndex so callers can cache parseFile results and re-parse only
// the file that changed instead of the whole project on every keystroke; raw texts
// are still needed here for the project-wide macro-use pass.
export function assembleIndex(
  parsedByPath: Record<string, FileSymbols>,
  files: Record<string, string>,
): ProjectIndex {
  const defs: Sym[] = [];
  const uses: Sym[] = [];

  // Add a `file` def node per path for inputedge resolution.
  for (const [path, r] of Object.entries(parsedByPath)) {
    defs.push(...r.defs);
    uses.push(...r.uses);
    defs.push({ kind: "file", name: path, file: path, line: 1, from: 0, to: 0, nameFrom: 0, nameTo: 0 });
  }

  // Second pass: macro uses. Needs the project-wide macro name set.
  const macroNames = [...new Set(defs.filter((d) => d.kind === "macro").map((d) => d.name))];
  if (macroNames.length > 0) {
    macroNames.sort((a, b) => b.length - a.length);
    const alt = macroNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const macroDefSpans = new Map<string, [number, number][]>();
    for (const d of defs) {
      if (d.kind !== "macro") continue;
      const arr = macroDefSpans.get(d.file) ?? [];
      arr.push([d.from, d.to]);
      macroDefSpans.set(d.file, arr);
    }
    for (const [path, rawText] of Object.entries(files)) {
      if (/\.(?:typ|md|markdown)$/i.test(path)) continue;
      const text = maskComments(rawText);
      const spans = macroDefSpans.get(path) ?? [];
      const lineAt = lineCounter(text);
      const re = new RegExp(`\\\\(${alt})(?![a-zA-Z@])`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const at = m.index;
        if (spans.some(([f, t]) => at >= f && at < t)) continue;
        const name = m[1];
        const nameFrom = at + 1;
        uses.push({
          kind: "macrouse",
          name,
          file: path,
          line: lineAt(at),
          from: at,
          to: at + 1 + name.length,
          nameFrom,
          nameTo: nameFrom + name.length,
        });
      }
    }
  }

  const defByKindName = new Map<string, Sym>();
  for (const d of defs) {
    const key = `${d.kind}:${d.name}`;
    if (!defByKindName.has(key)) defByKindName.set(key, d);
  }

  const symbolAt = (file: string, offset: number): Sym | null => {
    let best: Sym | null = null;
    for (const s of [...uses, ...defs]) {
      if (s.file !== file) continue;
      if (offset >= s.from && offset < s.to) {
        if (!best || s.to - s.from < best.to - best.from) best = s;
      }
    }
    return best;
  };

  const definitionFor = (sym: Sym): Sym | null => {
    if (isDefKind(sym.kind)) return sym;
    if (sym.kind === "inputedge") return defByKindName.get(`file:${sym.target ?? sym.name}`) ?? null;
    if (sym.kind === "atuse") {
      return defByKindName.get(`label:${sym.name}`) ?? defByKindName.get(`bibentry:${sym.name}`) ?? null;
    }
    if (sym.kind === "envuse") {
      return defByKindName.get(`theorem:${sym.name}`) ?? defByKindName.get(`environment:${sym.name}`) ?? null;
    }
    const dk = USE_TO_DEF[sym.kind];
    return dk ? defByKindName.get(`${dk}:${sym.name}`) ?? null : null;
  };

  const references = (name: string, kind: UseKind): Sym[] => uses.filter((u) => u.kind === kind && u.name === name);

  const allReferences = (sym: Sym): Sym[] => {
    const def = isDefKind(sym.kind) ? sym : definitionFor(sym);
    const kind: DefKind | null = (def?.kind as DefKind) ?? null;
    const name = def?.name ?? sym.name;
    const useKinds = kind ? DEF_TO_USES[kind] ?? [] : [];
    const out: Sym[] = [];
    if (def && def.to > def.from) out.push(def);
    for (const u of uses) if (useKinds.includes(u.kind as UseKind) && u.name === name) out.push(u);
    return out;
  };

  const renamePlan = (sym: Sym, newName: string): RenamePlan => {
    // Resolve to a definition (rename may be invoked from a use site).
    const def = isDefKind(sym.kind) ? sym : definitionFor(sym);
    const kind: DefKind = (def?.kind as DefKind) ?? "label";
    const name = def?.name ?? sym.name;

    const collision = defs.some((d) => d.kind === kind && d.name === newName && d !== def);

    const edits: Edit[] = [];
    if (def && def.nameTo > def.nameFrom) {
      edits.push({ file: def.file, from: def.nameFrom, to: def.nameTo, newText: newName });
    }
    const useKinds = DEF_TO_USES[kind] ?? [];
    for (const u of uses) {
      if (useKinds.includes(u.kind as UseKind) && u.name === name) {
        edits.push({ file: u.file, from: u.nameFrom, to: u.nameTo, newText: newName });
      }
    }
    // Apply high-offset-first within each file so earlier edits don't shift later ones.
    edits.sort((a, b) => (a.file === b.file ? b.from - a.from : a.file.localeCompare(b.file)));
    const fileCount = new Set(edits.map((e) => e.file)).size;
    return { edits, fileCount, collision };
  };

  return { defs, uses, symbolAt, definitionFor, references, allReferences, renamePlan };
}
