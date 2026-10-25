// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  TERMINAL_LIMIT,
  defaultTerminalTitle,
  normalizeTerminalTitle,
  terminalLimitMessage,
  terminalTitlesKey,
  useTerminalsStore,
} from "./terminals";
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };

describe("terminals store", () => {
  beforeEach(() => {
    localStorage.clear();
    useTerminalsStore.setState({ projectId: null, tabs: [], activeId: null, counters: {} });
  });

  it("opens one active first terminal per project and keeps repeat calls idempotent", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    const first = useTerminalsStore.getState();
    expect(first.tabs).toHaveLength(1);
    expect(first.tabs[0]).toMatchObject({ index: 1, title: "Terminal 1", autoStart: false });
    expect(first.activeId).toBe(first.tabs[0].id);

    store.setProject("project-1");
    expect(useTerminalsStore.getState().tabs).toBe(first.tabs);
  });

  it("numbers new terminals from the highest index used for the project this session", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    const second = store.addTerminal();
    expect(second).toMatchObject({ index: 2, title: "Terminal 2", autoStart: true });
    expect(useTerminalsStore.getState().activeId).toBe(second?.id);

    store.closeTerminal(second?.id ?? "");
    const third = store.addTerminal();
    expect(third?.title).toBe("Terminal 3");

    store.setProject("project-2");
    expect(useTerminalsStore.getState().tabs[0].title).toBe("Terminal 1");
    store.setProject("project-1");
    expect(useTerminalsStore.getState().tabs[0].title).toBe("Terminal 4");
  });

  it("refuses an eleventh terminal", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    for (let count = 1; count < TERMINAL_LIMIT; count += 1) {
      expect(store.addTerminal()).not.toBeNull();
    }
    expect(useTerminalsStore.getState().tabs).toHaveLength(TERMINAL_LIMIT);
    expect(store.addTerminal()).toBeNull();
    expect(useTerminalsStore.getState().tabs).toHaveLength(TERMINAL_LIMIT);
    expect(store.addTerminal()).toBeNull();
  });

  it("returns null when no project is open", () => {
    expect(useTerminalsStore.getState().addTerminal()).toBeNull();
    expect(useTerminalsStore.getState().tabs).toHaveLength(0);
  });

  it("activates the neighbor when the active terminal closes", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    const [first] = useTerminalsStore.getState().tabs;
    const second = store.addTerminal();
    const third = store.addTerminal();
    if (!second || !third) throw new Error("expected three terminals");

    store.activateTerminal(second.id);
    store.closeTerminal(second.id);
    expect(useTerminalsStore.getState().activeId).toBe(third.id);

    store.closeTerminal(third.id);
    expect(useTerminalsStore.getState().activeId).toBe(first.id);

    store.activateTerminal("missing");
    expect(useTerminalsStore.getState().activeId).toBe(first.id);

    const remaining = store.closeTerminal(first.id);
    expect(remaining).toHaveLength(0);
    expect(useTerminalsStore.getState().activeId).toBeNull();
  });

  it("keeps the active terminal when another one closes", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    const [first] = useTerminalsStore.getState().tabs;
    const second = store.addTerminal();
    store.activateTerminal(first.id);
    store.closeTerminal(second?.id ?? "");
    expect(useTerminalsStore.getState().activeId).toBe(first.id);
  });

  it("persists renamed titles per project and restores them for the same slot", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    const [first] = useTerminalsStore.getState().tabs;
    store.renameTerminal(first.id, "  Build  ");
    expect(useTerminalsStore.getState().tabs[0].title).toBe("Build");
    expect(JSON.parse(localStorage.getItem(terminalTitlesKey("project-1")) ?? "{}")).toEqual({
      "1": "Build",
    });

    store.setProject("project-2");
    expect(useTerminalsStore.getState().tabs[0].title).toBe("Terminal 1");
    expect(localStorage.getItem(terminalTitlesKey("project-2"))).toBeNull();

    useTerminalsStore.setState({ projectId: null, tabs: [], activeId: null, counters: {} });
    store.setProject("project-1");
    expect(useTerminalsStore.getState().tabs[0].title).toBe("Build");
  });

  it("falls back to the default title for blank names and drops the stored entry", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    const [first] = useTerminalsStore.getState().tabs;
    store.renameTerminal(first.id, "Build");
    store.renameTerminal(first.id, "   ");
    expect(useTerminalsStore.getState().tabs[0].title).toBe("Terminal 1");
    expect(localStorage.getItem(terminalTitlesKey("project-1"))).toBeNull();
  });

  it("clamps titles to forty characters", () => {
    const long = "x".repeat(60);
    expect(normalizeTerminalTitle(long, 3)).toHaveLength(40);
    expect(normalizeTerminalTitle("", 3)).toBe(defaultTerminalTitle(3));
  });

  it("ignores corrupt persisted titles", () => {
    localStorage.setItem(terminalTitlesKey("project-1"), "{not json");
    useTerminalsStore.getState().setProject("project-1");
    expect(useTerminalsStore.getState().tabs[0].title).toBe("Terminal 1");

    localStorage.setItem(terminalTitlesKey("project-3"), JSON.stringify({ "1": 7, "2": " " }));
    useTerminalsStore.getState().setProject("project-3");
    expect(useTerminalsStore.getState().tabs[0].title).toBe("Terminal 1");
  });

  it("clears the tabs when the project closes and keeps the numbering", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    store.addTerminal();
    store.setProject(null);
    expect(useTerminalsStore.getState()).toMatchObject({ projectId: null, tabs: [], activeId: null });
    store.setProject("project-1");
    expect(useTerminalsStore.getState().tabs[0].title).toBe("Terminal 3");
  });

  it("persists a tab color beside the title and restores both for the same slot", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    const [first] = useTerminalsStore.getState().tabs;

    store.setTerminalColor(first.id, "mint");
    expect(useTerminalsStore.getState().tabs[0].color).toBe("mint");
    expect(JSON.parse(localStorage.getItem(terminalTitlesKey("project-1")) ?? "{}")).toEqual({
      "1": { color: "mint" },
    });

    store.renameTerminal(first.id, "Build");
    expect(JSON.parse(localStorage.getItem(terminalTitlesKey("project-1")) ?? "{}")).toEqual({
      "1": { title: "Build", color: "mint" },
    });

    useTerminalsStore.setState({ projectId: null, tabs: [], activeId: null, counters: {} });
    store.setProject("project-1");
    expect(useTerminalsStore.getState().tabs[0]).toMatchObject({
      title: "Build",
      color: "mint",
    });
  });

  it("drops the color from storage when it is cleared and keeps the plain title shape", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    const [first] = useTerminalsStore.getState().tabs;
    store.renameTerminal(first.id, "Build");
    store.setTerminalColor(first.id, "rose");

    store.setTerminalColor(first.id, null);
    expect(useTerminalsStore.getState().tabs[0].color).toBeNull();
    expect(JSON.parse(localStorage.getItem(terminalTitlesKey("project-1")) ?? "{}")).toEqual({
      "1": "Build",
    });

    store.renameTerminal(first.id, "   ");
    expect(localStorage.getItem(terminalTitlesKey("project-1"))).toBeNull();
  });

  it("reads titles stored before colors existed and ignores unknown color names", () => {
    localStorage.setItem(
      terminalTitlesKey("project-1"),
      JSON.stringify({ "1": "Build", "2": { title: "Watch", color: "neon" }, "3": { color: 4 } }),
    );
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    expect(useTerminalsStore.getState().tabs[0]).toMatchObject({ title: "Build", color: null });
    expect(store.addTerminal()).toMatchObject({ title: "Watch", color: null });
    expect(store.addTerminal()).toMatchObject({ title: "Terminal 3", color: null });
  });

  it("ignores a color for an unknown terminal and leaves storage alone", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    store.setTerminalColor("missing", "sky");
    expect(localStorage.getItem(terminalTitlesKey("project-1"))).toBeNull();
    expect(useTerminalsStore.getState().tabs[0].color).toBeNull();
  });

  it("closes every other terminal and activates the one kept", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    const [first] = useTerminalsStore.getState().tabs;
    const second = store.addTerminal();
    const third = store.addTerminal();
    if (!second || !third) throw new Error("expected three terminals");
    expect(useTerminalsStore.getState().activeId).toBe(third.id);

    const kept = store.closeOtherTerminals(second.id);
    expect(kept.map((tab) => tab.id)).toEqual([second.id]);
    expect(useTerminalsStore.getState().tabs.map((tab) => tab.id)).toEqual([second.id]);
    expect(useTerminalsStore.getState().activeId).toBe(second.id);

    expect(store.closeOtherTerminals(second.id)).toHaveLength(1);
    expect(store.closeOtherTerminals(first.id)).toHaveLength(1);
    expect(useTerminalsStore.getState().activeId).toBe(second.id);
  });

  it("closes the terminals to the right and keeps a valid active tab", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    const [first] = useTerminalsStore.getState().tabs;
    const second = store.addTerminal();
    const third = store.addTerminal();
    if (!second || !third) throw new Error("expected three terminals");

    const kept = store.closeTerminalsToTheRight(second.id);
    expect(kept.map((tab) => tab.id)).toEqual([first.id, second.id]);
    expect(useTerminalsStore.getState().activeId).toBe(second.id);

    store.activateTerminal(first.id);
    expect(store.closeTerminalsToTheRight(second.id)).toHaveLength(2);
    expect(useTerminalsStore.getState().activeId).toBe(first.id);
    expect(store.closeTerminalsToTheRight("missing")).toHaveLength(2);
  });

  it("closes the terminals to the left and keeps a valid active tab", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    const [first] = useTerminalsStore.getState().tabs;
    const second = store.addTerminal();
    const third = store.addTerminal();
    if (!second || !third) throw new Error("expected three terminals");
    store.activateTerminal(first.id);

    const kept = store.closeTerminalsToTheLeft(second.id);
    expect(kept.map((tab) => tab.id)).toEqual([second.id, third.id]);
    expect(useTerminalsStore.getState().activeId).toBe(second.id);

    store.activateTerminal(third.id);
    expect(store.closeTerminalsToTheLeft(second.id)).toHaveLength(2);
    expect(useTerminalsStore.getState().activeId).toBe(third.id);
  });

  it("explains the terminal limit, passes the first command to a new terminal and ignores unknown tabs", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    const tab = store.addTerminal({ initialInput: "make\n" });
    const before = useTerminalsStore.getState();

    expect(terminalLimitMessage()).toBe(enWorkspace.terminal.limitReached);
    expect(tab?.initialInput).toBe("make\n");
    expect(store.closeTerminal("missing")).toBe(before.tabs);
    store.renameTerminal("missing", "Name");
    store.activateTerminal(tab?.id ?? "");
    expect(useTerminalsStore.getState()).toBe(before);
  });

  it("adds a launched terminal with its title, folder, env and command without saving the title", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    const tab = store.addTerminal({
      title: "Install Cua Driver",
      cwd: "tools",
      env: { A: "1" },
      launch: { command: "sh", args: ["-c", "echo"] },
    });

    expect(tab).toMatchObject({
      index: 2,
      title: "Install Cua Driver",
      cwd: "tools",
      env: { A: "1" },
      launch: { command: "sh", args: ["-c", "echo"] },
      autoStart: true,
      bell: false,
      oscTitle: null,
    });
    expect(useTerminalsStore.getState().activeId).toBe(tab?.id);
    expect(localStorage.getItem(terminalTitlesKey("project-1"))).toBeNull();
    expect(store.addTerminal({ title: "   " })?.title).toBe("Terminal 3");
  });

  it("marks and clears the bell without touching state twice", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    const id = useTerminalsStore.getState().tabs[0].id;

    store.markTerminalBell(id);
    const rung = useTerminalsStore.getState();
    expect(rung.tabs[0].bell).toBe(true);
    store.markTerminalBell(id);
    expect(useTerminalsStore.getState()).toBe(rung);

    store.clearTerminalBell(id);
    const cleared = useTerminalsStore.getState();
    expect(cleared.tabs[0].bell).toBe(false);
    store.clearTerminalBell(id);
    store.markTerminalBell("missing");
    expect(useTerminalsStore.getState()).toBe(cleared);
  });

  it("keeps the program's title", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    const id = useTerminalsStore.getState().tabs[0].id;

    store.setTerminalOscTitle(id, "vim main.tex");
    const titled = useTerminalsStore.getState();
    expect(titled.tabs[0]).toMatchObject({ oscTitle: "vim main.tex", title: "Terminal 1" });
    store.setTerminalOscTitle(id, "vim main.tex");
    expect(useTerminalsStore.getState()).toBe(titled);
    expect(localStorage.getItem(terminalTitlesKey("project-1"))).toBeNull();
  });

  it("forgets the program's title when it sets a blank one", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    const id = useTerminalsStore.getState().tabs[0].id;

    store.setTerminalOscTitle(id, "vim main.tex");
    store.setTerminalOscTitle(id, "");
    expect(useTerminalsStore.getState().tabs[0].oscTitle).toBeNull();
    store.setTerminalOscTitle(id, "vim main.tex");
    store.setTerminalOscTitle(id, "   ");
    expect(useTerminalsStore.getState().tabs[0].oscTitle).toBeNull();
  });

  it("activates the next and previous terminal, wrapping", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    const first = useTerminalsStore.getState().tabs[0];
    const second = store.addTerminal();
    const third = store.addTerminal();
    if (!second || !third) throw new Error("expected three terminals");

    store.activateRelativeTerminal(1);
    expect(useTerminalsStore.getState().activeId).toBe(first.id);
    store.activateRelativeTerminal(1);
    expect(useTerminalsStore.getState().activeId).toBe(second.id);
    store.activateRelativeTerminal(-1);
    store.activateRelativeTerminal(-1);
    expect(useTerminalsStore.getState().activeId).toBe(third.id);

    store.closeOtherTerminals(third.id);
    const alone = useTerminalsStore.getState();
    store.activateRelativeTerminal(1);
    expect(useTerminalsStore.getState()).toBe(alone);
  });

  it("ignores stored titles that are not a map of slots", () => {
    localStorage.setItem(terminalTitlesKey("project-1"), JSON.stringify(["Build"]));

    useTerminalsStore.getState().setProject("project-1");

    expect(useTerminalsStore.getState().tabs[0].title).toBe(defaultTerminalTitle(1));
  });

  it("keeps the same title without touching the tabs", () => {
    const store = useTerminalsStore.getState();
    store.setProject("project-1");
    const id = useTerminalsStore.getState().tabs[0].id;
    store.renameTerminal(id, "Build");
    const renamed = useTerminalsStore.getState().tabs;

    store.renameTerminal(id, "Build");

    expect(useTerminalsStore.getState().tabs).toBe(renamed);
    expect(JSON.parse(localStorage.getItem(terminalTitlesKey("project-1")) ?? "{}")).toEqual({ 1: "Build" });
  });
});

