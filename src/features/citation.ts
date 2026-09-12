import {
  fetchArxiv,
  crossrefSearch,
  fetchDoiBibtex,
  fetchIsbnBibtex,
  fetchPmidBibtex,
  readFileContent,
} from "@/lib/tauri";
import { detectInput } from "@/lib/citation/detect";
import { parseEntry, generateCiteKey, setKey, stringifyBibEntry } from "@/lib/citation/bibtex";
import type { ParsedBib } from "@/lib/citation/types";
import { parseCrossrefSearch } from "@/lib/citation/crossref";
import { arxivXmlToBibtex } from "@/lib/citation/arxiv";
import { findKeyByDoi } from "@/lib/citation/dedup";
import type { CitationHit } from "@/lib/citation/types";
import { parseBib } from "@/lib/latex-tools";
import {
  type BibliographyEngine,
  bibliographyDeclarations,
  bibliographyEngineForCommand,
  resolveBibliographyPath,
} from "@oleafly/latex";
import { maskComments } from "@/lib/index/parse-file";
import { parseRis } from "@/lib/citation/ris";
import { parseEndNoteXml } from "@/lib/citation/endnote-xml";
import { parseZoteroRdf } from "@/lib/citation/zotero-rdf";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useIndexStore } from "@/store/project-index";
import { getEditorView, insertAtCursor } from "@/components/editor/cm/controller";
import { E2E_HOOKS } from "@/lib/e2e-flags";

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

export async function resolveCitation(
  input: string,
): Promise<{ bibtex?: string; hits?: CitationHit[]; error?: string }> {
  if (useSettingsStore.getState().offline) {
    return { error: "Citation lookup needs the network. Turn off offline mode in Settings." };
  }
  const d = detectInput(input);
  try {
    if (d.kind === "doi") return { bibtex: (await fetchDoiBibtex(d.value)).trim() };
    if (d.kind === "arxiv") {
      const bib = arxivXmlToBibtex(await fetchArxiv(d.value));
      return bib ? { bibtex: bib } : { error: "No arXiv entry found." };
    }
    if (d.kind === "isbn") {
      return { bibtex: (await fetchIsbnBibtex(d.value)).trim() };
    }
    if (d.kind === "pmid") {
      return { bibtex: (await fetchPmidBibtex(d.value)).trim() };
    }
    return { hits: parseCrossrefSearch(await crossrefSearch(d.value)) };
  } catch (e) {
    return { error: String(e) };
  }
}

export async function bibtexForHit(hit: CitationHit): Promise<string> {
  if (hit.doi) {
    try {
      return (await fetchDoiBibtex(hit.doi)).trim();
    } catch {
      /* fall through to a synthesized entry */
    }
  }
  const fields = [
    `  title = {${hit.title}}`,
    hit.authors.length ? `  author = {${hit.authors.join(" and ")}}` : "",
    hit.year ? `  year = {${hit.year}}` : "",
    hit.venue ? `  journal = {${hit.venue}}` : "",
    hit.doi ? `  doi = {${hit.doi}}` : "",
  ].filter(Boolean);
  return `@article{ref,\n${fields.join(",\n")}\n}`;
}

export function ensureTypstBibliography(source: string, path: string): string {
  if (/#bibliography\s*\(/.test(source)) return source;
  const safePath = path.replaceAll("\\", "/").replaceAll('"', '\\"');
  return `${source.trimEnd()}\n\n#bibliography("${safePath}")\n`;
}

export function ensureMarkdownBibliography(source: string, path: string): string {
  const normalizedPath = path.replaceAll("\\", "/");
  const declaration = `bibliography: ${JSON.stringify(normalizedPath)}`;
  const frontMatter = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!frontMatter) return `---\n${declaration}\n---\n\n${source}`;
  if (/^bibliography\s*:/m.test(frontMatter[1])) return source;
  const closingOffset = frontMatter[0].lastIndexOf("---");
  return `${source.slice(0, closingOffset)}${declaration}\n${source.slice(closingOffset)}`;
}

function unquoteYamlScalar(value: string): string | null {
  const withoutComment = value.replace(/\s+#.*$/, "").trim();
  if (!withoutComment) return null;
  if (withoutComment.startsWith('"') && withoutComment.endsWith('"')) {
    try {
      const parsed = JSON.parse(withoutComment);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return null;
    }
  }
  if (withoutComment.startsWith("'") && withoutComment.endsWith("'")) {
    return withoutComment.slice(1, -1).replaceAll("''", "'");
  }
  return withoutComment;
}

export function markdownBibliographyPaths(source: string): string[] {
  const frontMatter = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!frontMatter) return [];
  const lines = frontMatter[1].split(/\r?\n/);
  const declaration = lines.findIndex((line) => /^bibliography\s*:/.test(line));
  if (declaration < 0) return [];
  const value = lines[declaration].replace(/^bibliography\s*:\s*/, "").trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map(unquoteYamlScalar)
      .filter((path): path is string => Boolean(path));
  }
  const scalar = unquoteYamlScalar(value);
  if (scalar) return [scalar];

  const paths: string[] = [];
  for (const line of lines.slice(declaration + 1)) {
    const item = /^\s*-\s+(.*?)\s*$/.exec(line);
    if (item) {
      const path = unquoteYamlScalar(item[1]);
      if (path) paths.push(path);
      continue;
    }
    if (!/^\s/.test(line)) break;
  }
  return paths;
}

function resolveDeclaredBib(reference: string, bibPaths: string[], addExtension: boolean): string | null {
  const normalized = reference.replaceAll("\\", "/").replace(/^\.\//, "");
  const wanted = addExtension && !normalized.toLowerCase().endsWith(".bib")
    ? `${normalized}.bib`
    : normalized;
  const exact = bibPaths.find((path) => path === wanted);
  if (exact) return exact;
  const suffix = bibPaths.filter((path) => path.endsWith(`/${wanted}`));
  if (suffix.length === 1) return suffix[0];
  const sameBasename = bibPaths.filter((path) => basename(path) === basename(wanted));
  if (sameBasename.length === 1) return sameBasename[0];
  if (
    wanted.toLowerCase().endsWith(".bib")
    && !wanted.startsWith("/")
    && !wanted.includes(":")
    && !wanted.split("/").some((part) => part === ".." || part === "")
  ) {
    return wanted;
  }
  return null;
}

function citationBibliographyDeclarations(
  profile: string,
  mainContent: string,
): { raw: string; engine: BibliographyEngine }[] {
  if (profile === "latex") {
    return bibliographyDeclarations(maskComments(mainContent)).map((declaration) => ({
      raw: declaration.raw,
      engine: bibliographyEngineForCommand(declaration.command),
    }));
  }
  if (profile === "typst") {
    const match = /#bibliography\s*\(\s*["']([^"']+)["']/.exec(mainContent);
    return match ? [{ raw: match[1], engine: "typst" as const }] : [];
  }
  if (profile === "markdown") {
    return markdownBibliographyPaths(mainContent).map((raw) => ({ raw, engine: "markdown" as const }));
  }
  return [];
}

export function selectCitationBibliography(
  profile: string,
  mainContent: string,
  bibPaths: string[],
  declaringFile = "",
): string {
  const declarations = citationBibliographyDeclarations(profile, mainContent);
  for (const declaration of declarations) {
    const shared = resolveBibliographyPath(
      declaration.raw,
      declaringFile,
      bibPaths,
      declaration.engine,
    );
    if (shared) return shared;
  }
  for (const declaration of declarations) {
    const resolved = resolveDeclaredBib(declaration.raw, bibPaths, declaration.engine === "latex");
    if (resolved) return resolved;
  }
  return bibPaths[0] ?? "references.bib";
}

function pickTargetBib(files: ReturnType<typeof useFilesStore.getState>, source?: string): { path: string; content: string } {
  // Look for \bibliography in the document that actually compiles, which a
  // `% !TEX root` comment in the active file may redirect.
  const effectiveMain = resolveEffectiveMainDoc().mainDoc;
  const declaringFile = source !== undefined ? files.mainDoc : effectiveMain;
  const mainContent = source ?? files.files[effectiveMain]?.content ?? "";
  const bibPaths = files.tree.filter((f) => !f.is_dir && f.path.endsWith(".bib")).map((f) => f.path);

  const path = selectCitationBibliography(
    files.engine.capabilities.formatting_profile,
    mainContent,
    bibPaths,
    declaringFile,
  );
  return { path, content: files.files[path]?.content ?? "" };
}

function assertCitationProject(projectId: string | null): void {
  if (useFilesStore.getState().projectId !== projectId) {
    throw new Error("The project changed during citation import. Try again in the original project.");
  }
}

function validateCitationFiles(files: ReturnType<typeof useFilesStore.getState>, targetPath: string): void {
  assertCitationProject(files.projectId);
  const current = useFilesStore.getState();
  for (const path of [targetPath, files.mainDoc]) {
    if (current.files[path]?.content !== files.files[path]?.content) {
      throw new Error(`${path} changed during citation import. Try again.`);
    }
  }
}

async function loadCitationFiles(files: ReturnType<typeof useFilesStore.getState>) {
  const id = files.projectId;
  const profile = files.engine.capabilities.formatting_profile;
  const read = async (path: string, allowMissing = false) => {
    try {
      return files.files[path]?.content ?? (id ? await readFileContent(id, path, allowMissing) : "");
    } catch (error) {
      throw new Error(`Could not read ${path}: ${error}`);
    }
  };
  const main = id && (profile === "typst" || profile === "markdown")
    ? await read(files.mainDoc)
    : undefined;
  const target = pickTargetBib(files, main);
  const content = await read(target.path, true);

  return { target, content, main };
}

export async function bibliographyTargetForProject(): Promise<
  { path: string; exists: boolean; content: string } | null
> {
  const files = useFilesStore.getState();
  if (!files.projectId) return null;
  const loaded = await loadCitationFiles(files);
  const exists = files.tree.some(
    (entry) => !entry.is_dir && entry.path === loaded.target.path,
  );
  return { path: loaded.target.path, exists, content: loaded.content };
}

export async function addCitation(bibtex: string): Promise<{ key: string } | { error: string }> {
  const parsed = parseEntry(bibtex);
  if (!parsed) return { error: "Could not parse the citation." };

  const files = useFilesStore.getState();
  const id = files.projectId;
  let loaded: Awaited<ReturnType<typeof loadCitationFiles>>;
  try {
    loaded = await loadCitationFiles(files);
    validateCitationFiles(files, loaded.target.path);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  const { target, content } = loaded;

  const doi = parsed.fields.doi;
  if (doi) {
    const existing = findKeyByDoi(content, doi);
    if (existing) {
      insertCite(existing);
      return { key: existing };
    }
  }

  const idx = useIndexStore.getState().index;
  const existingKeys = new Set<string>(idx ? idx.defs.filter((d) => d.kind === "bibentry").map((d) => d.name) : []);
  for (const km of content.matchAll(/@\w+\s*\{\s*([^,\s}]+)/g)) existingKeys.add(km[1]);

  const key = generateCiteKey(parsed.fields, existingKeys);
  const entry = setKey(bibtex.trim(), key);
  const newContent = content.trim() ? `${content.trimEnd()}\n\n${entry}\n` : `${entry}\n`;

  if (files.files[target.path] !== undefined) {
    files.setContent(target.path, newContent);
    // Persist now instead of waiting for the autosave debounce, so a compile
    // (which reads from disk) resolves the new \cite immediately.
    try {
      await useFilesStore.getState().saveFile(target.path);
      assertCitationProject(id);
    } catch (e) {
      return { error: `Could not write ${target.path}: ${e}` };
    }
  } else if (id) {
    try {
      await useFilesStore.getState().writeProjectFile(id, target.path, newContent);
      assertCitationProject(id);
    } catch (e) {
      return { error: `Could not write ${target.path}: ${e}` };
    }
  }

  const profile = files.engine.capabilities.formatting_profile;
  if ((profile === "typst" || profile === "markdown") && id && loaded.main !== undefined) {
    const mainPath = files.mainDoc;
    const currentMain = useFilesStore.getState().files[mainPath];
    const main = currentMain?.content ?? loaded.main;
    const next = profile === "typst"
      ? ensureTypstBibliography(main, target.path)
      : ensureMarkdownBibliography(main, target.path);
    if (next !== main) {
      if (currentMain !== undefined) {
        files.setContent(mainPath, next);
        await useFilesStore.getState().saveFile(mainPath);
      } else {
        await useFilesStore.getState().writeProjectFile(id, mainPath, next);
      }
    }
  }

  if (useFilesStore.getState().projectId !== id) {
    return { error: "The project changed during citation import. The citation was not inserted." };
  }
  insertCite(key);
  await useIndexStore.getState().rebuildFromDisk();
  return { key };
}

export interface BatchImportResult {
  imported: number;
  duplicates: number;
  errors: string[];
  bibPath?: string;
}

// Imports a whole reference library (from Zotero/EndNote/RIS/BibTeX) into the
// project's bib file in one write, deduping by DOI against both the existing
// file and the rest of the batch. Unlike addCitation, this never inserts a
// \cite{} at the cursor - a bulk import is a library, not a citation action.
export async function addCitations(entries: ParsedBib[]): Promise<BatchImportResult> {
  if (!entries.length) return { imported: 0, duplicates: 0, errors: [] };

  const files = useFilesStore.getState();
  const id = files.projectId;
  let loaded: Awaited<ReturnType<typeof loadCitationFiles>>;
  try {
    loaded = await loadCitationFiles(files);
    validateCitationFiles(files, loaded.target.path);
  } catch (error) {
    return { imported: 0, duplicates: 0, errors: [error instanceof Error ? error.message : String(error)] };
  }
  const { target, content } = loaded;

  const idx = useIndexStore.getState().index;
  const existingKeys = new Set<string>(idx ? idx.defs.filter((d) => d.kind === "bibentry").map((d) => d.name) : []);
  for (const km of content.matchAll(/@\w+\s*\{\s*([^,\s}]+)/g)) existingKeys.add(km[1]);

  const seenDois = new Set<string>();
  const newBlocks: string[] = [];
  let duplicates = 0;
  for (const entry of entries) {
    const doi = entry.fields.doi?.trim().toLowerCase();
    if (doi && (findKeyByDoi(content, doi) || seenDois.has(doi))) {
      duplicates++;
      continue;
    }
    if (doi) seenDois.add(doi);
    const key = generateCiteKey(entry.fields, existingKeys);
    existingKeys.add(key);
    newBlocks.push(stringifyBibEntry({ ...entry, key }));
  }

  if (!newBlocks.length) return { imported: 0, duplicates, errors: [], bibPath: target.path };

  const newContent = content.trim()
    ? `${content.trimEnd()}\n\n${newBlocks.join("\n\n")}\n`
    : `${newBlocks.join("\n\n")}\n`;

  const errors: string[] = [];
  if (files.files[target.path] !== undefined) {
    files.setContent(target.path, newContent);
    try {
      await useFilesStore.getState().saveFile(target.path);
      assertCitationProject(id);
    } catch (e) {
      errors.push(`Could not write ${target.path}: ${e}`);
    }
  } else if (id) {
    try {
      await useFilesStore.getState().writeProjectFile(id, target.path, newContent);
      assertCitationProject(id);
    } catch (e) {
      errors.push(`Could not write ${target.path}: ${e}`);
    }
  }

  const profile = files.engine.capabilities.formatting_profile;
  if (!errors.length && (profile === "typst" || profile === "markdown") && id && loaded.main !== undefined) {
    const mainPath = files.mainDoc;
    const currentMain = useFilesStore.getState().files[mainPath];
    const main = currentMain?.content ?? loaded.main;
    const next = profile === "typst"
      ? ensureTypstBibliography(main, target.path)
      : ensureMarkdownBibliography(main, target.path);
    if (next !== main) {
      if (currentMain !== undefined) {
        files.setContent(mainPath, next);
        await useFilesStore.getState().saveFile(mainPath);
      } else {
        await useFilesStore.getState().writeProjectFile(id, mainPath, next);
      }
    }
  }

  if (useFilesStore.getState().projectId !== id) {
    errors.push("The project changed during citation import.");
  }
  if (!errors.length) await useIndexStore.getState().rebuildFromDisk();
  return { imported: newBlocks.length, duplicates, errors, bibPath: target.path };
}

export function parseCitationFile(filename: string, text: string): ParsedBib[] | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "rdf") return parseZoteroRdf(text);
  if (ext === "xml") return parseEndNoteXml(text);
  if (ext === "ris") return parseRis(text);
  if (ext === "bib") return parseBib(text).entries;
  return null;
}

// E2E / devtools hook: the native test bridge cannot drive a real file input,
// so specs feed file text in directly through the same parse/import path the
// Connect Sources dialog uses.
if (typeof window !== "undefined" && E2E_HOOKS) {
  const w = window as unknown as {
    __importCitationFile?: (name: string, text: string) => Promise<BatchImportResult | { error: string }>;
  };
  w.__importCitationFile = async (name, text) => {
    const entries = parseCitationFile(name, text);
    if (!entries) return { error: `Unrecognized file type: ${name}` };
    if (!entries.length) return { error: "No references found in that file." };
    return addCitations(entries);
  };
}

function insertCite(key: string) {
  const v = getEditorView();
  if (!v) return;
  const files = useFilesStore.getState();
  const extension = files.activePath?.split(".").pop()?.toLowerCase();
  if (!extension || !files.engine.source_extensions.includes(extension)) return;
  const profile = files.engine.capabilities.formatting_profile;
  insertAtCursor(profile === "typst" ? `@${key}` : profile === "markdown" ? `[@${key}]` : `\\cite{${key}}`);
}
