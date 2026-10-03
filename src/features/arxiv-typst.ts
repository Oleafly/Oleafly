import type { AdHocArtifact } from "@/lib/tauri";
import { base64ToBytes } from "@/lib/base64";

const MAX_INPUT_DEPTH = 8;
const INPUT_COMMAND = /\\(input|include|subfile)(?:\s*\{([^{}]+)\}|\s+([^\s{}%\\]+))/g;
const TEX_SOURCE_EXTENSION = /\.(?:tex|ltx|sty|cls|bst|bbx|cbx|bbl|aux|log|out|toc|blg|fls|fdb_latexmk|synctex\.gz)$/i;
export const CONVERTED_MAIN_FILE = "main.typ";

export function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
}

export function normalizePath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

export function commentStart(line: string): number {
  for (let index = 0; index < line.length; index++) {
    if (line[index] === "\\") {
      index += 1;
    } else if (line[index] === "%") {
      return index;
    }
  }
  return line.length;
}

function resolveInput(
  name: string,
  baseDirectory: string,
  texts: ReadonlyMap<string, string>,
): string | undefined {
  const trimmed = name.trim();
  const candidates = /\.[A-Za-z0-9]+$/.test(trimmed) ? [trimmed] : [`${trimmed}.tex`, trimmed];
  for (const candidate of candidates) {
    for (const base of [baseDirectory, ""]) {
      const path = normalizePath(`${base}${candidate}`);
      if (path !== null && texts.has(path)) return texts.get(path);
    }
  }
  return undefined;
}

function expand(
  source: string,
  baseDirectory: string,
  texts: ReadonlyMap<string, string>,
  depth: number,
): string {
  if (depth >= MAX_INPUT_DEPTH) return source;
  return source
    .split("\n")
    .map((line) => {
      const cut = commentStart(line);
      const code = line.slice(0, cut).replace(INPUT_COMMAND, (whole, _command: string, braced?: string, bare?: string) => {
        const text = resolveInput(braced ?? bare ?? "", baseDirectory, texts);
        return text === undefined ? whole : expand(text, baseDirectory, texts, depth + 1);
      });
      return code + line.slice(cut);
    })
    .join("\n");
}

function decodeText(file: AdHocArtifact): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(base64ToBytes(file.dataBase64));
  } catch {
    return null;
  }
}

export function flattenLatexInputs(
  source: string,
  mainFile: string,
  files: readonly AdHocArtifact[],
): string {
  const texts = new Map<string, string>();
  for (const file of files) {
    if (!/\.(?:tex|ltx)$/i.test(file.path)) continue;
    const path = normalizePath(file.path);
    const text = path === null ? null : decodeText(file);
    if (path !== null && text !== null) texts.set(path, text);
  }
  return expand(source, directoryOf(normalizePath(mainFile) ?? mainFile), texts, 0);
}

export function typstSupportFiles(
  files: readonly AdHocArtifact[],
  mainFile: string,
): AdHocArtifact[] {
  const mainDirectory = directoryOf(normalizePath(mainFile) ?? mainFile);
  const seen = new Set<string>([CONVERTED_MAIN_FILE]);
  const support: AdHocArtifact[] = [];
  for (const file of files) {
    const normalized = normalizePath(file.path);
    if (!normalized || TEX_SOURCE_EXTENSION.test(normalized)) continue;
    const path = mainDirectory && normalized.startsWith(mainDirectory)
      ? normalized.slice(mainDirectory.length)
      : normalized;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    support.push({ path, dataBase64: file.dataBase64 });
  }
  return support;
}
