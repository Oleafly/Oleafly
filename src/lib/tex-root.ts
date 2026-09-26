import { isLibraryProject } from "@/lib/project-location";
import { resolveProjectPath } from "@/lib/project-intelligence/source";
import { useFilesStore } from "@/store/files";

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

export interface TexMagicComments {
  root: string | null;
  program: string | null;
}

export type TexMagicCommentRule = "shared" | "library";

const MAGIC_COMMENT_RULES: Record<TexMagicCommentRule, { pattern: RegExp; maxLines: number }> = {
  shared: { pattern: /^\s*%\s*(?:!\s*)?TeX\s+(root|program)\s*=/i, maxLines: 50 },
  library: { pattern: /^%\s*!\s*TEX\s+(root|program)\s*=/i, maxLines: 10 },
};

export function parseTexMagicComments(
  text: string,
  rule: TexMagicCommentRule = "shared",
): TexMagicComments {
  const { pattern, maxLines } = MAGIC_COMMENT_RULES[rule];
  const result: TexMagicComments = { root: null, program: null };
  let start = 0;
  for (let line = 0; line < maxLines && start <= text.length; line++) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end);
    const match = pattern.exec(line);
    const value = match ? line.slice(match[0].length).trim() : "";
    if (match && value) {
      const key = match[1].toLowerCase() as keyof TexMagicComments;
      // First occurrence of each key wins.
      result[key] ??= value;
    }
    start = end + 1;
  }
  return result;
}

/**
 * Resolves a magic-comment target against the directory of the file that
 * declares it, producing a normalized project-relative path. Returns null for
 * absolute paths, URLs, or paths that escape the project root. Pure.
 */
export function resolveTexRootPath(
  declaredIn: string,
  rawTarget: string,
): string | null {
  return resolveProjectPath(declaredIn, rawTarget);
}

export type BrokenTexRootReason = "missing" | "not_tex";

export interface EffectiveMainDoc {
  /** Project-relative path of the document to compile. */
  mainDoc: string;
  /**
   * Project-relative path of the file whose `% !TEX root` comment supplied
   * `mainDoc`, or null when the stored main document is in effect.
   */
  overriddenBy: string | null;
  /**
   * Set when the active file declares a root that does not resolve to an
   * existing project file. `mainDoc` then falls back to the stored main
   * document, and the UI surfaces a warning.
   */
  brokenRoot: { declaredIn: string; target: string; reason: BrokenTexRootReason } | null;
}

// Only TeX sources can redirect the root; a magic-looking comment in e.g. a
// Markdown or Typst file never contributes an override.
const OVERRIDE_CAPABLE_FILE = /\.(?:tex|latex|ltx)$/i;

/**
 * The main document every compile/intelligence/SyncTeX/export consumer should
 * use right now: the active file's `% !TEX root` target when present and
 * valid, else the project's stored main document.
 */
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
