// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { moveSection, orderSections, useSectionOrder } from "./section-order";

const IDS = ["explorer", "outline", "structure"];
const KEY = "test.sections.order";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("orderSections", () => {
  it("keeps the default order when nothing is saved", () => {
    expect(orderSections(null, IDS)).toEqual(IDS);
  });

  it("follows the saved order, drops unknown and repeated ids, and appends new sections", () => {
    expect(orderSections(["structure", "gone", "structure", "explorer"], IDS)).toEqual(["structure", "explorer", "outline"]);
  });
});

describe("moveSection", () => {
  it("moves a section to an index among the others", () => {
    expect(moveSection(IDS, "explorer", 1)).toEqual(["outline", "explorer", "structure"]);
    expect(moveSection(IDS, "structure", 0)).toEqual(["structure", "explorer", "outline"]);
  });

  it("clamps the index and leaves an unknown section alone", () => {
    expect(moveSection(IDS, "explorer", 9)).toEqual(["outline", "structure", "explorer"]);
    expect(moveSection(IDS, "outline", -3)).toEqual(["outline", "explorer", "structure"]);
    expect(moveSection(IDS, "missing", 0)).toEqual(IDS);
  });
});

describe("useSectionOrder", () => {
  it("reads the saved order and saves a new one", () => {
    localStorage.setItem(KEY, JSON.stringify(["outline"]));
    const { result } = renderHook(() => useSectionOrder(KEY, IDS));
    expect(result.current[0]).toEqual(["outline", "explorer", "structure"]);
    act(() => result.current[1](["structure", "outline", "explorer"]));
    expect(result.current[0]).toEqual(["structure", "outline", "explorer"]);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "null")).toEqual(["structure", "outline", "explorer"]);
  });

  it("ignores a saved value that is not a list of ids", () => {
    localStorage.setItem(KEY, JSON.stringify({ order: 1 }));
    expect(renderHook(() => useSectionOrder(KEY, IDS)).result.current[0]).toEqual(IDS);
    localStorage.setItem(KEY, "not json");
    expect(renderHook(() => useSectionOrder(KEY, IDS)).result.current[0]).toEqual(IDS);
  });

  it("still reorders for the session when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useSectionOrder(KEY, IDS));
    expect(result.current[0]).toEqual(IDS);
    act(() => result.current[1](["outline", "explorer", "structure"]));
    expect(result.current[0]).toEqual(["outline", "explorer", "structure"]);
  });
});
