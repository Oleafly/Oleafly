// @vitest-environment jsdom

import { act, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSidewaysScroll } from "./use-sideways-scroll";

const ACTIVE = { selector: "[data-on]", attribute: "data-on" };
let revealed: Element[] = [];

function Strip({ items, active }: Readonly<{ items: readonly string[]; active: string }>) {
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  useSidewaysScroll(strip, ACTIVE);
  return (
    <div ref={setStrip} data-testid="strip">
      {items.map((item) => (
        <span key={item} data-on={item === active ? "" : undefined}>
          {item}
        </span>
      ))}
    </div>
  );
}

function sized(strip: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(strip, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(strip, "clientWidth", { configurable: true, value: clientWidth });
}

function scrollTo(strip: HTMLElement, left: number) {
  strip.scrollLeft = left;
  fireEvent.scroll(strip);
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  revealed = [];
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value(this: Element) {
      revealed.push(this);
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

describe("useSidewaysScroll", () => {
  it("marks the edges items are hidden past, and clears them once everything fits", () => {
    const view = render(<Strip items={["a", "b", "c"]} active="a" />);
    const strip = view.getByTestId("strip");
    expect(strip).not.toHaveAttribute("data-overflow-start");
    expect(strip).not.toHaveAttribute("data-overflow-end");

    sized(strip, 600, 200);
    scrollTo(strip, 0);
    expect(strip).toHaveAttribute("data-overflow-end");
    expect(strip).not.toHaveAttribute("data-overflow-start");
    scrollTo(strip, 200);
    expect(strip).toHaveAttribute("data-overflow-start");
    expect(strip).toHaveAttribute("data-overflow-end");
    scrollTo(strip, 400);
    expect(strip).toHaveAttribute("data-overflow-start");
    expect(strip).not.toHaveAttribute("data-overflow-end");

    sized(strip, 200, 200);
    scrollTo(strip, 0);
    expect(strip).not.toHaveAttribute("data-overflow-start");
    expect(strip).not.toHaveAttribute("data-overflow-end");

    sized(strip, 600, 200);
    scrollTo(strip, 200);
    view.unmount();
    expect(strip).not.toHaveAttribute("data-overflow-start");
    expect(strip).not.toHaveAttribute("data-overflow-end");
  });

  it("brings the active item into view when it changes or arrives, and leaves the scroll alone otherwise", async () => {
    const view = render(<Strip items={["a", "b"]} active="a" />);
    expect(revealed.map((item) => item.textContent)).toEqual(["a"]);

    view.rerender(<Strip items={["a", "b"]} active="b" />);
    await settle();
    expect(revealed.at(-1)?.textContent).toBe("b");

    revealed = [];
    view.rerender(<Strip items={["a", "b", "c"]} active="b" />);
    await settle();
    expect(revealed).toEqual([]);

    view.rerender(<Strip items={["a", "b", "c", "d"]} active="d" />);
    await settle();
    expect(revealed.at(-1)?.textContent).toBe("d");
  });

  it("updates the edges when items come and go", async () => {
    const view = render(<Strip items={["a"]} active="a" />);
    const strip = view.getByTestId("strip");
    sized(strip, 600, 200);
    view.rerender(<Strip items={["a", "b"]} active="a" />);
    await settle();
    expect(strip).toHaveAttribute("data-overflow-end");
  });

  it("turns a vertical wheel into a sideways scroll only while the strip overflows", () => {
    const view = render(<Strip items={["a", "b"]} active="a" />);
    const strip = view.getByTestId("strip");
    sized(strip, 200, 200);
    expect(fireEvent.wheel(strip, { deltaY: 40 })).toBe(true);
    expect(strip.scrollLeft).toBe(0);

    sized(strip, 600, 200);
    expect(fireEvent.wheel(strip, { deltaY: 40 })).toBe(false);
    expect(strip.scrollLeft).toBe(40);
    expect(fireEvent.wheel(strip, { deltaX: 30, deltaY: 10 })).toBe(true);
  });
});
