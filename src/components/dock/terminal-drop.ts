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

/** Whether a drag could drop paths on the terminal. Reads only the types, as dragover allows. */
export function canDropOnTerminal(
  transfer: Pick<DataTransfer, "types"> | null | undefined,
  platform: TerminalPlatform,
): boolean {
  return carriesTreePath(transfer) || (platform === "linux" && types(transfer).includes(URI_LIST));
}

/** The paths a drop carries: a project path from the tree, or file paths on Linux. */
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

/** Local file paths in a text/uri-list, skipping comments and other schemes. */
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

/**
 * Dropped paths the terminal won't type. Quotes stop the shell's parser but
 * not the line editor or the tty, so a name holding ESC, Ctrl+U or CR could
 * edit the line and run a command before the user presses Enter.
 */
export function refusedDropPaths(drop: TerminalDrop): string[] {
  return drop.paths.filter(hasControlCharacters);
}

/** The project folder on this computer, and whether the shell is WSL. */
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
  // An absolute path stays right after a `cd`; without the project folder
  // the path is relative to the folder the terminal started in.
  const absolute = root ? absoluteTerminalPath(root.path, path, platform, root.wsl) : null;
  return terminalPathArg(kind, platform, absolute ?? relativeTerminalPath(startFolder, path));
}

/**
 * The text a drop types: each path quoted, separated by spaces, with a
 * trailing space. Tree paths are absolute when the project folder is known,
 * else relative to the terminal's start folder. Paths with control
 * characters are left out.
 */
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
