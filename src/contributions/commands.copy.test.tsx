// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import {
  commandGroup,
  commandHint,
  commandKeywords,
  commandLabel,
  commandsFor,
  registry,
  type AppContext,
  type CommandContribution,
} from "@oleafly/registry";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import { TOOL_DEFINITIONS, toolName } from "@/lib/tool-catalog";

const mocks = vi.hoisted(() => ({
  files: {
    engine: null as unknown,
    engineLoaded: false,
    activePath: null as string | null,
    projectId: null as string | null,
    files: {} as Record<string, { content?: string }>,
    tree: [] as { path: string; is_dir: boolean }[],
    mainDoc: null as string | null,
    closeProject: vi.fn(async () => {}),
    createTypstProject: vi.fn(async () => "typst-project"),
  },
  settings: {
    vim: false,
    spellcheck: false,
    offline: false,
    setNewProjectOpen: vi.fn(),
    setAssistantOpen: vi.fn(),
    setSettingsOpen: vi.fn(),
    setWordCountOpen: vi.fn(),
    setTerminalOpen: vi.fn(),
    openVersioning: vi.fn(),
    toggleVim: vi.fn(),
    toggleSpellcheck: vi.fn(),
    setOffline: vi.fn(),
  },
  compile: {
    autoCompile: false,
    setAutoCompile: vi.fn(),
    recompile: vi.fn(async () => {}),
  },
  citation: { setOpen: vi.fn() },
  home: {
    goTo: vi.fn(),
    openTools: vi.fn(),
    closeTools: vi.fn(),
    queuePageAfterProjectClose: vi.fn(),
    clearQueuedPageAfterProjectClose: vi.fn(),
  },
  homeSetState: vi.fn(),
  terminals: {
    projectId: null as string | null,
    tabs: [] as unknown[],
    addTerminal: vi.fn(),
  },
  documentCitationUi: { requestDocumentScan: vi.fn() },
  toastInfo: vi.fn(),
  toastError: vi.fn(),
  handoffToAssistant: vi.fn(),
  exportCurrentPdf: vi.fn(),
  forwardFromCursor: vi.fn(),
  runCiteOleaflyAction: vi.fn(),
  clearBuildCache: vi.fn(async () => {}),
  getEditorView: vi.fn(() => null as unknown),
  insertAtCursor: vi.fn(),
  wrapSelection: vi.fn(),
  terminalLimitMessage: vi.fn(() => "limit"),
  closeEnvironmentAtCursor: vi.fn(() => null as unknown),
  surroundSelectionWithEnvironment: vi.fn(() => false),
}));

vi.mock("@oleafly/editor", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  closeEnvironmentAtCursor: mocks.closeEnvironmentAtCursor,
  surroundSelectionWithEnvironment: mocks.surroundSelectionWithEnvironment,
}));

vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.files } }));
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: () => mocks.settings } }));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: () => mocks.compile } }));
vi.mock("@/store/citation", () => ({ useCitationStore: { getState: () => mocks.citation } }));
vi.mock("@/store/home-view", () => ({
  useHomeViewStore: { getState: () => mocks.home, setState: mocks.homeSetState },
}));
vi.mock("@/store/document-citation-ui", () => ({
  useDocumentCitationUiStore: { getState: () => mocks.documentCitationUi },
}));
vi.mock("@/store/terminals", () => ({
  TERMINAL_LIMIT: 10,
  terminalLimitMessage: mocks.terminalLimitMessage,
  useTerminalsStore: { getState: () => mocks.terminals },
}));
vi.mock("@/lib/toast", () => ({
  toast: { info: mocks.toastInfo, error: mocks.toastError },
}));
vi.mock("@/features/assistant-handoff", () => ({
  handoffToAssistant: mocks.handoffToAssistant,
}));
vi.mock("@/features/export", () => ({ exportCurrentPdf: mocks.exportCurrentPdf }));
vi.mock("@/features/synctex", () => ({ forwardFromCursor: mocks.forwardFromCursor }));
vi.mock("@/features/cite-oleafly", () => ({
  runCiteOleaflyAction: mocks.runCiteOleaflyAction,
}));
vi.mock("@/lib/tauri", () => ({ clearBuildCache: mocks.clearBuildCache }));
vi.mock("@/components/editor/cm/controller", () => ({
  getEditorView: mocks.getEditorView,
  insertAtCursor: mocks.insertAtCursor,
  wrapSelection: mocks.wrapSelection,
}));

import { registerOmnibarCommands, registerPaletteCommands } from "./commands";

const baseContext: AppContext = {
  projectId: "p1",
  projectKind: "latex",
  theme: "dark",
  latexToolsEnabled: true,
};

function resolveAll(command: CommandContribution, ctx: AppContext) {
  return {
    label: commandLabel(command, ctx),
    group: commandGroup(command, ctx),
    hint: commandHint(command, ctx),
    keywords: commandKeywords(command, ctx),
    icon: command.icon?.(ctx),
  };
}

beforeEach(() => {
  registry.commands.length = 0;
  mocks.files.engine = LATEX_ENGINE;
  mocks.files.engineLoaded = true;
  mocks.files.activePath = "main.tex";
  mocks.files.projectId = "p1";
  mocks.files.files = {};
  mocks.files.tree = [];
  mocks.files.mainDoc = null;
  mocks.settings.vim = false;
  mocks.settings.spellcheck = false;
  mocks.settings.offline = false;
  mocks.compile.autoCompile = false;
  mocks.terminals.projectId = null;
  mocks.terminals.tabs = [];
  mocks.getEditorView.mockReturnValue(null);
  mocks.closeEnvironmentAtCursor.mockReturnValue(null);
  mocks.surroundSelectionWithEnvironment.mockReturnValue(false);
  registerOmnibarCommands();
  registerPaletteCommands();
});

afterEach(() => {
  registry.commands.length = 0;
  vi.clearAllMocks();
});

describe("command contributions copy", () => {
  it("resolves a label, group, hint, keywords and icon for every command", () => {
    expect(registry.commands.length).toBeGreaterThan(30);
    for (const command of registry.commands) {
      const resolved = resolveAll(command, baseContext);
      expect(resolved.label.length, `${command.id} label`).toBeGreaterThan(0);
      expect(resolved.label).not.toContain("shell.commands.");
      if (resolved.group !== undefined) {
        expect(resolved.group.length, `${command.id} group`).toBeGreaterThan(0);
        expect(resolved.group).not.toContain("shell.commandGroups.");
      }
      if (resolved.hint !== undefined) {
        expect(resolved.hint.length, `${command.id} hint`).toBeGreaterThan(0);
        expect(resolved.hint).not.toContain("shell.commands.");
      }
      if (command.keywords !== undefined) {
        expect(resolved.keywords.length, `${command.id} keywords`).toBeGreaterThan(0);
        expect(resolved.keywords).not.toContain("shell.commands.");
      }
      if (command.icon !== undefined) {
        expect(isValidElement(resolved.icon), `${command.id} icon`).toBe(true);
      }
    }
  });

  it("registers each command id once and sorts by order", () => {
    const ids = registry.commands.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    const orders = registry.commands.map((command) => command.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("names every catalog tool in its own open command", () => {
    for (const tool of TOOL_DEFINITIONS) {
      const command = registry.commands.find((entry) => entry.id === `tool.${tool.id}`);
      expect(command, tool.id).toBeDefined();
      if (!command) continue;
      const resolved = resolveAll(command, baseContext);
      expect(resolved.label).toContain(toolName(tool.id));
      expect(resolved.keywords).toContain(toolName(tool.id));
      expect(resolved.hint).toBe(`/${tool.slash[0]}`);
      expect(resolved.group).toBe(enShell.commandGroups.tools);
    }
  });

  it("flips the label of every stateful toggle", () => {
    const labelOf = (id: string) => {
      const command = registry.commands.find((entry) => entry.id === id);
      if (!command) throw new Error(`missing ${id}`);
      return commandLabel(command, baseContext);
    };
    expect(labelOf("palette.autocompile")).toBe(enShell.commands.autoCompile.enable);
    expect(labelOf("palette.vim")).toBe(enShell.commands.vim.enable);
    expect(labelOf("palette.spellcheck")).toBe(enShell.commands.spellcheck.enable);
    expect(labelOf("palette.offline")).toBe(enShell.commands.offline.offline);
    mocks.compile.autoCompile = true;
    mocks.settings.vim = true;
    mocks.settings.spellcheck = true;
    mocks.settings.offline = true;
    expect(labelOf("palette.autocompile")).toBe(enShell.commands.autoCompile.disable);
    expect(labelOf("palette.vim")).toBe(enShell.commands.vim.disable);
    expect(labelOf("palette.spellcheck")).toBe(enShell.commands.spellcheck.disable);
    expect(labelOf("palette.offline")).toBe(enShell.commands.offline.online);
  });

  it("follows the theme of the context for the theme commands", () => {
    const light: AppContext = { ...baseContext, theme: "light" };
    for (const id of ["omnibar.theme", "palette.theme"]) {
      const command = registry.commands.find((entry) => entry.id === id);
      if (!command) throw new Error(`missing ${id}`);
      expect(commandLabel(command, baseContext)).toBe(enShell.commands.theme.toLight);
      expect(commandLabel(command, light)).toBe(enShell.commands.theme.toDark);
      expect(isValidElement(command.icon?.(baseContext))).toBe(true);
      expect(isValidElement(command.icon?.(light))).toBe(true);
    }
  });

  it("hides the LaTeX-only commands once the engine is not LaTeX", () => {
    const withLatex = commandsFor("palette", baseContext).map((command) => command.id);
    expect(withLatex).toContain("palette.figure");
    expect(withLatex).toContain("palette.close-environment");
    expect(withLatex).toContain("palette.add-citation");
    mocks.files.engineLoaded = false;
    const withoutEngine = commandsFor("palette", baseContext).map((command) => command.id);
    expect(withoutEngine).not.toContain("palette.figure");
    expect(withoutEngine).not.toContain("palette.close-environment");
    expect(withoutEngine).not.toContain("palette.add-citation");
  });

  it("hides the tool commands when the tools feature is off", () => {
    const off: AppContext = { ...baseContext, latexToolsEnabled: false };
    const ids = commandsFor("omnibar", off).map((command) => command.id);
    expect(ids).not.toContain("omnibar.tools");
    for (const tool of TOOL_DEFINITIONS) {
      expect(ids).not.toContain(`tool.${tool.id}`);
    }
  });

  it("hides the project commands with no project open", () => {
    const noProject: AppContext = { ...baseContext, projectId: null };
    const ids = commandsFor("palette", noProject).map((command) => command.id);
    expect(ids).not.toContain("palette.clear-cache");
    expect(ids).not.toContain("palette.new-terminal");
    expect(ids).not.toContain("palette.cite-oleafly");
  });
});

describe("command contributions behaviour", () => {
  const run = (id: string, ctx: AppContext = baseContext) => {
    const command = registry.commands.find((entry) => entry.id === id);
    if (!command) throw new Error(`missing ${id}`);
    command.run(ctx);
  };

  it("opens the creation dialog from both surfaces", () => {
    run("omnibar.create");
    run("palette.new-project");
    expect(mocks.settings.setNewProjectOpen).toHaveBeenCalledTimes(2);
  });

  it("dispatches a theme toggle event", () => {
    const seen: string[] = [];
    const onToggle = () => seen.push("toggle");
    window.addEventListener("oleafly:toggle-theme", onToggle);
    run("omnibar.theme");
    window.removeEventListener("oleafly:toggle-theme", onToggle);
    expect(seen).toHaveLength(1);
  });

  it("hands a figure prompt to the assistant", () => {
    run("omnibar.figure");
    expect(mocks.settings.setAssistantOpen).toHaveBeenCalledWith(true);
    expect(mocks.handoffToAssistant).toHaveBeenCalledTimes(1);
  });

  it("closes an open project before navigating to a home page", async () => {
    run("omnibar.diagram-composer");
    await vi.waitFor(() => expect(mocks.files.closeProject).toHaveBeenCalled());
    expect(mocks.home.queuePageAfterProjectClose).toHaveBeenCalledWith("diagram-composer");
    expect(mocks.home.clearQueuedPageAfterProjectClose).toHaveBeenCalled();
  });

  it("navigates straight to a home page with no project open", async () => {
    mocks.files.projectId = null;
    run("omnibar.diagram-composer");
    await vi.waitFor(() => expect(mocks.home.goTo).toHaveBeenCalledWith("diagram-composer"));
    expect(mocks.files.closeProject).not.toHaveBeenCalled();
  });

  it("opens the tools page and restores the project if it survives the close", async () => {
    run("omnibar.tools");
    await vi.waitFor(() =>
      expect(mocks.home.queuePageAfterProjectClose).toHaveBeenCalledWith("tools"),
    );
    expect(mocks.home.clearQueuedPageAfterProjectClose).toHaveBeenCalled();
    mocks.home.queuePageAfterProjectClose.mockClear();
    mocks.home.clearQueuedPageAfterProjectClose.mockClear();
    mocks.files.projectId = null;
    run("omnibar.tools");
    await vi.waitFor(() => expect(mocks.home.goTo).toHaveBeenCalledWith("tools"));
    expect(mocks.home.queuePageAfterProjectClose).not.toHaveBeenCalled();
  });

  it("opens settings, word count, versioning and the citation dialog", () => {
    run("omnibar.settings");
    run("palette.word-count");
    run("palette.history");
    run("palette.checkpoints");
    run("palette.add-citation");
    expect(mocks.settings.setSettingsOpen).toHaveBeenCalledWith(true);
    expect(mocks.settings.setWordCountOpen).toHaveBeenCalledWith(true);
    expect(mocks.settings.openVersioning).toHaveBeenNthCalledWith(1, "git");
    expect(mocks.settings.openVersioning).toHaveBeenNthCalledWith(2, "checkpoints");
    expect(mocks.citation.setOpen).toHaveBeenCalledWith(true);
  });

  it("drives the compile commands", () => {
    run("palette.recompile");
    run("palette.autocompile");
    run("palette.synctex");
    run("palette.export-pdf");
    expect(mocks.compile.recompile).toHaveBeenCalled();
    expect(mocks.compile.setAutoCompile).toHaveBeenCalledWith(true);
    expect(mocks.forwardFromCursor).toHaveBeenCalled();
    expect(mocks.exportCurrentPdf).toHaveBeenCalled();
  });

  it("clears the build cache then recompiles, and recompiles anyway on failure", async () => {
    run("palette.clear-cache");
    await vi.waitFor(() => expect(mocks.compile.recompile).toHaveBeenCalled());
    expect(mocks.clearBuildCache).toHaveBeenCalledWith("p1");
    mocks.clearBuildCache.mockRejectedValueOnce(new Error("nope"));
    mocks.compile.recompile.mockClear();
    run("palette.clear-cache");
    await vi.waitFor(() => expect(mocks.compile.recompile).toHaveBeenCalled());
  });

  it("does nothing for the cache command without a project id", () => {
    run("palette.clear-cache", { ...baseContext, projectId: null });
    expect(mocks.clearBuildCache).not.toHaveBeenCalled();
  });

  it("adds a terminal until the limit, then warns", () => {
    run("palette.new-terminal");
    expect(mocks.settings.setTerminalOpen).toHaveBeenCalledWith(true);
    expect(mocks.terminals.addTerminal).toHaveBeenCalledTimes(1);
    mocks.terminals.projectId = "p1";
    mocks.terminals.tabs = Array.from({ length: 10 }, (_, index) => index);
    run("palette.new-terminal");
    expect(mocks.toastInfo).toHaveBeenCalledWith(mocks.terminalLimitMessage());
    expect(mocks.terminals.addTerminal).toHaveBeenCalledTimes(1);
  });

  it("scans the main document when nothing is selected", async () => {
    mocks.files.activePath = "notes.md";
    mocks.files.mainDoc = "main.tex";
    mocks.files.files = {
      "main.tex": { content: "\\cite{a} body" },
      "refs.bib": { content: "@article{a}" },
    };
    mocks.files.tree = [
      { path: "main.tex", is_dir: false },
      { path: "refs.bib", is_dir: false },
      { path: "chapters", is_dir: true },
    ];
    run("document-citation-scan");
    expect(mocks.documentCitationUi.requestDocumentScan).toHaveBeenCalledWith(
      "\\cite{a} body",
      "@article{a}",
    );
    await vi.waitFor(() => expect(mocks.files.closeProject).toHaveBeenCalled());
  });

  it("prefers the active tex file and reports no bib override when there is none", () => {
    mocks.files.activePath = "chapter.tex";
    mocks.files.files = { "chapter.tex": { content: "chapter body" } };
    mocks.files.tree = [{ path: "chapter.tex", is_dir: false }];
    run("document-citation-scan");
    expect(mocks.documentCitationUi.requestDocumentScan).toHaveBeenCalledWith(
      "chapter body",
      null,
    );
  });

  it("prefers the editor selection over the file content", () => {
    mocks.getEditorView.mockReturnValue({
      state: {
        selection: { main: { from: 0, to: 8 } },
        sliceDoc: () => "selected",
      },
    } as unknown as null);
    run("document-citation-scan");
    expect(mocks.documentCitationUi.requestDocumentScan).toHaveBeenCalledWith("selected", null);
  });

  it("inserts LaTeX snippets and runs the formatting actions", () => {
    for (const id of [
      "palette.bold",
      "palette.italic",
      "palette.section",
      "palette.list",
      "palette.figure",
      "palette.table",
      "palette.equation",
      "palette.label",
    ]) {
      run(id);
    }
    expect(mocks.wrapSelection).toHaveBeenCalledTimes(2);
    expect(mocks.insertAtCursor.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it("no-ops the environment commands without an editor view", () => {
    run("palette.close-environment");
    run("palette.surround-environment");
    expect(mocks.closeEnvironmentAtCursor).not.toHaveBeenCalled();
    expect(mocks.surroundSelectionWithEnvironment).not.toHaveBeenCalled();
  });

  it("dispatches the environment commands against an open view", () => {
    const view = { dispatch: vi.fn(), focus: vi.fn(), state: {} };
    mocks.getEditorView.mockReturnValue(view as unknown as null);
    run("palette.close-environment");
    expect(view.dispatch).not.toHaveBeenCalled();
    const spec = { changes: { from: 0, insert: "x" } };
    mocks.closeEnvironmentAtCursor.mockReturnValue(spec);
    mocks.surroundSelectionWithEnvironment.mockReturnValue(true);
    run("palette.close-environment");
    run("palette.surround-environment");
    expect(view.dispatch).toHaveBeenCalledWith(spec);
    expect(view.focus).toHaveBeenCalledTimes(2);
  });

  it("opens the destination behind every catalog tool command", async () => {
    mocks.files.projectId = null;
    for (const tool of TOOL_DEFINITIONS) {
      run(`tool.${tool.id}`);
    }
    const pages = TOOL_DEFINITIONS.filter((tool) => tool.destination.kind === "page");
    const converters = TOOL_DEFINITIONS.filter(
      (tool) => tool.destination.kind === "converter",
    );
    const typstProjects = TOOL_DEFINITIONS.filter(
      (tool) => tool.destination.kind === "typst-project",
    );
    await vi.waitFor(() =>
      expect(mocks.home.goTo).toHaveBeenCalledTimes(pages.length + converters.length),
    );
    for (const tool of pages) {
      if (tool.destination.kind !== "page") continue;
      expect(mocks.home.goTo).toHaveBeenCalledWith(tool.destination.page);
    }
    expect(mocks.homeSetState).toHaveBeenCalledTimes(converters.length);
    expect(mocks.files.createTypstProject).toHaveBeenCalledTimes(typstProjects.length);
  });

  it("requests each appearance preference", () => {
    const seen: unknown[] = [];
    const onSet = (event: Event) => {
      seen.push(event instanceof CustomEvent ? event.detail : null);
    };
    window.addEventListener("oleafly:set-theme-preference", onSet);
    for (const preference of ["system", "light", "dark"]) {
      run(`palette.theme-${preference}`);
    }
    window.removeEventListener("oleafly:set-theme-preference", onSet);
    expect(seen).toEqual(["system", "light", "dark"]);
  });

  it("toggles vim, spellcheck and offline, and cites Oleafly", () => {
    run("palette.vim");
    run("palette.spellcheck");
    run("palette.offline");
    run("palette.cite-oleafly");
    expect(mocks.settings.toggleVim).toHaveBeenCalled();
    expect(mocks.settings.toggleSpellcheck).toHaveBeenCalled();
    expect(mocks.settings.setOffline).toHaveBeenCalledWith(true);
    expect(mocks.runCiteOleaflyAction).toHaveBeenCalled();
  });
});
