// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { applyTextEdits } from "@oleafly/editor/file-references";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import { allowRadixSelect, chooseOption } from "@/features/collab/tests/select";
import { useChapterImportStore } from "@/store/chapter-import";

const THESIS: Record<string, string> = {
  "main.tex": String.raw`\documentclass[11pt]{report}
\usepackage{amsmath,amssymb,amsthm}
\usepackage{graphicx}
\usepackage[numbers]{natbib}
\newtheorem{definition}{Definition}[chapter]
\newcommand{\solver}{Halomere}

\onehalfspacing

\begin{document}
\tableofcontents
\input{chapters/introduction}
\input{chapters/method}

\appendix
\input{appendices/solver-configuration}

\bibliographystyle{plainnat}
\bibliography{refs}

\end{document}
`,
  "chapters/introduction.tex": String.raw`\chapter{Introduction}
\label{chap:introduction}
`,
  "chapters/method.tex": String.raw`\chapter{The \solver{} Solver}
\label{chap:method}
Figure~\ref{fig:pipeline} shows a time step.
\begin{figure}\caption{Pipeline.}\label{fig:pipeline}\end{figure}
`,
  "appendices/solver-configuration.tex": String.raw`\chapter{Solver configuration}
`,
};

const PAPER: Record<string, string> = {
  "main.tex": String.raw`\documentclass{article}
\usepackage{amsmath}
\usepackage[capitalise]{cleveref}
\newcommand{\solver}{PS-FCN}
\newcommand{\vect}[1]{\mathbf{#1}}
\title{Deep Photometric Stereo}
\begin{document}
\maketitle
\section{Introduction}
\solver{} predicts $\vect{n}$, see \cref{fig:pipeline}.
\input{sections/method}
\bibliography{refs}
\end{document}
`,
  "sections/method.tex": String.raw`\begin{figure}\includegraphics{figures/pipeline.pdf}\label{fig:pipeline}\end{figure}
`,
};

const mocks = vi.hoisted(() => ({
  listFiles: vi.fn(),
  readFileContent: vi.fn(),
  readFileBase64: vi.fn(),
  writeProjectBytes: vi.fn(),
  readProjectSources: vi.fn(),
  applyReferencePlan: vi.fn(),
  notifyProjectFilesChanged: vi.fn(),
  logError: vi.fn(),
  files: {} as Record<string, unknown>,
}));

vi.mock("@/lib/tauri", () => ({
  listFiles: mocks.listFiles,
  readFileContent: mocks.readFileContent,
  readFileBase64: mocks.readFileBase64,
  writeProjectBytes: mocks.writeProjectBytes,
}));
vi.mock("@/store/project-index", () => ({ readProjectSources: mocks.readProjectSources }));
vi.mock("@/lib/file-references/follow-rename", () => ({ applyReferencePlan: mocks.applyReferencePlan }));
vi.mock("@/lib/cross-window", () => ({ notifyProjectFilesChanged: mocks.notifyProjectFilesChanged }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/tex-root", () => ({ resolveEffectiveMainDoc: () => ({ mainDoc: "main.tex" }) }));
vi.mock("@/store/files", () => ({
  useFilesStore: Object.assign((select: (state: Record<string, unknown>) => unknown) => select(mocks.files), {
    getState: () => mocks.files,
  }),
}));

import { ChapterImportDialog } from "./ChapterImportDialog";

const text = enEditor.chapterImport;

function project(id: string, name: string, engine: string, mainDoc = "main.tex") {
  return { id, name, engine, main_doc: mainDoc, kind: "document" };
}

function thesisTree(extra: string[] = []) {
  return [...Object.keys(THESIS), "refs.bib", ...extra].map((path) => ({ path, is_dir: !path.includes(".") }));
}

async function openPaper(user: ReturnType<typeof userEvent.setup>) {
  render(<ChapterImportDialog />);
  await chooseOption(user, text.paper, "Deep stereo paper");
  return screen.findByTestId("chapter-import-preview");
}

beforeAll(() => {
  allowRadixSelect();
});

beforeEach(() => {
  mocks.files = {
    projectId: "thesis",
    manifestHome: "library",
    mainDoc: "main.tex",
    tree: thesisTree(),
    files: {},
    projects: [
      project("thesis", "PhD thesis", "latex"),
      project("paper", "Deep stereo paper", "latex"),
      project("slides", "Typst slides", "typst", "main.typ"),
    ],
    refreshProjects: vi.fn(async () => {}),
    writeProjectFile: vi.fn(async () => {}),
    recordMutationGeneration: vi.fn(),
    openFile: vi.fn(async () => {}),
  };
  mocks.readProjectSources.mockImplementation(async (_projectId: string, paths: readonly string[]) => ({
    texts: Object.fromEntries(paths.filter((path) => THESIS[path] !== undefined).map((path) => [path, THESIS[path]])),
    unreadable: new Set<string>(),
  }));
  mocks.listFiles.mockResolvedValue(
    ["main.tex", "sections", "sections/method.tex", "figures", "figures/pipeline.pdf", "figures/old.png", "refs.bib"].map(
      (path) => ({ path, is_dir: !path.includes(".") }),
    ),
  );
  mocks.readFileContent.mockImplementation(async (_projectId: string, path: string) => PAPER[path].replaceAll("\n", "\r\n"));
  mocks.readFileBase64.mockImplementation(async (_projectId: string, path: string) => `bytes:${path}`);
  mocks.writeProjectBytes.mockResolvedValue({ generation: 7 });
  mocks.applyReferencePlan.mockResolvedValue([]);
  useChapterImportStore.setState({ open: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ChapterImportDialog", () => {
  it("lists only other LaTeX projects and previews the plan before writing", async () => {
    const user = userEvent.setup();
    await user.click(render(<ChapterImportDialog />).getByRole("combobox", { name: text.paper }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["Deep stereo paper"]);
    await user.click(screen.getByRole("option", { name: "Deep stereo paper" }));
    const preview = within(await screen.findByTestId("chapter-import-preview"));
    expect(screen.getByLabelText(text.folder)).toHaveValue("deep-stereo-paper");
    const files = within(preview.getByTestId("chapter-import-files")).getAllByRole("listitem");
    expect(files.map((item) => item.firstChild?.textContent)).toEqual([
      "chapters/deep-stereo-paper/chapter.tex",
      "chapters/deep-stereo-paper/macros.tex",
      "chapters/deep-stereo-paper/sections/method.tex",
      "chapters/deep-stereo-paper/refs.bib",
      "chapters/deep-stereo-paper/figures/pipeline.pdf",
    ]);
    expect(files[0]).toHaveTextContent(text.chapterFile);
    expect(files[1]).toHaveTextContent("2 definitions from the paper preamble");
    expect(files[2]).toHaveTextContent("Copied from sections/method.tex");
    expect(preview.getByText(String.raw`\solver`)).toBeVisible();
    expect(preview.getByText(String.raw`\newcommand{\solver}{Halomere}`)).toBeVisible();
    expect(preview.getByRole("switch", { name: "Prefix labels with deep-stereo-paper:" })).toBeChecked();
    expect(preview.getByTestId("chapter-import-packages")).toHaveTextContent(String.raw`\usepackage[capitalise]{cleveref}`);
    expect(preview.getByTestId("chapter-import-lines").textContent).toBe(
      String.raw`\input{chapters/deep-stereo-paper/macros}
\include{chapters/deep-stereo-paper/chapter}`,
    );
    expect(mocks.writeProjectBytes).not.toHaveBeenCalled();
    expect(mocks.files.writeProjectFile).not.toHaveBeenCalled();
  });

  it("copies the files, writes the chapter and wires it into the thesis main file", async () => {
    const user = userEvent.setup();
    await openPaper(user);
    await chooseOption(user, `What to do with ${String.raw`\solver`}`, text.keep);
    fireEvent.click(screen.getByTestId("chapter-import-add"));
    const summary = await screen.findByTestId("chapter-import-summary");
    expect(summary).toHaveTextContent("Added 5 files to chapters/deep-stereo-paper.");
    expect(mocks.readFileBase64.mock.calls).toEqual([
      ["paper", "refs.bib"],
      ["paper", "figures/pipeline.pdf"],
    ]);
    expect(mocks.writeProjectBytes.mock.calls).toEqual([
      ["thesis", "chapters/deep-stereo-paper/refs.bib", "bytes:refs.bib"],
      ["thesis", "chapters/deep-stereo-paper/figures/pipeline.pdf", "bytes:figures/pipeline.pdf"],
    ]);
    expect(mocks.files.recordMutationGeneration).toHaveBeenCalledWith("thesis", 7);
    const writes = vi.mocked(mocks.files.writeProjectFile as (...args: string[]) => Promise<void>).mock.calls;
    expect(writes.map(([projectId, path]) => [projectId, path])).toEqual([
      ["thesis", "chapters/deep-stereo-paper/chapter.tex"],
      ["thesis", "chapters/deep-stereo-paper/macros.tex"],
      ["thesis", "chapters/deep-stereo-paper/sections/method.tex"],
    ]);
    expect(writes[0][2]).toBe(String.raw`\chapter{Deep Photometric Stereo}

\section{Introduction}
\solver{} predicts $\vect{n}$, see \cref{deep-stereo-paper:fig:pipeline}.
\input{chapters/deep-stereo-paper/sections/method}
`);
    expect(writes[1][2]).toBe(String.raw`\newcommand{\vect}[1]{\mathbf{#1}}
`);
    expect(writes[2][2]).toContain(String.raw`\includegraphics{chapters/deep-stereo-paper/figures/pipeline.pdf}`);
    const [projectId, plan] = mocks.applyReferencePlan.mock.calls[0];
    expect(projectId).toBe("thesis");
    expect(plan.files[0].path).toBe("main.tex");
    const main = applyTextEdits(plan.files[0].text, plan.files[0].edits);
    expect(main).toContain(String.raw`\input{chapters/deep-stereo-paper/macros}

\begin{document}`);
    expect(main).toContain(String.raw`\include{chapters/deep-stereo-paper/chapter}

\appendix`);
    expect(screen.getByText("These lines were added to main.tex.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: text.openChapter }));
    expect(mocks.files.openFile).toHaveBeenCalledWith("chapters/deep-stereo-paper/chapter.tex");
    expect(useChapterImportStore.getState().open).toBe(false);
  });

  it("asks for the lines by hand when the main file changed in the meantime", async () => {
    mocks.applyReferencePlan.mockResolvedValue(["main.tex"]);
    const user = userEvent.setup();
    await openPaper(user);
    fireEvent.click(screen.getByTestId("chapter-import-add"));
    await screen.findByTestId("chapter-import-summary");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "main.tex changed while the chapter was added. Add these lines to it by hand.",
    );
  });

  it("refuses a folder that already exists or a name that is not a folder name", async () => {
    mocks.files.tree = thesisTree(["chapters/deep-stereo-paper"]);
    const user = userEvent.setup();
    await openPaper(user);
    expect(screen.getByRole("alert")).toHaveTextContent("chapters/deep-stereo-paper already exists.");
    expect(screen.getByTestId("chapter-import-add")).toBeDisabled();
    fireEvent.change(screen.getByLabelText(text.folder), { target: { value: "deep stereo" } });
    expect(screen.getByRole("alert")).toHaveTextContent(text.blockers.slug);
    fireEvent.change(screen.getByLabelText(text.folder), { target: { value: "stereo" } });
    await waitFor(() => expect(screen.getByTestId("chapter-import-add")).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says so when the paper cannot be read", async () => {
    mocks.listFiles.mockRejectedValue(new Error("gone"));
    const user = userEvent.setup();
    render(<ChapterImportDialog />);
    await chooseOption(user, text.paper, "Deep stereo paper");
    expect(await screen.findByRole("alert")).toHaveTextContent(text.loadFailed);
    expect(mocks.logError).toHaveBeenCalledWith("chapter import paper", expect.any(Error));
    expect(screen.getByTestId("chapter-import-add")).toBeDisabled();
  });
});
