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
