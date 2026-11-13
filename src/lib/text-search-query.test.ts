import { describe, expect, it } from "vitest";
import { fileSearchSchema, invalidPattern, textSearchQuery, textSearchTruncated } from "./text-search-query";

describe("textSearchQuery", () => {
  it("turns words, phrases, filters and NOT into one branch", () => {
    expect(textSearchQuery('mask "loss curve" path:ch1 ext:.tex -draft', "exact", false)).toEqual({
      mode: "exact",
      branches: [
        {
          all: [
            { kind: "text", value: "mask" },
            { kind: "text", value: "loss curve" },
            { kind: "path", value: "ch1" },
            { kind: "ext", value: ".tex" },
          ],
          none: [{ kind: "text", value: "draft" }],
        },
      ],
    });
  });

  it("splits OR into branches and spreads a negated group over its terms", () => {
    expect(textSearchQuery("(alpha OR beta) NOT (gamma delta)", "ranked", true, 40)).toEqual({
      mode: "ranked",
      limit: 40,
      branches: [
        { all: [{ kind: "text", value: "alpha" }], none: [{ kind: "text", value: "gamma" }] },
        { all: [{ kind: "text", value: "alpha" }], none: [{ kind: "text", value: "delta" }] },
        { all: [{ kind: "text", value: "beta" }], none: [{ kind: "text", value: "gamma" }] },
        { all: [{ kind: "text", value: "beta" }], none: [{ kind: "text", value: "delta" }] },
      ],
    });
  });

  it("knows project: only when searching every project, and reads comma lists as OR", () => {
    expect(textSearchQuery("project:thesis", "fuzzy", true)?.branches).toEqual([{ all: [{ kind: "project", value: "thesis" }], none: [] }]);
    expect(textSearchQuery("project:thesis", "fuzzy", false)?.branches).toEqual([{ all: [{ kind: "text", value: "project:thesis" }], none: [] }]);
    expect(textSearchQuery("ext:tex,bib", "exact", false)?.branches).toEqual([
      { all: [{ kind: "ext", value: "tex" }], none: [] },
      { all: [{ kind: "ext", value: "bib" }], none: [] },
    ]);
    expect(textSearchQuery("-ext:log,aux", "exact", false)?.branches).toEqual([
      {
        all: [],
        none: [
          { kind: "ext", value: "log" },
          { kind: "ext", value: "aux" },
        ],
      },
    ]);
    expect(fileSearchSchema(true)).toBe(fileSearchSchema(true));
  });

  it("gives nothing to search for empty queries", () => {
    expect(textSearchQuery("", "ranked", false)).toBeNull();
    expect(textSearchQuery("()", "ranked", false)).toBeNull();
    expect(textSearchQuery("path:", "ranked", false)).toBeNull();
  });

  it("keeps the 32 combinations the file search runs and says when a query had more", () => {
    const wide = "(a OR b OR c OR d OR e OR f) (g OR h OR i OR j OR k OR l)";
    expect(textSearchQuery(wide, "ranked", false)?.branches).toHaveLength(32);
    expect(textSearchTruncated(wide, false)).toBe(true);
    expect(textSearchQuery("(a OR b OR c) (d OR e OR f)", "ranked", false)?.branches).toHaveLength(9);
    expect(textSearchTruncated("(a OR b OR c) (d OR e OR f)", false)).toBe(false);
    expect(textSearchTruncated("(a OR b) (c OR d)", false)).toBe(false);
    expect(textSearchTruncated("", false)).toBe(false);
  });

  it("recognises the message for a pattern that isn't valid", () => {
    expect(invalidPattern("Not a valid pattern: unclosed group")).toBe("unclosed group");
    expect(invalidPattern("index down")).toBeNull();
    expect(invalidPattern(null)).toBeNull();
  });
});
