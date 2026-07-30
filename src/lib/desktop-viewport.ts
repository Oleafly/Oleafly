/**
 * Oleafly's main window is a desktop shell. Editors, previews, sidebars, and
 * dialogs own their scrolling; the browser document itself never should.
 *
 * WebKit can still move the root scrolling element while focusing or removing
 * a deeply positioned control even when body overflow is hidden. Listen only
 * for root-scroll events and immediately restore the viewport. Inner panel
 * scrolls are deliberately ignored so this adds no work to editor/PDF scrolling.
 */
export function resetDesktopDocumentScroll(documentObject: Document = document): void {
  const targets = new Set<Element>([
    ...(documentObject.scrollingElement ? [documentObject.scrollingElement] : []),
    documentObject.documentElement,
    documentObject.body,
  ]);
  for (const target of targets) {
    if (target.scrollLeft !== 0) target.scrollLeft = 0;
    if (target.scrollTop !== 0) target.scrollTop = 0;
  }
}

export function installDesktopViewportGuard(
  documentObject: Document = document,
  windowObject: Window = window,
): () => void {
  const rootTargets = new Set<EventTarget>([
    windowObject,
    documentObject,
    ...(documentObject.scrollingElement ? [documentObject.scrollingElement] : []),
    documentObject.documentElement,
    documentObject.body,
  ]);
  const containRootScroll = (event: Event) => {
    if (rootTargets.has(event.target ?? documentObject)) {
      resetDesktopDocumentScroll(documentObject);
    }
  };

  documentObject.addEventListener("scroll", containRootScroll, true);
  windowObject.addEventListener("scroll", containRootScroll, true);
  resetDesktopDocumentScroll(documentObject);

  return () => {
    documentObject.removeEventListener("scroll", containRootScroll, true);
    windowObject.removeEventListener("scroll", containRootScroll, true);
  };
}
