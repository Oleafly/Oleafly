import { isVendoredTypstPackagePath } from "@oleafly/editor/typst-syntax";
import { readProjectSources } from "@/store/project-index";
import type { ProjectIndex } from "@/lib/index/types";

const MAX_INCLUDE_DEPTH = 8;

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
    for (const edge of edges) {
      const target = edge.target ?? edge.name;
      if (!isVendoredTypstPackagePath(target)) walk(target, depth + 1);
    }
  };

  walk(root, 0);
  return paths;
}

export interface DocumentSources {
  paths: string[];
  texts: string[];
  unreadable: string[];
}

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
