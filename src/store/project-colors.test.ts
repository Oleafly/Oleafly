// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BOOK_COLOR } from "@/components/library/Book";

vi.mock("@/lib/tauri", () => ({ setProjectColor: vi.fn(() => Promise.resolve()) }));

const { useProjectColorOf, useProjectColorsStore } = await import("./project-colors");

beforeEach(() => {
  useProjectColorsStore.setState({ colors: {} });
});

describe("useProjectColorOf", () => {
  it.each([
    ["the colour picked in the library", { p1: "#ffcfd2" }, { id: "p1", color: "#a3c4f3" }, "#ffcfd2"],
    ["the project's own colour", {}, { id: "p1", color: "#a3c4f3" }, "#a3c4f3"],
    ["the default for a project without one", {}, { id: "p1", color: "" }, DEFAULT_BOOK_COLOR],
    ["the default for an unknown project", {}, { id: "p9" }, DEFAULT_BOOK_COLOR],
  ])("uses %s", (_case, colors, project, expected) => {
    useProjectColorsStore.setState({ colors });
    const { result } = renderHook(() => useProjectColorOf());
    expect(result.current(project)).toBe(expected);
  });

  it("follows a colour change", () => {
    const { result } = renderHook(() => useProjectColorOf());
    act(() => useProjectColorsStore.getState().setColor("p1", "#caffbf"));
    expect(result.current({ id: "p1", color: "#a3c4f3" })).toBe("#caffbf");
  });
});
