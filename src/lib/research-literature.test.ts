import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

import { verifyCitation, type CitationCheck } from "./research-literature";

const VERIFIED: CitationCheck = {
  verified: true,
  source: "doi",
  doi: "10.1000/xyz",
  matchedTitle: "Attention Is All You Need",
  score: 0.98,
  bibtex: "@article{vaswani2017, title={Attention Is All You Need}}",
  reason: null,
};

beforeEach(() => {
  native.invoke.mockReset();
});

describe("citation checks", () => {
  it("checks a DOI against the title it should carry", async () => {
    native.invoke.mockResolvedValueOnce(VERIFIED);

    await expect(verifyCitation({ doi: "10.1000/xyz", title: "Attention Is All You Need" })).resolves.toBe(VERIFIED);
    expect(native.invoke).toHaveBeenCalledWith("verify_citation", {
      doi: "10.1000/xyz",
      title: "Attention Is All You Need",
    });
  });

  it("sends a missing DOI or title as null", async () => {
    native.invoke.mockResolvedValue({ ...VERIFIED, source: "crossref-search" });

    await verifyCitation({ title: "Attention Is All You Need" });
    await verifyCitation({ doi: "10.1000/xyz" });
    await verifyCitation({});

    expect(native.invoke.mock.calls).toEqual([
      ["verify_citation", { doi: null, title: "Attention Is All You Need" }],
      ["verify_citation", { doi: "10.1000/xyz", title: null }],
      ["verify_citation", { doi: null, title: null }],
    ]);
  });

  it("passes a failed lookup on to the caller", async () => {
    native.invoke.mockRejectedValueOnce(new Error("No matching Crossref record found."));

    await expect(verifyCitation({ title: "A paper nobody wrote" })).rejects.toThrow(
      "No matching Crossref record found.",
    );
  });
});
