import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { useFilesStore } from "./files";

beforeAll(async () => {
  await loadNamespace("collab");
});

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

  it("sends LF text and an LF base for a CRLF file, since the shared document restores CRLF on disk", async () => {
    goLive();
    mocks.readFileContent.mockResolvedValue("one\r\ntwo\r\n");
    await useFilesStore.getState().openFile("main.tex");
    await useFilesStore.getState().writeProjectFile("project", "main.tex", "one\r\ntwo\r\nthree\r\n", {
      base: "one\r\ntwo\r\n",
    });
    expect(mocks.collabWriteText).toHaveBeenCalledWith("project", "main.tex", "one\ntwo\n", "one\ntwo\nthree\n");
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
    expect(useFilesStore.getState().files["main.tex"]).toMatchObject({
      content: "one\ntwo\nthree\n",
      dirty: false,
    });
  });

  it("still writes CRLF to disk when the shared document does not take a CRLF file", async () => {
    goLive();
    mocks.collabWriteText.mockResolvedValue({ handled: false });
    mocks.readFileContent.mockResolvedValue("one\r\ntwo\r\n");
    await useFilesStore.getState().openFile("main.tex");
    await useFilesStore.getState().writeProjectFile("project", "main.tex", "one\ntwo\nthree\n", {
      base: "one\ntwo\n",
    });
    expect(mocks.collabWriteText).toHaveBeenCalledWith("project", "main.tex", "one\ntwo\n", "one\ntwo\nthree\n");
    expect(mocks.writeFileContent).toHaveBeenCalledWith("project", "main.tex", "one\r\ntwo\r\nthree\r\n", 3);
  });

  it("is written to disk when the shared document does not take it", async () => {
    goLive();
    mocks.collabWriteText.mockResolvedValue({ handled: false });
    await useFilesStore.getState().writeProjectFile("project", "refs.bib", "@book{new}\n", {
      base: "@book{old}\n",
    });
    expect(mocks.writeFileContent).toHaveBeenCalledWith("project", "refs.bib", "@book{new}\n", 3);
  });

  it("is refused for a viewer instead of being written to disk", async () => {
    useCollabEditorGate.setState({ projectId: "project", viewer: true, connecting: false });
    await expect(
      useFilesStore.getState().writeProjectFile("project", "refs.bib", "@book{new}\n", { base: "@book{old}\n" }),
    ).rejects.toThrow(enCollab.access.viewOnly);
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
  });

  it("is refused when the shared document says this person can only view", async () => {
    goLive();
    mocks.collabWriteText.mockResolvedValue({ handled: false, reason: "read_only" });
    await expect(
      useFilesStore.getState().writeProjectFile("project", "refs.bib", "@book{new}\n", { base: "@book{old}\n" }),
    ).rejects.toThrow(enCollab.access.viewOnly);
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
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

  it("merges from the base a writer passes when it built the new text from an older copy", async () => {
    goLive();
    mocks.readFileContent.mockResolvedValue("older\nlabel\n");
    await useFilesStore.getState().openFile("main.tex");
    useFilesStore.setState((state) => ({
      files: { ...state.files, "main.tex": { content: "newer from Bob\nolder\nlabel\n", dirty: false } },
    }));
    useFilesStore.getState().setContent("main.tex", "older\nrenamed\n", { base: "older\nlabel\n" });
    await useFilesStore.getState().saveFile("main.tex");
    expect(mocks.collabWriteText).toHaveBeenCalledExactlyOnceWith(
      "project",
      "main.tex",
      "older\nlabel\n",
      "older\nrenamed\n",
    );
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

  it("saves an open CRLF file through the shared document as LF text from an LF base", async () => {
    goLive();
    mocks.readFileContent.mockResolvedValue("a\r\n");
    await useFilesStore.getState().openFile("main.tex");
    useFilesStore.getState().setContent("main.tex", "a\nb\n");
    await useFilesStore.getState().saveFile("main.tex");
    expect(mocks.collabWriteText).toHaveBeenCalledExactlyOnceWith("project", "main.tex", "a\n", "a\nb\n");
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
  });

  it("keeps CRLF for the direct disk save when the shared document does not take an open CRLF file", async () => {
    goLive();
    mocks.collabWriteText.mockResolvedValue({ handled: false });
    mocks.readFileContent.mockResolvedValue("a\r\n");
    await useFilesStore.getState().openFile("main.tex");
    useFilesStore.getState().setContent("main.tex", "a\nb\n");
    await useFilesStore.getState().saveFile("main.tex");
    expect(mocks.collabWriteText).toHaveBeenCalledExactlyOnceWith("project", "main.tex", "a\n", "a\nb\n");
    expect(mocks.writeFileContent).toHaveBeenCalledExactlyOnceWith(
      "project",
      "main.tex",
      "a\r\nb\r\n",
      3,
      expect.any(String),
    );
  });

  it("fails to save and stays unsaved for a viewer, never writing the disk", async () => {
    goLive();
    mocks.collabWriteText.mockResolvedValue({ handled: false, reason: "read_only" });
    mocks.readFileContent.mockResolvedValue("a\n");
    await useFilesStore.getState().openFile("main.tex");
    useFilesStore.getState().setContent("main.tex", "a\nb\n");
    await expect(useFilesStore.getState().saveFile("main.tex")).rejects.toThrow(enCollab.access.viewOnly);
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
    expect(useFilesStore.getState().files["main.tex"].dirty).toBe(true);
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

describe("text a live session hands back to local editing", () => {
  it("merges into a project that is still live from the text the shared document confirmed", async () => {
    goLive();
    mocks.readFileContent.mockResolvedValue("a\n");
    await useFilesStore.getState().openFile("main.tex");
    useFilesStore.setState((state) => ({
      files: { ...state.files, "main.tex": { content: "a\ntyped\n", dirty: false } },
    }));
    useFilesStore.getState().setContent("main.tex", "a\ntyped\n", { unsaved: true, base: "a\n" });
    await useFilesStore.getState().saveFile("main.tex");
    expect(mocks.collabWriteText).toHaveBeenCalledExactlyOnceWith("project", "main.tex", "a\n", "a\ntyped\n");
  });

  it("is saved even though the buffer already shows it", async () => {
    mocks.readFileContent.mockResolvedValue("a\n");
    await useFilesStore.getState().openFile("main.tex");
    useFilesStore.setState((state) => ({
      files: { ...state.files, "main.tex": { content: "a\ntyped\n", dirty: false } },
    }));
    expect(useFilesStore.getState().setContent("main.tex", "a\ntyped\n")).toBe(true);
    expect(useFilesStore.getState().files["main.tex"].dirty).toBe(false);
    useFilesStore.getState().setContent("main.tex", "a\ntyped\n", { unsaved: true });
    expect(useFilesStore.getState().files["main.tex"].dirty).toBe(true);
    await useFilesStore.getState().saveFile("main.tex");
    expect(mocks.writeFileContent).toHaveBeenCalledWith("project", "main.tex", "a\ntyped\n", 3, expect.any(String));
  });

  it("stays saved when the disk already has it", async () => {
    mocks.readFileContent.mockResolvedValue("a\n");
    await useFilesStore.getState().openFile("main.tex");
    useFilesStore.getState().setContent("main.tex", "a\n", { unsaved: true });
    expect(useFilesStore.getState().files["main.tex"].dirty).toBe(false);
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
