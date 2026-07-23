import { useEffect, useState } from "react";
import { useRenameStore } from "@/store/rename";
import { useIndexStore } from "@/store/project-index";
import { getEditorView } from "@/components/editor/cm/controller";
import { applyRename } from "@/lib/index/nav";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import { Input } from "@/components/ui/input";

export function RenameDialog() {
  const sym = useRenameStore((s) => s.sym);
  const close = useRenameStore((s) => s.close);
  const index = useIndexStore((s) => s.index);
  const [name, setName] = useState("");
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(!!sym, close);

  useEffect(() => {
    if (sym) setName(sym.name);
  }, [sym]);

  if (!sym) return null;

  const plan = index && name && name !== sym.name ? index.renamePlan(sym, name) : null;
  const valid = name.trim().length > 0 && name !== sym.name && !plan?.collision;

  const submit = async () => {
    const view = getEditorView();
    close();
    if (view && valid) await applyRename(view, sym, name.trim());
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 pt-[20vh] backdrop-blur-sm">
      <button type="button" aria-label="Close rename dialog" className="absolute inset-0" onMouseDown={onBackdropMouseDown} />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="rename-title"
        className="relative w-[26rem] max-w-[90vw] rounded-lg border bg-popover p-4 text-popover-foreground shadow-xl"
      >
        <p id="rename-title" className="text-sm font-semibold">
          Rename <span className="font-mono">{sym.name}</span>
        </p>
        <Input
          data-modal-initial-focus
          aria-label="New name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") close();
          }}
          className="mt-2 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="mt-2 h-4 text-[11px] text-muted-foreground">
          {plan?.collision ? (
            <span className="text-red-500">A {sym.kind} named "{name}" already exists.</span>
          ) : plan ? (
            `${plan.edits.length} edit${plan.edits.length > 1 ? "s" : ""} across ${plan.fileCount} file${plan.fileCount > 1 ? "s" : ""}`
          ) : (
            ""
          )}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={close} className="rounded-md border border-input px-3 py-1.5 text-xs hover:bg-accent">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!valid}
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-50"
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}
