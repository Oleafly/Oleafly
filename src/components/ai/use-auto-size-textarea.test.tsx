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

  it("sizes an empty box by its placeholder, which WebKit leaves partly out of scrollHeight", () => {
    const placeholder = "Write a reply. Type @ to mention someone.";
    // What WebKit reports for a placeholder that wraps to two lines (36) next
    // to the same words typed in (42).
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        return this.value === placeholder ? 42 : 36;
      },
    });
    function ReplyHarness() {
      const shellRef = useRef<HTMLDivElement>(null);
      const textareaRef = useRef<HTMLTextAreaElement>(null);
      useAutoSizeTextarea(textareaRef, shellRef, "", placeholder);
      return (
        <div ref={shellRef}>
          <textarea ref={textareaRef} data-testid="reply" placeholder={placeholder} defaultValue="" />
        </div>
      );
    }
    render(<ReplyHarness />);
    const textarea = screen.getByTestId("reply") as HTMLTextAreaElement;
    expect(textarea).toHaveStyle({ height: "42px" });
    expect(textarea.value).toBe("");
  });
});
