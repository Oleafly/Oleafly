// When the terminal dock hides, keys must not keep going to a shell nobody
// can see. This remembers where focus was outside the dock and moves it back
// there (or just blurs the terminal) when the dock hides.

export interface TerminalFocusTracker {
  /** Focus moved into the dock and has not moved out to the page since. */
  focusWasInDock(): boolean;
  /** Focus the element focused before the dock, or blur whatever the dock holds. */
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
