// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { Outline } from "./Outline";

const copy = enWorkspace.structure;

function snapshot(projectId = "project", projectRevision = 1) {
  const sources = {
    "main.tex": String.raw`\section{Introduction}
\label{sec:intro}
\include{chapter}`,
    "chapter.tex": String.raw`\section{Method}`,
    "unlinked.tex": String.raw`\section{Detached}`,
  };
  const files = Object.fromEntries(
    Object.entries(sources).map(([path, source]) => [
      path,
      analyzeProjectFile(path, source, 1),
    ]),
  );
  return assembleProjectIntelligence({
    identity: { projectId, projectRevision, requestGeneration: 1 },
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
}

function setState(state: Partial<ProjectIntelligenceState>) {
  useIndexStore.setState({
    intelligenceState: {
      status: "not_run",
      identity: null,
      data: null,
      stale: false,
      ...state,
    },
  } as unknown as ReturnType<typeof useIndexStore.getState>);
}

function openProject(projectId = "project") {
  useFilesStore.setState({
    projectId,
    projectName: "Paper",
    activePath: "main.tex",
    files: {},
    tree: [],
  } as unknown as ReturnType<typeof useFilesStore.getState>);
}

function withSnapshot(
  status: "success" | "partial" = "success",
  projectId = "project",
  projectRevision = 1,
) {
  const data = snapshot(projectId, projectRevision);
  openProject(projectId);
  setState({ status, identity: data.identity, data, stale: false });
  return data;
}

beforeEach(() => {
  navigateToProjectRange.mockClear();
  openProject();
  setState({});
});

afterEach(() => {
  cleanup();
  useIndexStore.getState().reset();
  useFilesStore.setState({
    projectId: null,
    projectName: "",
    activePath: null,
    tree: [],
    files: {},
  });
});

describe("Outline unavailable states", () => {
  it("asks for a project first", () => {
    useFilesStore.setState({ projectId: null });
    render(<Outline />);
    expect(screen.getByText(copy.unavailable.noProject.title)).toBeInTheDocument();
    expect(screen.getByText(copy.unavailable.noProject.detail)).toBeInTheDocument();
  });

  it("asks for an open source file", () => {
    useFilesStore.setState({ activePath: null });
    render(<Outline />);
    expect(screen.getByText(copy.unavailable.noSource.title)).toBeInTheDocument();
  });

  it("reports the mapping pass", () => {
    setState({ status: "running" });
    render(<Outline />);
    expect(screen.getByText(copy.unavailable.mapping.title)).toBeInTheDocument();
    expect(
      screen.getByLabelText(copy.ariaLabel),
    ).toHaveAttribute("aria-busy", "true");
  });

  it("reports an unsupported project with its reason", () => {
    setState({ status: "unsupported" });
    render(<Outline />);
    expect(
      screen.getByText(copy.unavailable.unsupported.title),
    ).toBeInTheDocument();
    expect(
      screen.getByText(copy.unavailable.unsupported.detail),
    ).toBeInTheDocument();
  });

  it("reports an unavailable service", () => {
    setState({ status: "unavailable" });
    render(<Outline />);
    expect(screen.getByText(copy.unavailable.offline.title)).toBeInTheDocument();
    expect(screen.getByText(copy.unavailable.offline.detail)).toBeInTheDocument();
  });

  it("reports a failed analysis with its message", () => {
    setState({
      status: "error",
      failure: {
        name: "ProjectIntelligenceError",
        message: "Analysis failed safely.",
        retryable: true,
      },
    });
    render(<Outline />);
    expect(screen.getByText(copy.unavailable.failed.title)).toBeInTheDocument();
    expect(screen.getByText("Analysis failed safely.")).toBeInTheDocument();
  });

  it("waits for a revision whose snapshot has not arrived", () => {
    setState({ status: "success", identity: null, data: null });
    render(<Outline />);
    expect(screen.getByText(copy.unavailable.waiting.title)).toBeInTheDocument();
  });
});

describe("Outline with a snapshot", () => {
  it("lists the structure and counts it", () => {
    withSnapshot();
    render(<Outline />);
    expect(screen.getByText("main.tex")).toBeInTheDocument();
    const count = screen.getByRole("status");
    expect(count.getAttribute("aria-label")).toMatch(
      new RegExp(copy.itemCount_other.split("{{count}}")[1].trim()),
    );
  });

  it("collapses and expands from its header", async () => {
    withSnapshot();
    render(<Outline />);
    const user = userEvent.setup();
    const header = screen.getByRole("button", { expanded: true });
    await user.click(header);
    await waitFor(() =>
      expect(
        screen.queryByLabelText(copy.filterLabel),
      ).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { expanded: false }));
    expect(await screen.findByLabelText(copy.filterLabel)).toBeInTheDocument();
  });

  it("keeps the shared section header connected to its hidden content", async () => {
    withSnapshot();
    render(<Outline />);
    const user = userEvent.setup();
    const section = screen.getByTestId("project-structure");
    const header = screen.getByRole("button", { name: /^Structure/, expanded: true });
    const content = document.getElementById("project-structure-content");

    expect(section).toHaveAttribute("aria-label", copy.ariaLabel);
    expect(header).toHaveAttribute("aria-controls", "project-structure-content");
    expect(content).not.toHaveAttribute("hidden");

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(content).toHaveAttribute("hidden");
  });

  it("expands and collapses every structure branch from the header controls", async () => {
    withSnapshot();
    render(<Outline />);
    const user = userEvent.setup();

    const bulkToggle = screen.getByRole("button", { name: copy.collapseAll });
    await user.click(bulkToggle);
    await waitFor(() => expect(screen.queryByText("Introduction")).not.toBeInTheDocument());

    const expandAll = screen.getByRole("button", { name: copy.expandAll });
    expect(expandAll).toBe(bulkToggle);
    await user.click(expandAll);
    expect(await screen.findByText("Introduction")).toBeInTheDocument();
    expect(screen.getByText("Detached")).toBeInTheDocument();
  });

  it("disables bulk expansion while filtering", async () => {
    withSnapshot();
    render(<Outline />);
    const user = userEvent.setup();
    const bulkToggle = await screen.findByRole("button", {
      name: copy.collapseAll,
    });
    await user.type(screen.getByLabelText(copy.filterLabel), "intro");
    expect(bulkToggle).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: copy.expandAll }),
    ).not.toBeInTheDocument();
  });

  it("clears filtering and ignores an old bulk command when the project changes", async () => {
    withSnapshot();
    render(<Outline />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: copy.collapseAll }));
    await waitFor(() => expect(screen.queryByText("Introduction")).not.toBeInTheDocument());
    await user.type(screen.getByLabelText(copy.filterLabel), "intro");
    expect(screen.getByLabelText(copy.filterLabel)).toHaveValue("intro");

    const replacement = snapshot("replacement-project");
    useFilesStore.setState({ projectId: "replacement-project" });
    setState({
      status: "success",
      identity: replacement.identity,
      data: replacement,
      stale: false,
    });

    await waitFor(() =>
      expect(screen.getByLabelText(copy.filterLabel)).toHaveValue(""),
    );
    expect(await screen.findByText("Introduction")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: copy.collapseAll }),
    ).toBeEnabled();
  });

  it("keeps a manual tree override across a same-project snapshot revision", async () => {
    withSnapshot();
    render(<Outline />);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: copy.collapseAll }),
    );
    await user.click(
      await screen.findByRole("button", { name: copy.expandAll }),
    );
    expect(await screen.findByText("sec:intro")).toBeInTheDocument();
    const introduction = screen.getByText("Introduction").closest('[role="treeitem"]');
    const collapseIntroduction = introduction?.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse"]',
    );
    if (!collapseIntroduction) throw new Error("expected the Introduction collapse control");
    await user.click(collapseIntroduction);
    await waitFor(() => expect(screen.queryByText("sec:intro")).not.toBeInTheDocument());

    const revision = snapshot("project", 2);
    setState({
      status: "success",
      identity: revision.identity,
      data: revision,
      stale: false,
    });

    expect(screen.getByText("Introduction")).toBeInTheDocument();
    expect(screen.queryByText("sec:intro")).not.toBeInTheDocument();
  });

  it("reports a controlled collapse to its owner", async () => {
    withSnapshot();
    const onCollapsedChange = vi.fn();
    render(<Outline collapsed={false} onCollapsedChange={onCollapsedChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { expanded: true }));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("says when the filter matches nothing", async () => {
    withSnapshot();
    render(<Outline />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(copy.filterLabel), "zzzq");
    expect(
      await screen.findByText(copy.noMatch.replace("{{query}}", "zzzq")),
    ).toBeInTheDocument();
  });

  it("navigates to the range behind the node the reader activates", async () => {
    withSnapshot();
    render(<Outline />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Introduction"));
    await waitFor(() => expect(navigateToProjectRange).toHaveBeenCalled());
    expect(navigateToProjectRange.mock.calls[0][0]).toMatchObject({
      path: "main.tex",
      source: "outline",
    });
  });

  it("shows a muted in-app tooltip for a partial map", async () => {
    withSnapshot("partial");
    render(<Outline />);
    expect(screen.getByText(copy.notice.partial)).toBeInTheDocument();
    const info = document.querySelector("svg.lucide-info");
    if (!info?.parentElement) throw new Error("expected the Structure info icon");
    expect(info.parentElement).toHaveClass("text-muted-foreground");
    expect(info.parentElement).not.toHaveAttribute("title");

    const user = userEvent.setup();
    await user.hover(info);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(copy.notice.partial);
  });

  it("notes a stale map", () => {
    const data = snapshot();
    openProject();
    setState({ status: "success", identity: data.identity, data, stale: true });
    render(<Outline />);
    expect(screen.getByText(copy.notice.stale)).toBeInTheDocument();
  });

  it("starts collapsed when the layout asks for it", () => {
    withSnapshot();
    render(<Outline defaultCollapsed />);
    expect(screen.queryByLabelText(copy.filterLabel)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { expanded: false })).toBeInTheDocument();
  });
});
