import { i18n } from "@/i18n";
import { decodeAppError, describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import { recompileWithPreview } from "@/lib/compile-preview";
import { engineSwitchToastKey, useFilesStore } from "@/store/files";

export async function applyShellEscape(
  allow: boolean,
  { recompile = false }: Readonly<{ recompile?: boolean }> = {},
): Promise<boolean> {
  const files = useFilesStore.getState();
  const projectId = files.projectId;
  if (!projectId) return false;
  try {
    await files.setShellEscape(allow);
  } catch (error) {
    void logError("update external command access", error);
    toast.errorUnique(
      engineSwitchToastKey(projectId),
      decodeAppError(error)
        ? describeError(error)
        : i18n.t(($) => $.shell.enginePicker.shellEscapeFailed),
    );
    return false;
  }
  if (recompile && useFilesStore.getState().projectId === projectId) {
    void recompileWithPreview();
  }
  return true;
}
