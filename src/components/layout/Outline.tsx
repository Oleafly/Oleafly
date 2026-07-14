import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, List } from "lucide-react";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { outlineFromIndex } from "@/lib/index/outline";
import { gotoLine } from "@/components/editor/cm/controller";

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

// Derived entirely from the shared project index; no parsing/file IO of its
// own, so it stays in sync with everything else that reads the index.
export function Outline() {
  const index = useIndexStore((s) => s.index);
  const activePath = useFilesStore((s) => s.activePath);
  const [collapsed, setCollapsed] = useState(false);

  const items = useMemo(
    () => (index && activePath ? outlineFromIndex(index, activePath) : []),
    [index, activePath],
  );

  const jump = (item: { file: string; line: number }) => {
    const store = useFilesStore.getState();
    if (item.file && item.file !== store.activePath) {
      void store.openFile(item.file).then(() => {
        window.setTimeout(() => gotoLine(item.line), 80);
      });
    } else {
      gotoLine(item.line);
    }
  };

  return (
    <div className="flex shrink-0 flex-col border-t border-sidebar-border">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex h-8 items-center gap-1.5 px-3 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70 hover:bg-sidebar-accent"
      >
        {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
        <List className="size-3.5" />
        Outline
      </button>
      {!collapsed && (
        <div className="max-h-[40vh] overflow-auto pb-2">
          {items.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-muted-foreground/70">
              No sections or includes found in this document.
            </p>
          ) : (
            items.map((item, i) => {
              const crossFile = item.file !== activePath;
              return (
                <button
                  key={i}
                  onClick={() => jump(item)}
                  className="flex w-full cursor-pointer items-center gap-1 truncate py-0.5 pr-2 text-left text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  style={{ paddingLeft: `${item.level * 12 + 12}px` }}
                  title={`${item.title} - ${item.file}:${item.line}`}
                >
                  {item.kind === "file" && <FileText className="size-3 shrink-0 text-muted-foreground" />}
                  <span className={item.kind === "file" ? "truncate text-muted-foreground" : "truncate"}>
                    {item.title}
                  </span>
                  {crossFile && (
                    <span className="ml-auto shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground/70">
                      {basename(item.file)}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
