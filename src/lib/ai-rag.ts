/**
 * Lightweight project RAG: chunk open-project .tex/.bib files and score them
 * against the user query with a simple TF keyword score (no embeddings).
 * Good enough to surface relevant sections without external vector infra.
 */
import { useFilesStore } from "@/store/files";
import { readFileContent } from "@/lib/tauri";

export interface RagChunk {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
}

const CHUNK_LINES = 40;
const CHUNK_OVERLAP = 8;
const MAX_CHARS_PER_CHUNK = 1800;
const MAX_CHUNKS_RETURNED = 5;
const MAX_FILES = 40;
const MAX_FILE_CHARS = 80_000;

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_\\]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function chunkFile(path: string, content: string): Omit<RagChunk, "score">[] {
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

function scoreChunk(queryTokens: string[], text: string): number {
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
    while (hits < 8) {
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

/**
 * Retrieve top project chunks for a natural-language query.
 * Reads open buffers first, then disk for other indexable files.
 */
export async function retrieveProjectChunks(
  query: string,
  opts?: { topK?: number },
): Promise<RagChunk[]> {
  const q = query.trim();
  if (!q) return [];
  const topK = Math.min(opts?.topK ?? MAX_CHUNKS_RETURNED, 8);
  const tokens = tokenize(q).slice(0, 32);
  if (!tokens.length) return [];

  const files = useFilesStore.getState();
  const projectId = files.projectId;
  if (!projectId) return [];

  const paths = files.tree
    .filter((f) => !f.is_dir && (f.path.endsWith(".tex") || f.path.endsWith(".bib")))
    .map((f) => f.path)
    .slice(0, MAX_FILES);

  const chunks: RagChunk[] = [];
  for (const path of paths) {
    let content = files.files[path]?.content;
    if (content === undefined) {
      try {
        content = await readFileContent(projectId, path);
      } catch {
        continue;
      }
    }
    for (const c of chunkFile(path, content)) {
      const score = scoreChunk(tokens, c.text);
      if (score > 0) chunks.push({ ...c, score });
    }
  }

  chunks.sort((a, b) => b.score - a.score);
  return chunks.slice(0, topK);
}

/** Format retrieved chunks for system/user context injection. */
export function formatRagContext(chunks: RagChunk[]): string {
  if (!chunks.length) return "";
  const blocks = chunks.map(
    (c, i) =>
      `[${i + 1}] ${c.path}:${c.startLine}-${c.endLine} (score ${c.score.toFixed(1)})\n${c.text}`,
  );
  return [
    "### Retrieved project excerpts (keyword RAG; verify with tools before editing)",
    ...blocks,
  ].join("\n\n");
}
