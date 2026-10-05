// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeProjectBytes: vi.fn(async () => ({ generation: 1 })),
  notifyError: vi.fn(),
  notifyProjectFilesChanged: vi.fn(),
  clearThumbnailCache: vi.fn(),
  locked: false,
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  writeProjectBytes: mocks.writeProjectBytes,
}));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/cross-window", () => ({ notifyProjectFilesChanged: mocks.notifyProjectFilesChanged }));
vi.mock("@/components/editor/cm/hover-asset", () => ({ clearThumbnailCache: mocks.clearThumbnailCache }));
vi.mock("@/lib/editor-mutation-lease", () => ({ isEditorMutationLocked: () => mocks.locked }));

import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { useFilesStore } from "@/store/files";
import {
  availableTopLevelName,
  importDroppedItems,
  plannedPaths,
  readDroppedFiles,
  takeDroppedItems,
  type DroppedItem,
} from "./dropped-files";

function fileEntry(name: string, content = name): FileSystemFileEntry {
  return {
    name,
    isFile: true,
    isDirectory: false,
    file: (resolve: (file: File) => void) => resolve(new File([content], name)),
  } as unknown as FileSystemFileEntry;
}

function folderEntry(name: string, children: FileSystemEntry[], batch = 2): FileSystemDirectoryEntry {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let offset = 0;
      return {
        readEntries: (resolve: (entries: FileSystemEntry[]) => void) => {
          const next = children.slice(offset, offset + batch);
          offset += next.length;
          resolve(next);
        },
      };
    },
  } as unknown as FileSystemDirectoryEntry;
}

const refreshTree = vi.fn(async () => {});

beforeEach(() => {
  mocks.writeProjectBytes.mockClear();
  mocks.notifyError.mockClear();
  mocks.notifyProjectFilesChanged.mockClear();
  mocks.clearThumbnailCache.mockClear();
  mocks.locked = false;
  refreshTree.mockClear();
  useFilesStore.setState({
    projectId: "project",
    tree: [
      { path: "main.tex", is_dir: false },
      { path: "figures", is_dir: true },
      { path: "figures/plot.png", is_dir: false },
    ],
    refreshTree,
  } as never);
});

describe("plannedPaths", () => {
  it("keeps names that are free and numbers the ones that are taken, like Import files does", () => {
    const files = [
      { item: 0, path: "plot.png", file: new File([""], "plot.png") },
      { item: 1, path: "notes.md", file: new File([""], "notes.md") },
      { item: 2, path: "plot.png", file: new File([""], "plot.png") },
    ];
    expect(plannedPaths("figures", files, useFilesStore.getState().tree)).toEqual([
      "figures/plot (2).png",
      "figures/notes.md",
      "figures/plot (3).png",
    ]);
  });

  it("renames a dropped folder once and keeps its contents together", () => {
    const files = [
      { item: 0, path: "figures/a.png", file: new File([""], "a.png") },
      { item: 0, path: "figures/sub/b.png", file: new File([""], "b.png") },
    ];
    expect(plannedPaths("", files, useFilesStore.getState().tree)).toEqual([
      "figures (2)/a.png",
      "figures (2)/sub/b.png",
    ]);
  });

  it("compares names without case", () => {
    expect(availableTopLevelName("", "MAIN.tex", new Set(["main.tex"]))).toBe("MAIN (2).tex");
    expect(availableTopLevelName("", "README", new Set(["readme"]))).toBe("README (2)");
  });
});

describe("readDroppedFiles", () => {
  it("expands dropped folders across reader batches and keeps plain files", async () => {
    const items: DroppedItem[] = [
      { entry: folderEntry("assets", [fileEntry("a.png"), folderEntry("deep", [fileEntry("b.png")]), fileEntry("c.png")]), file: null },
      { entry: fileEntry("refs.bib"), file: null },
      { entry: null, file: new File(["x"], "loose.txt") },
    ];
    const files = await readDroppedFiles(items);
    expect(files.map(({ path }) => path)).toEqual([
      "assets/a.png",
      "assets/deep/b.png",
      "assets/c.png",
      "refs.bib",
      "loose.txt",
    ]);
  });

  it("reads a dropped file directly instead of through an entry WebKit cannot open", async () => {
    const file = new File(["bytes"], "figure.png");
    const unreadable = {
      name: "figure.png",
      isFile: true,
      isDirectory: false,
      file: (_resolve: (file: File) => void, reject: (error: Error) => void) =>
        reject(new DOMException("gone", "NotFoundError")),
    } as unknown as FileSystemFileEntry;
    await expect(readDroppedFiles([{ entry: unreadable, file }])).resolves.toEqual([
      { item: 0, path: "figure.png", file },
    ]);
  });

  it("falls back to the file list when the drop has no items", () => {
    const file = new File(["x"], "only.txt");
    const items = takeDroppedItems({ items: [], files: [file] } as unknown as DataTransfer);
    expect(items).toEqual([{ entry: null, file }]);
  });
});

describe("importDroppedItems", () => {
  it("writes each dropped file into the folder, then refreshes the tree once", async () => {
    const items: DroppedItem[] = [
      { entry: null, file: new File(["hi"], "plot.png") },
      { entry: fileEntry("chart.svg", "<svg/>"), file: null },
    ];
    await expect(importDroppedItems("figures", items)).resolves.toEqual([
      "figures/plot (2).png",
      "figures/chart.svg",
    ]);
    expect(mocks.writeProjectBytes).toHaveBeenNthCalledWith(1, "project", "figures/plot (2).png", "aGk=");
    expect(mocks.writeProjectBytes).toHaveBeenNthCalledWith(2, "project", "figures/chart.svg", "PHN2Zy8+");
    expect(refreshTree).toHaveBeenCalledTimes(1);
    expect(mocks.clearThumbnailCache).toHaveBeenCalledTimes(1);
    expect(mocks.notifyProjectFilesChanged).toHaveBeenCalledWith("project", [
      "figures/plot (2).png",
      "figures/chart.svg",
    ]);
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("reports a failed write and still shows the files that made it", async () => {
    mocks.writeProjectBytes
      .mockResolvedValueOnce({ generation: 1 })
      .mockRejectedValueOnce(new Error("disk full"));
    const items: DroppedItem[] = [
      { entry: null, file: new File(["a"], "a.txt") },
      { entry: null, file: new File(["b"], "b.txt") },
    ];
    await expect(importDroppedItems("", items)).resolves.toEqual(["a.txt"]);
    expect(mocks.notifyError).toHaveBeenCalledWith(
      "import dropped files",
      expect.any(Error),
      enCore.project.importFailed,
    );
    expect(refreshTree).toHaveBeenCalledTimes(1);
  });

  it("writes nothing while another change holds the project", async () => {
    mocks.locked = true;
    await expect(
      importDroppedItems("", [{ entry: null, file: new File(["a"], "a.txt") }]),
    ).resolves.toEqual([]);
    expect(mocks.writeProjectBytes).not.toHaveBeenCalled();
    expect(mocks.notifyError).toHaveBeenCalledOnce();
    expect(refreshTree).not.toHaveBeenCalled();
  });

  it("does nothing without an open project", async () => {
    useFilesStore.setState({ projectId: null });
    await expect(
      importDroppedItems("", [{ entry: null, file: new File(["a"], "a.txt") }]),
    ).resolves.toEqual([]);
    expect(mocks.writeProjectBytes).not.toHaveBeenCalled();
  });
});
