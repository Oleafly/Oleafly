import { linter, type Diagnostic } from "@codemirror/lint";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { compilePathResolver } from "@/lib/compile-file-path";

export function createCompileErrorLinter() {
  return linter((view): Diagnostic[] => {
    const files = useFilesStore.getState();
    const activePath = files.activePath;
    if (!activePath) return [];
    const resolve = compilePathResolver([
      ...files.tree.filter((entry) => !entry.is_dir).map((entry) => entry.path),
      activePath,
    ]);
    const diags: Diagnostic[] = [];
    for (const err of useCompileStore.getState().errors) {
      if (err.line == null) continue;
      if (err.file && resolve(err.file) !== activePath) continue;
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
  }, {
      // Diagnostics render through the shared hover card, so the stock lint
      // tooltip must not also appear.
      tooltipFilter: () => [],
  });
}
