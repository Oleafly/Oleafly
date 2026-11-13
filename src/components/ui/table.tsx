import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SortDirection = "ascending" | "descending";

export interface SortState<K> {
  readonly key: K;
  readonly direction: SortDirection;
}

const OTHER: Record<SortDirection, SortDirection> = { ascending: "descending", descending: "ascending" };

export function nextSort<K>(current: SortState<K> | null, key: K, first?: SortDirection): SortState<K>;
export function nextSort<K>(
  current: SortState<K> | null,
  key: K,
  first: SortDirection,
  clearable: true,
): SortState<K> | null;
export function nextSort<K>(
  current: SortState<K> | null,
  key: K,
  first: SortDirection = "ascending",
  clearable = false,
): SortState<K> | null {
  if (current?.key !== key) return { key, direction: first };
  if (current.direction === first) return { key, direction: OTHER[first] };
  return clearable ? null : { key, direction: first };
}

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & { containerClassName?: string }
>(({ className, containerClassName, ...props }, ref) => (
  <div className={cn("relative w-full overflow-auto", containerClassName)}>
    <table
      ref={ref}
      className={cn("w-full caption-bottom border-collapse text-xs", className)}
      {...props}
    />
  </div>
));
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn("sticky top-0 z-10 bg-card text-muted-foreground [&_tr]:border-b", className)}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("border-t bg-muted/40 font-medium [&>tr]:last:border-b-0", className)}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }
>(({ className, numeric, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-9 whitespace-nowrap px-3 text-left align-middle text-[0.6875rem] font-medium uppercase tracking-wide",
      numeric && "text-right",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }
>(({ className, numeric, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "px-3 py-2 align-middle",
      numeric && "text-right tabular-nums",
      className,
    )}
    {...props}
  />
));
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-3 text-xs text-muted-foreground", className)} {...props} />
));
TableCaption.displayName = "TableCaption";

function SortableTableHead({
  label,
  sortLabel,
  direction,
  onSort,
  numeric,
  ...props
}: Readonly<
  {
    label: React.ReactNode;
    sortLabel: string;
    direction: SortDirection | null;
    onSort: () => void;
    numeric?: boolean;
  } & Omit<React.ThHTMLAttributes<HTMLTableCellElement>, "children" | "onClick">
>) {
  const Arrow = direction === "ascending" ? ArrowUp : ArrowDown;
  return (
    <TableHead {...props} scope="col" numeric={numeric} aria-sort={direction ?? "none"}>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="-mx-2 font-medium uppercase tracking-wide"
        aria-label={sortLabel}
        onClick={onSort}
      >
        {label}
        {direction ? <Arrow aria-hidden /> : null}
      </Button>
    </TableHead>
  );
}

function TableSpacerRow({ height, span }: Readonly<{ height: number; span: number }>) {
  return (
    <tr aria-hidden>
      <td colSpan={span} className="p-0" style={{ height }} />
    </tr>
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  SortableTableHead,
  TableRow,
  TableSpacerRow,
  TableCell,
  TableCaption,
};
