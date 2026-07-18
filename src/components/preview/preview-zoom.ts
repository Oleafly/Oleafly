export const MIN_PREVIEW_SCALE = 0.25;
export const MAX_PREVIEW_SCALE = 4;

export function attachPreviewZoom(
  element: HTMLElement,
  readScale: () => number,
  writeScale: (updater: (scale: number) => number) => void,
) {
  const clamp = (value: number) =>
    Math.min(MAX_PREVIEW_SCALE, Math.max(MIN_PREVIEW_SCALE, value));
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
