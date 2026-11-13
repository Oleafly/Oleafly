// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isReorderItem, useStripReorder } from "./strip-reorder";

function box(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function place(container: HTMLElement) {
  let position = 0;
  for (const item of container.querySelectorAll<HTMLElement>("[data-reorder-item]")) {
    const main = item.tagName === "DIV";
    const left = main ? position * 40 : 160;
    if (main) position += 1;
    item.getBoundingClientRect = () => box(left, 4, 28, 28);
  }
  const strip = container.querySelector<HTMLElement>("[data-reorder-strip]");
  if (strip) strip.getBoundingClientRect = () => box(0, 0, 200, 36);
}

function Strip({
  initial = ["a", "b", "c"],
  shown,
  onReorder,
  onClick,
  bare = false,
}: Readonly<{
  initial?: string[];
  shown?: string[];
  onReorder: (ids: string[]) => void;
  onClick?: (id: string) => void;
  bare?: boolean;
}>) {
  const [order, setOrder] = useState(initial);
  const reorder = useStripReorder(order, (next) => {
    onReorder(next);
    setOrder(next);
  });
  const visible = order.filter((id) => !shown || shown.includes(id));
  return (
    <div {...(bare ? {} : reorder.strip)} data-testid="strip" data-dragging={reorder.dragging ?? ""}>
      {visible.map((id) => (
        <div key={id} role="presentation" {...reorder.item(id)}>
          <button type="button" onClick={() => onClick?.(id)}>
            {id}
          </button>
          {id === "a" && <input data-testid="field" />}
        </div>
      ))}
      <button type="button" {...reorder.item("ghost")}>
        {"ghost"}
      </button>
      <div data-reorder-strip="">
        <button type="button" {...reorder.item("b")} data-testid="nested">
          {"nested"}
        </button>
      </div>
      {reorder.indicator}
    </div>
  );
}

function drag(id: string, toX: number) {
  const target = screen.getByRole("button", { name: id });
  const fromX = (target.closest<HTMLElement>("[data-reorder-item]") ?? target).getBoundingClientRect().left + 10;
  fireEvent.pointerDown(target, { button: 0, clientX: fromX, clientY: 10 });
  fireEvent.pointerMove(window, { clientX: toX, clientY: 10 });
}

function indicator() {
  return document.querySelector<HTMLElement>("[data-reorder-drop]");
}

function order() {
  return [...screen.getByTestId("strip").children]
    .filter((child) => child.tagName === "DIV" && child.hasAttribute("data-reorder-item"))
    .map((child) => child.textContent);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("useStripReorder", () => {
  it("drags an item past its neighbour, shows the drop box between them, and swallows the click", () => {
    const onReorder = vi.fn();
    const onClick = vi.fn();
    const { container } = render(<Strip onReorder={onReorder} onClick={onClick} />);
    place(container);
    drag("a", 13);
    expect(indicator()).toBeNull();
    fireEvent.pointerMove(window, { clientX: 75, clientY: 10 });
    const drop = indicator();
    expect(drop).toHaveAttribute("data-reorder-drop", "1");
    expect(drop?.style.left).toBe("60px");
    expect(drop?.style.top).toBe("4px");
    expect(drop?.style.width).toBe("28px");
    expect(drop?.style.height).toBe("28px");
    expect(screen.getByTestId("strip")).toHaveAttribute("data-dragging", "a");
    fireEvent.pointerUp(window);
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
    expect(onClick).not.toHaveBeenCalled();
    expect(indicator()).toBeNull();
    expect(order()).toEqual(["b", "a", "c"]);
  });

  it("drops at the end and at the start, clamping the box inside the strip", () => {
    const onReorder = vi.fn();
    const { container } = render(<Strip onReorder={onReorder} />);
    place(container);
    drag("a", 150);
    expect(indicator()?.style.left).toBe("94px");
    fireEvent.pointerUp(window);
    expect(onReorder).toHaveBeenLastCalledWith(["b", "c", "a"]);
    place(container);
    drag("c", 2);
    expect(indicator()?.style.left).toBe("0px");
    fireEvent.pointerUp(window);
    expect(onReorder).toHaveBeenLastCalledWith(["c", "b", "a"]);
  });

  it("moves the focused item with Alt and the arrow keys and keeps focus on it", () => {
    const onReorder = vi.fn();
    render(<Strip initial={["a", "hidden", "b", "c"]} shown={["a", "b", "c"]} onReorder={onReorder} />);
    const a = () => screen.getByRole("button", { name: "a" });
    a().focus();
    fireEvent.keyDown(a(), { key: "ArrowRight" });
    fireEvent.keyDown(a(), { key: "ArrowLeft", altKey: true });
    fireEvent.keyDown(screen.getByTestId("field"), { key: "ArrowRight", altKey: true });
    expect(onReorder).not.toHaveBeenCalled();
    fireEvent.keyDown(a(), { key: "ArrowRight", altKey: true });
    expect(onReorder).toHaveBeenLastCalledWith(["hidden", "b", "a", "c"]);
    expect(a()).toHaveFocus();
    fireEvent.keyDown(a(), { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(a(), { key: "ArrowRight", altKey: true });
    expect(order()).toEqual(["b", "c", "a"]);
    expect(onReorder).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByTestId("nested"), { key: "ArrowLeft", altKey: true });
    expect(onReorder).toHaveBeenCalledTimes(2);
  });

  it("treats a short press as a click and leaves the order alone when the item lands where it was", () => {
    const onReorder = vi.fn();
    const onClick = vi.fn();
    const { container } = render(<Strip onReorder={onReorder} onClick={onClick} />);
    place(container);
    drag("b", 52);
    fireEvent.pointerUp(window);
    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(onClick).toHaveBeenCalledWith("b");
    drag("b", 60);
    fireEvent.pointerUp(window);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("reorders by the stored ids when hidden items sit between the visible ones", () => {
    const onReorder = vi.fn();
    const { container } = render(
      <Strip initial={["a", "hidden", "b", "c", "late"]} shown={["a", "b", "c"]} onReorder={onReorder} />,
    );
    place(container);
    drag("c", 2);
    fireEvent.pointerUp(window);
    expect(onReorder).toHaveBeenLastCalledWith(["c", "a", "hidden", "b", "late"]);
    place(container);
    drag("c", 190);
    fireEvent.pointerUp(window);
    expect(onReorder).toHaveBeenLastCalledWith(["a", "hidden", "b", "c", "late"]);
  });

  it("offsets the drop box by the strip's scroll position", () => {
    const { container } = render(<Strip onReorder={vi.fn()} />);
    place(container);
    Object.defineProperty(screen.getByTestId("strip"), "scrollLeft", { configurable: true, value: 30 });
    Object.defineProperty(screen.getByTestId("strip"), "scrollWidth", { configurable: true, value: 400 });
    drag("a", 75);
    expect(indicator()?.style.left).toBe("90px");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(indicator()).toBeNull();
  });

  it("ignores unknown items, nested strips, text fields and other buttons", () => {
    const onReorder = vi.fn();
    const { container } = render(<Strip onReorder={onReorder} />);
    place(container);
    drag("ghost", 2);
    expect(indicator()).toBeNull();
    fireEvent.pointerUp(window);
    fireEvent.pointerDown(screen.getByTestId("nested"), { button: 0, clientX: 170, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 2, clientY: 10 });
    expect(indicator()).toBeNull();
    fireEvent.pointerUp(window);
    fireEvent.pointerDown(screen.getByTestId("field"), { button: 0, clientX: 170, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 2, clientY: 10 });
    expect(indicator()).toBeNull();
    fireEvent.pointerUp(window);
    fireEvent.pointerDown(screen.getByRole("button", { name: "a" }), { button: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 10 });
    expect(indicator()).toBeNull();
    fireEvent.pointerUp(window);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("skips the ghost item when it counts the slot", () => {
    const onReorder = vi.fn();
    const { container } = render(<Strip onReorder={onReorder} />);
    place(container);
    drag("a", 199);
    expect(indicator()).toHaveAttribute("data-reorder-drop", "2");
    fireEvent.pointerUp(window);
    expect(onReorder).toHaveBeenCalledWith(["b", "c", "a"]);
  });

  it("does nothing without a strip, and keeps a lone item where it is", () => {
    const onReorder = vi.fn();
    const { container, unmount } = render(<Strip bare onReorder={onReorder} />);
    place(container);
    drag("a", 150);
    expect(indicator()).toBeNull();
    fireEvent.pointerUp(window);
    unmount();
    const lone = render(<Strip initial={["a"]} onReorder={onReorder} />);
    place(lone.container);
    drag("a", 150);
    expect(indicator()?.style.left).toBe("0px");
    fireEvent.pointerUp(window);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("stops listening when the strip unmounts mid-drag", () => {
    const onReorder = vi.fn();
    const { container, unmount } = render(<Strip onReorder={onReorder} />);
    place(container);
    drag("a", 150);
    unmount();
    act(() => {
      fireEvent.pointerUp(window);
    });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("tells whether a pointer target sits on a reorderable item", () => {
    render(<Strip onReorder={vi.fn()} />);
    expect(isReorderItem(screen.getByRole("button", { name: "a" }))).toBe(true);
    expect(isReorderItem(screen.getByTestId("field"))).toBe(true);
    expect(isReorderItem(screen.getByTestId("strip"))).toBe(false);
    expect(isReorderItem(null)).toBe(false);
    expect(isReorderItem(window)).toBe(false);
  });
});
