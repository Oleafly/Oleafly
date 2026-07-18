import { describe, it, expect } from "vitest";
import { parseDiff, toSplitPairs } from "./diff";
import { required } from "./test-utils";

const SAMPLE = `diff --git a/main.tex b/main.tex
index 1111111..2222222 100644
--- a/main.tex
+++ b/main.tex
@@ -1,3 +1,3 @@
 context
-old line
+new line
 context2`;

describe("parseDiff", () => {
  it("classifies each line and strips the leading marker", () => {
    const rows = parseDiff(SAMPLE);
    const kinds = rows.map((r) => r.kind);
    expect(kinds).toEqual([
      "meta", // diff --git
      "meta", // index
      "meta", // ---
      "meta", // +++
      "hunk", // @@
      "context",
      "del",
      "add",
      "context",
    ]);
    const del = required(rows.find((r) => r.kind === "del"));
    const add = required(rows.find((r) => r.kind === "add"));
    expect(del.text).toBe("old line"); // leading "-" stripped
    expect(add.text).toBe("new line"); // leading "+" stripped
    expect(rows[5].text).toBe("context"); // leading " " stripped
  });

  it("tracks old/new line numbers from the hunk header", () => {
    const rows = parseDiff(SAMPLE);
    const context = rows[5];
    expect(context.oldLine).toBe(1);
    expect(context.newLine).toBe(1);
    const del = required(rows.find((r) => r.kind === "del"));
    expect(del.oldLine).toBe(2);
    const add = required(rows.find((r) => r.kind === "add"));
    expect(add.newLine).toBe(2);
    const context2 = rows[rows.length - 1];
    expect(context2.oldLine).toBe(3);
    expect(context2.newLine).toBe(3);
  });

  it("treats a `\\ No newline` marker as meta", () => {
    const rows = parseDiff("+x\n\\ No newline at end of file");
    expect(rows[1].kind).toBe("meta");
  });
});

describe("toSplitPairs", () => {
  it("pairs a deletion with its corresponding addition side by side", () => {
    const pairs = toSplitPairs(parseDiff(SAMPLE));
    // meta rows dropped; hunk + 2 contexts kept; the del/add form one pair.
    const changed = pairs.find((p) => p.l?.kind === "del");
    expect(changed?.l?.text).toBe("old line");
    expect(changed?.r?.kind).toBe("add");
    expect(changed?.r?.text).toBe("new line");
  });

  it("leaves one side empty when deletions and additions are uneven", () => {
    const rows = parseDiff("@@ -1,2 +1,1 @@\n-a\n-b\n+c");
    const pairs = toSplitPairs(rows);
    const withDels = pairs.filter((p) => p.l?.kind === "del");
    expect(withDels).toHaveLength(2);
    // second deletion has no matching addition
    expect(withDels[1].r).toBeUndefined();
    expect(withDels[0].r?.text).toBe("c");
  });
});
