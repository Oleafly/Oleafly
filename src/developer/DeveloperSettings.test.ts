import { describe, expect, it } from "vitest";
import { isDevelopmentLibraryRoot } from "./DeveloperSettings";

describe("isDevelopmentLibraryRoot", () => {
  it("accepts the isolated macOS and Windows development roots", () => {
    expect(isDevelopmentLibraryRoot("/Users/researcher/.oleafly-dev/projects")).toBe(true);
    expect(isDevelopmentLibraryRoot("C:\\Users\\researcher\\.oleafly-dev\\projects\\")).toBe(true);
  });

  it("rejects production and arbitrary libraries", () => {
    expect(isDevelopmentLibraryRoot("/Users/researcher/.oleafly/projects")).toBe(false);
    expect(isDevelopmentLibraryRoot("/tmp/oleafly-e2e/projects")).toBe(false);
  });
});
