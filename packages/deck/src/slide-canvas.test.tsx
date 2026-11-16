// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlideCanvas } from "./slide-canvas";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SlideCanvas", () => {
  it("uses a fixed scale without measuring its box", () => {
    const measure = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const { container } = render(
      <SlideCanvas scale={0.25} center={false}>
        <p>{"Content"}</p>
      </SlideCanvas>,
    );

    const canvas = container.querySelector<HTMLElement>("[data-osd-canvas]");
    const frame = canvas?.parentElement;
    expect(measure).not.toHaveBeenCalled();
    expect(canvas?.style.transform).toBe("scale(0.25)");
    expect(canvas).not.toHaveAttribute("data-osd-freeze-motion");
    expect(frame?.style.width).toBe("480px");
    expect(frame?.style.height).toBe("270px");
    expect(frame?.style.position).toBe("");
    expect(frame?.style.visibility).toBe("");
    expect(container.querySelector("[aria-hidden]")).toBeNull();
  });
});
