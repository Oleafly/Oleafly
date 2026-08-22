import { ChevronDown, ChevronRight, FileText, List } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { outlineFromIndex, type OutlineItem } from "@/lib/index/outline";
import { navigateToProjectRange } from "@/lib/project-intelligence/navigation";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { cn } from "@/lib/utils";

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}

// The section list for the document you are actually editing, following
// \input and \include so a split thesis reads as one outline.
//
// This is deliberately not the same thing as Structure below it. Structure
// answers "what is in this project" - every file, label, citation key and
// dependency, addressed by file:line. Outline answers "where am I in this
// document", which is the question you have while writing, and it needs to
// stay quiet enough to scan in one glance.
//
// Derived entirely from the shared project index, so it stays in step with
// everything else that reads the index and does no parsing or file IO here.
export function DocumentOutline() {
  const index = useIndexStore((state) => state.index);
  const activePath = useFilesStore((state) => state.activePath);
  const [collapsed, setCollapsed] = useState(false);

  const items = useMemo(
    () => (index && activePath ? outlineFromIndex(index, activePath) : []),
    [index, activePath],
  );

  const jump = useCallback((item: OutlineItem) => {
    // Goes through the shared navigation path, which opens the file, reveals
    // the editor and selects the range as one operation. The original outline
    // opened the file and then guessed at an 80ms delay before jumping, which
    // lost the jump whenever the open took longer.
    void navigateToProjectRange({
      path: item.file,
      range: { from: item.from, to: item.to },
      source: "outline",
    });
  }, []);

  return (
    <section
      aria-label="Document outline"
      className={cn(
        "flex min-h-0 flex-col border-t border-sidebar-border",
        collapsed ? "shrink-0" : "flex-1",
      )}
    >
      <div className="flex h-8 shrink-0 items-center border-b border-sidebar-border/65">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls="document-outline-content"
          onClick={() => setCollapsed((value) => !value)}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/75 hover:bg-sidebar-accent"
        >
          {collapsed ? (
            <ChevronRight aria-hidden className="size-3" />
          ) : (
            <ChevronDown aria-hidden className="size-3" />
          )}
          <List aria-hidden className="size-3.5" />
          <span className="truncate">Outline</span>
        </button>
        {!collapsed && items.length > 0 ? (
          <span
            role="status"
            aria-label={`${items.length} outline entries`}
            className="mr-2 rounded-sm bg-muted px-1 font-mono text-[9px] text-muted-foreground"
          >
            {items.length}
          </span>
        ) : null}
      </div>

      {!collapsed ? (
        <div
          id="document-outline-content"
          className="min-h-0 flex-1 overflow-auto py-1 [scrollbar-width:thin]"
        >
          {items.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-muted-foreground/70">
              No sections or includes in this document.
            </p>
          ) : (
            items.map((item) => {
              const crossFile = item.file !== activePath;
              return (
                <button
                  type="button"
                  key={`${item.file}:${item.line}:${item.kind}:${item.title}`}
                  onClick={() => jump(item)}
                  // Indent by heading depth so the shape of the document is
                  // visible without reading any of the titles.
                  style={{ paddingLeft: `${item.level * 12 + 12}px` }}
                  className="flex w-full items-center gap-1 truncate py-0.5 pr-2 text-left text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  title={`${item.title} — ${item.file}:${item.line}`}
                >
                  {item.kind === "file" ? (
                    <FileText
                      aria-hidden
                      className="size-3 shrink-0 text-muted-foreground"
                    />
                  ) : null}
                  <span
                    className={cn(
                      "truncate",
                      item.kind === "file" && "text-muted-foreground",
                    )}
                  >
                    {item.title}
                  </span>
                  {crossFile ? (
                    <span className="ml-auto shrink-0 rounded bg-muted px-1 font-mono text-[9px] text-muted-foreground/70">
                      {basename(item.file)}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </section>
  );
}
