// @vitest-environment jsdom
import { render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlidePageProvider, useSlidePageNumber } from "./page-context";

function PageNumber() {
  const { current, total } = useSlidePageNumber();
  return <span>{`${current} of ${total}`}</span>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSlidePageNumber", () => {
  it("counts pages from one inside a slide", () => {
    render(
      <SlidePageProvider index={2} total={5}>
        <PageNumber />
      </SlidePageProvider>,
    );

    expect(screen.getByText("3 of 5")).toBeInTheDocument();
  });

  it("refuses to run outside a slide", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useSlidePageNumber())).toThrow(
      "useSlidePageNumber must be called from a slide page rendered by @open-slide/core",
    );
  });

  it("shares the page context with another copy of the runtime", async () => {
    vi.resetModules();
    const second = await import("./page-context");
    expect(second.useSlidePageNumber).not.toBe(useSlidePageNumber);

    function SecondCopyNumber() {
      const { current, total } = second.useSlidePageNumber();
      return <span>{`copy ${current}/${total}`}</span>;
    }
    render(
      <SlidePageProvider index={0} total={2}>
        <SecondCopyNumber />
      </SlidePageProvider>,
    );

    expect(screen.getByText("copy 1/2")).toBeInTheDocument();
  });
});
