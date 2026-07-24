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
