import { useMemo, useState } from "react";
import { FileText, Folder, FolderOpen, Search } from "lucide-react";
import { useFilesStore } from "@/store/files";
import { cn } from "@/lib/utils";

// The composer's working-directory tree. Clicking a file only opens it in the
// side viewer — the workspace editor is never launched from here; it stays
// reachable through the viewer's explicit open button.
export function FilesPane({ onOpenFile }: { onOpenFile?: (path: string) => void }) {
  const tree = useFilesStore((s) => s.tree);
  const activePath = useFilesStore((s) => s.activePath);
  const projectId = useFilesStore((s) => s.projectId);

  const [filter, setFilter] = useState("");

  const storageKey = `oleafly.harness.tree-collapsed.${projectId ?? ""}`;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const ids = raw ? (JSON.parse(raw) as string[]) : [];
      return Object.fromEntries(ids.map((id) => [id, true]));
    } catch {
      return {};
    }
  });

  const persist = (next: Record<string, boolean>) => {
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify(Object.keys(next).filter((k) => next[k])),
      );
    } catch {
      /* in-memory only in non-persistent contexts */
    }
  };

  const toggleDir = (path: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [path]: !prev[path] };
      persist(next);
      return next;
    });
  };

  const visible = useMemo(() => {
    const collapsedDirs = Object.keys(collapsed).filter((k) => collapsed[k]);
    const needle = filter.trim().toLowerCase();
    return tree.filter((entry) => {
      if (collapsedDirs.some((dir) => entry.path.startsWith(`${dir}/`))) return false;
      if (!needle) return true;
      return entry.path.toLowerCase().includes(needle);
    });
  }, [tree, collapsed, filter]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="harness-files">
      <div className="shrink-0 border-b px-2.5 py-2">
        <label className="flex items-center gap-1.5 rounded-md bg-surface-secondary px-2 py-1">
          <Search className="size-3 shrink-0 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files"
            aria-label="Filter files"
            data-testid="harness-files-filter"
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tree.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">
            No files in this project yet.
          </p>
        )}
        {tree.length > 0 && visible.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground" data-testid="harness-files-no-match">
            No files match “{filter.trim()}”.
          </p>
        )}
        {visible.map((entry) => {
          const depth = entry.path.split("/").length - 1;
          const name = entry.path.split("/").pop() ?? entry.path;
          const isCollapsedDir = entry.is_dir && collapsed[entry.path] === true;
          return (
            <button
              key={entry.path}
              type="button"
              aria-expanded={entry.is_dir ? !isCollapsedDir : undefined}
              aria-label={
                entry.is_dir ? `${isCollapsedDir ? "Expand" : "Collapse"} ${name}` : undefined
              }
              onClick={() => {
                if (entry.is_dir) {
                  toggleDir(entry.path);
                  return;
                }
                onOpenFile?.(entry.path);
              }}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs text-foreground transition-colors hover:bg-accent",
                activePath === entry.path && "bg-accent",
              )}
            >
              {entry.is_dir ? (
                isCollapsedDir ? (
                  <Folder className="size-3.5 shrink-0 opacity-70" />
                ) : (
                  <FolderOpen className="size-3.5 shrink-0 opacity-70" />
                )
              ) : (
                <FileText className="size-3.5 shrink-0 opacity-70" />
              )}
              <span className="truncate">{name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
