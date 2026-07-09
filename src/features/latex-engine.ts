import { compileTagged, readCompiledPdf } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { usePreflightStore } from "@/store/preflight";
import { useEngineStore } from "@/store/engine";
import { toast } from "@/lib/toast";
import { logError } from "@/lib/log";

/**
 * Compile the current project with LuaLaTeX to produce a tagged PDF, load it
 * into the normal PDF/compile state, and re-run Preflight so the output
 * accessibility verdict reflects the tagged result. Requires an engine to be
 * available (Settings > LaTeX Engine).
 */
export async function compileTaggedAndVerify(): Promise<void> {
  const engine = useEngineStore.getState().info;
  if (!engine || engine.kind === "none") {
    toast.info("Enable a tagging engine in Settings, LaTeX Engine, first.");
    return;
  }

  const files = useFilesStore.getState();
  await files.saveActive();
  const projectId = files.projectId ?? "default";
  const main = files.mainDoc || "main.tex";

  const id = toast.info("Compiling a tagged PDF with LuaLaTeX…", undefined, true);
  try {
    const res = await compileTagged(projectId, main);
    if (res.has_pdf) {
      const bytes = new Uint8Array(await readCompiledPdf(projectId));
      useCompileStore.setState({
        pdfBytes: bytes,
        status: res.success ? "success" : "error",
        log: res.log,
        lastCompiledAt: Date.now(),
      });
      await usePreflightStore.getState().run();
    }
    toast.dismiss(id);
    if (res.success) {
      toast.success("Tagged PDF compiled. See the accessibility verdict below.");
    } else {
      toast.error("Tagged compile finished with errors. Check the log.");
    }
  } catch (e) {
    toast.dismiss(id);
    void logError("compile tagged", e);
    toast.error("Tagged compile failed. Check the engine and try again.");
  }
}
