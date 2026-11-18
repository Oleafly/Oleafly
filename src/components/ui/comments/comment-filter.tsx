import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const COMMENT_FILTERS = ["open", "resolved", "all"] as const;
export type CommentFilter = (typeof COMMENT_FILTERS)[number];

export function keepsThread(filter: CommentFilter, resolved: boolean): boolean {
  if (filter === "all") return true;
  return filter === "resolved" ? resolved : !resolved;
}

export function CommentFilterMenu({
  value,
  counts,
  labels,
  ariaLabel,
  format = String,
  onChange,
}: Readonly<{
  value: CommentFilter;
  counts: Readonly<Record<CommentFilter, number>>;
  labels: Readonly<Record<CommentFilter, string>>;
  ariaLabel: (current: string) => string;
  format?: (count: number) => string;
  onChange: (filter: CommentFilter) => void;
}>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label={ariaLabel(labels[value])}
          className="h-6 gap-0.5 px-1.5 font-medium text-sidebar-foreground/80 hover:text-foreground"
        >
          {labels[value]}
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {COMMENT_FILTERS.map((filter) => (
          <DropdownMenuCheckboxItem key={filter} checked={value === filter} onSelect={() => onChange(filter)}>
            <span className="flex-1">{labels[filter]}</span>
            <span className="tabular-nums text-muted-foreground">{format(counts[filter])}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
