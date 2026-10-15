import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface PreviewGeometry { x: number; y: number; width: number; height: number }
const key = (projectId: string) => `oleafly.preview.geometry.${projectId}`;

export function readWindowGeometry(storageKey: string): PreviewGeometry | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (!value || ![value.x, value.y, value.width, value.height].every(Number.isFinite)) return null;
    if (value.width < 320 || value.height < 240 || value.width > 8192 || value.height > 8192 ||
      Math.abs(value.x) > 65536 || Math.abs(value.y) > 65536) return null;
    return { x: value.x, y: value.y, width: value.width, height: value.height };
  } catch { return null; }
}

interface ScreenArea {
  position: { x: number; y: number };
  size: { width: number; height: number };
  scaleFactor: number;
}

export function geometryOnScreen(geometry: PreviewGeometry, monitors: readonly ScreenArea[]): boolean {
  return monitors.some((monitor) => {
    const x = monitor.position.x / monitor.scaleFactor;
    const y = monitor.position.y / monitor.scaleFactor;
    return geometry.x + geometry.width > x + 80 && geometry.x < x + monitor.size.width / monitor.scaleFactor - 80 &&
      geometry.y >= y && geometry.y < y + monitor.size.height / monitor.scaleFactor - 80;
  });
}

export function readPreviewGeometry(projectId: string): PreviewGeometry | null {
  return readWindowGeometry(key(projectId));
}

export function useWindowGeometry(storageKey: string | null): void {
  useEffect(() => {
    if (!storageKey) return;
    let disposed = false;
    const win = getCurrentWindow();
    const save = async () => {
      try {
        const [position, size, scale] = await Promise.all([win.outerPosition(), win.innerSize(), win.scaleFactor()]);
        if (disposed) return;
        const geometry = { x: position.x / scale, y: position.y / scale, width: size.width / scale, height: size.height / scale };
        localStorage.setItem(storageKey, JSON.stringify(geometry));
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
  }, [storageKey]);
}

export function usePreviewGeometry(projectId: string, enabled: boolean): void {
  useWindowGeometry(enabled && projectId ? key(projectId) : null);
}
