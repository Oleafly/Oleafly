import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { logError } from "@/lib/log";
import { pdfSyncSet, pdfSyncStatus, type PdfSyncStatus } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";

export interface PdfSyncToggle {
  enabled: boolean;
  busy: boolean;
  path: string | null;
  note: string | null;
  refresh: () => void;
  setEnabled: (enabled: boolean) => void;
}

export function currentOutputId(
  checkpoint: { readonly outputId: string } | null | undefined,
  isCurrent: boolean,
): string | null {
  return isCurrent ? (checkpoint?.outputId ?? null) : null;
}

export function usePdfSync({
  projectId,
  available,
  outputId,
  fastCompile,
}: Readonly<{
  projectId: string | null;
  available: boolean;
  outputId: string | null;
  fastCompile: boolean;
}>): PdfSyncToggle | null {
  const { t } = useTranslation(["preview"]);
  const [status, setStatus] = useState<PdfSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const activeProject = useRef(projectId);
  activeProject.current = projectId;

  const refresh = useCallback(() => {
    if (!available || !projectId) return;
    pdfSyncStatus(projectId)
      .then((next) => {
        if (activeProject.current === projectId) setStatus(next);
      })
      .catch((error) => void logError("read PDF sync status", error));
  }, [available, projectId]);

  useEffect(() => {
    setStatus(null);
    refresh();
  }, [refresh]);

  const setEnabled = (enabled: boolean) => {
    if (!projectId || busy) return;
    setBusy(true);
    pdfSyncSet(projectId, enabled, enabled ? outputId : null)
      .then((next) => {
        if (activeProject.current === projectId) setStatus(next);
      })
      .catch((error) => notifyError("sync PDF on compiles", error, t(($) => $.preview.save.failed)))
      .finally(() => setBusy(false));
  };

  if (!available || !projectId) return null;
  const enabled = status?.enabled ?? false;
  const note = (): string | null => {
    if (!enabled) return null;
    if (status?.failed) return t(($) => $.preview.sync.failed, { name: status.failed });
    if (fastCompile) return t(($) => $.preview.sync.fastMode);
    return status?.localOnly ? t(($) => $.preview.sync.localOnly) : null;
  };
  return {
    enabled,
    busy,
    path: status?.path ?? null,
    note: note(),
    refresh,
    setEnabled,
  };
}
