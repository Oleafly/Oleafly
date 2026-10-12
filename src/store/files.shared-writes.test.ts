import { beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getProjectEngine: vi.fn(),
  projectMutationGeneration: vi.fn(),
  listFiles: vi.fn(),
  readFileContent: vi.fn(),
  writeFileContent: vi.fn(),
  collabWriteText: vi.fn(),
  projectTexStatus: vi.fn(),
  mcpSetActiveProject: vi.fn(async () => {}),
  logError: vi.fn(),
  notifyError: vi.fn(),
  toastInfo: vi.fn(),
  toastInfoUnique: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastErrorUnique: vi.fn(),
  toastDismiss: vi.fn(),
  resetCompile: vi.fn(),
  flushWysiwygPendingEdits: vi.fn(),
  invalidateWysiwygProjectSession: vi.fn(),
  notifyProjectFilesChanged: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  getProject: mocks.getProject,
  projectManifestHome: vi.fn(async () => "library"),
  getProjectEngine: mocks.getProjectEngine,
  projectMutationGeneration: mocks.projectMutationGeneration,
  listFiles: mocks.listFiles,
  listFileTree: async (projectId: string) => ({
    entries: await mocks.listFiles(projectId),
    truncated: false,
  }),
  readFileContent: mocks.readFileContent,
  writeFileContent: mocks.writeFileContent,
  collabWriteText: mocks.collabWriteText,
  projectTexStatus: mocks.projectTexStatus,
  listProjects: vi.fn(async () => []),
  mcpSetActiveProject: mocks.mcpSetActiveProject,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
  toast: {
    info: mocks.toastInfo,
    infoUnique: mocks.toastInfoUnique,
    success: mocks.toastSuccess,
    error: mocks.toastError,
    errorUnique: mocks.toastErrorUnique,
    dismiss: mocks.toastDismiss,
  },
}));
vi.mock("@/lib/cross-window", () => ({
  notifyProjectFilesChanged: mocks.notifyProjectFilesChanged,
}));
vi.mock("@/store/diff", () => ({
  useDiffStore: { getState: () => ({ clearActiveDiff: vi.fn() }) },
}));
vi.mock("@/store/tab-order", () => ({ nextTabSeq: () => 1 }));
vi.mock("@/store/compile", () => ({
  useCompileStore: { getState: () => ({ reset: mocks.resetCompile }) },
}));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  flushWysiwygPendingEdits: mocks.flushWysiwygPendingEdits,
  invalidateWysiwygProjectSession: mocks.invalidateWysiwygProjectSession,
}));

import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { useFilesStore } from "./files";

function goLive(): void {
  useCollabEditorGate.setState({ projectId: "project", viewer: false, connecting: false });
}

beforeEach(async () => {
  useCollabEditorGate.setState({ projectId: null, viewer: false, connecting: false });
  await useFilesStore.getState().closeProject();
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.projectMutationGeneration.mockResolvedValue(3);
  mocks.writeFileContent.mockResolvedValue({ generation: 9 });
  mocks.collabWriteText.mockResolvedValue({ handled: true });
  mocks.listFiles.mockResolvedValue([{ path: "main.tex", is_dir: false }]);
  mocks.readFileContent.mockResolvedValue("");
  mocks.mcpSetActiveProject.mockResolvedValue(undefined);
  mocks.getProjectEngine.mockResolvedValue(LATEX_ENGINE);
  mocks.projectTexStatus.mockResolvedValue(null);
  useFilesStore.setState({
    projectId: "project",
    projectName: "Paper",
    mainDoc: "main.tex",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    tree: [{ path: "main.tex", is_dir: false }, { path: "refs.bib", is_dir: false }],
    files: {},
    openTabs: [],
    activePath: null,
  });
});

describe("a file written by the app in a live shared project", () => {
  it("is merged into the shared document from the text the writer started with, never written to disk", async () => {
    goLive();
    await useFilesStore.getState().writeProjectFile("project", "refs.bib", "@book{new}\n", {
      base: "@book{old}\n",
    });
    expect(mocks.collabWriteText).toHaveBeenCalledWith("project", "refs.bib", "@book{old}\n", "@book{new}\n");
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
  });

  it("sends no base when the writer does not know what it started from", async () => {
    goLive();
    await useFilesStore.getState().writeProjectFile("project", "figures/plot.tex", "\\draw;\n");
    expect(mocks.collabWriteText).toHaveBeenCalledWith("project", "figures/plot.tex", null, "\\draw;\n");
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
  });

  it("keeps CRLF line endings in both the text and its base", async () => {
    goLive();
    mocks.readFileContent.mockResolvedValue("one\r\ntwo\r\n");
    await useFilesStore.getState().openFile("main.tex");
    await useFilesStore.getState().writeProjectFile("project", "main.tex", "one\ntwo\nthree\n", {
      base: "one\ntwo\n",
    });
    expect(mocks.collabWriteText).toHaveBeenCalledWith(
      "project",
      "main.tex",
      "one\r\ntwo\r\n",
      "one\r\ntwo\r\nthree\r\n",
    );
    expect(useFilesStore.getState().files["main.tex"]).toMatchObject({
      content: "one\ntwo\nthree\n",
      dirty: false,
    });
  });

  it("is written to disk when the shared document does not take it", async () => {
    goLive();
    mocks.collabWriteText.mockResolvedValue({ handled: false });
    await useFilesStore.getState().writeProjectFile("project", "refs.bib", "@book{new}\n", {
      base: "@book{old}\n",
    });
    expect(mocks.writeFileContent).toHaveBeenCalledWith("project", "refs.bib", "@book{new}\n", 3);
  });

  it("is written to disk in a project that is not shared, as before", async () => {
    await useFilesStore.getState().writeProjectFile("project", "refs.bib", "@book{new}\n", {
      base: "@book{old}\n",
    });
    expect(mocks.writeFileContent).toHaveBeenCalledWith("project", "refs.bib", "@book{new}\n", 3);
    expect(mocks.collabWriteText).not.toHaveBeenCalled();
  });
});

describe("an open buffer changed by an in-app writer in a live shared project", () => {
  it("is saved through the shared document from the text it held before the change", async () => {
    goLive();
    mocks.readFileContent.mockResolvedValue("\\begin{document}\n\\end{document}\n");
    await useFilesStore.getState().openFile("main.tex");
    useFilesStore
      .getState()
      .setContent("main.tex", "\\usepackage{x}\n\\begin{document}\n\\end{document}\n");
    await useFilesStore.getState().saveFile("main.tex");
    expect(mocks.collabWriteText).toHaveBeenCalledWith(
      "project",
      "main.tex",
      "\\begin{document}\n\\end{document}\n",
      "\\usepackage{x}\n\\begin{document}\n\\end{document}\n",
    );
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
    expect(useFilesStore.getState().files["main.tex"].dirty).toBe(false);
  });

  it("starts the next save from the text the previous save sent", async () => {
    goLive();
    mocks.readFileContent.mockResolvedValue("a\n");
    await useFilesStore.getState().openFile("main.tex");
    useFilesStore.getState().setContent("main.tex", "a\nb\n");
    await useFilesStore.getState().saveFile("main.tex");
    useFilesStore.getState().setContent("main.tex", "a\nb\nc\n");
    await useFilesStore.getState().saveFile("main.tex");
    expect(mocks.collabWriteText.mock.calls.map((call) => [call[2], call[3]])).toEqual([
      ["a\n", "a\nb\n"],
      ["a\nb\n", "a\nb\nc\n"],
    ]);
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
  });

  it("is saved to disk in a project that is not shared, as before", async () => {
    mocks.readFileContent.mockResolvedValue("a\n");
    await useFilesStore.getState().openFile("main.tex");
    useFilesStore.getState().setContent("main.tex", "a\nb\n");
    await useFilesStore.getState().saveFile("main.tex");
    expect(mocks.writeFileContent).toHaveBeenCalledTimes(1);
    expect(mocks.collabWriteText).not.toHaveBeenCalled();
  });
});

describe("text reloaded from disk in a live shared project", () => {
  it("is never sent back into the shared document", async () => {
    goLive();
    mocks.readFileContent.mockResolvedValue("a\n");
    await useFilesStore.getState().openFile("main.tex");
    expect(useFilesStore.getState().applyExternalReload("project", "main.tex", "a\nfrom a collaborator\n")).toBe(true);
    expect(mocks.collabWriteText).not.toHaveBeenCalled();
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
  });
});

describe("an outside write that meets an unsaved local edit in a live shared project", () => {
  it("keeps the local edit by merging it over the outside text in the shared document", async () => {
    goLive();
    mocks.readFileContent.mockResolvedValue("a\n");
    await useFilesStore.getState().openFile("main.tex");
    useFilesStore.getState().setContent("main.tex", "a\nmine\n");
    expect(useFilesStore.getState().applyExternalWrite("project", "main.tex", "a\nassistant\n")).toBe(false);
    await vi.waitFor(() => expect(mocks.collabWriteText).toHaveBeenCalled());
    expect(mocks.collabWriteText).toHaveBeenCalledWith("project", "main.tex", "a\nassistant\n", "a\nmine\n");
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
  });
});
