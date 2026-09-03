import { describe, it, expect } from "vitest";
import { diffWords, type WordDiffToken } from "./diff-words";

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

const WORDS = ["alpha", "beta", "gamma", "delta", "kernel", "lemma", "proof", "tensor"];
const GAPS = [" ", "  ", "\n", " \n  "];

function randomText(random: () => number, wordCount: number): string {
  const parts: string[] = [];
  for (let i = 0; i < wordCount; i += 1) {
    if (i > 0) parts.push(GAPS[Math.floor(random() * GAPS.length)]);
    parts.push(WORDS[Math.floor(random() * WORDS.length)]);
  }
  return parts.join("");
}

function editText(random: () => number, text: string): string {
  const tokens = text.match(/\S+\s*|\s+/g) ?? [];
  const out: string[] = [];
  for (const token of tokens) {
    const roll = random();
    if (roll < 0.12) out.push(`${WORDS[Math.floor(random() * WORDS.length)]} `);
    else if (roll < 0.24) continue;
    else if (roll < 0.32) out.push(token, `${WORDS[Math.floor(random() * WORDS.length)]} `);
    else out.push(token);
  }
  return out.join("");
}

function alternatingRewrite(pairs: number): { oldText: string; newText: string } {
  const before: string[] = [];
  const after: string[] = [];
  for (let i = 0; i < pairs; i += 1) {
    before.push(`keep${i}`, `drop${i}`);
    after.push(`keep${i}`, `fresh${i}`);
  }
  return { oldText: before.join(" "), newText: after.join(" ") };
}

function reconstructions(tokens: WordDiffToken[]): { old: string; next: string } {
  return {
    old: tokens
      .filter((t) => t.kind !== "add")
      .map((t) => t.text)
      .join(""),
    next: tokens
      .filter((t) => t.kind !== "del")
      .map((t) => t.text)
      .join(""),
  };
}

describe("diffWords", () => {
  it("returns a single 'same' run for identical text", () => {
    expect(diffWords("hello world", "hello world")).toEqual([
      { kind: "same", text: "hello world" },
    ]);
  });

  it("marks a replaced word as del then add", () => {
    const d = diffWords("the old cat", "the new cat");
    expect(d.filter((t) => t.kind === "del").map((t) => t.text.trim())).toContain("old");
    expect(d.filter((t) => t.kind === "add").map((t) => t.text.trim())).toContain("new");
    // 'the' and 'cat' survive as 'same'
    expect(d.some((t) => t.kind === "same" && t.text.includes("the"))).toBe(true);
    expect(d.some((t) => t.kind === "same" && t.text.includes("cat"))).toBe(true);
  });

  it("reconstructs old text from same+del and new text from same+add", () => {
    const oldT = "alpha beta gamma";
    const newT = "alpha delta gamma epsilon";
    const d = diffWords(oldT, newT);
    expect(d.filter((t) => t.kind !== "add").map((t) => t.text).join("")).toBe(oldT);
    expect(d.filter((t) => t.kind !== "del").map((t) => t.text).join("")).toBe(newT);
  });

  it("handles empty old (pure addition) and empty new (pure deletion)", () => {
    expect(diffWords("", "hi").every((t) => t.kind === "add")).toBe(true);
    expect(diffWords("hi", "").every((t) => t.kind === "del")).toBe(true);
  });

  it("replays both sides of seeded random edits", () => {
    const random = seededRandom(19871123);
    for (let round = 0; round < 300; round += 1) {
      const oldText = randomText(random, Math.floor(random() * 60));
      const newText = editText(random, oldText);
      const tokens = diffWords(oldText, newText);
      const replayed = reconstructions(tokens);
      expect(replayed.old).toBe(oldText);
      expect(replayed.next).toBe(newText);
    }
  });

  it("never emits an empty token or two neighbours of the same kind", () => {
    const random = seededRandom(50510);
    for (let round = 0; round < 300; round += 1) {
      const oldText = randomText(random, Math.floor(random() * 60));
      const newText = editText(random, oldText);
      const tokens = diffWords(oldText, newText);
      for (let i = 0; i < tokens.length; i += 1) {
        expect(tokens[i].text.length).toBeGreaterThan(0);
        if (i > 0) expect(tokens[i].kind).not.toBe(tokens[i - 1].kind);
      }
    }
  });

  it("keeps unrelated rewrites of unequal length replayable", () => {
    const random = seededRandom(3300);
    for (let round = 0; round < 100; round += 1) {
      const oldText = randomText(random, Math.floor(random() * 40));
      const newText = randomText(random, Math.floor(random() * 40));
      const replayed = reconstructions(diffWords(oldText, newText));
      expect(replayed.old).toBe(oldText);
      expect(replayed.next).toBe(newText);
    }
  });

  it("diffs an alternating rewrite word by word while it fits the work cap", () => {
    const { oldText, newText } = alternatingRewrite(100);
    const tokens = diffWords(oldText, newText);
    expect(tokens.filter((t) => t.kind === "same").length).toBeGreaterThan(50);
    const replayed = reconstructions(tokens);
    expect(replayed.old).toBe(oldText);
    expect(replayed.next).toBe(newText);
  });

  it("falls back to one replacement when the work cap is exceeded", () => {
    const { oldText, newText } = alternatingRewrite(1000);
    const tokens = diffWords(oldText, newText);
    expect(tokens).toEqual([
      { kind: "del", text: oldText },
      { kind: "add", text: newText },
    ]);
    const replayed = reconstructions(tokens);
    expect(replayed.old).toBe(oldText);
    expect(replayed.next).toBe(newText);
  });
});
