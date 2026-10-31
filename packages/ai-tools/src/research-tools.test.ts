import { describe, it, expect, vi, beforeEach } from "vitest";
import { createResearchTaskTools, createResearchTools, type ResearchToolsHost } from "./research-tools";

describe("literature search and citation verification tools", () => {
  const searchLiterature = vi.fn();
  const verifyCitation = vi.fn();
  let host: ResearchToolsHost;

  beforeEach(() => {
    searchLiterature.mockReset();
    verifyCitation.mockReset();
    host = {
      searchLiterature,
      verifyCitation,
      retrieveProjectChunks: vi.fn(),
    };
  });

  it("literature_search asks the host's unified search with the clamped limit", async () => {
    searchLiterature.mockResolvedValue({ records: [{ id: "openalex:W123", title: "A Work" }], failures: [] });
    const tools = createResearchTools(host);
    const res = await tools.literature_search.execute({ query: "graph neural networks", limit: 99 });
    expect(searchLiterature).toHaveBeenCalledWith("graph neural networks", { limit: 25 });
    expect(res).toMatchObject({ records: [{ id: "openalex:W123" }] });
  });

  it("literature_search passes known sources only", async () => {
    searchLiterature.mockResolvedValue({ records: [], failures: [] });
    const tools = createResearchTools(host);
    await tools.literature_search.execute({ query: "graph neural networks", sources: ["pubmed", "nowhere"] });
    expect(searchLiterature).toHaveBeenCalledWith("graph neural networks", { limit: 10, sources: ["pubmed"] });
  });

  it("literature_search defaults to ten results", async () => {
    searchLiterature.mockResolvedValue({ records: [], failures: [] });
    const tools = createResearchTools(host);
    await tools.literature_search.execute({ query: "graph neural networks" });
    expect(searchLiterature).toHaveBeenCalledWith("graph neural networks", { limit: 10 });
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
    searchLiterature.mockResolvedValue({ records: [], failures: [] });
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createResearchTools(host, { confirm });

    const res = await tools.literature_search.execute({ query: "graph neural networks" });

    expect(confirm).toHaveBeenCalledWith({
      tool: "literature_search",
      summary: "Search scholarly indexes for graph neural networks",
    });
    expect(searchLiterature).not.toHaveBeenCalled();
    expect(res).toMatchObject({ declined: true, tool: "literature_search" });
  });

  it("verify_citation passes doi and title to the host verifier", async () => {
    verifyCitation.mockResolvedValue({ verified: true, source: "doi", doi: "10.1000/example", bibtex: "@article{key, title={A Paper}}" });
    const tools = createResearchTools(host);
    await tools.verify_citation.execute({ doi: "10.1000/example", title: "A Paper" });
    expect(verifyCitation).toHaveBeenCalledWith({ doi: "10.1000/example", title: "A Paper" });
  });

  it("returns the host verdict unchanged", async () => {
    const verdict = {
      verified: false,
      source: "crossref-search",
      doi: "10.1/a",
      matchedTitle: "Attention is not all you need",
      score: 0.86,
      bibtex: null,
      reason: "No matching Crossref record found.",
    };
    verifyCitation.mockResolvedValue(verdict);
    const tools = createResearchTools(host);
    expect(await tools.verify_citation.execute({ title: "Attention Is All You Need" })).toEqual(verdict);
  });

  it("does not contact the verifier before approval", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createResearchTools(host, { confirm });

    const res = await tools.verify_citation.execute({ doi: "10.1000/example" });

    expect(confirm).toHaveBeenCalledWith({
      tool: "verify_citation",
      summary: "Verify citation with Crossref",
    });
    expect(verifyCitation).not.toHaveBeenCalled();
    expect(res).toMatchObject({ declined: true, tool: "verify_citation" });
  });
});

describe("project library search", () => {
  const retrieveProjectChunks = vi.fn();
  let host: ResearchToolsHost;

  beforeEach(() => {
    retrieveProjectChunks.mockReset();
    host = {
      searchLiterature: vi.fn(),
      verifyCitation: vi.fn(),
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
      searchLiterature: vi.fn(),
      verifyCitation: vi.fn(),
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
    expect(host.searchLiterature).not.toHaveBeenCalled();
    expect(host.retrieveProjectChunks).not.toHaveBeenCalled();
  });

  it("clamps the result limit to at least one", async () => {
    const host = hostWith({ searchLiterature: vi.fn().mockResolvedValue({ records: [], failures: [] }) });
    await createResearchTools(host).literature_search.execute({ query: "q", limit: -4 });
    expect(host.searchLiterature).toHaveBeenCalledWith("q", { limit: 1 });
  });

  it("runs an approved search", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const host = hostWith({
      searchLiterature: vi.fn().mockResolvedValue({ records: [{ id: "openalex:W1" }], failures: [] }),
    });
    expect(await createResearchTools(host, { confirm }).literature_search.execute({ query: "q" })).toEqual({
      records: [{ id: "openalex:W1" }],
      failures: [],
    });
  });

  it("returns search failures as errors, Error or not", async () => {
    const tools = createResearchTools(
      hostWith({
        searchLiterature: vi.fn().mockRejectedValue(new Error("rate limited")),
        retrieveProjectChunks: vi.fn().mockRejectedValue("index missing"),
      }),
    );
    expect(await tools.literature_search.execute({ query: "q" })).toEqual({ error: "rate limited" });
    expect(await tools.project_library_search.execute({ query: "q" })).toEqual({ error: "index missing" });
  });

  it("returns non-Error rejections from the literature and Crossref lookups as text", async () => {
    const tools = createResearchTools(
      hostWith({
        searchLiterature: vi.fn().mockRejectedValue("offline"),
        verifyCitation: vi.fn().mockRejectedValue(503),
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
    expect(host.verifyCitation).not.toHaveBeenCalled();
  });

  it("sends only the title when the DOI is blank", async () => {
    const host = hostWith({ verifyCitation: vi.fn().mockResolvedValue({ verified: true }) });
    await createResearchTools(host).verify_citation.execute({ doi: " ", title: "  Attention  " });
    expect(host.verifyCitation).toHaveBeenCalledWith({ title: "Attention" });
  });

  it("returns lookup failures as errors", async () => {
    const tools = createResearchTools(
      hostWith({ verifyCitation: vi.fn().mockRejectedValue(new Error("DOI not found")) }),
    );
    expect(await tools.verify_citation.execute({ doi: "10.1/missing" })).toEqual({ error: "DOI not found" });
  });
});

describe("research task tools", () => {
  const host = () => ({
    createResearchTask: vi.fn().mockResolvedValue({ id: "t1", title: "Sweep", status: "running" }),
    researchTaskStatus: vi.fn().mockResolvedValue({ tasks: [] }),
  });

  it("creates and starts a task only after approval", async () => {
    const declinedHost = host();
    const declined = await createResearchTaskTools(declinedHost, { confirm: vi.fn().mockResolvedValue(false) })
      .research_task_create.execute({ title: "Sweep", prompt: "Find papers." });
    expect(declined).toMatchObject({ declined: true });
    expect(declinedHost.createResearchTask).not.toHaveBeenCalled();

    const approvedHost = host();
    const confirm = vi.fn().mockResolvedValue(true);
    const created = await createResearchTaskTools(approvedHost, { confirm }).research_task_create.execute({
      title: "Sweep",
      prompt: "Find papers.",
      review_plan_first: true,
      time_budget_minutes: 90,
    });
    const details = {
      title: "Sweep",
      prompt: "Find papers.",
      goal: null,
      skills: [],
      commands: "ask",
      network: false,
      reviewPlanFirst: true,
      timeBudgetMinutes: 90,
      start: true,
    };
    expect(confirm).toHaveBeenCalledWith({
      tool: "research_task_create",
      summary:
        'Create the research task "Sweep" and start it.\nIt works on its own in a copy of the project. Each command it runs asks first; network access is off.\nPrompt:\nFind papers.',
      researchTask: details,
    });
    expect(approvedHost.createResearchTask).toHaveBeenCalledWith({
      title: "Sweep",
      prompt: "Find papers.",
      skillIds: [],
      brief: { reviewPlanFirst: true, timeBudgetMinutes: 90 },
      start: true,
    });
    expect(created).toEqual({ id: "t1", title: "Sweep", status: "running" });
  });

  it("shows the network setting the agent asked for, and a long prompt in part in the summary", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const long = `${"a".repeat(1_600)}END`;
    await createResearchTaskTools(host(), { confirm }).research_task_create.execute({
      title: "Sweep",
      prompt: long,
      network: true,
      start: false,
    });
    const [request] = confirm.mock.calls[0] as [{ summary: string; researchTask: { prompt: string; network: boolean } }];
    expect(request.summary).toContain("network access is on");
    expect(request.summary).not.toContain("and start it");
    expect(request.summary).not.toContain("END");
    expect(request.summary).toContain(`${"a".repeat(1_500)}…`);
    expect(request.researchTask).toMatchObject({ prompt: long, network: true, commands: "ask", start: false });
  });

  it("validates title and budget before asking", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const tools = createResearchTaskTools(host(), { confirm });
    expect(await tools.research_task_create.execute({ title: "", prompt: "x" })).toMatchObject({ error: expect.any(String) });
    expect(
      await tools.research_task_create.execute({ title: "Sweep", prompt: "x", time_budget_minutes: 2 }),
    ).toMatchObject({ error: "time_budget_minutes must be a whole number from 5 to 1440" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("passes the trimmed goal, criteria and skills to the host", async () => {
    const createHost = host();
    const confirm = vi.fn().mockResolvedValue(true);
    await createResearchTaskTools(createHost, { confirm }).research_task_create.execute({
      title: " Sweep ",
      prompt: " Find papers. ",
      goal: "  Map the field  ",
      success_criteria: [" Ten sources ", "", "A summary"],
      skills: ["literature-review"],
      network: true,
    });
    expect(confirm.mock.calls[0][0].researchTask).toMatchObject({
      title: "Sweep",
      prompt: "Find papers.",
      goal: "Map the field",
      skills: ["literature-review"],
      network: true,
      timeBudgetMinutes: null,
    });
    expect(createHost.createResearchTask).toHaveBeenCalledWith({
      title: "Sweep",
      prompt: "Find papers.",
      skillIds: ["literature-review"],
      brief: { goal: "Map the field", successCriteria: ["Ten sources", "A summary"], network: true },
      start: true,
    });
  });

  it("shows a blank goal as none but still passes it on", async () => {
    const createHost = host();
    const confirm = vi.fn().mockResolvedValue(true);
    await createResearchTaskTools(createHost, { confirm }).research_task_create.execute({
      title: "Sweep",
      prompt: "x",
      goal: "   ",
    });
    expect(confirm.mock.calls[0][0].researchTask.goal).toBeNull();
    expect(createHost.createResearchTask.mock.calls[0][0].brief).toEqual({ goal: "" });
  });

  it("rejects a bad prompt, skill list or criteria list before asking", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const tools = createResearchTaskTools(host(), { confirm });
    expect(await tools.research_task_create.execute({ title: "Sweep", prompt: "  " })).toEqual({
      error: "prompt must be 1 to 32,000 characters",
    });
    expect(await tools.research_task_create.execute({ title: "Sweep", prompt: "x", skills: "a" })).toEqual({
      error: "skills must be a list of strings",
    });
    expect(
      await tools.research_task_create.execute({ title: "Sweep", prompt: "x", success_criteria: [1] }),
    ).toEqual({ error: "success_criteria must be a list of strings" });
    expect(
      await tools.research_task_create.execute({
        title: "Sweep",
        prompt: "x",
        success_criteria: Array.from({ length: 13 }, () => "c"),
      }),
    ).toEqual({ error: "success_criteria can hold at most 12 items" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("reports status for one task or the latest ten", async () => {
    const statusHost = host();
    const tools = createResearchTaskTools(statusHost);
    await tools.research_task_status.execute({});
    await tools.research_task_status.execute({ id: "t1" });
    expect(statusHost.researchTaskStatus).toHaveBeenNthCalledWith(1, undefined);
    expect(statusHost.researchTaskStatus).toHaveBeenNthCalledWith(2, "t1");
  });
});
