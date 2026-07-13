import { describe, it, expect, beforeEach } from "vitest";
import { registry, registerContextProvider, activeContextProvider } from "@openleaf/registry";

const ctx = { projectId: "p", projectKind: "tex", theme: "light" as const };
beforeEach(() => { registry.contextProviders.length = 0; });

describe("context providers", () => {
  it("returns the active provider", () => {
    registerContextProvider({ id: "editor", isActive: () => true, order: 10 });
    expect(activeContextProvider(ctx)?.id).toBe("editor");
  });
  it("lowest order wins among active", () => {
    registerContextProvider({ id: "a", isActive: () => true, order: 20 });
    registerContextProvider({ id: "b", isActive: () => true, order: 10 });
    expect(activeContextProvider(ctx)?.id).toBe("b");
  });
});
