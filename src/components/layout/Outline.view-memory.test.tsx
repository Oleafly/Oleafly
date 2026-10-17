// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateToProjectRange = vi.hoisted(() => vi.fn());
vi.mock("@/lib/project-intelligence/navigation", () => ({
  navigateToProjectRange,
}));

import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "@/lib/project-intelligence/assemble";
import type { ProjectIntelligenceState } from "@/lib/project-intelligence/types";
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import {
  installScrollGeometry,
  paddedListHeight,
  type ScrollGeometry,
} from "@/lib/test-scroll-geometry";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { Outline } from "./Outline";

const copy = enWorkspace.structure;

function snapshot(projectId: string, sources: Record<string, string>) {
  const files = Object.fromEntries(
    Object.entries(sources).map(([path, source]) => [path, analyzeProjectFile(path, source, 1)]),
  );
  return assembleProjectIntelligence({
    identity: { projectId, projectRevision: 1, requestGeneration: 1 },
    files,
    knownFiles: Object.keys(sources),
    mainDocument: "main.tex",
    stats: {
      fileCount: Object.keys(sources).length,
      characterCount: 0,
      parsedFileCount: Object.keys(sources).length,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
}

const SMALL = {
  "main.tex": String.raw`\section{Introduction}
\label{sec:intro}
\include{chapter}`,
  "chapter.tex": String.raw`\section{Method}`,
  "unlinked.tex": String.raw`\section{Detached}`,
};

const LONG = {
  "main.tex": Array.from(
    { length: 300 },
    (_, index) => String.raw`\section{Part ${String(index).padStart(3, "0")}}`,
  ).join("\n"),
};

function show(projectId: string, sources: Record<string, string>) {
  const data = snapshot(projectId, sources);
  act(() => {
    useFilesStore.setState({
      projectId,
      projectName: "Paper",
      activePath: "main.tex",
      files: {},
      tree: [],
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    useIndexStore.setState({
      intelligenceState: {
        status: "success",
        identity: data.identity,
        data,
        stale: false,
      } as ProjectIntelligenceState,
    } as unknown as ReturnType<typeof useIndexStore.getState>);
  });
}

beforeEach(() => {
  navigateToProjectRange.mockClear();
  show("structure-a", SMALL);
});

afterEach(() => {
  useIndexStore.getState().reset();
  useFilesStore.setState({
    projectId: null,
    projectName: "",
    activePath: null,
    tree: [],
    files: {},
  });
});

describe("Outline (Structure) view memory", () => {
  it("keeps the filter and the collapsed branches after the panel is closed and reopened", async () => {
    const user = userEvent.setup();
    const first = render(<Outline />);
    await user.click(await screen.findByRole("button", { name: copy.collapseAll }));
    await waitFor(() => expect(screen.queryByText("Introduction")).not.toBeInTheDocument());
    await user.type(screen.getByLabelText(copy.filterLabel), "main");
    first.unmount();

    render(<Outline />);

    expect(screen.getByLabelText(copy.filterLabel)).toHaveValue("main");
    expect(screen.getByText("main.tex")).toBeInTheDocument();
    expect(screen.queryByText("unlinked.tex")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText(copy.filterLabel));
    expect(await screen.findByText("unlinked.tex")).toBeInTheDocument();
    expect(screen.queryByText("Introduction")).not.toBeInTheDocument();
  });

  it("brings back the branches the reader opened and closed by hand", async () => {
    const user = userEvent.setup();
    const control = (file: string, action: "Expand" | "Collapse") => {
      const row = screen.getByText(file).closest('[role="treeitem"]');
      const button = row?.querySelector<HTMLButtonElement>(`button[aria-label="${action}"]`);
      if (!button) throw new Error(`expected ${action} on ${file}`);
      return button;
    };
    const first = render(<Outline />);
    expect(screen.queryByText("Method")).not.toBeInTheDocument();
    await user.click(control("chapter.tex", "Expand"));
    await user.click(control("unlinked.tex", "Collapse"));
    expect(await screen.findByText("Method")).toBeInTheDocument();
    expect(screen.queryByText("Detached")).not.toBeInTheDocument();
    first.unmount();

    render(<Outline />);

    expect(screen.getByText("Method")).toBeInTheDocument();
    expect(screen.queryByText("Detached")).not.toBeInTheDocument();
  });

  it("starts another project unfiltered and restores the first project's view on return", async () => {
    const user = userEvent.setup();
    const first = render(<Outline />);
    await user.type(await screen.findByLabelText(copy.filterLabel), "intro");
    first.unmount();

    show("structure-b", SMALL);
    const second = render(<Outline />);
    expect(screen.getByLabelText(copy.filterLabel)).toHaveValue("");
    await user.type(screen.getByLabelText(copy.filterLabel), "method");
    second.unmount();

    show("structure-a", SMALL);
    const third = render(<Outline />);
    expect(screen.getByLabelText(copy.filterLabel)).toHaveValue("intro");
    third.unmount();

    show("structure-b", SMALL);
    render(<Outline />);
    expect(screen.getByLabelText(copy.filterLabel)).toHaveValue("method");
  });

  it("swaps in the remembered filter of a project opened while the panel stays mounted", async () => {
    const user = userEvent.setup();
    render(<Outline />);
    await user.type(await screen.findByLabelText(copy.filterLabel), "intro");

    show("structure-b", SMALL);
    await waitFor(() => expect(screen.getByLabelText(copy.filterLabel)).toHaveValue(""));

    show("structure-a", SMALL);
    await waitFor(() => expect(screen.getByLabelText(copy.filterLabel)).toHaveValue("intro"));
  });
});

describe("Outline (Structure) scroll memory", () => {
  let geometry: ScrollGeometry;

  beforeEach(() => {
    show("structure-a", LONG);
    geometry = installScrollGeometry({
      isScroller: (element) => element.classList.contains("overflow-auto"),
      contentHeight: (scroller) =>
        8 + paddedListHeight(scroller.querySelector('[role="tree"] > div'), 28),
      viewportHeight: 280,
      rowHeight: 28,
    });
  });

  afterEach(() => {
    geometry.restore();
  });

  const scroller = () => {
    const element = screen.getByRole("tree").closest<HTMLElement>(".overflow-auto");
    if (!element) throw new Error("missing scroller");
    return element;
  };

  it("lands exactly where the tree was left, with the matching rows already rendered", () => {
    const first = render(<Outline />);
    geometry.scrollTo(scroller(), 4_200);
    expect(scroller().scrollTop).toBe(4_200);
    expect(screen.getByText("Part 148")).toBeInTheDocument();
    first.unmount();

    render(<Outline />);

    expect(scroller().scrollTop).toBe(4_200);
    expect(screen.getByText("Part 148")).toBeInTheDocument();
    expect(screen.queryByText("Part 000")).not.toBeInTheDocument();
    expect(geometry.pendingFrames()).toBe(0);
  });

  it("shows a new filter's results from the top of the tree", () => {
    render(<Outline />);
    geometry.scrollTo(scroller(), 4_200);

    fireEvent.change(screen.getByLabelText(copy.filterLabel), { target: { value: "Part 1" } });

    expect(screen.getByText("Part 100")).toBeInTheDocument();
    expect(scroller().scrollTop).toBe(0);
  });

  it("keeps each project's filtered position when the project changes while open", () => {
    render(<Outline />);
    fireEvent.change(screen.getByLabelText(copy.filterLabel), { target: { value: "Part" } });
    geometry.scrollTo(scroller(), 1_400);
    show("structure-b", LONG);
    fireEvent.change(screen.getByLabelText(copy.filterLabel), { target: { value: "Part 1" } });
    geometry.scrollTo(scroller(), 700);

    show("structure-a", LONG);
    expect(screen.getByLabelText(copy.filterLabel)).toHaveValue("Part");
    expect(scroller().scrollTop).toBe(1_400);

    show("structure-b", LONG);
    expect(screen.getByLabelText(copy.filterLabel)).toHaveValue("Part 1");
    expect(scroller().scrollTop).toBe(700);
  });

  it("keeps a separate position for each project", () => {
    const first = render(<Outline />);
    geometry.scrollTo(scroller(), 4_200);
    first.unmount();

    show("structure-b", LONG);
    const second = render(<Outline />);
    expect(scroller().scrollTop).toBe(0);
    geometry.scrollTo(scroller(), 840);
    second.unmount();

    show("structure-a", LONG);
    const third = render(<Outline />);
    expect(scroller().scrollTop).toBe(4_200);
    third.unmount();

    show("structure-b", LONG);
    render(<Outline />);
    expect(scroller().scrollTop).toBe(840);
  });
});
