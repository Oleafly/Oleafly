// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import type { TypstDocumentInsightsResult } from "@/features/typst-insights";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  success: vi.fn(),
  log: vi.fn(),
  readFile: vi.fn(),
  refreshAux: vi.fn(),
  texts: {} as Record<string, string>,
  files: {
    projectId: "paper" as string | null,
    mainDoc: "main.typ",
    files: {},
    engine: { id: "typst", source_format: "typst", capabilities: { supports_offline: true } } as {
      id?: string;
      source_format?: string;
      capabilities: { supports_offline: boolean };
    },
  },
  checkpoint: null as null | { projectId: string; mainDocument: string; outputId: string },
  current: false,
  numbers: {} as Record<string, { number: string; page: string }>,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/open-location", () => ({ openProjectLocation: mocks.open }));
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.success } }));
vi.mock("@/lib/log", () => ({ logError: mocks.log }));
vi.mock("@/lib/tauri", () => ({ readFileContent: mocks.readFile }));
vi.mock("@/store/files", () => ({
  useFilesStore: Object.assign((select: (value: typeof mocks.files) => unknown) => select(mocks.files), { getState: () => mocks.files }),
}));
vi.mock("@/store/project-index", () => ({ useIndexStore: { getState: () => ({ texts: mocks.texts }) } }));
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: () => ({ offline: false }) } }));
vi.mock("@/lib/tex-root", () => ({ resolveEffectiveMainDoc: () => ({ mainDoc: mocks.files.mainDoc }) }));
vi.mock("@/store/compile", () => ({
  useCompileStore: { getState: () => ({ lastCompileCheckpoint: mocks.checkpoint }) },
  isCompileCheckpointCurrent: () => mocks.current,
}));
vi.mock("@/lib/aux-numbers", () => ({
  refreshAuxNumbers: mocks.refreshAux,
  auxNumberFor: (label: string) => mocks.numbers[label] ?? null,
}));

import { DocumentInsightsDialog } from "./DocumentInsightsDialog";

const MAIN = [
  '#set document(title: "Creep", author: ("A. Author", "B. Author"), keywords: ("steel", "creep"))',
  "= Introduction <sec:intro>",
  "See @smith. // TODO: expand",
  "#figure(image(\"a.png\"), caption: [Rig]) <fig:rig>",
  "",
].join("\n");

const READY: TypstDocumentInsightsResult = {
  status: "ready",
  typstVersion: "0.15.1",
  method: "eval",
  truncated: false,
  elements: [
    { kind: "heading", text: "Introduction", label: "sec:intro", level: 1, figureKind: null, numbered: true, page: 1 },
    { kind: "citation", text: "smith", label: null, level: null, figureKind: null, numbered: false, page: 1 },
    { kind: "figure", text: "Rig", label: "fig:rig", level: null, figureKind: "image", numbered: true, page: 1 },
  ],
};

const LATEX = String.raw`\documentclass{article}
\title{Creep in Niobium}
\author{Elin Hagstrom \and Rafael Pinto}
\begin{document}
\section{Introduction}\label{sec:intro}
See \cite{smith} and \cite{ghost}.
\begin{figure}\caption{Rig}\label{fig:rig}\end{figure}
\bibliography{refs}
\end{document}
`;

const MARKDOWN = [
  "---",
  "title: Creep in Niobium",
  "author: [Elin Hagstrom, Rafael Pinto]",
  "---",
  "",
  "# Introduction",
  "",
  "![Rig](rig.png){#fig:rig}",
  "",
  "See [@smith].",
  "",
].join("\n");

function useEngine(id: string | undefined, mainDoc: string, texts: Record<string, string>) {
  mocks.files.engine = { id, source_format: id === "latexmk" ? "latex" : id, capabilities: { supports_offline: true } };
  mocks.files.mainDoc = mainDoc;
  mocks.texts = texts;
}

async function openTab(name: RegExp) {
  await screen.findByTestId("document-insights-metadata");
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
  fireEvent.click(screen.getByRole("tab", { name }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.files.projectId = "paper";
  useEngine("typst", "main.typ", { "main.typ": MAIN });
  mocks.checkpoint = null;
  mocks.current = false;
  mocks.numbers = {};
  mocks.invoke.mockResolvedValue(READY);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe("DocumentInsightsDialog with Typst", () => {
  it("summarises the compiled document and jumps to an entry's source", async () => {
    const onClose = vi.fn();
    render(<DocumentInsightsDialog onClose={onClose} />);
    const metadata = await screen.findByTestId("document-insights-metadata");
    expect(metadata).toHaveTextContent("Creep");
    expect(metadata).toHaveTextContent("A. Author, B. Author");
    expect(mocks.invoke).toHaveBeenCalledWith("typst_document_insights", { projectId: "paper", offline: false });
    expect(screen.getByText("Typst 0.15.1 with typst eval")).toBeVisible();

    await openTab(/Headings/);
    const entry = await screen.findByTestId("document-insight-entry");
    expect(entry).toHaveTextContent("Introduction");
    expect(entry).toHaveTextContent("<sec:intro>");
    expect(entry).toHaveTextContent("Page 1");
    fireEvent.click(entry);
    expect(onClose).toHaveBeenCalled();
    expect(mocks.open).toHaveBeenCalledWith({ path: "main.typ", line: 2, column: 1 }, { pdfView: "editor" });
  });

  it("copies the submission metadata as text", async () => {
    render(<DocumentInsightsDialog onClose={vi.fn()} />);
    await screen.findByTestId("document-insights-metadata");
    fireEvent.click(screen.getByTestId("document-insights-copy-metadata"));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Title: Creep\nAuthors: A. Author, B. Author\nKeywords: steel, creep"),
    );
    expect(mocks.success).toHaveBeenCalledWith(enEditor.typstInsights.metadataCopied);
  });

  it("lists compile errors that open where they happened and keeps source notes", async () => {
    mocks.invoke.mockResolvedValue({
      status: "failed",
      typstVersion: "0.13.1",
      method: "query",
      diagnostics: [{ message: "unknown variable: foo", file: "main.typ", line: 3, column: 5 }],
    });
    const onClose = vi.fn();
    render(<DocumentInsightsDialog onClose={onClose} />);
    const diagnostics = await screen.findByTestId("document-insights-diagnostics");
    expect(screen.getByText(enEditor.typstInsights.compileFailed)).toBeVisible();
    fireEvent.click(within(diagnostics).getByRole("button", { name: /unknown variable/ }));
    expect(mocks.open).toHaveBeenCalledWith({ path: "main.typ", line: 3, column: 5 }, { pdfView: "editor" });
    expect(screen.getByRole("tab", { name: /To-dos/ })).toHaveTextContent("1");
  });

  it("shows a backend error and tries again on refresh", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("Typst is missing"));
    render(<DocumentInsightsDialog onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Typst is missing");
    fireEvent.click(screen.getByRole("button", { name: enEditor.typstInsights.refresh }));
    expect(await screen.findByTestId("document-insights-metadata")).toBeVisible();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });
});

describe("DocumentInsightsDialog with LaTeX", () => {
  beforeEach(() => {
    useEngine("latexmk", "main.tex", { "main.tex": LATEX, "refs.bib": "@article{smith, title={A}}\n" });
  });

  it("shows numbers and pages from a current compile and flags missing keys", async () => {
    mocks.checkpoint = { projectId: "paper", mainDocument: "main.tex", outputId: "out-1" };
    mocks.current = true;
    mocks.numbers = { "sec:intro": { number: "1", page: "2" } };
    const onClose = vi.fn();
    render(<DocumentInsightsDialog onClose={onClose} />);
    expect(await screen.findByTestId("document-insights-metadata")).toHaveTextContent("Elin Hagstrom, Rafael Pinto");
    expect(mocks.refreshAux).toHaveBeenCalledWith("paper", "main.tex", "out-1");
    expect(screen.getByText(enEditor.documentInsights.numbersCurrent)).toBeVisible();
    expect(screen.getByText(enEditor.documentInsights.description)).toBeVisible();
    expect(screen.getByTestId("document-insights-unresolved")).toHaveTextContent("1 cited key is missing from the bibliography.");
    expect(mocks.invoke).not.toHaveBeenCalled();

    await openTab(/Headings/);
    const heading = await screen.findByTestId("document-insight-entry");
    expect(heading).toHaveTextContent("1Introduction");
    expect(heading).toHaveTextContent("sec:intro");
    expect(heading).not.toHaveTextContent("<sec:intro>");
    expect(heading).toHaveTextContent("Page 2");
    fireEvent.click(heading);
    expect(mocks.open).toHaveBeenCalledWith({ path: "main.tex", line: 5, column: 1 }, { pdfView: "editor" });
  });

  it("lists unresolved citations and hides numbers after the source changed", async () => {
    mocks.checkpoint = { projectId: "paper", mainDocument: "main.tex", outputId: "out-1" };
    render(<DocumentInsightsDialog onClose={vi.fn()} />);
    await screen.findByTestId("document-insights-metadata");
    expect(screen.getByText(enEditor.documentInsights.numbersStale)).toBeVisible();
    expect(mocks.refreshAux).not.toHaveBeenCalled();
    await openTab(/Citations/);
    const rows = await screen.findAllByTestId("document-insight-citation");
    expect(rows.map((row) => row.textContent)).toEqual([
      "smithCited 1 time",
      `ghost${enEditor.documentInsights.unresolved}Cited 1 time`,
    ]);
  });

  it("asks for a compile when there is none", async () => {
    render(<DocumentInsightsDialog onClose={vi.fn()} />);
    expect(await screen.findByText(enEditor.documentInsights.numbersMissing)).toBeVisible();
  });
});

describe("DocumentInsightsDialog with Markdown", () => {
  it("reads the front matter and lists ids with a hash", async () => {
    useEngine("markdown", "paper.md", { "paper.md": MARKDOWN });
    render(<DocumentInsightsDialog onClose={vi.fn()} />);
    expect(await screen.findByTestId("document-insights-metadata")).toHaveTextContent("Creep in Niobium");
    expect(screen.getByText(enEditor.documentInsights.sourceOrder)).toBeVisible();
    await openTab(/Figures/);
    expect(await screen.findByTestId("document-insight-entry")).toHaveTextContent("#fig:rig");
  });

  it("reads a main file that is not indexed yet", async () => {
    useEngine("markdown", "paper.md", {});
    mocks.readFile.mockResolvedValue(MARKDOWN);
    render(<DocumentInsightsDialog onClose={vi.fn()} />);
    expect(await screen.findByTestId("document-insights-metadata")).toHaveTextContent("Rafael Pinto");
    expect(mocks.readFile).toHaveBeenCalledWith("paper", "paper.md");
  });
});

describe("DocumentInsightsDialog without a document engine", () => {
  it("asks for a project", async () => {
    useEngine(undefined, "", {});
    render(<DocumentInsightsDialog onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(enEditor.documentInsights.noProject);
  });
});
