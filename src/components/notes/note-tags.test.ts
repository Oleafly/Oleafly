import { describe, expect, it } from "vitest";
import {
  displayTags,
  frontMatterList,
  isTagStart,
  markdownTagRanges,
  noteTags,
  plainTextTags,
  tagAt,
  tagKey,
  tagMatches,
} from "./note-tags";

const tagsIn = (markdown: string) => markdownTagRanges(markdown).map((range) => range.tag);

describe("inline tags", () => {
  it.each([
    ["#idea", ["idea"]],
    ["start #a mid (#b) end", ["a", "b"]],
    ["#123 and #y1984 and #2024-01", ["y1984", "2024-01"]],
    ["a#b c#d", []],
    ["#a/b/c and #/lead and #trail/ and #/", ["a/b/c", "lead", "trail"]],
    ["#tag. #tag's #tag#next", ["tag", "tag", "tag"]],
    ["#Ünïcode #日本語 #ok_1-2", ["Ünïcode", "日本語", "ok_1-2"]],
    ["\\#escaped #real", ["real"]],
  ])("reads %j", (text, expected) => {
    expect(tagsIn(text)).toEqual(expected);
  });

  it("skips headings, code, links and URLs", () => {
    const text = [
      "# Heading with #inside",
      "## Second",
      "`#code` and ``#also `x` here`` and an unclosed ` then #open",
      "[x](#y) [#text](url) ](#dangling) <https://a.b/#auto> https://x.org/p#frag xhttps://n#a",
      "```",
      "#fenced",
      "```",
      "~~~~",
      "#tilde",
      "~~~",
      "#still",
      "~~~~",
      "#after",
    ].join("\n");
    expect(tagsIn(text)).toEqual(["inside", "open", "after"]);
  });

  it("leaves an unclosed fence open to the end", () => {
    expect(tagsIn("#a\n```\n#b")).toEqual(["a"]);
  });

  it("gives offsets in the source with CRLF lines", () => {
    const text = "x #a\r\n#bb\r\n";
    expect(markdownTagRanges(text)).toEqual([
      { from: 2, to: 4, tag: "a" },
      { from: 6, to: 9, tag: "bb" },
    ]);
  });

  it("skips front matter and reads tags after it", () => {
    expect(tagsIn("---\ntitle: #no\n---\n#yes")).toEqual(["yes"]);
    expect(tagsIn("---\ntitle: open\n#yes")).toEqual(["yes"]);
  });

  it("checks where a tag may start", () => {
    expect(isTagStart("#a", 0)).toBe(true);
    expect(isTagStart("x#a", 1)).toBe(false);
    expect(isTagStart("(#a", 1)).toBe(true);
    expect(isTagStart("ab", 0)).toBe(false);
    expect(tagAt("# a", 0)).toBeNull();
    expect(tagAt("#//a//", 0)).toEqual({ from: 0, to: 4, tag: "a" });
  });

  it("finds tags in plain editor text and skips URLs there", () => {
    expect(plainTextTags("see #a and https://x.org/#b then #c")).toEqual([
      { from: 4, to: 6, tag: "a" },
      { from: 33, to: 35, tag: "c" },
    ]);
  });
});

describe("front matter lists", () => {
  it.each([
    ["---\ntags: [a, \"b c\", '#d']\n---\n", ["a", "b c", "d"]],
    ["---\ntags: [a, b\n---\n", ["a", "b"]],
    ["---\ntags:\n  - one\n\n  - '#two'\n  -\nnext: x\n---\n", ["one", "two"]],
    ["---\ntags: alpha, #beta gamma\n---\n", ["alpha", "beta", "gamma"]],
    ["---\ntags: \"#a #b\"\n---\n", ["a", "b"]],
    ["---\nother: 1\n---\n", []],
    ["no front matter", []],
    ["---\ntags: [a]\n", []],
    ["---\n\"tags\" : [a, b]\n---\n", ["a", "b"]],
    ["---\ntags:[a]\n---\n", []],
    ["---\n---\ntags: [a]\n---\n", []],
  ])("reads %j", (text, expected) => {
    expect(frontMatterList(text, "tags")).toEqual(expected);
  });

  it("splits aliases on commas only", () => {
    expect(frontMatterList("---\naliases: Masking study, MAE\n---\n", "aliases")).toEqual(["Masking study", "MAE"]);
    expect(frontMatterList("...\n", "aliases")).toEqual([]);
  });
});

describe("note tags", () => {
  const text = "---\ntags: [Draft, ml/vision]\n---\nWork on #ML/Vision and #draft and #new #New\n";

  it("puts front matter first and keeps the first spelling", () => {
    expect(displayTags(text)).toEqual(["Draft", "ml/vision", "new"]);
    expect(noteTags(text)).toEqual(["draft", "ml/vision", "new"]);
  });

  it("matches a tag and its children", () => {
    expect(tagKey("ML")).toBe("ml");
    expect(tagMatches("ml/vision", "#ML")).toBe(true);
    expect(tagMatches("ml", "ml")).toBe(true);
    expect(tagMatches("mlops", "ml")).toBe(false);
  });
});
