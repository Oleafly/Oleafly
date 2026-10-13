import type { EditorView } from "@codemirror/view";
import { create } from "zustand";
import { logError } from "@/lib/log";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

export interface CommentRequest {
  path: string;
  from: number;
  to: number;
  quote: string;
}

export interface CommentReveal {
  path: string;
  threadId: string;
}

interface CommentsRailState {
  visible: boolean;
  unread: boolean;
  canCompose: boolean;
  request: CommentRequest | null;
  reveal: CommentReveal | null;
}

export const useCommentsRail = create<CommentsRailState>(() => ({
  visible: false,
  unread: false,
  canCompose: false,
  request: null,
  reveal: null,
}));

export function showCommentsTab(): void {
  const settings = useSettingsStore.getState();
  settings.setRailTab("comments");
  if (!settings.showTree) settings.setShowTree(true);
}

export function commentTarget(view: EditorView | null): CommentRequest | null {
  if (!view || !useSettingsStore.getState().liveCollaboration || !useCommentsRail.getState().canCompose) return null;
  const path = useFilesStore.getState().activePath;
  if (!path) return null;
  const selection = view.state.selection.main;
  const range = selection.empty ? view.state.wordAt(selection.head) : selection;
  if (!range || range.from === range.to) return null;
  const quote = view.state.sliceDoc(range.from, range.to);
  if (!quote.trim()) return null;
  return { path, from: range.from, to: range.to, quote };
}

export function requestComment(view: EditorView | null): boolean {
  const target = commentTarget(view);
  if (!target) return false;
  useCommentsRail.setState({ request: target });
  showCommentsTab();
  return true;
}

export function openCommentThread(path: string, threadId: string): void {
  useCommentsRail.setState({ reveal: { path, threadId } });
  const files = useFilesStore.getState();
  if (files.activePath !== path) {
    void files.openFile(path).catch((error: unknown) => logError("open commented file", error));
  }
  showCommentsTab();
}
