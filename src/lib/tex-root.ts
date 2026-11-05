import { isLibraryProject } from "@/lib/project-location";
import { resolveProjectPath } from "@/lib/project-intelligence/source";
import { parseTexMagicComments } from "@/lib/tex-magic-comments";
import { useFilesStore } from "@/store/files";

export { parseTexMagicComments };
export type { TexMagicCommentRule, TexMagicComments } from "@/lib/tex-magic-comments";

/**
 * `% !TEX root = <path>` magic-comment support, following the convention
 * TeX editors have shared since TeXShop introduced it.
 *
 * A magic root comment in the ACTIVE editor file overrides the project's
 * stored main document for compile, project intelligence, SyncTeX, and
 * export. The override only applies when the comment's target resolves to an
 * existing project file; otherwise the stored main document stays in effect
 * and the broken target is surfaced so the UI can warn about it.
 */

export function resolveTexRootPath(
  declaredIn: string,
  rawTarget: string,
): string | null {
  return resolveProjectPath(declaredIn, rawTarget);
}

export type BrokenTexRootReason = "missing" | "not_tex";

export interface EffectiveMainDoc {
  mainDoc: string;
  overriddenBy: string | null;
  brokenRoot: { declaredIn: string; target: string; reason: BrokenTexRootReason } | null;
}

const OVERRIDE_CAPABLE_FILE = /\.(?:tex|latex|ltx)$/i;

export function resolveEffectiveMainDoc(): EffectiveMainDoc {
  const files = useFilesStore.getState();
  const stored = files.mainDoc || "main.tex";
  const fallback: EffectiveMainDoc = {
    mainDoc: stored,
    overriddenBy: null,
    brokenRoot: null,
  };
  const activePath = files.activePath;
  if (
    !files.projectId ||
    !activePath ||
    !OVERRIDE_CAPABLE_FILE.test(activePath)
  ) {
    return fallback;
  }
  const text = files.files[activePath]?.content;
  if (text === undefined) return fallback;
  const project = files.projects?.find((entry) => entry.id === files.projectId);
  const rule = project && !isLibraryProject(project) ? "shared" : "library";
  const root = parseTexMagicComments(text, rule).root;
  if (root === null) return fallback;
  const resolved = resolveTexRootPath(activePath, root);
  const exists =
    resolved !== null &&
    files.tree.some((entry) => !entry.is_dir && entry.path === resolved);
  if (resolved !== null && exists && OVERRIDE_CAPABLE_FILE.test(resolved)) {
    return { mainDoc: resolved, overriddenBy: activePath, brokenRoot: null };
  }
  return {
    mainDoc: stored,
    overriddenBy: null,
    brokenRoot: {
      declaredIn: activePath,
      target: root,
      reason: exists ? "not_tex" : "missing",
    },
  };
}
