import type { DefKind, Edit, FileSymbols, ProjectIndex, RenamePlan, Sym, UseKind } from "./types";
import { parseFile, maskComments } from "./parse-file";
import { labelScope, referenceTargetFile } from "@/lib/project-intelligence/resolution";
import { engineForPath } from "@/lib/project-intelligence/source";

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
  collectMacroUses(defs, files, uses);

  return indexFromSymbols(defs, uses);
}

function macroDefinitionSpans(
  defs: readonly Sym[],
): Map<string, [number, number][]> {
  const macroDefSpans = new Map<string, [number, number][]>();
  for (const d of defs) {
    if (d.kind !== "macro") continue;
    const arr = macroDefSpans.get(d.file) ?? [];
    arr.push([d.from, d.to]);
    macroDefSpans.set(d.file, arr);
  }
  return macroDefSpans;
}

function collectFileMacroUses(
  path: string,
  rawText: string,
  alt: string,
  spans: readonly [number, number][],
  uses: Sym[],
): void {
  const text = maskComments(rawText);
  const lineAt = lineCounter(text);
  const re = new RegExp(String.raw`\\(${alt})(?![\p{L}\p{M}@])`, "gu");
  for (const m of text.matchAll(re)) {
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

function collectMacroUses(
  defs: readonly Sym[],
  files: Record<string, string>,
  uses: Sym[],
): void {
  const macroNames = [...new Set(defs.filter((d) => d.kind === "macro").map((d) => d.name))];
  if (macroNames.length === 0) return;
  macroNames.sort((a, b) => b.length - a.length);
  const alt = macroNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)).join("|");
  const macroDefSpans = macroDefinitionSpans(defs);
  for (const [path, rawText] of Object.entries(files)) {
    if (/\.(?:typ|md|markdown)$/i.test(path)) continue;
    collectFileMacroUses(
      path,
      rawText,
      alt,
      macroDefSpans.get(path) ?? [],
      uses,
    );
  }
}

// Citation keys come from .bib files that every engine reads, and file symbols
// are project paths, so neither is scoped. Every other name belongs to the
// engine of the file it appears in: a LaTeX \ref cannot reach a Typst <label>,
// so looking one up or renaming it must never touch the other. Labels use the
// same scopes as the project-intelligence resolver, which also keeps a
// Markdown anchor to its own file.
function nameScope(kind: DefKind, file: string): string {
  if (kind === "bibentry" || kind === "file") return "";
  if (kind === "label") return labelScope(engineForPath(file), file);
  return engineForPath(file) ?? "";
}

interface NameTarget {
  scope: string;
  // The one file the definition must be in, or null for any file in scope.
  file: string | null;
}

/**
 * Where a symbol's name lives when it is looked up as `kind`. A definition
 * pins its own file. A `file#anchor` reference, such as a Markdown
 * `[results](paper.tex#sec:results)`, takes the scope of the file it names
 * and pins that file; any other use takes the scope of the file it sits in.
 */
export function nameTarget(kind: DefKind, sym: Sym): NameTarget {
  if (isDefKind(sym.kind)) {
    return { scope: nameScope(kind, sym.file), file: sym.file };
  }
  const targetFile = kind === "label" ? referenceTargetFile(sym.target) : null;
  if (targetFile !== null) {
    return { scope: nameScope(kind, targetFile), file: targetFile };
  }
  return { scope: nameScope(kind, sym.file), file: null };
}

function sameTarget(a: NameTarget, b: NameTarget): boolean {
  return (
    a.scope === b.scope && (a.file === null || b.file === null || a.file === b.file)
  );
}

function defKey(kind: DefKind, scope: string, name: string): string {
  return `${kind}:${scope}:${name}`;
}

/**
 * Hydrates the closure-based compatibility index from immutable symbols.
 * Project-scale parsers can run in a worker and use this inexpensive main-
 * thread step without rescanning source text.
 */
export function indexFromSymbols(
  definitionSymbols: readonly Sym[],
  useSymbols: readonly Sym[],
): ProjectIndex {
  const defs = [...definitionSymbols];
  const uses = [...useSymbols];
  const defsByKey = new Map<string, Sym[]>();
  for (const d of defs) {
    const key = defKey(d.kind as DefKind, nameScope(d.kind as DefKind, d.file), d.name);
    const sameKey = defsByKey.get(key);
    if (sameKey) sameKey.push(d);
    else defsByKey.set(key, [d]);
  }
  const lookup = (kind: DefKind, from: Sym, name = from.name): Sym | null => {
    const { scope, file } = nameTarget(kind, from);
    const candidates = defsByKey.get(defKey(kind, scope, name)) ?? [];
    return (file === null ? candidates[0] : candidates.find((d) => d.file === file)) ?? null;
  };
  // The uses of `kind` named `name` that point at the same thing as `origin`.
  const usesOf = (kind: DefKind, name: string, origin: Sym): Sym[] => {
    const useKinds = DEF_TO_USES[kind] ?? [];
    const target = nameTarget(kind, origin);
    return uses.filter(
      (u) =>
        useKinds.includes(u.kind as UseKind) &&
        u.name === name &&
        sameTarget(nameTarget(kind, u), target),
    );
  };

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
    if (sym.kind === "inputedge") return lookup("file", sym, sym.target ?? sym.name);
    if (sym.kind === "atuse") return lookup("label", sym) ?? lookup("bibentry", sym);
    if (sym.kind === "envuse") return lookup("theorem", sym) ?? lookup("environment", sym);
    const dk = USE_TO_DEF[sym.kind];
    return dk ? lookup(dk, sym) : null;
  };

  const references = (name: string, kind: UseKind): Sym[] => uses.filter((u) => u.kind === kind && u.name === name);

  const allReferences = (sym: Sym): Sym[] => {
    const def = isDefKind(sym.kind) ? sym : definitionFor(sym);
    const kind: DefKind | null = (def?.kind as DefKind) ?? null;
    const name = def?.name ?? sym.name;
    const out: Sym[] = [];
    if (def && def.to > def.from) out.push(def);
    if (!kind) return out;
    out.push(...usesOf(kind, name, def ?? sym));
    return out;
  };

  const renamePlan = (sym: Sym, newName: string): RenamePlan => {
    // Resolve to a definition (rename may be invoked from a use site).
    const def = isDefKind(sym.kind) ? sym : definitionFor(sym);
    const kind: DefKind = (def?.kind as DefKind) ?? "label";
    const name = def?.name ?? sym.name;
    const origin = def ?? sym;

    const originScope = nameTarget(kind, origin).scope;
    const collision = defs.some(
      (d) => d.kind === kind && d.name === newName && d !== def && nameScope(kind, d.file) === originScope,
    );

    const edits: Edit[] = [];
    if (def && def.nameTo > def.nameFrom) {
      edits.push({ file: def.file, from: def.nameFrom, to: def.nameTo, newText: newName });
    }
    for (const u of usesOf(kind, name, origin)) {
      edits.push({ file: u.file, from: u.nameFrom, to: u.nameTo, newText: newName });
    }
    // Apply high-offset-first within each file so earlier edits don't shift later ones.
    edits.sort((a, b) => (a.file === b.file ? b.from - a.from : a.file.localeCompare(b.file)));
    const fileCount = new Set(edits.map((e) => e.file)).size;
    return { edits, fileCount, collision };
  };

  return {
    defs,
    uses,
    symbolAt,
    definitionFor,
    references,
    allReferences,
    renamePlan,
  };
}
