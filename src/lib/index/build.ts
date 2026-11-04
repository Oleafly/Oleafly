import type { DefKind, Edit, FileSymbols, ProjectIndex, RenamePlan, Sym, UseKind } from "./types";
import { parseFile, maskComments } from "./parse-file";
import type {
  LatexRenameClosure,
  LatexUnitScope,
} from "@/lib/project-intelligence/latex-units";
import { labelScope, referenceTargetFile } from "@/lib/project-intelligence/resolution";
import { engineForPath } from "@/lib/project-intelligence/source";
import { escapeRegExp } from "@/lib/regexp";

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

export function assembleIndex(
  parsedByPath: Record<string, FileSymbols>,
  files: Record<string, string>,
): ProjectIndex {
  const defs: Sym[] = [];
  const uses: Sym[] = [];

  for (const [path, r] of Object.entries(parsedByPath)) {
    defs.push(...r.defs);
    uses.push(...r.uses);
    defs.push({ kind: "file", name: path, file: path, line: 1, from: 0, to: 0, nameFrom: 0, nameTo: 0 });
  }

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
  const alt = macroNames.map(escapeRegExp).join("|");
  const macroDefSpans = macroDefinitionSpans(defs);
  for (const [path, rawText] of Object.entries(files)) {
    if (/\.(?:typ|md|markdown|qmd|rmd)$/i.test(path)) continue;
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
  file: string | null;
}

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

function symbolFile(sym: Sym): string {
  return sym.file;
}

function sameTarget(a: NameTarget, b: NameTarget): boolean {
  return (
    a.scope === b.scope && (a.file === null || b.file === null || a.file === b.file)
  );
}

function defKey(kind: DefKind, scope: string, name: string): string {
  return `${kind}:${scope}:${name}`;
}

// A LaTeX language server can report a definition by its whole extent, such as
// an environment or a \\let line. A rename needs the name itself.
function hasNameRange(definition: Sym): boolean {
  return definition.wholeExtent !== true;
}

// One place edited twice, or an edit inside another, would corrupt the text.
function withoutNestedEdits(edits: readonly Edit[]): Edit[] {
  const ordered = [...edits].sort((a, b) =>
    a.file === b.file ? a.from - b.from || b.to - a.to : a.file.localeCompare(b.file),
  );
  const kept: Edit[] = [];
  for (const edit of ordered) {
    const last = kept.at(-1);
    if (last?.file !== edit.file || edit.from >= last.to) kept.push(edit);
  }
  return kept;
}

export function indexFromSymbols(
  definitionSymbols: readonly Sym[],
  useSymbols: readonly Sym[],
  unitScope?: LatexUnitScope,
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
  const poolOf = (kind: DefKind, name: string, from: Sym): readonly Sym[] =>
    defsByKey.get(defKey(kind, nameTarget(kind, from).scope, name)) ?? [];
  const selection = (kind: DefKind, from: Sym, pool: readonly Sym[]): readonly Sym[] =>
    unitScope?.select(from.file, pool, symbolFile, kind === "bibentry").items ?? pool;
  const lookup = (kind: DefKind, from: Sym, name = from.name): Sym | null => {
    const { file } = nameTarget(kind, from);
    const candidates = poolOf(kind, name, from);
    if (file !== null) return candidates.find((d) => d.file === file) ?? null;
    if (kind === "file") return candidates[0] ?? null;
    const seen = selection(kind, from, candidates);
    return seen.find(hasNameRange) ?? seen[0] ?? null;
  };
  const namedUses = (kind: DefKind, name: string, target: NameTarget): Sym[] => {
    const useKinds = DEF_TO_USES[kind] ?? [];
    return uses.filter(
      (u) =>
        useKinds.includes(u.kind as UseKind) &&
        u.name === name &&
        sameTarget(nameTarget(kind, u), target),
    );
  };
  // Units decide who a name belongs to only for names defined in LaTeX. A .bib
  // entry is read by every document, so its uses stay project-wide.
  const scopedOrigin = (origin: Sym): LatexUnitScope | undefined =>
    engineForPath(origin.file) === "latex" ? unitScope : undefined;
  // A use that names its file, such as [text](a.tex#label), is already bound.
  const namesItsFile = (kind: DefKind, use: Sym): boolean =>
    nameTarget(kind, use).file !== null;
  const renamePool = (kind: DefKind, name: string, from: Sym): Sym[] =>
    poolOf(kind, name, from).filter(hasNameRange);
  // A rename dialog can outlive the index it was opened on, so a definition is
  // found again by its place, not by the object it was. It may be gone.
  const currentDefinition = (definition: Sym): Sym | null => {
    const sameFile = renamePool(definition.kind as DefKind, definition.name, definition).filter(
      (d) => d.file === definition.file,
    );
    return sameFile.find((d) => d.nameFrom === definition.nameFrom) ?? sameFile[0] ?? null;
  };
  let definitionsByPlace: Map<string, Sym> | null = null;
  // A redefinition's name is also a candidate use, so a use can sit on a definition.
  const definitionSite = (use: Sym): Sym | undefined => {
    if (!definitionsByPlace) {
      definitionsByPlace = new Map();
      for (const d of defs) {
        if (d.kind !== "section" && hasNameRange(d)) {
          definitionsByPlace.set(`${d.file}\0${d.nameFrom}`, d);
        }
      }
    }
    const site = definitionsByPlace.get(`${use.file}\0${use.nameFrom}`);
    return site?.name === use.name ? site : undefined;
  };
  const usesOf = (kind: DefKind, name: string, origin: Sym): Sym[] => {
    const candidates = namedUses(kind, name, nameTarget(kind, origin));
    if (!scopedOrigin(origin)) return candidates;
    const pool = poolOf(kind, name, origin);
    if (isDefKind(origin.kind)) {
      const definition = currentDefinition(origin);
      return candidates.filter(
        (u) =>
          namesItsFile(kind, u) ||
          (definition !== null && selection(kind, u, pool).includes(definition)),
      );
    }
    return candidates.filter(
      (u) =>
        namesItsFile(kind, u) ||
        (selection(kind, u, pool).length === 0 &&
          unitScope?.connected(u.file, origin.file)),
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

  // TeX knows one environment by one name, so \\newenvironment{x} and
  // \\renewenvironment{x} rename as one, or the compile stops at the other.
  const isOneName = (kind: DefKind): boolean => kind === "environment" || kind === "theorem";

  // RenameDialog asks on every keystroke of the new name, so the walk across
  // units runs once per definition.
  const closures = new Map<Sym, LatexRenameClosure<Sym, Sym>>();
  const renameTargets = (
    kind: DefKind,
    name: string,
    origin: Sym,
    def: Sym | null,
  ): LatexRenameClosure<Sym, Sym> => {
    const scope = scopedOrigin(origin);
    if (!def) return { defs: [], uses: usesOf(kind, name, origin) };
    if (!scope) {
      return {
        defs: isOneName(kind) ? renamePool(kind, name, def) : [def],
        uses: usesOf(kind, name, origin),
      };
    }
    const cached = closures.get(def);
    if (cached) return cached;
    const named = namedUses(kind, name, { ...nameTarget(kind, def), file: null });
    const closure = scope.renameClosure({
      definition: def,
      pool: renamePool(kind, name, def),
      uses: named.filter((u) => !namesItsFile(kind, u)),
      definitionFile: symbolFile,
      fileOfUse: symbolFile,
      citation: kind === "bibentry",
      definitionAt: definitionSite,
      together: isOneName(kind),
    });
    const renamedFiles = new Set(closure.defs.map(symbolFile));
    const targets = {
      defs: closure.defs,
      uses: [
        ...closure.uses,
        ...named.filter((u) => renamedFiles.has(nameTarget(kind, u).file ?? "")),
      ],
    };
    closures.set(def, targets);
    return targets;
  };

  // The definition a rename from `sym` starts at. Null for an unresolved use, a
  // stale definition that is gone, or a name only known by its whole extent.
  const renameTarget = (sym: Sym): Sym | null => {
    if (isDefKind(sym.kind) && hasNameRange(sym)) return currentDefinition(sym);
    const site = definitionSite(sym);
    if (site) return site;
    const found = definitionFor(sym);
    if (!found || hasNameRange(found)) return found;
    const kind = found.kind as DefKind;
    if (!isDefKind(sym.kind) && namesItsFile(kind, sym)) return null;
    const current = currentDefinition(found);
    if (current) return current;
    const pool = renamePool(kind, found.name, found);
    const seen = unitScope?.select(sym.file, pool, symbolFile, kind === "bibentry");
    if (seen && seen.items.length > 1 && seen.tier !== "unit") return null;
    return (seen?.items ?? pool)[0] ?? null;
  };

  // Would the rename change which definition a use lands on, when nobody
  // asked for that? `targets` are the definitions and uses being renamed.
  const collidesThroughUses = (
    scope: LatexUnitScope,
    kind: DefKind,
    newName: string,
    originScope: string,
    targets: LatexRenameClosure<Sym, Sym>,
  ): boolean => {
    const pool = defsByKey.get(defKey(kind, originScope, newName)) ?? [];
    if (pool.length === 0) return false;
    const renamed = new Set(targets.defs);
    const citation = kind === "bibentry";
    const after = [...pool, ...targets.defs];
    const seenAfter = (file: string) => scope.select(file, after, symbolFile, citation).items;
    const landsElsewhere = (u: Sym) => seenAfter(u.file).some((d) => !renamed.has(d));
    // A use sitting on a definition is that definition, not a free use.
    const isFree = (u: Sym) => !namesItsFile(kind, u) && definitionSite(u) === undefined;
    if (targets.uses.some((u) => isFree(u) && landsElsewhere(u))) return true;
    return namedUses(kind, newName, { scope: originScope, file: null }).some(
      (u) =>
        isFree(u) &&
        scope.select(u.file, pool, symbolFile, citation).items.length > 0 &&
        seenAfter(u.file).some((d) => renamed.has(d)),
    );
  };

  const renamePlan = (sym: Sym, newName: string): RenamePlan => {
    const def = renameTarget(sym);
    if (!def && (isDefKind(sym.kind) || definitionFor(sym))) {
      return { edits: [], fileCount: 0, collision: false };
    }
    const kind: DefKind = (def?.kind as DefKind) ?? "label";
    const name = def?.name ?? sym.name;
    const origin = def ?? sym;

    const targets = renameTargets(kind, name, origin, def);
    const originScope = nameTarget(kind, origin).scope;
    const unitScoped = scopedOrigin(origin);
    const anchors = targets.defs.length > 0 ? targets.defs.map(symbolFile) : [origin.file];
    const collision =
      defs.some(
        (d) =>
          d.kind === kind &&
          d.name === newName &&
          d !== def &&
          nameScope(kind, d.file) === originScope &&
          (!unitScoped || anchors.some((file) => unitScoped.sharesScope(file, d.file))),
      ) ||
      (unitScoped !== undefined &&
        newName !== name &&
        collidesThroughUses(unitScoped, kind, newName, originScope, targets));

    const edits = withoutNestedEdits([
      ...targets.defs
        .filter((d) => d.nameTo > d.nameFrom)
        .map((d) => ({ file: d.file, from: d.nameFrom, to: d.nameTo, newText: newName })),
      ...targets.uses.map((u) => ({ file: u.file, from: u.nameFrom, to: u.nameTo, newText: newName })),
    ]);
    edits.sort((a, b) => (a.file === b.file ? b.from - a.from : a.file.localeCompare(b.file)));
    const fileCount = new Set(edits.map((e) => e.file)).size;
    return { edits, fileCount, collision };
  };

  // A use that sees several definitions it cannot tell apart has no answer to
  // "rename which one", so the rename has to start from a definition.
  const renameIsAmbiguous = (sym: Sym): boolean => {
    if (!unitScope || isDefKind(sym.kind) || engineForPath(sym.file) !== "latex") return false;
    if (definitionSite(sym)) return false;
    const def = definitionFor(sym);
    if (!def) return false;
    const kind = def.kind as DefKind;
    if (namesItsFile(kind, sym)) return false;
    const found = unitScope.select(sym.file, renamePool(kind, def.name, sym), symbolFile, kind === "bibentry");
    return found.items.length > 1 && found.tier !== "unit";
  };

  return {
    defs,
    uses,
    symbolAt,
    definitionFor,
    references,
    allReferences,
    renamePlan,
    renameTarget,
    renameIsAmbiguous,
    ...(unitScope ? { unitScope } : {}),
  };
}
