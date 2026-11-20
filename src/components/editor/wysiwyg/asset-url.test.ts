import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "@oleafly/backend-port";
import type { AssetThumbnail } from "@/components/editor/cm/hover-asset";

const mocks = vi.hoisted(() => ({
  readAssetThumbnail: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/components/editor/cm/hover-asset", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/editor/cm/hover-asset")>();
  return { ...actual, readAssetThumbnail: mocks.readAssetThumbnail };
});

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { useFilesStore } from "@/store/files";
import { assetCandidates, clearVisualAssetCache, resolveVisualAsset, resolveVisualAssetUrl } from "./asset-url";

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
  mocks.readAssetThumbnail.mockImplementation(async (_project: string, path: string): Promise<AssetThumbnail> => ({
    url: `data:${path}`,
  }));
  setProject("p1");
});

describe("assetCandidates", () => {
  it("tries the graphics extensions LaTeX would try, from the root and the document folders", () => {
    expect(assetCandidates("figures/plot", { activePath: "main.tex", mainDoc: "main.tex" }).paths).toEqual([
      "figures/plot",
      "figures/plot.png",
      "figures/plot.jpg",
      "figures/plot.jpeg",
      "figures/plot.svg",
      "figures/plot.pdf",
    ]);
    expect(assetCandidates("local.jpg", { activePath: "chapters/intro.tex", mainDoc: "main.tex" }).paths).toEqual([
      "local.jpg",
      "chapters/local.jpg",
    ]);
  });

  it("normalizes quotes, dots and parent segments", () => {
    expect(assetCandidates(' "./figures/../figures/plot.png" ', { activePath: null, mainDoc: "main.tex" })).toEqual({
      paths: ["figures/plot.png"],
      outside: false,
    });
    expect(assetCandidates("   ", { activePath: null, mainDoc: "main.tex" })).toEqual({ paths: [], outside: false });
  });

  it("never climbs above the project and says when a path can only point outside it", () => {
    const fromRoot = { activePath: "main.tex", mainDoc: "main.tex" };
    const fromChapter = { activePath: "chapters/intro.tex", mainDoc: "main.tex" };
    expect(assetCandidates("../shared/logo.png", fromRoot)).toEqual({ paths: [], outside: true });
    expect(assetCandidates("../figures/plot.png", fromChapter)).toEqual({ paths: ["figures/plot.png"], outside: false });
    expect(assetCandidates("../../logo.png", fromChapter)).toEqual({ paths: [], outside: true });
    for (const path of [String.raw`C:\Users\me\plot.png`, "D:/plot.png", "~/plot.png", "~", "//server/share/plot.png", "file:///tmp/plot.png"]) {
      expect(assetCandidates(path, fromRoot)).toEqual({ paths: [], outside: true });
    }
    expect(assetCandidates("/figures/plot.png", fromChapter)).toEqual({
      paths: ["figures/plot.png", "chapters/figures/plot.png"],
      outside: true,
    });
  });
});

describe("resolveVisualAssetUrl", () => {
  it("lets the filesystem resolve case aliases using the requested spelling", async () => {
    setProject("p1", "main.tex", [{ path: "figures/Plot.PNG", is_dir: false }]);
    await expect(resolveVisualAssetUrl("figures/plot.png")).resolves.toBe("data:figures/plot.png");
    expect(mocks.readAssetThumbnail).toHaveBeenCalledWith("p1", "figures/plot.png");
  });

  it("does not substitute a different file on a case-sensitive filesystem", async () => {
    setProject("p1", "main.tex", [{ path: "figures/Plot.PNG", is_dir: false }]);
    mocks.readAssetThumbnail.mockImplementation(async (_project: string, path: string) =>
      path === "figures/Plot.PNG" ? { url: "data:exact" } : { url: null, error: new Error("No such file") },
    );
    await expect(resolveVisualAssetUrl("figures/plot.png")).resolves.toBeNull();
    await expect(resolveVisualAssetUrl("figures/Plot.PNG")).resolves.toBe("data:exact");
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("keeps distinctly cased exact files separate", async () => {
    setProject("p1", "main.tex", [
      { path: "figures/Plot.PNG", is_dir: false },
      { path: "figures/plot.png", is_dir: false },
    ]);
    await expect(resolveVisualAssetUrl("figures/plot.png")).resolves.toBe("data:figures/plot.png");
    await expect(resolveVisualAssetUrl("figures/Plot.PNG")).resolves.toBe("data:figures/Plot.PNG");
  });

  it("resolves extension-less paths against the tree and caches the result", async () => {
    await expect(resolveVisualAssetUrl("figures/plot")).resolves.toBe("data:figures/plot.png");
    await expect(resolveVisualAssetUrl("figures/plot")).resolves.toBe("data:figures/plot.png");
    expect(mocks.readAssetThumbnail).toHaveBeenCalledTimes(1);
    expect(mocks.readAssetThumbnail).toHaveBeenCalledWith("p1", "figures/plot.png");
  });

  it("resolves relative to the active document folder and returns null for unknown files", async () => {
    setProject("p1", "chapters/intro.tex");
    await expect(resolveVisualAssetUrl("local")).resolves.toBe("data:chapters/local.jpg");
    await expect(resolveVisualAssetUrl("missing.png")).resolves.toBeNull();
    expect(mocks.readAssetThumbnail).toHaveBeenCalledTimes(1);
  });

  it("returns null without a project and forgets cached answers when the tree changes", async () => {
    setProject(null);
    await expect(resolveVisualAssetUrl("figures/plot.png")).resolves.toBeNull();
    setProject("p1", "main.tex", TREE.filter((entry) => entry.path !== "figures/plot.png"));
    await expect(resolveVisualAssetUrl("figures/plot.png")).resolves.toBeNull();
    setProject("p1", "main.tex", [...TREE]);
    await expect(resolveVisualAssetUrl("figures/plot.png")).resolves.toBe("data:figures/plot.png");
  });

  it("refuses a path outside the project without reading anything", async () => {
    setProject("p1", "main.tex", [...TREE, { path: "logo.png", is_dir: false }]);
    await expect(resolveVisualAssetUrl("../logo.png")).resolves.toEqual({ reason: "outside" });
    await expect(resolveVisualAssetUrl("/Users/me/plot.png")).resolves.toEqual({ reason: "outside" });
    await expect(resolveVisualAssetUrl(String.raw`C:\Users\me\plot.png`)).resolves.toEqual({ reason: "outside" });
    expect(mocks.readAssetThumbnail).not.toHaveBeenCalled();
    await expect(resolveVisualAssetUrl("/figures/plot.png")).resolves.toBe("data:figures/plot.png");
  });

  it("says a project image couldn't be shown and logs a read failure once", async () => {
    const failure: AssetThumbnail = { url: null, error: new Error("permission denied") };
    mocks.readAssetThumbnail.mockImplementation(async (_project: string, path: string) =>
      path === "figures/plot.png" ? failure : { url: null },
    );
    await expect(resolveVisualAssetUrl("figures/plot.png")).resolves.toEqual({ reason: "unreadable" });
    setProject("p1", "chapters/intro.tex");
    await expect(resolveVisualAssetUrl("figures/plot.png")).resolves.toEqual({ reason: "unreadable" });
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    expect(mocks.logError).toHaveBeenCalledWith("show the image figures/plot.png", failure.error);

    await expect(resolveVisualAssetUrl("figures/diagram.svg")).resolves.toEqual({ reason: "unreadable" });
    expect(mocks.logError).toHaveBeenCalledTimes(1);
  });
});

describe("resolveVisualAsset", () => {
  it("gives the path and URL of a found image and nothing for one it can't show", async () => {
    await expect(resolveVisualAsset("figures/plot")).resolves.toEqual({ url: "data:figures/plot.png", path: "figures/plot.png" });
    await expect(resolveVisualAsset("../outside.png")).resolves.toBeNull();
    mocks.readAssetThumbnail.mockResolvedValue({ url: null });
    await expect(resolveVisualAsset("figures/diagram.svg")).resolves.toBeNull();
  });
});
