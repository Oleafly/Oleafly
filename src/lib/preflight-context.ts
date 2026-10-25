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
import { labelScope } from "@/lib/project-intelligence/resolution";
import { engineForPath } from "@/lib/project-intelligence/source";

// The references and project contexts preflight runs on. The preflight store
// builds them from the open project; the CLI's golden fixtures build them from
// files on disk, and crates/oleafly-preflight/src/context.rs ports this file.

export interface PreflightContextInput {
  readonly mainDoc: string;
  /** Non-directory tree paths, in the file tree's order. */
  readonly treePaths: readonly string[];
  /** Texts the project index read. */
  readonly indexTexts: Readonly<Record<string, string>>;
  /** Editor buffers, which win over the index texts. */
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

// The .bib files the document loads, so conflict copies from sync clients,
// backups and template samples next to them don't count. A project that
// declares nothing keeps every .bib file.
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

function collectLabelFacts(index: ProjectIndex | null): {
  duplicateLabels: { label: string; files: string[] }[];
  unreferencedLabels: { label: string; file: string }[];
} {
  const labelFiles = new Map<string, { label: string; files: Set<string> }>();
  // A reference counts for the label it points at, the way rename resolves it:
  // same engine, and for a `file#anchor` link, only a label in the named file.
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
  const isReferenced = (definition: Sym) => {
    const { scope } = nameTarget("label", definition);
    return (
      referencedLabels.has(referenceKey(scope, null, definition.name)) ||
      referencedLabels.has(referenceKey(scope, definition.file, definition.name))
    );
  };
  for (const definition of index?.defs ?? []) {
    if (definition.kind !== "label") continue;
    // Labels are pooled the way rename and resolution pool them: one pool per
    // engine, so a LaTeX and a Typst label may share a name, and a Markdown
    // anchor in its own file's pool, so one heading in two files is no clash.
    const key = `${nameTarget("label", definition).scope}\0${definition.name}`;
    const entry = labelFiles.get(key) ?? { label: definition.name, files: new Set<string>() };
    entry.files.add(definition.file);
    labelFiles.set(key, entry);
  }
  const duplicateLabels = [...labelFiles.values()]
    .filter((entry) => entry.files.size > 1)
    .map((entry) => ({ label: entry.label, files: [...entry.files] }));
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
  // Labels and bib keys come from the shared project index (the single parser);
  // runRefsRules also re-scans the active source for its own labels, so a just-
  // typed label resolves even before the debounced index catches up.
  const { index } = input;
  // The refs rules lint the project's LaTeX sources whatever tab is open, so a
  // \ref reaches the labels in the main document's pool. A main document of
  // no known engine keeps every label rather than flag each \ref.
  const mainEngine = engineForPath(input.mainDoc);
  const mainScope = mainEngine ? labelScope(mainEngine, input.mainDoc) : null;
  const definedLabels = index
    ? index.defs
        .filter((d) => d.kind === "label" && (mainScope === null || nameTarget("label", d).scope === mainScope))
        .map((d) => d.name)
    : [];
  const bibKeys = index ? index.defs.filter((d) => d.kind === "bibentry").map((d) => d.name) : [];
  // Duplicate detection needs DOIs, which the index does not store, so parse the
  // loaded .bib files for those.
  const texts = projectTexts(input);

  // Project files (for missing-asset checks) must include images too, so use the
  // full tree rather than the index (which only indexes source files).
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
  const { duplicateLabels, unreferencedLabels } = collectLabelFacts(index);
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
