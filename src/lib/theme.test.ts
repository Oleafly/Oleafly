// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { getInitialTheme } from "./theme";

describe("theme initialization", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults new installs to dark", () => {
    expect(getInitialTheme()).toBe("dark");
  });

  it("keeps a saved theme preference", () => {
    localStorage.setItem("oleafly.theme", "light");
    expect(getInitialTheme()).toBe("light");
  });
});
