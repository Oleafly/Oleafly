import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Code2, Image as ImageIcon, Loader2, Play, X } from "lucide-react";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import {
  compileIsolated,
  readIsolatedPdf,
  writeProjectBytes,
  writeFileContent,
  listFiles,
} from "@/lib/tauri";
import { buildStandaloneDoc } from "@/lib/ai-figure";
import { pdfPageToPng } from "@/lib/pdf-image";
import { insertAtCursor } from "@/components/editor/cm/controller";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

const SAMPLE = `\\begin{tikzpicture}[node distance=1.2cm, >=stealth]
  \\node (a) [draw, rounded corners] {Dataset};
  \\node (b) [draw, rounded corners, below=of a] {Encoder};
  \\node (c) [draw, rounded corners, below=of b] {Classifier};
  \\draw[->] (a) -- (b);
  \\draw[->] (b) -- (c);
\\end{tikzpicture}`;

/** Turn a user-entered name into a safe file stem (keeps case, no path parts). */
function safeName(name: string): string {
  return name
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * A standalone, full-height composer for drawing a diagram by hand (no AI):
 * paste TikZ on the left, see the compiled preview on the right, then insert it
 * as vector code or as a saved PNG. Always preserves the source as a
 * figures/<name>.tikz snippet so the diagram stays editable later.
 */
export function DiagramComposer() {
  const open = useSettingsStore((s) => s.diagramComposerOpen);
  const setOpen = useSettingsStore((s) => s.setDiagramComposerOpen);
  const projectId = useFilesStore((s) => s.projectId);

  const [code, setCode] = useState(SAMPLE);
  const [name, setName] = useState("diagram");
  const [png, setPng] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const dirtyRef = useRef(false);

  const stem = useMemo(() => safeName(name), [name]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const compile = useCallback(async () => {
    if (!projectId || busy) return;
    setBusy(true);
    setLog("");
    try {
      const source = buildStandaloneDoc({ code });
      const result = await compileIsolated(projectId, source, useSettingsStore.getState().offline);
      setLog((result.log ?? "").slice(-4000));
      if (result.has_pdf) {
        const bytes = new Uint8Array(await readIsolatedPdf(projectId));
        setPng(await pdfPageToPng(bytes, 1, 2));
      } else {
        setPng(null);
        toast.error("Diagram did not compile. Check the log below.");
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }, [projectId, code, busy]);

  // Warn before overwriting an existing figures/<stem>.* artifact.
  const confirmOverwrite = useCallback(
    async (paths: string[]): Promise<boolean> => {
      if (!projectId) return false;
      try {
        const files = await listFiles(projectId);
        const existing = new Set(files.map((f) => f.path));
        const clash = paths.filter((p) => existing.has(p));
        if (clash.length === 0) return true;
        return window.confirm(
          `${clash.join(", ")} already exists. Overwrite? (Choose a different name to keep both.)`,
        );
      } catch {
        return true; // if we cannot list, do not block the insert
      }
    },
    [projectId],
  );

  // Save the source snippet (always) so the diagram code is never lost.
  const saveSnippet = useCallback(
    async (id: string) => {
      await writeFileContent(id, `figures/${stem}.tikz`, code);
    },
    [stem, code],
  );

  const insertAsCode = useCallback(async () => {
    if (!projectId) return;
    if (!stem) {
      toast.error("Enter a name for the diagram first.");
      return;
    }
    if (!(await confirmOverwrite([`figures/${stem}.tikz`]))) return;
    const latex = `\\begin{figure}[htbp]\n\\centering\n${code}\n\\caption{}\n\\label{fig:${stem}}\n\\end{figure}`;
    insertAtCursor(latex);
    try {
      await saveSnippet(projectId);
      await useFilesStore.getState().refreshTree();
    } catch {
      /* snippet save is best-effort; the code is already in the document */
    }
    toast.success("Diagram inserted as code.");
    setOpen(false);
  }, [projectId, stem, code, confirmOverwrite, saveSnippet, setOpen]);

  const insertAsImage = useCallback(async () => {
    if (!projectId) return;
    if (!stem) {
      toast.error("Enter a name for the diagram first.");
      return;
    }
    if (!png) {
      toast.error("Compile the diagram first so there is an image to insert.");
      return;
    }
    if (!(await confirmOverwrite([`figures/${stem}.png`, `figures/${stem}.tikz`]))) return;
    try {
      const b64 = png.slice(png.indexOf(",") + 1);
      await writeProjectBytes(projectId, `figures/${stem}.png`, b64);
      await saveSnippet(projectId);
      await useFilesStore.getState().refreshTree();
    } catch (e) {
      toast.error(`Could not save the image: ${e}`);
      return;
    }
    const latex = `\\begin{figure}[htbp]\n\\centering\n\\includegraphics[width=0.8\\linewidth]{figures/${stem}.png}\n\\caption{}\n\\label{fig:${stem}}\n\\end{figure}`;
    insertAtCursor(latex);
    toast.success("Diagram inserted as image.");
    setOpen(false);
  }, [projectId, stem, png, confirmOverwrite, saveSnippet, setOpen]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Insert diagram"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">Insert diagram</h2>
          <div className="ml-2 flex items-center gap-1.5">
            <label htmlFor="diagram-name" className="text-xs text-muted-foreground">
              Name
            </label>
            <input
              id="diagram-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="diagram"
              className="w-56 rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus:border-primary"
            />
            {stem && (
              <span className="text-[11px] text-muted-foreground">
                figures/{stem}.tikz
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body: code | preview */}
        <div className="grid min-h-0 flex-1 grid-cols-2">
          <div className="flex min-h-0 flex-col border-r">
            <div className="shrink-0 border-b px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              TikZ / LaTeX code
            </div>
            <textarea
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                dirtyRef.current = true;
              }}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none bg-background p-3 font-mono text-xs outline-none"
            />
          </div>
          <div className="flex min-h-0 flex-col">
            <div className="flex shrink-0 items-center justify-between border-b px-3 py-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Preview
              </span>
              <Button size="sm" variant="secondary" onClick={() => void compile()} disabled={busy}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                Compile
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-sidebar p-3">
              {png ? (
                <div className="flex h-full items-center justify-center">
                  <img src={png} alt="Diagram preview" className="max-h-full max-w-full object-contain" />
                </div>
              ) : log ? (
                <pre className="overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-[10px] text-muted-foreground">
                  {log}
                </pre>
              ) : (
                <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
                  Compile to see a preview.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer: insert actions */}
        <div className="flex shrink-0 items-center gap-2 border-t px-4 py-2.5">
          <p className="text-[11px] text-muted-foreground">
            Inserting always saves the source to <code className="font-mono">figures/{stem || "name"}.tikz</code> so the code is never lost.
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void insertAsCode()}>
              <Code2 className="size-3.5" /> Insert as code (vector)
            </Button>
            <Button size="sm" onClick={() => void insertAsImage()} disabled={!png}>
              <ImageIcon className="size-3.5" /> Insert as image (PNG)
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
