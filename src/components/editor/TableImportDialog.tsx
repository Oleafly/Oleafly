import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation(["editor"]);
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
      setBusy(false);
    }
  }, [open]);

  const source = (): string | null => {
    const tableTarget = tableContext?.target ?? target;
    const trimmedLabel = label.trim();
    if (tableTarget === "latex" && trimmedLabel && !hasValidTableLabel(trimmedLabel)) {
      setError(t(($) => $.editor.tableImport.invalidLabel));
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
            name: t(($) => $.editor.tableImport.spreadsheetFilter),
            extensions: ["csv", "tsv", "xlsx", "xls"],
          },
        ],
        title: t(($) => $.editor.tableImport.title),
      });
      if (typeof selection !== "string") return;
      if (!contextMatches(context)) {
        throw new Error(t(($) => $.editor.tableImport.activeChangedPicker));
      }
      const parsed = await readTableRows(selection);
      if (parsed.length === 0) {
        throw new Error(t(($) => $.editor.tableImport.noRows));
      }
      if (request === selectionRequest.current && contextMatches(context)) {
        setRows(parsed);
        setFileName(selection.split(/[/\\]/).pop() ?? selection);
        setTableContext(context);
      } else if (request === selectionRequest.current) {
        throw new Error(t(($) => $.editor.tableImport.activeChangedLoading));
      }
    } catch (e) {
      if (request === selectionRequest.current) {
        notifyError("import table", e);
        setError(e instanceof Error ? e.message : t(($) => $.editor.tableImport.readFailed));
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
      setError(t(($) => $.editor.tableImport.activeChangedInsert));
      return;
    }
    const tableSource = source();
    if (!tableSource) return;
    setOpen(false);
    insertAtCursor(`\n${tableSource}\n`);
    toast.success(
      tableContext.target === "typst"
        ? t(($) => $.editor.tableImport.insertedTypst)
        : t(($) => $.editor.tableImport.insertedLatex),
    );
  };

  const copy = async () => {
    if (rows.length === 0) return;
    const tableSource = source();
    if (!tableSource) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(tableSource);
      toast.success(t(($) => $.editor.tableImport.copied));
    } catch (e) {
      notifyError("copy table source", e);
      setError(t(($) => $.editor.tableImport.copyFailed));
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
              <DialogTitle className="text-sm leading-tight">{t(($) => $.editor.tableImport.title)}</DialogTitle>
              <DialogDescription className="text-xs">{t(($) => $.editor.tableImport.description)}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <ToolSplitView>
          <ToolPane
            title={t(($) => $.editor.tableImport.spreadsheetPane)}
            badge={target === "typst" ? "Typst" : "LaTeX"}
            footer={<p className="text-xs leading-relaxed text-muted-foreground">{target === "typst" ? t(($) => $.editor.tableImport.footerTypst) : t(($) => $.editor.tableImport.footerLatex)}</p>}
          >
            <div className="space-y-5 p-5">
              <div className="space-y-2">
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void chooseFile()}>
                  {busy ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <FileSpreadsheet aria-hidden className="size-3.5" />}
                  {fileName ? t(($) => $.editor.tableImport.chooseAnother) : t(($) => $.editor.tableImport.chooseFile)}
                </Button>
                {fileName && <p className="break-all text-xs text-muted-foreground" data-testid="table-import-file">{t(($) => $.editor.tableImport.selectedSummary, { file: fileName, rows: rows.length, columns: columnCount })}</p>}
              </div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="table-import-header" className="text-sm">{t(($) => $.editor.tableImport.firstRowHeader)}</label>
                <Switch id="table-import-header" checked={header} onCheckedChange={setHeader} aria-label={t(($) => $.editor.tableImport.firstRowHeader)} />
              </div>
              <div className="grid gap-2">
                <label htmlFor="table-import-caption" className="text-xs text-muted-foreground">{t(($) => $.editor.tableImport.captionLabel)}</label>
                <Input id="table-import-caption" value={caption} onChange={(event) => setCaption(event.target.value)} placeholder={t(($) => $.editor.tableImport.captionPlaceholder)} />
              </div>
              {target === "latex" && <div className="grid gap-2">
                <label htmlFor="table-import-label" className="text-xs text-muted-foreground">{t(($) => $.editor.tableImport.labelLabel)}</label>
                <Input id="table-import-label" value={label} onChange={(event) => { setLabel(event.target.value); setError(null); }} placeholder={t(($) => $.editor.tableImport.labelPlaceholder)} />
              </div>}
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            </div>
          </ToolPane>
          <ToolPane title={t(($) => $.editor.tableImport.preview)} badge={rows.length ? t(($) => $.editor.tableImport.rowCount, { count: rows.length }) : undefined}>
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
                {(rows.length > PREVIEW_ROWS || columnCount > PREVIEW_COLUMNS) && <p className="text-xs text-muted-foreground">{t(($) => $.editor.tableImport.previewSummary, { rows: Math.min(rows.length, PREVIEW_ROWS), columns: Math.min(columnCount, PREVIEW_COLUMNS) })}</p>}
              </div> : <div className="mx-auto max-w-xs space-y-2 text-center">
                <FileSpreadsheet aria-hidden className="mx-auto mb-4 size-8 text-muted-foreground/60" />
                <p className="text-sm font-medium">{t(($) => $.editor.tableImport.emptyTitle)}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{t(($) => $.editor.tableImport.emptyBody)}</p>
              </div>}
            </ToolPreviewSurface>
          </ToolPane>
        </ToolSplitView>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
          <Button type="button" variant="outline" size="sm" disabled={busy || rows.length === 0} onClick={() => void copy()}><Copy aria-hidden className="size-3.5" /> {t(($) => $.editor.tableImport.copySource)}</Button>
          <Button type="button" size="sm" disabled={busy || rows.length === 0} data-testid="table-import-insert" onClick={insert}>{t(($) => $.editor.tableImport.insertAtCursor)}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
