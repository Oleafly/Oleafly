import { emitTo, listen } from "@tauri-apps/api/event";
import { openNotes } from "@/features/open-tool";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { nativeAccelerator } from "@/lib/native-dock-shortcuts";
import { quickCaptureConfigure } from "@/lib/tauri";
import { useQuickCaptureStore } from "@/store/quick-capture";
import { useSettingsStore } from "@/store/settings";
import { useShortcutStore } from "@/store/shortcuts";
import {
  CAPTURE_EVENT,
  CAPTURE_OPEN_NOTES_EVENT,
  CAPTURED_EVENT,
  type CaptureReply,
  type CaptureRequest,
  isCaptureRequest,
  QUICK_CAPTURE_WINDOW,
} from "./quick-capture";

export interface WantedShortcut {
  enabled: boolean;
  accelerator: string | null;
}

export function wantedShortcut(): WantedShortcut {
  const enabled = useSettingsStore.getState().notes && useQuickCaptureStore.getState().enabled;
  const binding = useShortcutStore.getState().bindings.notesQuickCapture;
  return { enabled, accelerator: enabled ? nativeAccelerator(binding) : null };
}

export async function captureReply(request: CaptureRequest): Promise<CaptureReply> {
  try {
    if (!useSettingsStore.getState().notes) throw new Error("Notes is turned off.");
    const { appCaptureDeps, saveCapture } = await import("./quick-capture-save");
    return { id: request.id, noteId: await saveCapture(request, await appCaptureDeps()) };
  } catch (error) {
    void logError("save a quick capture", error);
    return { id: request.id, error: describeError(error) };
  }
}

export async function startQuickCaptureBridge(): Promise<() => void> {
  let applied = "";
  let configuring = Promise.resolve();
  const sync = () => {
    const wanted = wantedShortcut();
    const key = `${wanted.enabled}:${wanted.accelerator ?? ""}`;
    if (key === applied) return;
    applied = key;
    configuring = configuring
      .then(() => quickCaptureConfigure(wanted.enabled, wanted.accelerator))
      .then(
        (status) => useQuickCaptureStore.getState().setStatus(status),
        (error: unknown) => {
          applied = "";
          useQuickCaptureStore.getState().setStatus(null);
          void logError("set up the quick capture shortcut", error);
        },
      );
  };
  let saving = Promise.resolve();
  const unlisten = await listen<unknown>(CAPTURE_EVENT, ({ payload }) => {
    if (!isCaptureRequest(payload)) return;
    saving = saving
      .then(() => captureReply(payload))
      .then((reply) => emitTo(QUICK_CAPTURE_WINDOW, CAPTURED_EVENT, reply))
      .catch((error: unknown) => logError("answer the quick capture window", error));
  });
  const stopOpening = await listen(CAPTURE_OPEN_NOTES_EVENT, () => {
    if (!useSettingsStore.getState().notes) return;
    void openNotes().catch((error: unknown) => logError("open Notes from quick capture", error));
  });
  const stops = [useSettingsStore.subscribe(sync), useQuickCaptureStore.subscribe(sync), useShortcutStore.subscribe(sync)];
  sync();
  return () => {
    unlisten();
    stopOpening();
    for (const stop of stops) stop();
  };
}
