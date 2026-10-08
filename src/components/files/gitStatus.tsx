import { useTranslation } from "react-i18next";
import type { GitFileChange } from "@oleafly/backend-port";
import { cn } from "@/lib/utils";

type GitStatusName =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflict";

export type GitStatusMeta = Readonly<{
  /** Letter shown in the badge. */
  label: string;
  name: GitStatusName;
  /** Text colour of the badge. */
  text: string;
  fill: string;
}>;

const CONFLICT = "U";
const STATUS_META: Record<string, GitStatusMeta> = {
  M: {
    label: "M",
    name: "modified",
    text: "text-amber-600 dark:text-amber-400",
    fill: "bg-amber-500/15",
  },
  A: {
    label: "A",
    name: "added",
    text: "text-emerald-600 dark:text-emerald-400",
    fill: "bg-emerald-500/15",
  },
  D: { label: "D", name: "deleted", text: "text-destructive", fill: "bg-destructive/15" },
  R: { label: "R", name: "renamed", text: "text-primary", fill: "bg-primary/15" },
  "?": { label: "U", name: "untracked", text: "text-primary", fill: "bg-primary/15" },
  [CONFLICT]: { label: "!", name: "conflict", text: "text-destructive", fill: "bg-destructive/15" },
};

export function gitStatusMeta(status: string): GitStatusMeta {
  return (
    STATUS_META[status] ?? {
      label: status.slice(0, 1),
      name: "modified",
      text: "text-muted-foreground",
      fill: "bg-muted",
    }
  );
}

export type GitDecorations = Readonly<{
  files: ReadonlyMap<string, GitStatusMeta>;
  /** Folders that contain changes, with the most urgent change inside. */
  folders: ReadonlyMap<string, GitStatusMeta>;
}>;

// Like VS Code: a conflict beats the working tree, which beats the index.
const sideRank = (change: GitFileChange) => {
  if (change.conflict) return 2;
  return change.staged ? 0 : 1;
};
const FOLDER_RANK: readonly GitStatusName[] = [
  "untracked",
  "renamed",
  "added",
  "deleted",
  "modified",
  "conflict",
];

/** Path lookups for the Explorer, built once per Git status refresh. */
export function gitDecorations(changes: readonly GitFileChange[]): GitDecorations {
  const winners = new Map<string, GitFileChange>();
  for (const change of changes) {
    const seen = winners.get(change.path);
    if (!seen || sideRank(change) > sideRank(seen)) winners.set(change.path, change);
  }
  const files = new Map<string, GitStatusMeta>();
  const folders = new Map<string, GitStatusMeta>();
  for (const [path, change] of winners) {
    const meta = gitStatusMeta(change.conflict ? CONFLICT : change.status);
    files.set(path, meta);
    for (let end = path.lastIndexOf("/"); end > 0; end = path.lastIndexOf("/", end - 1)) {
      const folder = path.slice(0, end);
      const current = folders.get(folder);
      if (!current || FOLDER_RANK.indexOf(meta.name) > FOLDER_RANK.indexOf(current.name)) {
        folders.set(folder, meta);
      }
    }
  }
  return { files, folders };
}

export function GitStatusBadge({
  meta,
  id,
  className,
  testId,
}: Readonly<{ meta: GitStatusMeta; id?: string; className?: string; testId?: string }>) {
  const { t } = useTranslation(["shell"]);
  const name = t(($) => $.shell.sourceControl.status[meta.name]);
  return (
    <span
      id={id}
      data-testid={testId}
      title={name}
      role="img"
      aria-label={name}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold",
        meta.fill,
        meta.text,
        className,
      )}
    >
      <span aria-hidden>{meta.label}</span>
    </span>
  );
}

export function GitFolderDot({ meta }: Readonly<{ meta: GitStatusMeta }>) {
  const { t } = useTranslation(["shell"]);
  const label = t(($) => $.shell.sourceControl.status.containsChanges);
  return (
    <span
      title={label}
      role="img"
      aria-label={label}
      className={cn("flex size-4 shrink-0 items-center justify-center", meta.text)}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
    </span>
  );
}
