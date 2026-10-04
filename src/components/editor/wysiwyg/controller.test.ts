import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findWysiwygReferences,
  goToWysiwygDefinition,
  setWysiwygProjectNavigation,
} from "./controller";

afterEach(() => {
  setWysiwygProjectNavigation(null);
});

describe("visual project navigation", () => {
  it("declines definition and reference lookups while no visual editor registered", () => {
    expect(goToWysiwygDefinition()).toBe(false);
    expect(findWysiwygReferences()).toBe(false);
  });

  it("forwards lookups to the registered visual editor", () => {
    const navigation = {
      goToDefinition: vi.fn(() => true),
      findReferences: vi.fn(() => false),
    };
    setWysiwygProjectNavigation(navigation);
    expect(goToWysiwygDefinition()).toBe(true);
    expect(findWysiwygReferences()).toBe(false);
    expect(navigation.goToDefinition).toHaveBeenCalledOnce();
    expect(navigation.findReferences).toHaveBeenCalledOnce();
  });
});
