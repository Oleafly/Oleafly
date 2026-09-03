// Scores chunks with a simple TF keyword score (no embeddings) - good enough
// to surface relevant sections without pulling in external vector infra.
import type {
  RagChunk,
  RagRetrieveOverride,
  RagRetrieveRequest,
} from "@oleafly/backend-port";
import { useFilesStore } from "@/store/files";
import * as tauri from "@/lib/tauri";

export type { RagChunk, RagRetrieveRequest };

export interface RagSource {
  path: string;
  content: string;
}

const CHUNK_LINES = 40;
const CHUNK_OVERLAP = 8;
const MAX_CHARS_PER_CHUNK = 1800;
const MAX_CHUNKS_RETURNED = 5;
const MAX_TOP_K = 8;
const MAX_FILES = 40;
const MAX_FILE_CHARS = 80_000;
const MAX_QUERY_TOKENS = 32;
const MAX_TOKEN_HITS = 8;
const INDEXABLE = /\.(?:tex|typ|md|markdown|bib)$/i;

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_\\]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

export function chunkFile(
  path: string,
  content: string,
): Omit<RagChunk, "score">[] {
  const lines = content.slice(0, MAX_FILE_CHARS).split("\n");
  const out: Omit<RagChunk, "score">[] = [];
  for (let i = 0; i < lines.length; i += CHUNK_LINES - CHUNK_OVERLAP) {
    const slice = lines.slice(i, i + CHUNK_LINES);
    if (!slice.length) break;
    let text = slice.join("\n").trim();
    if (!text) continue;
    if (text.length > MAX_CHARS_PER_CHUNK) text = text.slice(0, MAX_CHARS_PER_CHUNK);
    out.push({
      path,
      startLine: i + 1,
      endLine: i + slice.length,
      text,
    });
    if (i + CHUNK_LINES >= lines.length) break;
  }
  return out;
}

export function scoreChunk(queryTokens: string[], text: string): number {
  if (!queryTokens.length) return 0;
  const body = text.toLowerCase();
  let score = 0;
  const seen = new Set<string>();
  for (const t of queryTokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    // Count occurrences (capped) so rare terms still matter.
    let idx = 0;
    let hits = 0;
    while (hits < MAX_TOKEN_HITS) {
      const j = body.indexOf(t, idx);
      if (j < 0) break;
      hits++;
      idx = j + t.length;
    }
    if (hits > 0) {
      // Prefer longer tokens slightly.
      score += hits * (1 + Math.min(2, t.length / 8));
    }
  }
  return score;
}

export function queryTokens(query: string): string[] {
  return tokenize(query).slice(0, MAX_QUERY_TOKENS);
}

export function rankChunks(
  tokens: string[],
  sources: RagSource[],
  topK: number,
): RagChunk[] {
  const chunks: RagChunk[] = [];
  for (const source of sources) {
    for (const c of chunkFile(source.path, source.content)) {
      const score = scoreChunk(tokens, c.text);
      if (score > 0) chunks.push({ ...c, score });
    }
  }
  chunks.sort((a, b) => b.score - a.score);
  return chunks.slice(0, topK);
}

function openBufferOverrides(
  files: Record<string, { content: string; dirty: boolean }>,
): RagRetrieveOverride[] {
  const out: RagRetrieveOverride[] = [];
  for (const [path, file] of Object.entries(files)) {
    if (file?.dirty) out.push({ path, text: file.content });
  }
  return out;
}

async function retrieveByReadingEachFile(
  projectId: string,
  files: Record<string, { content: string; dirty: boolean }>,
  tree: { path: string; is_dir: boolean }[],
  tokens: string[],
  topK: number,
): Promise<RagChunk[]> {
  const paths = tree
    .filter((f) => !f.is_dir && INDEXABLE.test(f.path))
    .map((f) => f.path)
    .slice(0, MAX_FILES);

  const sources: RagSource[] = [];
  for (const path of paths) {
    let content = files[path]?.content;
    if (content === undefined) {
      try {
        content = await tauri.readFileContent(projectId, path);
      } catch {
        continue;
      }
    }
    sources.push({ path, content });
  }
  return rankChunks(tokens, sources, topK);
}

export async function retrieveProjectChunks(
  query: string,
  opts?: { topK?: number },
): Promise<RagChunk[]> {
  const q = query.trim();
  if (!q) return [];
  const topK = Math.min(opts?.topK ?? MAX_CHUNKS_RETURNED, MAX_TOP_K);
  const tokens = queryTokens(q);
  if (!tokens.length) return [];

  const files = useFilesStore.getState();
  const projectId = files.projectId;
  if (!projectId) return [];

  if (typeof tauri.ragRetrieve === "function") {
    const request: RagRetrieveRequest = {
      query: q,
      topK,
      overrides: openBufferOverrides(files.files),
    };
    const retrieved = await tauri
      .ragRetrieve(projectId, request)
      .catch(() => null);
    if (retrieved) return retrieved;
  }

  return retrieveByReadingEachFile(
    projectId,
    files.files,
    files.tree,
    tokens,
    topK,
  );
}

export function formatRagContext(chunks: RagChunk[]): string {
  if (!chunks.length) return "";
  const blocks = chunks.map(
    (c, i) =>
      `[${i + 1}] ${c.path}:${c.startLine}-${c.endLine} (score ${c.score.toFixed(1)})\n${c.text}`,
  );
  return [
    "### Retrieved project excerpts (keyword RAG, verify with tools before editing)",
    ...blocks,
  ].join("\n\n");
}
