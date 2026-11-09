// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RAIL_ORDER_KEY,
  applyRailOrder,
  mergeRailOrder,
  parseRailOrder,
  readRailOrder,
  useRailOrder,
  writeRailOrder,
} from "./rail-order";

const REGISTERED = ["files", "search", "source", "preflight", "refs", "collab", "mcp"];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseRailOrder", () => {
  it("reads a list of ids and drops duplicates, blanks and other values", () => {
    expect(parseRailOrder(JSON.stringify(["refs", "files", "refs", "", 4, null, "search"]))).toEqual([
      "refs",
      "files",
      "search",
    ]);
  });

  it("returns nothing for missing, malformed or non-list values", () => {
    expect(parseRailOrder(null)).toBeNull();
    expect(parseRailOrder("")).toBeNull();
    expect(parseRailOrder("{not json")).toBeNull();
    expect(parseRailOrder(JSON.stringify({ files: 1 }))).toBeNull();
    expect(parseRailOrder(JSON.stringify("files"))).toBeNull();
  });
});

describe("mergeRailOrder", () => {
  it("falls back to the registry order", () => {
    expect(mergeRailOrder(null, REGISTERED)).toEqual(REGISTERED);
    expect(mergeRailOrder([], REGISTERED)).toEqual(REGISTERED);
  });

  it("keeps the saved order and drops ids that are no longer registered", () => {
    const saved = ["refs", "gone", "files", "search", "source", "preflight", "collab", "mcp"];
    expect(mergeRailOrder(saved, REGISTERED)).toEqual([
      "refs",
      "files",
      "search",
      "source",
      "preflight",
      "collab",
      "mcp",
    ]);
  });

  it("slots a tab the saved order never saw in after its registry neighbour", () => {
    expect(mergeRailOrder(["refs", "files", "search", "source", "preflight"], REGISTERED)).toEqual([
      "refs",
      "collab",
      "mcp",
      "files",
      "search",
      "source",
      "preflight",
    ]);
    expect(mergeRailOrder(["search", "files"], ["files", "search", "source"])).toEqual(["search", "source", "files"]);
    expect(mergeRailOrder(["source", "search"], ["files", "search", "source"])).toEqual(["files", "source", "search"]);
  });
});

describe("applyRailOrder", () => {
  it("sorts the visible tabs by the order and keeps unknown ones last in their own order", () => {
    const tabs = [{ id: "files" }, { id: "search" }, { id: "extra" }, { id: "refs" }, { id: "other" }];
    expect(applyRailOrder(tabs, ["refs", "collab", "files", "search"]).map((tab) => tab.id)).toEqual([
      "refs",
      "files",
      "search",
      "extra",
      "other",
    ]);
  });
});

describe("rail order storage", () => {
  it("writes a custom order and clears the key when the order is back to the default", () => {
    writeRailOrder(["refs", ...REGISTERED.filter((id) => id !== "refs")], REGISTERED);
    expect(JSON.parse(localStorage.getItem(RAIL_ORDER_KEY) ?? "null")).toEqual([
      "refs",
      "files",
      "search",
      "source",
      "preflight",
      "collab",
      "mcp",
    ]);
    expect(readRailOrder()).toEqual(["refs", "files", "search", "source", "preflight", "collab", "mcp"]);
    writeRailOrder(REGISTERED, REGISTERED);
    expect(localStorage.getItem(RAIL_ORDER_KEY)).toBeNull();
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readRailOrder()).toBeNull();
    expect(() => writeRailOrder(["refs", "files"], ["files", "refs"])).not.toThrow();
  });
});

describe("useRailOrder", () => {
  it("loads the saved order, saves changes and follows newly registered tabs", () => {
    localStorage.setItem(RAIL_ORDER_KEY, JSON.stringify(["search", "files", "ghost"]));
    const { result, rerender } = renderHook(({ ids }) => useRailOrder(ids), {
      initialProps: { ids: ["files", "search"] },
    });
    expect(result.current[0]).toEqual(["search", "files"]);

    act(() => result.current[1](["files", "search", "ghost"]));
    expect(result.current[0]).toEqual(["files", "search"]);
    expect(localStorage.getItem(RAIL_ORDER_KEY)).toBeNull();

    act(() => result.current[1](["search", "files"]));
    expect(JSON.parse(localStorage.getItem(RAIL_ORDER_KEY) ?? "null")).toEqual(["search", "files"]);

    rerender({ ids: ["files", "search", "refs"] });
    expect(result.current[0]).toEqual(["search", "refs", "files"]);
  });
});
