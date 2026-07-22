import { describe, expect, it } from "vitest";
import { buildLatexTable, parseBib, resizeTable, validateBib } from "./latex-tools";

describe("parseBib", () => {
  it("parses a well formed entry", () => {
    const { entries, parseErrors } = parseBib(`@article{einstein1905,
      author = {Einstein, Albert},
      title = {On the Electrodynamics of Moving Bodies},
      journal = {Annalen der Physik},
      year = {1905}
    }`);
    expect(parseErrors).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "article",
      key: "einstein1905",
      fields: { author: "Einstein, Albert", year: "1905" },
    });
  });

  it("parses quoted and bare field values", () => {
    const { entries } = parseBib(`@misc{x, title = "Quoted title", year = 2020}`);
    expect(entries[0].fields.title).toBe("Quoted title");
    expect(entries[0].fields.year).toBe("2020");
  });

  it("flags an entry missing a citation key", () => {
    const { parseErrors } = parseBib(`@article{, title = {No key}}`);
    expect(parseErrors.some((e) => e.includes("missing a citation key"))).toBe(true);
  });
});

describe("validateBib", () => {
  it("flags a missing required field", () => {
    const { entries } = parseBib(`@article{a, title = {T}, year = {2020}}`);
    const findings = validateBib(entries);
    expect(findings[0].level).toBe("error");
    expect(findings[0].messages.join(" ")).toMatch(/author/);
  });

  it("flags duplicate citation keys", () => {
    const { entries } = parseBib(
      `@article{a, author={X}, title={T}, journal={J}, year={2020}} @misc{a, title={Y}}`,
    );
    const findings = validateBib(entries);
    expect(findings.every((f) => f.messages.includes("Duplicate citation key"))).toBe(true);
  });

  it("accepts a fully valid entry", () => {
    const { entries } = parseBib(
      `@article{ok, author={X}, title={T}, journal={J}, year={2020}}`,
    );
    expect(validateBib(entries)[0].level).toBe("ok");
  });
});

describe("buildLatexTable", () => {
  it("builds a booktabs table with a header row", () => {
    const code = buildLatexTable(
      [
        ["Method", "Score"],
        ["Ours", "0.9"],
      ],
      ["l", "c"],
      { booktabs: true, headerRow: true, caption: "Results" },
    );
    expect(code).toContain("\\toprule");
    expect(code).toContain("\\caption{Results}");
    expect(code).toContain("Method & Score");
  });

  it("escapes LaTeX special characters", () => {
    const code = buildLatexTable([["50%", "A&B"]], ["l", "l"], {
      booktabs: false,
      headerRow: false,
      caption: "",
    });
    expect(code).toContain("50\\%");
    expect(code).toContain("A\\&B");
  });
});

describe("resizeTable", () => {
  it("pads and truncates to the target dimensions", () => {
    const resized = resizeTable([["a", "b"]], 2, 3);
    expect(resized).toEqual([
      ["a", "b", ""],
      ["", "", ""],
    ]);
  });
});
