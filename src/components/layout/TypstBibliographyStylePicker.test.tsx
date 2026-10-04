// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import type { ProjectIntelligenceSnapshot } from "@/lib/project-intelligence/types";

const mocks = vi.hoisted(() => ({
  readFileContent: vi.fn(),
  notifyError: vi.fn(),
  setContent: vi.fn(),
  saveFile: vi.fn(),
  writeProjectFile: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readFileContent: mocks.readFileContent,
}));
vi.mock("@/lib/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/toast")>()),
  notifyError: mocks.notifyError,
}));

import { TypstBibliographyStylePicker } from "./TypstBibliographyStylePicker";

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: () => {} },
    scrollIntoView: { configurable: true, value: () => {} },
  });
});

function snapshotWith(fromFile: string): ProjectIntelligenceSnapshot {
  return {
    hierarchy: {
      roots: ["main.typ"],
      nodes: [],
      edges: [
        {
          id: "edge-1",
          kind: "bibliography",
          fromFile,
          location: { file: fromFile, range: { from: 0, to: 1 } },
          rawTarget: "refs.bib",
          targetFile: "refs.bib",
          resolution: "resolved",
          candidateFiles: ["refs.bib"],
        },
      ],
    },
  } as unknown as ProjectIntelligenceSnapshot;
}

function setProject(files: Record<string, string>, version: string | null = "0.15.1") {
  useFilesStore.setState({
    projectId: "typst-project",
    mainDoc: "main.typ",
    tree: Object.keys(files).map((path) => ({ path, name: path, is_dir: false }) as never),
    files: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, { content, dirty: false }])),
    engine: {
      ...useFilesStore.getState().engine,
      id: "typst",
      typst_resolved: version ? { version, source: "bundled" } : null,
    },
    setContent: mocks.setContent,
    saveFile: mocks.saveFile,
    writeProjectFile: mocks.writeProjectFile,
  });
}

function choose(option: string) {
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: option }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setContent.mockReturnValue(true);
  mocks.saveFile.mockResolvedValue(undefined);
  mocks.writeProjectFile.mockResolvedValue(undefined);
  useIndexStore.setState({ texts: {} });
});

describe("TypstBibliographyStylePicker", () => {
  it("shows the current style and rewrites the bibliography call in the open file", async () => {
    setProject({ "main.typ": '#bibliography("refs.bib", style: "apa")' });
    render(<TypstBibliographyStylePicker snapshot={snapshotWith("main.typ")} />);
    expect(screen.getByRole("combobox", { name: "Citation style for the bibliography in main.typ" })).toHaveTextContent("apa");
    choose("nlm-citation-sequence");
    await waitFor(() =>
      expect(mocks.setContent).toHaveBeenCalledWith(
        "main.typ",
        '#bibliography("refs.bib", style: "nlm-citation-sequence")',
      ),
    );
    expect(mocks.saveFile).toHaveBeenCalledWith("main.typ");
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("adds the style to a bibliography in an unopened chapter file", async () => {
    setProject({ "main.typ": '#include "back.typ"', "back.typ": "" });
    useFilesStore.setState({
      files: { "main.typ": { content: '#include "back.typ"', dirty: false } } as never,
    });
    useIndexStore.setState({ texts: { "back.typ": '= Refs\n#bibliography("refs.bib")' } });
    mocks.readFileContent.mockResolvedValue('= Refs\n#bibliography("refs.bib")');
    render(<TypstBibliographyStylePicker snapshot={snapshotWith("back.typ")} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("ieee");
    choose("apa");
    await waitFor(() =>
      expect(mocks.writeProjectFile).toHaveBeenCalledWith(
        "typst-project",
        "back.typ",
        '= Refs\n#bibliography("refs.bib", style: "apa")',
      ),
    );
  });

  it("offers only the styles the project's Typst version knows", () => {
    setProject({ "main.typ": '#bibliography("refs.bib", style: "vancouver")' }, "0.13.1");
    render(<TypstBibliographyStylePicker snapshot={null} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "vancouver" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "nlm-citation-sequence" })).not.toBeInTheDocument();
  });

  it("keeps an unknown style selectable and hides without a bibliography", () => {
    setProject({ "main.typ": '#bibliography("refs.bib", style: "/styles/journal.csl")' });
    const { unmount } = render(<TypstBibliographyStylePicker snapshot={null} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("/styles/journal.csl");
    unmount();
    setProject({ "main.typ": "= No references" });
    const { container } = render(<TypstBibliographyStylePicker snapshot={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reports a failed write once", async () => {
    setProject({ "main.typ": '#bibliography("refs.bib")' });
    mocks.saveFile.mockRejectedValue(new Error("disk full"));
    render(<TypstBibliographyStylePicker snapshot={null} />);
    choose("apa");
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledTimes(1));
    expect(mocks.notifyError).toHaveBeenCalledWith(
      "change Typst citation style",
      expect.any(Error),
      "Oleafly couldn't change the citation style.",
    );
  });

  it("refuses to rewrite an open file that cannot be edited", async () => {
    setProject({ "main.typ": '#bibliography("refs.bib")' });
    mocks.setContent.mockReturnValue(false);
    render(<TypstBibliographyStylePicker snapshot={null} />);

    choose("apa");

    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledTimes(1));
    expect((mocks.notifyError.mock.calls[0][1] as Error).message).toBe("main.typ is read-only");
    expect(mocks.saveFile).not.toHaveBeenCalled();
  });

  it("stays hidden for a project whose main file is not Typst", () => {
    setProject({ "main.tex": "\\bibliography{refs}" });
    useFilesStore.setState({ mainDoc: "main.tex" });

    const { container } = render(<TypstBibliographyStylePicker snapshot={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});

