import { beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "@/store/toast";
import { conversionNotice } from "@/features/import-copy";

const mocks = vi.hoisted(() => ({
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensurePandoc.mockResolvedValue(true);
  mocks.githubImportRepo.mockResolvedValue("github-project");
  mocks.importDocument.mockResolvedValue("converted-project");
  mocks.importProject.mockResolvedValue("archive-project");
  mocks.openProject.mockResolvedValue(undefined);
  mocks.refreshProjects.mockResolvedValue(undefined);
  useToastStore.setState({ toasts: [] });
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

      expect(mocks.ensurePandoc).toHaveBeenCalledOnce();
      expect(mocks.importDocument).toHaveBeenCalledWith(path, "latex");
      expect(mocks.refreshProjects).toHaveBeenCalledOnce();
      expect(mocks.openProject).toHaveBeenCalledWith("converted-project");
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({ kind: "success", message: conversionNotice() }),
      ]);
    },
  );

  it.each([
    ["/tmp/page.html", "latex"],
    ["/tmp/page.html", "typst"],
    ["/tmp/paper.typ", "markdown"],
  ] as const)("converts %s into the requested %s project", async (path, target) => {
    await expect(importSelectedFile(path, target)).resolves.toBe(true);

    expect(mocks.importDocument).toHaveBeenCalledWith(path, target);
  });

  it("imports an arXiv e-print by id", async () => {
    mocks.importArxivEprint.mockResolvedValue("arxiv-project");

    await expect(importArxivPaper("arXiv:2301.01234")).resolves.toBe(true);

    expect(mocks.importArxivEprint).toHaveBeenCalledWith("2301.01234");
    expect(mocks.openProject).toHaveBeenCalledWith("arxiv-project");
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
