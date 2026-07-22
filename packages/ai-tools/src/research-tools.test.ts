import { describe, it, expect, vi, beforeEach } from "vitest";
import { createResearchTools, type ResearchToolsHost } from "./research-tools";

describe("alphaXiv connector tools", () => {
  let host: ResearchToolsHost;
  const fetchJson = vi.fn();
  const getConnectorKey = vi.fn();

  beforeEach(() => {
    fetchJson.mockReset();
    getConnectorKey.mockReset();
    host = { fetchJson, getConnectorKey };
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

  it("alphaxiv_paper_content requires a paper id", async () => {
    getConnectorKey.mockResolvedValue("test-key-123");
    const tools = createResearchTools(host);
    const res = await tools.alphaxiv_paper_content.execute({});
    expect(res).toMatchObject({ error: expect.any(String) });
    expect(fetchJson).not.toHaveBeenCalled();
  });
});
