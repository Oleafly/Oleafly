import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileWarning } from "lucide-react";
import { notifyError } from "@/lib/toast";
import { diffKey, useDiffStore } from "@/store/diff";
import { useFilesStore } from "@/store/files";

const BUTTON =
  "rounded border border-transparent px-2 py-0.5 font-medium transition-colors hover:bg-amber-500/15 focus-visible:border-amber-500/40 focus-visible:bg-amber-500/20 disabled:opacity-50";

export function ChangedOnDiskBanner() {
  const { t } = useTranslation(["editor"]);
  const path = useFilesStore((state) =>
    state.activePath && state.changedOnDisk.includes(state.activePath) ? state.activePath : null,
  );
  const [busy, setBusy] = useState(false);
  if (!path) return null;

  const closeComparison = () => useDiffStore.getState().closeDiff(diffKey({ path, side: "disk" }));
  const resolve = (choice: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    void choice()
      .then(closeComparison)
      .catch((error) =>
        notifyError(
          "resolve a file changed on disk",
          error,
          t(($) => $.editor.changedOnDisk.failed, { file: path }),
        ),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div
      data-testid="changed-on-disk-banner"
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400"
    >
      <FileWarning aria-hidden="true" className="size-3.5 shrink-0" />
      <output className="min-w-0 flex-1">
        {t(($) => $.editor.changedOnDisk.message, { file: path })}
      </output>
      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className={BUTTON}
          disabled={busy}
          onClick={() => useDiffStore.getState().openDiff(path, "disk")}
        >
          {t(($) => $.editor.changedOnDisk.compare)}
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={busy}
          onClick={() => resolve(() => useFilesStore.getState().keepLocalVersion(path))}
        >
          {t(($) => $.editor.changedOnDisk.keepMine)}
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={busy}
          onClick={() => resolve(() => useFilesStore.getState().reloadFromDisk(path))}
        >
          {t(($) => $.editor.changedOnDisk.reload)}
        </button>
      </span>
    </div>
  );
}
