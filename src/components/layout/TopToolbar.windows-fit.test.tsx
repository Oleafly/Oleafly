// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return { ...actual, isWindows: true, isMac: false };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
    minimize: () => Promise.resolve(),
    toggleMaximize: () => Promise.resolve(),
    close: () => Promise.resolve(),
  }),
}));

import { TopToolbar } from "./TopToolbar";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { ThemeProvider } from "@/lib/theme";

function renderToolbar() {
  const { container } = render(
    <ThemeProvider>
      <TopToolbar />
    </ThemeProvider>,
  );
  const toolbar = container.querySelector('[data-tour="project-toolbar"]');
  if (!(toolbar instanceof HTMLElement)) throw new Error("toolbar not rendered");
  return toolbar;
}

beforeEach(() => {
  useFilesStore.setState({
    projectId: "p1",
    projectName: "Cross-Modal Retrieval for Scientific Figures",
    projects: [],
    engineError: null,
  });
  useCompileStore.setState({ status: "success" });
  useSettingsStore.setState({
    viewMode: "split",
    assistantOpen: false,
    workspaceHidden: false,
    webBrowser: true,
  });
});

describe("TopToolbar on Windows", () => {
  it("ends the toolbar with the caption buttons", () => {
    renderToolbar();
    const strip = screen.getByLabelText("Window controls");
    expect(strip.nextElementSibling).toBeNull();
    expect(strip.parentElement?.nextElementSibling).toBeNull();
  });

  it("clips the action cluster rather than letting it push the caption buttons off screen", () => {
    renderToolbar();
    const cluster = screen.getByLabelText("Window controls").parentElement;
    expect(cluster?.className).toContain("min-w-0");
    expect(cluster?.className).toContain("overflow-x-clip");
    expect(cluster?.className).not.toContain("overflow-hidden");
  });

  it("gives the project name the only elastic slot in the toolbar", () => {
    const toolbar = renderToolbar();
    const titleArea = screen.getByTestId("project-title").parentElement
      ?.parentElement;
    expect(titleArea?.parentElement).toBe(toolbar);
    expect(titleArea?.className).toContain("flex-1");
    expect(titleArea?.className).toContain("min-w-0");
    expect(titleArea?.className).toContain("overflow-hidden");
  });

  it("holds the brand, the separator and the view switch at their own width", () => {
    const toolbar = renderToolbar();
    const chevron = toolbar.querySelector("svg.lucide-chevron-right");
    expect(chevron?.parentElement).toBe(toolbar);
    expect(chevron?.getAttribute("class")).toContain("shrink-0");

    const brand = screen.getByLabelText("Home").parentElement;
    expect(brand?.parentElement).toBe(toolbar);
    expect(brand?.className).toContain("shrink-0");

    const viewSwitch = screen.getByLabelText("Split View").closest("div.shrink-0");
    const titleSlot = screen.getByTestId("project-title").parentElement?.parentElement;
    expect(viewSwitch?.parentElement).toBe(titleSlot);
    expect(titleSlot?.parentElement).toBe(toolbar);
  });

  it("holds the dock controls at their own width", () => {
    renderToolbar();
    const dock = screen.getByTestId("rail-terminal-toggle").parentElement
      ?.parentElement;
    expect(dock?.className).toContain("shrink-0");
  });
});
