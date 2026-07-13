/**
 * Workspace snapshot injected into the agent system prompt so the model
 * starts oriented (open file, compile status, compact project map) instead of
 * burning the first tool steps on discovery.
 */
import { activeContextProvider } from "@openleaf/registry";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { useIndexStore } from "@/store/project-index";
import { useAgentMemoryStore } from "@/store/agent-memory";
import { getCurrentLine } from "@/components/editor/cm/controller";

const SNIPPET_CHARS = 2500;
const MAX_SECTIONS = 40;
const MAX_ERRORS = 12;

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}\n… [truncated ${s.length - n} more chars]`;
}

/** Compact project outline from the symbol index (best-effort). */
async function compactProjectMap(): Promise<string> {
  try {
    const idx = useIndexStore.getState();
    if (!idx.index) await idx.rebuildFromDisk();
    const index = useIndexStore.getState().index;
    if (!index) return "(project map unavailable)";

    const defs = index.defs as { kind: string; name: string; level?: number; file?: string; line?: number }[];
    const uses = index.uses as { kind: string; name: string; file?: string; target?: string }[];
    const of = (kind: string) => defs.filter((d) => d.kind === kind);

    const sections = of("section")
      .slice(0, MAX_SECTIONS)
      .map((d) => {
        const indent = "  ".repeat(Math.max(0, (d.level ?? 1) - 1));
        return `${indent}- ${d.name}${d.file ? ` (${d.file}:${d.line ?? "?"})` : ""}`;
      });

    const files = of("file").map((d) => d.name).slice(0, 60);
    const unresolvedRefs = [
      ...new Set(
        uses
          .filter((u) => u.kind === "ref" && !index.definitionFor(u as never))
          .map((u) => u.name),
      ),
    ].slice(0, 15);
    const unresolvedCites = [
      ...new Set(
        uses
          .filter((u) => u.kind === "cite" && !index.definitionFor(u as never))
          .map((u) => u.name),
      ),
    ].slice(0, 15);

    const lines = [
      `Files (${files.length}): ${files.join(", ") || "(none)"}`,
      sections.length ? `Outline:\n${sections.join("\n")}` : "Outline: (empty)",
      unresolvedRefs.length ? `Unresolved refs: ${unresolvedRefs.join(", ")}` : null,
      unresolvedCites.length ? `Unresolved cites: ${unresolvedCites.join(", ")}` : null,
    ].filter(Boolean);
    return lines.join("\n");
  } catch {
    return "(project map unavailable)";
  }
}

/**
 * Build a text block for the system prompt. Safe, bounded, read-only.
 */
export async function buildWorkspaceContext(): Promise<string> {
  const files = useFilesStore.getState();
  const compile = useCompileStore.getState();
  const activePath = files.activePath;
  const mainDoc = files.mainDoc || "main.tex";
  const line = getCurrentLine();

  const ctx = {
    projectId: files.projectId,
    projectKind: files.projectKind ?? null,
    theme: "light" as const, // theme is irrelevant to context; a placeholder is fine
  };
  const view = activeContextProvider(ctx)?.id ?? "editor";

  let openSnippet = "";
  if (activePath && files.files[activePath]?.content != null) {
    const content = files.files[activePath].content;
    openSnippet = clip(content, SNIPPET_CHARS);
  }

  const errLines = (compile.errors ?? [])
    .slice(0, MAX_ERRORS)
    .map((e) => {
      const loc = [e.file, e.line].filter(Boolean).join(":");
      return `- ${loc ? `${loc}: ` : ""}${e.message ?? String(e)}`;
    });

  const map = await compactProjectMap();
  const memory = useAgentMemoryStore.getState().asPromptBlock();

  return [
    "### Live workspace context (auto-injected; may be slightly stale)",
    `You are currently in the ${view} view.`,
    `Project: ${files.projectName ?? "?"} · kind: ${files.projectKind ?? "tex"} · main: ${mainDoc}`,
    `Active file: ${activePath ?? "(none)"}${line != null ? ` · cursor line ${line}` : ""}`,
    `Open tabs: ${(files.openTabs ?? []).slice(0, 12).map(basename).join(", ") || "(none)"}`,
    `Compile: status=${compile.status}${compile.lastCompiledAt ? ` · last ${new Date(compile.lastCompiledAt).toISOString()}` : ""}`,
    errLines.length
      ? `Recent compile errors (${errLines.length}):\n${errLines.join("\n")}`
      : "Recent compile errors: (none in UI state)",
    activePath && openSnippet
      ? `Active file excerpt (${activePath}):\n\`\`\`\n${openSnippet}\n\`\`\``
      : "Active file excerpt: (empty or binary)",
    `Project map:\n${map}`,
    memory || null,
    "Use tools to refresh anything you need to verify; do not invent file contents beyond this context.",
  ]
    .filter(Boolean)
    .join("\n");
}
