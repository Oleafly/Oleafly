import { normalizeServerAddress } from "../AddServerDialog";

export interface CommentTarget {
  fileId: string;
  threadId: string;
}

export type AppLink =
  | { kind: "addServer"; url: string }
  | { kind: "openProject"; server: string; project: string; link: string; comment?: CommentTarget }
  | { kind: "malformed"; link: string };

const PROJECT_ID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

function serverKey(address: string): string | null {
  const candidate = normalizeServerAddress(address);
  if (candidate === "") return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.hostname === "") return null;
  return `${url.protocol}//${url.host}${withoutTrailingSlashes(url.pathname)}`;
}

export function sameServer(left: string, right: string): boolean {
  const key = serverKey(left);
  return key !== null && key === serverKey(right);
}

function parameter(url: URL, name: string): string {
  return url.searchParams.get(name)?.trim() ?? "";
}

function commentIn(url: URL): CommentTarget | null {
  const fileId = parameter(url, "file");
  const threadId = parameter(url, "thread");
  if (!PROJECT_ID.test(fileId) || !PROJECT_ID.test(threadId)) return null;
  return { fileId: fileId.toLowerCase(), threadId: threadId.toLowerCase() };
}

export function parseAppLink(raw: string): AppLink {
  const link = raw.trim();
  const malformed: AppLink = { kind: "malformed", link };
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return malformed;
  }
  if (url.protocol !== "oleafly:") return malformed;
  const place = `${url.host}${withoutTrailingSlashes(url.pathname)}`.toLowerCase();
  if (place === "server/add") {
    const target = parameter(url, "url");
    return serverKey(target) === null ? malformed : { kind: "addServer", url: target };
  }
  if (place === "open") {
    const server = parameter(url, "server");
    const project = parameter(url, "project");
    if (serverKey(server) === null || !PROJECT_ID.test(project)) return malformed;
    const comment = commentIn(url);
    const opened: AppLink = { kind: "openProject", server, project: project.toLowerCase(), link };
    return comment ? { ...opened, comment } : opened;
  }
  return malformed;
}

export function linkKey(link: AppLink): string {
  switch (link.kind) {
    case "addServer":
      return `add ${serverKey(link.url)}`;
    case "openProject":
      return link.comment
        ? `open ${serverKey(link.server)} ${link.project} ${link.comment.fileId} ${link.comment.threadId}`
        : `open ${serverKey(link.server)} ${link.project}`;
    case "malformed":
      return `other ${link.link}`;
  }
}
