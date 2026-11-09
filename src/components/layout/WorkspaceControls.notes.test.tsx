// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { SidebarViews } from "@/components/layout/WorkspaceControls";
import { registerRailTabs } from "@/contributions/tabs";
import { ThemeProvider } from "@/lib/theme";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

registerRailTabs();

function railOrder(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-tour^='rail-']")].map((element) => element.getAttribute("data-tour") ?? "");
}

function renderRail() {
  return render(
    <ThemeProvider>
      <SidebarViews />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  useSettingsStore.setState({ showTree: false, railTab: "files", notes: false });
  useFilesStore.setState({ projectId: "paper", projectKind: "latex" });
});

afterEach(() => {
  useFilesStore.setState({ projectId: null, projectKind: undefined });
  useSettingsStore.setState({ notes: false, railTab: "files" });
});

describe("Notes rail tab and the experimental switch", () => {
  it("appears after Files when Notes turns on and opens the sidebar on it", () => {
    const { container } = renderRail();
    expect(railOrder(container)).not.toContain("rail-notes");
    act(() => useSettingsStore.setState({ notes: true }));
    const order = railOrder(container);
    expect(order.indexOf("rail-notes")).toBe(order.indexOf("rail-files") + 1);
    fireEvent.click(screen.getByRole("button", { name: enShell.rail.notes }));
    expect(useSettingsStore.getState()).toMatchObject({ railTab: "notes", showTree: true });
  });

  it("falls back to Files when Notes turns off with the tab open", () => {
    useSettingsStore.setState({ notes: true, railTab: "notes" });
    renderRail();
    act(() => useSettingsStore.setState({ notes: false }));
    expect(useSettingsStore.getState().railTab).toBe("files");
  });

  it("falls back to Files inside a note", () => {
    useSettingsStore.setState({ notes: true, railTab: "notes" });
    useFilesStore.setState({ projectKind: "note" });
    const { container } = renderRail();
    expect(railOrder(container)).not.toContain("rail-notes");
    expect(useSettingsStore.getState().railTab).toBe("files");
  });
});
