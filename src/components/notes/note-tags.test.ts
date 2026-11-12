import { describe, expect, it } from "vitest";
import { nameTone } from "@/components/ui/tones";
import { isTagStart, plainTextTags, tagAt, tagKey, tagTone } from "./note-tags";

describe("inline tags", () => {
  it.each([
    ["#idea", ["idea"]],
    ["start #a mid (#b) end", ["a", "b"]],
    ["#123 and #y1984 and #2024-01", ["y1984", "2024-01"]],
    ["a#b c#d", []],
    ["#a/b/c and #/lead and #trail/ and #/", ["a/b/c", "lead", "trail"]],
    ["#tag. #tag's #tag#next", ["tag", "tag", "tag"]],
    ["#Ünïcode #日本語 #ok_1-2", ["Ünïcode", "日本語", "ok_1-2"]],
  ])("reads %j", (text, expected) => {
    expect(plainTextTags(text).map((range) => range.tag)).toEqual(expected);
  });

  it("checks where a tag may start", () => {
    expect(isTagStart("#a", 0)).toBe(true);
    expect(isTagStart("x#a", 1)).toBe(false);
    expect(isTagStart("(#a", 1)).toBe(true);
    expect(isTagStart("ab", 0)).toBe(false);
    expect(tagAt("# a", 0)).toBeNull();
    expect(tagAt("#//a//", 0)).toEqual({ from: 0, to: 4, tag: "a" });
    expect(tagKey("ML")).toBe("ml");
  });

  it("finds tags in plain editor text and skips URLs there", () => {
    expect(plainTextTags("see #a and https://x.org/#b then #c")).toEqual([
      { from: 4, to: 6, tag: "a" },
      { from: 33, to: 35, tag: "c" },
    ]);
  });

  it("gives a tag one tone whatever its case or leading #", () => {
    expect(tagTone("Daily")).toBe(tagTone("daily"));
    expect(tagTone("#DAILY")).toBe(tagTone("daily"));
    expect(tagTone("##daily")).toBe(nameTone("daily"));
    expect(tagTone("Lab/2024")).toBe(nameTone("lab/2024"));
  });
});
