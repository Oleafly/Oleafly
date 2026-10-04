import { describe, it, expect, vi, beforeEach } from "vitest";
import { createResearchTools, type ResearchToolsHost } from "./research-tools";

describe("OpenAlex + citation verification tools", () => {
  const searchOpenAlex = vi.fn();
  const crossrefSearch = vi.fn();
  const fetchDoiBibtex = vi.fn();
  let host: ResearchToolsHost;

  beforeEach(() => {
    searchOpenAlex.mockReset();
    crossrefSearch.mockReset();
    fetchDoiBibtex.mockReset();
    host = {
      searchOpenAlex,
      crossrefSearch,
      fetchDoiBibtex,
      retrieveProjectChunks: vi.fn(),
    };
  });

  it("literature_search asks the host's OpenAlex search with a clamped limit", async () => {
    searchOpenAlex.mockResolvedValue({ results: [{ id: "W123", display_name: "A Work" }] });
    const tools = createResearchTools(host);
    const res = await tools.literature_search.execute({ query: "graph neural networks", limit: 99 });
    expect(searchOpenAlex).toHaveBeenCalledWith("graph neural networks", 25);
    expect(res).toMatchObject({ results: [{ id: "W123" }] });
  });

  it("literature_search defaults to ten results", async () => {
    searchOpenAlex.mockResolvedValue({ results: [] });
    const tools = createResearchTools(host);
    await tools.literature_search.execute({ query: "graph neural networks" });
    expect(searchOpenAlex).toHaveBeenCalledWith("graph neural networks", 10);
  });

  it("offers no alphaXiv tools of its own", () => {
    const tools = createResearchTools(host);
    expect(Object.keys(tools).sort()).toEqual([
      "literature_search",
      "project_library_search",
      "verify_citation",
    ]);
  });

  it("does not start an internet request before approval", async () => {
    searchOpenAlex.mockResolvedValue({ results: [] });
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createResearchTools(host, { confirm });

    const res = await tools.literature_search.execute({ query: "graph neural networks" });

    expect(confirm).toHaveBeenCalledWith({
      tool: "literature_search",
      summary: "Search OpenAlex for graph neural networks",
    });
    expect(searchOpenAlex).not.toHaveBeenCalled();
    expect(res).toMatchObject({ declined: true, tool: "literature_search" });
  });

  it("verify_citation resolves a DOI to BibTeX", async () => {
    fetchDoiBibtex.mockResolvedValue("@article{key, title={A Paper}}");
    const tools = createResearchTools(host);
    const res = await tools.verify_citation.execute({ doi: "10.1000/example" });
    expect(fetchDoiBibtex).toHaveBeenCalledWith("10.1000/example");
    expect(res).toMatchObject({ verified: true, bibtex: expect.stringContaining("A Paper") });
  });

  it("does not contact Crossref before approval", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createResearchTools(host, { confirm });

    const res = await tools.verify_citation.execute({ doi: "10.1000/example" });

    expect(confirm).toHaveBeenCalledWith({
      tool: "verify_citation",
      summary: "Verify citation with Crossref",
    });
    expect(fetchDoiBibtex).not.toHaveBeenCalled();
    expect(crossrefSearch).not.toHaveBeenCalled();
    expect(res).toMatchObject({ declined: true, tool: "verify_citation" });
  });

  it("verify_citation falls back to a Crossref title search when no DOI is given", async () => {
    crossrefSearch.mockResolvedValue(JSON.stringify({ items: [{ title: ["A Paper"], DOI: "10.1000/x" }] }));
    const tools = createResearchTools(host);
    const res = await tools.verify_citation.execute({ title: "A Paper" });
    expect(crossrefSearch).toHaveBeenCalledWith("A Paper");
    expect(res).toMatchObject({ verified: true });
  });

  it("verify_citation reports unverified when nothing matches", async () => {
    crossrefSearch.mockResolvedValue(JSON.stringify({ items: [] }));
    const tools = createResearchTools(host);
    const res = await tools.verify_citation.execute({ title: "Definitely Not A Real Paper Title Xyz" });
    expect(res).toMatchObject({ verified: false });
  });
});

describe("project library search", () => {
  const retrieveProjectChunks = vi.fn();
  let host: ResearchToolsHost;

  beforeEach(() => {
    retrieveProjectChunks.mockReset();
    host = {
      searchOpenAlex: vi.fn(),
      crossrefSearch: vi.fn(),
      fetchDoiBibtex: vi.fn(),
      retrieveProjectChunks,
    };
  });

  it("searches the current project's own files, no external call", async () => {
    retrieveProjectChunks.mockResolvedValue([
      { path: "related-work.tex", startLine: 10, endLine: 20, text: "prior work on...", score: 4.2 },
    ]);
    const tools = createResearchTools(host);
    const res = await tools.project_library_search.execute({ query: "prior work" });
    expect(retrieveProjectChunks).toHaveBeenCalledWith("prior work", { topK: 5 });
    expect(res).toMatchObject({ chunks: [{ path: "related-work.tex" }] });
  });

  it("reports no open project cleanly rather than throwing", async () => {
    retrieveProjectChunks.mockRejectedValue(new Error("no project is currently open"));
    const tools = createResearchTools(host);
    const res = await tools.project_library_search.execute({ query: "anything" });
    expect(res).toMatchObject({ error: expect.stringContaining("no project is currently open") });
  });
});

describe("research tool input and failure handling", () => {
  function hostWith(overrides: Partial<ResearchToolsHost> = {}): ResearchToolsHost {
    return {
      searchOpenAlex: vi.fn(),
      crossrefSearch: vi.fn(),
      fetchDoiBibtex: vi.fn(),
      retrieveProjectChunks: vi.fn(),
      ...overrides,
    };
  }

  it("rejects blank queries before asking or searching", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const host = hostWith();
    const tools = createResearchTools(host, { confirm });
    expect(await tools.literature_search.execute({ query: "   " })).toEqual({ error: "query must not be empty" });
    expect(await tools.literature_search.execute({})).toEqual({ error: "query must not be empty" });
    expect(await tools.project_library_search.execute({ query: "" })).toEqual({ error: "query must not be empty" });
    expect(await tools.project_library_search.execute({})).toEqual({ error: "query must not be empty" });
    expect(confirm).not.toHaveBeenCalled();
    expect(host.searchOpenAlex).not.toHaveBeenCalled();
    expect(host.retrieveProjectChunks).not.toHaveBeenCalled();
  });

  it("clamps the result limit to at least one", async () => {
    const host = hostWith({ searchOpenAlex: vi.fn().mockResolvedValue({ results: [] }) });
    await createResearchTools(host).literature_search.execute({ query: "q", limit: -4 });
    expect(host.searchOpenAlex).toHaveBeenCalledWith("q", 1);
  });

  it("runs an approved search", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const host = hostWith({ searchOpenAlex: vi.fn().mockResolvedValue({ results: [{ id: "W1" }] }) });
    expect(await createResearchTools(host, { confirm }).literature_search.execute({ query: "q" })).toEqual({
      results: [{ id: "W1" }],
    });
  });

  it("returns search failures as errors, Error or not", async () => {
    const tools = createResearchTools(
      hostWith({
        searchOpenAlex: vi.fn().mockRejectedValue(new Error("rate limited")),
        retrieveProjectChunks: vi.fn().mockRejectedValue("index missing"),
      }),
    );
    expect(await tools.literature_search.execute({ query: "q" })).toEqual({ error: "rate limited" });
    expect(await tools.project_library_search.execute({ query: "q" })).toEqual({ error: "index missing" });
  });

  it("returns non-Error rejections from the OpenAlex and Crossref lookups as text", async () => {
    const tools = createResearchTools(
      hostWith({
        searchOpenAlex: vi.fn().mockRejectedValue("offline"),
        fetchDoiBibtex: vi.fn().mockRejectedValue(503),
      }),
    );
    expect(await tools.literature_search.execute({ query: "q" })).toEqual({ error: "offline" });
    expect(await tools.verify_citation.execute({ doi: "10.1/x" })).toEqual({ error: "503" });
  });

  it("needs a DOI or a title to verify", async () => {
    const host = hostWith();
    const tools = createResearchTools(host);
    expect(await tools.verify_citation.execute({ doi: "  ", title: 42 })).toEqual({
      error: "Provide either doi or title.",
    });
    expect(host.crossrefSearch).not.toHaveBeenCalled();
  });

  it("falls back to the title when the DOI is blank and tolerates sparse records", async () => {
    const host = hostWith({ crossrefSearch: vi.fn().mockResolvedValue(JSON.stringify({ items: [{}] })) });
    expect(
      await createResearchTools(host).verify_citation.execute({ doi: " ", title: "  Attention  " }),
    ).toEqual({ verified: true, source: "crossref-search", doi: null, matchedTitle: null });
    expect(host.crossrefSearch).toHaveBeenCalledWith("Attention");
    expect(host.fetchDoiBibtex).not.toHaveBeenCalled();
  });

  it("reports a match with its DOI and title", async () => {
    const host = hostWith({
      crossrefSearch: vi.fn().mockResolvedValue(JSON.stringify({ items: [{ title: ["Attention"], DOI: "10.1/x" }] })),
    });
    expect(await createResearchTools(host).verify_citation.execute({ title: "Attention" })).toEqual({
      verified: true,
      source: "crossref-search",
      doi: "10.1/x",
      matchedTitle: "Attention",
    });
  });

  it("treats a response with no items as unverified", async () => {
    const host = hostWith({ crossrefSearch: vi.fn().mockResolvedValue("{}") });
    expect(await createResearchTools(host).verify_citation.execute({ title: "Nothing" })).toEqual({
      verified: false,
      reason: "No matching Crossref record found.",
    });
  });

  it("returns lookup and parse failures as errors", async () => {
    const tools = createResearchTools(
      hostWith({
        fetchDoiBibtex: vi.fn().mockRejectedValue(new Error("DOI not found")),
        crossrefSearch: vi.fn().mockResolvedValue("<html>"),
      }),
    );
    expect(await tools.verify_citation.execute({ doi: "10.1/missing" })).toEqual({ error: "DOI not found" });
    expect(await tools.verify_citation.execute({ title: "x" })).toMatchObject({ error: expect.stringContaining("JSON") });
  });
});
