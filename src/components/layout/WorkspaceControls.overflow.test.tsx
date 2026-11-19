// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SidebarViews } from "@/components/layout/WorkspaceControls";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { ThemeProvider } from "@/lib/theme";
import { registerRailTabs } from "@/contributions/tabs";
import { railSections } from "@oleafly/registry";
import { RAIL_ORDER_KEY } from "@/components/layout/rail-order";

registerRailTabs();

const originals = {
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
  scrollWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth"),
};

function railWidth(width: number) {
  const inRail = (element: HTMLElement) => element.parentElement?.hasAttribute("data-reorder-strip") === true;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return inRail(this) ? width : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return inRail(this) ? width : 0;
    },
  });
}

function openMore() {
  const more = screen.getByRole("button", { name: enShell.rail.more });
  fireEvent.click(more);
  return more;
}

function viewButtons(): string[] {
  return screen
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? "")
    .filter((label) => label !== enShell.rail.more);
}

describe("sidebar views that don't fit", () => {
  beforeEach(() => {
    useSettingsStore.setState({ showTree: true, railTab: "files" });
    useFilesStore.setState({ projectId: "proj-1" });
    localStorage.removeItem(RAIL_ORDER_KEY);
  });

  afterEach(() => {
    useFilesStore.setState({ projectId: null });
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    }
  });

  it("shows every view when the rail has room", () => {
    railWidth(1000);
    render(
      <ThemeProvider>
        <SidebarViews />
      </ThemeProvider>,
    );
    expect(screen.queryByRole("button", { name: enShell.rail.more })).toBeNull();
    expect(viewButtons().length).toBeGreaterThanOrEqual(4);
  });

  it("folds the views past the last slot into More, in the rail's order, and opens one from there", () => {
    railWidth(150);
    render(
      <ThemeProvider>
        <SidebarViews />
      </ThemeProvider>,
    );
    const shown = viewButtons();
    expect(shown).toHaveLength(3);
    expect(shown[0]).toBe(enShell.rail.files);
    const more = openMore();
    const listed = screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
    const ctx = { projectId: "proj-1", projectKind: null, theme: "light", mcpEnabled: false } as never;
    const total = railSections(ctx).flat().length;
    expect(shown.length + listed.length).toBe(total);
    const last = screen.getAllByRole("menuitem").at(-1);
    if (!last) throw new Error("the More menu is empty");
    fireEvent.click(last);
    expect(useSettingsStore.getState().railTab).not.toBe("files");
    expect(more.className).toContain("bg-primary/10");
  });
});
