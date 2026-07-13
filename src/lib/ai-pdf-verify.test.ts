import { describe, expect, it } from "vitest";
import { pickPagesToVerify } from "./ai-pdf-verify";

describe("pickPagesToVerify", () => {
  it("returns empty for zero pages", () => {
    expect(pickPagesToVerify(0)).toEqual([]);
  });

  it("returns [1] for a single page", () => {
    expect(pickPagesToVerify(1)).toEqual([1]);
  });

  it("always includes first and last on multi-page docs", () => {
    const pages = pickPagesToVerify(20, { maxPages: 4 });
    expect(pages[0]).toBe(1);
    expect(pages[pages.length - 1]).toBe(20);
    expect(pages.length).toBeLessThanOrEqual(4);
  });

  it("includes the cursor page when provided", () => {
    const pages = pickPagesToVerify(30, { cursorPage: 15, maxPages: 4 });
    expect(pages).toContain(15);
    expect(pages).toContain(1);
    expect(pages).toContain(30);
  });

  it("dedupes and sorts", () => {
    const pages = pickPagesToVerify(5, { cursorPage: 1, maxPages: 8 });
    expect(pages).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps first and last even when the budget is smaller than the seeds", () => {
    // maxPages 2 with a cursor seeds {1, 10, 5}; the cap must not drop the last
    // page. Endpoints win over the cursor.
    const pages = pickPagesToVerify(10, { cursorPage: 5, maxPages: 2 });
    expect(pages).toEqual([1, 10]);
  });
});
