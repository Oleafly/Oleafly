// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { panelLayoutKey } from "@/lib/panel-layout";
import { SidebarSectionStack, type StackSection } from "./SidebarSectionStack";

const GROUP = "section-stack-order";
const STORED = { a: 60, b: 40, filler: 0 };

function section(id: string): StackSection {
  return {
    id,
    title: id,
    handleId: `${id}-resize`,
    collapsed: false,
    onCollapsedChange: () => undefined,
    render: () => <p>{id}</p>,
  };
}

function Stack({ order }: Readonly<{ order: readonly string[] }>) {
  return (
    <SidebarSectionStack
      groupId={GROUP}
      fillerId="filler"
      fillerHandleId="filler-resize"
      sections={order.map(section)}
      storageOrder={["a", "b"]}
      resizeLabel={(first, second) => `${first} ${second}`}
      testId="stack"
      onReorder={() => undefined}
    />
  );
}

function size(id: string): number {
  return Number(document.getElementById(id)?.style.flexGrow ?? Number.NaN);
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-panel") || this.hasAttribute("data-separator") ? 100 : 0;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SidebarSectionStack", () => {
  it("keeps section sizes when the sections change order", async () => {
    localStorage.setItem(panelLayoutKey(GROUP, ["a", "b", "filler"]), JSON.stringify(STORED));
    const view = render(<Stack order={["a", "b"]} />);
    await waitFor(() => expect([size("a"), size("b")]).toEqual([60, 40]));
    view.rerender(<Stack order={["b", "a"]} />);
    await waitFor(() => expect([size("a"), size("b")]).toEqual([60, 40]));
    expect(Object.keys(localStorage).filter((key) => key.includes(GROUP))).toEqual([
      panelLayoutKey(GROUP, ["a", "b", "filler"]),
    ]);
  });
});
