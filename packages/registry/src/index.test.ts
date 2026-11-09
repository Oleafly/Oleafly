import { afterEach, describe, expect, it } from "vitest";
import {
  commandGroup,
  commandHint,
  commandKeywords,
  commandLabel,
  railSections,
  railTabIds,
  railTabLabel,
  registerCommand,
  registerRailTab,
  registry,
  type AppContext,
} from "./index";

afterEach(() => {
  registry.railTabs.length = 0;
  registry.commands.length = 0;
});

describe("message resolution", () => {
  it("resolves message thunks with the app context", () => {
    const ctx: AppContext = { projectId: null, projectKind: null, theme: "light" };
    registerRailTab({
      id: "x",
      label: (c) => `tab-${c.theme}`,
      icon: () => null,
      section: "explore",
      order: 1,
      panel: () => null,
    });
    registerCommand({
      id: "y",
      surfaces: ["palette"],
      label: "L",
      group: () => "G",
      hint: (c) => `H-${c.theme}`,
      keywords: "k",
      order: 1,
      run: () => {},
    });

    expect(railTabLabel(registry.railTabs.find((t) => t.id === "x")!, ctx)).toBe("tab-light");
    const cmd = registry.commands.find((c) => c.id === "y")!;
    expect(commandLabel(cmd, ctx)).toBe("L");
    expect(commandGroup(cmd, ctx)).toBe("G");
    expect(commandHint(cmd, ctx)).toBe("H-light");
    expect(commandKeywords(cmd, ctx)).toBe("k");
  });

  it("returns undefined for absent optional messages and an empty keyword string", () => {
    const ctx: AppContext = { projectId: null, projectKind: null, theme: "dark" };
    registerCommand({ id: "z", surfaces: ["omnibar"], label: "Z", order: 1, run: () => {} });

    const cmd = registry.commands.find((c) => c.id === "z")!;
    expect(commandGroup(cmd, ctx)).toBeUndefined();
    expect(commandHint(cmd, ctx)).toBeUndefined();
    expect(commandKeywords(cmd, ctx)).toBe("");
  });
});

describe("rail tab ids", () => {
  it("lists every shown tab by section, then by order, whether or not it applies right now", () => {
    const tab = (id: string, section: "explore" | "review" | "assist", order: number, extra = {}) => ({
      id,
      label: id,
      icon: () => null,
      section,
      order,
      panel: () => null,
      ...extra,
    });
    registerRailTab(tab("assist", "assist", 1));
    registerRailTab(tab("files", "explore", 10));
    registerRailTab(tab("refs", "review", 5, { when: () => false }));
    registerRailTab(tab("secret", "explore", 2, { hidden: true }));
    registerRailTab(tab("files", "explore", 11));

    expect(railTabIds()).toEqual(["files", "refs", "assist"]);
    const ctx: AppContext = { projectId: null, projectKind: null, theme: "light" };
    expect(railSections(ctx).flat().map((entry) => entry.id)).not.toContain("refs");
  });
});
