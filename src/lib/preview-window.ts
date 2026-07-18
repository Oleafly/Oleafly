import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauri } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

const PREVIEW_WINDOW_LABEL = "preview";

// Renders `?view=preview` in its own JS context (see main.tsx) and stays in
// sync via the `preview:refresh` / `preview:project` events the main window
// emits (on compile and on project switch).
export async function openPreviewWindow(projectId: string, title: string): Promise<void> {
  if (!isTauri()) return;
  const existing = await WebviewWindow.getByLabel(PREVIEW_WINDOW_LABEL);
  if (existing) {
    await emit("preview:project", { projectId });
    await existing.setFocus();
    return;
  }
  new WebviewWindow(PREVIEW_WINDOW_LABEL, {
    url: `index.html?view=preview&project=${encodeURIComponent(projectId)}`,
    title: `Preview: ${title || "Oleafly"}`,
    width: 720,
    height: 960,
    resizable: true,
    center: true,
    focus: true,
  });
}

export function refreshPreviewWindow(): void {
  if (!isTauri()) return;
  void emit("preview:refresh").catch(() => {});
}

export function retargetPreviewWindow(projectId: string): void {
  if (!isTauri()) return;
  void emit("preview:project", { projectId }).catch(() => {});
}
