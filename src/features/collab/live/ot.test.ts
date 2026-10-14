import { describe, expect, it } from "vitest";
import {
  OtError,
  TextOperation,
  diffOperation,
  editsFromOperation,
  operationFromEdits,
  replacementOperation,
} from "./ot";

function op(build: (operation: TextOperation) => void): TextOperation {
  const operation = new TextOperation();
  build(operation);
  return operation;
}

function rng(seed: number): (bound: number) => number {
  let state = seed >>> 0;
  return (bound) => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return bound <= 0 ? 0 : state % bound;
  };
}

const ALPHABET = ["a", "b", "\n", "é", "😀", "z"];

function randomText(below: (bound: number) => number, max: number): string {
  let text = "";
  const count = below(max);
  for (let index = 0; index < count; index += 1) text += ALPHABET[below(ALPHABET.length)];
  return text;
}

function randomOperation(below: (bound: number) => number, document: string): TextOperation {
  const operation = new TextOperation();
  const characters = Array.from(document);
  let index = 0;
  while (index < characters.length) {
    const span = 1 + below(Math.min(characters.length - index, 4));
    const units = characters.slice(index, index + span).join("").length;
    const choice = below(3);
    if (choice === 0) operation.retain(units);
    else if (choice === 1) operation.delete(units);
    else {
      operation.insert(randomText(below, 3));
      operation.retain(units);
    }
    index += span;
  }
  if (below(2) === 0) operation.insert(randomText(below, 4));
  return operation;
}

describe("TextOperation", () => {
  it("merges steps and keeps inserts before deletes", () => {
    const built = op((o) => o.retain(2).retain(1).delete(1).insert("x").insert("y").delete(2));
    expect(built.toWire()).toEqual([3, "xy", -3]);
    expect(built.baseLength).toBe(6);
    expect(built.targetLength).toBe(5);
  });

  it("ignores empty steps", () => {
    expect(op((o) => o.retain(0).insert("").delete(0)).toWire()).toEqual([]);
  });

  it("counts lengths in UTF-16 units", () => {
    const emoji = op((o) => o.retain(2).insert("😀"));
    expect(emoji.targetLength).toBe(4);
    expect(emoji.apply("😀")).toBe("😀😀");
    expect(() => op((o) => o.retain(1).delete(1)).apply("😀")).toThrow(OtError);
    expect(() => op((o) => o.retain(1).delete(1)).apply("😀")).toThrow(
      expect.objectContaining({ code: "splits_character" }),
    );
    expect(() => emoji.apply("ab c")).toThrow(expect.objectContaining({ code: "length_mismatch" }));
  });

  it("reads and writes the wire form", () => {
    const operation = op((o) => o.retain(5).insert("hi").delete(2));
    expect(operation.toWire()).toEqual([5, "hi", -2]);
    expect(TextOperation.fromWire([5, "hi", -2]).equals(operation)).toBe(true);
    expect(TextOperation.fromWire([5, -2, "hi"]).toWire()).toEqual([5, "hi", -2]);
    expect(() => TextOperation.fromWire([0])).toThrow(OtError);
    expect(() => TextOperation.fromWire([""])).toThrow(OtError);
    expect(() => TextOperation.fromWire([1.5])).toThrow(OtError);
    expect(() => TextOperation.fromWire([true as unknown as number])).toThrow(OtError);
  });

  it("knows a no-op", () => {
    expect(op((o) => o.retain(3)).isNoop()).toBe(true);
    expect(op((o) => o.retain(3).insert("a")).isNoop()).toBe(false);
  });

  it("places a client insert before a server insert at the same place", () => {
    const client = op((o) => o.retain(1).insert("C").retain(1));
    const server = op((o) => o.retain(1).insert("S").retain(1));
    const [clientPrime, serverPrime] = TextOperation.transform(client, server);
    expect(clientPrime.apply(server.apply("ab"))).toBe("aCSb");
    expect(serverPrime.apply(client.apply("ab"))).toBe("aCSb");
  });

  it("refuses operations on different documents", () => {
    const a = op((o) => o.retain(3));
    const b = op((o) => o.retain(4));
    expect(() => TextOperation.transform(a, b)).toThrow(expect.objectContaining({ code: "length_mismatch" }));
    expect(() => a.compose(b)).toThrow(expect.objectContaining({ code: "length_mismatch" }));
  });

  it("converges and composes for random concurrent edits", () => {
    const below = rng(0x9e3779b9);
    for (let round = 0; round < 2_000; round += 1) {
      const document = randomText(below, 12);
      const a = randomOperation(below, document);
      const b = randomOperation(below, document);
      const [aPrime, bPrime] = TextOperation.transform(a, b);
      expect(bPrime.apply(a.apply(document))).toBe(aPrime.apply(b.apply(document)));
      const afterA = a.apply(document);
      const c = randomOperation(below, afterA);
      expect(a.compose(c).apply(document)).toBe(c.apply(afterA));
    }
  });
});

describe("edits and operations", () => {
  it("turns ordered editor edits into an operation on the document", () => {
    const operation = operationFromEdits("hello world", [
      { from: 0, to: 1, insert: "J" },
      { from: 6, to: 11, insert: "there" },
    ]);
    expect(operation.toWire()).toEqual(["J", -1, 5, "there", -5]);
    expect(operation.apply("hello world")).toBe("Jello there");
  });

  it("refuses edits out of order, out of range, with CR or splitting a character", () => {
    expect(() => operationFromEdits("abc", [{ from: 2, to: 3, insert: "" }, { from: 0, to: 1, insert: "" }])).toThrow(
      RangeError,
    );
    expect(() => operationFromEdits("abc", [{ from: 2, to: 4, insert: "" }])).toThrow(RangeError);
    expect(() => operationFromEdits("abc", [{ from: 1, to: 1, insert: "\r\n" }])).toThrow(RangeError);
    expect(() => operationFromEdits("😀", [{ from: 1, to: 1, insert: "x" }])).toThrow(RangeError);
  });

  it("turns an operation into ordered edits in old-document offsets", () => {
    const operation = TextOperation.fromWire([1, "XY", -2, 2, -1, 1, "z"]);
    const edits = editsFromOperation(operation);
    expect(edits).toEqual([
      { from: 1, to: 3, insert: "XY" },
      { from: 5, to: 6, insert: "" },
      { from: 7, to: 7, insert: "z" },
    ]);
    const document = "abcdefg";
    let result = "";
    let position = 0;
    for (const edit of edits) {
      result += document.slice(position, edit.from) + edit.insert;
      position = edit.to;
    }
    expect(result + document.slice(position)).toBe(operation.apply(document));
  });

  it("finds the smallest replacement between two texts without splitting a character", () => {
    expect(replacementOperation("abc", "abXc").toWire()).toEqual([2, "X", 1]);
    expect(replacementOperation("same", "same").isNoop()).toBe(true);
    expect(replacementOperation("a😀b", "a😁b").toWire()).toEqual([1, "😁", -2, 1]);
    expect(replacementOperation("😀😀", "😀").apply("😀😀")).toBe("😀");
    const below = rng(777);
    for (let round = 0; round < 500; round += 1) {
      const before = randomText(below, 10);
      const after = randomText(below, 10);
      expect(replacementOperation(before, after).apply(before)).toBe(after);
    }
  });

  it("round-trips random edits with astral characters", () => {
    const below = rng(12345);
    for (let round = 0; round < 500; round += 1) {
      const document = randomText(below, 12);
      const operation = randomOperation(below, document);
      const again = operationFromEdits(document, editsFromOperation(operation));
      expect(again.apply(document)).toBe(operation.apply(document));
    }
  });
});

describe("diffOperation", () => {
  const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index}\n`).join("");

  it("changes only the lines that differ, keeping the ones between them", () => {
    const before = lines(10);
    const after = before.replace("line 0\n", "line 0 EDITED\n").replace("line 9\n", "line 9 EDITED\n");
    const operation = diffOperation(before, after);
    expect(operation.apply(before)).toBe(after);
    expect(editsFromOperation(operation)).toEqual([
      { from: 6, to: 6, insert: " EDITED" },
      { from: after.indexOf("line 9") - 7 + 6, to: after.indexOf("line 9") - 7 + 6, insert: " EDITED" },
    ]);
  });

  it("handles added, removed and moved lines, empty texts and texts without a final line break", () => {
    const cases: [string, string][] = [
      ["", "a\nb"],
      ["a\nb", ""],
      ["a\nb\nc", "a\nc"],
      ["a\nc", "a\nb\nc"],
      ["a\nb\nc\nd", "d\nb\nc\na"],
      ["no break", "no break at all"],
      ["x\r\ny", "x\r\nz"],
      ["😀\n😀", "😀\n😃"],
    ];
    for (const [before, after] of cases) {
      const operation = diffOperation(before, after);
      expect(operation.apply(before), JSON.stringify([before, after])).toBe(after);
      expect(operation.baseLength).toBe(before.length);
      expect(operation.targetLength).toBe(after.length);
    }
  });

  it("matches the text for random edits", () => {
    let seed = 42;
    const random = (limit: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % limit;
    };
    const words = ["alpha", "beta", "", "gamma", "delta", "\\section{x}", "% note"];
    const text = (count: number) =>
      Array.from({ length: count }, () => words[random(words.length)]).join("\n");
    for (let round = 0; round < 200; round += 1) {
      const before = text(random(30));
      const after = text(random(30));
      expect(diffOperation(before, after).apply(before)).toBe(after);
    }
  });

  it("falls back to one replacement when too many lines differ", () => {
    const before = Array.from({ length: 1_000 }, (_, index) => `a${index}`).join("\n");
    const after = Array.from({ length: 1_000 }, (_, index) => `b${index}`).join("\n");
    const operation = diffOperation(before, after);
    expect(operation.apply(before)).toBe(after);
    expect(operation.equals(replacementOperation(before, after))).toBe(true);
  });
});

describe("operations that cannot be built or combined", () => {
  it("refuses negative or fractional counts", () => {
    expect(() => new TextOperation().retain(-1)).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => new TextOperation().delete(1.5)).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => new TextOperation().retain(Number.NaN)).toThrow(OtError);
  });

  it("refuses to compose a change that would cut an inserted character in two", () => {
    const insertEmoji = op((o) => o.insert("😀"));
    const splitIt = op((o) => o.retain(1).insert("x").retain(1));
    expect(() => insertEmoji.compose(splitIt)).toThrow(expect.objectContaining({ code: "splits_character" }));
  });

  it("refuses operations whose steps do not match their declared lengths", () => {
    const short = op((o) => o.retain(2));
    short.targetLength = 3;
    expect(() => short.compose(op((o) => o.retain(3)))).toThrow(expect.objectContaining({ code: "incompatible" }));
    const narrow = op((o) => o.retain(2));
    narrow.baseLength = 3;
    expect(() => TextOperation.transform(narrow, op((o) => o.retain(3)))).toThrow(
      expect.objectContaining({ code: "incompatible" }),
    );
  });

  it("refuses edits at fractional offsets", () => {
    expect(() => operationFromEdits("abc", [{ from: 1.5, to: 2, insert: "" }])).toThrow(/whole numbers/);
    expect(() => operationFromEdits("abc", [{ from: 1, to: Number.POSITIVE_INFINITY, insert: "" }])).toThrow(
      /whole numbers/,
    );
  });

  it("keeps a replacement from ending inside a character that shares its second half", () => {
    const smile = String.fromCodePoint(0x1f600);
    const other = String.fromCodePoint(0x10600);
    expect(smile.charCodeAt(1)).toBe(other.charCodeAt(1));
    const operation = replacementOperation(`x${smile}`, `x${other}`);
    expect(operation.toWire()).toEqual([1, other, -2]);
    expect(operation.apply(`x${smile}`)).toBe(`x${other}`);
  });
});

