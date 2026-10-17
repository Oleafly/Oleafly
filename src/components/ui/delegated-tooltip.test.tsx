// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELEGATED_TOOLTIP_ATTRIBUTE, useDelegatedTooltips } from "./delegated-tooltip";

const TEXT = {
  stageName: "Stage paper/main.tex",
  stageTip: "Stage",
  discardName: "Discard paper/main.tex",
  discardTip: "Discard changes",
  plus: "+",
  cross: "x",
  plain: "plain",
};

function List() {
  const ref = useRef<HTMLDivElement>(null);
  const tooltip = useDelegatedTooltips(ref);
  return (
    <div ref={ref} data-testid="list">
      <button type="button" aria-label={TEXT.stageName} {...{ [DELEGATED_TOOLTIP_ATTRIBUTE]: TEXT.stageTip }}>
        {TEXT.plus}
      </button>
      <button type="button" aria-label={TEXT.discardName} {...{ [DELEGATED_TOOLTIP_ATTRIBUTE]: TEXT.discardTip }}>
        {TEXT.cross}
      </button>
      <span data-testid="plain">{TEXT.plain}</span>
      {tooltip}
    </div>
  );
}

function over(element: Element) {
  element.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDelegatedTooltips", () => {
  it("shows the hovered control's label after the hover delay and describes the control with it", () => {
    render(<List />);
    const stage = screen.getByRole("button", { name: "Stage paper/main.tex" });
    act(() => over(stage));
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe("Stage");
    expect(stage.getAttribute("aria-describedby")).toBe(tip.id);
  });

  it("moves to the next control and hides over anything without a label", () => {
    render(<List />);
    act(() => over(screen.getByRole("button", { name: "Stage paper/main.tex" })));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const discard = screen.getByRole("button", { name: "Discard paper/main.tex" });
    act(() => over(discard));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole("tooltip").textContent).toBe("Discard changes");
    act(() => over(screen.getByTestId("plain")));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(discard.hasAttribute("aria-describedby")).toBe(false);
  });

  it("hides on press, leave, scroll and Escape", () => {
    render(<List />);
    const list = screen.getByTestId("list");
    const stage = screen.getByRole("button", { name: "Stage paper/main.tex" });
    const open = () => {
      act(() => over(screen.getByTestId("plain")));
      act(() => over(stage));
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.getByRole("tooltip")).toBeTruthy();
    };
    open();
    act(() => {
      stage.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    open();
    act(() => {
      list.dispatchEvent(new MouseEvent("pointerleave"));
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    open();
    act(() => {
      list.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    open();
    act(() => {
      stage.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("never shows a tooltip that was cancelled before the delay ran out", () => {
    render(<List />);
    act(() => over(screen.getByRole("button", { name: "Stage paper/main.tex" })));
    act(() => {
      screen.getByTestId("list").dispatchEvent(new MouseEvent("pointerleave"));
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("places a tooltip beside a control that asks for the right side", () => {
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.getAttribute("role") === "tooltip") return rect(0, 0, 60, 20);
      return rect(100, 200, 40, 30);
    });
    render(<List />);
    const stage = screen.getByRole("button", { name: TEXT.stageName });
    stage.setAttribute("data-tooltip-side", "right");
    act(() => over(stage));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole("tooltip").style.left).toBe("146px");
    expect(screen.getByRole("tooltip").style.top).toBe("205px");
    vi.restoreAllMocks();
  });
});
