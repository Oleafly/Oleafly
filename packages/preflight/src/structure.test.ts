import { describe, it, expect } from "vitest";
import { verifyStructure } from "./structure";
import type { PdfUaFacts, StructNode, StructDoc } from "./structure";

const node = (role: string, children: StructNode[] = [], extra: Partial<StructNode> = {}): StructNode => ({
  role,
  children,
  ...extra,
});
const doc = (root: StructNode | null, tagged = root !== null): StructDoc => ({ root, tagged });
const ua = (over: Partial<PdfUaFacts> = {}): PdfUaFacts => ({
  displayDocTitle: true,
  suspects: false,
  xmpTitle: "A tagged paper",
  infoTitle: "A tagged paper",
  uaPart: null,
  uaRev: null,
  taggedTextRuns: 100,
  untaggedTextRuns: 0,
  links: [],
  ...over,
});
const ids = (findings: ReturnType<typeof verifyStructure>) => findings.map((finding) => finding.id);

describe("verifyStructure: untagged output", () => {
  it("returns one honest verdict when the PDF has no structure tree", () => {
    const f = verifyStructure(doc(null, false));
    expect(f).toHaveLength(1);
    expect(f[0].id).toBe("pdf-untagged-output");
    expect(f[0].severity).toBe("info");
  });

  it("does not emit a wall of structural failures when untagged", () => {
    const f = verifyStructure(doc(null, false));
    expect(f.every((x) => x.id === "pdf-untagged-output")).toBe(true);
  });
});

describe("verifyStructure: figures", () => {
  it("flags a Figure with no alt text", () => {
    const root = node("Document", [node("Figure")]);
    expect(verifyStructure(doc(root)).some((f) => f.id === "output-figure-alt")).toBe(true);
  });
  it("accepts a Figure with alt text", () => {
    const root = node("Document", [node("Figure", [], { alt: "A chart of results" })]);
    expect(verifyStructure(doc(root)).some((f) => f.id === "output-figure-alt")).toBe(false);
  });
  it("flags a Formula with no alt text as a math-specific warning, not a figure error", () => {
    const root = node("Document", [node("Formula"), node("P")]);
    const findings = verifyStructure(doc(root));
    expect(ids(findings)).toEqual(["output-formula-alt"]);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].detail).toContain("MathML");
  });
  it("accepts a Formula that carries alt text", () => {
    const root = node("Document", [node("Formula", [], { alt: "E equals m c squared" }), node("P")]);
    expect(verifyStructure(doc(root))).toHaveLength(0);
  });
});

describe("verifyStructure: tables", () => {
  it("flags a Table with no header cell", () => {
    const root = node("Document", [node("Table", [node("TR", [node("TD"), node("TD")])])]);
    expect(verifyStructure(doc(root)).some((f) => f.id === "output-table-headers")).toBe(true);
  });
  it("accepts a Table with a header row", () => {
    const root = node("Document", [node("Table", [node("TR", [node("TH"), node("TH")])])]);
    expect(verifyStructure(doc(root)).some((f) => f.id === "output-table-headers")).toBe(false);
  });
});

describe("verifyStructure: headings", () => {
  it("flags a heading level skip in the tag tree", () => {
    const root = node("Document", [node("H1"), node("H3")]);
    expect(verifyStructure(doc(root)).some((f) => f.id === "output-heading-skip")).toBe(true);
  });
  it("accepts well-nested headings", () => {
    const root = node("Document", [node("H1"), node("H2"), node("H3")]);
    expect(verifyStructure(doc(root)).some((f) => f.id === "output-heading-skip")).toBe(false);
  });
});

describe("verifyStructure: clean tagged doc", () => {
  it("returns no findings for a well-tagged document", () => {
    const root = node("Document", [
      node("H1"),
      node("P"),
      node("Figure", [], { alt: "A headshot" }),
      node("Table", [node("TR", [node("TH")]), node("TR", [node("TD")])]),
    ]);
    expect(verifyStructure(doc(root))).toHaveLength(0);
  });
});


describe("verifyStructure: PDF/UA catalog facts", () => {
  const body = node("Document", [node("H1"), node("P"), node("P")]);

  it("reports a missing DisplayDocTitle", () => {
    const findings = verifyStructure({ root: body, tagged: true, ua: ua({ displayDocTitle: false }) });
    expect(ids(findings)).toEqual(["pdf-display-doc-title"]);
    expect(findings[0].machineCheckable).toBe(true);
    expect(findings[0].method).toBe("pdf-object-model");
  });

  it("reports Suspects set to true", () => {
    expect(ids(verifyStructure({ root: body, tagged: true, ua: ua({ suspects: true }) }))).toEqual(["pdf-suspects"]);
  });

  it("reports a title that only exists in the Info dictionary", () => {
    expect(ids(verifyStructure({ root: body, tagged: true, ua: ua({ xmpTitle: null }) }))).toEqual(["pdf-xmp-title"]);
  });

  it("stays quiet when neither title is present, because the catalog check owns that case", () => {
    expect(
      ids(verifyStructure({ root: body, tagged: true, ua: ua({ xmpTitle: null, infoTitle: null }) })),
    ).toEqual([]);
  });

  it("reports link annotations with no description", () => {
    const findings = verifyStructure({
      root: body,
      tagged: true,
      ua: ua({ links: [{ hasContents: true }, { hasContents: false }, { hasContents: false }] }),
    });
    expect(ids(findings)).toEqual(["pdf-link-alt"]);
    expect(findings[0].title).toContain("2 link annotations");
  });

  it("reports real content that sits outside the tag tree", () => {
    const findings = verifyStructure({
      root: body,
      tagged: true,
      ua: ua({ taggedTextRuns: 80, untaggedTextRuns: 20 }),
    });
    expect(ids(findings)).toEqual(["pdf-untagged-content"]);
    expect(findings[0].title).toContain("20%");
  });

  it("tolerates a few untagged runs", () => {
    expect(
      ids(verifyStructure({ root: body, tagged: true, ua: ua({ taggedTextRuns: 99, untaggedTextRuns: 1 }) })),
    ).toEqual([]);
  });

  it("flags a one-node tag tree as an unfinished compile pass", () => {
    const findings = verifyStructure({
      root: node("Document", [node("P")]),
      tagged: true,
      ua: ua(),
    });
    expect(ids(findings)).toEqual(["pdf-structure-single-pass"]);
    expect(findings[0].severity).toBe("info");
  });

  it("flags a short one-node output even when it holds almost no text", () => {
    const findings = verifyStructure({
      root: node("Document", [node("P")]),
      tagged: true,
      ua: ua({ taggedTextRuns: 2, untaggedTextRuns: 0 }),
    });
    expect(ids(findings)).toEqual(["pdf-structure-single-pass"]);
  });

  it("flags an empty tag tree as an unfinished compile pass as well", () => {
    const findings = verifyStructure({ root: null, tagged: true, ua: ua() });
    expect(ids(findings)).toEqual(["pdf-structure-missing", "pdf-structure-single-pass"]);
  });

  it("says nothing about a first pass once the tree has real structure", () => {
    const findings = verifyStructure({
      root: node("Document", [node("H1"), node("P")]),
      tagged: true,
      ua: ua({ taggedTextRuns: 2, untaggedTextRuns: 0 }),
    });
    expect(ids(findings)).toEqual([]);
  });
});

describe("verifyStructure: PDF/UA claims", () => {
  it("calls out a PDF/UA claim the file does not meet", () => {
    const findings = verifyStructure({
      root: node("Document", [node("H1"), node("P"), node("P")]),
      tagged: true,
      ua: ua({ uaPart: 1, displayDocTitle: false, xmpTitle: null, infoTitle: "Only info" }),
    });
    const claim = findings.find((finding) => finding.id === "pdf-ua-claim-mismatch");
    expect(claim?.severity).toBe("error");
    expect(claim?.title).toBe("This PDF claims PDF/UA-1 but does not meet it");
    expect(claim?.detail).toContain("DisplayDocTitle is not set to true");
    expect(claim?.detail).toContain("no document title in the XMP metadata");
  });

  it("accepts a claim the file actually backs up", () => {
    expect(
      ids(
        verifyStructure({
          root: node("Document", [node("H1"), node("P"), node("P")]),
          tagged: true,
          ua: ua({ uaPart: 2 }),
        }),
      ),
    ).toEqual([]);
  });

  it("does not fail the claim on a viewer preference it could not read", () => {
    const findings = verifyStructure({
      root: node("Document", [node("H1"), node("P"), node("P")]),
      tagged: true,
      ua: ua({ uaPart: 1, displayDocTitle: null }),
    });
    expect(ids(findings)).toEqual([]);
  });

  it("still names the gaps it did observe when another one is unknown", () => {
    const findings = verifyStructure({
      root: node("Document", [node("H1"), node("P"), node("P")]),
      tagged: true,
      ua: ua({ uaPart: 1, displayDocTitle: null, xmpTitle: null, infoTitle: "Only info" }),
    });
    const claim = findings.find((finding) => finding.id === "pdf-ua-claim-mismatch");
    expect(claim?.detail).toContain("no document title in the XMP metadata");
    expect(claim?.detail).not.toContain("DisplayDocTitle");
  });

  it("adds the claim mismatch to an untagged file without a wall of other failures", () => {
    const findings = verifyStructure({ root: null, tagged: false, ua: ua({ uaPart: 1, displayDocTitle: false }) });
    expect(ids(findings)).toEqual(["pdf-untagged-output", "pdf-ua-claim-mismatch"]);
    expect(findings[1].detail).toContain("the file is not tagged");
  });
});
