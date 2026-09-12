import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Table as TableIcon } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { insertTable } from "@/components/editor/latex-commands";

const MAX_ROWS = 8;
const MAX_COLS = 10;
const TABLE_SIZES = Array.from({ length: MAX_ROWS }, (_, row) =>
  Array.from({ length: MAX_COLS }, (_, col) => ({
    id: `${row}-${col}`,
    row,
    col,
  })),
).flat();

export function TableSizePicker({ menuRow }: Readonly<{ menuRow?: boolean }>) {
  const { t } = useTranslation(["common", "editor"]);
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);

  return (
    <Popover
      ariaLabel={t(($) => $.editor.table.trigger)}
      className="w-auto p-3"
      triggerClassName={menuRow ? "w-full justify-start gap-2 px-2 font-normal" : undefined}
      trigger={
        menuRow ? (
          <>
            <TableIcon className="size-4" />
            <span className="flex-1 text-left">{t(($) => $.editor.table.menuLabel)}</span>
          </>
        ) : (
          <TableIcon className="size-4" />
        )
      }
    >
      <p className="mb-2 text-center text-xs font-medium text-muted-foreground">
        {t(($) => $.editor.table.heading)}
      </p>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 1fr)` }}>
        {TABLE_SIZES.map(({ id, row, col }) => {
          const active = hover != null && row <= hover.row && col <= hover.col;
          return (
            <button
              type="button"
              key={id}
              aria-label={t(($) => $.editor.table.cell, { rows: row + 1, columns: col + 1 })}
              onMouseEnter={() => setHover({ row, col })}
              onClick={() => insertTable(row + 1, col + 1)}
              className={cn(
                "size-5 rounded-sm border transition-colors",
                active ? "border-primary bg-primary/20" : "border-border bg-transparent",
              )}
            />
          );
        })}
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        {hover
          ? t(($) => $.editor.table.size, { rows: hover.row + 1, columns: hover.col + 1 })
          : t(($) => $.editor.table.selectSize)}
      </p>
    </Popover>
  );
}
