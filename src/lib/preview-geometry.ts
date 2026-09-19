import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface PreviewGeometry { x: number; y: number; width: number; height: number }
const key = (projectId: string) => `oleafly.preview.geometry.${projectId}`;

export function readPreviewGeometry(projectId: string): PreviewGeometry | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(projectId)) ?? "null");
    if (!value || ![value.x, value.y, value.width, value.height].every(Number.isFinite)) return null;
    if (value.width < 320 || value.height < 240 || value.width > 8192 || value.height > 8192 ||
      Math.abs(value.x) > 65536 || Math.abs(value.y) > 65536) return null;
    return { x: value.x, y: value.y, width: value.width, height: value.height };
  } catch { return null; }
}

export function usePreviewGeometry(projectId: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !projectId) return;
    let disposed = false;
    const win = getCurrentWindow();
    const save = async () => {
      try {
        const [position, size, scale] = await Promise.all([win.outerPosition(), win.innerSize(), win.scaleFactor()]);
        if (disposed) return;
        const geometry = { x: position.x / scale, y: position.y / scale, width: size.width / scale, height: size.height / scale };
        localStorage.setItem(key(projectId), JSON.stringify(geometry));
      } catch { /* Window teardown and unavailable storage require no action. */ }
    };
    const moved = win.onMoved(() => void save());
    const resized = win.onResized(() => void save());
    void save();
    return () => {
      disposed = true;
      void moved.then((off) => off());
      void resized.then((off) => off());
    };
  }, [projectId, enabled]);
}
