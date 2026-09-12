import { useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
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
  previewAlignment,
  readTableRows,
  type TableTarget,
} from "@/features/table-import";

const PREVIEW_ROWS = 6;
const PREVIEW_COLUMNS = 6;

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

  const target: TableTarget = engine?.id === "typst" ? "typst" : "latex";

  const chooseFile = async () => {
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
    setBusy(true);
    setError(null);
    try {
      const parsed = await readTableRows(selection);
      if (parsed.length === 0) {
        throw new Error("that file has no rows");
      }
      setRows(parsed);
      setFileName(selection.split(/[/\\]/).pop() ?? selection);
    } catch (e) {
      notifyError("import table", e);
      setRows([]);
      setFileName(null);
    } finally {
      setBusy(false);
    }
  };

  const insert = async () => {
    if (rows.length === 0) return;
    setOpen(false);
    const source = emitTable(rows, {
      header,
      caption: caption.trim() || undefined,
      label: target === "latex" ? label.trim() || undefined : undefined,
      target,
    });
    insertAtCursor(`\n${source}\n`);
    toast.success(
      target === "typst"
        ? "Typst table inserted at the cursor."
        : "LaTeX table inserted at the cursor. booktabs is required for its rules.",
    );
  };

  const copy = async () => {
    if (rows.length === 0) return;
    const source = emitTable(rows, {
      header,
      caption: caption.trim() || undefined,
      label: target === "latex" ? label.trim() || undefined : undefined,
      target,
    });
    await navigator.clipboard.writeText(source);
    setOpen(false);
    toast.success("Table source copied to the clipboard.");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="table-import-dialog" className="max-w-xl gap-4">
        <DialogHeader>
          <DialogTitle>Import a spreadsheet as a table</DialogTitle>
          <DialogDescription>
            {target === "typst"
              ? "CSV, TSV, or XLSX becomes a Typst table with escaped markup."
              : "CSV, TSV, or XLSX becomes a booktabs table with every LaTeX-special character escaped."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void chooseFile()}>
            {busy ? (
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet aria-hidden className="size-3.5" />
            )}
            {fileName ? "Choose another file" : "Choose CSV, TSV, or XLSX"}
          </Button>
          {fileName ? (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" data-testid="table-import-file">
              {fileName} · {rows.length} rows · alignment {previewAlignment(rows, header)}
            </span>
          ) : null}
        </div>

        {rows.length > 0 ? (
          <div className="max-h-56 overflow-auto rounded-lg border">
            <table className="w-full text-xs" data-testid="table-import-preview">
              <tbody>
                {rows.slice(0, PREVIEW_ROWS).map((row, rowIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: read-only preview of positional grid data; cells have no stable identity
                  <tr key={rowIndex} className="border-b last:border-b-0">
                    {row
                      .slice(0, PREVIEW_COLUMNS)
                      .map((cell, cellIndex) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: positional grid cells
                        <td key={cellIndex} className="truncate px-2 py-1">
                          {cell}
                        </td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > PREVIEW_ROWS ? (
              <p className="border-t px-2 py-1 text-[10px] text-muted-foreground">
                {rows.length - PREVIEW_ROWS} more rows not shown
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <Switch
              id="table-import-header"
              checked={header}
              onCheckedChange={setHeader}
              aria-label="First row is a header"
            />
            <label htmlFor="table-import-header" className="text-xs">
              First row is a header
            </label>
          </div>
          <div className="grid gap-1">
            <label htmlFor="table-import-caption" className="text-xs">
              Caption (optional)
            </label>
            <Input
              id="table-import-caption"
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Results across all runs"
            />
          </div>
          {target === "latex" ? (
            <div className="grid gap-1">
              <label htmlFor="table-import-label" className="text-xs">
                Label (optional)
              </label>
              <Input
                id="table-import-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="tab:results"
              />
            </div>
          ) : null}
        </div>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={rows.length === 0} onClick={() => void copy()}>
            Copy source
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={rows.length === 0}
            data-testid="table-import-insert"
            onClick={() => void insert()}
          >
            Insert at cursor
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
