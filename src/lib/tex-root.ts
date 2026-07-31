import { resolveProjectPath } from "@/lib/project-intelligence/source";
import { useFilesStore } from "@/store/files";

/**
 * `% !TEX root = <path>` magic-comment support (LaTeX Workshop semantics).
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

// One magic comment per line, within the first lines of the file, e.g.
//   % !TEX root = ../thesis.tex
//   %!TEX program = xelatex
// `program` is parsed for completeness but deliberately not acted on.
const MAGIC_COMMENT = /^%\s*!\s*TEX\s+(root|program)\s*=\s*(.+?)\s*$/i;
const MAGIC_COMMENT_MAX_LINES = 10;

/** Parses TeX magic comments from the first 10 lines of `text`. */
export function parseTexMagicComments(text: string): TexMagicComments {
  const result: TexMagicComments = { root: null, program: null };
  let start = 0;
  for (
    let line = 0;
    line < MAGIC_COMMENT_MAX_LINES && start <= text.length;
    line++
  ) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    const match = MAGIC_COMMENT.exec(text.slice(start, end));
    if (match) {
      const key = match[1].toLowerCase() as keyof TexMagicComments;
      // First occurrence of each key wins.
      result[key] ??= match[2];
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
  brokenRoot: { declaredIn: string; target: string } | null;
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
  const root = parseTexMagicComments(text).root;
  if (root === null) return fallback;
  const resolved = resolveTexRootPath(activePath, root);
  if (
    resolved !== null &&
    files.tree.some((entry) => !entry.is_dir && entry.path === resolved)
  ) {
    return { mainDoc: resolved, overriddenBy: activePath, brokenRoot: null };
  }
  return {
    mainDoc: stored,
    overriddenBy: null,
    brokenRoot: { declaredIn: activePath, target: root },
  };
}
