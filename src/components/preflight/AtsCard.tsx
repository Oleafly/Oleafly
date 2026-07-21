import { memo } from "react";
import { Check, Mail, MapPin, Phone, User, X } from "lucide-react";
import type { AtsParse } from "@oleafly/preflight";
import { cn } from "@/lib/utils";

export const AtsCard = memo(function AtsCard({ parse }: { parse: AtsParse }) {
  const field = (Icon: typeof User, value: string | null) => (
    <div className="flex items-center gap-2 text-xs">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      {value ? <span className="truncate">{value}</span> : <span className="text-red-500">Not found</span>}
    </div>
  );

  return (
    <div className="mx-3 mb-3 rounded-md border border-sidebar-border bg-black/[0.03] p-3 dark:bg-background">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">What a parser extracted</p>
      <div className="flex flex-col gap-1.5">
        {field(User, parse.name)}
        {field(Mail, parse.email)}
        {field(Phone, parse.phone)}
        {field(MapPin, parse.links.length ? `${parse.links.length} link${parse.links.length > 1 ? "s" : ""}` : null)}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {parse.sections.map((s) => (
          <span
            key={s.name}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
              s.present ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400",
            )}
          >
            {s.present ? <Check className="size-3" /> : <X className="size-3" />}
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
});
