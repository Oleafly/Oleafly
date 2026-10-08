// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/project-intelligence/navigation", () => ({
  navigateToProjectRange: vi.fn(),
}));
vi.mock("@/features/cite-oleafly", () => ({
  runCiteOleaflyAction: vi.fn(),
}));

import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "@/lib/project-intelligence/assemble";
import type {
  ProjectIntelligenceSnapshot,
  ProjectIntelligenceState,
} from "@/lib/project-intelligence/types";
import enReferences from "@/i18n/locales/en/references.json" with { type: "json" };
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { useReferencesStore } from "@/store/references";
import { CleanLibraryDialog } from "./CleanLibraryDialog";
import { ReferencesPanel } from "./ReferencesPanel";

const SOURCES = {
  "main.tex": String.raw`\section{Overview}
\label{sec:overview}
\cite{smith2020}
\bibliography{refs}`,
  "refs.bib": "@article{smith2020, title={A title}, author={Smith}, year={2020}, journal={J}}",
};

function snapshot(): ProjectIntelligenceSnapshot {
  const files = Object.fromEntries(
    Object.entries(SOURCES).map(([path, source]) => [path, analyzeProjectFile(path, source, 1)]),
  );
  return assembleProjectIntelligence({
    identity: { projectId: "project", projectRevision: 1, requestGeneration: 1 },
    files,
    knownFiles: Object.keys(SOURCES),
    mainDocument: "main.tex",
    stats: {
      fileCount: Object.keys(files).length,
      characterCount: 0,
      parsedFileCount: Object.keys(files).length,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
}

function setIntelligence(state: ProjectIntelligenceState) {
  useIndexStore.setState({ intelligenceState: state } as unknown as ReturnType<
    typeof useIndexStore.getState
  >);
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

function typeInMain(text: string) {
  useFilesStore.setState((state) => ({
    files: { ...state.files, "main.tex": { content: text, dirty: true } },
  }));
}

beforeEach(() => {
  useReferencesStore.setState({ query: null, focusRequest: 0 });
  useFilesStore.setState({
    projectId: "project",
    projectName: "Paper",
    activePath: "main.tex",
    mainDoc: "main.tex",
    files: { "main.tex": { content: SOURCES["main.tex"], dirty: false } },
    tree: [
      { path: "main.tex", is_dir: false },
      { path: "refs.bib", is_dir: false },
    ],
  } as unknown as ReturnType<typeof useFilesStore.getState>);
});

afterEach(() => {
  cleanup();
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

describe("References panel render cost while typing", () => {
  it("does not re-render for edits that only advance the running analysis", () => {
    const data = snapshot();
    setIntelligence({ status: "success", identity: data.identity, data, stale: false } as ProjectIntelligenceState);
    let commits = 0;
    render(
      <Profiler id="references" onRender={() => { commits += 1; }}>
        <ReferencesPanel />
      </Profiler>,
    );
    act(() => setIntelligence(runningEdit(data, 2)));
    expect(screen.getByText(enReferences.unavailable.indexing.title)).toBeInTheDocument();

    commits = 0;
    act(() => {
      typeInMain(`${SOURCES["main.tex"]} a`);
      setIntelligence(runningEdit(data, 3));
    });
    act(() => {
      typeInMain(`${SOURCES["main.tex"]} ab`);
      setIntelligence(runningEdit(data, 4));
    });
    expect(commits).toBe(0);
    expect(screen.getByText(enReferences.unavailable.indexing.title)).toBeInTheDocument();
  });

  it("still shows the accepted snapshot again once the analysis settles", () => {
    const data = snapshot();
    setIntelligence({ status: "success", identity: data.identity, data, stale: false } as ProjectIntelligenceState);
    render(<ReferencesPanel />);
    act(() => setIntelligence(runningEdit(data, 2)));
    const next = { ...data, identity: { projectId: "project", projectRevision: 2, requestGeneration: 2 } };
    act(() =>
      setIntelligence({ status: "success", identity: next.identity, data: next, stale: false } as ProjectIntelligenceState),
    );
    expect(screen.queryByText(enReferences.unavailable.indexing.title)).toBeNull();
    expect(screen.getByRole("tree")).toBeInTheDocument();
  });
});

describe("Clean library dialog render cost", () => {
  it("does not re-render while closed when the main document changes", () => {
    let commits = 0;
    render(
      <Profiler id="clean" onRender={() => { commits += 1; }}>
        <CleanLibraryDialog open={false} onClose={() => {}} />
      </Profiler>,
    );
    commits = 0;
    act(() => typeInMain(`${SOURCES["main.tex"]} edit`));
    act(() => typeInMain(`${SOURCES["main.tex"]} edit more`));
    expect(commits).toBe(0);
  });
});
