import { withoutVerbatimPrefix } from "@/lib/path-utils";

/**
 * Converts between project paths and the `file:` URIs language servers read.
 *
 * The workspace root comes from `canonicalize` in Rust, so on Windows it is
 * verbatim: `\\?\D:\paper`, or `\\?\UNC\server\share\paper` for a network share
 * or a mapped drive. A URI has no spelling for that prefix, and Tinymist aborts
 * on one it cannot turn back into a path, so the prefix goes before anything
 * else happens.
 *
 * URIs are written the way `Url::from_file_path` writes them. Tinymist answers
 * with that spelling whatever it was sent, and the client finds open documents
 * by comparing URIs as strings.
 */

// `encodeURIComponent` escapes these and the `url` crate does not.
const LEFT_PLAIN_BY_THE_URL_CRATE = /%(?:24|26|2B|2C|3A|3B|3D|40|5B|5D|5E|7C)/g;

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(LEFT_PLAIN_BY_THE_URL_CRATE, (encoded) =>
    decodeURIComponent(encoded),
  );
}

function encodePath(segments: readonly string[]): string {
  return segments.map(encodePathSegment).join("/");
}

export function fileUriForProjectPath(workspaceRoot: string, path = ""): string {
  const root = withoutVerbatimPrefix(workspaceRoot)
    .replaceAll("\\", "/")
    .replace(/(?<!\/)\/+$/, "");
  const relative = path.replaceAll("\\", "/").replace(/^\/+/, "");
  const absolute = relative ? `${root}/${relative}` : root;
  if (absolute.startsWith("//")) {
    const [host, ...segments] = absolute.slice(2).split("/");
    return `file://${encodePathSegment(host.toLowerCase())}/${encodePath(segments)}`;
  }
  const rooted = absolute.startsWith("/") ? absolute : `/${absolute}`;
  const encoded = encodePath(rooted.split("/"));
  return /^\/[A-Za-z]:$/.test(rooted) ? `file://${encoded}/` : `file://${encoded}`;
}

function pathForFileUri(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  const rest = uri.slice("file://".length);
  const pathStart = rest.indexOf("/");
  const host = pathStart < 0 ? rest : rest.slice(0, pathStart);
  try {
    const path = decodeURIComponent(pathStart < 0 ? "" : rest.slice(pathStart));
    if (host && host.toLowerCase() !== "localhost") return `//${host}${path}`;
    return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
  } catch {
    return null;
  }
}

function trimTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end -= 1;
  return path.slice(0, end);
}

// The `url` crate lower-cases hosts, and Windows ignores the case of both a
// drive letter and a server name.
function comparablePath(path: string): string {
  return trimTrailingSlashes(withoutVerbatimPrefix(path).replaceAll("\\", "/")).replace(
    /^(?:[A-Za-z]:(?=\/|$)|\/\/[^/]+)/,
    (head) => head.toLowerCase(),
  );
}

export function projectPathForUri(workspaceRoot: string, uri: string): string | null {
  const absolute = pathForFileUri(uri);
  if (absolute === null) return null;
  const root = comparablePath(workspaceRoot);
  const path = comparablePath(absolute);
  if (!path.startsWith(`${root}/`)) return null;
  const relative = path.slice(root.length + 1);
  if (!relative || relative.split("/").includes("..")) {
    return null;
  }
  return relative;
}
