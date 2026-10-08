// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ai/AiToolsList", () => ({
  AiToolsGrid: () => <div data-testid="ai-tools-grid" />,
}));

import { installScrollGeometry, type ScrollGeometry } from "@/lib/test-scroll-geometry";
import { useFilesStore } from "@/store/files";
import { useMcpActivityStore } from "@/store/mcp-activity";
import { McpActivityPanel } from "./McpActivityPanel";

const LOGS = Array.from({ length: 80 }, (_, index) => ({
  id: index + 1,
  name: `tool_${String(index).padStart(2, "0")}`,
  status: "ok" as const,
  ts: Date.UTC(2026, 0, 2, 3, 4, 5),
  args: {},
  durationMs: 12,
  summary: "done",
}));

let geometry: ScrollGeometry;

beforeEach(() => {
  useMcpActivityStore.setState({ logs: LOGS, serverRunning: true, unread: 0 });
  useFilesStore.setState({ projectId: "mcp-a" } as never);
  geometry = installScrollGeometry({
    isScroller: (element) => element.classList.contains("overflow-auto"),
    contentHeight: (scroller) => (scroller.firstElementChild?.children.length ?? 0) * 48,
    viewportHeight: 240,
  });
});

afterEach(() => {
  geometry.restore();
  useFilesStore.setState({ projectId: null } as never);
});

const scroller = () => {
  const element = screen.getByText("tool_00").closest<HTMLElement>(".overflow-auto");
  if (!element) throw new Error("missing scroller");
  return element;
};

describe("McpActivityPanel scroll memory", () => {
  it("returns to the scroll position where the log was left", () => {
    const first = render(<McpActivityPanel />);
    geometry.scrollTo(scroller(), 1_200);
    expect(scroller().scrollTop).toBe(1_200);
    first.unmount();

    render(<McpActivityPanel />);

    expect(scroller().scrollTop).toBe(1_200);
    expect(geometry.pendingFrames()).toBe(0);
  });

  it("starts another project at the top and restores the first project's position", () => {
    const first = render(<McpActivityPanel />);
    geometry.scrollTo(scroller(), 1_200);
    first.unmount();

    useFilesStore.setState({ projectId: "mcp-b" } as never);
    const second = render(<McpActivityPanel />);
    expect(scroller().scrollTop).toBe(0);
    geometry.scrollTo(scroller(), 480);
    second.unmount();

    useFilesStore.setState({ projectId: "mcp-a" } as never);
    const third = render(<McpActivityPanel />);
    expect(scroller().scrollTop).toBe(1_200);
    third.unmount();

    useFilesStore.setState({ projectId: "mcp-b" } as never);
    render(<McpActivityPanel />);
    expect(scroller().scrollTop).toBe(480);
  });

  it("scrolls a project opened while mounted to the position remembered for it", () => {
    const view = render(<McpActivityPanel />);
    geometry.scrollTo(scroller(), 1_200);

    useFilesStore.setState({ projectId: "mcp-b" } as never);
    view.rerender(<McpActivityPanel />);
    expect(scroller().scrollTop).toBe(0);

    useFilesStore.setState({ projectId: "mcp-a" } as never);
    view.rerender(<McpActivityPanel />);
    expect(scroller().scrollTop).toBe(1_200);
  });
});
