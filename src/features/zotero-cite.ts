import type {
  ZoteroExportStyle,
  ZoteroHit,
  ZoteroProjectLink,
} from "@oleafly/backend-port";
import { resolveBibliographyPath } from "@oleafly/latex";
import { i18n } from "@/i18n";
import {
  declaredBibliographyFiles,
  rememberBibliography,
  rememberedBibliography,
} from "@/lib/citation/bibliography-choices";
import {
  ensureMarkdownBibliography,
  ensureTypstBibliography,
  markdownBibliographyPaths,
} from "@/lib/citation/declarations";
import { parseEntry } from "@/lib/citation/bibtex";
import { bibtexToHayagriva, isHayagrivaPath } from "@/lib/citation/hayagriva";
import { hasTypstBibliography } from "@/lib/citation/typst-bibliography";
import {
  readFileContent,
  zoteroLibraryExport,
  zoteroLibraryItems,
  zoteroLibraryLookup,
  zoteroProjectLinks,
  zoteroUpdateProjectLinks,
} from "@/lib/tauri";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import {
  appendEntries,
  bibKeyIndex,
  bibStyleOf,
  ensureLatexBibliography,
  entryHash,
  findEntry,
  latexHasBibliography,
  latexUsesBiblatex,
  normalizeDoi,
  replaceEntry,
  withEntryKey,
} from "@/lib/zotero/bib-text";
import { collisionSuffix } from "@/lib/zotero/keys";
import { askHandListMove, handListEntries, handListText, type HandListRequest } from "./zotero-hand-bibliography";
import { useFilesStore } from "@/store/files";
import { projectFolderIsReadOnly, readOnlyFolderMessage } from "@/store/folder-access";
import { useIndexStore } from "@/store/project-index";
import { useSettingsStore } from "@/store/settings";

export interface ZoteroPick {
  readonly hit: ZoteroHit;
  readonly key: string;
}

export interface ProjectBibliography {
  readonly keys: ReadonlySet<string>;
  readonly doiToKey: ReadonlyMap<string, string>;
  readonly links: Readonly<Record<string, ZoteroProjectLink>>;
}

export interface EnsureOptions {
  readonly chooseBibliography?: (choices: readonly string[]) => Promise<string | null>;
  readonly confirmHandList?: (request: HandListRequest) => Promise<boolean>;
}

export interface EnsureResult {
  readonly added: string[];
  readonly reused: string[];
  readonly bibPath: string | null;
  readonly error?: string;
}

export interface MissingReport {
  readonly found: ZoteroPick[];
  readonly duplicates: { key: string; existing: string }[];
  readonly missing: string[];
}

export interface StaleEntry {
  readonly key: string;
  readonly bib: string;
  readonly hit: ZoteroHit;
  readonly link: ZoteroProjectLink;
  readonly handEdited: boolean;
}

type Profile = "latex" | "typst" | "markdown" | string;

const FALLBACK_BIBLIOGRAPHY = "references.bib";
const linksByProject = new Map<string, Record<string, ZoteroProjectLink>>();
const linkLoads = new Map<string, Promise<Record<string, ZoteroProjectLink>>>();
let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

function profile(): Profile {
  return useFilesStore.getState().engine.capabilities.formatting_profile;
}

function bibPaths(): string[] {
  return useFilesStore
    .getState()
    .tree.filter((entry) => !entry.is_dir && /\.bib$/i.test(entry.path))
    .map((entry) => entry.path);
}

function writableBibPaths(): string[] {
  return useFilesStore
    .getState()
    .tree.filter((entry) => !entry.is_dir && !entry.read_only && /\.bib$/i.test(entry.path))
    .map((entry) => entry.path);
}

const written = new Map<string, { projectId: string; text: string; previous: string | undefined }>();

function knownText(path: string): string | undefined {
  return useFilesStore.getState().files[path]?.content ?? useIndexStore.getState().texts[path];
}

function projectText(path: string): string | undefined {
  const known = knownText(path);
  const recent = written.get(path);
  if (recent && recent.projectId === useFilesStore.getState().projectId && (known === undefined || known === recent.previous)) {
    return recent.text;
  }
  return known;
}

async function readText(path: string, exists: boolean): Promise<string> {
  const known = projectText(path);
  if (known !== undefined) return known;
  const projectId = useFilesStore.getState().projectId;
  if (!projectId || !exists) return "";
  return readFileContent(projectId, path, true);
}

export function projectLinks(projectId: string | null = useFilesStore.getState().projectId): Readonly<Record<string, ZoteroProjectLink>> {
  return (projectId && linksByProject.get(projectId)) || {};
}

export function loadProjectLinks(projectId: string): Promise<Record<string, ZoteroProjectLink>> {
  const cached = linksByProject.get(projectId);
  if (cached) return Promise.resolve(cached);
  let pending = linkLoads.get(projectId);
  if (!pending) {
    pending = zoteroProjectLinks(projectId)
      .then((links) => {
        linksByProject.set(projectId, links);
        return links;
      })
      .finally(() => linkLoads.delete(projectId));
    linkLoads.set(projectId, pending);
  }
  return pending;
}

async function saveLinks(projectId: string, changes: Record<string, ZoteroProjectLink | null>): Promise<void> {
  if (Object.keys(changes).length === 0) return;
  const links = await zoteroUpdateProjectLinks(projectId, changes);
  linksByProject.set(projectId, links);
}

export function projectBibliography(projectId: string | null = useFilesStore.getState().projectId): ProjectBibliography {
  const keys = new Set<string>();
  const doiToKey = new Map<string, string>();
  for (const path of bibPaths()) {
    const text = projectText(path);
    if (text === undefined) continue;
    const index = bibKeyIndex(text);
    for (const key of index.keys) keys.add(key);
    for (const [doi, key] of index.doiToKey) if (!doiToKey.has(doi)) doiToKey.set(doi, key);
  }
  return { keys, doiToKey, links: projectLinks(projectId) };
}

function sameItem(link: ZoteroProjectLink | undefined, hit: ZoteroHit): boolean {
  return link !== undefined && link.library === hit.library && link.itemKey === hit.itemKey;
}

export function existingKeyForHit(hit: ZoteroHit, project: ProjectBibliography = projectBibliography()): string | null {
  for (const [key, link] of Object.entries(project.links)) {
    if (sameItem(link, hit) && project.keys.has(key)) return key;
  }
  for (const key of [hit.citationKey, ...(hit.aliases ?? [])]) {
    if (!project.keys.has(key)) continue;
    const link = project.links[key];
    if (!link || sameItem(link, hit)) return key;
  }
  const doi = normalizeDoi(hit.doi);
  return (doi && project.doiToKey.get(doi)) || null;
}

export function citationKeyForHit(hit: ZoteroHit, project: ProjectBibliography = projectBibliography()): string {
  const existing = existingKeyForHit(hit, project);
  if (existing) return existing;
  if (!project.keys.has(hit.citationKey)) return hit.citationKey;
  let index = 0;
  let key = `${hit.citationKey}${collisionSuffix(index)}`;
  while (project.keys.has(key)) key = `${hit.citationKey}${collisionSuffix(++index)}`;
  return key;
}

function mainDocument(): string {
  return profile() === "latex" ? resolveEffectiveMainDoc().mainDoc : useFilesStore.getState().mainDoc;
}

function sourceTexts(): { file: string; content: string }[] {
  const files = useFilesStore.getState();
  const pattern = profile() === "typst" ? /\.typ$/i : profile() === "markdown" ? /\.(?:md|markdown|qmd|rmd)$/i : /\.(?:tex|ltx|latex)$/i;
  const paths = new Set<string>([mainDocument()]);
  for (const path of Object.keys(useIndexStore.getState().texts)) if (pattern.test(path)) paths.add(path);
  for (const path of Object.keys(files.files)) if (pattern.test(path)) paths.add(path);
  return [...paths]
    .map((file) => ({ file, content: projectText(file) ?? "" }))
    .filter((source) => source.content.length > 0 || source.file === mainDocument());
}

export function zoteroBibliographyChoices(): string[] {
  const kind = profile();
  const writable = writableBibPaths();
  if (kind === "markdown") {
    const main = mainDocument();
    const found: string[] = [];
    for (const raw of markdownBibliographyPaths(projectText(main) ?? "")) {
      const path = resolveBibliographyPath(raw, main, writable, "markdown");
      if (path && !found.includes(path)) found.push(path);
    }
    return found;
  }
  if (kind !== "latex" && kind !== "typst") return [];
  const hayagriva = kind === "typst"
    ? useFilesStore.getState().tree.filter((entry) => !entry.is_dir && !entry.read_only && isHayagrivaPath(entry.path)).map((entry) => entry.path)
    : [];
  return declaredBibliographyFiles(kind, sourceTexts(), writable, hayagriva);
}

async function chooseTarget(options: EnsureOptions): Promise<{ path: string; exists: boolean } | null> {
  const files = useFilesStore.getState();
  const projectId = files.projectId;
  const choices = zoteroBibliographyChoices();
  const exists = (path: string) => files.tree.some((entry) => !entry.is_dir && entry.path === path);
  if (choices.length > 1 && projectId) {
    const remembered = rememberedBibliography(projectId);
    if (remembered && choices.includes(remembered)) return { path: remembered, exists: exists(remembered) };
    const chosen = options.chooseBibliography ? await options.chooseBibliography(choices) : choices[0];
    if (!chosen || !choices.includes(chosen)) return null;
    rememberBibliography(projectId, chosen);
    return { path: chosen, exists: exists(chosen) };
  }
  if (choices.length === 1) return { path: choices[0], exists: exists(choices[0]) };
  const existing = writableBibPaths()[0];
  if (existing) return { path: existing, exists: true };
  const linked = bibPaths()[0];
  if (linked) return { path: linked, exists: true };
  return { path: FALLBACK_BIBLIOGRAPHY, exists: false };
}

function exportStyle(targetText: string): ZoteroExportStyle {
  if (profile() === "latex") {
    return sourceTexts().some((source) => latexUsesBiblatex(source.content)) ? "biblatex" : "bibtex";
  }
  return bibStyleOf(targetText) ?? "biblatex";
}

function relativePath(fromFile: string, target: string): string {
  const base = fromFile.split("/").slice(0, -1);
  const parts = target.split("/");
  let shared = 0;
  while (shared < base.length && shared < parts.length - 1 && base[shared] === parts[shared]) shared++;
  return [...base.slice(shared).map(() => ".."), ...parts.slice(shared)].join("/");
}

async function writeText(projectId: string, path: string, next: string, exists: boolean): Promise<void> {
  written.set(path, { projectId, text: next, previous: knownText(path) });
  const files = useFilesStore.getState();
  if (files.projectId !== projectId) throw new Error(i18n.t(($) => $.core.citation.projectChanged));
  if (files.files[path] !== undefined) {
    if (!files.setContent(path, next, { bumpVersion: files.activePath === path })) {
      throw new Error(i18n.t(($) => $.core.citation.linkedBibliography, { path }));
    }
    await useFilesStore.getState().saveFile(path);
  } else {
    await files.writeProjectFile(projectId, path, next);
  }
  if (exists) useIndexStore.getState().updateFile(path, next);
  else await useIndexStore.getState().rebuildFromDisk();
}

async function ensureDeclaration(projectId: string, target: string): Promise<void> {
  const kind = profile();
  const main = mainDocument();
  const exists = useFilesStore.getState().tree.some((entry) => entry.path === main);
  const current = await readText(main, exists);
  const relative = relativePath(main, target);
  let next = current;
  if (kind === "latex") {
    if (sourceTexts().some((source) => latexHasBibliography(source.content))) return;
    next = ensureLatexBibliography(current, relative);
  } else if (kind === "typst") {
    if (sourceTexts().some((source) => hasTypstBibliography(source.content))) return;
    next = ensureTypstBibliography(current, relative);
  } else if (kind === "markdown") {
    next = ensureMarkdownBibliography(current, relative);
  }
  if (next !== current) await writeText(projectId, main, next, true);
}

function hayagrivaEntry(entry: string, key: string): string {
  const parsed = parseEntry(entry);
  return parsed ? bibtexToHayagriva({ ...parsed, key }) : "";
}

function linkFor(hit: ZoteroHit, bib: string, hash: string, dateModified = hit.dateModified, version = 0): ZoteroProjectLink {
  return { library: hit.library, itemKey: hit.itemKey, dateModified, version, hash, bib };
}

export function ensureZoteroEntries(picks: readonly ZoteroPick[], options: EnsureOptions = {}): Promise<EnsureResult> {
  return serialized(() => ensureNow(picks, options));
}

async function ensureNow(picks: readonly ZoteroPick[], options: EnsureOptions): Promise<EnsureResult> {
  const projectId = useFilesStore.getState().projectId;
  if (!projectId || picks.length === 0) return { added: [], reused: [], bibPath: null };
  if (projectFolderIsReadOnly(projectId)) {
    return { added: [], reused: [], bibPath: null, error: readOnlyFolderMessage() };
  }
  await loadProjectLinks(projectId).catch(() => ({}));
  const target = await chooseTarget(options);
  if (!target) return { added: [], reused: [], bibPath: null };
  const content = await readText(target.path, target.exists);
  const project = projectBibliography(projectId);
  const reused: string[] = [];
  const pending: ZoteroPick[] = [];
  const adopted: Record<string, ZoteroProjectLink> = {};
  const seen = new Set<string>();
  for (const pick of picks) {
    if (seen.has(pick.key)) continue;
    seen.add(pick.key);
    const doi = normalizeDoi(pick.hit.doi);
    const present = project.keys.has(pick.key) ? pick.key : (doi && project.doiToKey.get(doi)) || null;
    if (present) {
      reused.push(present);
      if (!project.links[present]) adopted[present] = linkFor(pick.hit, target.path, "");
      continue;
    }
    pending.push(pick);
  }
  await saveLinks(projectId, adopted).catch(() => undefined);
  if (pending.length === 0) return { added: [], reused, bibPath: target.path };
  if (useFilesStore.getState().tree.some((entry) => entry.path === target.path && entry.read_only)) {
    return { added: [], reused, bibPath: target.path, error: i18n.t(($) => $.core.citation.linkedBibliography, { path: target.path }) };
  }
  const handList = await askHandListMove({ sources: sourceTexts(), target: target.path, confirm: options.confirmHandList });
  if (handList === "cancel") return { added: [], reused: [], bibPath: null };
  const style = exportStyle(content);
  const exported = await zoteroLibraryExport(
    pending.map((pick) => ({ library: pick.hit.library, itemKey: pick.hit.itemKey })),
    style,
    useSettingsStore.getState().offline,
  );
  const yaml = isHayagrivaPath(target.path);
  const entries: string[] = [];
  const links: Record<string, ZoteroProjectLink> = {};
  const added: string[] = [];
  for (const pick of pending) {
    const match = exported.find((entry) => entry.library === pick.hit.library && entry.itemKey === pick.hit.itemKey);
    if (!match) continue;
    const entry = yaml ? hayagrivaEntry(match.entry, pick.key) : withEntryKey(match.entry, pick.key);
    if (!entry) continue;
    entries.push(entry);
    added.push(pick.key);
    links[pick.key] = linkFor(pick.hit, target.path, entryHash(entry), match.dateModified, match.version);
  }
  if (entries.length === 0) return { added: [], reused, bibPath: target.path };
  const latest = await readText(target.path, target.exists);
  const handEntries = handList ? handListEntries(handList, { sources: sourceTexts(), bib: latest, adding: added }) : [];
  const next = yaml ? `${latest.trimEnd()}${latest.trim() ? "\n\n" : ""}${entries.join("\n\n")}\n` : appendEntries(latest, [...handEntries, ...entries]);
  await writeText(projectId, target.path, next, target.exists);
  const handText = handList ? handListText(handList, sourceTexts(), relativePath(mainDocument(), target.path)) : null;
  if (handList && handText !== null) await writeText(projectId, handList.file, handText, true);
  await ensureDeclaration(projectId, target.path);
  await saveLinks(projectId, links).catch(() => undefined);
  return { added, reused, bibPath: target.path };
}

const LATEX_COMMAND_WITH_ARGUMENT = /\\([A-Za-z]+)\*?\s*[[{]/g;

function citesInLatex(text: string): boolean {
  for (const match of text.matchAll(LATEX_COMMAND_WITH_ARGUMENT)) {
    if (match[1].includes("cite")) return true;
  }
  return false;
}

export function latexCiteSources(current: string): string[] {
  if (citesInLatex(current)) return [current];
  const texts = useIndexStore.getState().texts;
  return [current, ...Object.entries(texts).filter(([path]) => /\.(?:tex|ltx|latex)$/i.test(path)).map(([, text]) => text)];
}

export function unresolvedCitationKeys(): string[] {
  const data = useIndexStore.getState().intelligenceState.data as
    | { uses?: readonly { kind: string; name: string; resolution: string }[] }
    | null;
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const use of data?.uses ?? []) {
    if (use.kind !== "citation" || use.resolution !== "unresolved") continue;
    if (!use.name || use.name === "*" || seen.has(use.name)) continue;
    seen.add(use.name);
    keys.push(use.name);
  }
  return keys;
}

export async function findMissingInZotero(keys: readonly string[] = unresolvedCitationKeys()): Promise<MissingReport> {
  if (keys.length === 0) return { found: [], duplicates: [], missing: [] };
  const projectId = useFilesStore.getState().projectId;
  if (projectId) await loadProjectLinks(projectId).catch(() => ({}));
  const hits = await zoteroLibraryLookup([...keys]);
  const project = projectBibliography(projectId);
  const found: ZoteroPick[] = [];
  const duplicates: { key: string; existing: string }[] = [];
  const missing: string[] = [];
  keys.forEach((key, index) => {
    const hit = hits[index];
    if (!hit) {
      missing.push(key);
      return;
    }
    const existing = existingKeyForHit(hit, project);
    if (existing && existing !== key) {
      duplicates.push({ key, existing });
      return;
    }
    found.push({ hit, key });
  });
  return { found, duplicates, missing };
}

export async function staleZoteroEntries(): Promise<StaleEntry[]> {
  const projectId = useFilesStore.getState().projectId;
  if (!projectId) return [];
  const links = await loadProjectLinks(projectId);
  const keys = Object.keys(links);
  if (keys.length === 0) return [];
  const hits = await zoteroLibraryItems(keys.map((key) => ({ library: links[key].library, itemKey: links[key].itemKey })));
  const stale: StaleEntry[] = [];
  keys.forEach((key, index) => {
    const hit = hits[index];
    const link = links[key];
    if (!hit?.dateModified || hit.dateModified <= link.dateModified) return;
    const text = projectText(link.bib);
    if (text === undefined) return;
    const span = findEntry(text, key);
    if (!span) return;
    const handEdited = !link.hash || entryHash(text.slice(span.from, span.to)) !== link.hash;
    stale.push({ key, bib: link.bib, hit, link, handEdited });
  });
  return stale;
}

export function updateZoteroEntries(entries: readonly StaleEntry[]): Promise<{ updated: string[]; error?: string }> {
  return serialized(async () => {
    const projectId = useFilesStore.getState().projectId;
    if (!projectId || entries.length === 0) return { updated: [] };
    const updated: string[] = [];
    const links: Record<string, ZoteroProjectLink> = {};
    const byBib = new Map<string, StaleEntry[]>();
    for (const entry of entries) byBib.set(entry.bib, [...(byBib.get(entry.bib) ?? []), entry]);
    for (const [bib, group] of byBib) {
      const text = await readText(bib, true);
      const exported = await zoteroLibraryExport(
        group.map((entry) => ({ library: entry.hit.library, itemKey: entry.hit.itemKey })),
        exportStyle(text),
        useSettingsStore.getState().offline,
      );
      let next = text;
      const replacements = group
        .map((entry) => ({
          entry,
          span: findEntry(text, entry.key),
          exported: exported.find((candidate) => candidate.library === entry.hit.library && candidate.itemKey === entry.hit.itemKey),
        }))
        .filter((candidate) => candidate.span && candidate.exported)
        .sort((left, right) => (right.span?.from ?? 0) - (left.span?.from ?? 0));
      for (const { entry, span, exported: fresh } of replacements) {
        if (!span || !fresh) continue;
        const body = withEntryKey(fresh.entry, entry.key);
        next = replaceEntry(next, span, body);
        updated.push(entry.key);
        links[entry.key] = linkFor(entry.hit, bib, entryHash(body), fresh.dateModified, fresh.version);
      }
      if (next !== text) await writeText(projectId, bib, next, true);
    }
    await saveLinks(projectId, links);
    return { updated };
  });
}

export async function requestZoteroUpdate(
  key: string,
  confirm: (entries: StaleEntry[]) => Promise<boolean>,
): Promise<"updated" | "declined" | "current" | "failed"> {
  const entry = (await staleZoteroEntries()).find((candidate) => candidate.key === key);
  if (!entry) return "current";
  if (entry.handEdited && !(await confirm([entry]))) return "declined";
  const result = await updateZoteroEntries([entry]);
  return result.updated.includes(key) ? "updated" : "failed";
}

export function forgetProjectLinks(projectId: string): void {
  linksByProject.delete(projectId);
}

export function resetZoteroCiteForTest(): void {
  written.clear();
  linksByProject.clear();
  linkLoads.clear();
  queue = Promise.resolve();
}
