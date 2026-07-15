export function attachPreviewZoom(
  element: HTMLElement,
  readScale: () => number,
  writeScale: (updater: (scale: number) => number) => void,
) {
  const clamp = (value: number) => Math.min(4, Math.max(0.4, value));
  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    writeScale((scale) => clamp(scale * Math.exp(-event.deltaY * 0.01)));
  };
  let startScale = 1;
  const onGestureStart = (event: Event) => {
    event.preventDefault();
    startScale = readScale();
  };
  const onGestureChange = (event: Event) => {
    event.preventDefault();
    const gestureScale = (event as Event & { scale?: number }).scale;
    if (typeof gestureScale === "number" && gestureScale > 0) {
      writeScale(() => clamp(startScale * gestureScale));
    }
  };
  element.addEventListener("wheel", onWheel, { passive: false });
  element.addEventListener("gesturestart", onGestureStart, { passive: false });
  element.addEventListener("gesturechange", onGestureChange, { passive: false });
  return () => {
    element.removeEventListener("wheel", onWheel);
    element.removeEventListener("gesturestart", onGestureStart);
    element.removeEventListener("gesturechange", onGestureChange);
  };
}
