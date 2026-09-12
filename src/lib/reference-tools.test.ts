import { Cite } from "@citation-js/core";
import { describe, expect, it, vi } from "vitest";
import {
  CITATION_STYLES,
  EMPTY_REFERENCE,
  EXAMPLE_REFERENCE,
  bibtexToForm,
  detectCitationTarget,
  formToBibtex,
  formatAllStyles,
  formatCitations,
  inspectBibtex,
  MAX_BIBTEX_CHARACTERS,
  webpageBibtex,
} from "./reference-tools";

const ARTICLE = `@article{lovelace1843notes,
  author = {Lovelace, Ada},
  title = {Notes on the Analytical Engine},
  journal = {Scientific Memoirs},
  year = {1843}
}`;

describe("reference tools", () => {
  it("formats BibTeX in every bundled style entirely in-process", () => {
    for (const style of CITATION_STYLES) {
      const result = formatCitations(ARTICLE, style.id);
      expect(result.entries).toBe(1);
      expect(result.bibliography).toMatch(/Lovelace/i);
      expect(result.bibliography).toMatch(/Analytical Engine/i);
      expect(result.inText).not.toBe("");
    }
  }, 20_000);

  it("formats and sorts a complete bibliography in every supported style", () => {
    const second = ARTICLE.replaceAll("Lovelace", "Turing").replaceAll("1843", "1936");
    const output = formatAllStyles(`${second}\n\n${ARTICLE}`);
    expect(output).toHaveLength(8);
    expect(output.every((style) => style.entries === 2)).toBe(true);
  });

  it("returns empty output early and protects cached formatter results from callers", () => {
    expect(formatCitations("", "apa")).toEqual({ bibliography: "", inText: "", entries: 0 });
    const first = formatCitations(ARTICLE, "apa");
    first.bibliography = "changed by caller";
    expect(formatCitations(ARTICLE, "apa").bibliography).not.toBe("changed by caller");
  });

  it("rejects unknown styles and unreadable formatter output", () => {
    expect(() => formatCitations(`${ARTICLE}\n`, "unknown" as never)).toThrow("Unknown citation style");
    const format = vi.spyOn(Cite.prototype, "format").mockReturnValueOnce(undefined as never);
    expect(() => formatCitations(`${ARTICLE}\n% unique`, "apa")).toThrow("unreadable result");
    format.mockRestore();
  });

  it("bounds the number of entries before formatting", () => {
    const many = Array.from(
      { length: 2_001 },
      (_, index) => `@misc{entry${index}, title={Reference ${index}}}`,
    ).join("\n");
    expect(() => formatCitations(many, "apa")).toThrow("more than 2,000 entries");
  }, 20_000);

  it("creates a stable BibTeX entry from structured fields", () => {
    const bibtex = formToBibtex(EXAMPLE_REFERENCE);
    expect(bibtex).toContain("@article{vaswani2017attention");
    expect(bibtex).toContain("author = {Ashish Vaswani and Noam Shazeer");
    expect(bibtex).toContain("journal = {Advances in Neural Information Processing Systems}");
    expect(bibtex).not.toContain("doi = {} ");
  });

  it("round-trips the supported structured fields", () => {
    expect(bibtexToForm(formToBibtex({ ...EXAMPLE_REFERENCE, type: "inproceedings" }))).toMatchObject({
      type: "inproceedings",
      title: EXAMPLE_REFERENCE.title,
      container: EXAMPLE_REFERENCE.container,
      year: "2017",
    });
    expect(bibtexToForm("not BibTeX")).toBeNull();
    expect(bibtexToForm("@software{x, title={Tool}}")).toMatchObject({
      type: "misc",
      authors: "",
      container: "",
      publisher: "",
    });
    expect(formToBibtex({ ...EMPTY_REFERENCE, title: "Collaboration", authors: "Ada and Charles" }))
      .toContain("author = {Ada and Charles}");
  });

  it("reports incomplete and malformed BibTeX before formatting", () => {
    expect(inspectBibtex("plain text").errors).toContain("No complete BibTeX entries were found.");
    expect(() => formatCitations("[]", "apa")).toThrow("No complete BibTeX entries");
    const missing = inspectBibtex("@article{x, title={Only a title}}");
    expect(missing.entries).toBe(1);
    expect(missing.findings[0]?.level).toBe("error");
    expect(inspectBibtex("")).toEqual({ entries: 0, errors: [], findings: [] });
  });

  it("bounds oversized bibliographies before invoking the formatter", () => {
    const oversized = `@misc{x, title={${"x".repeat(MAX_BIBTEX_CHARACTERS)}}}`;
    expect(inspectBibtex(oversized).errors[0]).toContain("1 MB workspace limit");
    expect(() => formatCitations(oversized, "apa")).toThrow("1 MB workspace limit");
  });

  it("recognizes scholarly identifiers inside their common URLs", () => {
    expect(detectCitationTarget("https://doi.org/10.1000/example")).toEqual({
      kind: "doi",
      value: "10.1000/example",
    });
    expect(detectCitationTarget("https://arxiv.org/abs/1706.03762")).toEqual({
      kind: "arxiv",
      value: "1706.03762",
    });
    expect(detectCitationTarget("https://pubmed.ncbi.nlm.nih.gov/12345678/")).toEqual({
      kind: "pmid",
      value: "12345678",
    });
    expect(detectCitationTarget("https://example.org/paper")).toMatchObject({ kind: "url" });
    expect(detectCitationTarget("a paper title")).toEqual({ kind: "title", value: "a paper title" });
    expect(detectCitationTarget("ftp://example.org/paper")).toMatchObject({ kind: "title" });
  });

  it("creates a safe editable webpage entry without pretending to fetch metadata", () => {
    const bibtex = webpageBibtex("https://example.org/research?q=one", "Research notes");
    expect(bibtex).toContain("@misc{research");
    expect(bibtex).toContain("url = {https://example.org/research?q=one}");
    expect(webpageBibtex("https://www.example.org/paper", " {} ")).toContain("Untitled webpage");
    expect(() => webpageBibtex("file:///etc/passwd")).toThrow("http or https");
  });

  it("keeps an empty manual form usable", () => {
    expect(formToBibtex(EMPTY_REFERENCE)).toContain("@article{ref,");
  });
});
