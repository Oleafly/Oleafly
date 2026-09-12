import { useEffect, useRef, useState } from "react";
import { Copy, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { pickOpenPath } from "@/lib/native-file-dialog";
import { notifyError, toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useTableImportStore } from "@/store/table-import";
import { insertAtCursor } from "@/components/editor/cm/controller";
import {
  emitTable,
  hasValidTableLabel,
  readTableRows,
  type TableTarget,
} from "@/features/table-import";

import { ToolPane, ToolPreviewSurface, ToolSplitView } from "@/components/tools/ToolWorkspace";

const PREVIEW_ROWS = 6;
const PREVIEW_COLUMNS = 6;

interface TableImportContext {
  projectId: string | null;
  activePath: string | null;
  target: TableTarget;
}

function contextMatches(context: TableImportContext): boolean {
  const files = useFilesStore.getState();
  return files.projectId === context.projectId && files.activePath === context.activePath;
}

export function TableImportDialog() {
  const open = useTableImportStore((state) => state.open);
  const setOpen = useTableImportStore((state) => state.setOpen);
  const engine = useFilesStore((state) => state.engine);
  const [rows, setRows] = useState<string[][]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [header, setHeader] = useState(true);
  const [caption, setCaption] = useState("");
  const [label, setLabel] = useState("tab:imported");
  const [error, setError] = useState<string | null>(null);
  const selectionRequest = useRef(0);
  const busyRef = useRef(false);
  const [tableContext, setTableContext] = useState<TableImportContext | null>(null);

  const target: TableTarget = engine?.id === "typst" ? "typst" : "latex";

  useEffect(() => {
    if (!open) {
      selectionRequest.current += 1;
      setRows([]);
      setFileName(null);
      setError(null);
      setTableContext(null);
      busyRef.current = false;
    }
  }, [open]);

  const source = (): string | null => {
    const tableTarget = tableContext?.target ?? target;
    const trimmedLabel = label.trim();
    if (tableTarget === "latex" && trimmedLabel && !hasValidTableLabel(trimmedLabel)) {
      setError("Use letters, numbers, colons, periods, hyphens, or underscores in a table label.");
      return null;
    }
    return emitTable(rows, {
      header,
      caption: caption.trim() || undefined,
      label: tableTarget === "latex" ? trimmedLabel || undefined : undefined,
      target: tableTarget,
    });
  };

  const chooseFile = async () => {
    if (busyRef.current) return;
    const request = ++selectionRequest.current;
    const context: TableImportContext = {
      projectId: useFilesStore.getState().projectId,
      activePath: useFilesStore.getState().activePath,
      target,
    };
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const selection = await pickOpenPath({
        multiple: false,
        filters: [
          {
            name: "Spreadsheet",
            extensions: ["csv", "tsv", "xlsx", "xls"],
          },
        ],
        title: "Import a spreadsheet as a table",
      });
      if (typeof selection !== "string") return;
      if (!contextMatches(context)) {
        throw new Error("the active document changed while the file picker was open. Choose the table again.");
      }
      const parsed = await readTableRows(selection);
      if (parsed.length === 0) {
        throw new Error("that file has no rows");
      }
      if (request === selectionRequest.current && contextMatches(context)) {
        setRows(parsed);
        setFileName(selection.split(/[/\\]/).pop() ?? selection);
        setTableContext(context);
      } else if (request === selectionRequest.current) {
        throw new Error("the active document changed while the table was loading. Choose the table again.");
      }
    } catch (e) {
      if (request === selectionRequest.current) {
        notifyError("import table", e);
        setError(e instanceof Error ? e.message : "Could not read that table.");
        setRows([]);
        setFileName(null);
      }
    } finally {
      if (request === selectionRequest.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const insert = () => {
    if (rows.length === 0) return;
    if (!tableContext || !contextMatches(tableContext)) {
      setError("The active document changed. Choose the table again before inserting it.");
      return;
    }
    const tableSource = source();
    if (!tableSource) return;
    setOpen(false);
    insertAtCursor(`\n${tableSource}\n`);
    toast.success(
      tableContext.target === "typst"
        ? "Typst table inserted at the cursor."
        : "LaTeX table inserted at the cursor. booktabs is required for its rules.",
    );
  };

  const copy = async () => {
    if (rows.length === 0) return;
    const tableSource = source();
    if (!tableSource) return;
    try {
      await navigator.clipboard.writeText(tableSource);
      toast.success("Table source copied to the clipboard.");
    } catch (e) {
      notifyError("copy table source", e);
      setError("The table was not copied. Check clipboard access and try again.");
    }
  };

  const columnCount = rows.reduce((count, row) => Math.max(count, row.length), 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="table-import-dialog" className="flex h-[min(42rem,85dvh)] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <div className="flex items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted">
              <FileSpreadsheet aria-hidden className="size-4" />
            </div>
            <div className="space-y-1">
              <DialogTitle className="text-sm leading-tight">Import a spreadsheet as a table</DialogTitle>
              <DialogDescription className="text-xs">Choose a file, check the preview, then insert it into your document.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <ToolSplitView>
          <ToolPane
            title="Spreadsheet"
            badge={target === "typst" ? "Typst" : "LaTeX"}
            footer={<p className="text-xs leading-relaxed text-muted-foreground">{target === "typst" ? "Special characters are escaped in the table source." : "The generated LaTeX table uses booktabs for its horizontal rules."}</p>}
          >
            <div className="space-y-5 p-5">
              <div className="space-y-2">
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void chooseFile()}>
                  {busy ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <FileSpreadsheet aria-hidden className="size-3.5" />}
                  {fileName ? "Choose another file" : "Choose CSV, TSV, or XLSX"}
                </Button>
                {fileName && <p className="break-all text-xs text-muted-foreground" data-testid="table-import-file">{fileName} · {rows.length} rows · {columnCount} columns</p>}
              </div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="table-import-header" className="text-sm">First row is a header</label>
                <Switch id="table-import-header" checked={header} onCheckedChange={setHeader} aria-label="First row is a header" />
              </div>
              <div className="grid gap-2">
                <label htmlFor="table-import-caption" className="text-xs text-muted-foreground">Caption (optional)</label>
                <Input id="table-import-caption" value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Results across all runs" />
              </div>
              {target === "latex" && <div className="grid gap-2">
                <label htmlFor="table-import-label" className="text-xs text-muted-foreground">Label (optional)</label>
                <Input id="table-import-label" value={label} onChange={(event) => { setLabel(event.target.value); setError(null); }} placeholder="tab:results" />
              </div>}
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            </div>
          </ToolPane>
          <ToolPane title="Preview" badge={rows.length ? `${rows.length} rows` : undefined}>
            <ToolPreviewSurface className="justify-center">
              {rows.length ? <div className="space-y-3">
                <div className="overflow-auto">
                  <table className="w-full border-y-2 border-foreground/40 text-left text-xs" data-testid="table-import-preview">
                    <tbody>{rows.slice(0, PREVIEW_ROWS).map((row, rowIndex) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: positional spreadsheet rows
                      <tr key={rowIndex} className={header && rowIndex === 0 ? "border-b border-foreground/30 font-semibold" : "border-b border-border/60 last:border-b-0"}>
                        {row.slice(0, PREVIEW_COLUMNS).map((cell, cellIndex) => {
                          const Cell = header && rowIndex === 0 ? "th" : "td";
                          return (
                            // biome-ignore lint/suspicious/noArrayIndexKey: positional spreadsheet cells
                            <Cell key={cellIndex} scope={Cell === "th" ? "col" : undefined} className="min-w-20 max-w-64 whitespace-pre-wrap break-words px-3 py-2">{cell}</Cell>
                          );
                        })}
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                {caption.trim() && <p className="text-center text-xs text-muted-foreground">{caption.trim()}</p>}
                {(rows.length > PREVIEW_ROWS || columnCount > PREVIEW_COLUMNS) && <p className="text-xs text-muted-foreground">Preview shows the first {Math.min(rows.length, PREVIEW_ROWS)} rows and {Math.min(columnCount, PREVIEW_COLUMNS)} columns. The full table will be inserted.</p>}
              </div> : <div className="mx-auto max-w-xs space-y-2 text-center">
                <FileSpreadsheet aria-hidden className="mx-auto mb-4 size-8 text-muted-foreground/60" />
                <p className="text-sm font-medium">Your table will appear here</p>
                <p className="text-xs leading-relaxed text-muted-foreground">Choose a spreadsheet to preview its rows and column headings.</p>
              </div>}
            </ToolPreviewSurface>
          </ToolPane>
        </ToolSplitView>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
          <Button type="button" variant="outline" size="sm" disabled={busy || rows.length === 0} onClick={() => void copy()}><Copy aria-hidden className="size-3.5" /> Copy source</Button>
          <Button type="button" size="sm" disabled={busy || rows.length === 0} data-testid="table-import-insert" onClick={insert}>Insert at cursor</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
