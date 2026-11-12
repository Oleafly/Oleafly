// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { DEFAULT_PANE_LAYOUT, layoutKey, movePaneToEdge, usePaneLayoutStore } from "@/store/pane-layout";
import { useSavedLayoutsStore } from "@/store/saved-layouts";
import { useZenStore } from "@/store/zen";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { ThemeProvider } from "@/lib/theme";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const toolbar = enShell.toolbar;
const saved = toolbar.savedLayouts;
const resetName = new RegExp(`^${toolbar.resetPaneLayout}\\s*${toolbar.resetPaneLayoutScope}$`);

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
  useSavedLayoutsStore.setState({ layouts: [], naming: null });
  localStorage.clear();
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
  useSettingsStore.setState({ viewMode: "split", assistantOpen: false, workspaceHidden: false, showTree: true, terminalOpen: false });
});

afterEach(() => {
  usePaneLayoutStore.setState({ layout: DEFAULT_PANE_LAYOUT });
  vi.restoreAllMocks();
});

describe("Reset pane layout in the layout menu", () => {
  it("is hidden while the panes are in their default layout", async () => {
    const { menu } = await openLayoutMenu();
    expect(within(menu).queryByRole("menuitem", { name: resetName })).toBeNull();
    expect(within(menu).getAllByRole("menuitem").at(-1)).toHaveAccessibleName(toolbar.layouts.zenMode);
  });

  it("ends the menu after the panes moved and puts them back", async () => {
    movePaneToEdge("terminal", "right");
    const { user, menu } = await openLayoutMenu();
    const items = within(menu).getAllByRole("menuitem");
    const reset = within(menu).getByRole("menuitem", { name: resetName });
    expect(items.at(-1)).toBe(reset);
    expect(reset.querySelector("svg.lucide-rotate-ccw")).not.toBeNull();
    await user.click(reset);
    await waitFor(() => expect(usePaneLayoutStore.getState().layout).toBe(DEFAULT_PANE_LAYOUT));
  });
});

describe("Saved layouts in the layout menu", () => {
  it("offers only saving while nothing is saved", async () => {
    const { menu } = await openLayoutMenu();
    expect(within(menu).getByRole("menuitem", { name: saved.save })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: saved.manage })).toBeNull();
    expect(within(menu).queryAllByTestId("saved-layout")).toHaveLength(0);
  });

  it("saves the current layout under a name, marks it in effect and applies it later", async () => {
    movePaneToEdge("terminal", "right");
    const moved = layoutKey(usePaneLayoutStore.getState().layout);
    const { user, menu } = await openLayoutMenu();
    await user.click(within(menu).getByRole("menuitem", { name: saved.save }));
    await user.type(await screen.findByRole("textbox", { name: saved.name }), "Wide terminal{Enter}");
    await waitFor(() => expect(useSavedLayoutsStore.getState().layouts.map((layout) => layout.name)).toEqual(["Wide terminal"]));
    expect(screen.queryByRole("textbox", { name: saved.name })).toBeNull();

    await user.click(screen.getByRole("button", { name: toolbar.layout }));
    let item = (await screen.findAllByTestId("saved-layout"))[0] as HTMLElement;
    expect(item).toHaveAccessibleName("Wide terminal");
    expect(item.querySelector("svg.lucide-check")).not.toBeNull();
    await user.keyboard("{Escape}");

    usePaneLayoutStore.getState().reset();
    await user.click(screen.getByRole("button", { name: toolbar.layout }));
    item = (await screen.findAllByTestId("saved-layout"))[0] as HTMLElement;
    expect(item.querySelector("svg.lucide-check")).toBeNull();
    await user.click(item);
    expect(layoutKey(usePaneLayoutStore.getState().layout)).toBe(moved);
  });

  it("asks before saving over a layout with the same name and keeps the old one on no", async () => {
    useSavedLayoutsStore.getState().save("Focus");
    const [first] = useSavedLayoutsStore.getState().layouts;
    movePaneToEdge("assistant", "left");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user, menu } = await openLayoutMenu();
    await user.click(within(menu).getByRole("menuitem", { name: saved.save }));
    await user.type(await screen.findByRole("textbox", { name: saved.name }), "focus{Enter}");
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(useSavedLayoutsStore.getState().layouts).toEqual([first]);
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: saved.saveButton }));
    await waitFor(() => expect(useSavedLayoutsStore.getState().layouts[0]?.name).toBe("focus"));
    expect(useSavedLayoutsStore.getState().layouts[0]?.id).toBe(first?.id);
  });

  it("renames, updates and deletes from Manage layouts", async () => {
    useSavedLayoutsStore.getState().save("Focus");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user, menu } = await openLayoutMenu();
    await user.click(within(menu).getByRole("menuitem", { name: saved.manage }));
    fireEvent.click(await screen.findByRole("menuitem", { name: saved.rename }));
    const field = await screen.findByRole("textbox", { name: saved.name });
    expect(field).toHaveValue("Focus");
    await user.clear(field);
    await user.type(field, "Reading{Enter}");
    await waitFor(() => expect(useSavedLayoutsStore.getState().layouts[0]?.name).toBe("Reading"));

    movePaneToEdge("terminal", "top");
    await user.click(screen.getByRole("button", { name: toolbar.layout }));
    await user.click(await screen.findByRole("menuitem", { name: saved.manage }));
    fireEvent.click(await screen.findByRole("menuitem", { name: saved.update }));
    expect(layoutKey(useSavedLayoutsStore.getState().layouts[0]?.tree ?? DEFAULT_PANE_LAYOUT)).toBe(
      layoutKey(usePaneLayoutStore.getState().layout),
    );

    await user.click(screen.getByRole("button", { name: toolbar.layout }));
    await user.click(await screen.findByRole("menuitem", { name: saved.manage }));
    fireEvent.click(await screen.findByRole("menuitem", { name: saved.delete }));
    await waitFor(() => expect(useSavedLayoutsStore.getState().layouts).toEqual([]));
  });
});
