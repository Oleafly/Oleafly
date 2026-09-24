import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { useToastStore } from "@/store/toast";

const mocks = vi.hoisted(() => ({
  files: { projectId: null as string | null },
  ensurePandoc: vi.fn(),
  githubImportRepo: vi.fn(),
  importArxivEprint: vi.fn(),
  importDocument: vi.fn(),
  importProject: vi.fn(),
  openProject: vi.fn(),
  refreshProjects: vi.fn(),
}));

vi.mock("@/features/pandoc", () => ({
  ensurePandoc: mocks.ensurePandoc,
}));

vi.mock("@/lib/github", () => ({
  githubImportRepo: mocks.githubImportRepo,
}));

vi.mock("@/lib/tauri", () => ({
  importDocument: mocks.importDocument,
  importArxivEprint: mocks.importArxivEprint,
}));

vi.mock("@/store/files", () => ({
  useFilesStore: {
    getState: () => ({
      projectId: mocks.files.projectId,
      importProject: mocks.importProject,
      openProject: mocks.openProject,
      refreshProjects: mocks.refreshProjects,
    }),
  },
}));

import {
  importArxivPaper,
  importFileKind,
  importGitHubRepository,
  importSelectedFile,
  importTargetsForKind,
  normalizeArxivImportId,
} from "./project-import";

function notice(format: string): string {
  return i18n.t(($) => $.core.import.conversionNotice, { format });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.projectId = null;
  mocks.ensurePandoc.mockResolvedValue(true);
  mocks.githubImportRepo.mockResolvedValue("github-project");
  mocks.importDocument.mockResolvedValue("converted-project");
  mocks.importProject.mockResolvedValue("archive-project");
  mocks.openProject.mockImplementation(async (id: string) => {
    mocks.files.projectId = id;
  });
  mocks.refreshProjects.mockResolvedValue(undefined);
  useToastStore.getState().reset();
});

describe("project import file detection", () => {
  it("classifies every supported file type", () => {
    expect(importFileKind("Paper.ZIP")).toBe("project");
    expect(importFileKind("Draft.docx")).toBe("word");
    expect(importFileKind("notes.md")).toBe("markdown");
    expect(importFileKind("notes.markdown")).toBe("markdown");
    expect(importFileKind("page.html")).toBe("html");
    expect(importFileKind("page.htm")).toBe("html");
    expect(importFileKind("paper.typ")).toBe("typst");
    expect(importFileKind("notes.txt")).toBeNull();
  });
});

describe("project file import", () => {
  it("keeps ZIP archives on the existing project importer", async () => {
    await expect(importSelectedFile("/tmp/paper.zip")).resolves.toBe(true);

    expect(mocks.importProject).toHaveBeenCalledWith("/tmp/paper.zip");
    expect(mocks.ensurePandoc).not.toHaveBeenCalled();
    expect(mocks.importDocument).not.toHaveBeenCalled();
  });

  it.each(["/tmp/paper.docx", "/tmp/paper.md", "/tmp/paper.markdown"])(
    "converts %s to LaTeX and shows the conversion notice",
    async (path) => {
      await expect(importSelectedFile(path)).resolves.toBe(true);

      expect(mocks.ensurePandoc).toHaveBeenCalledExactlyOnceWith({ notify: true });
      expect(mocks.importDocument).toHaveBeenCalledWith(path, "latex");
      expect(mocks.refreshProjects).toHaveBeenCalledOnce();
      expect(mocks.openProject).toHaveBeenCalledWith("converted-project");
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({ key: "import-conversion", kind: "info", message: notice("LaTeX") }),
      ]);
    },
  );

  it.each([
    ["/tmp/page.html", "latex", "LaTeX"],
    ["/tmp/page.html", "typst", "Typst"],
    ["/tmp/paper.typ", "markdown", "Markdown"],
  ] as const)("converts %s into the requested %s project and names that format", async (path, target, format) => {
    await expect(importSelectedFile(path, target)).resolves.toBe(true);

    expect(mocks.importDocument).toHaveBeenCalledWith(path, target);
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([notice(format)]);
  });

  it("keeps one conversion notice when imports follow each other", async () => {
    await importSelectedFile("/tmp/a.docx");
    await importSelectedFile("/tmp/b.docx");

    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("shows no conversion notice when the converted project did not open", async () => {
    mocks.openProject.mockResolvedValue(undefined);

    await expect(importSelectedFile("/tmp/paper.docx")).resolves.toBe(true);

    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("imports an arXiv e-print by id and lets the opened project confirm it", async () => {
    mocks.importArxivEprint.mockResolvedValue("arxiv-project");

    await expect(importArxivPaper("arXiv:2301.01234")).resolves.toBe(true);

    expect(mocks.importArxivEprint).toHaveBeenCalledWith("2301.01234");
    expect(mocks.openProject).toHaveBeenCalledWith("arxiv-project");
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("stops cleanly when Pandoc installation is declined", async () => {
    mocks.ensurePandoc.mockResolvedValue(false);

    await expect(importSelectedFile("/tmp/paper.md")).resolves.toBe(false);

    expect(mocks.importDocument).not.toHaveBeenCalled();
    expect(mocks.refreshProjects).not.toHaveBeenCalled();
    expect(mocks.openProject).not.toHaveBeenCalled();
  });
});

describe("GitHub repository import", () => {
  it("imports the linked repository and opens the project", async () => {
    const repository = {
      full_name: "oleafly/example-paper",
      html_url: "https://github.com/oleafly/example-paper",
      clone_url: "https://github.com/oleafly/example-paper.git",
      private: false,
    };

    await importGitHubRepository(repository);

    expect(mocks.githubImportRepo).toHaveBeenCalledWith(repository.full_name);
    expect(mocks.refreshProjects).toHaveBeenCalledOnce();
    expect(mocks.openProject).toHaveBeenCalledWith("github-project");
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});


describe("import route and identifier validation", () => {
  it("derives the supported target types from the registry", () => {
    expect(importTargetsForKind("html").map((item) => item.target)).toEqual(["latex", "markdown", "typst"]);
    expect(importTargetsForKind("typst").map((item) => item.target)).toEqual(["latex", "markdown"]);
    expect(importTargetsForKind("project")).toEqual([]);
  });
  it.each([
    ["https://arxiv.org/abs/2301.01234v2?context=cs", "2301.01234v2"],
    ["https://arxiv.org/pdf/math.GT/0309136v1.pdf", "math.GT/0309136v1"],
    [" arXiv: 2301.01234 ", "2301.01234"],
  ])("accepts paper link or id %s", (input, expected) => {
    expect(normalizeArxivImportId(input)).toBe(expected);
  });
  it.each(["https://arxiv.org.evil.test/abs/2301.01234", "https://example.com/2301.01234", "", "../2301.01234", "2301.01234v0"])("rejects invalid id %s", (input) => {
    expect(() => normalizeArxivImportId(input)).toThrow("arXiv");
  });
  it("rejects unsupported target types before installing the converter", async () => {
    await expect(importSelectedFile("/tmp/paper.typ", "typst")).rejects.toThrow("project types");
    expect(mocks.ensurePandoc).not.toHaveBeenCalled();
    expect(mocks.importDocument).not.toHaveBeenCalled();
  });
});
