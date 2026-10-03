import { beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";

const tauri = vi.hoisted(() => ({
  projectFileSizes: vi.fn(),
  readProjectBytes: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return { ...actual, ...tauri };
});

import { MAX_MEASURED_IMAGES, measureImageSizes, typstPreflightInputs, typstVersionFor } from "./preflight-typst";

beforeEach(() => {
  tauri.projectFileSizes.mockReset();
  tauri.readProjectBytes.mockReset();
});

describe("typstVersionFor", () => {
  it("uses the resolved version and falls back to the bundled one", () => {
    expect(typstVersionFor({ ...LATEX_ENGINE, typst_resolved: { version: "0.14.2", source: "system" } })).toBe("0.14.2");
    expect(typstVersionFor({ ...LATEX_ENGINE, typst_resolved: null })).toBe("0.15.1");
    expect(typstVersionFor(LATEX_ENGINE)).toBe("0.15.1");
  });
});

describe("measureImageSizes", () => {
  it("asks for every image size in one call without reading the files", async () => {
    tauri.projectFileSizes.mockResolvedValue({ "bb.png": 6, "a.png": 50_000_000 });
    const sizes = await measureImageSizes("p", ["a.png", "bb.png", "a.png", "gone.png"]);
    expect([...sizes]).toEqual([
      ["a.png", 50_000_000],
      ["bb.png", 6],
    ]);
    expect(tauri.projectFileSizes).toHaveBeenCalledOnce();
    expect(tauri.projectFileSizes).toHaveBeenCalledWith("p", ["a.png", "bb.png", "gone.png"]);
    expect(tauri.readProjectBytes).not.toHaveBeenCalled();
  });

  it("stops after a fixed number of images", async () => {
    tauri.projectFileSizes.mockResolvedValue({});
    const paths = Array.from({ length: MAX_MEASURED_IMAGES + 10 }, (_, index) => `img${index}.png`);
    await measureImageSizes("p", paths);
    expect(tauri.projectFileSizes.mock.calls[0][1]).toHaveLength(MAX_MEASURED_IMAGES);
  });

  it("skips the call when nothing is referenced and returns no sizes when it fails", async () => {
    await expect(measureImageSizes("p", [])).resolves.toEqual(new Map());
    expect(tauri.projectFileSizes).not.toHaveBeenCalled();
    tauri.projectFileSizes.mockRejectedValue(new Error("project lock timed out"));
    await expect(measureImageSizes("p", ["a.png"])).resolves.toEqual(new Map());
  });
});

describe("typstPreflightInputs", () => {
  it("adds sizes to the referenced images only", async () => {
    tauri.projectFileSizes.mockResolvedValue({ "a.png": 3 });
    const inputs = await typstPreflightInputs(
      "p",
      {
        mainFile: "main.typ",
        files: [{ path: "main.typ", content: '#image("a.png")' }, { path: "a.png" }, { path: "b.png" }],
      },
      LATEX_ENGINE,
    );
    expect(inputs.typstVersion).toBe("0.15.1");
    expect(inputs.project.files).toEqual([
      { path: "main.typ", content: '#image("a.png")' },
      { path: "a.png", size: 3 },
      { path: "b.png" },
    ]);
  });

  it("skips measuring without a project id", async () => {
    const inputs = await typstPreflightInputs(
      null,
      { mainFile: "main.typ", files: [{ path: "main.typ", content: '#image("a.png")' }, { path: "a.png" }] },
      LATEX_ENGINE,
    );
    expect(tauri.projectFileSizes).not.toHaveBeenCalled();
    expect(inputs.project.files[1]).toEqual({ path: "a.png" });
  });
});
