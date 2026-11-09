// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SectionReorderArea } from "./section-reorder";
import { SidebarSection } from "./SidebarSection";

const BOXES: Record<string, readonly [number, number]> = { a: [0, 90], b: [100, 90], c: [200, 90] };

function rectAt(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 200, width: 200, x: 0, y: top, toJSON: () => ({}) };
}

function place(container: HTMLElement, boxes: Record<string, readonly [number, number]> = BOXES) {
  for (const header of container.querySelectorAll<HTMLElement>("[data-section-header]")) {
    const [top, height] = boxes[header.dataset.sectionHeader ?? ""] ?? [0, 90];
    header.getBoundingClientRect = () => rectAt(top, 32);
    const section = header.closest("section") as HTMLElement;
    section.getBoundingClientRect = () => rectAt(top, height);
    const panel = section.parentElement;
    if (panel?.id) panel.getBoundingClientRect = () => rectAt(top, height);
  }
  const area = container.querySelector<HTMLElement>(".relative.h-full") as HTMLElement;
  area.getBoundingClientRect = () => rectAt(0, 300);
}

function Stack({ onReorder, onOpen }: Readonly<{ onReorder?: (ids: string[]) => void; onOpen?: (id: string) => void }>) {
  const [ids, setIds] = useState(["a", "b", "c"]);
  return (
    <SectionReorderArea
      ids={ids}
      onReorder={
        onReorder
          ? (next) => {
              onReorder(next);
              setIds(next);
            }
          : undefined
      }
    >
      {ids.map((id) => (
        <SidebarSection key={id} id={id} title={`Section ${id}`} open onOpenChange={() => onOpen?.(id)}>
          <p>{`${id} body`}</p>
        </SidebarSection>
      ))}
    </SectionReorderArea>
  );
}

function PanelStack({ onReorder }: Readonly<{ onReorder: (ids: string[]) => void }>) {
  const [ids, setIds] = useState(["a-v", "b-v", "c-v"]);
  return (
    <SectionReorderArea
      ids={ids}
      onReorder={(next) => {
        onReorder(next);
        setIds(next);
      }}
    >
      {ids.map((panel) => {
        const id = panel.replace("-v", "");
        return (
          <div key={panel} id={panel}>
            <SidebarSection id={id} title={`Section ${id}`} open onOpenChange={() => undefined}>
              <p>{`${id} body`}</p>
            </SidebarSection>
          </div>
        );
      })}
    </SectionReorderArea>
  );
}

function header(id: string) {
  return screen.getByRole("button", { name: `Section ${id}` });
}

function order() {
  return [...document.querySelectorAll<HTMLElement>("[data-section-header]")].map((element) => element.dataset.sectionHeader);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("reordering sidebar sections", () => {
  it("moves a section with Alt and the arrow keys and keeps focus on it", () => {
    const onReorder = vi.fn();
    render(<Stack onReorder={onReorder} />);
    expect(header("a")).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
    header("a").focus();
    fireEvent.keyDown(header("a"), { key: "ArrowUp", altKey: true });
    expect(onReorder).not.toHaveBeenCalled();
    fireEvent.keyDown(header("a"), { key: "ArrowDown" });
    expect(onReorder).not.toHaveBeenCalled();
    fireEvent.keyDown(header("a"), { key: "ArrowDown", altKey: true });
    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
    expect(order()).toEqual(["b", "a", "c"]);
    expect(header("a")).toHaveFocus();
    fireEvent.keyDown(header("a"), { key: "ArrowDown", altKey: true });
    fireEvent.keyDown(header("a"), { key: "ArrowDown", altKey: true });
    expect(order()).toEqual(["b", "c", "a"]);
  });

  it("drags a section onto another, highlights the whole target, and does not toggle it", () => {
    const onReorder = vi.fn();
    const onOpen = vi.fn();
    const { container } = render(<Stack onReorder={onReorder} onOpen={onOpen} />);
    place(container);
    fireEvent.pointerDown(header("a"), { button: 0, clientY: 10 });
    fireEvent.pointerMove(window, { clientY: 13 });
    expect(container.querySelector("[data-section-drop]")).toBeNull();
    fireEvent.pointerMove(window, { clientY: 150 });
    const bar = container.querySelector<HTMLElement>("[data-section-drop]");
    expect(bar).toHaveAttribute("data-section-drop", "1");
    expect(bar?.style.top).toBe("100px");
    expect(bar?.style.height).toBe("90px");
    expect(bar).toHaveClass("rounded-md", "border-primary/60", "bg-primary/10");
    expect(container.querySelector('[data-section-header="a"]')).toHaveClass("bg-sidebar-accent");
    fireEvent.pointerUp(window);
    fireEvent.click(header("a"));
    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
    expect(onOpen).not.toHaveBeenCalled();
    expect(container.querySelector("[data-section-drop]")).toBeNull();
  });

  it("targets the last section when the pointer goes past the end", () => {
    const onReorder = vi.fn();
    const { container } = render(<Stack onReorder={onReorder} />);
    place(container);
    fireEvent.pointerDown(header("a"), { button: 0, clientY: 10 });
    fireEvent.pointerMove(window, { clientY: 295 });
    const bar = container.querySelector<HTMLElement>("[data-section-drop]");
    expect(bar).toHaveAttribute("data-section-drop", "2");
    expect(bar?.style.top).toBe("200px");
    fireEvent.pointerUp(window);
    expect(onReorder).toHaveBeenCalledWith(["b", "c", "a"]);
  });

  it("highlights the first section when one moves up to it", () => {
    const onReorder = vi.fn();
    const { container } = render(<Stack onReorder={onReorder} />);
    place(container);
    fireEvent.pointerDown(header("c"), { button: 0, clientY: 210 });
    fireEvent.pointerMove(window, { clientY: 5 });
    expect(container.querySelector<HTMLElement>("[data-section-drop]")?.style.top).toBe("0px");
    fireEvent.pointerUp(window);
    expect(onReorder).toHaveBeenCalledWith(["c", "a", "b"]);
  });

  it("highlights a tall open section from anywhere inside it, not the gap after its header", () => {
    const onReorder = vi.fn();
    const { container } = render(<Stack onReorder={onReorder} />);
    place(container, { a: [0, 230], b: [230, 32], c: [262, 32] });
    fireEvent.pointerDown(header("b"), { button: 0, clientY: 240 });
    fireEvent.pointerMove(window, { clientY: 120 });
    const bar = container.querySelector<HTMLElement>("[data-section-drop]");
    expect(bar).toHaveAttribute("data-section-drop", "0");
    expect(bar?.style.top).toBe("0px");
    expect(bar?.style.height).toBe("230px");
    fireEvent.pointerMove(window, { clientY: 229 });
    expect(container.querySelector<HTMLElement>("[data-section-drop]")?.style.height).toBe("230px");
    fireEvent.pointerUp(window);
    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
  });

  it("clips the highlight to the visible stack", () => {
    const { container } = render(<Stack onReorder={vi.fn()} />);
    place(container, { a: [0, 90], b: [100, 90], c: [200, 160] });
    fireEvent.pointerDown(header("a"), { button: 0, clientY: 10 });
    fireEvent.pointerMove(window, { clientY: 250 });
    const bar = container.querySelector<HTMLElement>("[data-section-drop]");
    expect(bar?.style.top).toBe("200px");
    expect(bar?.style.height).toBe("100px");
    fireEvent.pointerUp(window);
  });

  it("treats a short press as a click and leaves the order alone when nothing moves", () => {
    const onReorder = vi.fn();
    const onOpen = vi.fn();
    const { container } = render(<Stack onReorder={onReorder} onOpen={onOpen} />);
    place(container);
    fireEvent.pointerDown(header("b"), { button: 0, clientY: 110 });
    fireEvent.pointerMove(window, { clientY: 112 });
    fireEvent.pointerUp(window);
    fireEvent.click(header("b"));
    expect(onOpen).toHaveBeenCalledWith("b");
    fireEvent.pointerDown(header("b"), { button: 0, clientY: 110 });
    fireEvent.pointerMove(window, { clientY: 140 });
    expect(container.querySelector("[data-section-drop]")).toBeNull();
    expect(container.querySelector('[data-section-header="b"]')).toHaveClass("bg-sidebar-accent");
    fireEvent.pointerUp(window);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("cancels a drag on Escape, blur or pointer cancel, and ignores other buttons", () => {
    const onReorder = vi.fn();
    const { container } = render(<Stack onReorder={onReorder} />);
    place(container);
    fireEvent.pointerDown(header("a"), { button: 2, clientY: 10 });
    fireEvent.pointerMove(window, { clientY: 150 });
    expect(container.querySelector("[data-section-drop]")).toBeNull();
    fireEvent.pointerDown(header("a"), { button: 0, clientY: 10 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerMove(window, { clientY: 150 });
    expect(container.querySelector("[data-section-drop]")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector("[data-section-drop]")).toBeNull();
    fireEvent.pointerUp(window);
    for (const end of [() => fireEvent.blur(window), () => fireEvent.pointerCancel(window)]) {
      fireEvent.pointerDown(header("a"), { button: 0, clientY: 10 });
      fireEvent.pointerMove(window, { clientY: 150 });
      end();
      expect(container.querySelector("[data-section-drop]")).toBeNull();
    }
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("stops listening when the stack unmounts mid-drag", () => {
    const onReorder = vi.fn();
    const { container, unmount } = render(<Stack onReorder={onReorder} />);
    place(container);
    fireEvent.pointerDown(header("a"), { button: 0, clientY: 10 });
    fireEvent.pointerMove(window, { clientY: 150 });
    unmount();
    act(() => {
      fireEvent.pointerUp(window);
    });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("reorders by the panel ids when the sections name themselves differently", () => {
    const onReorder = vi.fn();
    const { container } = render(<PanelStack onReorder={onReorder} />);
    place(container);
    fireEvent.pointerDown(header("a"), { button: 0, clientY: 10 });
    fireEvent.pointerMove(window, { clientY: 150 });
    fireEvent.pointerUp(window);
    expect(onReorder).toHaveBeenLastCalledWith(["b-v", "a-v", "c-v"]);
    header("c").focus();
    fireEvent.keyDown(header("c"), { key: "ArrowUp", altKey: true });
    expect(onReorder).toHaveBeenLastCalledWith(["b-v", "c-v", "a-v"]);
    expect(header("c")).toHaveFocus();
  });

  it("ignores a section that is not part of the stack", () => {
    const onReorder = vi.fn();
    render(
      <SectionReorderArea ids={["x-v"]} onReorder={onReorder}>
        <SidebarSection id="loose" title={"Section loose"} open onOpenChange={() => undefined}>
          <p>{"loose"}</p>
        </SidebarSection>
      </SectionReorderArea>,
    );
    fireEvent.pointerDown(header("loose"), { button: 0, clientY: 10 });
    fireEvent.pointerMove(window, { clientY: 150 });
    fireEvent.pointerUp(window);
    fireEvent.keyDown(header("loose"), { key: "ArrowDown", altKey: true });
    expect(document.querySelector("[data-section-drop]")).toBeNull();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("offers no reordering without a handler", () => {
    const onOpen = vi.fn();
    render(<Stack onOpen={onOpen} />);
    expect(header("a")).not.toHaveAttribute("aria-keyshortcuts");
    fireEvent.keyDown(header("a"), { key: "ArrowDown", altKey: true });
    fireEvent.pointerDown(header("a"), { button: 0, clientY: 10 });
    fireEvent.pointerMove(window, { clientY: 150 });
    expect(document.querySelector("[data-section-drop]")).toBeNull();
    expect(order()).toEqual(["a", "b", "c"]);
  });
});
