import { compileOfflineForEngine } from "@/lib/document-engine";
import { readFileContent } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { useSettingsStore } from "@/store/settings";
import { activeTypstVariant } from "@/store/typst-variant";
import type { DocumentInsightsBase, InsightsEngine } from "./document-insights";
import { buildLatexInsights, missingLatexSources, type LatexLabelNumber } from "./latex-insights";
import { buildMarkdownInsights, missingMarkdownSources } from "./markdown-insights";
import { buildTypstInsights, fetchTypstDocumentInsights, type TypstInsights } from "./typst-insights";

export type LatexNumbers = "current" | "stale" | "missing";

export type LoadedInsights =
  | { engine: "typst"; insights: TypstInsights }
  | { engine: "latex"; insights: DocumentInsightsBase; numbers: LatexNumbers }
  | { engine: "markdown"; insights: DocumentInsightsBase };

const TYPST_FILE = /\.typ$/iu;
const LATEX_FILE = /\.(?:tex|ltx|latex|sty|cls|bib)$/iu;
const MARKDOWN_FILE = /\.(?:md|markdown|bib|json|ya?ml)$/iu;
const MAX_EXTRA_READS = 200;

export function insightsEngineFor(engine: { id?: string; source_format?: string } | null | undefined): InsightsEngine | null {
  const format = engine?.source_format ?? engine?.id;
  return format === "typst" || format === "latex" || format === "markdown" ? format : null;
}

function projectTexts(pattern: RegExp): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const [path, text] of Object.entries(useIndexStore.getState().texts)) {
    if (pattern.test(path)) texts[path] = text;
  }
  for (const [path, file] of Object.entries(useFilesStore.getState().files)) {
    if (pattern.test(path) && typeof file?.content === "string") texts[path] = file.content;
  }
  return texts;
}

async function readFirst(projectId: string, candidates: readonly string[], texts: Record<string, string>): Promise<void> {
  for (const path of candidates) {
    const text = await readFileContent(projectId, path).catch(() => null);
    if (text !== null) {
      texts[path] = text;
      return;
    }
  }
}

async function readMissing(
  projectId: string,
  texts: Record<string, string>,
  missing: () => readonly (readonly string[])[],
  attempted = new Set<string>(),
): Promise<void> {
  if (attempted.size >= MAX_EXTRA_READS) return;
  const wanted = missing().filter((candidates) => candidates.length > 0 && !attempted.has(candidates[0]));
  if (wanted.length === 0) return;
  for (const candidates of wanted) attempted.add(candidates[0]);
  await Promise.all(wanted.map((candidates) => readFirst(projectId, candidates, texts)));
  return readMissing(projectId, texts, missing, attempted);
}

async function ensureMain(projectId: string, texts: Record<string, string>, mainDoc: string): Promise<void> {
  texts[mainDoc] ??= await readFileContent(projectId, mainDoc);
}

function requireProject(): string {
  const projectId = useFilesStore.getState().projectId;
  if (!projectId) throw new Error("no project");
  return projectId;
}

async function loadTypst(projectId: string): Promise<LoadedInsights> {
  const files = useFilesStore.getState();
  const offline = compileOfflineForEngine(files.engine, useSettingsStore.getState().offline).offline;
  const texts = projectTexts(TYPST_FILE);
  const [compiled] = await Promise.all([
    fetchTypstDocumentInsights(projectId, offline, activeTypstVariant(projectId, files.engine)),
    ensureMain(projectId, texts, files.mainDoc),
  ]);
  return { engine: "typst", insights: await buildTypstInsights(files.mainDoc, texts, compiled) };
}

async function latexNumbers(
  projectId: string,
  mainDoc: string,
): Promise<{ numbers: LatexNumbers; numberFor: ((label: string) => LatexLabelNumber | null) | null }> {
  const [compile, aux] = await Promise.all([import("@/store/compile"), import("@/lib/aux-numbers")]);
  const checkpoint = compile.useCompileStore.getState().lastCompileCheckpoint;
  if (checkpoint?.projectId !== projectId || checkpoint.mainDocument !== mainDoc) {
    return { numbers: "missing", numberFor: null };
  }
  if (!compile.isCompileCheckpointCurrent(checkpoint)) return { numbers: "stale", numberFor: null };
  await aux.refreshAuxNumbers(checkpoint.projectId, checkpoint.mainDocument, checkpoint.outputId);
  return { numbers: "current", numberFor: aux.auxNumberFor };
}

async function loadLatex(projectId: string): Promise<LoadedInsights> {
  const { resolveEffectiveMainDoc } = await import("@/lib/tex-root");
  const mainDoc = resolveEffectiveMainDoc().mainDoc;
  const texts = projectTexts(LATEX_FILE);
  await ensureMain(projectId, texts, mainDoc);
  await readMissing(projectId, texts, () => missingLatexSources(mainDoc, texts));
  const { numbers, numberFor } = await latexNumbers(projectId, mainDoc);
  return { engine: "latex", insights: buildLatexInsights({ mainDoc, texts, numberFor }), numbers };
}

async function loadMarkdown(projectId: string): Promise<LoadedInsights> {
  const mainDoc = useFilesStore.getState().mainDoc;
  const texts = projectTexts(MARKDOWN_FILE);
  await ensureMain(projectId, texts, mainDoc);
  await readMissing(projectId, texts, () => missingMarkdownSources(mainDoc, texts).map((path) => [path]));
  return { engine: "markdown", insights: buildMarkdownInsights({ mainDoc, texts }) };
}

export function loadDocumentInsights(engine: InsightsEngine): Promise<LoadedInsights> {
  const projectId = requireProject();
  if (engine === "latex") return loadLatex(projectId);
  if (engine === "markdown") return loadMarkdown(projectId);
  return loadTypst(projectId);
}
