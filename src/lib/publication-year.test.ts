import { describe, expect, it } from "vitest";
import {
  ANY_PUBLICATION_YEAR,
  publicationYearOptions,
  publicationYearRange,
} from "@/lib/publication-year";

describe("publication year filters", () => {
  it("builds a descending list through the minimum supported year", () => {
    const years = publicationYearOptions(2026);

    expect(years[0]).toBe("2026");
    expect(years.at(-1)).toBe("1800");
    expect(years).toHaveLength(227);
  });

  it("uses Any year as the fallback for missing and invalid values", () => {
    expect(publicationYearRange("", "2200", 2026)).toMatchObject({
      from: null,
      to: null,
      normalizedFrom: ANY_PUBLICATION_YEAR,
      normalizedTo: ANY_PUBLICATION_YEAR,
      error: null,
    });
  });

  it("rejects a reversed range", () => {
    expect(publicationYearRange("2025", "2020", 2026)).toMatchObject({
      from: 2025,
      to: 2020,
      error: "The start year cannot be later than the end year.",
    });
  });
});
