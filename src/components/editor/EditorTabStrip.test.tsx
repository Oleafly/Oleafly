// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import { showInFileManagerLabel } from "@/lib/file-manager-label";
import { useDiffStore } from "@/store/diff";
import { useFilesStore } from "@/store/files";
import { EditorTabStrip } from "./EditorTabStrip";

const copyFileReference = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/features/file-links", () => ({ copyFileReference }));

const shell = en.shell;
const CLEAN = { content: "x\n", dirty: false };
const STRIP_NAMES = ["intro.tex", "refs.bib", "methods.tex", "results.tex"];

function seed(assistantTabs: string[] = []) {
  useFilesStore.setState({
    projectId: "project",
    files: { "intro.tex": CLEAN, "methods.tex": CLEAN, "results.tex": CLEAN },
    openTabs: ["intro.tex", "methods.tex", "results.tex"],
    tabOrder: { "intro.tex": 1, "methods.tex": 3, "results.tex": 4 },
    assistantTabs,
    activePath: "intro.tex",
    changedOnDisk: [],
  });
  useDiffStore.setState({
    diffs: [{ path: "refs.bib", side: "staged", order: 2 }],
    activeKey: null,
  });
}

function renderStrip() {
  return render(
    <>
      <EditorTabStrip diffFocused={false} />

    </>,
  );
}

function tabRow(name: string): HTMLElement {
  const row = screen.getByText(name).parentElement;
  if (!row) throw new Error(`no tab row for ${name}`);
  return row;
}

function visibleTabs(): string[] {
  return STRIP_NAMES.filter((name) => screen.queryByText(name) !== null);
}

function openMenu(name: string) {
  fireEvent.contextMenu(screen.getByText(name));
  return screen.getByTestId("editor-tab-menu");
}

function middleClick(element: HTMLElement) {
  return fireEvent(
    element,
    new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }),
  );
}

function box(left: number, width: number): DOMRect {
  return { left, top: 0, width, height: 28, right: left + width, bottom: 28, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
}

function stripKeys(): string[] {
  return [...document.querySelectorAll("[data-reorder-item]")].map((row) => row.getAttribute("data-reorder-item") ?? "");
}

beforeEach(() => seed());

describe("editor tab menu", () => {
  it("offers every close action on right click", () => {
    renderStrip();

    const menu = openMenu("methods.tex");

    for (const label of [
      "Close",
      shell.closeOthers,
      shell.closeLeft,
      shell.closeRight,
      shell.closeAll,
    ]) {
      expect(within(menu).getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
  });

  it("copies a file tab's path and offers no path for a diff tab", async () => {
    renderStrip();
    const files = enWorkspace.files;

    const menu = openMenu("methods.tex");
    expect(within(menu).getByRole("menuitem", { name: showInFileManagerLabel() })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: files.copyRelativePath }));
    await waitFor(() => expect(copyFileReference).toHaveBeenCalledWith("methods.tex", "relativePath"));
    await waitFor(() => expect(screen.queryByTestId("editor-tab-menu")).not.toBeInTheDocument());

    const diffMenu = openMenu("refs.bib");
    expect(within(diffMenu).queryByRole("menuitem", { name: files.copyPath })).not.toBeInTheDocument();
  });

  it("opens the same menu from the keyboard", () => {
    renderStrip();

    fireEvent.keyDown(screen.getByText("methods.tex"), { key: "F10", shiftKey: true });

    expect(screen.getByTestId("editor-tab-menu")).toBeInTheDocument();
  });

  it("closes the other tabs, files and diffs alike, and keeps the clicked one", () => {
    renderStrip();

    openMenu("methods.tex");
    fireEvent.click(screen.getByTestId("editor-tab-menu-close-others"));

    expect(visibleTabs()).toEqual(["methods.tex"]);
    expect(useFilesStore.getState()).toMatchObject({
      openTabs: ["methods.tex"],
      activePath: "methods.tex",
    });
    expect(useDiffStore.getState().diffs).toEqual([]);
  });

  it("closes to the left and to the right in the order the strip shows", () => {
    const { unmount } = renderStrip();
    openMenu("methods.tex");
    fireEvent.click(screen.getByTestId("editor-tab-menu-close-left"));
    expect(visibleTabs()).toEqual(["methods.tex", "results.tex"]);
    unmount();

    seed();
    renderStrip();
    openMenu("refs.bib");
    fireEvent.click(screen.getByTestId("editor-tab-menu-close-right"));
    expect(visibleTabs()).toEqual(["intro.tex", "refs.bib"]);
  });

  it("closes one diff tab or every tab from a diff tab's menu", () => {
    const { unmount } = renderStrip();
    openMenu("refs.bib");
    fireEvent.click(screen.getByTestId("editor-tab-menu-close"));
    expect(visibleTabs()).toEqual(["intro.tex", "methods.tex", "results.tex"]);
    unmount();

    seed();
    renderStrip();
    openMenu("refs.bib");
    fireEvent.click(screen.getByTestId("editor-tab-menu-close-all"));
    expect(visibleTabs()).toEqual([]);
    expect(screen.getByText(shell.noFileOpenTab)).toBeInTheDocument();
  });

  it("disables the close actions that have nothing to close", () => {
    renderStrip();

    openMenu("intro.tex");

    expect(screen.getByTestId("editor-tab-menu-close-left")).toHaveAttribute("aria-disabled", "true");
    for (const testId of [
      "editor-tab-menu-close",
      "editor-tab-menu-close-others",
      "editor-tab-menu-close-right",
      "editor-tab-menu-close-all",
    ]) {
      expect(screen.getByTestId(testId)).not.toHaveAttribute("aria-disabled");
    }
  });
});

describe("reordering editor tabs", () => {
  it("drags a tab between two others without activating it", () => {
    renderStrip();
    const rows = STRIP_NAMES.map(tabRow);
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => box(index * 100, 90);
    });
    const strip = rows[0].parentElement as HTMLElement;
    strip.getBoundingClientRect = () => box(0, 400);

    fireEvent.pointerDown(screen.getByText("results.tex"), { button: 0, clientX: 310, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 120, clientY: 10 });
    expect(strip.querySelector("[data-reorder-drop]")).toHaveAttribute("data-reorder-drop", "1");
    fireEvent.pointerUp(window);
    fireEvent.click(screen.getByText("results.tex"));

    expect(stripKeys()).toEqual(["f:intro.tex", "f:results.tex", "d:staged:refs.bib", "f:methods.tex"]);
    expect(useFilesStore.getState().activePath).toBe("intro.tex");
  });

  it("moves the focused tab with Alt and the arrow keys", () => {
    renderStrip();
    const methods = screen.getByText("methods.tex");
    methods.focus();

    fireEvent.keyDown(methods, { key: "ArrowLeft", altKey: true });
    fireEvent.keyDown(screen.getByText("methods.tex"), { key: "ArrowLeft", altKey: true });

    expect(stripKeys()).toEqual(["f:methods.tex", "f:intro.tex", "d:staged:refs.bib", "f:results.tex"]);
    expect(screen.getByText("methods.tex")).toHaveFocus();
  });
});

describe("a strip with more tabs than fit", () => {
  let revealed: Element[] = [];

  beforeEach(() => {
    revealed = [];
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value(this: Element) {
        revealed.push(this);
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  async function settle() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("brings the open tab into view when it opens or another tab is picked", async () => {
    renderStrip();
    expect(revealed.at(-1)).toBe(tabRow("intro.tex"));

    act(() => useFilesStore.setState({ activePath: "results.tex" }));
    await settle();
    expect(revealed.at(-1)).toBe(tabRow("results.tex"));
    expect(tabRow("results.tex")).toHaveAttribute("data-active-tab");
    expect(tabRow("intro.tex")).not.toHaveAttribute("data-active-tab");

    act(() =>
      useFilesStore.setState((state) => ({
        openTabs: [...state.openTabs, "appendix.tex"],
        tabOrder: { ...state.tabOrder, "appendix.tex": 5 },
        activePath: "appendix.tex",
      })),
    );
    await settle();
    expect(revealed.at(-1)).toBe(tabRow("appendix.tex"));
  });

  it("fades the edge past which tabs are hidden instead of cutting a name off", () => {
    renderStrip();
    const strip = tabRow("intro.tex").parentElement as HTMLElement;
    Object.defineProperty(strip, "scrollWidth", { configurable: true, value: 900 });
    Object.defineProperty(strip, "clientWidth", { configurable: true, value: 300 });
    fireEvent.scroll(strip);
    expect(strip).toHaveAttribute("data-overflow-end");
    expect(strip).not.toHaveAttribute("data-overflow-start");
    expect(strip.className).toContain("data-[overflow-end]:[mask-image:");
  });
});

describe("middle click on an editor tab", () => {
  it("closes the tab and stops the middle button from starting autoscroll", () => {
    renderStrip();
    const row = tabRow("results.tex");

    expect(fireEvent.mouseDown(row, { button: 1 })).toBe(false);
    expect(fireEvent.mouseDown(row, { button: 0 })).toBe(true);
    expect(middleClick(row)).toBe(false);

    expect(visibleTabs()).toEqual(["intro.tex", "refs.bib", "methods.tex"]);
  });

  it("closes a diff tab too", () => {
    renderStrip();

    middleClick(tabRow("refs.bib"));

    expect(useDiffStore.getState().diffs).toEqual([]);
    expect(visibleTabs()).toEqual(["intro.tex", "methods.tex", "results.tex"]);
  });
});
