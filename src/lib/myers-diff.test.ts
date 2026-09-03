import { describe, expect, it } from "vitest";
import {
  commonAffixBounds,
  myersEditDistance,
  myersEditScript,
  type MyersEdit,
} from "./myers-diff";

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSequence(random: () => number, length: number, alphabet: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < length; i += 1) out.push(`w${Math.floor(random() * alphabet)}`);
  return out;
}

function lcsLength(a: readonly string[], b: readonly string[]): number {
  const row = new Int32Array(b.length + 1);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    let diagonal = 0;
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const above = row[j];
      row[j] = a[i] === b[j] ? diagonal + 1 : Math.max(row[j], row[j + 1]);
      diagonal = above;
    }
  }
  return row[0];
}

function applyScript(
  script: MyersEdit[],
  a: readonly string[],
  b: readonly string[],
): { fromOld: string[]; fromNew: string[] } {
  const fromOld: string[] = [];
  const fromNew: string[] = [];
  for (const edit of script) {
    if (edit.kind === "add") {
      fromNew.push(...b.slice(edit.newStart, edit.newStart + edit.length));
    } else if (edit.kind === "del") {
      fromOld.push(...a.slice(edit.oldStart, edit.oldStart + edit.length));
    } else {
      fromOld.push(...a.slice(edit.oldStart, edit.oldStart + edit.length));
      fromNew.push(...b.slice(edit.newStart, edit.newStart + edit.length));
    }
  }
  return { fromOld, fromNew };
}

describe("commonAffixBounds", () => {
  it("reports the shared head and the first index past the shared tail", () => {
    expect(commonAffixBounds(["a", "b", "c", "z"], ["a", "x", "y", "c", "z"])).toEqual({
      prefix: 1,
      oldEnd: 2,
      newEnd: 3,
    });
  });

  it("never lets the tail scan cross the head", () => {
    expect(commonAffixBounds(["a", "a", "a"], ["a"])).toEqual({
      prefix: 1,
      oldEnd: 3,
      newEnd: 1,
    });
  });

  it("collapses identical inputs to an empty middle", () => {
    expect(commonAffixBounds(["a", "b"], ["a", "b"])).toEqual({ prefix: 2, oldEnd: 2, newEnd: 2 });
  });
});

describe("myersEditDistance", () => {
  it("counts every item when one side is empty", () => {
    expect(myersEditDistance([], ["a", "b"])).toBe(2);
    expect(myersEditDistance(["a", "b", "c"], [])).toBe(3);
    expect(myersEditDistance([], [])).toBe(0);
  });

  it("agrees with the longest common subsequence on seeded random pairs", () => {
    const random = seededRandom(20260902);
    for (let round = 0; round < 200; round += 1) {
      const a = randomSequence(random, Math.floor(random() * 40), 6);
      const b = randomSequence(random, Math.floor(random() * 40), 6);
      const expected = a.length + b.length - 2 * lcsLength(a, b);
      expect(myersEditDistance(a, b)).toBe(expected);
    }
  });

  it("returns null once the work limit is spent", () => {
    const a = randomSequence(seededRandom(7), 400, 400);
    const b = randomSequence(seededRandom(9), 400, 400);
    expect(myersEditDistance(a, b, 10)).toBeNull();
  });
});

describe("myersEditScript", () => {
  it("describes a pure insertion and a pure deletion as one run", () => {
    expect(myersEditScript([], ["a", "b"])).toEqual([
      { kind: "add", oldStart: 0, newStart: 0, length: 2 },
    ]);
    expect(myersEditScript(["a", "b"], [])).toEqual([
      { kind: "del", oldStart: 0, newStart: 0, length: 2 },
    ]);
    expect(myersEditScript([], [])).toEqual([]);
  });

  it("emits the deletion before the insertion of a replaced item", () => {
    expect(myersEditScript(["the", "old", "cat"], ["the", "new", "cat"])).toEqual([
      { kind: "same", oldStart: 0, newStart: 0, length: 1 },
      { kind: "del", oldStart: 1, newStart: 1, length: 1 },
      { kind: "add", oldStart: 2, newStart: 1, length: 1 },
      { kind: "same", oldStart: 2, newStart: 2, length: 1 },
    ]);
  });

  it("replays both sides and stays minimal on seeded random pairs", () => {
    const random = seededRandom(4711);
    for (let round = 0; round < 200; round += 1) {
      const a = randomSequence(random, Math.floor(random() * 40), 6);
      const b = randomSequence(random, Math.floor(random() * 40), 6);
      const script = myersEditScript(a, b);
      expect(script).not.toBeNull();
      if (!script) continue;
      const { fromOld, fromNew } = applyScript(script, a, b);
      expect(fromOld).toEqual(a);
      expect(fromNew).toEqual(b);
      const edits = script
        .filter((edit) => edit.kind !== "same")
        .reduce((total, edit) => total + edit.length, 0);
      expect(edits).toBe(myersEditDistance(a, b));
      for (let i = 1; i < script.length; i += 1) {
        expect(script[i].kind).not.toBe(script[i - 1].kind);
      }
    }
  });

  it("returns null once the work limit is spent", () => {
    const a = randomSequence(seededRandom(11), 400, 400);
    const b = randomSequence(seededRandom(13), 400, 400);
    expect(myersEditScript(a, b, 10)).toBeNull();
  });
});
