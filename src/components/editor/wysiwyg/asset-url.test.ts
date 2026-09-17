import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "@oleafly/backend-port";

const mocks = vi.hoisted(() => ({
  loadAssetThumbnail: vi.fn(),
}));

vi.mock("@/components/editor/cm/hover-asset", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/editor/cm/hover-asset")>();
  return { ...actual, loadAssetThumbnail: mocks.loadAssetThumbnail };
});

import { useFilesStore } from "@/store/files";
import { candidateAssetPaths, clearVisualAssetCache, resolveVisualAssetUrl } from "./asset-url";

const TREE: FileEntry[] = [
  { path: "figures", is_dir: true },
  { path: "figures/plot.png", is_dir: false },
  { path: "figures/diagram.svg", is_dir: false },
  { path: "chapters/intro.tex", is_dir: false },
  { path: "chapters/local.jpg", is_dir: false },
  { path: "main.tex", is_dir: false },
];

function setProject(projectId: string | null, activePath = "main.tex", tree: FileEntry[] = TREE): void {
  useFilesStore.setState({ projectId, activePath, mainDoc: "main.tex", tree } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  clearVisualAssetCache();
  mocks.loadAssetThumbnail.mockImplementation(async (_project: string, path: string) => `data:${path}`);
  setProject("p1");
});

describe("candidateAssetPaths", () => {
  it("tries the graphics extensions LaTeX would try, from the root and the document folders", () => {
    expect(candidateAssetPaths("figures/plot", { activePath: "main.tex", mainDoc: "main.tex" })).toEqual([
      "figures/plot",
      "figures/plot.png",
      "figures/plot.jpg",
      "figures/plot.jpeg",
      "figures/plot.svg",
      "figures/plot.pdf",
    ]);
    expect(candidateAssetPaths("local.jpg", { activePath: "chapters/intro.tex", mainDoc: "main.tex" })).toEqual([
      "local.jpg",
      "chapters/local.jpg",
    ]);
  });

  it("normalizes quotes, dots and parent segments", () => {
    expect(candidateAssetPaths(' "./figures/../figures/plot.png" ', { activePath: null, mainDoc: "main.tex" })).toEqual([
      "figures/plot.png",
    ]);
    expect(candidateAssetPaths("   ", { activePath: null, mainDoc: "main.tex" })).toEqual([]);
  });
});

describe("resolveVisualAssetUrl", () => {
  it("resolves extension-less paths against the tree and caches the result", async () => {
    await expect(resolveVisualAssetUrl("figures/plot")).resolves.toBe("data:figures/plot.png");
    await expect(resolveVisualAssetUrl("figures/plot")).resolves.toBe("data:figures/plot.png");
    expect(mocks.loadAssetThumbnail).toHaveBeenCalledTimes(1);
    expect(mocks.loadAssetThumbnail).toHaveBeenCalledWith("p1", "figures/plot.png");
  });

  it("resolves relative to the active document folder and returns null for unknown files", async () => {
    setProject("p1", "chapters/intro.tex");
    await expect(resolveVisualAssetUrl("local")).resolves.toBe("data:chapters/local.jpg");
    await expect(resolveVisualAssetUrl("missing.png")).resolves.toBeNull();
    expect(mocks.loadAssetThumbnail).toHaveBeenCalledTimes(1);
  });

  it("returns null without a project and forgets cached answers when the tree changes", async () => {
    setProject(null);
    await expect(resolveVisualAssetUrl("figures/plot.png")).resolves.toBeNull();
    setProject("p1", "main.tex", TREE.filter((entry) => entry.path !== "figures/plot.png"));
    await expect(resolveVisualAssetUrl("figures/plot.png")).resolves.toBeNull();
    setProject("p1", "main.tex", [...TREE]);
    await expect(resolveVisualAssetUrl("figures/plot.png")).resolves.toBe("data:figures/plot.png");
  });
});
