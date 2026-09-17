import { describe, expect, it } from "vitest";
import {
  headingCommandForLevel,
  headingLevelForCommand,
  isSectioningCommand,
  SECTIONING_COMMANDS,
} from "./sectioning";

describe("sectioning", () => {
  it("lists the seven LaTeX sectioning commands", () => {
    expect(SECTIONING_COMMANDS).toEqual([
      "part",
      "chapter",
      "section",
      "subsection",
      "subsubsection",
      "paragraph",
      "subparagraph",
    ]);
    expect(isSectioningCommand("chapter")).toBe(true);
    expect(isSectioningCommand("textbf")).toBe(false);
    expect(isSectioningCommand("toString")).toBe(false);
  });

  it("keeps section, subsection and subsubsection on levels 1 to 3", () => {
    expect(headingLevelForCommand("section")).toBe(1);
    expect(headingLevelForCommand("subsection")).toBe(2);
    expect(headingLevelForCommand("subsubsection")).toBe(3);
    expect(headingLevelForCommand("part")).toBe(1);
    expect(headingLevelForCommand("chapter")).toBe(1);
    expect(headingLevelForCommand("paragraph")).toBe(4);
    expect(headingLevelForCommand("subparagraph")).toBe(5);
  });

  it("maps levels back to commands and clamps out-of-range levels", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(headingCommandForLevel)).toEqual([
      "section",
      "section",
      "subsection",
      "subsubsection",
      "paragraph",
      "subparagraph",
      "subparagraph",
      "subparagraph",
    ]);
  });
});
