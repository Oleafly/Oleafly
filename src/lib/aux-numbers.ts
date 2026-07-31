// ---------------------------------------------------------------------------
// Resolved reference numbers from LaTeX .aux files.
//
// After a successful compile the build directory (.oleafly/build) contains the
// entry aux file with `\newlabel{name}{{number}{page}...}` records (plus any
// `\@input{child.aux}` includes). This module parses them into a cache keyed
// by the compile identity (projectId, mainDocument, outputId) so hovers and
// completions can show "Figure 3, page 12" next to `\ref{...}` targets.
// Stale numbers must never surface: lookups are guarded against the CURRENT
// project/main-document stores, and every failure keeps the old cache silently.
// ---------------------------------------------------------------------------

import { readFileContent } from "@/lib/tauri";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";

export interface LabelNumber {
  number: string;
  page: string;
}

const BUILD_DIR = ".oleafly/build";
const ENTRY_AUX = "_oleafly_entry.aux";
/** Cap on parsed aux input, per file chain and per single parse call. */
const MAX_AUX_CHARS = 1024 * 1024;
/** Cap on how many aux files one refresh may read (cycle/fan-out guard). */
const MAX_AUX_FILES = 20;

interface AuxCache {
  projectId: string;
  mainDocument: string;
  outputId: string;
  map: Map<string, LabelNumber>;
}

let cache: AuxCache | null = null;
/** Orders refreshes so a slow older refresh cannot clobber a newer result. */
let refreshSeq = 0;
let unsubscribe: (() => void) | null = null;

/** Test seam: drops the cached numbers (does not touch the subscription). */
export function clearAuxNumbers(): void {
  cache = null;
  refreshSeq++;
}

/**
 * Reads one balanced `{...}` group starting at `line[open]` (which must be
 * `{`). Escaped braces (`\{`, `\}`) do not affect the balance. Returns the
 * group's content and the index just past the closing brace, or null when the
 * group never closes on this line.
 */
function readBalancedGroup(
  line: string,
  open: number,
): { content: string; end: number } | null {
  if (line[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") {
      i++; // skip the escaped character
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
export function parseAuxLabels(aux: string): Map<string, LabelNumber> {
  const out = new Map<string, LabelNumber>();
  const text = aux.length > MAX_AUX_CHARS ? aux.slice(0, MAX_AUX_CHARS) : aux;
  for (const line of text.split("\n")) {
    const at = line.indexOf("\\newlabel");
    if (at < 0) continue;
    let i = at + "\\newlabel".length;
    while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
    const name = readBalancedGroup(line, i);
    if (!name || name.content.length === 0) continue;
    if (name.content.endsWith("@cref")) continue;
    i = name.end;
    while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
    const payload = readBalancedGroup(line, i);
    if (!payload) continue;
    // Inside the payload the first two balanced groups are {NUMBER}{PAGE};
    // anything after (hyperref anchors, `\relax`, ...) is ignored.
    const inner = payload.content;
    let j = 0;
    while (j < inner.length && (inner[j] === " " || inner[j] === "\t")) j++;
    const number = readBalancedGroup(inner, j);
    if (!number) continue;
    j = number.end;
    while (j < inner.length && (inner[j] === " " || inner[j] === "\t")) j++;
    const page = readBalancedGroup(inner, j);
    if (!page) continue;
    out.set(name.content, { number: number.content, page: page.content });
  }
  return out;
}

/** `\@input{child.aux}` references, sanitized to project-relative aux names. */
function auxInputReferences(content: string): string[] {
  const refs: string[] = [];
  for (const match of content.matchAll(/\\@input\{([^{}]+)\}/g)) {
    const ref = match[1].trim();
    if (!ref.endsWith(".aux")) continue;
    if (ref.startsWith("/") || ref.includes("\\")) continue;
    if (ref.split("/").some((part) => part === ".." || part === "")) continue;
    refs.push(ref);
  }
  return refs;
}

/**
 * Re-reads the aux chain for a successful compile output and swaps the cache.
 *
 * No-op when the cache already holds `outputId`. Follows `\@input{X.aux}`
 * references breadth-first (≤ 20 files, cycle-safe, ≤ 1 MB total). Any
 * failure — including an unreadable entry aux — keeps the old cache silently.
 */
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
    const merged = new Map<string, LabelNumber>();
    const visited = new Set<string>([ENTRY_AUX]);
    const queue: string[] = [ENTRY_AUX];
    let totalChars = 0;
    let filesRead = 0;
    let entryRead = false;
    while (queue.length > 0 && filesRead < MAX_AUX_FILES && totalChars < MAX_AUX_CHARS) {
      const name = queue.shift() as string;
      let content: string;
      try {
        content = await readFileContent(projectId, `${BUILD_DIR}/${name}`);
      } catch {
        continue; // a missing child aux is not fatal
      }
      filesRead++;
      if (name === ENTRY_AUX) entryRead = true;
      const remaining = MAX_AUX_CHARS - totalChars;
      if (content.length > remaining) content = content.slice(0, remaining);
      totalChars += content.length;
      for (const [label, value] of parseAuxLabels(content)) {
        if (!merged.has(label)) merged.set(label, value);
      }
      for (const ref of auxInputReferences(content)) {
        if (!visited.has(ref)) {
          visited.add(ref);
          queue.push(ref);
        }
      }
    }
    // Without the entry aux there is nothing trustworthy to cache.
    if (!entryRead) return;
    // A newer refresh (or clear) superseded this one while files were read.
    if (seq !== refreshSeq) return;
    cache = { projectId, mainDocument, outputId, map: merged };
  } catch {
    // Keep the old cache silently.
  }
}

/**
 * Number/page for `label`, or null. Hits are returned only while the cache
 * identity matches the CURRENT stores (active project and effective main
 * document), so numbers from an earlier project or root never surface.
 */
export function auxNumberFor(label: string): LabelNumber | null {
  if (cache === null) return null;
  if (cache.projectId !== useFilesStore.getState().projectId) return null;
  if (cache.mainDocument !== resolveEffectiveMainDoc().mainDoc) return null;
  return cache.map.get(label) ?? null;
}

/**
 * Idempotent: subscribes to the compile store once and refreshes the cache
 * whenever a new successful compile checkpoint appears.
 */
export function installAuxNumbers(): void {
  if (unsubscribe !== null) return;
  let lastOutputId =
    useCompileStore.getState().lastCompileCheckpoint?.outputId ?? null;
  unsubscribe = useCompileStore.subscribe((state) => {
    const checkpoint = state.lastCompileCheckpoint;
    const outputId = checkpoint?.outputId ?? null;
    if (outputId === lastOutputId) return;
    lastOutputId = outputId;
    if (checkpoint !== null && state.status === "success") {
      void refreshAuxNumbers(
        checkpoint.projectId,
        checkpoint.mainDocument,
        checkpoint.outputId,
      );
    }
  });
}
