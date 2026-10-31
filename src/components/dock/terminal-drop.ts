// Dropping files on the terminal types their paths, quoted for the shell.
// File-tree drags work everywhere. OS file drops only carry paths on Linux
// (WebKitGTK's text/uri-list); WebView2 and WKWebView hand over File objects
// without paths while the native drop handler stays off for the file tree.
import type { TerminalPlatform } from "@/lib/terminal-keys";
import {
  absoluteTerminalPath,
  hasControlCharacters,
  quoteShellArg,
  relativeTerminalPath,
  terminalPathArg,
  type TerminalShellKind,
} from "@/lib/terminal-quote";
import { carriesTreePath, treeDragPath } from "@/lib/tree-drag";

export type TerminalDrop = { kind: "tree"; paths: string[] } | { kind: "absolute"; paths: string[] };

const URI_LIST = "text/uri-list";

function types(transfer: Pick<DataTransfer, "types"> | null | undefined): string[] {
  return Array.from(transfer?.types ?? []);
}

export function canDropOnTerminal(
  transfer: Pick<DataTransfer, "types"> | null | undefined,
  platform: TerminalPlatform,
): boolean {
  return carriesTreePath(transfer) || (platform === "linux" && types(transfer).includes(URI_LIST));
}

export function readTerminalDrop(
  transfer: Pick<DataTransfer, "types" | "getData"> | null | undefined,
  platform: TerminalPlatform,
): TerminalDrop | null {
  if (!transfer) return null;
  const tree = treeDragPath(transfer);
  if (tree) return { kind: "tree", paths: [tree] };
  if (platform !== "linux" || !types(transfer).includes(URI_LIST)) return null;
  const paths = parseUriList(transfer.getData(URI_LIST));
  return paths.length > 0 ? { kind: "absolute", paths } : null;
}

export function parseUriList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .flatMap((line) => {
      let url: URL;
      try {
        url = new URL(line);
      } catch {
        return [];
      }
      if (url.protocol !== "file:" || (url.hostname !== "" && url.hostname !== "localhost")) return [];
      try {
        return [decodeURIComponent(url.pathname)];
      } catch {
        return [];
      }
    });
}

export function refusedDropPaths(drop: TerminalDrop): string[] {
  return drop.paths.filter(hasControlCharacters);
}

export interface TerminalDropRoot {
  path: string;
  wsl: boolean;
}

function treeWord(
  path: string,
  kind: TerminalShellKind,
  platform: TerminalPlatform,
  startFolder: string,
  root: TerminalDropRoot | undefined,
): string {
  const absolute = root ? absoluteTerminalPath(root.path, path, platform, root.wsl) : null;
  return terminalPathArg(kind, platform, absolute ?? relativeTerminalPath(startFolder, path));
}

export function terminalDropText(
  drop: TerminalDrop,
  kind: TerminalShellKind,
  platform: TerminalPlatform,
  startFolder: string,
  root?: TerminalDropRoot,
): string {
  const safe = drop.paths.filter((path) => !hasControlCharacters(path));
  const words = safe.map((path) =>
    drop.kind === "tree" ? treeWord(path, kind, platform, startFolder, root) : quoteShellArg(kind, path),
  );
  return words.length > 0 ? `${words.join(" ")} ` : "";
}
