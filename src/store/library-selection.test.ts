import { beforeEach, describe, expect, it } from "vitest";
import { isSelectionModifier, useLibrarySelectionStore } from "./library-selection";
import { isMac } from "@/lib/utils";

beforeEach(() => {
  useLibrarySelectionStore.getState().clear();
});

describe("library selection", () => {
  it("toggles, replaces, retains and clears", () => {
    const store = useLibrarySelectionStore.getState();
    store.toggle("a");
    store.toggle("b");
    store.toggle("a");
    expect([...useLibrarySelectionStore.getState().ids]).toEqual(["b"]);
    store.replace(new Set(["b", "c"]));
    const before = useLibrarySelectionStore.getState().ids;
    store.replace(new Set(["c", "b"]));
    expect(useLibrarySelectionStore.getState().ids).toBe(before);
    store.retain(new Set(["c"]));
    expect([...useLibrarySelectionStore.getState().ids]).toEqual(["c"]);
    const kept = useLibrarySelectionStore.getState().ids;
    store.retain(new Set(["c", "d"]));
    expect(useLibrarySelectionStore.getState().ids).toBe(kept);
    store.clear();
    expect(useLibrarySelectionStore.getState().ids.size).toBe(0);
  });

  it("uses Command on macOS and Control elsewhere", () => {
    expect(isSelectionModifier({ metaKey: isMac, ctrlKey: !isMac })).toBe(true);
    expect(isSelectionModifier({ metaKey: !isMac, ctrlKey: isMac })).toBe(false);
  });
});
