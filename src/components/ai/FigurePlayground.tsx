import { useCallback, useRef, useState } from "react";
import { ArrowLeft, Check, Loader2, Play } from "lucide-react";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { compileIsolated, readIsolatedPdf, writeProjectBytes } from "@/lib/tauri";
import {
  buildStandaloneDoc,
  slugifyFigureName,
  getFigureInsertTarget,
} from "@/lib/ai-figure";
import { pdfPageToPng } from "@/lib/pdf-image";
import { insertAtCursor, replaceRange } from "@/components/editor/cm/controller";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

const SAMPLE = `\\begin{tikzpicture}[node distance=1.2cm, >=stealth]
  \\node (a) [draw, rounded corners] {Dataset};
  \\node (b) [draw, rounded corners, below=of a] {Encoder};
  \\node (c) [draw, rounded corners, below=of b] {Classifier};
  \\draw[->] (a) -- (b);
  \\draw[->] (b) -- (c);
\\end{tikzpicture}`;

/** No-AI figure editor: write TikZ, compile in isolation, see it, insert it. */
export default function FigurePlayground({ onExit }: { onExit?: () => void }) {
  const projectId = useFilesStore((s) => s.projectId);
  const [code, setCode] = useState(SAMPLE);
  const [png, setPng] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const lastBytes = useRef<Uint8Array | null>(null);

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
        lastBytes.current = bytes;
        setPng(await pdfPageToPng(bytes, 1, 2));
      } else {
        setPng(null);
        toast.error("Figure did not compile. Check the log below.");
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }, [projectId, code, busy]);

  const insert = useCallback(async () => {
    const latex = `\\begin{figure}[htbp]\n\\centering\n${code}\n\\end{figure}`;
    const target = getFigureInsertTarget();
    if (target) replaceRange(target.from, target.to, latex);
    else insertAtCursor(latex);
    try {
      if (projectId && lastBytes.current) {
        const dataUrl = await pdfPageToPng(lastBytes.current, 1, 2);
        const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        await writeProjectBytes(projectId, `figures/${slugifyFigureName("figure")}.png`, b64);
        await useFilesStore.getState().refreshTree();
      }
    } catch {
      /* raster copy is optional */
    }
    toast.success("Figure inserted.");
  }, [code, projectId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Draw a figure with TikZ, compile to preview, and insert it. No AI needed.
        </div>
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </button>
        )}
      </div>
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        className="min-h-[140px] flex-1 resize-none rounded-md border bg-background p-2 font-mono text-xs outline-none focus:border-primary"
      />
      <div className="flex items-center gap-2">
        <Button onClick={() => void compile()} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          Compile
        </Button>
        <Button variant="secondary" onClick={() => void insert()} disabled={!png}>
          <Check className="size-4" />
          Insert
        </Button>
      </div>
      {png && (
        <div className="flex items-center justify-center overflow-auto rounded-md border bg-sidebar p-2">
          <img src={png} alt="Figure preview" className="max-h-64 max-w-full" />
        </div>
      )}
      {log && !png && (
        <pre className="max-h-40 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-[10px] text-muted-foreground">
          {log}
        </pre>
      )}
    </div>
  );
}
