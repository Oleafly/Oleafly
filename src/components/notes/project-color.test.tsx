// @vitest-environment jsdom

import type { ProjectInfo } from "@oleafly/backend-port";
import { act, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_BOOK_COLOR } from "@/components/library/Book";
import { useFilesStore } from "@/store/files";
import { useProjectColorsStore } from "@/store/project-colors";
import { ProjectDot, projectColor, projectStyle, useProjectColor } from "./project-color";

function project(id: string, color?: string): ProjectInfo {
  return { id, name: id, color } as ProjectInfo;
}

afterEach(() => {
  useProjectColorsStore.setState({ colors: {} });
  useFilesStore.setState({ projects: [] });
});

describe("projectColor", () => {
  it("has no colour for a note without a related project", () => {
    expect(projectColor(undefined, { p1: "#ffcfd2" }, [project("p1", "#a3c4f3")])).toBeNull();
    expect(projectColor(null, {}, [])).toBeNull();
    expect(projectColor("", {}, [])).toBeNull();
  });

  it("prefers the colour picked in the library over the project's saved colour", () => {
    expect(projectColor("p1", { p1: "#ffcfd2" }, [project("p1", "#a3c4f3")])).toBe("#ffcfd2");
  });

  it("uses the project's saved colour when none was picked", () => {
    expect(projectColor("p1", {}, [project("p1", "#a3c4f3")])).toBe("#a3c4f3");
  });

  it("falls back to the default book colour like the library does", () => {
    expect(projectColor("p1", {}, [project("p1")])).toBe(DEFAULT_BOOK_COLOR);
    expect(projectColor("p1", {}, [project("p1", "")])).toBe(DEFAULT_BOOK_COLOR);
    expect(projectColor("unknown", {}, [])).toBe(DEFAULT_BOOK_COLOR);
  });
});

describe("useProjectColor", () => {
  it("reads the library's colours and follows changes to them", () => {
    useFilesStore.setState({ projects: [project("p1", "#a3c4f3"), project("p2")] });
    const { result } = renderHook(() => useProjectColor());
    expect(result.current("p1")).toBe("#a3c4f3");
    expect(result.current("p2")).toBe(DEFAULT_BOOK_COLOR);
    expect(result.current(undefined)).toBeNull();
    act(() => useProjectColorsStore.setState({ colors: { p2: "#b9fbc0" } }));
    expect(result.current("p2")).toBe("#b9fbc0");
  });
});

describe("projectStyle", () => {
  it("passes the colour to CSS as a custom property", () => {
    expect(projectStyle("#cfbaf0")).toEqual({ "--note-project": "#cfbaf0" });
    expect(projectStyle(null)).toBeUndefined();
  });
});

describe("ProjectDot", () => {
  it("draws a coloured dot for a project", () => {
    const { container } = render(<ProjectDot color="#cfbaf0" />);
    const dot = container.firstElementChild as HTMLElement;
    expect(dot).toHaveAttribute("aria-hidden");
    expect(dot).toHaveAttribute("data-project-color", "#cfbaf0");
    expect(dot).toHaveClass("note-project-dot");
    expect(dot).not.toHaveClass("note-project-dot-none");
    expect(dot.style.getPropertyValue("--note-project")).toBe("#cfbaf0");
  });

  it("draws a neutral hollow dot without a project", () => {
    const { container } = render(<ProjectDot color={null} className="size-1.5" />);
    const dot = container.firstElementChild as HTMLElement;
    expect(dot).toHaveAttribute("data-project-color", "none");
    expect(dot).toHaveClass("note-project-dot-none", "size-1.5");
    expect(dot).not.toHaveClass("size-2");
    expect(dot.style.getPropertyValue("--note-project")).toBe("");
  });
});
