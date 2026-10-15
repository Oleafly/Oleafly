import { describe, expect, it } from "vitest";
import { middleEllipsisPath } from "./middle-ellipsis";

describe("middleEllipsisPath", () => {
  it("leaves a path that fits alone", () => {
    expect(middleEllipsisPath("intro.tex", 30)).toBe("intro.tex");
    expect(middleEllipsisPath("chapters/intro.tex", 18)).toBe("chapters/intro.tex");
  });

  it("keeps the first folder and the file name and drops the folders in between", () => {
    expect(middleEllipsisPath("chapters/part-one/section-two/subsection/very-long-name.tex", 29)).toBe(
      "chapters/…/very-long-name.tex",
    );
  });

  it("keeps as many folders next to the file as fit", () => {
    expect(middleEllipsisPath("chapters/part-one/section-two/subsection/very-long-name.tex", 40)).toBe(
      "chapters/…/subsection/very-long-name.tex",
    );
  });

  it("drops the first folder when it is too long to keep", () => {
    expect(middleEllipsisPath("a-really-long-top-folder/x/name.tex", 20)).toBe("…/x/name.tex");
  });

  it("never cuts the file name, even when the name alone is too long", () => {
    expect(middleEllipsisPath("chapters/an-extremely-long-file-name.tex", 20)).toBe(
      "…/an-extremely-long-file-name.tex",
    );
    expect(middleEllipsisPath("an-extremely-long-file-name.tex", 10)).toBe("an-extremely-long-file-name.tex");
  });

  it("shortens a path with a single folder by dropping that folder", () => {
    expect(middleEllipsisPath("a-long-folder-name/main.tex", 15)).toBe("…/main.tex");
  });
});
