// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchTask } from "@/lib/research-tasks";

vi.mock("@/lib/research-tasks", () => ({
  acceptResearchTaskResult: vi.fn(), applyResearchTask: vi.fn(), cancelResearchTask: vi.fn(),
  createResearchTask: vi.fn(), deleteResearchTask: vi.fn(), editResearchTask: vi.fn(), listResearchTasks: vi.fn(),
  listenForResearchTaskChanges: vi.fn(), listenForResearchTaskEvents: vi.fn(),
  loadResearchTaskEvents: vi.fn(), retryResearchTask: vi.fn(), startResearchTask: vi.fn(),
  previewResearchTaskFile: vi.fn(), previewResearchTaskArtifact: vi.fn(),
}));

vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ runExternalProjectMutation: vi.fn() }) },
}));

vi.mock("@/components/editor/diff/InlineDiffPreview", () => ({
  InlineDiffPreview: () => <div />,
}));

vi.mock("@/components/ui/markdown", () => ({
  Markdown: ({ children }: { children: string }) => <p>{children}</p>,
}));

import * as api from "@/lib/research-tasks";
import { installScrollGeometry, type ScrollGeometry } from "@/lib/test-scroll-geometry";
import { useResearchTasksStore } from "@/store/research-tasks";
import { ResearchTasksPanel } from "./ResearchTasksPanel";

function task(id: string, projectId: string, status: ResearchTask["status"]): ResearchTask {
  return {
    id, projectId, title: `Task ${id}`, prompt: `Complete ${id}`, runtimeId: "builtin",
    agentId: "provider", modelId: "model", skillIds: [], dependencyIds: [], status,
    executionGeneration: 1, sessionId: `session-${id}`, nativeSessionId: null,
    sourceRevision: "snapshot:base", isolation: null, error: null, result: null,
    review: null, startRequested: false, cancelRequested: false,
    createdAt: 1, updatedAt: 1, startedAt: 1, finishedAt: 1,
  };
}

const agents = [{ runtimeId: "builtin", agentId: "provider", modelId: "model", label: "Research model" }];

const mixed = (projectId: string) => [
  task("running", projectId, "running"),
  task("review", projectId, "awaiting_review"),
  task("done", projectId, "completed"),
];

function selectFilter(name: RegExp) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

async function mount(projectId: string) {
  const view = render(<ResearchTasksPanel projectId={projectId} agents={agents} />);
  await screen.findByRole("button", { name: /Task running|Task t00/ });
  return view;
}

beforeEach(async () => {
  vi.resetAllMocks();
  await useResearchTasksStore.getState().bindProject(null);
  vi.mocked(api.loadResearchTaskEvents).mockResolvedValue({ events: [], nextSequence: null });
  vi.mocked(api.listenForResearchTaskChanges).mockResolvedValue(() => {});
  vi.mocked(api.listenForResearchTaskEvents).mockResolvedValue(() => {});
});

afterEach(() => cleanup());

describe("ResearchTasksPanel view memory", () => {
  it("keeps the run-state filter after the panel is closed and reopened", async () => {
    vi.mocked(api.listResearchTasks).mockResolvedValue(mixed("research-a"));
    const first = await mount("research-a");
    selectFilter(/^Review/);
    expect(screen.queryByRole("button", { name: /Task running/ })).not.toBeInTheDocument();
    first.unmount();

    render(<ResearchTasksPanel projectId="research-a" agents={agents} />);
    await screen.findByRole("button", { name: /Task review/ });

    expect(screen.getByRole("tab", { name: /^Review/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: /Task running/ })).not.toBeInTheDocument();
  });

  it("starts another project on All and restores the first project's filter on return", async () => {
    vi.mocked(api.listResearchTasks).mockImplementation(async (id: string) => mixed(id));
    const first = await mount("research-a");
    selectFilter(/^Done/);
    first.unmount();

    const second = await mount("research-b");
    expect(screen.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true");
    second.unmount();

    render(<ResearchTasksPanel projectId="research-a" agents={agents} />);
    await screen.findByRole("button", { name: /Task done/ });
    expect(screen.getByRole("tab", { name: /^Done/ })).toHaveAttribute("aria-selected", "true");
  });

  it("swaps in the remembered filter of a project opened while the panel stays mounted", async () => {
    vi.mocked(api.listResearchTasks).mockImplementation(async (id: string) => mixed(id));
    const view = await mount("research-a");
    selectFilter(/^Review/);

    view.rerender(<ResearchTasksPanel projectId="research-b" agents={agents} />);
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true"),
    );

    view.rerender(<ResearchTasksPanel projectId="research-a" agents={agents} />);
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /^Review/ })).toHaveAttribute("aria-selected", "true"),
    );
  });
});

describe("ResearchTasksPanel scroll memory", () => {
  let geometry: ScrollGeometry;

  beforeEach(() => {
    geometry = installScrollGeometry({
      isScroller: (element) => element.tagName === "UL",
      contentHeight: (scroller) => scroller.children.length * 100,
      viewportHeight: 300,
    });
  });

  afterEach(() => {
    geometry.restore();
  });

  const MANY = (projectId: string) =>
    Array.from({ length: 40 }, (_, index) =>
      task(`t${String(index).padStart(2, "0")}`, projectId, "completed"),
    );
  const scroller = () => {
    const element = screen.getByRole("navigation").querySelector("ul");
    if (!element) throw new Error("missing scroller");
    return element;
  };

  it("returns to the scroll position where the task list was left", async () => {
    vi.mocked(api.listResearchTasks).mockImplementation(async (id: string) => MANY(id));
    const first = await mount("research-a");
    geometry.scrollTo(scroller(), 1_500);
    expect(scroller().scrollTop).toBe(1_500);
    first.unmount();

    render(<ResearchTasksPanel projectId="research-a" agents={agents} />);
    await screen.findByRole("button", { name: /Task t00/ });

    expect(scroller().scrollTop).toBe(1_500);
  });

  it("starts another project at the top and restores the first project's position", async () => {
    vi.mocked(api.listResearchTasks).mockImplementation(async (id: string) => MANY(id));
    const first = await mount("research-a");
    geometry.scrollTo(scroller(), 1_500);
    first.unmount();

    const second = await mount("research-b");
    expect(scroller().scrollTop).toBe(0);
    second.unmount();

    render(<ResearchTasksPanel projectId="research-a" agents={agents} />);
    await screen.findByRole("button", { name: /Task t00/ });
    expect(scroller().scrollTop).toBe(1_500);
  });
});
