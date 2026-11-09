// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DRAG_THRESHOLD_PX, placeAmong, slotAlong, swallowNextClick, trackReorderDrag } from "./reorder-drag";
import * as sectionReorder from "./section-reorder";

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("placeAmong", () => {
  const order = ["a", "hidden", "b", "c", "late"];
  const visible = ["a", "b", "c"];

  it("places an item before the visible item at the slot and keeps hidden items in place", () => {
    expect(placeAmong(order, visible, "c", 0)).toEqual(["c", "a", "hidden", "b", "late"]);
    expect(placeAmong(order, visible, "a", 1)).toEqual(["hidden", "b", "a", "c", "late"]);
    expect(placeAmong(order, visible, "c", -3)).toEqual(["c", "a", "hidden", "b", "late"]);
  });

  it("places an item right after the last visible one when it moves to the end", () => {
    expect(placeAmong(order, visible, "a", 2)).toEqual(["hidden", "b", "c", "a", "late"]);
    expect(placeAmong(order, visible, "a", 9)).toEqual(["hidden", "b", "c", "a", "late"]);
  });

  it("ignores unknown ids among the visible ones and leaves an unknown item alone", () => {
    expect(placeAmong(order, ["ghost", "a", "b", "c"], "c", 0)).toEqual(["c", "a", "hidden", "b", "late"]);
    expect(placeAmong(order, visible, "ghost", 0)).toEqual(order);
    expect(placeAmong(order, ["a"], "a", 0)).toEqual(order);
  });
});

describe("slotAlong", () => {
  const rects = [rect(0, 0, 20, 20), rect(30, 30, 20, 20)];

  it("counts the items whose middle is before the pointer on either axis", () => {
    expect(slotAlong(rects, 5, "x")).toBe(0);
    expect(slotAlong(rects, 15, "x")).toBe(1);
    expect(slotAlong(rects, 45, "x")).toBe(2);
    expect(slotAlong(rects, 15, "y")).toBe(1);
    expect(slotAlong(rects, 39, "y")).toBe(1);
    expect(slotAlong(rects, 41, "y")).toBe(2);
  });
});

describe("trackReorderDrag", () => {
  function gesture(axis: "x" | "y" = "x") {
    return { axis, locate: vi.fn((position: number) => position), show: vi.fn(), land: vi.fn() };
  }

  it("keeps the old section exports pointing at the shared helper", () => {
    expect(sectionReorder.DRAG_THRESHOLD_PX).toBe(DRAG_THRESHOLD_PX);
    expect(sectionReorder.swallowNextClick).toBe(swallowNextClick);
  });

  it("waits for the threshold on its own axis, then lands and swallows the click", () => {
    const drag = gesture("x");
    trackReorderDrag({ clientX: 100, clientY: 100 }, drag);
    fireEvent.pointerMove(window, { clientX: 100 + DRAG_THRESHOLD_PX - 1, clientY: 300 });
    expect(drag.locate).not.toHaveBeenCalled();
    fireEvent.pointerMove(window, { clientX: 140, clientY: 100 });
    expect(drag.show).toHaveBeenLastCalledWith(140);
    fireEvent.pointerMove(window, { clientX: 101, clientY: 100 });
    expect(drag.show).toHaveBeenLastCalledWith(101);
    fireEvent.pointerUp(window);
    expect(drag.land).toHaveBeenCalledWith(101);
    expect(drag.show).toHaveBeenLastCalledWith(null);
    const onClick = vi.fn();
    document.body.addEventListener("click", onClick);
    fireEvent.click(document.body);
    expect(onClick).not.toHaveBeenCalled();
    document.body.removeEventListener("click", onClick);
  });

  it("lets the click through after a press that never moved", async () => {
    const drag = gesture("y");
    trackReorderDrag({ clientX: 0, clientY: 0 }, drag);
    fireEvent.pointerMove(window, { clientX: 50, clientY: 2 });
    fireEvent.pointerUp(window);
    expect(drag.land).not.toHaveBeenCalled();
    const onClick = vi.fn();
    document.body.addEventListener("click", onClick);
    fireEvent.click(document.body);
    expect(onClick).toHaveBeenCalledOnce();
    document.body.removeEventListener("click", onClick);
  });

  it("cancels on Escape only once dragging, and stopping twice is harmless", () => {
    const drag = gesture("x");
    const stop = trackReorderDrag({ clientX: 0, clientY: 0 }, drag);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 0 });
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(drag.show).toHaveBeenLastCalledWith(null);
    fireEvent.pointerUp(window);
    stop();
    expect(drag.land).not.toHaveBeenCalled();
    expect(drag.show).toHaveBeenCalledTimes(2);
  });

  it("cancels on blur and on pointer cancel", () => {
    for (const end of [() => fireEvent.blur(window), () => fireEvent.pointerCancel(window)]) {
      const drag = gesture("x");
      trackReorderDrag({ clientX: 0, clientY: 0 }, drag);
      end();
      fireEvent.pointerMove(window, { clientX: 40, clientY: 0 });
      fireEvent.pointerUp(window);
      expect(drag.locate).not.toHaveBeenCalled();
      expect(drag.land).not.toHaveBeenCalled();
    }
  });
});
