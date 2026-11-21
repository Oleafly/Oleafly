// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import type { AuxToc } from "@/lib/aux-numbers";
import { navigateToProjectRange } from "@/lib/project-intelligence/navigation";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

const editor = vi.hoisted(() => ({ path: null as string | null, view: null as unknown }));
const aux = vi.hoisted(() => ({ toc: null as AuxToc | null }));

vi.mock("@oleafly/editor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@oleafly/editor")>()),
  subscribeEditorDocument: (listener: (path: string | null, view: unknown) => void) => {
    listener(editor.path, editor.view);
    return () => undefined;
  },
}));
vi.mock("@/lib/project-intelligence/navigation", () => ({ navigateToProjectRange: vi.fn() }));
vi.mock("@/lib/aux-numbers", () => ({
  currentAuxToc: () => aux.toc,
  subscribeAuxNumbers: () => () => undefined,
}));
vi.mock("@/lib/index/outline-numbers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/index/outline-numbers")>();
  return { ...actual, latexHeadingNumbers: vi.fn(actual.latexHeadingNumbers) };
});

import { DocumentOutline } from "@/components/layout/DocumentOutline";
import { latexHeadingNumbers } from "@/lib/index/outline-numbers";
import { EditorOutlineRail, OUTLINE_RAIL_MIN_EDITOR_WIDTH } from "./EditorOutlineRail";

const copy = enWorkspace.outline;

type Section = readonly [file: string, from: number, level: number, title: string];

function indexOf(sections: readonly Section[], includes: readonly [file: string, from: number, target: string][] = []) {
  const sym = (file: string, from: number, name: string) => ({
    file,
    from,
    to: from + name.length,
    nameFrom: from,
    nameTo: from + name.length,
    line: 1,
    name,
  });
  return {
    defs: sections.map(([file, from, level, title]) => ({ ...sym(file, from, title), kind: "section", level })),
    uses: includes.map(([file, from, target]) => ({ ...sym(file, from, target), kind: "inputedge", target })),
  };
}

function fakeView(pos: number, { width = 800, panels = 0 } = {}) {
  const dom = document.createElement("div");
  const scrollDOM = document.createElement("div");
  dom.append(scrollDOM);
  const box = (top: number) => ({ top, left: 0, right: width, bottom: top + 600, width, height: 600 }) as DOMRect;
  dom.getBoundingClientRect = () => box(100);
  scrollDOM.getBoundingClientRect = () => box(100 + panels);
  Object.defineProperty(scrollDOM, "clientWidth", { value: width });
  return { dom, scrollDOM, posAtCoords: () => pos };
}

const THESIS: readonly Section[] = [
  ["main.tex", 100, 2, "Introduction"],
  ["ch1.tex", 0, 2, "Background"],
  ["ch1.tex", 300, 3, "Prior work"],
  ["main.tex", 900, 2, "Conclusion"],
];

interface MountOptions {
  readonly pos?: number;
  readonly width?: number;
  readonly panels?: number;
  readonly sections?: readonly Section[];
  readonly includes?: readonly [file: string, from: number, target: string][];
  readonly texts?: Record<string, string>;
}

function mount(
  activePath: string,
  { pos = 0, width = 800, panels = 0, sections = THESIS, includes = [["main.tex", 500, "ch1.tex"]], texts = {} }: MountOptions = {},
) {
  editor.path = activePath;
  editor.view = fakeView(pos, { width, panels });
  useIndexStore.setState({ index: indexOf(sections, includes) as never, texts });
  useFilesStore.setState({ projectId: "p1", activePath, mainDoc: "main.tex", files: {}, tree: [] } as never);
  return render(<EditorOutlineRail />);
}

function marks() {
  return [...screen.getByRole("button", { name: copy.title }).querySelectorAll("span")];
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  aux.toc = null;
  editor.path = null;
  editor.view = null;
  useIndexStore.setState({ index: null, texts: {} });
  useFilesStore.setState({ projectId: null, activePath: null, mainDoc: "main.tex", files: {}, tree: [] } as never);
});

describe("EditorOutlineRail", () => {
  it("shows the whole manuscript from an included file and lights the section being read", async () => {
    mount("ch1.tex", { pos: 350 });
    expect(marks()).toHaveLength(4);
    await waitFor(() => expect(marks()[2]).toHaveAttribute("data-current"));
  });

  it("lights the included file's heading while reading the parent past the include", async () => {
    mount("main.tex", { pos: 600 });
    await waitFor(() => expect(marks()[2]).toHaveAttribute("data-current"));
  });

  it("sits halfway down the editor, below its top panels, and lets clicks past it reach the text", () => {
    mount("main.tex", { panels: 40 });
    const rail = screen.getByTestId("outline-rail");
    expect(rail).toHaveStyle({ top: "40px" });
    expect(rail).toHaveClass("bottom-0", "items-center", "pointer-events-none");
    expect(within(rail).getByRole("button")).toHaveClass("pointer-events-auto");
  });

  it("stays out of the way with one heading, in a file that is not a document, or in a narrow editor", () => {
    mount("main.tex", { sections: [["main.tex", 0, 2, "Only"]], includes: [] });
    expect(screen.queryByTestId("outline-rail")).toBeNull();
    cleanup();
    mount("refs.bib");
    expect(screen.queryByTestId("outline-rail")).toBeNull();
    cleanup();
    mount("main.tex", { width: OUTLINE_RAIL_MIN_EDITOR_WIDTH - 1 });
    expect(screen.queryByTestId("outline-rail")).toBeNull();
  });

  it("lists numbers, pages and other files' headings, and jumps to the chosen one", async () => {
    aux.toc = {
      projectId: "p1",
      mainDocument: "main.tex",
      entries: [
        { level: 2, number: "1", title: "Introduction", page: "1" },
        { level: 2, number: "2", title: "Background", page: "3" },
        { level: 3, number: "2.1", title: "Prior work", page: "4" },
        { level: 2, number: "3", title: "Conclusion", page: "9" },
      ],
    };
    mount("main.tex", {
      pos: 150,
      texts: {
        "main.tex": `${" ".repeat(100)}\\section{Introduction}${" ".repeat(379)}\\input{ch1}${" ".repeat(389)}\\section{Conclusion}`,
        "ch1.tex": `\\section{Background}${" ".repeat(280)}\\subsection{Prior work}`,
      },
    });
    await waitFor(() => expect(marks()[0]).toHaveAttribute("data-current"));
    fireEvent.click(screen.getByRole("button", { name: copy.title }));

    const outline = await screen.findByRole("dialog", { name: copy.title });
    expect(outline).toHaveAttribute("data-align", "center");
    const current = within(outline).getByRole("button", { name: "1 Introduction, page 1" });
    await waitFor(() => expect(current).toHaveFocus());
    expect(within(outline).getByText("main.tex")).toBeInTheDocument();
    const prior = within(outline).getByRole("button", { name: "2.1 Prior work, page 4" });
    expect(prior).toHaveTextContent("ch1");
    expect(prior).toHaveTextContent("p.4");
    expect(current).toHaveAttribute("aria-current", "location");

    act(() => fireEvent.click(prior));
    expect(navigateToProjectRange).toHaveBeenCalledWith({
      path: "ch1.tex",
      range: { from: 300, to: 310 },
      source: "outline",
    });
  });
});

const NUMBERED_TOC: AuxToc = {
  projectId: "p1",
  mainDocument: "main.tex",
  entries: [
    { level: 2, number: "1", title: "Introduction", page: "1" },
    { level: 2, number: "2", title: "Background", page: "3" },
    { level: 3, number: "2.1", title: "Prior work", page: "4" },
    { level: 2, number: "3", title: "Conclusion", page: "9" },
  ],
};

const NUMBERED_TEXTS = {
  "main.tex": `${" ".repeat(100)}\\section{Introduction}${" ".repeat(379)}\\input{ch1}${" ".repeat(389)}\\section{Conclusion}`,
  "ch1.tex": `\\section{Background}${" ".repeat(280)}\\subsection{Prior work}`,
};

function reindex() {
  act(() => {
    useIndexStore.setState({ index: indexOf(THESIS, [["main.tex", 500, "ch1.tex"]]) as never });
  });
}

describe("EditorOutlineRail numbering", () => {
  it("works out heading numbers only while the outline is open", async () => {
    aux.toc = NUMBERED_TOC;
    mount("main.tex", { texts: NUMBERED_TEXTS });
    await waitFor(() => expect(marks()).toHaveLength(4));
    reindex();
    expect(latexHeadingNumbers).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: copy.title }));
    const outline = await screen.findByRole("dialog", { name: copy.title });
    expect(within(outline).getByRole("button", { name: "1 Introduction, page 1" })).toBeInTheDocument();
    expect(latexHeadingNumbers).toHaveBeenCalledTimes(1);
    expect(vi.mocked(latexHeadingNumbers).mock.calls[0][0].documentSections).toHaveLength(4);

    fireEvent.keyDown(outline, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: copy.title })).toBeNull());
    vi.mocked(latexHeadingNumbers).mockClear();
    reindex();
    expect(latexHeadingNumbers).not.toHaveBeenCalled();
  });

  it("works the numbers out once for the rail and the sidebar outline together", async () => {
    aux.toc = NUMBERED_TOC;
    mount("main.tex", { texts: NUMBERED_TEXTS });
    cleanup();
    render(
      <>
        <EditorOutlineRail />
        <DocumentOutline />
      </>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "1 Introduction" })).toBeInTheDocument());
    fireEvent.click(within(screen.getByTestId("outline-rail")).getByRole("button", { name: copy.title }));
    const outline = await screen.findByRole("dialog", { name: copy.title });
    expect(within(outline).getByRole("button", { name: "1 Introduction, page 1" })).toBeInTheDocument();
    expect(latexHeadingNumbers).toHaveBeenCalledTimes(1);

    vi.mocked(latexHeadingNumbers).mockClear();
    reindex();
    expect(screen.getByRole("button", { name: "1 Introduction" })).toBeInTheDocument();
    expect(latexHeadingNumbers).toHaveBeenCalledTimes(1);
  });

  it("works out no numbers for a collapsed sidebar outline", () => {
    aux.toc = NUMBERED_TOC;
    useIndexStore.setState({ index: indexOf(THESIS, [["main.tex", 500, "ch1.tex"]]) as never, texts: NUMBERED_TEXTS });
    useFilesStore.setState({ projectId: "p1", activePath: "main.tex", mainDoc: "main.tex", files: {}, tree: [] } as never);
    render(<DocumentOutline collapsed onCollapsedChange={() => undefined} />);
    reindex();
    expect(latexHeadingNumbers).not.toHaveBeenCalled();
  });
});
