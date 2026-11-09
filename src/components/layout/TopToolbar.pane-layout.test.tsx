// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { DEFAULT_PANE_LAYOUT, movePaneToEdge, usePaneLayoutStore } from "@/store/pane-layout";
import { useZenStore } from "@/store/zen";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { ThemeProvider } from "@/lib/theme";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const toolbar = enShell.toolbar;

async function openLayoutMenu() {
  render(
    <ThemeProvider>
      <TopToolbar />
    </ThemeProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: toolbar.layout }));
  const menu = (await screen.findAllByRole("menu")).at(-1);
  if (!menu) throw new Error("layout menu did not open");
  return { user, menu };
}

beforeEach(() => {
  useZenStore.getState().end();
  usePreviewDetachedStore.setState({ projectId: null });
  usePaneLayoutStore.setState({ layout: DEFAULT_PANE_LAYOUT });
  useFilesStore.setState({
    projectId: "p1",
    projectName: "Retrieval study",
    projectKind: "",
    projects: [],
    engine: LATEX_ENGINE,
    engineError: null,
    files: { "main.tex": { content: "\\documentclass{article}" } },
    mainDoc: "main.tex",
    activePath: "main.tex",
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  useCompileStore.setState({ status: "success", pdfBytes: new Uint8Array([1]) });
  useSettingsStore.setState({ viewMode: "split", assistantOpen: false, workspaceHidden: false });
});

afterEach(() => {
  usePaneLayoutStore.setState({ layout: DEFAULT_PANE_LAYOUT });
});

describe("Reset pane layout in the layout menu", () => {
  it("is hidden while the panes are in their default layout", async () => {
    const { menu } = await openLayoutMenu();
    expect(within(menu).queryByRole("menuitem", { name: toolbar.resetPaneLayout })).toBeNull();
    expect(within(menu).getAllByRole("menuitem").at(-1)).toHaveAccessibleName(toolbar.layouts.zenMode);
  });

  it("ends the menu after the panes moved and puts them back", async () => {
    movePaneToEdge("terminal", "right");
    const { user, menu } = await openLayoutMenu();
    const items = within(menu).getAllByRole("menuitem");
    const reset = within(menu).getByRole("menuitem", { name: toolbar.resetPaneLayout });
    expect(items.at(-1)).toBe(reset);
    expect(reset.querySelector("svg.lucide-rotate-ccw")).not.toBeNull();
    await user.click(reset);
    await waitFor(() => expect(usePaneLayoutStore.getState().layout).toBe(DEFAULT_PANE_LAYOUT));
  });
});
