import {
  currentInteractiveLanguageService,
  type InteractiveLanguageServiceDocument,
  type InteractiveLanguageServiceSession,
} from "@/lib/analysis/interactive-language-service";
import { useFilesStore } from "@/store/files";

export interface CurrentInteractiveDocument {
  session: InteractiveLanguageServiceSession;
  document: InteractiveLanguageServiceDocument;
}

export function currentInteractiveDocument(
  path: string,
  text: string,
): CurrentInteractiveDocument | null {
  const files = useFilesStore.getState();
  const session = currentInteractiveLanguageService();
  if (
    !session ||
    !files.projectId ||
    files.projectId !== session.projectId ||
    files.activePath !== path ||
    files.files[path]?.content !== text
  ) {
    return null;
  }
  const document = session.documentForPath(path);
  if (!document) return null;
  if (document.text !== text) return null;
  return { session, document };
}

export function interactiveRequestStillCurrent(
  session: InteractiveLanguageServiceSession,
  document: InteractiveLanguageServiceDocument,
  text: string,
): boolean {
  const current = currentInteractiveDocument(document.path, text);
  if (!current) return false;
  return (
    current.session.owner === session.owner &&
    current.session.projectRevision === session.projectRevision &&
    current.session.client.generation === session.client.generation &&
    current.document.uri === document.uri &&
    current.document.version === document.version
  );
}

export function activeInteractiveDocument(
  text: string,
): CurrentInteractiveDocument | null {
  const path = useFilesStore.getState().activePath;
  return path ? currentInteractiveDocument(path, text) : null;
}
