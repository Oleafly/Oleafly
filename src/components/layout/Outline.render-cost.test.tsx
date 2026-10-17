// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/project-intelligence/navigation", () => ({
  navigateToProjectRange: vi.fn(),
}));

import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "@/lib/project-intelligence/assemble";
import type {
  ProjectIntelligenceSnapshot,
  ProjectIntelligenceState,
} from "@/lib/project-intelligence/types";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { Outline } from "./Outline";

function snapshot(): ProjectIntelligenceSnapshot {
  const sources = {
    "main.tex": String.raw`\section{Introduction}
\label{sec:intro}`,
  };
  const files = Object.fromEntries(
    Object.entries(sources).map(([path, source]) => [path, analyzeProjectFile(path, source, 1)]),
  );
  return assembleProjectIntelligence({
    identity: { projectId: "project", projectRevision: 1, requestGeneration: 1 },
    files,
    knownFiles: Object.keys(sources),
    mainDocument: "main.tex",
    stats: { fileCount: 1, characterCount: 0, parsedFileCount: 1, reusedFileCount: 0, durationMs: 0 },
  });
}

function runningEdit(data: ProjectIntelligenceSnapshot, revision: number): ProjectIntelligenceState {
  return {
    status: "running",
    identity: { projectId: "project", projectRevision: revision, requestGeneration: revision },
    data,
    stale: true,
    currentFileFallbackAllowed: false,
    reason: { key: "retainedStale" },
  } as ProjectIntelligenceState;
}

function setIntelligence(state: ProjectIntelligenceState) {
  useIndexStore.setState({ intelligenceState: state } as unknown as ReturnType<
    typeof useIndexStore.getState
  >);
}

beforeEach(() => {
  useFilesStore.setState({
    projectId: "project",
    activePath: "main.tex",
  } as unknown as ReturnType<typeof useFilesStore.getState>);
});

afterEach(() => {
  cleanup();
  useIndexStore.getState().reset();
  useFilesStore.setState({ projectId: null, activePath: null });
});

describe("Structure render cost while typing", () => {
  it.each([
    ["expanded", false],
    ["collapsed", true],
  ])("does not re-render when %s and an edit only advances the analysis", (_label, collapsed) => {
    const data = snapshot();
    setIntelligence(runningEdit(data, 2));
    let commits = 0;
    render(
      <Profiler id="structure" onRender={() => { commits += 1; }}>
        <Outline collapsed={collapsed} />
      </Profiler>,
    );
    commits = 0;
    act(() => setIntelligence(runningEdit(data, 3)));
    act(() => setIntelligence(runningEdit(data, 4)));
    expect(commits).toBe(0);
  });

  it("does not re-render when the active file changes while it shows a tree", () => {
    const data = snapshot();
    setIntelligence({ status: "success", identity: data.identity, data, stale: false } as ProjectIntelligenceState);
    let commits = 0;
    render(
      <Profiler id="structure" onRender={() => { commits += 1; }}>
        <Outline />
      </Profiler>,
    );
    expect(screen.getByRole("tree")).toBeInTheDocument();
    commits = 0;
    act(() => useFilesStore.setState({ activePath: "chapter.tex" }));
    expect(commits).toBe(0);
  });
});
