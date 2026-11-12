import { describe, expect, it } from "vitest";
import { frontMatterBody, frontMatterValues, splitFrontMatter } from "./front-matter";

function scalarIn(lines: string, key = "id"): string | null {
  return frontMatterValues(`---\n${lines}\n---\n`).get(key) ?? null;
}

describe("front matter reader", () => {
  it("splits the block at the first closing fence", () => {
    const front = splitFrontMatter("﻿---  \r\nid: a\r\nkind: note\r\n... \r\nBody\r\n");
    expect(front?.lines).toEqual(["id: a", "kind: note"]);
    expect(front?.body).toBe("Body\r\n");
    const closedLast = splitFrontMatter("---\nid: a\n---");
    expect(closedLast?.lines).toEqual(["id: a"]);
    expect(closedLast?.body).toBe("");
    expect(splitFrontMatter("---\n---\nrest")?.body).toBe("rest");
    expect(frontMatterBody("---\ntitle: A\n---\n\nBody")).toBe("\nBody");
    expect(frontMatterBody("No front matter\n")).toBe("No front matter\n");
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
    expect(frontMatterValues(text).get("id")).toBeUndefined();
    expect(frontMatterBody(text)).toBe("id: a\n---\n");
  });

  it.each([
    ["id: a", "a"],
    ["id : a", "a"],
    ["id\t: a", "a"],
    ['"id": a', "a"],
    ["'id': a", "a"],
    ["id : abc # old", "abc"],
    ["id: abc\t# old", "abc"],
    ["id: a#b", "a#b"],
    ['id: "a # b" # c', "a # b"],
    ["id: 'it''s' # c", "it's"],
    ['id: "a\\"b\\u00e9"', 'a"bé'],
    ['id: "  padded  "', "padded"],
    ["id: Paper: draft", "Paper: draft"],
    ["id: a\nid: \"b\"", "b"],
    ["id: a\n  id: b", "a"],
  ])("reads %j as a scalar the way the vault does", (lines, value) => {
    expect(scalarIn(lines)).toBe(value);
  });

  it.each(["  id: a", "\tid: a", "- id: a", "# id: a", "id:a", ": a", "id: # none", "id:", 'id: ""', "id: ''", 'id: "unterminated', "id: 'unterminated", 'id: "bad \\q escape"', "kind:note", "identity: a", "id: a\nid:   "])(
    "reads nothing for %j",
    (lines) => {
      expect(scalarIn(lines)).toBeNull();
    },
  );

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
