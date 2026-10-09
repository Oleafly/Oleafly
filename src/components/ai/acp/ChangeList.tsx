import { useId, useState } from "react";
import { FileDiff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DiffPreview } from "@/components/ai/turns/DiffPreview";
import { useDisplayPath } from "@/lib/display-path";
import { cn } from "@/lib/utils";

export interface ProposedChange {
  path: string;
  oldText: string | null;
  newText: string | null;
  truncated?: boolean;
}

function ChangeRow({
  change,
  open,
  onToggle,
}: Readonly<{ change: ProposedChange; open: boolean; onToggle: () => void }>) {
  const { t } = useTranslation(["common", "ai"]);
  // A file outside the project arrives as an absolute path; show it as `~/…`.
  const displayPath = useDisplayPath();
  const shown = displayPath(change.path);
  const pathId = useId();
  const panelId = useId();
  if (change.truncated) {
    return (
      <li className="px-1 py-0.5 text-[0.6875rem] text-muted-foreground">
        {t(($) => $.ai.acp.permission.diff.large, { path: shown })}
      </li>
    );
  }
  return (
    <li className="py-0.5">
      <div className="flex min-w-0 items-center gap-2">
        <FileDiff aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span id={pathId} className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-foreground">
          {shown}
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-describedby={pathId}
          onClick={onToggle}
          className="shrink-0 rounded px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent"
        >
          {open ? t(($) => $.ai.acp.permission.diff.hideChange) : t(($) => $.ai.acp.permission.diff.showChange)}
        </button>
      </div>
      {open ? (
        <div id={panelId} className="mt-1.5">
          <DiffPreview
            path={change.path}
            oldText={change.oldText ?? ""}
            newText={change.newText ?? ""}
            label={t(($) => $.ai.acp.permission.diff.label, { path: shown })}
            loadingLabel={t(($) => $.ai.acp.permission.diff.loading)}
          />
        </div>
      ) : null}
    </li>
  );
}

/**
 * The files an agent wants to change (or changed), with each proposed diff
 * collapsed behind "Show change". Only one diff is open at a time so the list
 * stays short; a change too large to keep points to the turn review instead.
 */
export function ChangeList({
  changes,
  paths = [],
  className,
  testId,
}: Readonly<{
  changes: readonly ProposedChange[];
  paths?: readonly string[];
  className?: string;
  testId?: string;
}>) {
  const [open, setOpen] = useState<number | null>(null);
  const displayPath = useDisplayPath();
  const shown = new Set(changes.map((change) => change.path));
  const seen = new Map<string, number>();
  const keys = changes.map((change) => {
    const occurrence = seen.get(change.path) ?? 0;
    seen.set(change.path, occurrence + 1);
    return occurrence === 0 ? change.path : `${change.path}#${occurrence}`;
  });
  const others = [...new Set(paths)].filter((path) => !shown.has(path));
  if (changes.length === 0 && others.length === 0) return null;
  return (
    <ul data-testid={testId} className={cn("space-y-0.5", className)}>
      {changes.map((change, index) => (
        <ChangeRow
          key={keys[index]}
          change={change}
          open={open === index}
          onToggle={() => setOpen((current) => (current === index ? null : index))}
        />
      ))}
      {others.map((path) => (
        <li key={path} className="flex min-w-0 items-center gap-2 py-0.5">
          <FileDiff aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-foreground">
            {displayPath(path)}
          </span>
        </li>
      ))}
    </ul>
  );
}
