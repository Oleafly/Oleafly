import type { FileEntry, ManifestHome } from "@oleafly/backend-port";

const MANAGED_ROOT_FILES = new Set(["project.json"]);
const MANAGED_DIRECTORIES = new Set([".git", ".oleafly"]);

export function isManagedProjectPath(path: string, home: ManifestHome): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) return false;
  const [head, ...rest] = normalized.split("/");
  const lower = head.toLowerCase();
  if (rest.length === 0) {
    return MANAGED_ROOT_FILES.has(lower) && (home === "library" || home === "folder");
  }
  return MANAGED_DIRECTORIES.has(lower);
}

const BINARY_PROJECT_FILE = /\.(pdf|png|jpe?g|gif|webp|svg|eps|zip|gz|ttf|otf|woff2?)$/i;

/** PDFs, images, fonts and archives open in a binary viewer tab, not as text. */
export function isBinaryProjectPath(path: string): boolean {
  return BINARY_PROJECT_FILE.test(path);
}

const readOnlyLinks = new WeakMap<readonly FileEntry[], ReadonlySet<string>>();

function readOnlyLinksIn(tree: readonly FileEntry[]): ReadonlySet<string> {
  let links = readOnlyLinks.get(tree);
  if (!links) {
    links = new Set(tree.filter((entry) => entry.read_only).map((entry) => entry.path));
    readOnlyLinks.set(tree, links);
  }
  return links;
}

export function isReadOnlyLink(path: string, tree: readonly FileEntry[]): boolean {
  return readOnlyLinksIn(tree).has(path);
}

export function isReadOnlyProjectPath(
  path: string,
  home: ManifestHome,
  tree: readonly FileEntry[],
): boolean {
  return isManagedProjectPath(path, home) || isReadOnlyLink(path, tree);
}
