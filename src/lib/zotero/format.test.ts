import { describe, expect, it } from "vitest";
import type { ZoteroHit } from "@oleafly/backend-port";
import { hitDetail, hitTitle } from "./format";

const HIT: ZoteroHit = {
  library: "user",
  itemKey: "WASSER16",
  citationKey: "wasserstein2016",
  keySource: "bbt",
  title: "The ASA Statement on <i>p</i> -Values: Context, Process, and Purpose",
  authors: ["Wasserstein", "Lazar"],
  authorCount: 2,
  year: "2016",
  itemType: "journalArticle",
  dateModified: "2024-01-01T00:00:00Z",
  score: 1,
};

describe("Zotero hit text", () => {
  it("shows titles as plain text", () => {
    expect(hitTitle(HIT)).toBe("The ASA Statement on p -Values: Context, Process, and Purpose");
    expect(hitTitle({ ...HIT, title: "Fish &amp; <b>chips</b>" })).toBe("Fish & chips");
  });

  it("keeps markup out of the one-line detail", () => {
    const detail = hitDetail({ ...HIT, title: "<i>E. coli</i> in CO<sub>2</sub>" }, null);
    expect(detail).toContain("E. coli in CO2");
    expect(detail).not.toMatch(/<\/?[a-z]+>/u);
  });
});
