import { describe, expect, it } from "vitest";
import {
  buildInstitutionSearchUrl,
  countryFlag,
  parseInstitutionSearchResult,
  safeInstitutionUrl,
} from "@/components/tools/LabSearchPanel";

describe("Lab Search data handling", () => {
  it("builds a fixed-host OpenAlex institution query", () => {
    const url = new URL(
      buildInstitutionSearchUrl("Broad Institute", "US"),
    );

    expect(url.origin).toBe("https://api.openalex.org");
    expect(url.pathname).toBe("/institutions");
    expect(url.searchParams.get("search")).toBe("Broad Institute");
    expect(url.searchParams.get("filter")).toBe("country_code:US");
    expect(url.searchParams.get("per-page")).toBe("24");
  });

  it("normalizes institution results and their count", () => {
    expect(
      parseInstitutionSearchResult({
        meta: { count: 42 },
        results: [
          {
            id: "https://openalex.org/I123",
            display_name: "Research Institute",
            country_code: "US",
            type: "facility",
            works_count: 1200,
            cited_by_count: 3400,
            homepage_url: "https://example.edu",
            ror: "https://ror.org/123",
            geo: {
              city: "Berkeley",
              region: "California",
              country: "United States",
            },
          },
        ],
      }),
    ).toEqual({
      total: 42,
      results: [
        {
          id: "https://openalex.org/I123",
          displayName: "Research Institute",
          countryCode: "US",
          type: "facility",
          worksCount: 1200,
          citedByCount: 3400,
          homepageUrl: "https://example.edu/",
          rorUrl: "https://ror.org/123",
          city: "Berkeley",
          region: "California",
          country: "United States",
        },
      ],
    });
  });

  it("rejects unsafe external links", () => {
    expect(safeInstitutionUrl("javascript:alert(1)")).toBeNull();
    expect(safeInstitutionUrl("file:///tmp/private")).toBeNull();
    expect(safeInstitutionUrl("https://example.edu")).toBe(
      "https://example.edu/",
    );
  });

  it("formats two-letter country codes as flags", () => {
    expect(countryFlag("US")).toBe("🇺🇸");
    expect(countryFlag("gb")).toBe("🇬🇧");
    expect(countryFlag("USA")).toBe("");
  });
});
