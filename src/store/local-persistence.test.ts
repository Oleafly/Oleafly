import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({ setProjectColor: vi.fn(() => Promise.resolve()) }));

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("stores that persist to localStorage", () => {
  it("reloads favorites and project colors written by earlier versions", async () => {
    localStorage.setItem("oleafly.favorites", JSON.stringify(["p1"]));
    localStorage.setItem("oleafly.projectColors", JSON.stringify({ p1: "#123456" }));
    const { useFavoritesStore } = await import("./favorites");
    const { useProjectColorsStore } = await import("./project-colors");
    expect(useFavoritesStore.getState().favs).toEqual(["p1"]);
    expect(useProjectColorsStore.getState().get("p1")).toBe("#123456");

    useFavoritesStore.getState().toggle("p2");
    useProjectColorsStore.getState().setColor("p2", "#abcdef");
    expect(JSON.parse(localStorage.getItem("oleafly.favorites") ?? "null")).toEqual(["p1", "p2"]);
    expect(JSON.parse(localStorage.getItem("oleafly.projectColors") ?? "null")).toEqual({
      p1: "#123456",
      p2: "#abcdef",
    });
  });

  it("falls back to empty favorites and colors when storage holds garbage", async () => {
    localStorage.setItem("oleafly.favorites", "{broken");
    localStorage.setItem("oleafly.projectColors", "");
    const { useFavoritesStore } = await import("./favorites");
    const { useProjectColorsStore } = await import("./project-colors");
    expect(useFavoritesStore.getState().favs).toEqual([]);
    expect(useProjectColorsStore.getState().colors).toEqual({});
  });

  it("keeps only well-formed saved citations", async () => {
    const valid = { id: "doi:1", bibtex: "@article{a}", savedAt: 1, record: { title: "A" } };
    localStorage.setItem(
      "oleafly.literature-library.v1",
      JSON.stringify([valid, { id: "doi:2" }, null]),
    );
    const { useLiteratureLibraryStore } = await import("./literature");
    expect(useLiteratureLibraryStore.getState().saved).toEqual([valid]);

    useLiteratureLibraryStore.getState().remove("doi:1");
    expect(localStorage.getItem("oleafly.literature-library.v1")).toBe("[]");

    localStorage.setItem("oleafly.literature-library.v1", JSON.stringify({ not: "a list" }));
    vi.resetModules();
    const reloaded = await import("./literature");
    expect(reloaded.useLiteratureLibraryStore.getState().saved).toEqual([]);
  });

  it("loads and writes project agent memory", async () => {
    localStorage.setItem(
      "oleafly.agent-memory.p1",
      JSON.stringify([{ id: "m1", content: "Use British spelling", createdAt: 1 }]),
    );
    localStorage.setItem("oleafly.agent-memory.p2", JSON.stringify({ not: "a list" }));
    const { useAgentMemoryStore } = await import("./agent-memory");
    useAgentMemoryStore.getState().load("p2");
    expect(useAgentMemoryStore.getState().notes).toEqual([]);
    useAgentMemoryStore.getState().load("p1");
    expect(useAgentMemoryStore.getState().notes.map((note) => note.content)).toEqual([
      "Use British spelling",
    ]);

    useAgentMemoryStore.getState().clear();
    expect(localStorage.getItem("oleafly.agent-memory.p1")).toBe("[]");
  });

  it("remembers the diff layout and the detached preview", async () => {
    localStorage.setItem("oleafly.diffMode", "unified");
    const { useDiffStore } = await import("./diff");
    const { setPreviewDetached, wantsDetachedPreview } = await import("./preview-detached");
    expect(useDiffStore.getState().mode).toBe("unified");

    useDiffStore.getState().setMode("split");
    expect(localStorage.getItem("oleafly.diffMode")).toBe("split");

    expect(wantsDetachedPreview("p1")).toBe(false);
    setPreviewDetached("p1", true);
    expect(wantsDetachedPreview("p1")).toBe(true);
    expect(localStorage.getItem("oleafly.preview.detached.p1")).toBe("true");
  });
});
