// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "@oleafly/backend-port";

const mocks = vi.hoisted(() => ({
  writeProjectBytes: vi.fn(),
  uint8ToBase64: vi.fn(() => "QUJD"),
  notifyProjectFilesChanged: vi.fn(),
  clearThumbnailCache: vi.fn(),
  notifyError: vi.fn(),
  locked: vi.fn(() => false),
}));

vi.mock("@/lib/tauri", () => ({
  writeProjectBytes: mocks.writeProjectBytes,
  uint8ToBase64: mocks.uint8ToBase64,
}));
vi.mock("@/lib/cross-window", () => ({ notifyProjectFilesChanged: mocks.notifyProjectFilesChanged }));
vi.mock("@/components/editor/cm/hover-asset", () => ({ clearThumbnailCache: mocks.clearThumbnailCache }));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError, toast: { success: vi.fn() } }));
vi.mock("@/lib/editor-mutation-lease", () => ({ isEditorMutationLocked: () => mocks.locked() }));

import { useFilesStore } from "@/store/files";
import {
  figureDirectory,
  importableImageFiles,
  importImageFile,
  isImportableImagePath,
  latexGraphicsPath,
  pastedImagePath,
  preferredImageName,
  suggestedFigureLabel,
  timestampedImageName,
  uniqueProjectPath,
} from "./figure-import";

const NOW = new Date(2026, 8, 16, 14, 25, 30);
const TREE: FileEntry[] = [
  { path: "figures", is_dir: true },
  { path: "figures/plot.png", is_dir: false },
  { path: "main.tex", is_dir: false },
];

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locked.mockReturnValue(false);
  mocks.writeProjectBytes.mockResolvedValue({ generation: 1 });
  useFilesStore.setState({
    projectId: "p1",
    mainDoc: "main.tex",
    tree: TREE,
    refreshTree: vi.fn(async () => {}),
  } as never);
});

describe("file selection", () => {
  it("accepts png, jpeg, svg and pdf files only", () => {
    const files = [
      file("a.png", "image/png"),
      file("b.jpg", "image/jpeg"),
      file("c.svg", "image/svg+xml"),
      file("d.pdf", "application/pdf"),
      file("e.gif", "image/gif"),
      file("f.txt", "text/plain"),
    ];
    expect(importableImageFiles(files).map((entry) => entry.name)).toEqual(["a.png", "b.jpg", "c.svg", "d.pdf"]);
    expect(importableImageFiles(null)).toEqual([]);
  });

  it("recognizes importable project paths", () => {
    expect(isImportableImagePath("figures/A.PNG")).toBe(true);
    expect(isImportableImagePath("plot.pdf")).toBe(true);
    expect(isImportableImagePath("main.tex")).toBe(false);
  });
});

describe("naming", () => {
  it("uses the figures folder when it exists and the main document folder otherwise", () => {
    expect(figureDirectory(TREE, "main.tex")).toBe("figures");
    expect(figureDirectory([{ path: "src/main.tex", is_dir: false }], "src/main.tex")).toBe("src");
    expect(figureDirectory([], "main.tex")).toBe("");
  });

  it("keeps meaningful clipboard names, sanitized, and stamps generic ones", () => {
    expect(preferredImageName(file("My Chart (v2).png", "image/png"), NOW)).toBe("My-Chart-v2.png");
    expect(preferredImageName(file("image.png", "image/png"), NOW)).toBe("pasted-image-20260916-142530.png");
    expect(preferredImageName(file("", "image/jpeg"), NOW)).toBe("pasted-image-20260916-142530.jpg");
    expect(preferredImageName(file("scan", "application/pdf"), NOW)).toBe("scan.pdf");
    expect(timestampedImageName(new Date(2026, 0, 2, 3, 4, 5), "svg")).toBe("pasted-image-20260102-030405.svg");
  });

  it("makes paths unique against the tree, case-insensitively", () => {
    expect(uniqueProjectPath("figures/plot.png", TREE)).toBe("figures/plot-2.png");
    expect(uniqueProjectPath("figures/PLOT.png", [...TREE, { path: "figures/plot-2.png", is_dir: false }])).toBe(
      "figures/PLOT-3.png",
    );
    expect(uniqueProjectPath("notes", [{ path: "notes", is_dir: false }])).toBe("notes-2");
    expect(pastedImagePath(file("plot.png", "image/png"), TREE, "main.tex", NOW)).toBe("figures/plot-2.png");
  });

  it("writes graphics paths relative to the main document and suggests labels", () => {
    expect(latexGraphicsPath("figures/plot.png", "main.tex")).toBe("figures/plot.png");
    expect(latexGraphicsPath("figures/plot.png", "src/main.tex")).toBe("../figures/plot.png");
    expect(latexGraphicsPath("src/figures/plot.png", "src/main.tex")).toBe("figures/plot.png");
    expect(suggestedFigureLabel("figures/My Chart_v2.PNG")).toBe("fig:my-chart-v2");
    expect(suggestedFigureLabel("figures/---.png")).toBe("fig:figure");
  });
});

describe("importImageFile", () => {
  it("writes the bytes, refreshes the tree and reports both paths", async () => {
    const result = await importImageFile(file("diagram.png", "image/png"));
    expect(result).toEqual({ path: "figures/diagram.png", latexPath: "figures/diagram.png" });
    expect(mocks.writeProjectBytes).toHaveBeenCalledWith("p1", "figures/diagram.png", "QUJD");
    expect(mocks.clearThumbnailCache).toHaveBeenCalledOnce();
    expect(useFilesStore.getState().refreshTree).toHaveBeenCalledOnce();
    expect(mocks.notifyProjectFilesChanged).toHaveBeenCalledWith("p1", ["figures/diagram.png"]);
  });

  it("reports failures through a toast and returns null", async () => {
    mocks.writeProjectBytes.mockRejectedValue(new Error("disk full"));
    await expect(importImageFile(file("diagram.png", "image/png"))).resolves.toBeNull();
    expect(mocks.notifyError).toHaveBeenCalledOnce();
    expect(useFilesStore.getState().refreshTree).not.toHaveBeenCalled();
  });

  it("refuses without a project or while the document is leased", async () => {
    mocks.locked.mockReturnValue(true);
    await expect(importImageFile(file("diagram.png", "image/png"))).resolves.toBeNull();
    expect(mocks.writeProjectBytes).not.toHaveBeenCalled();
    useFilesStore.setState({ projectId: null } as never);
    mocks.locked.mockReturnValue(false);
    await expect(importImageFile(file("diagram.png", "image/png"))).resolves.toBeNull();
    expect(mocks.notifyError).toHaveBeenCalledOnce();
  });
});
