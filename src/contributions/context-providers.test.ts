import { afterEach, describe, expect, it } from "vitest";
import { activeContextProvider, registry } from "@oleafly/registry";
import { registerContextProviders } from "./context-providers";

afterEach(() => {
  registry.contextProviders.length = 0;
});

describe("registerContextProviders", () => {
  it("makes the editor the active context whenever a project is open", () => {
    registerContextProviders();
    expect(activeContextProvider({ projectId: "p1", projectKind: "tex", theme: "light" })?.id).toBe("editor");
    expect(activeContextProvider({ projectId: null, projectKind: null, theme: "light" })).toBeUndefined();
  });
});
