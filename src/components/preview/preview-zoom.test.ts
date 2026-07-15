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
});
