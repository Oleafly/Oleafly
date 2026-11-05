import assert from "node:assert/strict";
import test from "node:test";
import { rankPrefetchNames } from "./tectonic-prefetch-list.mjs";

test("files more documents need come first", () => {
  const lists = [
    ["article.cls", "only-a.sty", "amsmath.sty"],
    ["amsmath.sty", "article.cls"],
    ["article.cls", "amsmath.sty", "only-c.sty"],
  ];
  assert.deepEqual(rankPrefetchNames(lists), [
    "article.cls",
    "amsmath.sty",
    "only-a.sty",
    "only-c.sty",
  ]);
});

test("files used equally often keep the order Tectonic read them in", () => {
  assert.deepEqual(rankPrefetchNames([["z.sty", "a.sty"]]), ["z.sty", "a.sty"]);
});

test("the list stops at the cap", () => {
  assert.deepEqual(rankPrefetchNames([["a.sty", "b.sty", "c.sty"]], 2), ["a.sty", "b.sty"]);
});
