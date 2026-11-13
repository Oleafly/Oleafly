// @vitest-environment jsdom

import type { ProjectInfo } from "@oleafly/backend-port";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_BOOK_COLOR } from "@/components/library/Book";
import { useFilesStore } from "@/store/files";
import { useProjectColorsStore } from "@/store/project-colors";
import { projectStyle, useProjectColor } from "./project-color";

function project(id: string, color?: string): ProjectInfo {
  return { id, name: id, color } as ProjectInfo;
}

afterEach(() => {
  useProjectColorsStore.setState({ colors: {} });
  useFilesStore.setState({ projects: [] });
});

describe("useProjectColor", () => {
  it("has no colour without a project and follows the library's colours", () => {
    useFilesStore.setState({ projects: [project("p1", "#a3c4f3"), project("p2")] });
    const { result } = renderHook(() => useProjectColor());
    expect(result.current(null)).toBeNull();
    expect(result.current("p1")).toBe("#a3c4f3");
    expect(result.current("p2")).toBe(DEFAULT_BOOK_COLOR);
    expect(result.current("unknown")).toBe(DEFAULT_BOOK_COLOR);
    act(() => useProjectColorsStore.setState({ colors: { p1: "#ffcfd2" } }));
    expect(result.current("p1")).toBe("#ffcfd2");
  });
});

describe("projectStyle", () => {
  it("passes the colour to the link styles only when there is one", () => {
    expect(projectStyle("#cfbaf0")).toEqual({ "--note-project": "#cfbaf0" });
    expect(projectStyle(null)).toBeUndefined();
  });
});
