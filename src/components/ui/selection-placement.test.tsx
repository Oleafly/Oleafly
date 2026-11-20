// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { placeAboveSelection, useMeasuredBox } from "./selection-placement";

describe("placeAboveSelection", () => {
  const editor = { top: 30, bottom: 600, left: 0, right: 800 };
  const line = (top: number, left = 40) => ({ top, bottom: top + 16, left });

  it("sits above the selection when there is room", () => {
    expect(placeAboveSelection(line(120), editor, { width: 90, height: 24 }, 12)).toEqual({ top: 84, left: 40 });
  });

  it("drops below the line instead of covering what sits above the area", () => {
    expect(placeAboveSelection(line(34), editor, { width: 90, height: 24 }, 12)).toEqual({ top: 62, left: 40 });
    expect(placeAboveSelection(line(60), editor, { width: 256, height: 240 }, 12)).toEqual({ top: 88, left: 40 });
  });

  it("stays inside the area at its right and bottom edges and in a tiny area", () => {
    expect(placeAboveSelection(line(120, 760), editor, { width: 90, height: 24 }, 12)).toEqual({ top: 84, left: 710 });
    expect(placeAboveSelection(line(580), editor, { width: 256, height: 600 }, 12)).toEqual({ top: 30, left: 40 });
    expect(placeAboveSelection(line(40), { top: 30, bottom: 70, left: 0, right: 60 }, { width: 90, height: 24 }, 12)).toEqual({
      top: 46,
      left: 0,
    });
  });

  it("keeps a window-wide bubble inside the window with the default gap", () => {
    const window = { top: 8, bottom: Number.POSITIVE_INFINITY, left: 8, right: 992 };
    const box = { width: 420, height: 40 };
    expect(placeAboveSelection(line(200, 48), window, box)).toEqual({ top: 152, left: 48 });
    expect(placeAboveSelection(line(40, 48), window, box)).toEqual({ top: 64, left: 48 });
    expect(placeAboveSelection(line(200, 700), window, box).left).toBe(572);
    expect(placeAboveSelection(line(200, 0), window, box).left).toBe(8);
  });
});

describe("useMeasuredBox", () => {
  function Measured({ width, onBox }: Readonly<{ width: number; onBox: (box: unknown) => void }>) {
    const [ref, box] = useMeasuredBox<HTMLDivElement>();
    onBox(box);
    return <div ref={ref} data-width={width} />;
  }

  it("reports the element's size after it renders and only changes when the size does", () => {
    const sizes: unknown[] = [];
    const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return Number(this.dataset.width ?? 0);
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 24 });
    try {
      const view = render(<Measured width={90} onBox={(box) => sizes.push(box)} />);
      expect(sizes[0]).toBeNull();
      expect(sizes.at(-1)).toEqual({ width: 90, height: 24 });
      const settled = sizes.at(-1);
      view.rerender(<Measured width={90} onBox={(box) => sizes.push(box)} />);
      expect(sizes.at(-1)).toBe(settled);
      view.rerender(<Measured width={256} onBox={(box) => sizes.push(box)} />);
      expect(sizes.at(-1)).toEqual({ width: 256, height: 24 });
    } finally {
      if (offsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidth);
      if (offsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
    }
  });
});
