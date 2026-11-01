export interface TerminalFocusTracker {
  focusWasInDock(): boolean;
  restore(): void;
  dispose(): void;
}

export function createTerminalFocusTracker(
  dockRoot: () => HTMLElement | null,
  doc: Document = document,
): TerminalFocusTracker {
  let outside: HTMLElement | null = null;
  let inDock = false;
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target === doc.body) return;
    if (dockRoot()?.contains(target)) {
      inDock = true;
      return;
    }
    inDock = false;
    outside = target;
  };
  doc.addEventListener("focusin", onFocusIn, true);

  return {
    focusWasInDock: () => inDock || Boolean(dockRoot()?.contains(doc.activeElement)),
    restore: () => {
      inDock = false;
      const root = dockRoot();
      const target = outside;
      if (target?.isConnected && !root?.contains(target)) {
        target.focus({ preventScroll: true });
        if (doc.activeElement === target) return;
      }
      const active = doc.activeElement;
      if (active instanceof HTMLElement && root?.contains(active)) active.blur();
    },
    dispose: () => {
      doc.removeEventListener("focusin", onFocusIn, true);
      outside = null;
    },
  };
}
