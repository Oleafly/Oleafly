const MANAGED_ROOT_FILES = new Set(["project.json"]);
const MANAGED_DIRECTORIES = new Set([".git", ".oleafly"]);

export function isManagedProjectPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) return false;
  const [head, ...rest] = normalized.split("/");
  const lower = head.toLowerCase();
  if (rest.length === 0) return MANAGED_ROOT_FILES.has(lower);
  return MANAGED_DIRECTORIES.has(lower);
}
