// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { readSidebarView, resetSidebarViewState } from "@/store/sidebar-view-state";
import { useSidebarViewMemory } from "./use-sidebar-view-memory";

function Remembering({
  projectId,
  query,
}: Readonly<{ projectId: string | null; query: string }>) {
  useSidebarViewMemory(projectId, "structure", { filter: query });
  return null;
}

beforeEach(() => {
  resetSidebarViewState();
});

describe("useSidebarViewMemory", () => {
  it("writes the latest value when the component goes away", () => {
    const view = render(<Remembering projectId="alpha" query="first" />);
    view.rerender(<Remembering projectId="alpha" query="second" />);
    expect(readSidebarView("alpha", "structure")).toBeUndefined();

    view.unmount();

    expect(readSidebarView("alpha", "structure")).toEqual({ filter: "second" });
  });

  it("files the value under the project it belonged to when the project changes", () => {
    const view = render(<Remembering projectId="alpha" query="from alpha" />);

    view.rerender(<Remembering projectId="beta" query="from alpha" />);
    expect(readSidebarView("alpha", "structure")).toEqual({ filter: "from alpha" });
    expect(readSidebarView("beta", "structure")).toBeUndefined();

    view.rerender(<Remembering projectId="beta" query="from beta" />);
    view.unmount();
    expect(readSidebarView("beta", "structure")).toEqual({ filter: "from beta" });
    expect(readSidebarView("alpha", "structure")).toEqual({ filter: "from alpha" });
  });

  it("asks a getter for the value only when the component goes away", () => {
    let current = "first";
    function Lazy() {
      useSidebarViewMemory("alpha", "structure", () => ({ filter: current }));
      return null;
    }
    const view = render(<Lazy />);
    current = "changed without rendering";

    view.unmount();

    expect(readSidebarView("alpha", "structure")).toEqual({
      filter: "changed without rendering",
    });
  });

  it("remembers nothing without a project", () => {
    const view = render(<Remembering projectId={null} query="orphan" />);
    view.unmount();
    expect(readSidebarView(null, "structure")).toBeUndefined();
  });
});
