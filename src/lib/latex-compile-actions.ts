import { i18n } from "@/i18n";
import { decodeAppError, describeError, SHELL_ESCAPE_DECLINED } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import { recompileWithPreview } from "@/lib/compile-preview";
import { useEngineStore } from "@/store/engine";
import { latexmkBlocked } from "@/lib/tex-distributions";
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
  const blocked = latexmkBlocked(useEngineStore.getState().info);
  const files = useFilesStore.getState();
  if (blocked && files.projectId === projectId && files.engine.id === "latexmk") {
    useEnginePickerStore.getState().openPicker("tex-missing", []);
  }
}

let shellEscapeChange: { readonly allow: boolean; readonly change: Promise<boolean> } | null = null;

export function applyShellEscape(
  allow: boolean,
  options: Readonly<{ recompile?: boolean }> = {},
): Promise<boolean> {
  const pending = shellEscapeChange;
  if (pending?.allow === allow) return pending.change;
  const run = () => changeShellEscape(allow, options);
  const change: Promise<boolean> = (pending ? pending.change.then(run, run) : run()).finally(() => {
    if (shellEscapeChange?.change === change) shellEscapeChange = null;
  });
  shellEscapeChange = { allow, change };
  return change;
}

async function changeShellEscape(
  allow: boolean,
  { recompile = false }: Readonly<{ recompile?: boolean }>,
): Promise<boolean> {
  const files = useFilesStore.getState();
  const projectId = files.projectId;
  if (!projectId) return false;
  if (!allow) {
    const { compileIsBusy, useCompileStore } = await import("@/store/compile");
    if (compileIsBusy()) await useCompileStore.getState().stopCompile();
  }
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
