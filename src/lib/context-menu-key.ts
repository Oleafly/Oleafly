interface MenuKeyEvent {
  key: string;
  shiftKey: boolean;
  preventDefault(): void;
}

export function openContextMenuFromKey(event: MenuKeyEvent, target: HTMLElement | null): void {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
  event.preventDefault();
  if (!target) return;
  const rect = target.getBoundingClientRect();
  target.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.bottom),
    }),
  );
}
