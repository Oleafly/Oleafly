import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FolderX, X } from "lucide-react";
import { openFolderWithPicker } from "@/features/open-folder";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useOpenFolderFlowStore } from "@/store/open-folder-flow";

const ACTION =
  "shrink-0 rounded-md border border-destructive/30 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-destructive/10 focus-visible:border-destructive/60 focus-visible:bg-destructive/10";

export function OpenFolderNotice({ className }: Readonly<{ className?: string }>) {
  const { t } = useTranslation(["library", "shell"]);
  const refusal = useOpenFolderFlowStore((state) => state.refusal);
  const clearRefusal = useOpenFolderFlowStore((state) => state.clearRefusal);

  useEffect(
    () => () => {
      const leftLibrary =
        useFilesStore.getState().projectId !== null ||
        useHomeViewStore.getState().page !== "library";
      if (leftLibrary) useOpenFolderFlowStore.getState().clearRefusal();
    },
    [],
  );

  if (!refusal) return null;
  const browse = refusal.browse;
  return (
    <div
      role="alert"
      data-testid="open-folder-notice"
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-left text-sm text-foreground",
        className,
      )}
    >
      <FolderX aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-relaxed">
        {refusal.title ? <p className="font-medium">{refusal.title}</p> : null}
        <p className={cn(refusal.title && "text-muted-foreground")}>{refusal.message}</p>
        {refusal.hint ? <p className="text-muted-foreground">{refusal.hint}</p> : null}
      </div>
      {browse ? (
        <button
          type="button"
          className={ACTION}
          onClick={() => {
            clearRefusal();
            void openFolderWithPicker(browse);
          }}
        >
          {t(($) => $.shell.openFolder.chooseSubfolder)}
        </button>
      ) : null}
      <button
        type="button"
        aria-label={t(($) => $.library.openFolder.dismiss)}
        onClick={clearRefusal}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-foreground focus-visible:bg-destructive/10 focus-visible:text-foreground"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}
