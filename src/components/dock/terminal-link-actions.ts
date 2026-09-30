import type { FileEntry } from "@oleafly/backend-port";
import { open } from "@tauri-apps/plugin-shell";
import { i18n } from "@/i18n";
import { logError } from "@/lib/log";
import { openProjectLocation } from "@/lib/open-location";
import { terminalPathResolver } from "@/lib/terminal-links";
import { notifyError } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import type { TerminalLinkActions } from "./terminal-link-provider";

type Resolver = (path: string) => string | null;

// One resolver per tree listing: hovering stays cheap, and a refreshed tree
// is a new array, so new files link as soon as the tree has them.
const resolvers = new WeakMap<readonly FileEntry[], Resolver>();

function resolverFor(tree: readonly FileEntry[]): Resolver {
  let resolve = resolvers.get(tree);
  if (!resolve) {
    const files = tree.filter((entry) => !entry.is_dir && !entry.unreadable).map((entry) => entry.path);
    resolve = terminalPathResolver(files);
    resolvers.set(tree, resolve);
  }
  return resolve;
}

/**
 * The app side of terminal links. Paths resolve against the file tree only
 * while the pane's project is the open one, files open in the editor, and web
 * links open in the system browser.
 */
export function createTerminalLinkActions(
  projectId: string,
  tooltip: Pick<TerminalLinkActions, "hover" | "leave">,
): TerminalLinkActions {
  return {
    resolve(path) {
      const files = useFilesStore.getState();
      return files.projectId === projectId ? resolverFor(files.tree)(path) : null;
    },
    openFile(target) {
      if (useFilesStore.getState().projectId !== projectId) return;
      void openProjectLocation(target).catch((error: unknown) => logError("open terminal link", error));
    },
    openUrl(url) {
      void open(url).catch((error: unknown) =>
        notifyError("open terminal link", error, i18n.t(($) => $.workspace.terminal.links.openUrlFailed)),
      );
    },
    hover: tooltip.hover,
    leave: tooltip.leave,
  };
}
