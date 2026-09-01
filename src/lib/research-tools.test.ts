import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getConnectorKey: vi.fn(),
  setConnectorKey: vi.fn(),
  crossrefSearch: vi.fn(),
  fetchDoiBibtex: vi.fn(),
}));

vi.mock("@/lib/tauri", () => mocks);
vi.mock("@/lib/ai-rag", () => ({ retrieveProjectChunks: vi.fn().mockResolvedValue([]) }));

import { createResearchAiTools } from "./research-tools";

beforeEach(() => {
  for (const f of Object.values(mocks)) f.mockReset();
});

describe("app-level research tools wiring", () => {
  it("wires project_library_search to the real ai-rag retrieval function", async () => {
    const tools = createResearchAiTools();
    const res = await tools.project_library_search.execute({ query: "anything" });
    expect(res).toMatchObject({ chunks: [] });
  });

  it("wires verify_citation to the real Tauri citation commands", async () => {
    mocks.fetchDoiBibtex.mockResolvedValue("@article{k, title={T}}");
    const tools = createResearchAiTools();
    const res = await tools.verify_citation.execute({ doi: "10.1/x" });
    expect(mocks.fetchDoiBibtex).toHaveBeenCalledWith("10.1/x");
    expect(res).toMatchObject({ verified: true });
  });

  it("forwards internet approval before invoking citation commands", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createResearchAiTools({ confirm });

    const res = await tools.verify_citation.execute({ doi: "10.1/x" });

    expect(confirm).toHaveBeenCalledWith({
      tool: "verify_citation",
      summary: "Verify citation with Crossref",
    });
    expect(mocks.fetchDoiBibtex).not.toHaveBeenCalled();
    expect(res).toMatchObject({ declined: true, tool: "verify_citation" });
  });
});
