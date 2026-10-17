// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewportAnchor } from "@/lib/outline-active";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { DocumentOutline, OUTLINE_REVEAL_SETTLE_MS } from "./DocumentOutline";

const viewport = vi.hoisted(() => ({ anchor: null as ViewportAnchor | null }));

vi.mock("@/components/editor/cm/use-viewport-anchor", () => ({
  useEditorViewportSelection: <T,>(select: (anchor: ViewportAnchor | null) => T) => select(viewport.anchor),
  useEditorViewportAnchor: () => viewport.anchor,
}));

vi.mock("@/lib/project-intelligence/navigation", () => ({
  navigateToProjectRange: vi.fn(),
}));

const SECTIONS = ["Alpha", "Beta", "Gamma", "Delta"].map((name, index) => ({
  kind: "section" as const,
  name,
  file: "main.tex",
  line: index * 10 + 1,
  from: index * 100,
  to: index * 100 + name.length,
  nameFrom: index * 100,
  nameTo: index * 100 + name.length,
  level: 1,
}));

let reveal: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  reveal = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: reveal });
  useIndexStore.setState({ index: { defs: SECTIONS, uses: [] } as never, texts: {} });
  useFilesStore.setState({ projectId: "reveal-project", activePath: "main.tex" } as never);
});

afterEach(() => {
  vi.useRealTimers();
  delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView;
  viewport.anchor = null;
});

function scrollTo(view: ReturnType<typeof render>, pos: number) {
  viewport.anchor = { path: "main.tex", pos };
  view.rerender(<DocumentOutline />);
}

describe("DocumentOutline reveal", () => {
  it("reveals the active heading once the editor settles instead of on every section it passes", () => {
    const view = render(<DocumentOutline />);
    for (const pos of [150, 250, 350]) {
      scrollTo(view, pos);
      act(() => {
        vi.advanceTimersByTime(OUTLINE_REVEAL_SETTLE_MS / 3);
      });
    }
    expect(reveal).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(OUTLINE_REVEAL_SETTLE_MS);
    });
    expect(reveal).toHaveBeenCalledTimes(1);
    expect((reveal.mock.contexts[0] as Element).textContent).toContain("Delta");
  });

  it("does not move the list while the pointer is over it", () => {
    const view = render(<DocumentOutline />);
    const list = screen.getByText("Alpha").closest("[class*='overflow-auto']") as HTMLElement;
    fireEvent.pointerEnter(list);
    scrollTo(view, 250);
    act(() => {
      vi.advanceTimersByTime(OUTLINE_REVEAL_SETTLE_MS * 2);
    });
    expect(reveal).not.toHaveBeenCalled();
  });
});
