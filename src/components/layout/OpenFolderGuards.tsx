import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { isTauri } from "@tauri-apps/api/core";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  openFolderWithPicker,
  startOpenRequestIntake,
  startRecentProjectsMenuSync,
} from "@/features/open-folder";
import { releaseBootSplash } from "@/lib/boot-telemetry";
import { logError } from "@/lib/log";
import { usesNativeDockMenu } from "@/lib/native-dock-shortcuts";
import { useOpenFolderFlowStore } from "@/store/open-folder-flow";
import { matchesShortcut, useShortcutStore } from "@/store/shortcuts";
import { useTourStore } from "@/store/tours";

export function OpenFolderStopDialog() {
  const { t } = useTranslation(["shell"]);
  const prompt = useOpenFolderFlowStore((state) => state.prompt);
  const answer = useOpenFolderFlowStore((state) => state.answer);
  const values = { name: prompt?.name ?? "", project: prompt?.project ?? "" };
  let description = t(($) => $.shell.openFolder.confirmAssistant, values);
  if (prompt?.compile && prompt.assistant) {
    description = t(($) => $.shell.openFolder.confirmBoth, values);
  } else if (prompt?.compile) {
    description = t(($) => $.shell.openFolder.confirmCompile, values);
  }
  return (
    <ConfirmationDialog
      open={prompt !== null}
      title={t(($) => $.shell.openFolder.confirmTitle, values)}
      description={description}
      confirmLabel={t(($) => $.shell.openFolder.confirmAction)}
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
    />
  );
}

export function useOpenFolderIntake(): void {
  useEffect(() => {
    if (!isTauri()) {
      releaseBootSplash();
      return;
    }
    let disposed = false;
    let stopIntake: (() => void) | undefined;
    void startOpenRequestIntake()
      .then((stop) => {
        if (disposed) stop();
        else stopIntake = stop;
      })
      .catch((error) => {
        void logError("listen for folders to open", error);
        releaseBootSplash();
      });
    const stopRecent = startRecentProjectsMenuSync();
    return () => {
      disposed = true;
      stopIntake?.();
      stopRecent();
    };
  }, []);

  useEffect(() => {
    if (usesNativeDockMenu()) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || useTourStore.getState().activeTourId) return;
      if (!matchesShortcut(event, useShortcutStore.getState().bindings.openFolder)) return;
      event.preventDefault();
      void openFolderWithPicker();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
