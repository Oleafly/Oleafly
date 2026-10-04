import { describe, expect, it } from "vitest";
import { pickPagesToVerify } from "./pick-pages";

describe("pickPagesToVerify", () => {
  it("returns nothing for an empty PDF and the only page for a one-page PDF", () => {
    expect(pickPagesToVerify(0)).toEqual([]);
    expect(pickPagesToVerify(1, { cursorPage: 1 })).toEqual([1]);
  });

  it("takes every page of a short PDF", () => {
    expect(pickPagesToVerify(3)).toEqual([1, 2, 3]);
  });

  it("spreads four pages across a long PDF by default", () => {
    expect(pickPagesToVerify(100)).toEqual([1, 21, 41, 100]);
  });

  it("includes the cursor page and ignores one out of range", () => {
    expect(pickPagesToVerify(100, { cursorPage: 77, maxPages: 3 })).toEqual([1, 77, 100]);
    expect(pickPagesToVerify(10, { cursorPage: 11, maxPages: 2 })).toEqual([1, 10]);
  });

  it("caps the budget at eight pages", () => {
    expect(pickPagesToVerify(50, { maxPages: 20 })).toHaveLength(8);
  });

  it("keeps the first and last page when the cursor would push past the budget", () => {
    expect(pickPagesToVerify(10, { cursorPage: 5, maxPages: 2 })).toEqual([1, 10]);
  });

  it("keeps only the first page when the budget is one", () => {
    expect(pickPagesToVerify(10, { maxPages: 1 })).toEqual([1]);
    expect(pickPagesToVerify(10, { maxPages: 0 })).toEqual([1]);
  });

  it("fills consecutive pages when the budget nearly covers the PDF", () => {
    expect(pickPagesToVerify(6, { maxPages: 5 })).toEqual([1, 2, 3, 4, 6]);
  });
});
