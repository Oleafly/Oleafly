import { Search } from "lucide-react";
import { useReferencesStore } from "@/store/references";
import { useIndexStore } from "@/store/project-index";
import { useFilesStore } from "@/store/files";
import { gotoRange } from "@/components/editor/cm/controller";
import type { Sym } from "@/lib/index/types";
import { objectKey } from "@/lib/react-key";

function basename(p: string) {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

const KIND_LABEL: Partial<Record<Sym["kind"], string>> = {
  label: "definition",
  macro: "definition",
  bibentry: "definition",
  theorem: "definition",
  glossary: "definition",
  environment: "definition",
};

export function ReferencesPanel() {
  const { title, results } = useReferencesStore();
  const texts = useIndexStore((s) => s.texts);

  const jump = (sym: Sym) => {
    const files = useFilesStore.getState();
    if (sym.file === files.activePath) {
      gotoRange(sym.from, sym.to);
    } else {
      void files.openFile(sym.file).then(() => window.setTimeout(() => gotoRange(sym.from, sym.to), 80));
    }
  };

  const preview = (sym: Sym) => (texts[sym.file]?.split("\n")[sym.line - 1] ?? "").trim();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center gap-2 border-b border-sidebar-border px-3">
        <Search className="size-3.5 text-muted-foreground" />
        <span className="truncate text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70">
          {title || "References"}
        </span>
        {results.length > 0 && <span className="ml-auto text-[10px] text-muted-foreground">{results.length}</span>}
      </div>
      <div className="flex-1 overflow-auto p-1.5">
        {results.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Put the cursor on a label, citation, or macro and press Shift-F12.
          </p>
        ) : (
          results.map((sym) => (
            <button type="button"
              key={objectKey(sym, "reference")}
              onClick={() => jump(sym)}
              className="block w-full cursor-pointer rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent"
            >
              <div className="flex items-center gap-1.5 text-xs">
                <span className="truncate font-medium">{basename(sym.file)}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">:{sym.line}</span>
                {KIND_LABEL[sym.kind] && (
                  <span className="ml-auto shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground">def</span>
                )}
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{preview(sym)}</div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
