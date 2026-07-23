import { fetchDoiBibtex, fetchArxiv, crossrefSearch, readFileContent, writeFileContent } from "@/lib/tauri";
import { detectInput } from "@/lib/citation/detect";
import { parseEntry, generateCiteKey, setKey, stringifyBibEntry } from "@/lib/citation/bibtex";
import type { ParsedBib } from "@/lib/citation/types";
import { parseCrossrefSearch } from "@/lib/citation/crossref";
import { arxivXmlToBibtex } from "@/lib/citation/arxiv";
import { findKeyByDoi } from "@/lib/citation/dedup";
import type { CitationHit } from "@/lib/citation/types";
import { parseBib } from "@/lib/latex-tools";
import { parseRis } from "@/lib/citation/ris";
import { parseEndNoteXml } from "@/lib/citation/endnote-xml";
import { parseZoteroRdf } from "@/lib/citation/zotero-rdf";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useIndexStore } from "@/store/project-index";
import { getEditorView, insertAtCursor } from "@/components/editor/cm/controller";

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

function pickTargetBib(): { path: string; content: string } {
  const files = useFilesStore.getState();
  const mainContent = files.files[files.mainDoc]?.content ?? "";
  const bibPaths = files.tree.filter((f) => !f.is_dir && f.path.endsWith(".bib")).map((f) => f.path);

  let path: string | null = null;
  const m = files.engine.capabilities.formatting_profile === "latex"
    ? /\\(?:bibliography|addbibresource)\s*\{([^}]*)\}/.exec(mainContent)
    : null;
  if (m) {
    const ref = m[1].split(",")[0].trim();
    const want = ref.endsWith(".bib") ? ref : `${ref}.bib`;
    path = bibPaths.find((p) => p === want || p.endsWith(`/${want}`) || basename(p) === basename(want)) ?? null;
  }
  if (!path) path = bibPaths[0] ?? "references.bib";
  return { path, content: files.files[path]?.content ?? "" };
}

export async function addCitation(bibtex: string): Promise<{ key: string } | { error: string }> {
  const parsed = parseEntry(bibtex);
  if (!parsed) return { error: "Could not parse the citation." };

  const files = useFilesStore.getState();
  const id = files.projectId;
  const target = pickTargetBib();
  let content = target.content;
  if (!content && id && files.files[target.path] === undefined) {
    content = await readFileContent(id, target.path).catch(() => "");
  }

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
    } catch (e) {
      return { error: `Could not write ${target.path}: ${e}` };
    }
  } else if (id) {
    try {
      await writeFileContent(id, target.path, newContent);
    } catch (e) {
      return { error: `Could not write ${target.path}: ${e}` };
    }
  }

  if (files.engine.capabilities.formatting_profile === "typst" && id) {
    const mainPath = files.mainDoc;
    const main = files.files[mainPath]?.content ?? await readFileContent(id, mainPath).catch(() => "");
    if (!/#bibliography\s*\(/.test(main)) {
      const next = ensureTypstBibliography(main, target.path);
      if (files.files[mainPath] !== undefined) {
        files.setContent(mainPath, next);
        await useFilesStore.getState().saveFile(mainPath);
      } else {
        await writeFileContent(id, mainPath, next);
      }
    }
  }

  insertCite(key);
  void useIndexStore.getState().rebuildFromDisk();
  return { key };
}

export interface BatchImportResult {
  imported: number;
  duplicates: number;
  errors: string[];
}

// Imports a whole reference library (from Zotero/EndNote/RIS/BibTeX) into the
// project's bib file in one write, deduping by DOI against both the existing
// file and the rest of the batch. Unlike addCitation, this never inserts a
// \cite{} at the cursor - a bulk import is a library, not a citation action.
export async function addCitations(entries: ParsedBib[]): Promise<BatchImportResult> {
  if (!entries.length) return { imported: 0, duplicates: 0, errors: [] };

  const files = useFilesStore.getState();
  const id = files.projectId;
  const target = pickTargetBib();
  let content = target.content;
  if (!content && id && files.files[target.path] === undefined) {
    content = await readFileContent(id, target.path).catch(() => "");
  }

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

  if (!newBlocks.length) return { imported: 0, duplicates, errors: [] };

  const newContent = content.trim()
    ? `${content.trimEnd()}\n\n${newBlocks.join("\n\n")}\n`
    : `${newBlocks.join("\n\n")}\n`;

  const errors: string[] = [];
  if (files.files[target.path] !== undefined) {
    files.setContent(target.path, newContent);
    try {
      await useFilesStore.getState().saveFile(target.path);
    } catch (e) {
      errors.push(`Could not write ${target.path}: ${e}`);
    }
  } else if (id) {
    try {
      await writeFileContent(id, target.path, newContent);
    } catch (e) {
      errors.push(`Could not write ${target.path}: ${e}`);
    }
  }

  if (!errors.length && files.engine.capabilities.formatting_profile === "typst" && id) {
    const mainPath = files.mainDoc;
    const main = files.files[mainPath]?.content ?? (await readFileContent(id, mainPath).catch(() => ""));
    if (!/#bibliography\s*\(/.test(main)) {
      const next = ensureTypstBibliography(main, target.path);
      if (files.files[mainPath] !== undefined) {
        files.setContent(mainPath, next);
        await useFilesStore.getState().saveFile(mainPath);
      } else {
        await writeFileContent(id, mainPath, next);
      }
    }
  }

  if (!errors.length) void useIndexStore.getState().rebuildFromDisk();
  return { imported: newBlocks.length, duplicates, errors };
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
if (typeof window !== "undefined" && import.meta.env.DEV) {
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
