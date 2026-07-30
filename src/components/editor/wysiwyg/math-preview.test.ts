// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";

const mocks = vi.hoisted(() => ({
  mounts: [] as {
    isCurrent: () => boolean;
    destroy: ReturnType<typeof vi.fn>;
  }[],
}));

vi.mock("@/store/files", () => ({
  useFilesStore: {
    getState: () => ({ activePath: "main.tex" }),
  },
}));

vi.mock("@oleafly/editor/math-render", () => ({
  mountMathPreview: (
    dom: HTMLElement,
    options: { isCurrent: () => boolean },
  ) => {
    const destroy = vi.fn();
    mocks.mounts.push({ isCurrent: options.isCurrent, destroy });
    dom.dataset.mathPreviewHarness = String(mocks.mounts.length);
    return { destroy };
  },
}));

import {
  VisualMathPreview,
  refreshVisualMathPreview,
} from "./math-preview";

class TestResizeObserver {
  static latest: TestResizeObserver | null = null;
  constructor(
    private readonly callback: ResizeObserverCallback,
  ) {
    TestResizeObserver.latest = this;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  trigger(width: number) {
    this.callback(
      [
        {
          contentRect: { width },
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.mounts.length = 0;
  TestResizeObserver.latest = null;
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("VisualMathPreview lifecycle", () => {
  it("remounts widgets after observer and refresh generations invalidate their callbacks", async () => {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({
      element,
      extensions: [StarterKit, VisualMathPreview],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Value $x + y$." }],
          },
        ],
      },
    });

    await vi.runAllTimersAsync();
    expect(mocks.mounts).toHaveLength(1);
    const initial = mocks.mounts[0];
    expect(initial?.isCurrent()).toBe(true);

    TestResizeObserver.latest?.trigger(320);
    expect(initial?.isCurrent()).toBe(false);
    await vi.runAllTimersAsync();
    expect(mocks.mounts).toHaveLength(2);
    expect(initial?.destroy).toHaveBeenCalledOnce();
    const resized = mocks.mounts[1];
    expect(resized?.isCurrent()).toBe(true);

    refreshVisualMathPreview(editor);
    await vi.runAllTimersAsync();
    expect(mocks.mounts).toHaveLength(3);
    expect(resized?.destroy).toHaveBeenCalledOnce();
    expect(mocks.mounts[2]?.isCurrent()).toBe(true);

    editor.destroy();
  });
});
