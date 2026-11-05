import { i18n } from "@/i18n";
import { decodeAppError, describeError, SHELL_ESCAPE_DECLINED } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import { recompileWithPreview } from "@/lib/compile-preview";
import { useEngineStore } from "@/store/engine";
import { useEnginePickerStore } from "@/store/engine-picker";
import { engineSwitchToastKey, useFilesStore } from "@/store/files";

export function shellEscapeDeclined(error: unknown): boolean {
  return decodeAppError(error)?.code === SHELL_ESCAPE_DECLINED;
}

export async function offerTexSetupAfterSwitch(): Promise<void> {
  const { projectId } = useFilesStore.getState();
  const engine = useEngineStore.getState();
  if (engine.installing) return;
  await engine.refresh({ rescan: "full" });
  const blocked = Boolean(useEngineStore.getState().info?.latexmk_blocker);
  const files = useFilesStore.getState();
  if (blocked && files.projectId === projectId && files.engine.id === "latexmk") {
    useEnginePickerStore.getState().openPicker("tex-missing", []);
  }
}

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
    if (shellEscapeDeclined(error)) return false;
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
