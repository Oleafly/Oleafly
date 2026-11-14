// ---------------------------------------------------------------------------
// Resolved reference numbers from LaTeX .aux files.
//
// After a successful compile the build directory contains the
// entry aux file with `\newlabel{name}{{number}{page}...}` records (plus any
// `\@input{child.aux}` includes). This module parses them into a cache keyed
// by the compile identity (projectId, mainDocument, outputId) so hovers and
// completions can show "Figure 3, page 12" next to `\ref{...}` targets.
// Stale numbers must never surface: lookups are guarded against the CURRENT
// project/main-document stores, and every failure keeps the old cache silently.
// ---------------------------------------------------------------------------

import { LATEX_SECTION_LEVELS } from "@oleafly/latex";
import { createEmitter } from "@/lib/emitter";
import type { LatexUnitScope } from "@/lib/project-intelligence/latex-units";
import { readBuildArtifact } from "@/lib/tauri";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";

export interface LabelNumber {
  number: string;
  page: string;
}

export interface AuxTocEntry {
  readonly level: number;
  readonly number: string | null;
  readonly title: string;
}

export interface AuxToc {
  readonly projectId: string;
  readonly mainDocument: string;
  readonly entries: readonly AuxTocEntry[];
}

const ENTRY_AUX = "_oleafly_entry.aux";
const MAX_AUX_CHARS = 1024 * 1024;
const MAX_AUX_FILES = 20;

interface AuxCache {
  projectId: string;
  mainDocument: string;
  outputId: string;
  map: Map<string, LabelNumber>;
  toc: AuxToc;
}

let cache: AuxCache | null = null;
let refreshSeq = 0;
let unsubscribe: (() => void) | null = null;
const auxNumbersChanged = createEmitter();

function setCache(next: AuxCache | null): void {
  cache = next;
  auxNumbersChanged.emit();
}

export function clearAuxNumbers(): void {
  setCache(null);
  refreshSeq++;
}

export function subscribeAuxNumbers(listener: () => void): () => void {
  return auxNumbersChanged.subscribe(listener);
}

export function currentAuxToc(): AuxToc | null {
  return cache?.toc ?? null;
}

function readBalancedGroup(
  line: string,
  open: number,
): { content: string; end: number } | null {
  if (line[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return { content: line.slice(open + 1, i), end: i + 1 };
      }
    }
  }
  return null;
}

/**
 * Parses `\newlabel{NAME}{{NUMBER}{PAGE}...}` lines from aux-file content.
 *
 * Tolerates `\relax` tails, hyperref's extra payload groups, and nested braces
 * inside NUMBER (balance-aware, not a naive regex). Skips cleveref's shadow
 * records (names ending in `@cref`), ignores malformed lines, and slices the
 * input head at 1 MB.
 */
function skipTabsAndSpaces(text: string, from: number): number {
  let i = from;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
  return i;
}

// Inside the payload the first two balanced groups are {NUMBER}{PAGE};
// anything after (hyperref anchors, `\relax`, ...) is ignored.
function parseNewlabelPayload(inner: string): LabelNumber | null {
  const number = readBalancedGroup(inner, skipTabsAndSpaces(inner, 0));
  if (!number) return null;
  const page = readBalancedGroup(inner, skipTabsAndSpaces(inner, number.end));
  if (!page) return null;
  return { number: number.content, page: page.content };
}

function parseNewlabelLine(
  line: string,
): { name: string; value: LabelNumber } | null {
  const at = line.indexOf(String.raw`\newlabel`);
  if (at < 0) return null;
  const nameAt = skipTabsAndSpaces(line, at + String.raw`\newlabel`.length);
  const name = readBalancedGroup(line, nameAt);
  if (!name || name.content.length === 0) return null;
  if (name.content.endsWith("@cref")) return null;
  const payload = readBalancedGroup(line, skipTabsAndSpaces(line, name.end));
  if (!payload) return null;
  const value = parseNewlabelPayload(payload.content);
  if (!value) return null;
  return { name: name.content, value };
}

export function parseAuxLabels(aux: string): Map<string, LabelNumber> {
  const out = new Map<string, LabelNumber>();
  const text = aux.length > MAX_AUX_CHARS ? aux.slice(0, MAX_AUX_CHARS) : aux;
  for (const line of text.split("\n")) {
    const parsed = parseNewlabelLine(line);
    if (parsed) out.set(parsed.name, parsed.value);
  }
  return out;
}

function safeAuxReference(raw: string): string | null {
  const ref = raw.trim();
  if (!ref.endsWith(".aux")) return null;
  if (ref.startsWith("/") || ref.includes("\\")) return null;
  if (ref.split("/").some((part) => part === ".." || part === "")) return null;
  return ref;
}

function auxInputReferences(content: string): string[] {
  const refs: string[] = [];
  for (const match of content.matchAll(/\\@input\{([^{}]+)\}/g)) {
    const ref = safeAuxReference(match[1]);
    if (ref !== null) refs.push(ref);
  }
  return refs;
}

const CONTENTS_LINE = /^\s*(?:\\protect\s*)?\\contentsline\s*(?=\{)/u;
// `\numberline{1}Title`, and memoir's `\chapternumberline` and `\partnumberline`.
const NUMBER_LINE = /^\s*(?:\\protect\s*)?\\(?:part|chapter)?numberline\s*(?=\{)/u;
// amsart and amsbook write `\tocsection{Appendix}{A}{Title}`.
const AMS_TOC_LINE =
  /^\s*(?:\\protect\s*)?\\toc(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph|appendix)\s*(?=\{)/u;
// The standard classes write a part as `I\hspace {1em}Title`.
const PART_NUMBER = /^\s*([^\\{}]+?)\s*\\hspace\s*\{1em\}/u;

function numbered(number: string, title: string): Pick<AuxTocEntry, "number" | "title"> {
  return { number: number.trim() || null, title };
}

function splitTocText(level: number, text: string): Pick<AuxTocEntry, "number" | "title"> {
  const line = NUMBER_LINE.exec(text);
  const number = line && readBalancedGroup(text, line[0].length);
  if (number) return numbered(number.content, text.slice(number.end));
  const ams = AMS_TOC_LINE.exec(text);
  const name = ams && readBalancedGroup(text, ams[0].length);
  const amsNumber = name && readBalancedGroup(text, skipTabsAndSpaces(text, name.end));
  const amsTitle = amsNumber && readBalancedGroup(text, skipTabsAndSpaces(text, amsNumber.end));
  if (amsNumber && amsTitle) return numbered(amsNumber.content, amsTitle.content);
  const part = level === 0 ? PART_NUMBER.exec(text) : null;
  if (part) return numbered(part[1], text.slice(part[0].length));
  return { number: null, title: text };
}

function parseTocRecord(record: string): AuxTocEntry | null {
  const line = CONTENTS_LINE.exec(record);
  const kind = line && readBalancedGroup(record, line[0].length);
  if (!kind) return null;
  const name = kind.content.trim();
  const level = Object.hasOwn(LATEX_SECTION_LEVELS, name) ? LATEX_SECTION_LEVELS[name] : undefined;
  if (level === undefined) return null;
  const text = readBalancedGroup(record, skipTabsAndSpaces(record, kind.end));
  if (!text) return null;
  return { level, ...splitTocText(level, text.content) };
}

export function parseAuxToc(files: ReadonlyMap<string, string>): AuxTocEntry[] {
  const entries: AuxTocEntry[] = [];
  const visited = new Set<string>();
  const walk = (name: string): void => {
    const content = files.get(name);
    if (content === undefined || visited.has(name)) return;
    visited.add(name);
    const record = /\\@writefile\s*\{toc\}\s*|\\@input\{([^{}]+)\}/gu;
    for (let match = record.exec(content); match; match = record.exec(content)) {
      if (match[1] !== undefined) {
        const ref = safeAuxReference(match[1]);
        if (ref !== null) walk(ref);
        continue;
      }
      const group = readBalancedGroup(content, record.lastIndex);
      if (!group) break;
      record.lastIndex = group.end;
      const parsed = parseTocRecord(group.content);
      if (parsed) entries.push(parsed);
    }
  };
  walk(ENTRY_AUX);
  return entries;
}

async function readAuxFile(
  projectId: string,
  name: string,
): Promise<string | null> {
  try {
    return await readBuildArtifact(projectId, name);
  } catch {
    return null;
  }
}

function mergeAuxLabels(
  merged: Map<string, LabelNumber>,
  content: string,
): void {
  for (const [label, value] of parseAuxLabels(content)) {
    if (!merged.has(label)) merged.set(label, value);
  }
}

function enqueueAuxInputs(
  content: string,
  visited: Set<string>,
  queue: string[],
): void {
  for (const ref of auxInputReferences(content)) {
    if (visited.has(ref)) continue;
    visited.add(ref);
    queue.push(ref);
  }
}

async function collectAuxChain(projectId: string): Promise<{
  merged: Map<string, LabelNumber>;
  files: Map<string, string>;
  entryRead: boolean;
}> {
  const merged = new Map<string, LabelNumber>();
  const files = new Map<string, string>();
  const visited = new Set<string>([ENTRY_AUX]);
  const queue: string[] = [ENTRY_AUX];
  let totalChars = 0;
  let filesRead = 0;
  let entryRead = false;
  while (queue.length > 0 && filesRead < MAX_AUX_FILES && totalChars < MAX_AUX_CHARS) {
    const name = queue.shift() as string;
    const raw = await readAuxFile(projectId, name);
    if (raw === null) continue;
    filesRead++;
    if (name === ENTRY_AUX) entryRead = true;
    const remaining = MAX_AUX_CHARS - totalChars;
    const content = raw.length > remaining ? raw.slice(0, remaining) : raw;
    totalChars += content.length;
    files.set(name, content);
    mergeAuxLabels(merged, content);
    enqueueAuxInputs(content, visited, queue);
  }
  return { merged, files, entryRead };
}

export async function refreshAuxNumbers(
  projectId: string,
  mainDocument: string,
  outputId: string,
): Promise<void> {
  if (
    cache !== null &&
    cache.projectId === projectId &&
    cache.mainDocument === mainDocument &&
    cache.outputId === outputId
  ) {
    return;
  }
  const seq = ++refreshSeq;
  try {
    const { merged, files, entryRead } = await collectAuxChain(projectId);
    if (!entryRead) return;
    if (seq !== refreshSeq) return;
    const toc = { projectId, mainDocument, entries: parseAuxToc(files) };
    setCache({ projectId, mainDocument, outputId, map: merged, toc });
  } catch {
    // Keep the old cache silently.
  }
}

export function auxNumberFor(label: string): LabelNumber | null {
  if (cache === null) return null;
  if (cache.projectId !== useFilesStore.getState().projectId) return null;
  if (cache.mainDocument !== resolveEffectiveMainDoc().mainDoc) return null;
  return cache.map.get(label) ?? null;
}

/**
 * The number of the label as `file` defines it. The aux data comes from the
 * compiled main document, so another document's copy of the name gets none.
 */
export function auxNumberForDefinition(
  label: string,
  file: string,
  scope: LatexUnitScope | undefined,
): LabelNumber | null {
  if (cache === null) return null;
  if (scope && !scope.sharesScope(cache.mainDocument, file)) return null;
  return auxNumberFor(label);
}

export function installAuxNumbers(): void {
  if (unsubscribe !== null) return;
  const refresh = (state: ReturnType<typeof useCompileStore.getState>) => {
    const checkpoint = state.lastCompileCheckpoint;
    if (checkpoint !== null && state.status === "success") {
      void refreshAuxNumbers(
        checkpoint.projectId,
        checkpoint.mainDocument,
        checkpoint.outputId,
      );
    }
  };
  const initial = useCompileStore.getState();
  let lastOutputId = initial.lastCompileCheckpoint?.outputId ?? null;
  refresh(initial);
  unsubscribe = useCompileStore.subscribe((state) => {
    const outputId = state.lastCompileCheckpoint?.outputId ?? null;
    if (outputId === lastOutputId) return;
    lastOutputId = outputId;
    refresh(state);
  });
}
