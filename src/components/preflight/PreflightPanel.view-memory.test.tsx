// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/ask-ai-preflight", () => ({
  askAiAboutFinding: vi.fn(async () => {}),
  askAiAboutFindings: vi.fn(async () => {}),
}));

import { LATEX_ENGINE } from "@/lib/document-engine";
import { installScrollGeometry, type ScrollGeometry } from "@/lib/test-scroll-geometry";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { usePreflightStore } from "@/store/preflight";
import { PreflightPanel } from "./PreflightPanel";

let geometry: ScrollGeometry;

function openProject(projectId: string) {
  useFilesStore.setState({
    projectId,
    mainDoc: "main.tex",
    activePath: "main.tex",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    files: { "main.tex": { content: "\\documentclass{article}", dirty: false } },
  });
}

beforeEach(() => {
  usePreflightStore.getState().reset();
  useCompileStore.getState().reset();
  openProject("preflight-a");
  geometry = installScrollGeometry({
    isScroller: (element) => element.classList.contains("overflow-auto"),
    contentHeight: () => 1_200,
    viewportHeight: 400,
  });
});

afterEach(() => {
  geometry.restore();
});

const scroller = () => {
  const element = screen.getByTestId("preflight-panel").querySelector<HTMLElement>(".overflow-auto");
  if (!element) throw new Error("missing scroller");
  return element;
};

describe("PreflightPanel scroll memory", () => {
  it("returns to the scroll position where the checks were left", () => {
    const first = render(<PreflightPanel />);
    geometry.scrollTo(scroller(), 500);
    expect(scroller().scrollTop).toBe(500);
    first.unmount();

    render(<PreflightPanel />);

    expect(scroller().scrollTop).toBe(500);
    expect(geometry.pendingFrames()).toBe(0);
  });

  it("starts another project at the top and restores the first project's position", () => {
    const first = render(<PreflightPanel />);
    geometry.scrollTo(scroller(), 500);
    first.unmount();

    openProject("preflight-b");
    const second = render(<PreflightPanel />);
    expect(scroller().scrollTop).toBe(0);
    geometry.scrollTo(scroller(), 200);
    second.unmount();

    openProject("preflight-a");
    const third = render(<PreflightPanel />);
    expect(scroller().scrollTop).toBe(500);
    third.unmount();

    openProject("preflight-b");
    render(<PreflightPanel />);
    expect(scroller().scrollTop).toBe(200);
  });

  it("scrolls a project opened while mounted to the position remembered for it", () => {
    const view = render(<PreflightPanel />);
    geometry.scrollTo(scroller(), 500);

    openProject("preflight-b");
    view.rerender(<PreflightPanel />);
    expect(scroller().scrollTop).toBe(0);

    openProject("preflight-a");
    view.rerender(<PreflightPanel />);
    expect(scroller().scrollTop).toBe(500);
  });
});
