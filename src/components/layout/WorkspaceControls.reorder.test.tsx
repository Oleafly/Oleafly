// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SidebarViews } from "@/components/layout/WorkspaceControls";
import { RAIL_ORDER_KEY } from "@/components/layout/rail-order";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { useGitStatusStore } from "@/store/git-status";
import { useMcpActivityStore } from "@/store/mcp-activity";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { ThemeProvider } from "@/lib/theme";
import { registerRailTabs } from "@/contributions/tabs";

registerRailTabs();

function box(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function strip(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-tour="project-sidebar"]');
  if (!element) throw new Error("rail strip is missing");
  return element;
}

function place() {
  [...strip().querySelectorAll<HTMLElement>("[data-reorder-item]")].forEach((item, index) => {
    item.getBoundingClientRect = () => box(6 + index * 37, 4, 28, 28);
  });
  strip().getBoundingClientRect = () => box(0, 0, 300, 36);
}

function rail(): string[] {
  return [...strip().querySelectorAll("[data-tour^='rail-']")].map((element) => element.getAttribute("data-tour") ?? "");
}

function renderRail() {
  return render(
    <ThemeProvider>
      <SidebarViews />
    </ThemeProvider>,
  );
}

function dragIcon(label: string, toX: number) {
  const button = screen.getByLabelText(label);
  const from = button.getBoundingClientRect().left + 14;
  fireEvent.pointerDown(button, { button: 0, clientX: from, clientY: 18 });
  fireEvent.pointerMove(window, { clientX: toX, clientY: 18 });
}

function stored(): unknown {
  return JSON.parse(localStorage.getItem(RAIL_ORDER_KEY) ?? "null");
}

describe("reordering the sidebar rail", () => {
  beforeEach(() => {
    localStorage.removeItem(RAIL_ORDER_KEY);
    useSettingsStore.setState({ showTree: true, railTab: "search" });
    useFilesStore.setState({ projectId: "proj-1" });
    useMcpActivityStore.setState({ serverRunning: false });
  });

  afterEach(async () => {
    useFilesStore.setState({ projectId: null });
    useMcpActivityStore.setState({ serverRunning: false });
    useGitStatusStore.setState({ count: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("drags an icon to a new slot, shows the drop box, saves the order and swallows the click", () => {
    renderRail();
    place();
    dragIcon(enShell.rail.files, 100);
    const drop = strip().querySelector<HTMLElement>("[data-reorder-drop]");
    expect(drop).toHaveAttribute("data-reorder-drop", "2");
    expect(drop?.style.left).toBe("98.5px");
    expect(drop?.style.width).toBe("28px");
    expect(drop?.style.height).toBe("28px");
    fireEvent.pointerUp(window);
    fireEvent.click(screen.getByLabelText(enShell.rail.files));

    expect(useSettingsStore.getState().railTab).toBe("search");
    expect(rail()).toEqual(["rail-search", "rail-source", "rail-files", "rail-preflight", "rail-refs"]);
    expect(stored()).toEqual(["notes", "search", "source", "files", "preflight", "refs", "collab", "comments", "chat", "research", "mcp"]);
    expect(screen.getByLabelText(enShell.rail.files)).toHaveAttribute("data-tour", "rail-files");
    expect(screen.getByLabelText(enShell.rail.search)).toHaveAttribute("aria-current", "page");
    expect(strip().querySelector("[data-reorder-drop]")).toBeNull();
  });

  it("moves the focused icon with Alt and the arrow keys", () => {
    renderRail();
    const files = screen.getByLabelText(enShell.rail.files);
    files.focus();
    fireEvent.keyDown(files, { key: "ArrowRight", altKey: true });
    expect(rail()).toEqual(["rail-search", "rail-files", "rail-source", "rail-preflight", "rail-refs"]);
    expect(screen.getByLabelText(enShell.rail.files)).toHaveFocus();
  });

  it("still switches views on a plain click", () => {
    renderRail();
    place();
    const files = screen.getByLabelText(enShell.rail.files);
    fireEvent.pointerDown(files, { button: 0, clientX: 20, clientY: 18 });
    fireEvent.pointerMove(window, { clientX: 22, clientY: 18 });
    fireEvent.pointerUp(window);
    fireEvent.click(files);
    expect(useSettingsStore.getState().railTab).toBe("files");
    expect(stored()).toBeNull();
  });

  it("applies a saved order, drops unknown ids and puts a conditional tab back in its saved slot", () => {
    localStorage.setItem(RAIL_ORDER_KEY, JSON.stringify(["refs", "ghost", "mcp", "files"]));
    renderRail();
    expect(rail()).toEqual(["rail-refs", "rail-files", "rail-search", "rail-source", "rail-preflight"]);
    act(() => useMcpActivityStore.setState({ serverRunning: true }));
    expect(rail()).toEqual(["rail-refs", "rail-mcp", "rail-files", "rail-search", "rail-source", "rail-preflight"]);
  });

  it("moves among the visible icons while hidden tabs keep their stored slots", () => {
    localStorage.setItem(RAIL_ORDER_KEY, JSON.stringify(["refs", "mcp", "files"]));
    renderRail();
    place();
    dragIcon(enShell.rail.files, 2);
    fireEvent.pointerUp(window);
    expect(stored()).toEqual(["files", "refs", "collab", "comments", "chat", "research", "mcp", "notes", "search", "source", "preflight"]);
    act(() => useMcpActivityStore.setState({ serverRunning: true }));
    expect(rail()).toEqual(["rail-files", "rail-refs", "rail-mcp", "rail-search", "rail-source", "rail-preflight"]);
  });

  it("keeps badges on their icons after a move and clears the key once the default order is back", () => {
    useGitStatusStore.setState({ count: 3 });
    renderRail();
    place();
    dragIcon(enShell.rail.sourceControl, 2);
    fireEvent.pointerUp(window);
    expect(rail()[0]).toBe("rail-source");
    expect(screen.getByLabelText(enShell.rail.sourceControl).querySelector("output")?.textContent).toBe("3");
    place();
    dragIcon(enShell.rail.sourceControl, 99);
    fireEvent.pointerUp(window);
    expect(rail()).toEqual(["rail-files", "rail-search", "rail-source", "rail-preflight", "rail-refs"]);
    expect(stored()).toBeNull();
  });

  it("falls back to the registry order when the saved value is broken", () => {
    localStorage.setItem(RAIL_ORDER_KEY, "{broken");
    renderRail();
    expect(rail()).toEqual(["rail-files", "rail-search", "rail-source", "rail-preflight", "rail-refs"]);
  });
});
