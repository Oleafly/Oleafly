// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { acceptsOutsideEdit, editedOutside, shareParsingDocument, touchedRegion, typedClass, unitsOf } from "./markdown-toolbar-corpus";

const parse = (text: string, type: DOMParserSupportedType = "text/html") => new window.DOMParser().parseFromString(text, type);

describe("shareParsingDocument", () => {
  it("parses HTML into one shared document until the last caller releases it", () => {
    const native = window.DOMParser.prototype.parseFromString;
    const releaseFirst = shareParsingDocument();
    const releaseSecond = shareParsingDocument();
    expect(parse("<body><p>a</p></body>").body.innerHTML).toBe("<p>a</p>");
    expect(parse("<p>b</p>")).toBe(parse("<p>c</p>"));
    expect(parse("<a/>", "application/xml")).not.toBe(parse("<b/>", "application/xml"));
    releaseFirst();
    releaseFirst();
    expect(parse("<p>b</p>")).toBe(parse("<p>c</p>"));
    releaseSecond();
    expect(window.DOMParser.prototype.parseFromString).toBe(native);
    expect(parse("<p>b</p>")).not.toBe(parse("<p>c</p>"));
  });
});

describe("editedOutside", () => {
  it("accepts an insertion that can slide back into the region", () => {
    expect(editedOutside("A.\n\nB.", "A.\n\n| t |\n\nB.", { from: 0, to: 2 })).toBeNull();
  });

  it("names the span of an edit that reaches the next block", () => {
    expect(editedOutside("A.\n\nB.", "A.\n\n## B.", { from: 0, to: 2 })).toEqual({ from: 4, to: 4 });
  });

  it("accepts an edit inside the region and rejects one that joins the blocks", () => {
    expect(editedOutside("Alpha bravo.\n\nNext.", "Alpha **bravo**.\n\nNext.", { from: 0, to: 12 })).toBeNull();
    expect(editedOutside("Alpha.\n\nNext.", "Alpha.\nNext.", { from: 0, to: 6 })).not.toBeNull();
  });
});

describe("touchedRegion", () => {
  const source = "Alpha bravo.\n\nNext para.\n";
  const region = (at: number) => touchedRegion(unitsOf(source), source, at, at);

  it("ends a blank-line caret's blocks at the block above, so an edit to the next block counts as outside", () => {
    expect(editedOutside(source, "Alpha bravo.\n\n## Next para.\n", region(13))).not.toBeNull();
    expect(editedOutside(source, "Alpha bravo.\nNext para.\n", region(13))).not.toBeNull();
    expect(editedOutside(source, "## Alpha bravo.\n\nNext para.\n", region(13))).toBeNull();
  });

  it("still lets a table inserted on the blank line slide back to the block above", () => {
    expect(editedOutside(source, "Alpha bravo.\n\n| a |\n| --- |\n\nNext para.\n", region(13))).toBeNull();
  });
});

describe("acceptsOutsideEdit", () => {
  const source = "Alpha bravo.\n\n* star one\n* star two\n\n__strong__ end.\n";
  const visual = { baseline: source, acted: "Alpha **bravo**.\n\n* star one\n* star two\n\n__strong__ end.\n" };

  it("rejects a rewrite of another block's markup even when it reads the same", () => {
    expect(acceptsOutsideEdit(source, "Alpha **bravo**.\n\n- star one\n- star two\n\n__strong__ end.\n", visual)).toBe(false);
    expect(acceptsOutsideEdit(source, "Alpha **bravo**.\n\n* star one\n* star two\n\n**strong** end.\n", visual)).toBe(false);
  });

  it("accepts Visual's own edit, and the same edit when Visual also respells a block the action never touched", () => {
    expect(acceptsOutsideEdit(source, visual.acted, visual)).toBe(true);
    const respelled = "Alpha bravo.\n\n- star one\n- star two\n\n__strong__ end.\n";
    expect(acceptsOutsideEdit(source, visual.acted, { baseline: respelled, acted: "Alpha **bravo**.\n\n- star one\n- star two\n\n__strong__ end.\n" })).toBe(true);
    expect(acceptsOutsideEdit(source, visual.acted, null)).toBe(false);
  });
});

describe("typedClass", () => {
  const acted = "* one\n* two\n";
  const caret = { from: 8, to: 8 };

  it("leaves Visual's first-key rewrite of other markup out of the match, and counts Code's local insert as right", () => {
    expect(typedClass({ code: acted, visual: acted }, { code: "* one\n* **H**two\n", visual: "- one\n- **H**two\n" }, caret, true)).toBe("typed:visual-rewrites");
  });

  it("never counts a match when Code's first key changes text outside the typed span", () => {
    expect(typedClass({ code: acted, visual: acted }, { code: "- one\n- **H**two\n", visual: "- one\n- **H**two\n" }, caret, true)).toBe("typed:visual-rewrites");
    expect(typedClass({ code: acted, visual: acted }, { code: "- one\n* **H**two\n", visual: "* one\n* **H**two\n" }, caret, true)).toBe("typed:code-rewrites");
  });

  it("treats the typed key alone, moved off markup into the same block, as local, but not into another block", () => {
    expect(typedClass({ code: acted, visual: acted }, { code: "* one\n* Xtwo\n", visual: "* one\n* Xtwo\n" }, { from: 6, to: 6 }, true, "X")).toBe("typed:equal");
    const paragraphs = "Alpha.\n\nNext.\n";
    expect(typedClass({ code: paragraphs, visual: paragraphs }, { code: "Alpha.\n\nXNext.\n", visual: "Alpha.X\n\nNext.\n" }, { from: 6, to: 6 }, true, "X")).toBe("typed:code-rewrites");
  });

  it("matches a local insert both sides wrote, and keeps a differing action out of the typed match", () => {
    expect(typedClass({ code: acted, visual: acted }, { code: "* one\n* **H**two\n", visual: "* one\n* **H**two\n" }, caret, true)).toBe("typed:equal");
    expect(typedClass({ code: acted, visual: "- one\n- two\n" }, { code: "* one\n* Htwo\n", visual: "- one\n- Htwo\n" }, caret, true)).toBe("typed:after-differing-action");
  });
});
