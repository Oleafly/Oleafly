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

export async function deleteProjectEntry(path: string): Promise<boolean> {
  const { deleteEntry } = useFilesStore.getState();
  const failed = (error: unknown) => {
    notifyError(
      "delete file",
      error,
      decodeAppError(error) ? undefined : i18n.t(($) => $.workspace.files.deleteFailed, { path }),
    );
    return false;
  };
  try {
    await deleteEntry(path);
    return true;
  } catch (error) {
    if (decodeAppError(error)?.code !== "project.trash_unavailable") return failed(error);
  }
  const confirmed = await confirmAction({
    message: isWindows
      ? i18n.t(($) => $.workspace.files.confirmPermanentDeleteWindows, { path })
      : i18n.t(($) => $.workspace.files.confirmPermanentDelete, { path }),
    confirmLabel: i18n.t(($) => $.common.actions.delete),
    destructive: true,
  });
  if (!confirmed) return false;
  try {
    await deleteEntry(path, { permanent: true });
    return true;
  } catch (error) {
    return failed(error);
  }
}
