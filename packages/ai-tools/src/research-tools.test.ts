import { describe, it, expect, vi, beforeEach } from "vitest";
import { createResearchTools, type ResearchToolsHost } from "./research-tools";

describe("alphaXiv connector tools", () => {
  let host: ResearchToolsHost;
  const fetchJson = vi.fn();
  const getConnectorKey = vi.fn();

  beforeEach(() => {
    fetchJson.mockReset();
    getConnectorKey.mockReset();
    host = {
      fetchJson,
      getConnectorKey,
      crossrefSearch: vi.fn(),
      fetchDoiBibtex: vi.fn(),
      retrieveProjectChunks: vi.fn(),
    };
  });

  it("alphaxiv_search returns a friendly error when no key is configured", async () => {
    getConnectorKey.mockResolvedValue(null);
    const tools = createResearchTools(host);
    const res = await tools.alphaxiv_search.execute({ query: "diffusion models" });
    expect(res).toMatchObject({ error: expect.stringContaining("Connect alphaXiv") });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("alphaxiv_search calls the MCP search endpoint with the stored key", async () => {
    getConnectorKey.mockResolvedValue("test-key-123");
    fetchJson.mockResolvedValue({ results: [{ id: "1234.5678", title: "A Paper" }] });
    const tools = createResearchTools(host);
    const res = await tools.alphaxiv_search.execute({ query: "diffusion models" });
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("api.alphaxiv.org"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-key-123" }) }),
    );
    expect(res).toMatchObject({ results: [{ id: "1234.5678", title: "A Paper" }] });
  });

  it("does not search alphaXiv before approval", async () => {
    getConnectorKey.mockResolvedValue("test-key-123");
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createResearchTools(host, { confirm });

    const res = await tools.alphaxiv_search.execute({ query: "diffusion models" });

    expect(confirm).toHaveBeenCalledWith({
      tool: "alphaxiv_search",
      summary: "Search alphaXiv for diffusion models",
    });
    expect(fetchJson).not.toHaveBeenCalled();
    expect(res).toMatchObject({ declined: true, tool: "alphaxiv_search" });
  });

  it("alphaxiv_paper_content requires a paper id", async () => {
    getConnectorKey.mockResolvedValue("test-key-123");
    const tools = createResearchTools(host);
    const res = await tools.alphaxiv_paper_content.execute({});
    expect(res).toMatchObject({ error: expect.any(String) });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("does not fetch alphaXiv paper content before approval", async () => {
    getConnectorKey.mockResolvedValue("test-key-123");
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createResearchTools(host, { confirm });

    const res = await tools.alphaxiv_paper_content.execute({ paper_id: "2410.16464" });

    expect(confirm).toHaveBeenCalledWith({
      tool: "alphaxiv_paper_content",
      summary: "Fetch paper 2410.16464 from alphaXiv",
    });
    expect(fetchJson).not.toHaveBeenCalled();
    expect(res).toMatchObject({ declined: true, tool: "alphaxiv_paper_content" });
  });
});

describe("OpenAlex + citation verification tools", () => {
  const fetchJson = vi.fn();
  const getConnectorKey = vi.fn();
  const crossrefSearch = vi.fn();
  const fetchDoiBibtex = vi.fn();
  let host: ResearchToolsHost;

  beforeEach(() => {
    fetchJson.mockReset();
    getConnectorKey.mockReset();
    crossrefSearch.mockReset();
    fetchDoiBibtex.mockReset();
    host = {
      fetchJson,
      getConnectorKey,
      crossrefSearch,
      fetchDoiBibtex,
      retrieveProjectChunks: vi.fn(),
    };
  });

  it("literature_search needs no connector key (OpenAlex is keyless)", async () => {
    fetchJson.mockResolvedValue({ results: [{ id: "W123", display_name: "A Work" }] });
    const tools = createResearchTools(host);
    const res = await tools.literature_search.execute({ query: "graph neural networks" });
    expect(getConnectorKey).not.toHaveBeenCalled();
    expect(fetchJson).toHaveBeenCalledWith(expect.stringContaining("api.openalex.org/works"));
    expect(res).toMatchObject({ results: [{ id: "W123" }] });
  });

  it("does not start an internet request before approval", async () => {
    fetchJson.mockResolvedValue({ results: [] });
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createResearchTools(host, { confirm });

    const res = await tools.literature_search.execute({ query: "graph neural networks" });

    expect(confirm).toHaveBeenCalledWith({
      tool: "literature_search",
      summary: "Search OpenAlex for graph neural networks",
    });
    expect(fetchJson).not.toHaveBeenCalled();
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
      fetchJson: vi.fn(),
      getConnectorKey: vi.fn(),
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
