import { readProjectSources } from "@/store/project-index";
import type { ProjectIndex } from "@/lib/index/types";

/** A recursion bound matching the outline's; a cycle can only cost this much. */
const MAX_INCLUDE_DEPTH = 8;

/**
 * Every source file the document is assembled from, in reading order: the root
 * followed by each `\input`/`\include` target it pulls in, depth first.
 *
 * Shares the project index with the outline rather than re-parsing, so what
 * Project info counts and what the outline lists can never disagree about the
 * shape of the document.
 */
export function documentSourcePaths(
  index: ProjectIndex | null,
  root: string,
): string[] {
  if (!index) return [root];
  const paths: string[] = [];
  const visited = new Set<string>();

  const walk = (file: string, depth: number) => {
    if (depth > MAX_INCLUDE_DEPTH || visited.has(file)) return;
    visited.add(file);
    paths.push(file);
    const edges = index.uses
      .filter((use) => use.kind === "inputedge" && use.file === file)
      .sort((a, b) => a.from - b.from);
    for (const edge of edges) walk(edge.target ?? edge.name, depth + 1);
  };

  walk(root, 0);
  return paths;
}

export interface DocumentSources {
  /** Paths that were read, in reading order. */
  paths: string[];
  texts: string[];
  /** Paths the index names but the filesystem could not produce. */
  unreadable: string[];
}

/**
 * Reads the whole document. Unsaved edits win over disk, because the counts
 * have to describe what is on screen, not what was last written.
 */
export async function readDocumentSources(
  projectId: string,
  index: ProjectIndex | null,
  root: string,
): Promise<DocumentSources> {
  const paths = documentSourcePaths(index, root);
  const { texts, unreadable } = await readProjectSources(projectId, paths);
  return {
    paths: paths.filter((path) => !unreadable.has(path)),
    texts: paths.filter((path) => !unreadable.has(path)).map((path) => texts[path]),
    unreadable: [...unreadable],
  };
}
