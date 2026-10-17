// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const renders = vi.hoisted(() => new Map<string, number>());

function sectionStub(testId: string) {
  return ({
    collapsed,
    onCollapsedChange,
  }: {
    collapsed: boolean;
    onCollapsedChange: (collapsed: boolean) => void;
  }) => {
    renders.set(testId, (renders.get(testId) ?? 0) + 1);
    return (
      <button
        type="button"
        data-testid={testId}
        aria-expanded={!collapsed}
        onClick={() => onCollapsedChange(!collapsed)}
      >
        {testId}
      </button>
    );
  };
}

vi.mock("@/lib/tauri", () => ({ searchDocs: vi.fn(async () => []) }));
vi.mock("@/components/editor/cm/controller", () => ({ gotoLine: vi.fn() }));
vi.mock("@/components/files/FileTree", () => ({ FileTree: sectionStub("file-tree") }));
vi.mock("@/components/layout/WorkspaceControls", () => ({
  SidebarViews: () => <div data-testid="sidebar-views" />,
}));
vi.mock("@/components/layout/DocumentOutline", () => ({
  DocumentOutline: sectionStub("document-outline"),
}));
vi.mock("@/components/layout/Outline", () => ({
  Outline: sectionStub("project-structure"),
}));

import { FilesPanel } from "./Sidebar";

beforeEach(() => {
  renders.clear();
  localStorage.clear();
});

describe("Explorer stack render cost", () => {
  it("does not re-render its sections when the stack itself re-renders", async () => {
    const { rerender } = render(<FilesPanel />);
    await screen.findByTestId("document-outline");
    await screen.findByTestId("project-structure");
    renders.clear();

    rerender(<FilesPanel />);
    rerender(<FilesPanel />);

    expect(Object.fromEntries(renders)).toEqual({});
  });

  it("keeps the section toggles working", async () => {
    render(<FilesPanel />);
    const structure = await screen.findByTestId("project-structure");
    expect(structure).toHaveAttribute("aria-expanded", "false");
    structure.click();
    expect(await screen.findByTestId("project-structure")).toHaveAttribute("aria-expanded", "true");
  });
});
