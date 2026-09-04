export type {
  CheckpointFileSummary,
  CheckpointIntegrity,
  CheckpointStoreInspection,
  CheckpointStorePack,
  CheckpointStoreStats,
  CheckpointStoreTableCounts,
  CheckpointSummary,
} from "@oleafly/backend-port";
const ENGINE_LABELS: Record<string, string> = {
  latex: "LaTeX",
  latexmk: "LaTeX (latexmk)",
  typst: "Typst",
  markdown: "Markdown",
};

export function checkpointEngineLabel(engine: string): string {
  return ENGINE_LABELS[engine] ?? engine;
}

export {

  checkpointDelete,
  checkpointExport,
  checkpointFiles,
  checkpointImport,
  checkpointInspect,
  checkpointKeepLatest,
  checkpointList,
  checkpointReset,
  checkpointRestore,
  checkpointRevealStore,
  checkpointSetLabel,
  checkpointStats,
  checkpointVerify,
} from "./tauri";
