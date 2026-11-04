import { maskComments } from "@oleafly/preflight";
import type { ProjectContext, RefsContext } from "@oleafly/preflight";
import {
  type BibliographyEngine,
  bibliographyDeclarations,
  bibliographyEngineForCommand,
  resolveBibliographyPath,
} from "@oleafly/latex";
import { parseEntry } from "@/lib/citation/bibtex";
import { nameTarget } from "@/lib/index/build";
import { parseFile } from "@/lib/index/parse-file";
import type { ProjectIndex, Sym } from "@/lib/index/types";
import { byCodePoint, type LatexUnitScope } from "@/lib/project-intelligence/latex-units";
import { labelScope } from "@/lib/project-intelligence/resolution";
import { engineForPath } from "@/lib/project-intelligence/source";

export interface PreflightContextInput {
  readonly mainDoc: string;
  readonly treePaths: readonly string[];
  readonly indexTexts: Readonly<Record<string, string>>;
  readonly openTexts: Readonly<Record<string, string>>;
  readonly index: ProjectIndex | null;
}

type DeclaredBibliography = { raw: string; file: string; engine: BibliographyEngine };

function declaredBibliographies(texts: Readonly<Record<string, string>>): DeclaredBibliography[] {
  const declarations: DeclaredBibliography[] = [];
  for (const [path, content] of Object.entries(texts)) {
    if (!/\.(?:tex|ltx)$/i.test(path)) continue;
    for (const declaration of bibliographyDeclarations(maskComments(content))) {
      declarations.push({
        raw: declaration.raw,
        file: path,
        engine: bibliographyEngineForCommand(declaration.command),
      });
    }
  }
  return declarations;
}

function unresolvedBibliographiesFor(
  declared: readonly DeclaredBibliography[],
  knownPaths: readonly string[],
): { file: string; name: string }[] {
  const unresolved: { file: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const declaration of declared) {
    const resolved = resolveBibliographyPath(
      declaration.raw,
      declaration.file,
      knownPaths,
      declaration.engine,
    );
    if (resolved !== null) continue;
    const key = `${declaration.file}\n${declaration.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unresolved.push({ file: declaration.file, name: declaration.raw });
  }
  return unresolved;
}

function declaredBibTexts(
  texts: Readonly<Record<string, string>>,
  declared: readonly DeclaredBibliography[],
  knownPaths: readonly string[],
): Readonly<Record<string, string>> {
  const loaded = new Set(
    declared
      .map((declaration) => resolveBibliographyPath(declaration.raw, declaration.file, knownPaths, declaration.engine))
      .filter((path): path is string => path !== null),
  );
  if (loaded.size === 0) return texts;
  return Object.fromEntries(Object.entries(texts).filter(([path]) => !path.endsWith(".bib") || loaded.has(path)));
}

function collectBibEntries(texts: Readonly<Record<string, string>>): {
  bibEntries: NonNullable<RefsContext["bibEntries"]>;
  duplicateDois: { doi: string; keys: string[] }[];
} {
  const doiToKeys = new Map<string, string[]>();
  const bibEntries: NonNullable<RefsContext["bibEntries"]> = [];
  for (const [path, content] of Object.entries(texts)) {
    if (!path.endsWith(".bib")) continue;
    for (const chunk of content.split(/(?=@\w+\s*\{)/)) {
      const p = parseEntry(chunk.trim());
      if (!p) continue;
      bibEntries.push(p);
      const doi = p.fields.doi?.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
      if (doi) doiToKeys.set(doi, [...(doiToKeys.get(doi) ?? []), p.key]);
    }
  }
  const duplicateDois = [...doiToKeys.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([doi, keys]) => ({ doi, keys }));
  return { bibEntries, duplicateDois };
}

function collectBibKeyDefinitions(
  texts: Readonly<Record<string, string>>,
): NonNullable<RefsContext["bibKeyDefinitions"]> {
  return Object.entries(texts)
    .filter(([path]) => path.endsWith(".bib"))
    .flatMap(([path, content]) => parseFile(path, content).defs)
    .filter((definition) => definition.kind === "bibentry")
    .map((definition) => ({
      key: definition.name,
      file: definition.file,
      line: definition.line,
      from: definition.from,
      to: definition.to,
    }));
}

const CITE_COMMAND =
  /\\(?:cite|citep|citet|citeauthor|citeyear|citealt|parencite|textcite|autocite|nocite)\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g;

function collectCitedKeys(texts: Readonly<Record<string, string>>): string[] {
  const allCitedKeys: string[] = [];
  for (const [path, content] of Object.entries(texts)) {
    if (!/\.(?:tex|ltx)$/i.test(path)) continue;
    for (const match of maskComments(content).matchAll(CITE_COMMAND)) {
      allCitedKeys.push(...match[1].split(",").map((key) => key.trim()).filter(Boolean));
    }
  }
  return allCitedKeys;
}

function symbolFile(symbol: Sym): string {
  return symbol.file;
}

function latexPools(index: ProjectIndex | null): Map<string, Sym[]> {
  const pools = new Map<string, Sym[]>();
  for (const definition of index?.defs ?? []) {
    if (definition.kind !== "label" || engineForPath(definition.file) !== "latex") continue;
    const pool = pools.get(definition.name);
    if (pool) pool.push(definition);
    else pools.set(definition.name, [definition]);
  }
  return pools;
}

type LatexPools = ReadonlyMap<string, readonly Sym[]>;

/** Which labels each file's own document cannot see, by file. */
function collectUnreachableLabels(
  index: ProjectIndex | null,
  pools: LatexPools,
): { file: string; labels: string[] }[] {
  const scope = index?.unitScope;
  if (!scope) return [];
  const byFile = new Map<string, Set<string>>();
  for (const use of index?.uses ?? []) {
    if (use.kind !== "ref" || engineForPath(use.file) !== "latex") continue;
    if (nameTarget("label", use).file !== null) continue;
    const pool = pools.get(use.name);
    if (!pool || scope.select(use.file, pool, symbolFile).items.length > 0) continue;
    const labels = byFile.get(use.file);
    if (labels) labels.add(use.name);
    else byFile.set(use.file, new Set([use.name]));
  }
  return [...byFile.keys()].sort(byCodePoint).map((file) => ({
    file,
    labels: [...(byFile.get(file) ?? [])].sort(byCodePoint),
  }));
}

/** The definitions a reference lands on: the file it names, or its selection. */
function definitionsOfRef(
  use: Sym,
  pool: readonly Sym[],
  scope: LatexUnitScope,
): readonly Sym[] {
  const { file } = nameTarget("label", use);
  if (file !== null) return pool.filter((definition) => definition.file === file);
  return engineForPath(use.file) === "latex" ? scope.select(use.file, pool, symbolFile).items : [];
}

function selectedDefinitions(
  index: ProjectIndex | null,
  pools: LatexPools,
): ReadonlySet<Sym> | null {
  const scope = index?.unitScope;
  if (!scope) return null;
  const selected = new Set<Sym>();
  const seen = new Set<readonly Sym[]>();
  for (const use of index?.uses ?? []) {
    const pool = use.kind === "ref" ? pools.get(use.name) : undefined;
    const items = pool ? definitionsOfRef(use, pool, scope) : [];
    if (seen.has(items)) continue;
    seen.add(items);
    for (const definition of items) selected.add(definition);
  }
  return selected;
}

function collectLabelFacts(
  index: ProjectIndex | null,
  pools: LatexPools,
): {
  duplicateLabels: { label: string; files: string[] }[];
  unreferencedLabels: { label: string; file: string }[];
} {
  const labelFiles = new Map<string, { label: string; files: Set<string>; latex: boolean }>();
  const referenceKey = (scope: string, file: string | null, name: string) => {
    const target = file === null ? "*" : `=${file}`;
    return `${scope}\0${target}\0${name}`;
  };
  const referencedLabels = new Set<string>();
  for (const use of index?.uses ?? []) {
    if (use.kind !== "ref") continue;
    const { scope, file } = nameTarget("label", use);
    referencedLabels.add(referenceKey(scope, file, use.name));
  }
  const selected = selectedDefinitions(index, pools);
  const isReferenced = (definition: Sym) => {
    if (selected && engineForPath(definition.file) === "latex") return selected.has(definition);
    const { scope } = nameTarget("label", definition);
    return (
      referencedLabels.has(referenceKey(scope, null, definition.name)) ||
      referencedLabels.has(referenceKey(scope, definition.file, definition.name))
    );
  };
  for (const definition of index?.defs ?? []) {
    if (definition.kind !== "label") continue;
    const key = `${nameTarget("label", definition).scope}\0${definition.name}`;
    const latex = engineForPath(definition.file) === "latex";
    const entry = labelFiles.get(key) ?? { label: definition.name, files: new Set<string>(), latex };
    entry.files.add(definition.file);
    labelFiles.set(key, entry);
  }
  const unitScope = index?.unitScope;
  const duplicateLabels = [...labelFiles.values()]
    .filter((entry) => entry.files.size > 1)
    .flatMap((entry) =>
      (unitScope && entry.latex ? unitScope.duplicateRows([...entry.files]) : [[...entry.files]]).map(
        (files) => ({ label: entry.label, files }),
      ),
    );
  const unreferencedLabels = (index?.defs ?? [])
    .filter(
      (definition) =>
        definition.kind === "label" &&
        /^(?:fig|figure|tab|table|eq|equation)[:._-]/i.test(definition.name) &&
        !isReferenced(definition),
    )
    .map((definition) => ({ label: definition.name, file: definition.file }));
  return { duplicateLabels, unreferencedLabels };
}

function projectTexts(input: Omit<PreflightContextInput, "index">): Record<string, string> {
  return { ...input.indexTexts, ...input.openTexts };
}

export function buildRefsContext(input: PreflightContextInput): RefsContext {
  const { index } = input;
  const mainEngine = engineForPath(input.mainDoc);
  const mainScope = mainEngine ? labelScope(mainEngine, input.mainDoc) : null;
  const definedLabels = index
    ? index.defs
        .filter((d) => d.kind === "label" && (mainScope === null || nameTarget("label", d).scope === mainScope))
        .map((d) => d.name)
    : [];
  const bibKeys = index ? index.defs.filter((d) => d.kind === "bibentry").map((d) => d.name) : [];
  const texts = projectTexts(input);

  const projectFiles = [...input.treePaths];
  const knownPaths = [...new Set([...projectFiles, ...Object.keys(input.openTexts)])];
  const declared = declaredBibliographies(texts);
  const unresolvedBibliographies = unresolvedBibliographiesFor(declared, knownPaths);
  const bibLoaded = declared.length > 0
    ? unresolvedBibliographies.length === 0
    : bibKeys.length > 0 || knownPaths.some((path) => path.endsWith(".bib"));
  const bibTexts = declaredBibTexts(texts, declared, knownPaths);
  const { bibEntries, duplicateDois } = collectBibEntries(bibTexts);
  const allCitedKeys = collectCitedKeys(texts);
  const currentBibKeys = [...new Set([...bibKeys, ...bibEntries.map((entry) => entry.key)])];
  const pools = latexPools(index);
  const { duplicateLabels, unreferencedLabels } = collectLabelFacts(index, pools);
  const unreachableLabels = collectUnreachableLabels(index, pools);
  const bibKeyDefinitions = collectBibKeyDefinitions(bibTexts);
  return {
    bibKeys: currentBibKeys,
    definedLabels,
    bibLoaded,
    projectFiles,
    unresolvedBibliographies,
    duplicateDois,
    bibEntries,
    allCitedKeys,
    duplicateLabels,
    unreferencedLabels,
    ...(unreachableLabels.length > 0 ? { unreachableLabels } : {}),
    bibKeyDefinitions,
    bibKeyDialect: declared.some((declaration) => declaration.engine === "biblatex") ? "biber" : "bibtex",
  };
}

export function buildProjectContext(input: Omit<PreflightContextInput, "index">): ProjectContext {
  const texts = projectTexts(input);
  const paths = new Set(input.treePaths);
  for (const path of Object.keys(texts)) paths.add(path);
  return {
    mainFile: input.mainDoc,
    files: [...paths].map((path) => ({ path, ...(texts[path] !== undefined ? { content: texts[path] } : {}) })),
  };
}
