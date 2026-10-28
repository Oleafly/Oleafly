import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { installMissingNotebookTool } from "@/store/compile";
import {
  NOTEBOOK_TOOL_LABELS,
  notebookInstallLabel,
  notebookToolBusy,
  openNotebookToolSettings,
  useNotebookToolchainStore,
} from "@/store/notebook-toolchain";
import { formatDownloadSize } from "@/lib/download-size";
import type { NotebookTool } from "@/lib/notebook-commands";

export function NotebookToolMissingOffer({
  compact,
  testId,
  projectId,
  tool,
}: Readonly<{ compact: boolean; testId: string; projectId: string; tool: NotebookTool }>) {
  const { t } = useTranslation(["preview"]);
  const status = useNotebookToolchainStore((s) => s.status);
  const installs = useNotebookToolchainStore((s) => s.installs);
  const removing = useNotebookToolchainStore((s) => s.removing);
  const ensureLoaded = useNotebookToolchainStore((s) => s.ensureLoaded);
  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);
  const size = compact ? "xs" : "sm";
  const toolStatus = status?.[tool] ?? null;
  const installing = installs[tool] ?? null;
  const installLabel = () => {
    if (installing) return notebookInstallLabel(installing);
    const values = { tool: NOTEBOOK_TOOL_LABELS[tool], version: toolStatus?.pinnedVersion ?? "" };
    return toolStatus?.downloadBytes
      ? t(($) => $.preview.actions.installToolSize, {
          ...values,
          size: formatDownloadSize(toolStatus.downloadBytes),
        })
      : t(($) => $.preview.actions.installTool, values);
  };
  return (
    <>
      {toolStatus?.offered && !toolStatus.managed && (
        <Button
          size={size}
          variant={compact ? "ghostPrimary" : "outline"}
          data-testid={testId}
          disabled={notebookToolBusy(tool, installs, status, removing)}
          onClick={() => void installMissingNotebookTool(projectId, tool)}
        >
          {installLabel()}
        </Button>
      )}
      <Button
        size={size}
        variant={compact ? "ghost" : "outline"}
        data-testid={`${testId}-settings`}
        onClick={() => openNotebookToolSettings(tool)}
      >
        {t(($) => $.preview.actions.engineSettings)}
      </Button>
    </>
  );
}
