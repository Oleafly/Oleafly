import { describe, it, expect } from "vitest";
import { decodeXmlEntities, escapeLatex, cleanField, toBibName } from "./text";

describe("decodeXmlEntities", () => {
  it("decodes entities, handling &amp; last so it doesn't double-decode", () => {
    expect(decodeXmlEntities("A &amp;lt; B")).toBe("A &lt; B");
    expect(decodeXmlEntities("A &lt;B&gt; &quot;C&quot; &#39;D&#39;")).toBe(`A <B> "C" 'D'`);
  });
});

describe("escapeLatex", () => {
  it("escapes bibtex/latex-special characters", () => {
    expect(escapeLatex("50% of A & B, #1_2 {x} ~y ^z \\n")).toBe(
      "50\\% of A \\& B, \\#1\\_2 \\{x\\} \\textasciitilde{}y \\textasciicircum{}z \\textbackslash{}n",
    );
  });
});

describe("cleanField", () => {
  it("decodes entities then escapes latex-special characters", () => {
    expect(cleanField("A &amp; B")).toBe("A \\& B");
  });
});

describe("toBibName", () => {
  it("converts 'First Last' to 'Last, First'", () => {
    expect(toBibName("Jane Smith")).toBe("Smith, Jane");
  });
  it("leaves an already-comma'd name unchanged", () => {
    expect(toBibName("Smith, Jane")).toBe("Smith, Jane");
  });
  it("leaves a single-word name unchanged", () => {
    expect(toBibName("Cher")).toBe("Cher");
  });
});
