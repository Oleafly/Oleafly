// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "@/lib/project-intelligence/assemble";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { useReferencesStore } from "@/store/references";
import { Outline } from "./Outline";
import { ReferencesPanel } from "./ReferencesPanel";

vi.mock("@/lib/project-intelligence/navigation", () => ({
  navigateToProjectRange: vi.fn(),
}));

function staleSnapshot() {
  const identity = {
    projectId: "project",
    projectRevision: 1,
    requestGeneration: 1,
  };
  const sources = {
    "main.tex": String.raw`\section{STALE STRUCTURE}`,
    "refs.bib": "@misc{STALE-CITATION, title={Stale title}}",
  };
  const files = Object.fromEntries(
    Object.entries(sources).map(([path, source]) => [
      path,
      analyzeProjectFile(path, source, 1),
    ]),
  );
  return assembleProjectIntelligence({
    identity,
    files,
    knownFiles: Object.keys(sources),
    mainDocument: "main.tex",
    stats: {
      fileCount: 2,
      characterCount: Object.values(sources).join("").length,
      parsedFileCount: 2,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
}

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

describe("navigation panels reject stale source ranges", () => {
  it("shows pending state instead of stale structure, citations, or actions", () => {
    const snapshot = staleSnapshot();
    useFilesStore.setState({
      projectId: "project",
      projectName: "Paper",
      activePath: "main.tex",
      files: {
        "main.tex": {
          content: String.raw`\section{Current}`,
          dirty: true,
        },
      },
    });
    useIndexStore.setState({
      intelligenceState: {
        status: "running",
        identity: {
          projectId: "project",
          projectRevision: 2,
          requestGeneration: 2,
        },
        data: snapshot,
        stale: true,
      },
    });

    const outline = render(<Outline />);
    expect(
      screen.getByText("Mapping project structure"),
    ).toBeInTheDocument();
    expect(screen.queryByText("STALE STRUCTURE")).toBeNull();
    outline.unmount();

    render(<ReferencesPanel />);
    expect(
      screen.getByText("Indexing project intelligence"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/STALE-CITATION/u)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /STALE/u }),
    ).toBeNull();
  });

  it("shows the current failure instead of retained browse data", () => {
    const snapshot = staleSnapshot();
    useFilesStore.setState({
      projectId: "project",
      activePath: "main.tex",
    });
    useIndexStore.setState({
      intelligenceState: {
        status: "error",
        identity: {
          projectId: "project",
          projectRevision: 2,
          requestGeneration: 2,
        },
        data: snapshot,
        stale: true,
        failure: {
          name: "ProjectIntelligenceError",
          message: "Current analysis failed safely.",
          retryable: true,
        },
      },
    });

    const outline = render(<Outline />);
    expect(
      screen.getByText("Structure could not be built"),
    ).toBeInTheDocument();
    expect(screen.queryByText("STALE STRUCTURE")).toBeNull();
    outline.unmount();

    render(<ReferencesPanel />);
    expect(
      screen.getByText("Project analysis failed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Current analysis failed safely."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/STALE-CITATION/u)).toBeNull();
  });
});

describe("reference library import", () => {
  it("opens from the Citations tab instead of the AI Assistant", () => {
    const snapshot = assembleProjectIntelligence({
      identity: {
        projectId: "project",
        projectRevision: 1,
        requestGeneration: 1,
      },
      files: {
        "main.tex": analyzeProjectFile(
          "main.tex",
          String.raw`\documentclass{article}\begin{document}Paper\end{document}`,
          1,
        ),
      },
      knownFiles: ["main.tex"],
      mainDocument: "main.tex",
      stats: {
        fileCount: 1,
        characterCount: 58,
        parsedFileCount: 1,
        reusedFileCount: 0,
        durationMs: 0,
      },
    });
    useFilesStore.setState({
      projectId: "project",
      projectName: "Paper",
      activePath: "main.tex",
      files: {
        "main.tex": {
          content: String.raw`\documentclass{article}\begin{document}Paper\end{document}`,
          dirty: false,
        },
      },
    });
    useIndexStore.setState({
      intelligenceState: {
        status: "success",
        identity: snapshot.identity,
        data: snapshot,
        stale: false,
      },
    });

    render(<ReferencesPanel />);

    expect(
      screen.getByRole("button", { name: "Import references" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import reference library" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import references" }));
    expect(
      screen.getByRole("dialog", { name: "Import reference library" }),
    ).toBeInTheDocument();
  });
});
