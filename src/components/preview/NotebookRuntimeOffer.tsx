import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { acceptRuntimeNeed } from "@/features/runtime-setup";
import { formatDownloadSize } from "@/lib/download-size";
import { packageLabel, type RuntimeNeed } from "@/lib/runtime-needs";
import {
  openNotebookToolSettings,
  RUNTIME_LABELS,
  runtimeIn,
  runtimeTaskLabel,
  useNotebookToolchainStore,
} from "@/store/notebook-toolchain";

export function NotebookRuntimeOffer({
  compact,
  testId,
  projectId,
  need,
}: Readonly<{ compact: boolean; testId: string; projectId: string; need: RuntimeNeed }>) {
  const { t } = useTranslation(["preview"]);
  const status = useNotebookToolchainStore((s) => s.status);
  const awaiting = useNotebookToolchainStore((s) => s.awaitingInstaller.includes(need.runtime));
  const task = useNotebookToolchainStore((s) => {
    if (need.kind === "runtime") return s.runtimeTasks[need.runtime];
    return s.runtimeTasks[need.runtime === "r" ? "r-packages" : "python-packages"];
  });
  const ensureLoaded = useNotebookToolchainStore((s) => s.ensureLoaded);
  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);
  const label = (() => {
    if (task) return runtimeTaskLabel(task);
    if (need.kind === "packages") {
      return t(($) => $.preview.actions.installPackage, { name: packageLabel(need.packages[0] ?? "") });
    }
    if (awaiting) return t(($) => $.preview.actions.checkAgain);
    const installer = runtimeIn(status, need.runtime)?.installer;
    if (!installer) return null;
    return t(($) => $.preview.actions.installToolSize, {
      tool: RUNTIME_LABELS[need.runtime],
      version: installer.version,
      size: formatDownloadSize(installer.downloadBytes),
    });
  })();
  const size = compact ? "xs" : "sm";
  return (
    <>
      {label && (
        <Button
          size={size}
          variant={compact ? "ghostPrimary" : "outline"}
          data-testid={testId}
          data-runtime-need={need.kind === "runtime" ? need.runtime : need.packages.join(",")}
          disabled={task !== undefined}
          onClick={() => void acceptRuntimeNeed(projectId, need)}
        >
          {label}
        </Button>
      )}
      <Button
        size={size}
        variant={compact ? "ghost" : "outline"}
        data-testid={`${testId}-settings`}
        onClick={() => openNotebookToolSettings("quarto")}
      >
        {t(($) => $.preview.actions.engineSettings)}
      </Button>
    </>
  );
}
