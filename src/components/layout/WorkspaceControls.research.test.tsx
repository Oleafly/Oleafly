// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SidebarViews } from "@/components/layout/WorkspaceControls";
import { registerRailTabs } from "@/contributions/tabs";
import { ThemeProvider } from "@/lib/theme";
import { useFilesStore } from "@/store/files";
import { useResearchTasksFlagStore } from "@/store/research-tasks-flag";
import { useSettingsStore } from "@/store/settings";

registerRailTabs();

function railOrder(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-tour^='rail-']")].map((element) => element.getAttribute("data-tour") ?? "");
}

beforeEach(() => {
  useResearchTasksFlagStore.setState({ enabled: false });
  useSettingsStore.setState({ showTree: true, railTab: "files" });
  useFilesStore.setState({ projectId: "grant" });
});

afterEach(() => {
  useFilesStore.setState({ projectId: null });
  useResearchTasksFlagStore.setState({ enabled: false });
});

describe("Research rail tab and the experimental switch", () => {
  it("appears when the switch turns on after the rail rendered, and leaves when it turns off", () => {
    const { container } = render(
      <ThemeProvider>
        <SidebarViews />
      </ThemeProvider>,
    );
    expect(railOrder(container)).not.toContain("rail-research");
    act(() => useResearchTasksFlagStore.setState({ enabled: true }));
    expect(railOrder(container)).toContain("rail-research");
    act(() => useResearchTasksFlagStore.setState({ enabled: false }));
    expect(railOrder(container)).not.toContain("rail-research");
  });

  it("falls back to Files when the Research tab was open and the switch turns off", () => {
    useResearchTasksFlagStore.setState({ enabled: true });
    useSettingsStore.setState({ railTab: "research" });
    render(
      <ThemeProvider>
        <SidebarViews />
      </ThemeProvider>,
    );
    act(() => useResearchTasksFlagStore.setState({ enabled: false }));
    expect(useSettingsStore.getState().railTab).toBe("files");
  });
});
