import { linter, type Diagnostic } from "@codemirror/lint";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";

export function createCompileErrorLinter() {
  return linter((view): Diagnostic[] => {
    const activePath = useFilesStore.getState().activePath;
    if (!activePath) return [];
    const activeBase = activePath.split("/").pop();
    const diags: Diagnostic[] = [];
    for (const err of useCompileStore.getState().errors) {
      if (err.line == null) continue;
      if (err.file && err.file.split("/").pop() !== activeBase) continue;
      const lineNo = Math.min(Math.max(1, err.line), view.state.doc.lines);
      const lineObj = view.state.doc.line(lineNo);
      diags.push({
        from: lineObj.from,
        to: lineObj.to,
        severity: err.kind === "error" ? "error" : "warning",
        message: err.explanation ?? err.message,
        source: "compile",
      });
    }
    return diags;
  });
}
