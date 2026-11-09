import { describe, expect, it } from "vitest";
import {
  frontMatterBody,
  frontMatterKey,
  frontMatterRawValue,
  frontMatterScalar,
  frontMatterValue,
  frontMatterValues,
  splitFrontMatter,
  valueOfLines,
  valuesOfLines,
} from "./front-matter";

describe("front matter reader", () => {
  it("splits the block at the first closing fence", () => {
    const front = splitFrontMatter("﻿---  \r\nid: a\r\nkind: note\r\n... \r\nBody\r\n");
    expect(front?.lines).toEqual(["id: a", "kind: note"]);
    expect(front?.body).toBe("Body\r\n");
    const closedLast = splitFrontMatter("---\nid: a\n---");
    expect(closedLast?.lines).toEqual(["id: a"]);
    expect(closedLast?.body).toBe("");
    expect(splitFrontMatter("---\n---\nrest")?.body).toBe("rest");
    for (const open of [
      "No front matter",
      "---",
      "---\nid: a\n",
      " ---\nid: a\n---\n",
      "...\nid: a\n...\n",
      "----\nid: a\n---\n",
    ]) {
      expect(splitFrontMatter(open), JSON.stringify(open)).toBeNull();
    }
  });

  it("stops at an empty block instead of reading a later fence", () => {
    const text = "---\n---\nid: a\n---\n";
    expect(splitFrontMatter(text)?.lines).toEqual([]);
    expect(frontMatterValue(text, "id")).toBeNull();
    expect(frontMatterBody(text)).toBe("id: a\n---\n");
  });

  it("reads keys with spaces, quotes and comments the same way", () => {
    expect(frontMatterKey("id: a")).toBe("id");
    expect(frontMatterKey("id : a")).toBe("id");
    expect(frontMatterKey("id\t: a")).toBe("id");
    expect(frontMatterKey('"id": a')).toBe("id");
    expect(frontMatterKey("'id': a")).toBe("id");
    expect(frontMatterKey("id:")).toBe("id");
    for (const line of ["  id: a", "\tid: a", "- id: a", "# id: a", "id:a", ": a", "plain text"]) {
      expect(frontMatterKey(line), JSON.stringify(line)).toBeNull();
    }
    expect(frontMatterRawValue("id :  a b ")).toBe("a b");
    expect(frontMatterValue("---\nid : abc # old\n---\n", "id")).toBe("abc");
    expect(frontMatterValue("---\nid: abc\t# old\n---\n", "id")).toBe("abc");
    expect(frontMatterValue("---\nid: a#b\n---\n", "id")).toBe("a#b");
    expect(frontMatterValue("---\nid: # none\n---\n", "id")).toBeNull();
    expect(frontMatterValue('---\nid: "a # b" # c\n---\n', "id")).toBe("a # b");
    expect(frontMatterValue("---\nid: 'it''s' # c\n---\n", "id")).toBe("it's");
    expect(frontMatterValue("---\nkind:note\n---\n", "kind")).toBeNull();
    expect(frontMatterValue("---\nidentity: a\n---\n", "id")).toBeNull();
  });

  it("lets the last entry win and reads empty values as missing", () => {
    expect(valueOfLines(["id: a", 'id: "b"'], "id")).toBe("b");
    expect(valueOfLines(["id: a", "id:   "], "id")).toBeNull();
    expect(valueOfLines(["id: a", "  id: b"], "id")).toBe("a");
    expect(valueOfLines([], "id")).toBeNull();
    expect(valuesOfLines(["id: a", 'id: "b"', "kind: note", "kind:"])).toEqual(new Map([["id", "b"]]));
  });

  it("reads quoted scalars like YAML", () => {
    expect(frontMatterScalar('"a\\"b\\u00e9"')).toBe('a"bé');
    expect(frontMatterScalar("'a''b'")).toBe("a'b");
    expect(frontMatterScalar('"  padded  "')).toBe("padded");
    expect(frontMatterScalar('""')).toBeNull();
    expect(frontMatterScalar("''")).toBeNull();
    expect(frontMatterScalar('"unterminated')).toBeNull();
    expect(frontMatterScalar("'unterminated")).toBeNull();
    expect(frontMatterScalar('"bad \\q escape"')).toBeNull();
    expect(frontMatterScalar('"ends with \\')).toBeNull();
    expect(frontMatterScalar("Paper: draft")).toBe("Paper: draft");
    expect(frontMatterScalar("  note  ")).toBe("note");
  });

  it("collects every scalar in the block, keeping the last value of each key", () => {
    const text = '---\ntitle: "A: b"\nkind : note\n"id": x\nid: y # moved\ntags: [a, b]\n  nested: no\n---\nBody\n';
    expect(frontMatterValues(text)).toEqual(
      new Map([
        ["title", "A: b"],
        ["kind", "note"],
        ["id", "y"],
        ["tags", "[a, b]"],
      ]),
    );
    expect(frontMatterValues("No front matter\nid: a\n").size).toBe(0);
    expect(frontMatterBody("No front matter\n")).toBe("No front matter\n");
  });
});
