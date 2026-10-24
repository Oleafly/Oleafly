// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ai/provider-config", () => ({
  knownProviderConfig: null,
  loadProviderConfig: vi.fn(async () => null),
  subscribeProviderConfig: vi.fn(() => () => {}),
  deriveProviderState: vi.fn(),
}));
vi.mock("@/components/ai/use-agent-targets", () => ({ useAgentTargets: () => [] }));
vi.mock("@/components/research/tasks/ResearchTasksPanel", () => ({
  ResearchTasksPanel: () => <div data-testid="tasks-panel" />,
}));
vi.mock("@/components/research/workspace/ResearchRootsPanel", () => ({
  ResearchRootsPanel: () => <div data-testid="roots-panel" />,
}));

import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { installScrollGeometry, type ScrollGeometry } from "@/lib/test-scroll-geometry";
import { useFilesStore } from "@/store/files";
import { ResearchWorkspacePanel } from "./ResearchWorkspacePanel";

const copy = enResearchTools.workspace;

let geometry: ScrollGeometry;

beforeEach(() => {
  useFilesStore.setState({ projectId: "research-a" } as never);
  geometry = installScrollGeometry({
    isScroller: (element) => element.classList.contains("overflow-auto"),
    contentHeight: () => 2_000,
    viewportHeight: 400,
  });
});

afterEach(() => {
  geometry.restore();
  useFilesStore.setState({ projectId: null } as never);
});

const openTab = (name: string) =>
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });

const foldersScroller = () => {
  const element = screen.getByTestId("roots-panel").closest<HTMLElement>(".overflow-auto");
  if (!element) throw new Error("missing scroller");
  return element;
};

describe("ResearchWorkspacePanel view memory", () => {
  it("reopens on the tab it was left on", () => {
    const first = render(<ResearchWorkspacePanel />);
    expect(screen.getByRole("tab", { name: copy.tabTasks })).toHaveAttribute("aria-selected", "true");
    openTab(copy.tabFolders);
    expect(screen.getByRole("tab", { name: copy.tabFolders })).toHaveAttribute("aria-selected", "true");
    first.unmount();

    render(<ResearchWorkspacePanel />);

    expect(screen.getByRole("tab", { name: copy.tabFolders })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("roots-panel")).toBeInTheDocument();
  });

  it("starts another project on Tasks and restores the first project's tab on return", () => {
    const first = render(<ResearchWorkspacePanel />);
    openTab(copy.tabFolders);
    first.unmount();

    useFilesStore.setState({ projectId: "research-b" } as never);
    const second = render(<ResearchWorkspacePanel />);
    expect(screen.getByRole("tab", { name: copy.tabTasks })).toHaveAttribute("aria-selected", "true");
    second.unmount();

    useFilesStore.setState({ projectId: "research-a" } as never);
    render(<ResearchWorkspacePanel />);
    expect(screen.getByRole("tab", { name: copy.tabFolders })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the open tab for a project seen for the first time and swaps in remembered tabs", () => {
    const view = render(<ResearchWorkspacePanel />);
    openTab(copy.tabFolders);

    useFilesStore.setState({ projectId: "research-b" } as never);
    view.rerender(<ResearchWorkspacePanel />);
    expect(screen.getByRole("tab", { name: copy.tabFolders })).toHaveAttribute("aria-selected", "true");
    openTab(copy.tabTasks);

    useFilesStore.setState({ projectId: "research-a" } as never);
    view.rerender(<ResearchWorkspacePanel />);
    expect(screen.getByRole("tab", { name: copy.tabFolders })).toHaveAttribute("aria-selected", "true");

    useFilesStore.setState({ projectId: "research-b" } as never);
    view.rerender(<ResearchWorkspacePanel />);
    expect(screen.getByRole("tab", { name: copy.tabTasks })).toHaveAttribute("aria-selected", "true");
  });

  it("returns to the scroll position where the folders were left", () => {
    const first = render(<ResearchWorkspacePanel />);
    openTab(copy.tabFolders);
    geometry.scrollTo(foldersScroller(), 900);
    expect(foldersScroller().scrollTop).toBe(900);
    first.unmount();

    render(<ResearchWorkspacePanel />);

    expect(foldersScroller().scrollTop).toBe(900);
  });
});
