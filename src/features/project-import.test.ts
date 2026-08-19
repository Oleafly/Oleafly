import { beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "@/store/toast";
import { CONVERSION_NOTICE } from "@/features/import-copy";

const mocks = vi.hoisted(() => ({
  ensurePandoc: vi.fn(),
  githubImportRepo: vi.fn(),
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
  importFileKind,
  importGitHubRepository,
  importSelectedFile,
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
      expect(mocks.importDocument).toHaveBeenCalledWith(path);
      expect(mocks.refreshProjects).toHaveBeenCalledOnce();
      expect(mocks.openProject).toHaveBeenCalledWith("converted-project");
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({ kind: "success", message: CONVERSION_NOTICE }),
      ]);
    },
  );

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
