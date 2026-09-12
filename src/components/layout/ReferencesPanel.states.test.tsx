// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigateToProjectRange: vi.fn(),
  runCiteOleaflyAction: vi.fn(),
}));

vi.mock("@/lib/project-intelligence/navigation", () => ({
  navigateToProjectRange: mocks.navigateToProjectRange,
}));
vi.mock("@/features/cite-oleafly", () => ({
  runCiteOleaflyAction: mocks.runCiteOleaflyAction,
}));
vi.mock("@/components/layout/ImportReferenceLibraryDialog", () => ({
  ImportReferenceLibraryDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="import-dialog" /> : null,
}));

import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "@/lib/project-intelligence/assemble";
import type { ProjectIntelligenceState } from "@/lib/project-intelligence/types";
import enReferences from "@/i18n/locales/en/references.json" with { type: "json" };
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { useReferencesStore } from "@/store/references";
import { ReferencesPanel } from "./ReferencesPanel";

const copy = enReferences;

const SOURCES = {
  "main.tex": String.raw`\section{Overview}
\label{sec:overview}
\cite{smith2020}`,
  "refs.bib": "@article{smith2020, title={A title}, author={Smith}, year={2020}, journal={J}}",
};

function snapshot(sources: Record<string, string> = SOURCES) {
  const files = Object.fromEntries(
    Object.entries(sources).map(([path, source]) => [
      path,
      analyzeProjectFile(path, source, 1),
    ]),
  );
  return assembleProjectIntelligence({
    identity: { projectId: "project", projectRevision: 1, requestGeneration: 1 },
    files,
    knownFiles: Object.keys(sources),
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

function openProject() {
  useFilesStore.setState({
    projectId: "project",
    projectName: "Paper",
    activePath: "main.tex",
    files: {},
    tree: [],
  } as unknown as ReturnType<typeof useFilesStore.getState>);
}

function ready(sources?: Record<string, string>) {
  const data = snapshot(sources);
  openProject();
  setState({ status: "success", identity: data.identity, data, stale: false });
  return data;
}

beforeEach(() => {
  mocks.navigateToProjectRange.mockClear();
  mocks.runCiteOleaflyAction.mockClear();
  useReferencesStore.setState({ query: null, focusRequest: 0 });
  openProject();
  setState({});
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

describe("ReferencesPanel unavailable states", () => {
  it("asks for a project first", () => {
    useFilesStore.setState({ projectId: null });
    render(<ReferencesPanel />);
    expect(screen.getByText(copy.unavailable.noProject.title)).toBeInTheDocument();
  });

  it("reports the indexing pass", () => {
    setState({ status: "running" });
    render(<ReferencesPanel />);
    expect(screen.getByText(copy.unavailable.indexing.title)).toBeInTheDocument();
    expect(screen.getByLabelText(copy.panel.ariaLabel)).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("reports an unsupported project", () => {
    setState({ status: "unsupported" });
    render(<ReferencesPanel />);
    expect(
      screen.getByText(copy.unavailable.unsupported.title),
    ).toBeInTheDocument();
    expect(
      screen.getByText(copy.unavailable.unsupported.detail),
    ).toBeInTheDocument();
  });

  it("reports an unavailable service", () => {
    setState({ status: "unavailable" });
    render(<ReferencesPanel />);
    expect(screen.getByText(copy.unavailable.offline.title)).toBeInTheDocument();
    expect(screen.getByText(copy.unavailable.offline.detail)).toBeInTheDocument();
  });

  it("waits for a snapshot that has not arrived", () => {
    setState({ status: "success", identity: null, data: null });
    render(<ReferencesPanel />);
    expect(screen.getByText(copy.unavailable.waiting.title)).toBeInTheDocument();
  });
});

describe("ReferencesPanel query results", () => {
  it("asks for a query before showing results", async () => {
    ready();
    render(<ReferencesPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: copy.tabs.results }));
    expect(await screen.findByText(copy.query.none.title)).toBeInTheDocument();
  });

  it("shows the definitions and occurrences of a reference query", async () => {
    const data = ready();
    const definition = data.definitions.find(
      (entry) => entry.name === "sec:overview",
    );
    if (!definition) throw new Error("fixture has no label definition");
    useReferencesStore.getState().show({
      projectId: "project",
      projectRevision: 1,
      requestGeneration: 1,
      mode: "references",
      targetId: definition.id,
      title: "sec:overview",
    });
    render(<ReferencesPanel />);
    expect(
      await screen.findByRole("tab", { name: copy.tabs.results, selected: true }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("sec:overview").length).toBeGreaterThan(0);
    const user = userEvent.setup();
    await user.click(
      screen.getByLabelText(copy.panel.clearQuery),
    );
    expect(await screen.findByText(copy.query.none.title)).toBeInTheDocument();
  });

  it("expires a query from an older revision", async () => {
    ready();
    useReferencesStore.getState().show({
      projectId: "project",
      projectRevision: 0,
      requestGeneration: 0,
      mode: "references",
      targetId: "gone",
      title: "old",
    });
    render(<ReferencesPanel />);
    expect(await screen.findByText(copy.query.expired.title)).toBeInTheDocument();
  });

  it("says a current query matched no location", async () => {
    ready();
    useReferencesStore.getState().show({
      projectId: "project",
      projectRevision: 1,
      requestGeneration: 1,
      mode: "references",
      targetId: "missing-id",
      title: "missing",
    });
    render(<ReferencesPanel />);
    expect(
      await screen.findByText(copy.query.noLocations.title),
    ).toBeInTheDocument();
  });
});

describe("ReferencesPanel citations and symbols", () => {
  it("navigates to the citation the reader activates", async () => {
    ready();
    render(<ReferencesPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByText("smith2020"));
    await waitFor(() => expect(mocks.navigateToProjectRange).toHaveBeenCalled());
    expect(mocks.navigateToProjectRange.mock.calls[0][0]).toMatchObject({
      source: "references",
    });
  });

  it("says no citation matches the filter", async () => {
    ready();
    render(<ReferencesPanel />);
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("searchbox", { name: copy.filter.ariaLabelCitations }),
      "zzzq",
    );
    expect(
      await screen.findByText(copy.filter.noCitation.replace("{{query}}", "zzzq")),
    ).toBeInTheDocument();
  });

  it("offers an import when the project has no bibliography", async () => {
    ready({ "main.tex": String.raw`\section{Overview}` });
    render(<ReferencesPanel />);
    expect(screen.getByText(copy.empty.citations.title)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: copy.import.title }));
    expect(await screen.findByTestId("import-dialog")).toBeInTheDocument();
  });

  it("opens the import dialog from the header action", async () => {
    ready();
    render(<ReferencesPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(copy.panel.importAriaLabel));
    expect(await screen.findByTestId("import-dialog")).toBeInTheDocument();
  });

  it("says no symbol matches the filter", async () => {
    ready();
    render(<ReferencesPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /^Symbols/ }));
    await user.type(
      screen.getByRole("searchbox", { name: copy.filter.ariaLabelSymbols }),
      "zzzq",
    );
    expect(
      await screen.findByText(copy.filter.noSymbol.replace("{{query}}", "zzzq")),
    ).toBeInTheDocument();
  });

  it("says a project with no symbols has none", async () => {
    ready({ "main.tex": "Plain prose with no structure." });
    render(<ReferencesPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /^Symbols/ }));
    expect(await screen.findByText(copy.empty.symbols.title)).toBeInTheDocument();
  });

  it("offers the Oleafly citation row under the citations tab", async () => {
    ready();
    render(<ReferencesPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("cite-oleafly-row"));
    expect(mocks.runCiteOleaflyAction).toHaveBeenCalled();
  });

  it("notes a stale analysis", () => {
    const data = snapshot();
    openProject();
    setState({ status: "success", identity: data.identity, data, stale: true });
    render(<ReferencesPanel />);
    expect(screen.getAllByText(copy.notice.stale).length).toBeGreaterThan(0);
  });

  it("notes a partial analysis", () => {
    const data = snapshot();
    openProject();
    setState({ status: "partial", identity: data.identity, data, stale: false });
    render(<ReferencesPanel />);
    expect(screen.getAllByText(copy.notice.partial).length).toBeGreaterThan(0);
  });
});
