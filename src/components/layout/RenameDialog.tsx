import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useRenameStore } from "@/store/rename";
import { useIndexStore } from "@/store/project-index";
import { getEditorView } from "@/components/editor/cm/controller";
import { applyRename } from "@/lib/index/nav";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import { Input } from "@/components/ui/input";

export function RenameDialog() {
  const { t } = useTranslation(["common", "shell"]);
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

  const renameSummary = () => {
    if (plan?.collision) {
      return (
        <span className="text-red-500">
          {t(($) => $.shell.renameDialog.collision, {
            kind: t(($) => $.shell.renameDialog.symbolKinds[sym.kind]),
            name,
          })}
        </span>
      );
    }
    if (plan) {
      return (
        t(($) => $.shell.renameDialog.planSummary, {
          count: plan.edits.length,
          files: plan.fileCount,
        })
      );
    }
    return (
      ""
    );
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 pt-[20vh] backdrop-blur-sm">
      <button
        type="button"
        aria-label={t(($) => $.shell.renameDialog.close)}
        className="absolute inset-0"
        onMouseDown={onBackdropMouseDown}
      />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="rename-title"
        className="relative w-[26rem] max-w-[90vw] rounded-lg border bg-popover p-4 text-popover-foreground shadow-xl"
      >
        <p id="rename-title" className="text-sm font-semibold">
          <Trans
            ns="shell"
            i18nKey={($) => $.shell.renameDialog.title}
            values={{ name: sym.name }}
            components={{ symbol: <span className="font-mono" /> }}
          />
        </p>
        <Input
          data-modal-initial-focus
          aria-label={t(($) => $.shell.renameDialog.newName)}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") close();
          }}
          className="mt-2 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="mt-2 h-4 text-[11px] text-muted-foreground">
          {renameSummary()}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={close} className="rounded-md border border-input px-3 py-1.5 text-xs hover:bg-accent">
            {t(($) => $.common.actions.cancel)}
          </button>
          <button
            type="button"
            aria-label={t(($) => $.shell.renameDialog.commit)}
            onClick={() => void submit()}
            disabled={!valid}
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-50"
          >
            {t(($) => $.common.actions.rename)}
          </button>
        </div>
      </div>
    </div>
  );
}
