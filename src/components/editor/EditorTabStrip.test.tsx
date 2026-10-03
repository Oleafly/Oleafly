// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { useDiffStore } from "@/store/diff";
import { useFilesStore } from "@/store/files";
import { CloseAssistantTabsButton, EditorTabStrip } from "./EditorTabStrip";

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
      <CloseAssistantTabsButton />
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
      shell.closeAssistantTabs,
    ]) {
      expect(within(menu).getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
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
    expect(screen.getByTestId("editor-tab-menu-close-assistant")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    for (const testId of [
      "editor-tab-menu-close",
      "editor-tab-menu-close-others",
      "editor-tab-menu-close-right",
      "editor-tab-menu-close-all",
    ]) {
      expect(screen.getByTestId(testId)).not.toHaveAttribute("aria-disabled");
    }
  });

  it("closes the files the assistant opened from any tab's menu", () => {
    seed(["methods.tex", "results.tex"]);
    renderStrip();

    openMenu("intro.tex");
    fireEvent.click(screen.getByTestId("editor-tab-menu-close-assistant"));

    expect(visibleTabs()).toEqual(["intro.tex", "refs.bib"]);
    expect(useFilesStore.getState().assistantTabs).toEqual([]);
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

describe("tabs the assistant opened", () => {
  it("marks only the assistant's tabs, with a label screen readers announce", () => {
    seed(["methods.tex"]);
    renderStrip();

    expect(screen.getAllByTestId("editor-tab-assistant-mark")).toHaveLength(1);
    expect(within(tabRow("methods.tex")).getByText(shell.assistantTab)).toBeInTheDocument();
    expect(within(tabRow("intro.tex")).queryByText(shell.assistantTab)).toBeNull();
  });

  it("shows no close button while the assistant has no tabs open", () => {
    renderStrip();

    expect(screen.queryByTestId("editor-close-assistant-tabs")).toBeNull();
  });

  it("closes every assistant tab in one click and names how many", () => {
    seed(["methods.tex", "results.tex"]);
    renderStrip();

    const button = screen.getByLabelText(
      shell.closeAssistantTabsCount_other.replace("{{count}}", "2"),
    );
    expect(button).toHaveTextContent("2");
    fireEvent.click(button);

    expect(visibleTabs()).toEqual(["intro.tex", "refs.bib"]);
    expect(screen.queryByTestId("editor-close-assistant-tabs")).toBeNull();
  });

  it("names a single assistant tab without a count", () => {
    seed(["results.tex"]);
    renderStrip();

    expect(screen.getByLabelText(shell.closeAssistantTabsCount_one)).toBeInTheDocument();
  });
});
