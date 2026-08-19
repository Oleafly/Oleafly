// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { registry } from "@oleafly/registry";
import { registerRailTabs } from "./tabs";

describe("rail tab labels", () => {
  afterEach(() => {
    registry.railTabs.length = 0;
  });

  it("uses clear navigation tooltips", () => {
    registry.railTabs.length = 0;
    registerRailTabs();

    expect(registry.railTabs.find((tab) => tab.id === "search")?.label).toBe("Search Project");
    expect(registry.railTabs.find((tab) => tab.id === "source")?.label).toBe("Source Control");
    expect(registry.railTabs.find((tab) => tab.id === "preflight")?.label).toBe("Preflight Checks");
  });
});
