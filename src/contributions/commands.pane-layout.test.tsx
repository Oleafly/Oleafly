import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandGroup, commandKeywords, commandLabel, commandsFor, registry, type AppContext } from "@oleafly/registry";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { DEFAULT_PANE_LAYOUT, PANES, layoutKey, usePaneLayoutStore } from "@/store/pane-layout";

vi.mock("@/lib/zen-mode", () => ({ toggleZenMode: vi.fn() }));
vi.mock("@/lib/compile-preview", () => ({ togglePreviewPane: vi.fn() }));
vi.mock("@/lib/app-zoom", () => ({ zoomApp: vi.fn() }));
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ engine: null, engineLoaded: false, activePath: null }) },
}));
vi.mock("@/components/editor/cm/controller", () => ({
  getEditorView: vi.fn(),
  wrapSelection: vi.fn(),
  insertAtCursor: vi.fn(),
}));
vi.mock("@/features/export", () => ({ exportCurrentPdf: vi.fn() }));
vi.mock("@/features/synctex", () => ({ forwardFromCursor: vi.fn() }));
vi.mock("@/lib/tauri", () => ({ clearBuildCache: vi.fn() }));
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: () => ({}) } }));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: () => ({}) } }));
vi.mock("@/store/citation", () => ({ useCitationStore: { getState: () => ({}) } }));

import { registerPaletteCommands } from "./commands";

const library: AppContext = { projectId: null, projectKind: null, theme: "light" };
const project: AppContext = { projectId: "thesis-1", projectKind: null, theme: "dark" };
const SIDES = ["left", "right", "top", "bottom"] as const;

function command(id: string, ctx: AppContext = project) {
  return commandsFor("palette", ctx).find((entry) => entry.id === id);
}

function layout() {
  return layoutKey(usePaneLayoutStore.getState().layout);
}

beforeEach(() => {
  registry.commands.length = 0;
  usePaneLayoutStore.setState({ layout: DEFAULT_PANE_LAYOUT });
  registerPaletteCommands();
});

afterEach(() => {
  registry.commands.length = 0;
  usePaneLayoutStore.setState({ layout: DEFAULT_PANE_LAYOUT });
});

describe("pane layout commands", () => {
  it("offers a move to each window edge for every pane inside a project", () => {
    for (const pane of PANES) {
      for (const side of SIDES) {
        expect(command(`palette.move-${pane}-to-${side}`, library)).toBeUndefined();
      }
    }
    expect(command("palette.move-sidebar-to-left")).toBeDefined();
    expect(command("palette.move-terminal-to-bottom")).toBeUndefined();
    expect(command("palette.move-terminal-to-top")).toBeDefined();
  });

  it("names the pane and the edge and moves the pane there", () => {
    const entry = command("palette.move-pdf-to-right");
    expect(entry && commandLabel(entry, project)).toBe("Move the preview to the right edge");
    expect(entry && commandGroup(entry, project)).toBe(enShell.commandGroups.settings);
    expect(entry && commandKeywords(entry, project)).toContain("pdf");
    entry?.run(project);
    expect(layout()).toBe("row(column(row(sidebar,editor,assistant),terminal),pdf)");
    expect(command("palette.move-pdf-to-right")).toBeUndefined();

    command("palette.move-terminal-to-top")?.run(project);
    expect(layout()).toBe("column(terminal,row(row(sidebar,editor,assistant),pdf))");
    expect(commandLabel(command("palette.move-assistant-to-bottom") as never, project)).toBe(
      "Move the assistant to the bottom edge",
    );
  });

  it("swaps the editor and the preview inside a project", () => {
    expect(command("palette.swap-editor-preview", library)).toBeUndefined();
    const swap = command("palette.swap-editor-preview");
    expect(swap && commandLabel(swap, project)).toBe(enShell.commands.swapEditorPreview.label);
    swap?.run(project);
    expect(layout()).toBe("column(row(sidebar,row(pdf,editor),assistant),terminal)");
  });

  it("offers Reset Pane Layout only after the panes moved", () => {
    expect(command("palette.reset-pane-layout")).toBeUndefined();
    command("palette.move-sidebar-to-right")?.run(project);
    const reset = command("palette.reset-pane-layout");
    expect(reset && commandLabel(reset, project)).toBe("Reset pane layout");
    expect(reset && commandKeywords(reset, project)).toContain("pane layout");
    expect(command("palette.reset-pane-layout", library)).toBeUndefined();
    reset?.run(project);
    expect(usePaneLayoutStore.getState().layout).toBe(DEFAULT_PANE_LAYOUT);
  });
});
