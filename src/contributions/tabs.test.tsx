// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { railTabLabel, registry, type AppContext } from "@oleafly/registry";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { registerRailTabs } from "./tabs";

const ctx: AppContext = { projectId: null, projectKind: null, theme: "light" };

const labelOf = (id: string) => {
  const tab = registry.railTabs.find((entry) => entry.id === id);
  return tab ? railTabLabel(tab, ctx) : undefined;
};

describe("rail tab labels", () => {
  afterEach(() => {
    registry.railTabs.length = 0;
  });

  it("uses clear navigation tooltips", () => {
    registry.railTabs.length = 0;
    registerRailTabs();

    expect(labelOf("search")).toBe(enShell.rail.search);
    expect(labelOf("source")).toBe(enShell.rail.sourceControl);
    expect(labelOf("preflight")).toBe(enShell.rail.preflight);
    expect(labelOf("refs")).toBe(enShell.rail.references);
  });
});
