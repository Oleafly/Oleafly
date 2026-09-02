// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  TERMINAL_LIMIT,
  defaultTerminalTitle,
  normalizeTerminalTitle,
  terminalTitlesKey,
  useTerminalsStore,
} from "./terminals";

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
});
