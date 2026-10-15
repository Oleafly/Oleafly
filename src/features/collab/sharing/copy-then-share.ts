import { useShareDialog } from "@/components/collab/share-dialog";
import { copyIntoLibrary } from "@/store/copy-into-library";

export async function copyThenShare(projectId: string, name: string): Promise<void> {
  useShareDialog.getState().close();
  const copy = await copyIntoLibrary(projectId, name, { openAfterCopy: true });
  if (copy) useShareDialog.getState().openFor(copy, true);
}
