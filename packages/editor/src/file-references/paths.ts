import type { ProjectFiles } from "./types";

export function normalizePath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

export function joinPath(base: string, relative: string): string | null {
  return normalizePath(base ? `${base}/${relative}` : relative);
}

export function directoryOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

export function withoutExtension(path: string): string {
  const extension = extensionOf(path);
  return extension ? path.slice(0, -extension.length) : path;
}

export function isWithin(path: string, root: string): boolean {
  return root === "" || path === root || path.startsWith(`${root}/`);
}

export function relativePath(fromDirectory: string, to: string): string {
  const from = fromDirectory ? fromDirectory.split("/") : [];
  const target = to ? to.split("/") : [];
  let common = 0;
  while (common < from.length && common < target.length && from[common] === target[common]) {
    common += 1;
  }
  const up = Array.from({ length: from.length - common }, () => "..");
  return [...up, ...target.slice(common)].join("/");
}

export function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
}

export function isAbsolutePath(path: string): boolean {
  return /^(?:[/\\~]|[A-Za-z]:[/\\])/.test(path);
}

export function isUrlLike(path: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path);
}

export class ProjectFileIndex {
  readonly mainDirectory: string;
  private readonly exact: Set<string>;
  private readonly folded = new Map<string, string>();
  private readonly directories = new Set<string>([""]);

  constructor(project: ProjectFiles) {
    this.mainDirectory = directoryOf(project.mainDoc);
    this.exact = new Set(project.files);
    for (const file of project.files) {
      const key = file.toLowerCase();
      if (!this.folded.has(key)) this.folded.set(key, file);
      this.addDirectory(directoryOf(file));
    }
    for (const directory of project.directories ?? []) this.addDirectory(directory);
  }

  private addDirectory(directory: string): void {
    let current = directory;
    while (current && !this.directories.has(current)) {
      this.directories.add(current);
      current = directoryOf(current);
    }
  }

  file(path: string): string | null {
    if (this.exact.has(path)) return path;
    return this.folded.get(path.toLowerCase()) ?? null;
  }

  directory(path: string): boolean {
    return this.directories.has(path);
  }
}
