import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { buildLatexTable, resizeTable, type TableAlign } from "@/lib/latex-tools";
import { toast } from "@/lib/toast";

export function TableGeneratorPanel() {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [cells, setCells] = useState<string[][]>(() =>
    resizeTable(
      [
        ["Method", "Metric A", "Metric B"],
        ["Baseline", "0.71", "0.64"],
        ["Ours", "0.83", "0.79"],
      ],
      3,
      3,
    ),
  );
  const [aligns, setAligns] = useState<TableAlign[]>(["l", "c", "c"]);
  const [booktabs, setBooktabs] = useState(true);
  const [headerRow, setHeaderRow] = useState(true);
  const [caption, setCaption] = useState("");

  useEffect(() => {
    setCells((prev) => resizeTable(prev, rows, cols));
    setAligns((prev) => Array.from({ length: cols }, (_, i) => prev[i] ?? "c"));
  }, [rows, cols]);

  const code = useMemo(
    () => buildLatexTable(cells, aligns, { booktabs, headerRow, caption }),
    [cells, aligns, booktabs, headerRow, caption],
  );

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto border-r p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <label htmlFor="table-rows">Rows</label>
            <Input
              id="table-rows"
              type="number"
              min={1}
              max={20}
              value={rows}
              onChange={(e) => setRows(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className="h-8 w-16"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <label htmlFor="table-cols">Columns</label>
            <Input
              id="table-cols"
              type="number"
              min={1}
              max={10}
              value={cols}
              onChange={(e) => setCols(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
              className="h-8 w-16"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              id="table-booktabs"
              checked={booktabs}
              onCheckedChange={(v) => setBooktabs(v === true)}
            />
            <label htmlFor="table-booktabs">booktabs rules</label>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              id="table-header-row"
              checked={headerRow}
              onCheckedChange={(v) => setHeaderRow(v === true)}
            />
            <label htmlFor="table-header-row">first row is header</label>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                {aligns.map((a, c) => (
                  <th key={`align-${c}-${a}`} className="p-1">
                    <select
                      value={a}
                      aria-label={`Column ${c + 1} alignment`}
                      onChange={(e) =>
                        setAligns((prev) =>
                          prev.map((x, i) => (i === c ? (e.target.value as TableAlign) : x)),
                        )
                      }
                      className="rounded-md border border-input bg-background px-1.5 py-1 text-xs"
                    >
                      <option value="l">left</option>
                      <option value="c">center</option>
                      <option value="r">right</option>
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cells.map((r, ri) => (
                <tr key={`row-${ri}-${r.length}`}>
                  {r.map((v, ci) => (
                    <td key={`cell-${ri}-${ci}`} className="p-1">
                      <Input
                        value={v}
                        aria-label={`Row ${ri + 1} column ${ci + 1}`}
                        onChange={(e) =>
                          setCells((prev) =>
                            prev.map((row, i) =>
                              i === ri ? row.map((cell, j) => (j === ci ? e.target.value : cell)) : row,
                            ),
                          )
                        }
                        className="h-8 w-28 text-xs"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Caption (optional)"
          aria-label="Table caption"
          className="mt-4 max-w-sm"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>LaTeX output</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(code);
              toast.success("Copied LaTeX source");
            }}
          >
            Copy
          </Button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs">{code}</pre>
        {booktabs && (
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            Requires <code>\usepackage{"{booktabs}"}</code> in your preamble.
          </p>
        )}
      </div>
    </div>
  );
}
