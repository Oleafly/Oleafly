import { describe, it, expect } from "vitest";
import { parseRis } from "./ris";

const SAMPLE = `TY  - JOUR
AU  - Smith, Jane
AU  - Doe, John
TI  - A Great Paper
T2  - Journal of Things
PY  - 2021
VL  - 10
IS  - 2
SP  - 100
EP  - 110
DO  - 10.1000/xyz
ER  -

TY  - BOOK
AU  - Lee, Ann
TI  - A Great Book
PB  - Some Press
PY  - 2019
ER  -
`;

describe("parseRis", () => {
  it("parses multiple records, mapping RIS tags to bibtex fields", () => {
    const entries = parseRis(SAMPLE);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      type: "article",
      fields: {
        title: "A Great Paper",
        author: "Smith, Jane and Doe, John",
        year: "2021",
        journal: "Journal of Things",
        volume: "10",
        number: "2",
        pages: "100--110",
        doi: "10.1000/xyz",
      },
    });
    expect(entries[1]).toMatchObject({
      type: "book",
      fields: { title: "A Great Book", author: "Lee, Ann", publisher: "Some Press", year: "2019" },
    });
  });

  it("assigns collision-safe generated keys", () => {
    const entries = parseRis(SAMPLE);
    expect(entries[0].key).toBe("smith2021great");
    expect(entries[1].key).toBe("lee2019great");
  });

  it("maps unknown type codes to misc", () => {
    const entries = parseRis("TY  - GEN\nTI  - Something\nER  - \n");
    expect(entries[0].type).toBe("misc");
  });

  it("ignores malformed lines instead of throwing", () => {
    expect(() => parseRis("not ris content at all")).not.toThrow();
    expect(parseRis("not ris content at all")).toEqual([]);
  });
});
