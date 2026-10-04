import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiteratureRecord } from "@/lib/literature-search";

function record(overrides: Partial<LiteratureRecord> = {}): LiteratureRecord {
  return {
    id: "r1",
    sourceIds: {},
    sources: [],
    title: "Attention Is All You Need",
    authors: ["Ashish Vaswani"],
    year: 2017,
    publicationDate: null,
    venue: "NeurIPS",
    type: "article",
    doi: "10.5555/Attention",
    url: null,
    pdfUrl: null,
    abstract: null,
    citationCount: null,
    openAccess: null,
    ...overrides,
  };
}

async function loadStore() {
  vi.resetModules();
  return (await import("./literature")).useLiteratureLibraryStore;
}

beforeEach(() => {
  localStorage.clear();
});

describe("saved literature", () => {
  it("saves a record once with its BibTeX, newest first, and remembers it", async () => {
    const store = await loadStore();

    store.getState().save(record());
    store.getState().save(record({ doi: null, title: "BERT" }));
    store.getState().save(record({ title: "Attention Is All You Need (v2)" }));

    const saved = store.getState().saved;
    expect(saved.map((entry) => entry.record.title)).toEqual(["Attention Is All You Need (v2)", "BERT"]);
    expect(saved[0].id).toBe("doi:10.5555/attention");
    expect(saved[0].bibtex).toContain("@");
    expect(store.getState().has(record())).toBe(true);
    expect(store.getState().has(record({ doi: null, title: "Unknown" }))).toBe(false);

    const reloaded = await loadStore();
    expect(reloaded.getState().saved.map((entry) => entry.id)).toEqual(saved.map((entry) => entry.id));
  });

  it("removes a saved record", async () => {
    const store = await loadStore();
    store.getState().save(record());

    store.getState().remove("doi:10.5555/attention");

    expect(store.getState().saved).toEqual([]);
    expect((await loadStore()).getState().saved).toEqual([]);
  });

  it("drops malformed saved entries", async () => {
    localStorage.setItem(
      "oleafly.literature-library.v1",
      JSON.stringify([
        { id: "ok", bibtex: "@misc{ok}", savedAt: 1, record: record() },
        { id: "no-record", bibtex: "@misc{x}", savedAt: 1 },
        { id: 3, bibtex: "@misc{x}", savedAt: 1, record: record() },
        null,
      ]),
    );

    expect((await loadStore()).getState().saved.map((entry) => entry.id)).toEqual(["ok"]);

    localStorage.setItem("oleafly.literature-library.v1", JSON.stringify({ not: "a list" }));
    expect((await loadStore()).getState().saved).toEqual([]);
  });
});
