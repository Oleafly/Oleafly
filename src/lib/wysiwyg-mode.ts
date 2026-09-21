function key(projectId: string): string {
  return `oleafly.wysiwyg.${projectId}`;
}

export function getWysiwygMode(projectId: string): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(key(projectId)) === "1";
}

export function setWysiwygMode(projectId: string, on: boolean): void {
  if (typeof localStorage === "undefined") return;
  if (on) localStorage.setItem(key(projectId), "1");
  else localStorage.removeItem(key(projectId));
}

export function getMarkdownSplitMode(projectId: string): boolean {
  return typeof localStorage !== "undefined" && localStorage.getItem(`oleafly.markdown-split.${projectId}`) === "1";
}

export function setMarkdownSplitMode(projectId: string, on: boolean): void {
  if (typeof localStorage === "undefined") return;
  if (on) localStorage.setItem(`oleafly.markdown-split.${projectId}`, "1");
  else localStorage.removeItem(`oleafly.markdown-split.${projectId}`);
}

export type MarkdownSplitLayout = "stacked" | "split";

export function getMarkdownSplitLayout(projectId: string): MarkdownSplitLayout {
  try {
    return localStorage.getItem(`oleafly.markdown-split-layout.${projectId}`) === "stacked" ? "stacked" : "split";
  } catch { return "split"; }
}

export function setMarkdownSplitLayout(projectId: string, layout: MarkdownSplitLayout): void {
  try {
    localStorage.setItem(`oleafly.markdown-split-layout.${projectId}`, layout);
  } catch { /* Keep the layout usable when storage is unavailable. */ }
}

export function getMarkdownSplitSize(projectId: string | null): number {
  try {
    const size = Number(localStorage.getItem(`oleafly.markdown-split-size.${projectId}`));
    return Number.isFinite(size) && size >= 20 && size <= 80 ? size : 50;
  } catch { return 50; }
}

export function setMarkdownSplitSize(projectId: string, size: number): void {
  if (!Number.isFinite(size) || size < 20 || size > 80) return;
  try {
    localStorage.setItem(`oleafly.markdown-split-size.${projectId}`, String(size));
  } catch { /* Keep resizing usable when storage is unavailable. */ }
}
