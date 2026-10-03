import { setTypstMathHost, type TypstMathOutcome } from "@oleafly/editor/math-render";
import { describeError } from "@/lib/app-error";
import { renderTypstSnippet } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";

async function renderTypstMathSvg(source: string): Promise<TypstMathOutcome> {
  const projectId = useFilesStore.getState().projectId;
  try {
    const result = await renderTypstSnippet({ source, format: "svg", ...(projectId ? { projectId } : {}) });
    if (result.status === "failed") {
      const error = result.diagnostics.find((diagnostic) => diagnostic.severity === "error") ?? result.diagnostics[0];
      return { status: "failed", message: error?.message ?? "" };
    }
    if (result.image.format !== "svg") return { status: "failed", message: "" };
    return { status: "rendered", svg: result.image.svg };
  } catch (error) {
    return { status: "failed", message: describeError(error) };
  }
}

export function installTypstMathHost(): void {
  setTypstMathHost({
    render: renderTypstMathSvg,
    typstVersion: () => useFilesStore.getState().engine.typst_resolved?.version ?? null,
  });
}
