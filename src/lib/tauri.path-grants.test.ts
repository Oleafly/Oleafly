import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));

import { mcpAdoptAlphaXivKey, pickOpenPaths, pickSaveDestination } from "@/lib/tauri";

describe("dialogs and keys that stay in Rust", () => {
  beforeEach(() => invoke.mockReset());

  it("asks Rust for the open dialog, with or without options", async () => {
    invoke.mockResolvedValue(["/home/a/refs.bib"]);
    await expect(
      pickOpenPaths({ multiple: true, filters: [{ name: "BibTeX", extensions: ["bib"] }] }),
    ).resolves.toEqual(["/home/a/refs.bib"]);
    expect(invoke).toHaveBeenLastCalledWith("pick_open_paths", {
      options: { multiple: true, filters: [{ name: "BibTeX", extensions: ["bib"] }] },
    });

    invoke.mockResolvedValue(null);
    await expect(pickOpenPaths()).resolves.toBeNull();
    expect(invoke).toHaveBeenLastCalledWith("pick_open_paths", { options: null });
  });

  it("asks Rust for the save dialog, with or without options", async () => {
    invoke.mockResolvedValue("/home/a/paper.pdf");
    await expect(pickSaveDestination({ defaultPath: "paper.pdf" })).resolves.toBe(
      "/home/a/paper.pdf",
    );
    expect(invoke).toHaveBeenLastCalledWith("pick_save_path", {
      options: { defaultPath: "paper.pdf" },
    });

    invoke.mockResolvedValue(null);
    await expect(pickSaveDestination()).resolves.toBeNull();
    expect(invoke).toHaveBeenLastCalledWith("pick_save_path", { options: null });
  });

  it("moves a legacy alphaXiv key without sending one", async () => {
    invoke.mockResolvedValue(null);
    await expect(mcpAdoptAlphaXivKey()).resolves.toBeNull();
    expect(invoke).toHaveBeenLastCalledWith("mcp_adopt_alphaxiv_key");
  });
});
