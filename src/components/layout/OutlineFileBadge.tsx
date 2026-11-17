import { Badge } from "@/components/ui/badge";
import { basename } from "@/lib/path-utils";
import { cn } from "@/lib/utils";

export function OutlineFileBadge({ file, className }: Readonly<{ file: string; className?: string }>) {
  return (
    <Badge variant="muted" size="sm" className={cn("shrink-0 font-mono", className)}>
      {basename(file).replace(/\.[^.]+$/u, "")}
    </Badge>
  );
}
