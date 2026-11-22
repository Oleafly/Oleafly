import { i18n } from "@/i18n";
import { isMac, isWindows } from "@/lib/utils";

export function showInFileManagerLabel(): string {
  if (isMac) return i18n.t(($) => $.common.actions.showInFinder);
  if (isWindows) return i18n.t(($) => $.common.actions.showInExplorer);
  return i18n.t(($) => $.common.actions.showInFileManager);
}
