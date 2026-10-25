import { useRef, useState, type DragEvent } from "react";
import { logError } from "@/lib/log";
import { takeNativeDrop } from "@/lib/native-drop";
import { treeDragPath } from "@/lib/tree-drag";
import { isLinux } from "@/lib/utils";
import { composerDropKind, dropEffectFor, type ComposerDropKind } from "./composer-input";

/**
 * Drops on the composer: files from the computer, project paths from the file
 * tree, and Linux file drops through the native bridge. `dropKind` is set
 * while an accepted drag is over the composer.
 */
export function useComposerDrop({
  onAddFiles,
  onDropProjectPaths,
}: Readonly<{
  onAddFiles?(files: File[]): void;
  onDropProjectPaths?(paths: string[]): void;
}>) {
  const [dropKind, setDropKind] = useState<ComposerDropKind | null>(null);
  const dragDepth = useRef(0);
  const acceptedDrop = (transfer: DataTransfer | null): ComposerDropKind | null => {
    const kind = composerDropKind(transfer, isLinux);
    if (kind === "tree") return onDropProjectPaths ? kind : null;
    if (kind) return onAddFiles ? kind : null;
    return null;
  };
  const showDropEffect = (event: DragEvent<HTMLDivElement>, kind: ComposerDropKind) => {
    event.dataTransfer.dropEffect =
      kind === "tree" ? dropEffectFor(event.dataTransfer.effectAllowed) : "copy";
  };
  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    const kind = acceptedDrop(event.dataTransfer);
    if (!kind) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDropKind(kind);
    showDropEffect(event, kind);
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    const kind = acceptedDrop(event.dataTransfer);
    if (!kind) return;
    event.preventDefault();
    showDropEffect(event, kind);
  };
  const onDragLeave = () => {
    if (dragDepth.current === 0) return;
    dragDepth.current -= 1;
    if (dragDepth.current === 0) setDropKind(null);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const kind = acceptedDrop(event.dataTransfer);
    dragDepth.current = 0;
    setDropKind(null);
    if (!kind) return;
    event.preventDefault();
    if (kind === "tree") {
      const path = treeDragPath(event.dataTransfer);
      if (path) onDropProjectPaths?.([path]);
      return;
    }
    if (kind === "files") {
      const files = Array.from(event.dataTransfer.files);
      if (files.length > 0) onAddFiles?.(files);
      return;
    }
    void takeNativeDrop()
      .then(async (items) => (await import("@/lib/attachments-intake")).readDroppedFiles(items))
      .then((files) => {
        if (files.length > 0) onAddFiles?.(files);
      })
      .catch((error: unknown) => void logError("read dropped files", error));
  };
  return { dropKind, onDragEnter, onDragOver, onDragLeave, onDrop };
}
