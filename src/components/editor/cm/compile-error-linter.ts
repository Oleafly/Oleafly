import { linter, type Diagnostic } from "@codemirror/lint";
import type { Line } from "@codemirror/state";
import type { CompileError } from "@/lib/tauri";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { compilePathResolver } from "@/lib/compile-file-path";

function nextCharacterEnd(line: Line, offset: number): number {
  const codePoint = line.text.codePointAt(offset - line.from);
  if (codePoint === undefined) return offset;
  return Math.min(line.to, offset + (codePoint > 0xffff ? 2 : 1));
}

function errorRange(line: Line, err: CompileError): { from: number; to: number } {
  if (err.column == null || err.column - 1 >= line.length) return { from: line.from, to: line.to };
  const from = line.from + Math.max(0, err.column - 1);
  const end = err.end_column == null ? null : line.from + Math.min(line.length, err.end_column - 1);
  return { from, to: end != null && end > from ? end : nextCharacterEnd(line, from) };
}

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
        ...errorRange(lineObj, err),
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
