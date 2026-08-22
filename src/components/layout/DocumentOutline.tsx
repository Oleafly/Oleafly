import { ChevronDown, ChevronRight, FileText, List } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorViewportAnchor } from "@/components/editor/cm/use-viewport-anchor";
import { outlineFromIndex, type OutlineItem } from "@/lib/index/outline";
import { activeOutlineIndex } from "@/lib/outline-active";
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
    () =>
      index && activePath
        ? outlineFromIndex(index, activePath).filter(
            // Sections only. An \input whose target has no headings of its own
            // contributed a bare filename row, which is file-tree information,
            // not an outline.
            (item) => item.kind === "section",
          )
        : [],
    [index, activePath],
  );

  const anchor = useEditorViewportAnchor();
  const activeIndex = useMemo(
    () => activeOutlineIndex(items, anchor),
    [items, anchor],
  );

  const activeRef = useRef<HTMLButtonElement | null>(null);
  // A long outline scrolls itself to follow the editor, but never while the
  // pointer is over the panel: yanking the list out from under a reader who is
  // about to click a different section is worse than losing the highlight.
  const hoveringRef = useRef(false);
  useEffect(() => {
    if (collapsed || activeIndex < 0 || hoveringRef.current) return;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, collapsed]);

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
          {items.length > 0 ? (
            <span
              role="status"
              aria-label={`${items.length} outline entries`}
              className="ml-auto shrink-0 rounded-sm bg-muted px-1 font-mono text-[9px] text-muted-foreground"
            >
              {items.length}
            </span>
          ) : null}
        </button>
      </div>

      {!collapsed ? (
        <div
          id="document-outline-content"
          className="min-h-0 flex-1 overflow-auto py-1 [scrollbar-width:thin]"
          onPointerEnter={() => {
            hoveringRef.current = true;
          }}
          onPointerLeave={() => {
            hoveringRef.current = false;
          }}
        >
          {items.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-muted-foreground/70">
              No sections or includes in this document.
            </p>
          ) : (
            items.map((item, index) => {
              const crossFile = item.file !== activePath;
              const active = index === activeIndex;
              return (
                <button
                  type="button"
                  key={`${item.file}:${item.line}:${item.kind}:${item.title}`}
                  ref={active ? activeRef : undefined}
                  onClick={() => jump(item)}
                  aria-current={active ? "location" : undefined}
                  // Indent by heading depth so the shape of the document is
                  // visible without reading any of the titles. The active
                  // marker takes 2px off the left padding so the accent bar
                  // does not shift the title it marks.
                  style={{ paddingLeft: `${item.level * 12 + 12 - (active ? 2 : 0)}px` }}
                  className={cn(
                    "flex w-full items-center gap-1 truncate py-0.5 pr-2 text-left text-xs hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    active
                      ? "border-l-2 border-primary bg-sidebar-accent/60 font-medium text-sidebar-foreground"
                      : "text-sidebar-foreground/80",
                  )}
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
                      {basename(item.file).replace(/\.[^.]+$/, "")}
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
