import { describe, expect, it } from "vitest";
import {
  offsetToPosition,
  positionToOffset,
  TextPositionIndex,
  type PositionEncoding,
} from "./position";

describe("LSP position conversion", () => {
  const multilingual = "A😀é中\nz";

  it.each([
    ["utf-8", 5],
    ["utf-16", 3],
    ["utf-32", 2],
  ] satisfies Array<[PositionEncoding, number]>)(
    "counts astral characters using %s units",
    (encoding, character) => {
      expect(offsetToPosition(multilingual, 3, encoding)).toEqual({
        line: 0,
        character,
      });
      expect(
        positionToOffset(
          multilingual,
          { line: 0, character },
          encoding,
        ),
      ).toBe(3);
    },
  );

  it("counts UTF-8 bytes for accented and CJK code points", () => {
    const index = new TextPositionIndex(multilingual);
    expect(index.offsetToPosition(4, "utf-8")).toEqual({
      line: 0,
      character: 7,
    });
    expect(index.offsetToPosition(5, "utf-8")).toEqual({
      line: 0,
      character: 10,
    });
  });

  it("never returns an offset inside a surrogate or UTF-8 sequence", () => {
    const index = new TextPositionIndex(multilingual);
    expect(
      index.positionToOffset(
        { line: 0, character: 2 },
        "utf-16",
      ),
    ).toBe(1);
    expect(
      index.positionToOffset(
        { line: 0, character: 3 },
        "utf-8",
      ),
    ).toBe(1);
    expect(index.offsetToPosition(2, "utf-16")).toEqual({
      line: 0,
      character: 1,
    });
  });

  it("handles LF, CRLF, terminal newlines, and newline offsets", () => {
    const text = "ab\r\n😀\n";
    const index = new TextPositionIndex(text);
    expect(index.lineCount).toBe(3);
    expect(index.offsetToPosition(2)).toEqual({
      line: 0,
      character: 2,
    });
    expect(index.offsetToPosition(3)).toEqual({
      line: 0,
      character: 2,
    });
    expect(index.offsetToPosition(4)).toEqual({
      line: 1,
      character: 0,
    });
    expect(
      index.positionToOffset({ line: 1, character: 2 }, "utf-16"),
    ).toBe(6);
    expect(
      index.positionToOffset({ line: 99, character: 99 }, "utf-16"),
    ).toBe(text.length);
  });

  it("clamps negative, non-finite, and overlong positions safely", () => {
    const index = new TextPositionIndex("abc");
    expect(index.positionToOffset({ line: -1, character: -1 })).toBe(
      0,
    );
    expect(
      index.positionToOffset({
        line: Number.POSITIVE_INFINITY,
        character: Number.NaN,
      }),
    ).toBe(0);
    expect(index.positionToOffset({ line: 0, character: 999 })).toBe(
      3,
    );
    expect(index.offsetToPosition(999)).toEqual({
      line: 0,
      character: 3,
    });
  });
});
