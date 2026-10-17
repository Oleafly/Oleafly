// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import type { SidebarTreeSlot } from "@/store/sidebar-view-state";
import { IntelligenceTree, type IntelligenceTreeNode } from "./IntelligenceTree";

const NODES: IntelligenceTreeNode[] = [
  {
    id: "open-group",
    label: "Open group",
    kind: "group",
    defaultExpanded: true,
    children: [{ id: "open-child", label: "Open child", kind: "section" }],
  },
  {
    id: "closed-group",
    label: "Closed group",
    kind: "group",
    defaultExpanded: false,
    children: [{ id: "closed-child", label: "Closed child", kind: "section" }],
  },
];

function tree(
  projectId: string | null = "alpha",
  slot: SidebarTreeSlot | null = "references.citations",
) {
  return (
    <IntelligenceTree
      label={enWorkspace.structure.treeLabel}
      nodes={NODES}
      query=""
      emptyMessage={enWorkspace.structure.empty}
      onActivate={vi.fn()}
      memoryProjectId={projectId}
      memorySlot={slot ?? undefined}
    />
  );
}

const toggleOf = (label: string, action: "Expand" | "Collapse") => {
  const row = screen.getByText(label).closest('[role="treeitem"]');
  const button = row?.querySelector<HTMLButtonElement>(`button[aria-label="${action}"]`);
  if (!button) throw new Error(`expected ${action} on ${label}`);
  return button;
};

describe("IntelligenceTree view memory", () => {
  it("brings back the branches the reader opened and closed", () => {
    const first = render(tree());
    fireEvent.click(toggleOf("Open group", "Collapse"));
    fireEvent.click(toggleOf("Closed group", "Expand"));
    expect(screen.queryByText("Open child")).not.toBeInTheDocument();
    expect(screen.getByText("Closed child")).toBeInTheDocument();
    first.unmount();

    render(tree());

    expect(screen.queryByText("Open child")).not.toBeInTheDocument();
    expect(screen.getByText("Closed child")).toBeInTheDocument();
  });

  it("remembers the focused row as the keyboard entry point", () => {
    const first = render(tree());
    const row = screen.getByText("Open child").closest<HTMLElement>('[role="treeitem"]');
    if (!row) throw new Error("expected the child row");
    fireEvent.focus(row);
    first.unmount();

    render(tree());

    expect(screen.getByText("Open child").closest('[role="treeitem"]')).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByText("Open group").closest('[role="treeitem"]')).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("keeps each project and each list apart", () => {
    const first = render(tree("alpha", "references.citations"));
    fireEvent.click(toggleOf("Open group", "Collapse"));
    first.unmount();

    const otherProject = render(tree("beta", "references.citations"));
    expect(screen.getByText("Open child")).toBeInTheDocument();
    otherProject.unmount();

    const otherList = render(tree("alpha", "references.symbols"));
    expect(screen.getByText("Open child")).toBeInTheDocument();
    otherList.unmount();

    render(tree("alpha", "references.citations"));
    expect(screen.queryByText("Open child")).not.toBeInTheDocument();
  });

  it("remembers nothing for a tree without a memory slot or a project", () => {
    const first = render(tree("alpha", null));
    fireEvent.click(toggleOf("Open group", "Collapse"));
    first.unmount();
    const second = render(tree("alpha", null));
    expect(screen.getByText("Open child")).toBeInTheDocument();
    second.unmount();

    const third = render(tree(null, "references.results"));
    fireEvent.click(toggleOf("Open group", "Collapse"));
    third.unmount();
    render(tree(null, "references.results"));
    expect(screen.getByText("Open child")).toBeInTheDocument();
  });
});
