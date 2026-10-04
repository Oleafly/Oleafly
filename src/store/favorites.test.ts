import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

async function loadStore() {
  return (await import("./favorites")).useFavoritesStore;
}

describe("favorites store", () => {
  it("starts from the saved favorites", async () => {
    localStorage.setItem("oleafly.favorites", JSON.stringify(["p1", "p2"]));

    const store = await loadStore();

    expect(store.getState().favs).toEqual(["p1", "p2"]);
    expect(store.getState().isFav("p2")).toBe(true);
    expect(store.getState().isFav("p3")).toBe(false);
  });

  it("toggles a project in and out of favorites and saves each change", async () => {
    const store = await loadStore();

    store.getState().toggle("p1");
    expect(store.getState().favs).toEqual(["p1"]);
    expect(JSON.parse(localStorage.getItem("oleafly.favorites") ?? "[]")).toEqual(["p1"]);

    store.getState().toggle("p1");
    expect(store.getState().favs).toEqual([]);
    expect(JSON.parse(localStorage.getItem("oleafly.favorites") ?? "null")).toEqual([]);
  });

  it("removes a favorite and leaves the others", async () => {
    localStorage.setItem("oleafly.favorites", JSON.stringify(["p1", "p2"]));
    const store = await loadStore();

    store.getState().remove("p1");
    store.getState().remove("missing");

    expect(store.getState().favs).toEqual(["p2"]);
    expect(JSON.parse(localStorage.getItem("oleafly.favorites") ?? "[]")).toEqual(["p2"]);
  });
});
