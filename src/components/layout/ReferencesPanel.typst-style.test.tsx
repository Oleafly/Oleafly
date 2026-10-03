// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "@/lib/project-intelligence/assemble";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { useReferencesStore } from "@/store/references";
import { ReferencesPanel } from "./ReferencesPanel";

vi.mock("@/lib/project-intelligence/navigation", () => ({
  navigateToProjectRange: vi.fn(),
}));

function install(sources: Record<string, string>, mainDocument: string, profile: "typst" | "latex") {
  const files = Object.fromEntries(
    Object.entries(sources).map(([path, source]) => [path, analyzeProjectFile(path, source, 1)]),
  );
  const snapshot = assembleProjectIntelligence({
    identity: { projectId: "project", projectRevision: 1, requestGeneration: 1 },
    files,
    knownFiles: Object.keys(sources),
    mainDocument,
    stats: {
      fileCount: Object.keys(sources).length,
      characterCount: 0,
      parsedFileCount: Object.keys(sources).length,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
  const engine = useFilesStore.getState().engine;
  useFilesStore.setState({
    projectId: "project",
    projectName: "Paper",
    mainDoc: mainDocument,
    activePath: mainDocument,
    tree: Object.keys(sources).map((path) => ({ path, name: path, is_dir: false }) as never),
    files: { [mainDocument]: { content: sources[mainDocument], dirty: false } },
    engine: {
      ...engine,
      id: profile,
      capabilities: { ...engine.capabilities, formatting_profile: profile },
      typst_resolved: profile === "typst" ? { version: "0.15.1", source: "bundled" } : null,
    },
  });
  useIndexStore.setState({
    texts: { ...sources },
    intelligenceState: { status: "success", identity: snapshot.identity, data: snapshot, stale: false },
  });
}

afterEach(() => {
  cleanup();
  useReferencesStore.getState().clear();
  useIndexStore.getState().reset();
  useFilesStore.setState({ projectId: null, projectName: "", activePath: null, tree: [], files: {} });
});

describe("ReferencesPanel citation style picker", () => {
  it("shows the Typst citation style beside Cite Oleafly", () => {
    install(
      {
        "main.typ": 'See @smith2020.\n#bibliography("refs.bib", style: "apa")\n',
        "refs.bib": "@article{smith2020, title={A title}, author={Smith}}",
      },
      "main.typ",
      "typst",
    );
    render(<ReferencesPanel />);
    expect(screen.getByTestId("typst-style-picker")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Citation style/ })).toHaveTextContent("apa");
    expect(screen.getByTestId("cite-oleafly-row")).toBeInTheDocument();
  });

  it("keeps the picker out of LaTeX projects", () => {
    install(
      {
        "main.tex": String.raw`\cite{smith2020}\bibliography{refs}`,
        "refs.bib": "@article{smith2020, title={A title}, author={Smith}}",
      },
      "main.tex",
      "latex",
    );
    render(<ReferencesPanel />);
    expect(screen.queryByTestId("typst-style-picker")).not.toBeInTheDocument();
    expect(screen.getByTestId("cite-oleafly-row")).toBeInTheDocument();
  });
});
