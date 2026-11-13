import { i18n } from "@/i18n";
import { decodeAppError } from "@/lib/app-error";
import { notifyError } from "@/lib/toast";
import { isWindows } from "@/lib/utils";
import { confirmAction } from "@/store/confirm-dialog";
import { useFilesStore } from "@/store/files";

export function projectDeleteQuestion(path: string, openedInPlace: boolean): string {
  if (!openedInPlace) return i18n.t(($) => $.workspace.files.confirmDelete, { path });
  return isWindows
    ? i18n.t(($) => $.workspace.files.confirmTrashWindows, { path })
    : i18n.t(($) => $.workspace.files.confirmTrash, { path });
}

export async function deleteAskingWithoutTrash(
  path: string,
  attempt: () => Promise<unknown>,
  deleteForGood: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await attempt();
    return true;
  } catch (error) {
    if (decodeAppError(error)?.code !== "project.trash_unavailable") throw error;
  }
  const confirmed = await confirmAction({
    message: isWindows
      ? i18n.t(($) => $.workspace.files.confirmPermanentDeleteWindows, { path })
      : i18n.t(($) => $.workspace.files.confirmPermanentDelete, { path }),
    confirmLabel: i18n.t(($) => $.common.actions.delete),
    destructive: true,
  });
  if (!confirmed) return false;
  await deleteForGood();
  return true;
}

export async function deleteProjectEntry(path: string): Promise<boolean> {
  const { deleteEntry } = useFilesStore.getState();
  try {
    return await deleteAskingWithoutTrash(
      path,
      () => deleteEntry(path),
      () => deleteEntry(path, { permanent: true }),
    );
  } catch (error) {
    notifyError(
      "delete file",
      error,
      decodeAppError(error) ? undefined : i18n.t(($) => $.workspace.files.deleteFailed, { path }),
    );
    return false;
  }
}
