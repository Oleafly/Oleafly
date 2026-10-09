// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "@/lib/project-intelligence/assemble";
import {
  installScrollGeometry,
  paddedListHeight,
  type ScrollGeometry,
} from "@/lib/test-scroll-geometry";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { useReferencesStore } from "@/store/references";
import { ReferencesPanel } from "./ReferencesPanel";

vi.mock("@/lib/project-intelligence/navigation", () => ({
  navigateToProjectRange: vi.fn(),
}));

const pad = (value: number) => String(value).padStart(3, "0");

function sourcesOf(count: number) {
  return {
    "main.tex": Array.from(
      { length: count },
      (_, index) => String.raw`\section{Section ${pad(index)}}\label{sec:${pad(index)}}\cite{key${pad(index)}}`,
    ).join("\n"),
    "refs.bib": Array.from(
      { length: count },
      (_, index) => `@article{key${pad(index)}, title={Title ${pad(index)}}, author={Smith}}`,
    ).join("\n"),
  };
}

function show(projectId: string, count = 4) {
  const sources = sourcesOf(count);
  const files = Object.fromEntries(
    Object.entries(sources).map(([path, source]) => [path, analyzeProjectFile(path, source, 1)]),
  );
  const snapshot = assembleProjectIntelligence({
    identity: { projectId, projectRevision: 1, requestGeneration: 1 },
    files,
    knownFiles: Object.keys(sources),
    mainDocument: "main.tex",
    stats: {
      fileCount: 2,
      characterCount: 0,
      parsedFileCount: 2,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
  act(() => {
    useFilesStore.setState({
      projectId,
      projectName: "Paper",
      activePath: "main.tex",
      files: { "main.tex": { content: sources["main.tex"], dirty: false } },
    });
    useIndexStore.setState({
      intelligenceState: {
        status: "success",
        identity: snapshot.identity,
        data: snapshot,
        stale: false,
      },
    });
  });
}

beforeEach(() => {
  show("refs-a");
});

afterEach(() => {
  useReferencesStore.getState().clear();
  useIndexStore.getState().reset();
  useFilesStore.setState({
    projectId: null,
    projectName: "",
    activePath: null,
    tree: [],
    files: {},
  });
});

const tab = (name: RegExp) => screen.getByRole("tab", { name });
const filterBox = (name: string) => screen.getByRole("searchbox", { name });

describe("ReferencesPanel view memory", () => {
  it("keeps the view and the filter after the panel is closed and reopened", async () => {
    const user = userEvent.setup();
    const first = render(<ReferencesPanel />);
    await user.click(tab(/^Symbols/u));
    await user.type(filterBox("Filter symbols"), "sec:00");
    first.unmount();

    render(<ReferencesPanel />);

    expect(tab(/^Symbols/u)).toHaveAttribute("aria-selected", "true");
    expect(filterBox("Filter symbols")).toHaveValue("sec:00");
  });

  it("starts another project on the default view and restores the first project's on return", async () => {
    const user = userEvent.setup();
    const first = render(<ReferencesPanel />);
    await user.click(tab(/^Symbols/u));
    await user.type(filterBox("Filter symbols"), "sec");
    first.unmount();

    show("refs-b");
    const second = render(<ReferencesPanel />);
    expect(tab(/^Citations/u)).toHaveAttribute("aria-selected", "true");
    expect(filterBox("Filter citations")).toHaveValue("");
    await user.type(filterBox("Filter citations"), "key");
    second.unmount();

    show("refs-a");
    const third = render(<ReferencesPanel />);
    expect(tab(/^Symbols/u)).toHaveAttribute("aria-selected", "true");
    expect(filterBox("Filter symbols")).toHaveValue("sec");
    third.unmount();

    show("refs-b");
    render(<ReferencesPanel />);
    expect(tab(/^Citations/u)).toHaveAttribute("aria-selected", "true");
    expect(filterBox("Filter citations")).toHaveValue("key");
  });

  it("swaps in the remembered view of a project opened while the panel stays mounted", async () => {
    const user = userEvent.setup();
    render(<ReferencesPanel />);
    await user.click(tab(/^Symbols/u));
    await user.type(filterBox("Filter symbols"), "sec");

    show("refs-b");
    expect(tab(/^Citations/u)).toHaveAttribute("aria-selected", "true");
    expect(filterBox("Filter citations")).toHaveValue("");

    show("refs-a");
    expect(tab(/^Symbols/u)).toHaveAttribute("aria-selected", "true");
    expect(filterBox("Filter symbols")).toHaveValue("sec");
  });

  it("does not jump back to results for a references query it already showed", async () => {
    const user = userEvent.setup();
    const query = {
      projectId: "refs-a",
      projectRevision: 1,
      requestGeneration: 1,
      mode: "references" as const,
      targetId: "none",
      title: "References to sec:000",
    };
    act(() => useReferencesStore.getState().show(query));
    const first = render(<ReferencesPanel />);
    expect(tab(/^References/u)).toHaveAttribute("aria-selected", "true");
    await user.click(tab(/^Citations/u));
    first.unmount();

    const second = render(<ReferencesPanel />);
    expect(tab(/^Citations/u)).toHaveAttribute("aria-selected", "true");
    second.unmount();

    act(() => useReferencesStore.getState().show({ ...query, title: "References to sec:001" }));
    render(<ReferencesPanel />);
    expect(tab(/^References/u)).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the branches the reader collapsed in each list", async () => {
    const user = userEvent.setup();
    const first = render(<ReferencesPanel />);
    const group = screen.getByText("refs.bib").closest('[role="treeitem"]');
    const collapse = group?.querySelector<HTMLButtonElement>('button[aria-label="Collapse"]');
    if (!collapse) throw new Error("expected a collapse control on refs.bib");
    await user.click(collapse);
    expect(screen.queryByText("key000")).not.toBeInTheDocument();
    first.unmount();

    render(<ReferencesPanel />);

    expect(screen.getByText("refs.bib")).toBeInTheDocument();
    expect(screen.queryByText("key000")).not.toBeInTheDocument();
  });
});

describe("ReferencesPanel scroll memory", () => {
  let geometry: ScrollGeometry;

  beforeEach(() => {
    show("refs-a", 200);
    geometry = installScrollGeometry({
      isScroller: (element) =>
        element.classList.contains("overflow-auto") && element.classList.contains("isolate"),
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

  it("lands exactly where the list was left, per view", async () => {
    const user = userEvent.setup();
    const first = render(<ReferencesPanel />);
    geometry.scrollTo(scroller(), 2_800);
    expect(screen.getByText("key098")).toBeInTheDocument();
    await user.click(tab(/^Symbols/u));
    expect(scroller().scrollTop).toBe(0);
    geometry.scrollTo(scroller(), 840);
    first.unmount();

    render(<ReferencesPanel />);
    expect(tab(/^Symbols/u)).toHaveAttribute("aria-selected", "true");
    expect(scroller().scrollTop).toBe(840);
    expect(geometry.pendingFrames()).toBe(0);

    await user.click(tab(/^Citations/u));
    expect(scroller().scrollTop).toBe(2_800);
    expect(screen.getByText("key098")).toBeInTheDocument();
  });

  it("shows a new filter's results from the top of the list", () => {
    render(<ReferencesPanel />);
    geometry.scrollTo(scroller(), 2_800);

    fireEvent.change(filterBox("Filter citations"), { target: { value: "key1" } });

    expect(screen.getAllByText("key100").length).toBeGreaterThan(0);
    expect(scroller().scrollTop).toBe(0);
  });

  it("keeps each project's filtered position when the project changes while open", () => {
    render(<ReferencesPanel />);
    fireEvent.change(filterBox("Filter citations"), { target: { value: "key" } });
    geometry.scrollTo(scroller(), 1_400);
    show("refs-b", 200);
    fireEvent.change(filterBox("Filter citations"), { target: { value: "key1" } });
    geometry.scrollTo(scroller(), 700);

    show("refs-a", 200);
    expect(filterBox("Filter citations")).toHaveValue("key");
    expect(scroller().scrollTop).toBe(1_400);

    show("refs-b", 200);
    expect(filterBox("Filter citations")).toHaveValue("key1");
    expect(scroller().scrollTop).toBe(700);
  });

  it("keeps a separate position for each project", () => {
    const first = render(<ReferencesPanel />);
    geometry.scrollTo(scroller(), 2_800);
    first.unmount();

    show("refs-b", 200);
    const second = render(<ReferencesPanel />);
    expect(scroller().scrollTop).toBe(0);
    geometry.scrollTo(scroller(), 560);
    second.unmount();

    show("refs-a", 200);
    const third = render(<ReferencesPanel />);
    expect(scroller().scrollTop).toBe(2_800);
    third.unmount();

    show("refs-b", 200);
    render(<ReferencesPanel />);
    expect(scroller().scrollTop).toBe(560);
  });
});
