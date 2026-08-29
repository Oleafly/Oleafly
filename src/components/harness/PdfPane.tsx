import { useEffect, useRef } from "react";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { PdfViewer } from "@/components/pdf/PdfViewer";

// The compiled document beside the session. Rendering goes through the same
// pdfjs viewer the workspace preview uses (an <embed> blob stays blank in the
// macOS webview), and the compile store drives the feedback: building shows
// progress, failures surface the log tail. Opening the pane with nothing
// built kicks off one build automatically — there is no manual compile
// button in the composer.
export function PdfPane() {
  const pdfBytes = useCompileStore((s) => s.pdfBytes);
  const status = useCompileStore((s) => s.status);
  const phase = useCompileStore((s) => s.phase);
  const log = useCompileStore((s) => s.log);
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const autoStarted = useRef(false);

  useEffect(() => {
    if (autoStarted.current) return;
    if (!engineLoaded) return;
    if (pdfBytes && pdfBytes.length > 0) return;
    if (status !== "idle") return;
    autoStarted.current = true;
    void useCompileStore.getState().recompile();
  }, [pdfBytes, status, engineLoaded]);

  if (status === "compiling") {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-muted-foreground"
        data-testid="harness-pdf-compiling"
      >
        <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-foreground motion-reduce:animate-none" />
        <p className="text-sm">Compiling…</p>
        <p className="text-xs text-muted-foreground/70">
          {phase === "downloading"
            ? "Installing missing LaTeX packages first."
            : phase === "saving"
              ? "Saving pending edits, then building."
              : "Running the document engine on the project."}
        </p>
      </div>
    );
  }

  if (!pdfBytes || pdfBytes.length === 0) {
    const errorTail = status === "error" ? log.slice(-1200).trim() : null;
    return (
      <div
        className="flex h-full flex-col gap-2 overflow-auto p-4 text-xs text-muted-foreground"
        data-testid="harness-pdf-empty"
      >
        <p>
          {status === "error"
            ? "The last compile failed. Ask the session to read the log and fix the errors, then compile again."
            : "Compile the project to preview its PDF here."}
        </p>
        {errorTail && (
          <pre className="whitespace-pre-wrap rounded-md border bg-surface-secondary p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {errorTail}
          </pre>
        )}
      </div>
    );
  }

  // The pdfjs viewer renders the page stack; it relies on its parent for the
  // scroll container, so give it a full-height overflow box.
  return (
    <div className="h-full min-h-0 overflow-auto bg-surface-secondary/40">
      <PdfViewer data={pdfBytes} scale={1} />
    </div>
  );
}
