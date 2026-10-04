import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
}));

vi.mock("@/contributions/tabs", () => ({ registerRailTabs: () => mocks.calls.push("tabs") }));
vi.mock("@/contributions/commands", () => ({
  registerOmnibarCommands: () => mocks.calls.push("omnibar"),
  registerPaletteCommands: () => mocks.calls.push("palette"),
}));
vi.mock("@/contributions/context-providers", () => ({
  registerContextProviders: () => mocks.calls.push("context"),
}));
vi.mock("@/contributions/presentation-commands", () => ({
  registerPresentationCommands: () => mocks.calls.push("presentation"),
}));

import { registerContributions } from "./index";

describe("registerContributions", () => {
  it("registers every contribution group once, in order, even when called again", () => {
    registerContributions();
    registerContributions();
    expect(mocks.calls).toEqual(["tabs", "omnibar", "palette", "presentation", "context"]);
  });
});
