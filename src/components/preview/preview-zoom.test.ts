import { describe, expect, it, vi } from "vitest";
import { attachPreviewZoom } from "./preview-zoom";

describe("attachPreviewZoom", () => {
  it("attaches after the preview element becomes available", () => {
    const element = new EventTarget() as HTMLElement;
    let scale = 1;
    const writeScale = vi.fn((updater: (value: number) => number) => {
      scale = updater(scale);
    });
    const detach = attachPreviewZoom(element, () => scale, writeScale);
    const event = new Event("wheel", { cancelable: true }) as WheelEvent;
    Object.defineProperties(event, {
      ctrlKey: { value: true },
      deltaY: { value: -10 },
    });
    element.dispatchEvent(event);
    expect(writeScale).toHaveBeenCalledOnce();
    expect(scale).toBeGreaterThan(1);
    expect(event.defaultPrevented).toBe(true);
    detach();
    element.dispatchEvent(event);
    expect(writeScale).toHaveBeenCalledOnce();
  });

  function gesture(type: string, scale?: number) {
    const event = new Event(type, { cancelable: true });
    if (scale !== undefined) Object.defineProperty(event, "scale", { value: scale });
    return event;
  }

  it("ignores plain wheel scrolling", () => {
    const element = new EventTarget() as HTMLElement;
    const writeScale = vi.fn();
    attachPreviewZoom(element, () => 1, writeScale);
    const event = new Event("wheel", { cancelable: true }) as WheelEvent;
    Object.defineProperties(event, { ctrlKey: { value: false }, deltaY: { value: 30 } });

    element.dispatchEvent(event);

    expect(writeScale).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("scales from the zoom at the start of a trackpad pinch and keeps it in range", () => {
    const element = new EventTarget() as HTMLElement;
    let scale = 1.5;
    const writeScale = vi.fn((updater: (value: number) => number) => {
      scale = updater(scale);
    });
    const detach = attachPreviewZoom(element, () => scale, writeScale);

    const start = gesture("gesturestart");
    element.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(true);
    element.dispatchEvent(gesture("gesturechange", 2));
    expect(scale).toBe(3);
    element.dispatchEvent(gesture("gesturechange", 10));
    expect(scale).toBe(4);
    element.dispatchEvent(gesture("gesturechange", 0.01));
    expect(scale).toBe(0.25);

    const writes = writeScale.mock.calls.length;
    element.dispatchEvent(gesture("gesturechange"));
    element.dispatchEvent(gesture("gesturechange", 0));
    expect(writeScale).toHaveBeenCalledTimes(writes);

    detach();
    element.dispatchEvent(gesture("gesturechange", 2));
    expect(writeScale).toHaveBeenCalledTimes(writes);
  });
});
