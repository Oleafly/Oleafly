import { describe, expect, it } from "vitest";
import { CONSOLE_SECTIONS, isConsoleSection, SECTION_ICONS, visibleConsoleSections } from "./sections";

describe("console sections", () => {
  it("shows every section to admins and maintainers and none to anyone else", () => {
    expect(visibleConsoleSections("admin")).toEqual([
      "overview",
      "people",
      "access",
      "projects",
      "settings",
      "email",
      "log",
      "checks",
    ]);
    expect(visibleConsoleSections("maintainer")).toEqual([...CONSOLE_SECTIONS]);
    expect(visibleConsoleSections("member")).toEqual([]);
    expect(visibleConsoleSections("guest")).toEqual([]);
  });

  it("has an icon for every section and knows its own names", () => {
    for (const section of CONSOLE_SECTIONS) {
      expect(SECTION_ICONS[section]).toBeTruthy();
      expect(isConsoleSection(section)).toBe(true);
    }
    expect(isConsoleSection("billing")).toBe(false);
    expect(isConsoleSection(null)).toBe(false);
  });
});
