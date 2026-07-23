import { useState } from "react";
import { Table as TableIcon } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { insertTable } from "@/components/editor/latex-commands";

const MAX_ROWS = 8;
const MAX_COLS = 10;

export function TableSizePicker({ menuRow }: { menuRow?: boolean }) {
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);

  return (
    <Popover
      ariaLabel="Insert table"
      className="w-auto p-3"
      triggerClassName={menuRow ? "w-full justify-start gap-2 px-2 font-normal" : undefined}
      trigger={
        menuRow ? (
          <>
            <TableIcon className="size-4" />
            <span className="flex-1 text-left">Table</span>
          </>
        ) : (
          <TableIcon className="size-4" />
        )
      }
    >
      <p className="mb-2 text-center text-xs font-medium text-muted-foreground">Insert table</p>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 1fr)` }}>
        {Array.from({ length: MAX_ROWS }, (_, row) =>
          Array.from({ length: MAX_COLS }, (_, col) => {
            const active = hover != null && row <= hover.row && col <= hover.col;
            return (
              <button
                type="button"
                key={`${row}-${col}`}
                aria-label={`${row + 1} by ${col + 1} table`}
                onMouseEnter={() => setHover({ row, col })}
                onClick={() => insertTable(row + 1, col + 1)}
                className={cn(
                  "size-5 rounded-sm border transition-colors",
                  active ? "border-primary bg-primary/20" : "border-border bg-transparent",
                )}
              />
            );
          }),
        )}
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        {hover ? `${hover.row + 1} × ${hover.col + 1}` : "Select size"}
      </p>
    </Popover>
  );
}
