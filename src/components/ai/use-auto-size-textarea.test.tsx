// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAutoSizeTextarea } from "./use-auto-size-textarea";

let resizeCallback: ResizeObserverCallback | null = null;
let measuredScrollHeight = 24;

class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

function InputHarness() {
  const shellRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useAutoSizeTextarea(
    textareaRef,
    shellRef,
    "",
    "Ask AI to help with your document…",
  );

  return (
    <div ref={shellRef}>
      <textarea ref={textareaRef} data-testid="assistant-input" />
    </div>
  );
}

describe("useAutoSizeTextarea", () => {
  beforeEach(() => {
    resizeCallback = null;
    measuredScrollHeight = 24;
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => measuredScrollHeight,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recalculates the textarea height when its container becomes narrower", () => {
    render(<InputHarness />);
    const textarea = screen.getByTestId("assistant-input");
    expect(textarea).toHaveStyle({ height: "24px" });

    measuredScrollHeight = 48;
    act(() => {
      resizeCallback?.(
        [{ contentRect: { width: 320 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });

    expect(textarea).toHaveStyle({ height: "48px" });
  });
});
